#!/usr/bin/env bash
set -uo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
need_workdir
restore_tests taskq
run_suite

[ -f "$WORKDIR/scripts/report.ts" ] || fail "scripts/report.ts was not created"

# A hand-written report.json must not be able to pass: delete it and regenerate
# it by actually running the agent's script.
rm -f "$WORKDIR/report.json"
( cd "$WORKDIR" && bun run scripts/report.ts ) || fail "bun run scripts/report.ts exited non-zero"

check_answer report.json "$TASK_DIR/expected.json"
echo "VERIFY-PASS"
