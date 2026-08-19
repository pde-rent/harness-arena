#!/usr/bin/env bash
set -uo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
need_workdir
restore_tests pipeline

# The agent must have contributed at least one NEW test file of its own.
[ -d "$WORKDIR/tests" ] || fail "tests/ directory is missing"
pristine=$(cd "$CORPUS/fixtures/pipeline/tests" && find . -name '*.test.ts' | sort)
current=$(cd "$WORKDIR/tests" && find . -name '*.test.ts' | sort)
missing=$(comm -23 <(echo "$pristine") <(echo "$current"))
[ -z "$missing" ] || fail "existing test files were removed: $(echo $missing)"
added=$(comm -13 <(echo "$pristine") <(echo "$current"))
[ -n "$added" ] || fail "no new test file was added under tests/"

run_suite
stage_checks
run_checks
echo "VERIFY-PASS"
