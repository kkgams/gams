#!/usr/bin/env python3
"""Render a reviewable native-license appendix from cargo-about JSON (offline)."""

import argparse
import hashlib
import json
from pathlib import Path
import tomllib


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def render(metadata: dict, lock_bytes: bytes) -> str:
    locked = {(p["name"], p["version"]) for p in tomllib.loads(lock_bytes.decode())["package"]}
    crates = sorted((c for c in metadata["crates"] if c["package"]["source"]),
                    key=lambda c: (c["package"]["name"], c["package"]["version"]))
    if len(crates) < 300:
        raise ValueError("Unexpectedly incomplete target-filtered Cargo dependency graph")
    by_crate: dict[str, list[tuple[str, str]]] = {}
    terms: dict[tuple[str, str], str] = {}
    for license_entry in metadata["licenses"]:
        ident = license_entry["id"]
        text = license_entry["text"]
        if not ident or not text.strip():
            raise ValueError("Missing license ID or license text")
        digest = sha(text.encode())
        terms[(ident, digest)] = text
        for used in license_entry["used_by"]:
            by_crate.setdefault(used["crate"]["id"], []).append((ident, digest))
    for crate in crates:
        p = crate["package"]
        if (p["name"], p["version"]) not in locked:
            raise ValueError(f"Cargo.lock missing {p['name']}@{p['version']}")
        if not by_crate.get(p["id"]):
            raise ValueError(f"No full license text for {p['name']}@{p['version']}")
        if crate["license"] in ("", "Unknown", None):
            raise ValueError(f"Unresolved license selection for {p['name']}@{p['version']}")
    lines = [
        "# Native Host dependency licenses (macOS Apple Silicon)", "",
        "Generated from the pinned `cmd/app/src-tauri/Cargo.lock` with cargo-about",
        "0.9.0 and `native-about.toml`, filtered to `aarch64-apple-darwin`.",
        "Conservatively includes runtime, build, proc-macro and dev dependencies;",
        "not all listed crates necessarily enter the app binary. It excludes the",
        "GAMS-authored root crate (governed by root `LICENSE`). Each selected",
        "license text below is from the crate package when available, otherwise",
        "cargo-about's SPDX text; exact per-crate notices are deduplicated only",
        "when their text bytes match. This inventory does not cover non-Cargo",
        "frontend, font, system-framework or separately downloaded game inputs.",
        "", f"Cargo.lock SHA-256: `{sha(lock_bytes)}`", "",
        f"Crates: **{len(crates)}**. Distinct full-text notices: **{len(terms)}**.", "", "## Included package index", "",
        "| Cargo crate | Selected expression | Full license text IDs |", "| --- | --- | --- |",
    ]
    for crate in crates:
        p = crate["package"]
        refs = sorted(set(by_crate[p["id"]]))
        refs_text = ", ".join(f"[{ident}](#license-{digest})" for ident, digest in refs)
        lines.append(f"| `{p['name']}@{p['version']}` | `{crate['license']}` | {refs_text} |")
    lines.extend(["", "## Full license texts", ""])
    for (ident, digest), text in sorted(terms.items()):
        lines.extend([f'<a id="license-{digest}"></a>', f"### {ident} — license-{digest}", "", text.rstrip(), ""])
    return "\n".join(lines).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", type=Path, required=True, help="cargo-about --format json result")
    parser.add_argument("--lock", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"Refusing to overwrite reviewed notice: {args.output}")
    args.output.write_text(render(json.loads(args.json.read_text()), args.lock.read_bytes()))


if __name__ == "__main__":
    main()
