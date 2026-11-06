#!/usr/bin/env python3
"""Stage the native Host with its readable licenses; archive/checksum or safe clean."""

import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
PLATFORMS = {
    "aarch64-apple-darwin": "macos-aarch64",
    "x86_64-pc-windows-msvc": "windows-x86_64",
    "x86_64-unknown-linux-gnu": "linux-x86_64",
}

SCHEMA_FILES = {
    ROOT / "cmd/app/src-tauri/gen/schemas" / name
    for name in (
        "acl-manifests.json", "capabilities.json", "desktop-schema.json",
        "macOS-schema.json", "windows-schema.json", "linux-schema.json",
    )
}


def checked_output(path, *, allow_schema_files=False):
    """Output must stay inside this checkout, without traversing directory links."""
    path = Path(os.path.abspath(path))
    managed_output = path.is_relative_to(ROOT / "build.nosync") and path != ROOT / "build.nosync"
    if not managed_output and not (allow_schema_files and path in SCHEMA_FILES):
        raise ValueError(f"Not an approved generated output path: {path}")
    for parent in (path, *path.parents):
        if parent == ROOT:
            break
        if parent.is_symlink():
            raise ValueError(f"Refusing symlink output path: {parent}")
    return path


def copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / source, destination)


def notices(stage, native_notices):
    for name in ("LICENSE", "NOTICE"):
        copy(name, stage / name)
    shutil.copy2(native_notices, stage / "NATIVE-NOTICES.md")
    source_directory = Path(native_notices).parent / "NATIVE-SOURCE"
    source_readme = source_directory / "README.md"
    destination = stage / "NATIVE-SOURCE"
    destination.mkdir()
    shutil.copy2(source_readme, destination / "README.md")
    # The generated source offer lists every required original archive. Copy
    # those files individually so a missing archive cannot silently ship.
    for line in source_readme.read_text(encoding="utf-8").splitlines():
        if line.startswith("- "):
            name = line[2:]
            if Path(name).name != name or "\\" in name or not name.endswith(".crate"):
                raise ValueError(f"Invalid MPL source archive name: {name}")
            shutil.copy2(source_directory / name, destination / name)
    copy("cmd/app/src/fonts/PROVENANCE.md", stage / "FONT-PROVENANCE.md")
    for source in (ROOT / "cmd/app/src/fonts/licenses").glob("*.txt"):
        copy(source, stage / "FONT-LICENSES" / source.name)
    for name in ("GAME-ICONS-PROVENANCE.md", "game-icons.json"):
        copy(f"cmd/app/src/fonts/{name}", stage / "FONT-LICENSES" / name)
    for directory, pattern, destination in (
        ("cmd/app/src/util/licenses", "*.LICENSE", "ajv"),
        ("cmd/app/src/widgets/licenses", "*.LICENSE", "markdown-it"),
    ):
        for source in (ROOT / directory).glob(pattern):
            copy(source, stage / "BUNDLE-LICENSES" / destination / source.name)
    for source, destination in (
        ("cmd/app/src/widgets/markdown-it.LICENSE", "markdown-it/markdown-it.LICENSE"),
        ("cmd/app/src/util/aseprite.LICENSE", "aseprite-reference.LICENSE"),
        ("cmd/app/src/util/BUNDLE-REVIEW.md", "ajv/PROVENANCE.md"),
        ("cmd/app/src/widgets/BUNDLE-REVIEW.md", "markdown-it/PROVENANCE.md"),
    ):
        copy(source, stage / "BUNDLE-LICENSES" / destination)
    for name in ("LICENSE", "zlib-streams-ts.LICENSE", "PROVENANCE.md"):
        copy(f"cmd/app/src/util/vendor/zipjs/{name}", stage / "BUNDLE-LICENSES/zipjs" / name)


