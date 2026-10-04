#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
fs_wasm="${1:?Usage: bash scripts/test-download-smoke.sh /absolute/path/to/prebuilt/plugin.fs.wasm}"
[[ -f "$fs_wasm" ]] || { echo "Missing prebuilt FS Unit: $fs_wasm" >&2; exit 1; }
staging="$(mktemp -d "${TMPDIR:-/tmp}/gams-download-smoke.XXXXXX")"
server_pid=""
cleanup() {
    if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; fi
    rm -rf "$staging"
}
trap cleanup EXIT
mkdir "$staging/units"
cp "$fs_wasm" "$staging/units/fs.wasm"
cp "$root/test/fixtures/download-view.js" "$staging/units/view.js"
python3 "$root/scripts/serve-project-units.py" "$staging/units" --port 0 --ready-file "$staging/ready" > "$staging/server.log" 2>&1 &
server_pid=$!
for attempt in {1..100}; do
    [[ -f "$staging/ready" ]] && break
    kill -0 "$server_pid" 2>/dev/null || { echo "Static server failed to start" >&2; exit 1; }
    sleep 0.05
done
[[ -f "$staging/ready" ]] || { echo "Static server startup timed out" >&2; exit 1; }
export GAMS_TEST_UNIT_BASE_URL
GAMS_TEST_UNIT_BASE_URL="$(python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())' "$staging/ready")"
cd "$root"
node --test test/*.test.mjs
# Run from the Host Nix shell; no sibling build is performed by this script.
make app-icons
cd cmd/app/src-tauri
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$root/build.nosync/app/target}"
cargo test prebuilt_fs_download_save_and_offline_reload_smoke --lib -- --ignored --nocapture
