#!/usr/bin/env bash
# Recheck exact Host identity and owner-reviewed repository licensing.
set -euo pipefail
[[ "${GITHUB_REPOSITORY:?}" == 'kkgams/gams' ]] || { echo 'Unexpected repository' >&2; exit 1; }
version="$(python3 - <<'PY'
import json, pathlib, re
config = json.loads(pathlib.Path('cmd/app/src-tauri/tauri.conf.json').read_text())
cargo = pathlib.Path('cmd/app/src-tauri/Cargo.toml').read_text()
package = re.search(r'(?ms)^\[package\]\n(.*?)(?=^\[|\Z)', cargo)
assert package, 'missing Cargo package'
version = re.search(r'(?m)^version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"\s*$', package[1])
assert version and config['version'] == version[1], 'Tauri/Cargo version mismatch'
assert config['identifier'] == 'com.github.kkgams.gams', 'unexpected application identity'
print(config['version'])
PY
)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid Host distribution version' >&2; exit 1; }
if [[ "$GITHUB_REF" == refs/tags/* ]]; then
  [[ "$GITHUB_EVENT_NAME" == push && "$GITHUB_REF" == "refs/tags/v$version" ]] || { echo 'Unexpected Host tag' >&2; exit 1; }
else
  [[ "$GITHUB_EVENT_NAME" == workflow_dispatch && "$GITHUB_REF" == refs/heads/release && "$GITHUB_REF_TYPE" == branch ]] || { echo 'Manual rehearsal requires release branch' >&2; exit 1; }
fi
bash scripts/check-licensing-digests.sh
