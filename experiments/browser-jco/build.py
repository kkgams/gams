"""Assemble static assets only. Never execute Jco or transpile a component."""
import base64
import hashlib
import io
import json
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import tarfile
import urllib.request
import urllib.parse
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "experiments/browser-jco"
BUILD = ROOT / "build.nosync/browser-jco"
SITE = BUILD / "site"


def verified_download(url, target, expected):
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        with urllib.request.urlopen(url) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError(f"Integrity mismatch: {url}")
        target.write_bytes(data)
    data = target.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError(f"Integrity mismatch: {target}")
    return data


def extract_unit(data, target):
    # Validate every member before writing; never extract links or special files.
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        members = archive.infolist()
        if len(members) > 10000 or sum(item.file_size for item in members) > 100 * 1024 * 1024:
            raise ValueError(f"Unit archive exceeds extraction limits: {target.name}")
        seen = set()
        for item in members:
            path = PurePosixPath(item.filename)
            kind = stat.S_IFMT(item.external_attr >> 16)
            if (not path.parts or path.is_absolute() or '..' in path.parts
                    or '\\' in item.filename or ':' in item.filename
                    or kind not in (0, stat.S_IFREG, stat.S_IFDIR) or path in seen):
                raise ValueError(f"Unsafe unit archive member: {item.filename}")
            seen.add(path)
        for parent in (target, *target.parents):
            if parent.is_symlink():
                raise ValueError(f"Refusing symlink extraction destination: {parent}")
        if target.exists():
            shutil.rmtree(target)
        target.mkdir(parents=True)
        for item in members:
            destination = target / item.filename
            if item.is_dir():
                destination.mkdir(parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(parents=True, exist_ok=True)
                # Reading to EOF checks the archive member's CRC as well.
                destination.write_bytes(archive.read(item))


def build_files():
    default_project = SITE / 'browser-default'
    # Rebuild only this generated source directory so old bootstrap ZIPs/plugins
    # are not kept in incremental builds. Browser/OPFS data is never touched.
    subprocess.run(['python3', str(ROOT / 'scripts/package-host.py'), 'clean',
                    str(default_project)], check=True)
    default_project.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE / 'browser-default/gams.json', default_project / 'gams.json')

    for unit in json.loads((SOURCE / 'view-assets.json').read_text()):
        repo = unit['repository'].split('/')[-1]
        base_url = f"https://github.com/{unit['repository']}/releases/download/{unit['tag']}"
        cache = BUILD / 'releases' / repo / unit['tag']
        checksums = verified_download(f'{base_url}/SHA256SUMS', cache / 'SHA256SUMS',
                                      unit['checksumsSha256']).decode()
        published = [line.split()[0] for line in checksums.splitlines()
                     if len(line.split()) == 2 and line.split()[1].lstrip('*') == unit['archive']]
        if published != [unit['sha256']]:
            raise ValueError(f"Published SHA256SUMS mismatch: {repo}")
        data = verified_download(f"{base_url}/{unit['archive']}", cache / unit['archive'], unit['sha256'])
        extract_unit(data, SITE / 'units' / repo)
        print(f"Verified {repo} {unit['tag']}: {unit['sha256']}")

    for name in ('LICENSE', 'NOTICE'):
        shutil.copy2(ROOT / name, SITE / name)
    (SITE / 'core/runtime').mkdir(parents=True, exist_ok=True)
    for source, output, extra in (
        ('files-host.ts', 'files-host.js', ['--external:/core/*', '--external:/units/*']),
        ('files-transport.ts', 'files-transport.js', []),
        ('browser-transport.ts', 'browser-transport.js', ['--external:/core/*']),
        ('browser-launch.ts', 'browser-launch.js', ['--external:/app.js', '--external:/browser-transport.js']),
        ('browser-menu.ts', 'core/menu/native.js', []),
    ):
        subprocess.run([
            'esbuild', str(SOURCE / source), '--bundle', '--format=esm',
            '--platform=browser', '--target=es2022', f'--outfile={SITE / output}', *extra,
        ], check=True)
    shutil.copy2(SOURCE / 'browser-native.js', SITE / 'core/runtime/native.js')
    shutil.copy2(SOURCE / 'files.html', SITE / 'files.html')
    shutil.copy2(SOURCE / 'view-assets.json', SITE / 'view-assets.json')


