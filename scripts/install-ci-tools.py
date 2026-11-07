#!/usr/bin/env python3
"""Install pinned upstream packaging binaries for native Windows/Linux CI."""

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import tarfile
from urllib.request import urlopen
import zipfile


TOOLS = {
    "x86_64-pc-windows-msvc": (
        ("https://github.com/tauri-apps/tauri/releases/download/tauri-cli-v2.11.0/cargo-tauri-x86_64-pc-windows-msvc.zip",
         "57277e38717568dccd93daf1fb90f00b97ee73d8ac9c2bd36e431bb7d023f8f0", "cargo-tauri.exe"),
        ("https://github.com/EmbarkStudios/cargo-about/releases/download/0.8.4/cargo-about-0.8.4-x86_64-pc-windows-msvc.tar.gz",
         "d5c38fb914bbad57c6a7d58c4847315bc3fe11efbe4fb51b3c515f997a56ceb7", "cargo-about.exe"),
    ),
    "x86_64-unknown-linux-gnu": (
        ("https://github.com/tauri-apps/tauri/releases/download/tauri-cli-v2.11.0/cargo-tauri-x86_64-unknown-linux-gnu.tgz",
         "3d5980f92fcd75eb41fcace01f0854e43144d00d4901ca1490afd4b01fbc63dc", "cargo-tauri"),
        ("https://github.com/EmbarkStudios/cargo-about/releases/download/0.8.4/cargo-about-0.8.4-x86_64-unknown-linux-musl.tar.gz",
         "c7381aa0cdc41fc0ee662cec8daa260da7817ad8ddea04cd4ddad425460adf14", "cargo-about"),
    ),
}


def download(url, digest, destination):
    with urlopen(url, timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise ValueError(f"SHA-256 mismatch for {url}")
    destination.write_bytes(data)


def binary(archive, name):
    # Read only the named executable; never extract archive-controlled paths.
    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as source:
            matches = [m for m in source.infolist()
                       if PurePosixPath(m.filename).name == name and not m.is_dir()]
            if len(matches) != 1:
                raise ValueError(f"Expected exactly one {name} in {archive}")
            return source.read(matches[0])
    with tarfile.open(archive) as source:
        matches = [m for m in source.getmembers()
                   if PurePosixPath(m.name).name == name and m.isfile()]
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one {name} in {archive}")
        with source.extractfile(matches[0]) as executable:
            return executable.read()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=TOOLS, required=True)
    args = parser.parse_args()
    github_path = Path(os.environ["GITHUB_PATH"])
    root = Path(__file__).resolve().parent.parent
    output = root / "build.nosync/ci-tools" / args.target
    output.mkdir(parents=True, exist_ok=True)
    for url, digest, name in TOOLS[args.target]:
        archive = output / url.rsplit("/", 1)[1]
        download(url, digest, archive)
        executable = output / name
        executable.write_bytes(binary(archive, name))
        executable.chmod(0o755)
    with github_path.open("a", encoding="utf-8") as paths:
        paths.write(f"{output}\n")


if __name__ == "__main__":
    main()