def package(args):
    platform = PLATFORMS[args.target]
    output = checked_output(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    binary = Path(args.binary).absolute()
    if not binary.exists():
        raise FileNotFoundError(f"Missing native build output: {binary}")
    if platform.startswith("linux"):
        # A Nix-linked ELF is not a portable system-runtime distribution.
        dynamic = subprocess.check_output(["readelf", "-l", "-d", str(binary)], text=True)
        if "/nix/store/" in dynamic:
            raise ValueError("Linux executable links to /nix/store; build against the supported system runtime before packaging")
    with tempfile.TemporaryDirectory(prefix="package-", dir=output.parent) as temporary:
        stage = Path(temporary) / "stage"
        stage.mkdir()
        if platform.startswith("macos"):
            subprocess.run(["/usr/bin/ditto", str(binary), str(stage / "GAMS.app")], check=True)
        else:
            shutil.copy2(binary, stage / ("gams.exe" if platform.startswith("windows") else "gams"))
        notices(stage, args.native_notices)
        runtime = {
            "macos-aarch64": "Requires macOS on Apple Silicon. GAMS.app is ad-hoc signed, not notarized or Developer ID signed. macOS Gatekeeper may block downloaded apps. No security settings are changed by this package.\n",
            "windows-x86_64": "Requires 64-bit Windows, Microsoft Edge WebView2 Runtime and Microsoft Visual C++ v14 x64 runtime. This archive is not an installer.\n",
            "linux-x86_64": "Requires x86_64 Linux with glibc, WebKitGTK 4.1, GTK 3 and the system libraries they depend on (Debian/Ubuntu: libwebkit2gtk-4.1-0 and libgtk-3-0). This archive does not bundle a Linux runtime.\n",
        }[platform]
        (stage / "README.txt").write_text(
            "GAMS desktop Host\n\n" + runtime + "\n"
            "Host only: no Project, gams.json or Project Units are included.\n"
            "Set GAMS_APP_CWD to an absolute Project directory containing gams.json.\n"
            "GAMS_CONFIG optionally selects a different config filename.\n"
            "On macOS, opening GAMS.app without GAMS_APP_CWD opens the Project picker.\n"
            "See LICENSE, NOTICE, FONT-LICENSES, BUNDLE-LICENSES, NATIVE-NOTICES.md and NATIVE-SOURCE.\n",
            encoding="utf-8",
        )
        archive = Path(temporary) / output.name
        if platform.startswith("macos"):
            subprocess.run(["/usr/bin/ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", "GAMS.app", str(archive)], cwd=stage, check=True)
            names = sorted(p.name for p in stage.iterdir() if p.name != "GAMS.app")
            subprocess.run(["zip", "-qr", str(archive), *names], cwd=stage, check=True)
        elif output.suffix == ".zip":
            with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
                for source in sorted(stage.rglob("*")):
                    if source.is_file():
                        bundle.write(source, source.relative_to(stage))
        else:
            with tarfile.open(archive, "w:gz") as bundle:
                for source in sorted(stage.iterdir()):
                    bundle.add(source, arcname=source.name)
        os.replace(archive, output)


def checksum(args):
    archive = Path(args.archive)
    output = checked_output(args.output)
    with archive.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    temporary = output.with_name(output.name + ".tmp")
    temporary.write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    os.replace(temporary, output)


def clean(args):
    paths = [checked_output(path, allow_schema_files=True) for path in args.paths]
    tracked = subprocess.check_output(["git", "-C", str(ROOT), "ls-files", "-z"]).decode().split("\0")
    for path in paths:
        if path in SCHEMA_FILES and path.exists() and not path.is_file():
            raise ValueError(f"Expected a generated schema file, not a directory or special file: {path}")
        relative = path.relative_to(ROOT).as_posix()
        if any(name == relative or name.startswith(relative + "/") for name in tracked):
            raise ValueError(f"Refusing to clean tracked path: {relative}")
    # shutil.rmtree never follows directory symlinks within the generated tree.
    for path in paths:
        if path.is_dir():
            shutil.rmtree(path)
        elif path.exists():
            path.unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    command = commands.add_parser("package")
    command.add_argument("--target", choices=PLATFORMS, required=True)
    command.add_argument("--binary", required=True)
    command.add_argument("--output", required=True)
    command.add_argument("--native-notices", required=True)
    command.set_defaults(run=package)
    command = commands.add_parser("checksum")
    command.add_argument("archive")
    command.add_argument("output")
    command.set_defaults(run=checksum)
    command = commands.add_parser("clean")
    command.add_argument("paths", nargs="+")
    command.set_defaults(run=clean)
    args = parser.parse_args()
    try:
        args.run(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
