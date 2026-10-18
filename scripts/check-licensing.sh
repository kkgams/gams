#!/usr/bin/env bash
# License texts are approved by the version commit, not external digest variables.
# Linked third-party bytes remain bound by check-notice-evidence.py.
set -euo pipefail
for name in LICENSE NOTICE; do
  [[ -f "$name" && ! -L "$name" && -s "$name" ]] || {
    echo "Required nonempty regular license file: $name" >&2
    exit 1
  }
done
