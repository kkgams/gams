#!/usr/bin/env python3
"""Produce a conspicuously non-executable roadmap artifact for future Hosts."""

import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


def build(platform: str, destination: Path) -> None:
    if platform not in ("linux", "windows"):
        raise ValueError(f"unsupported roadmap platform: {platform}")
    if destination.exists():
        raise FileExistsError(f"refusing to replace existing roadmap: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    text = (f"GAMS {platform.title()} — NEXT TARGET, NOT A BUILD\n\n"
            "THIS ZIP CONTAINS NO EXECUTABLE, INSTALLER OR SUPPORTED RELEASE.\n"
            "The current Host build/release path targets macOS only.\n"
            "This separate job records that a native build, licensing review,\n"
            "installation smoke test and release design are still required.\n"
            "Users supply their own Project directory with gams.json and\n"
            "Project Unit paths; this archive contains no Project Units.\n")
    info = ZipInfo("README.txt", (2020, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    with ZipFile(destination, "x") as archive:
        archive.writestr(info, text)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("platform", choices=("linux", "windows"))
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    build(args.platform, args.destination)
