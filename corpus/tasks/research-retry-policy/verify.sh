#!/usr/bin/env bash
set -uo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
need_workdir
assert_src_unchanged pipeline
check_answer answer.json "$TASK_DIR/expected.json"
echo "VERIFY-PASS"
