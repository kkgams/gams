#!/usr/bin/env python3
"""Refuse native artifact staging after Cargo.lock changes without notice regeneration."""

import hashlib
from pathlib import Path
import re

lock = Path("cmd/app/src-tauri/Cargo.lock").read_bytes()
notice = Path("NATIVE-NOTICES.md").read_text()
digest = hashlib.sha256(lock).hexdigest()
if f"Cargo.lock SHA-256: `{digest}`" not in notice:
    raise SystemExit("Native notices were not reviewed against this Cargo.lock")
entries = re.findall(r"^\| `[\w.\-]+@[0-9][^`]*` \| `[^`]+` \| (.+) \|$", notice, re.M)
if len(entries) < 300:
    raise SystemExit("Native notice crate index is missing or incomplete")
refs = set(re.findall(r"\(#license-([0-9a-f]{64})\)", "\n".join(entries)))
anchors = set(re.findall(r"^### [^\n]+ — license-([0-9a-f]{64})$", notice, re.M))
if refs != anchors:
    raise SystemExit("Native notices contain unmatched or missing full license texts")
print(f"Native notices match Cargo.lock: {len(entries)} crates, {len(anchors)} texts")
