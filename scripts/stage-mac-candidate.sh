#!/usr/bin/env bash
# Package only the built Host; never include a Project, example, or assembled Units.
set -euo pipefail
[[ "$(uname -s)" == Darwin ]] || { echo 'macOS runner required' >&2; exit 1; }
bash scripts/check-licensing-digests.sh
python3 scripts/check-native-notices.py
python3 scripts/check-mpl-source.py
python3 scripts/check-notice-evidence.py
version="$(python3 - <<'PY'
import json, pathlib, tomllib
config = json.loads(pathlib.Path('cmd/app/src-tauri/tauri.conf.json').read_text())
cargo = tomllib.loads(pathlib.Path('cmd/app/src-tauri/Cargo.toml').read_text())
assert config['version'] == cargo['package']['version'], 'Tauri/Cargo version mismatch'
assert config['identifier'] == 'com.github.kkgams.gams', 'unexpected application identity'
print(config['version'])
PY
)"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid Host version' >&2; exit 1; }
[[ "$(uname -m)" == arm64 ]] || { echo 'Apple Silicon runner required' >&2; exit 1; }
arch=aarch64
app="${CARGO_TARGET_DIR:-build.nosync/app/target}/release/bundle/macos/GAMS.app"
[[ -d "$app/Contents/MacOS" && -f "$app/Contents/Info.plist" ]] || { echo "Missing Host .app: $app" >&2; exit 1; }
bash scripts/check-mac-bundle.sh "$app"
output="dist/macos-$arch"
archive="$output/GAMS-$version-macos-$arch.zip"
[[ ! -e "$output" ]] || { echo "Refusing to reuse existing candidate staging: $output" >&2; exit 1; }
mkdir -p "$output/stage"
trap 'rm -rf "$output/stage"' EXIT
/usr/bin/ditto "$app" "$output/stage/GAMS.app"
cp LICENSE NOTICE NOTICE-EVIDENCE.sha256 "$output/stage/"
# Tauri embeds frontendDist in the executable; supply human-readable font
# terms and the pinned binary provenance as separate files beside the .app.
mkdir "$output/stage/FONT-LICENSES"
cp cmd/app/src/fonts/licenses/*.txt "$output/stage/FONT-LICENSES/"
cp cmd/app/src/fonts/PROVENANCE.md "$output/stage/FONT-PROVENANCE.md"
mkdir -p "$output/stage/BUNDLE-LICENSES/ajv" "$output/stage/BUNDLE-LICENSES/markdown-it"
cp cmd/app/src/util/licenses/*.LICENSE "$output/stage/BUNDLE-LICENSES/ajv/"
cp cmd/app/src/widgets/markdown-it.LICENSE cmd/app/src/widgets/licenses/*.LICENSE "$output/stage/BUNDLE-LICENSES/markdown-it/"
cp cmd/app/src/util/aseprite.LICENSE "$output/stage/BUNDLE-LICENSES/aseprite-reference.LICENSE"
cp cmd/app/src/util/BUNDLE-REVIEW.md "$output/stage/BUNDLE-LICENSES/ajv/PROVENANCE.md"
cp cmd/app/src/widgets/BUNDLE-REVIEW.md "$output/stage/BUNDLE-LICENSES/markdown-it/PROVENANCE.md"
cp NATIVE-NOTICES.md "$output/stage/"
cp -R NATIVE-SOURCE "$output/stage/"
cat >"$output/stage/README.txt" <<'EOF'
GAMS desktop Host for macOS — PRE-RELEASE CANDIDATE

This archive contains the desktop Host only. It does not include an example,
a Project, Project Units, or a default gams.json. Supply an existing Project folder whose
gams.json refers to Project Units already installed on this machine. Launch
from that folder with GAMS_APP_CWD pointing at its absolute path if needed.
After copying GAMS.app to /Applications, a terminal launch example is:

  GAMS_APP_CWD=/absolute/path/to/your-project /Applications/GAMS.app/Contents/MacOS/gams

Finder launch does not select a Project automatically. Confirm that the paths
in that Project's gams.json are accessible before starting the Host.

This is an ad-hoc signed (not Developer ID signed or notarized) build. An
ad-hoc signature lets Apple Silicon launch locally but proves no publisher
identity; macOS Gatekeeper may warn or refuse internet-downloaded builds.
Verify the separately downloaded SHA256SUMS-macos-aarch64, source provenance,
LICENSE/NOTICE, FONT-LICENSES/FONT-PROVENANCE.md, BUNDLE-LICENSES/
NATIVE-NOTICES.md and NATIVE-SOURCE/ before deciding whether to run it. If Gatekeeper blocks
this verified app, "xattr -dr com.apple.quarantine /Applications/GAMS.app"
removes quarantine from this app only. This bypasses the download check; do
it only if you trust this release and accept the risk. It does not add a
Developer ID signature or notarization. Never disable system-wide security
protections.
EOF
(cd "$output/stage" && /usr/bin/ditto -c -k --sequesterRsrc --keepParent GAMS.app "../$(basename "$archive")" && zip -qr "../$(basename "$archive")" README.txt LICENSE NOTICE NOTICE-EVIDENCE.sha256 FONT-PROVENANCE.md FONT-LICENSES BUNDLE-LICENSES NATIVE-NOTICES.md NATIVE-SOURCE)
(cd "$output" && shasum -a 256 "$(basename "$archive")" > "SHA256SUMS-macos-$arch" && shasum -a 256 --check "SHA256SUMS-macos-$arch")
python3 scripts/check-candidate-notices.py "$archive"
