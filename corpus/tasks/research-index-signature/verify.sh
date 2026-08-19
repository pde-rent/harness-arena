#!/usr/bin/env bash
set -uo pipefail
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
need_workdir
for d in cmd config geom httpapi index internal metrics service store tile; do
  assert_src_unchanged geosvc "$d"
done

python3 - "$WORKDIR/answer.json" <<'PY' || fail "answer.json is missing or not valid JSON"
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d.pop("notes",None)
json.dump(d,open(p,"w"))
PY

check_answer answer.json "$TASK_DIR/expected.json"
echo "VERIFY-PASS"
