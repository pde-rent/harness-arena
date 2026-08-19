#!/usr/bin/env bash
set -uo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
need_workdir
restore_tests numerics tests
run_py_suite
stage_checks
run_py_checks
echo "VERIFY-PASS"
