#!/usr/bin/env python3
"""Assemble the static browser Host from canonical assets and verified build outputs.

Run the browser-jco experiment build first. No downloads, compilers or sibling
checkouts are used here; only build.nosync/web is replaced.
"""

import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import shutil
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[1]
MAX_ASSET_BYTES = 25 * 1024 * 1024
HOST_DIRECTORIES = ("core", "___", "util", "widgets", "css", "fonts")
HOST_REQUIRED = (
    "app.js", "___/services.js", "core/runtime.js", "core/menu.js",
    "css/reset.css", "css/base.css", "fonts/fonts.css",
    "util/vendor/zipjs/zip-native.js", "util/vendor/zipjs/LICENSE",
    "util/vendor/zipjs/zlib-streams-ts.LICENSE", "util/vendor/zipjs/PROVENANCE.md",
    "fonts/PROVENANCE.md", "fonts/GAME-ICONS-PROVENANCE.md", "fonts/game-icons.json",
)
RUNTIME_SUFFIXES = {".js", ".css", ".woff2"}
RUNTIME_DATA = {"fonts/game-icons.json"}
LEGAL_NAMES = {"LICENSE", "PROVENANCE.md", "GAME-ICONS-PROVENANCE.md"}
GENERATED = (
    "browser-launch.js", "browser-transport.js", "browser-environment.json",
    "core/runtime/native.js", "core/menu/native.js", "vendor/browser-worker.js",
    "vendor/js-component-bindgen-component.core.wasm",
    "vendor/js-component-bindgen-component.core2.wasm",
    "vendor/js-component-bindgen-component.core3.wasm",
    "vendor/js-component-bindgen-component.core4.wasm",
)
HEADERS = "/*\n  Cache-Control: no-store\n  X-Content-Type-Options: nosniff\n" + ''.join(
    f"\n/{name}\n  Content-Type: application/wasm\n"
    for name in GENERATED if name.endswith('.wasm')
)
NOT_FOUND = "<!doctype html>\n<html lang=\"en\"><meta charset=\"utf-8\"><title>Not found</title><h1>404 — Not found</h1></html>\n"


def regular_file(path):
    """Reject links in every path segment, special files and oversized assets."""
    for parent in (path, *path.parents):
        if parent.is_symlink():
            raise ValueError(f"Refusing symlink input/output path: {parent}")
    if not path.is_file():
        raise ValueError(f"Missing required regular file: {path}")
    if path.stat().st_size > MAX_ASSET_BYTES:
        raise ValueError(f"Asset exceeds 25 MiB: {path}")
    return path


def tree_files(directory):
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError(f"Missing required directory or symlink: {directory}")
    for path in sorted(directory.iterdir()):
        if path.is_symlink():
            raise ValueError(f"Refusing symlink input/output path: {path}")
        if path.is_dir():
            yield from tree_files(path)
        else:
            yield path


def guest_path(value):
    """Project resources must be local slash-separated paths, not URLs."""
    if not isinstance(value, str):
        raise ValueError(f"Expected same-origin Project asset path: {value!r}")
    path = PurePosixPath(value)
    if (not path.parts or path.is_absolute() or '..' in path.parts
            or any(character in value for character in '\\:?#')
            or path.as_posix() != value):
        raise ValueError(f"Unsafe Project asset path: {value!r}")
    return value


def asset_plan(root):
    host = root / "cmd/app/src"
    site = root / "build.nosync/browser-jco/site"
    experiment = root / "experiments/browser-jco"
    plan = {}

    def add(source, destination, digest=None):
        regular_file(source)
        if digest is not None and hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise ValueError(f"Release asset SHA-256 mismatch: {source}")
        plan[destination] = source

    for name in HOST_REQUIRED:
        add(host / name, name)
    for directory in HOST_DIRECTORIES:
        files = list(tree_files(host / directory))
        if not files:
            raise ValueError(f"Empty canonical Host asset directory: {directory}")
        for path in files:
            relative = path.relative_to(host)
            # Runtime code/data plus original license/provenance assets, not
            # review notes, dotfiles, source maps, tests or build configuration.
            legal = (path.name in LEGAL_NAMES or path.name.endswith('.LICENSE')
                     or ('licenses' in relative.parts and path.suffix == '.txt'))
            runtime = ((path.suffix in RUNTIME_SUFFIXES or relative.as_posix() in RUNTIME_DATA) and
                       not any(part.startswith('.') for part in relative.parts) and
                       not path.name.endswith('.test.js'))
            if runtime or legal:
                add(path, relative.as_posix())
    for name in GENERATED:
        add(site / name, name)
    add(site / "browser.html", "index.html")
    add(root / "promo/favicon.svg", "favicon.svg")
    for name in ("LICENSE", "NOTICE"):
        add(root / name, name)
    for dependency in ("jco", "jco-transpile", "preview2-shim"):
        for name in ("LICENSE", "upstream-package.json"):
            relative = f"vendor/licenses/{dependency}/{name}"
            add(site / relative, relative)

    config_path = site / "browser-default/gams.json"
    add(config_path, "browser-default/gams.json")
    config = json.loads(config_path.read_text(encoding="utf-8"))
    plugins = json.loads(regular_file(experiment / "plugins.json").read_text())
    units = json.loads(regular_file(experiment / "view-assets.json").read_text())
    plugin_pins = {}
    for plugin in plugins:
        repo = plugin['repository'].split('/')[-1]
        base = f"plugins/{repo}/{plugin['tag']}"
        plugin_pins[f"{base}/{repo}.wasm"] = (base, plugin['files'])
    for plugin in config['plugins']:
        path = guest_path(plugin['$file'])
        base, assets = plugin_pins[path]
        for asset in assets:
            relative = f"browser-default/{guest_path(base + '/' + asset['name'])}"
            add(site / relative, relative, asset['sha256'])

    archive_pins = {
        f"unit-sources/{unit['repository'].split('/')[-1]}/{unit['tag']}/{unit['archive']}": unit['sha256']
        for unit in units
    }
    for group in ('services', 'views'):
        for unit in config['ui'][group].values():
            resource = unit['url']['$file']
            path = guest_path(resource['url'])
            guest_path(resource['entry'])
            relative = f"browser-default/{path}"
            # Copy the entire original ZIP, including its original licenses.
            add(site / relative, relative, archive_pins[path])
    return plan


def assemble(root=ROOT):
    root = Path(root).absolute()
    plan = asset_plan(root)  # Validate all inputs before removing old output.
    output = root / "build.nosync/web"
    spec = importlib.util.spec_from_file_location("web_safe_clean", root / "scripts/package-host.py")
    cleaner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cleaner)
    cleaner.checked_output(output)
    if output.exists() and output.is_dir():
        # Refuse links inside an old publication too; never traverse them.
        list(tree_files(output))
    cleaner.clean(SimpleNamespace(paths=[output]))
    output.mkdir(parents=True)
    for destination, source in sorted(plan.items()):
        target = output / destination
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    (output / "_headers").write_text(HEADERS, encoding="utf-8")
    (output / "404.html").write_text(NOT_FOUND, encoding="utf-8")
    return output


if __name__ == "__main__":
    print(f"Assembled browser Host: {assemble()}")
