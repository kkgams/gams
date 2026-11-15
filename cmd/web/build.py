"""Build the static Web Host from canonical frontend and pinned compiler assets."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'cmd/web'
BUILD = ROOT / 'build.nosync/web-build'
SITE = BUILD / 'site'


def prepare_compiler(site):
    """Share pinned compiler tooling with diagnostics, without runtime duplication."""
    BUILD.mkdir(parents=True, exist_ok=True)
    deps = {}
    for dep in json.loads((SOURCE / 'dependencies.json').read_text()):
        name = dep['name'].split('/')[-1]
        archive = BUILD / f"{name}-{dep['version']}.tgz"
        if not archive.exists():
            with urllib.request.urlopen(dep['url']) as response:
                archive.write_bytes(response.read())
        data = archive.read_bytes()
        actual = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
        if actual != dep['integrity']:
            raise ValueError(f'Integrity mismatch: {archive}')
        target = BUILD / 'dependencies' / name
        target.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(data)) as bundle:
            bundle.extractall(target, filter='data')
        deps[name] = target / 'package'
    vendor = site / 'vendor'
    vendor.mkdir(parents=True, exist_ok=True)
    for wasm in (deps['jco-transpile'] / 'vendor').glob('js-component-bindgen-component.core*.wasm'):
        shutil.copy2(wasm, vendor / wasm.name)
    for name, package in deps.items():
        notices = vendor / 'licenses' / name
        notices.mkdir(parents=True, exist_ok=True)
        license_path = SOURCE / 'LICENSE-JCO' if name == 'jco' else package / 'LICENSE'
        shutil.copy2(license_path, notices / 'LICENSE')
        shutil.copy2(package / 'package.json', notices / 'upstream-package.json')
    shim = deps['preview2-shim']
    return [
        f"--alias:@bytecodealliance/jco/component={deps['jco']}/dist/browser.js",
        f"--alias:@bytecodealliance/jco-transpile/component={deps['jco-transpile']}/dist/component.js",
        f'--alias:@bytecodealliance/preview2-shim/instantiation={shim}/dist/common/instantiation.js',
        f'--alias:@bytecodealliance/preview2-shim/filesystem={shim}/dist/browser/filesystem.js',
        f'--alias:@bytecodealliance/preview2-shim={shim}/dist/browser/index.js',
    ]


def build(site=SITE):
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
        endpoint.port
    subprocess.run(['python3', str(ROOT / 'scripts/package-host.py'), 'clean', str(site)], check=True)
    site.mkdir(parents=True, exist_ok=True)
    (site / 'browser-environment.json').write_text(json.dumps({'corsProxy': proxy}) + '\n')
    host = ROOT / 'cmd/app/src'
    shutil.copytree(host, site, dirs_exist_ok=True, ignore=shutil.ignore_patterns('.DS_Store'))
    date_script = subprocess.check_output(
        ['python3', str(ROOT / 'scripts/build-date.py'), '--script'], text=True).strip()
    browser_html = (host / 'index.html').read_text().replace(
        'src="./app.js"', 'src="/browser-launch.js"').replace(
        '</head>', f'<script>{date_script}</script>\n</head>')
    (site / 'browser.html').write_text(browser_html)
    shutil.copy2(ROOT / 'promo/favicon.svg', site / 'favicon.svg')
    aliases = prepare_compiler(site)
    for source, output, extra in (
        ('browser-worker.ts', 'vendor/browser-worker.js', ['--external:node:*', '--external:/util/*', *aliases]),
        ('browser-transport.ts', 'browser-transport.js', ['--external:/core/*']),
        ('browser-launch.ts', 'browser-launch.js', ['--external:/app.js', '--external:/browser-transport.js', '--external:/core/*']),
        ('browser-menu.ts', 'core/menu/native.js', []),
    ):
        subprocess.run(['esbuild', str(SOURCE / source), '--bundle', '--format=esm',
                        '--platform=browser', '--target=es2022', f'--outfile={site / output}', *extra], check=True)
    shutil.copy2(SOURCE / 'browser-native.js', site / 'core/runtime/native.js')
    default_project = site / 'browser-default'
    default_project.mkdir()
    shutil.copy2(SOURCE / 'browser-default/gams.json', default_project / 'gams.json')
    for name in ('LICENSE', 'NOTICE'):
        shutil.copy2(ROOT / name, site / name)
    return aliases


if __name__ == '__main__':
    build()
