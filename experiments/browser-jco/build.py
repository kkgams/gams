"""Assemble static assets only. Never execute Jco or transpile a component."""
import base64
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "experiments/browser-jco"
BUILD = ROOT / "build.nosync/browser-jco"
SITE = BUILD / "site"


def build():
    SITE.mkdir(parents=True, exist_ok=True)
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
    subprocess.run([
        "esbuild", str(SOURCE / "transpiler-worker.ts"), "--bundle", "--format=esm",
        "--platform=browser", "--target=es2022", "--external:node:*",
        f"--outfile={vendor}/transpiler-worker.js", *aliases,
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


if __name__ == '__main__':
    build()
