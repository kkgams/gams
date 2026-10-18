#!/usr/bin/env bash
# A matching tag approves the exact version commit; no branch/digest approval gate.
set -euo pipefail
[[ "${GITHUB_REPOSITORY:?}" == 'kkgams/gams' ]] || { echo 'Unexpected repository' >&2; exit 1; }
version="$(python3 - <<'PY'
import json, pathlib, re, tomllib
config = json.loads(pathlib.Path('cmd/app/src-tauri/tauri.conf.json').read_text())
cargo = tomllib.loads(pathlib.Path('cmd/app/src-tauri/Cargo.toml').read_text())
version = cargo['package']['version']
assert re.fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version), 'invalid Host version'
assert config['version'] == version, 'Tauri/Cargo version mismatch'
assert config['identifier'] == 'com.github.kkgams.gams', 'unexpected application identity'
print(version)
PY
)"
[[ "${GITHUB_EVENT_NAME:?}" == push && "${GITHUB_REF:?}" == "refs/tags/v$version" ]] || {
  echo 'Release requires a matching pushed version tag' >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "${GITHUB_SHA:?}" && "$(git rev-parse "refs/tags/v$version^{commit}")" == "$GITHUB_SHA" ]] || {
  echo 'Tag, checkout HEAD and workflow SHA must identify the same commit' >&2
  exit 1
}
bash scripts/check-licensing.sh
