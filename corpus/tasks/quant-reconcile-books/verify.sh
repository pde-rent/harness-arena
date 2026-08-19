#!/usr/bin/env bash
set -uo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
need_workdir
assert_src_unchanged ledger

[ -f "$WORKDIR/answer.json" ] || fail "required artifact answer.json was not written to the working directory"

# The free-prose key is required to be present but is never graded.
python3 - "$WORKDIR/answer.json" <<'PY' || fail "answer.json is not valid JSON"
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d.pop("notes",None)
json.dump(d,open(p,"w"))
PY

check_answer answer.json "$TASK_DIR/expected.json"
echo "VERIFY-PASS"
