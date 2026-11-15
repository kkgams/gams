"""Assemble static assets only. Never execute Jco or transpile a component."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "experiments/browser-jco"
BUILD = ROOT / "build.nosync/browser-jco"
SITE = BUILD / "site"

# Diagnostics consume the production compiler/runtime, never the reverse.
spec = importlib.util.spec_from_file_location('web_build', ROOT / 'cmd/web/build.py')
web = importlib.util.module_from_spec(spec)
spec.loader.exec_module(web)


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
    for unit in json.loads((web.SOURCE / 'view-assets.json').read_text()):
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

    (SITE / 'core/runtime').mkdir(parents=True, exist_ok=True)
    for source, output, extra in (
        ('files-host.ts', 'files-host.js', ['--external:/core/*', '--external:/units/*']),
        ('files-transport.ts', 'files-transport.js', []),
    ):
        subprocess.run([
            'esbuild', str(SOURCE / source), '--bundle', '--format=esm',
            '--platform=browser', '--target=es2022', f'--outfile={SITE / output}', *extra,
        ], check=True)
    shutil.copy2(SOURCE / 'diagnostic-native.js', SITE / 'core/runtime/native.js')
    shutil.copy2(SOURCE / 'files.html', SITE / 'files.html')
    shutil.copy2(web.SOURCE / 'view-assets.json', SITE / 'view-assets.json')


def build():
    aliases = web.build(site=SITE)
    subprocess.run([
        'esbuild', str(SOURCE / 'transpiler-worker.ts'), '--bundle', '--format=esm',
        '--platform=browser', '--target=es2022', '--external:node:*', '--external:/util/*',
        f'--outfile={SITE / "vendor/transpiler-worker.js"}', *aliases,
    ], check=True)
    subprocess.run([
        "esbuild", str(SOURCE / "ui.ts"), "--bundle", "--format=esm",
        "--platform=browser", "--target=es2022", f"--outfile={SITE}/ui.js",
    ], check=True)
    shutil.copy2(SOURCE / 'index.html', SITE / 'index.html')
    vendor = SITE / 'vendor'
    components = SITE / 'components'
    components.mkdir(exist_ok=True)
    # Unmodified published components and their original license assets.
    for plugin in json.loads((web.SOURCE / 'plugins.json').read_text()):
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
    shutil.copy2(web.SOURCE / 'plugins.json', SITE / 'plugins.json')
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