def build():
    SITE.mkdir(parents=True, exist_ok=True)
    # Public build-time browser settings; never export credentials/query tokens.
    proxy = os.environ.get('GAMS_CORS_PROXY') or None
    if proxy:
        endpoint = urllib.parse.urlsplit(proxy)
        loopback = endpoint.hostname in ('localhost', '::1') or bool(
            re.fullmatch(r'127(?:\.\d{1,3}){3}', endpoint.hostname or ''))
        if (re.search(r'[\x00-\x20\\?#]', proxy) or not endpoint.hostname
                or endpoint.username is not None or endpoint.password is not None
                or endpoint.scheme not in ('http', 'https')
                or (endpoint.scheme == 'http' and not loopback)):
            raise ValueError('GAMS_CORS_PROXY requires an HTTPS or loopback HTTP endpoint without credentials, query or fragment')
        endpoint.port  # Validate a supplied numeric port before exporting the URL.
    (SITE / 'browser-environment.json').write_text(json.dumps({'corsProxy': proxy}) + '\n')
    # Keep every shared Host module and asset canonical. Only the platform
    # transport/menu and the experiment landing page are replaced below.
    host = ROOT / 'cmd/app/src'
    shutil.copytree(host, SITE, dirs_exist_ok=True, ignore=shutil.ignore_patterns('.DS_Store'))
    browser_html = (host / 'index.html').read_text().replace(
        'src="./app.js"', 'src="/browser-launch.js"')
    (SITE / 'browser.html').write_text(browser_html)
    shutil.copy2(ROOT / 'promo/favicon.svg', SITE / 'favicon.svg')
    deps = {}
    for dep in json.loads((SOURCE / "dependencies.json").read_text()):
        name = dep["name"].split("/")[-1]
        archive = BUILD / f"{name}-{dep['version']}.tgz"
        if not archive.exists():
            with urllib.request.urlopen(dep["url"]) as response:
                archive.write_bytes(response.read())
        data = archive.read_bytes()
        actual = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
        if actual != dep["integrity"]:
            raise ValueError(f"Integrity mismatch: {archive}")
        target = BUILD / "dependencies" / name
        target.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(data)) as tar:
            tar.extractall(target, filter="data")
        deps[name] = target / "package"
    vendor = SITE / "vendor"
    vendor.mkdir(exist_ok=True)
    shim = deps['preview2-shim']
    aliases = [
        f"--alias:@bytecodealliance/jco/component={deps['jco']}/dist/browser.js",
        f"--alias:@bytecodealliance/jco-transpile/component={deps['jco-transpile']}/dist/component.js",
        f"--alias:@bytecodealliance/preview2-shim/instantiation={shim}/dist/common/instantiation.js",
        f"--alias:@bytecodealliance/preview2-shim/filesystem={shim}/dist/browser/filesystem.js",
        f"--alias:@bytecodealliance/preview2-shim={shim}/dist/browser/index.js",
    ]
    for worker in ('transpiler-worker', 'browser-worker'):
        subprocess.run([
            "esbuild", str(SOURCE / f"{worker}.ts"), "--bundle", "--format=esm",
            "--platform=browser", "--target=es2022", "--external:node:*",
            "--external:/util/*",
            f"--outfile={vendor}/{worker}.js", *aliases,
        ], check=True)
    subprocess.run([
        "esbuild", str(SOURCE / "ui.ts"), "--bundle", "--format=esm",
        "--platform=browser", "--target=es2022", f"--outfile={SITE}/ui.js",
    ], check=True)
    # component.js uses new URL('../vendor/<literal>', import.meta.url).
    # Preserve that relationship to the bundled worker; no source rewriting.
    for wasm in (deps['jco-transpile'] / 'vendor').glob('js-component-bindgen-component.core*.wasm'):
        shutil.copy2(wasm, vendor / wasm.name)
    for name, package in deps.items():
        notices = vendor / 'licenses' / name
        notices.mkdir(parents=True, exist_ok=True)
        license_path = SOURCE / 'LICENSE-JCO' if name == 'jco' else package / 'LICENSE'
        shutil.copy2(license_path, notices / 'LICENSE')
        shutil.copy2(package / 'package.json', notices / 'upstream-package.json')
    shutil.copy2(SOURCE / 'index.html', SITE / 'index.html')
    components = SITE / 'components'
    components.mkdir(exist_ok=True)
    # Unmodified published components and their original license assets.
    for plugin in json.loads((SOURCE / 'plugins.json').read_text()):
        unit = plugin['repository'].split('/')[-1]
        notices = vendor / 'licenses' / unit
        notices.mkdir(parents=True, exist_ok=True)
        for asset in plugin['files']:
            url = f"https://github.com/{plugin['repository']}/releases/download/{plugin['tag']}/{asset['name']}"
            cached = BUILD / 'releases' / unit / asset['name']
            if not cached.exists():
                cached.parent.mkdir(parents=True, exist_ok=True)
                with urllib.request.urlopen(url) as response:
                    cached.write_bytes(response.read())
            if hashlib.sha256(cached.read_bytes()).hexdigest() != asset['sha256']:
                raise ValueError(f'Integrity mismatch: {cached}')
            destination = components if asset['name'].endswith('.wasm') else notices
            shutil.copy2(cached, destination / asset['name'])
        subprocess.run(['wasm-tools', 'validate', str(components / f'{unit}.wasm')], check=True)
    shutil.copy2(SOURCE / 'plugins.json', SITE / 'plugins.json')
    for wat in (SOURCE / 'components').glob('*.wat'):
        output = components / f'{wat.stem}.wasm'
        if not output.exists() or wat.stat().st_mtime > output.stat().st_mtime:
            subprocess.run(['wasm-tools', 'parse', str(wat), '-o', str(output)], check=True)
        subprocess.run(['wasm-tools', 'validate', str(output)], check=True)
        subprocess.run(['wasm-tools', 'component', 'targets', str(SOURCE / 'components'),
                        '-w', wat.stem, str(output)], check=True)
    build_files()


if __name__ == '__main__':
    build()
