#!/usr/bin/env bash
# Proves every grader is real: it must FAIL on the untouched starting state
# and PASS once the reference solution is applied.
#
# Usage: ./verify-all.sh [task-id ...]
set -uo pipefail

CORPUS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRATCH="${BENCH_SCRATCH:-/tmp/bench-harnesses/.verify-all}"
mkdir -p "$SCRATCH"

if [ "$#" -gt 0 ]; then
  TASKS=("$@")
else
  TASKS=()
  while IFS= read -r d; do TASKS+=("$(basename "$d")"); done < <(find "$CORPUS/tasks" -mindepth 1 -maxdepth 1 -type d | sort)
fi

FAILED=0
ROWS=()

for id in "${TASKS[@]}"; do
  TDIR="$CORPUS/tasks/$id"
  WORKDIR="$SCRATCH/$id"
  export WORKDIR

  # The fixed-overhead control ("smoke" category) is deliberately ungraded: it passes on an
  # empty workdir by design, so it is not an admissible task and is not checked here.
  if [ "$#" -eq 0 ] && grep -q '"category"[[:space:]]*:[[:space:]]*"smoke"' "$TDIR/meta.json" 2>/dev/null; then
    ROWS+=("$id|n/a|n/a|control, not a graded task")
    continue
  fi

  if [ ! -x "$TDIR/setup.sh" ] || [ ! -x "$TDIR/verify.sh" ]; then
    ROWS+=("$id|MISSING|MISSING|no setup.sh/verify.sh")
    FAILED=1
    continue
  fi

  # --- direction 1: untouched starting state must NOT verify ---
  if ! "$TDIR/setup.sh" >"$SCRATCH/$id.setup.log" 2>&1; then
    ROWS+=("$id|SETUP-ERR|-|see $SCRATCH/$id.setup.log")
    FAILED=1
    continue
  fi
  before_start=$(date +%s)
  "$TDIR/verify.sh" >"$SCRATCH/$id.before.log" 2>&1
  before_rc=$?
  if [ "$before_rc" -eq 0 ]; then before="LEAK(pass)"; FAILED=1; else before="fail(ok)"; fi

  # --- direction 2: reference solution must verify ---
  if [ -x "$TDIR/solution/apply.sh" ]; then
    "$TDIR/solution/apply.sh" >>"$SCRATCH/$id.setup.log" 2>&1 || true
  fi
  if [ -d "$TDIR/solution/files" ]; then
    cp -R "$TDIR/solution/files/." "$WORKDIR/"
  fi
  after_start=$(date +%s)
  "$TDIR/verify.sh" >"$SCRATCH/$id.after.log" 2>&1
  after_rc=$?
  after_end=$(date +%s)
  if [ "$after_rc" -eq 0 ]; then after="pass(ok)"; else after="BROKEN(fail)"; FAILED=1; fi

  ROWS+=("$id|$before|$after|$(( after_start - before_start ))s/$(( after_end - after_start ))s")
done

printf '\n%-26s %-12s %-14s %s\n' "TASK" "UNTOUCHED" "WITH-SOLUTION" "verify time before/after"
printf '%s\n' "--------------------------------------------------------------------------------"
for r in "${ROWS[@]}"; do
  IFS='|' read -r a b c d <<<"$r"
  printf '%-26s %-12s %-14s %s\n' "$a" "$b" "$c" "$d"
done
echo

if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: FAILED (a grader leaked or a reference solution did not satisfy it)"
  exit 1
fi
echo "RESULT: OK — all graders fail before, pass after"
