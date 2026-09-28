#!/usr/bin/env bash
set -euo pipefail
[[ -s LICENSE && -s NOTICE ]] || { echo 'Reviewed LICENSE and NOTICE are required' >&2; exit 1; }
for name in LICENSE NOTICE; do
  var="APPROVED_${name}_SHA256"
  expected="${!var:-}"
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || { echo "Missing/invalid $var" >&2; exit 1; }
  actual="$(shasum -a 256 "$name" | awk '{print $1}')"
  [[ "$expected" == "$actual" ]] || { echo "$name differs from reviewed digest" >&2; exit 1; }
done
