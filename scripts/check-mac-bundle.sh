#!/usr/bin/env bash
# A signed .app must be portable to Macs that have never installed Nix.
set -euo pipefail
app="${1:?usage: check-mac-bundle.sh /path/to/GAMS.app}"
binary="$app/Contents/MacOS/gams"
[[ -f "$binary" ]] || { echo "Missing bundled Host executable: $binary" >&2; exit 1; }
[[ "$(uname -s)-$(uname -m)" == Darwin-arm64 ]] || { echo 'Apple Silicon macOS required' >&2; exit 1; }
while IFS= read -r dependency; do
  case "$dependency" in
    /System/Library/*|/usr/lib/*) ;;
    *) echo "Non-system linked library in Host bundle: $dependency" >&2; exit 1 ;;
  esac
done < <(/usr/bin/otool -L "$binary" | awk 'NR > 1 {print $1}')
while IFS= read -r rpath; do
  case "$rpath" in
    /System/Library/*|/usr/lib/*|@executable_path/../Frameworks) ;;
    *) echo "Non-system runtime library search path: $rpath" >&2; exit 1 ;;
  esac
done < <(/usr/bin/otool -l "$binary" | awk '/cmd LC_RPATH/{getline; getline; print $2}')
/usr/bin/codesign --verify --strict --deep --verbose=1 "$app"
/usr/bin/codesign -dv --verbose=4 "$app" 2>&1 | grep -q '^Signature=adhoc$' || {
  echo 'Expected ad-hoc signature, not missing or Developer ID signing' >&2; exit 1;
}
for entitlement in com.apple.security.cs.allow-jit com.apple.security.cs.allow-unsigned-executable-memory; do
  key="${entitlement//./\\.}"
  value="$(/usr/bin/codesign -d --entitlements :- "$app" 2>/dev/null | /usr/bin/plutil -extract "$key" raw -)"
  [[ "$value" == true ]] || { echo "Missing Wasmtime JIT entitlement: $entitlement" >&2; exit 1; }
done
