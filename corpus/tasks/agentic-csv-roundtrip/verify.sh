#!/usr/bin/env bash
set -uo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
need_workdir
restore_tests ledger

# the agent must have contributed at least one test file of its own
pristine="$CORPUS/fixtures/ledger/tests"
new_tests=0
for f in "$WORKDIR"/tests/*.test.ts; do
  [ -e "$f" ] || continue
  [ -e "$pristine/$(basename "$f")" ] || new_tests=$((new_tests + 1))
done
[ "$new_tests" -ge 1 ] || fail "no new test file was added under tests/ for the new module"

run_suite
stage_checks
run_checks
echo "VERIFY-PASS"
