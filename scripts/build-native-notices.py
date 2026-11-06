#!/usr/bin/env python3
"""Prepare target-specific license texts and the selected MPL crate sources."""

import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    output = args.output.resolve()
    output.parent.relative_to(root / "build.nosync")
    output.parent.mkdir(parents=True, exist_ok=True)
    metadata_path = output.parent / "about.json"
    subprocess.run([
        "cargo", "about", "generate", "--locked", "--format", "json",
        "--manifest-path", str(root / "cmd/app/src-tauri/Cargo.toml"),
        "--config", str(root / "native-about.toml"), "--target", args.target,
        "--output-file", str(metadata_path),
    ], check=True)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    spec = importlib.util.spec_from_file_location("native_notices", root / "scripts/generate-native-notices.py")
    renderer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(renderer)
    text = renderer.render(metadata, (root / "cmd/app/src-tauri/Cargo.lock").read_bytes(), args.target)
    source_dir = output.parent / "NATIVE-SOURCE"
    if source_dir.exists():
        shutil.rmtree(source_dir)
    source_dir.mkdir()
    mpl_ids = {
        used["crate"]["id"]
        for license_entry in metadata["licenses"] if license_entry["id"] == "MPL-2.0"
        for used in license_entry["used_by"]
    }
    archives = []
    for crate in metadata["crates"]:
        package = crate["package"]
        if package["id"] not in mpl_ids:
            continue
        if not package["source"].startswith("registry+"):
            raise ValueError(f"Provide the corresponding MPL source for {package['id']}")
        manifest = Path(package["manifest_path"])
        name = f"{package['name']}-{package['version']}.crate"
        archive = manifest.parents[3] / "cache" / manifest.parents[1].name / name
        shutil.copyfile(archive, source_dir / name)
        archives.append(name)
    (source_dir / "README.md").write_text(
        f"# MPL-covered sources for {args.target}\n\n"
        "Unmodified original Cargo registry source archives for the dependencies\n"
        "selected under MPL-2.0 in the accompanying NATIVE-NOTICES.md. Full terms\n"
        "are included there. Modified dependencies require their modified sources.\n\n"
        + "".join(f"- {name}\n" for name in sorted(archives)),
        encoding="utf-8",
    )
    temporary = output.with_suffix(".tmp")
    temporary.write_text(text, encoding="utf-8")
    temporary.replace(output)


if __name__ == "__main__":
    main()
