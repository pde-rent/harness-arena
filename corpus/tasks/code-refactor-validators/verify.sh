#!/usr/bin/env bash
set -uo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
need_workdir
restore_tests pipeline
stage_checks
run_suite
run_checks

# Structural: the duplicated helper block must actually be gone. Counts
# non-blank, non-comment-only lines across every .ts file under src/validate.
MAX_LOC=280
[ -d "$WORKDIR/src/validate" ] || fail "src/validate/ is missing"
LOC="$(bun "$TASK_DIR/loc.ts" "$WORKDIR/src/validate")" \
  || fail "could not measure src/validate"
case "$LOC" in
  ''|*[!0-9]*) fail "line counter produced no number: $LOC" ;;
esac
[ "$LOC" -le "$MAX_LOC" ] \
  || fail "src/validate still carries duplicated code: $LOC code lines, budget is $MAX_LOC"

echo "VERIFY-PASS (src/validate: $LOC code lines)"
