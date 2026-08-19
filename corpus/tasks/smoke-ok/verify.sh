#!/usr/bin/env bash
set -uo pipefail
: "${WORKDIR:?WORKDIR required}"
[ -d "$WORKDIR" ] || { echo "VERIFY-FAIL: no workdir"; exit 1; }
echo "VERIFY-PASS"
