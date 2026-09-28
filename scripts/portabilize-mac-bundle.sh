#!/usr/bin/env bash
# Nix's Darwin stdenv links libiconv from /nix/store. Replace only that known
# macOS-system library reference, re-sign, then fail if *any* external path
# remains. Never ship a bundle requiring the build machine's Nix store.
set -euo pipefail
app="${1:?usage: portabilize-mac-bundle.sh /path/to/GAMS.app}"
binary="$app/Contents/MacOS/gams"
[[ -f "$binary" ]] || { echo "Missing bundled Host executable: $binary" >&2; exit 1; }
[[ "$(uname -s)-$(uname -m)" == Darwin-arm64 ]] || { echo 'Apple Silicon macOS required' >&2; exit 1; }
modified=0
while IFS= read -r dependency; do
  if [[ "$dependency" == /nix/store/*-libiconv-*/lib/libiconv.2.dylib ]]; then
    /usr/bin/install_name_tool -change "$dependency" /usr/lib/libiconv.2.dylib "$binary"
    modified=1
  fi
done < <(/usr/bin/otool -L "$binary" | awk 'NR > 1 {print $1}')
if (( modified )); then
  # install_name_tool invalidates the old signature. Preserve the minimum
  # Wasmtime JIT permissions required by hardened runtime when re-signing.
  entitlements=cmd/app/src-tauri/Entitlements.plist
  [[ -f "$entitlements" ]] || { echo "Missing Host JIT entitlements: $entitlements" >&2; exit 1; }
  /usr/bin/codesign --force --deep --sign - --options runtime --entitlements "$entitlements" "$app"
fi
bash scripts/check-mac-bundle.sh "$app"
