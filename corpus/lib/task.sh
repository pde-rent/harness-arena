#!/usr/bin/env bash
# Shared helpers sourced by every task's setup.sh / verify.sh.
# Requires: TASK_DIR set by the caller, WORKDIR exported by the runner.
set -uo pipefail

CORPUS="$(cd "$TASK_DIR/../.." && pwd)"
: "${WORKDIR:?WORKDIR must be set}"

# ---------- setup side ----------

# materialize <fixture-name>
# Wipes WORKDIR and lays down a pristine fixture copy plus the task overlay.
# Never copies solution/ or checks/.
materialize() {
  local fixture="$1"
  rm -rf "$WORKDIR"
  mkdir -p "$WORKDIR"
  cp -R "$CORPUS/fixtures/$fixture/." "$WORKDIR/"
  if [ -d "$TASK_DIR/overlay" ]; then
    cp -R "$TASK_DIR/overlay/." "$WORKDIR/"
  fi
  find "$WORKDIR" -name '.DS_Store' -delete 2>/dev/null
  echo "$fixture" > "$WORKDIR/.bench-fixture"
}

# ---------- verify side ----------

fail() { echo "VERIFY-FAIL: $*" >&2; exit 1; }

need_workdir() { [ -d "$WORKDIR" ] || fail "WORKDIR $WORKDIR does not exist"; }

# restore_tests <fixture-name> [dir]
# Overwrites the pristine test files back into WORKDIR so an agent cannot pass
# by weakening the existing suite. Agent-authored extra test files survive.
restore_tests() {
  local fixture="$1" dir="${2:-tests}"
  [ -d "$CORPUS/fixtures/$fixture/$dir" ] || return 0
  cp -R "$CORPUS/fixtures/$fixture/$dir/." "$WORKDIR/$dir/"
}

# stage_checks
# Copies the task's hidden check files into WORKDIR/bench_checks (fresh each run).
stage_checks() {
  rm -rf "$WORKDIR/bench_checks"
  [ -d "$TASK_DIR/checks" ] || return 0
  mkdir -p "$WORKDIR/bench_checks"
  cp -R "$TASK_DIR/checks/." "$WORKDIR/bench_checks/"
}

# run_suite [extra bun test args...] — the fixture's own tests must be green.
run_suite() {
  ( cd "$WORKDIR" && bun test tests "$@" ) || fail "fixture test suite did not pass"
}

# run_checks — the hidden graders must be green.
run_checks() {
  ( cd "$WORKDIR" && bun test bench_checks ) || fail "hidden behaviour checks did not pass"
}

# check_answer <relative artifact path> <expected json path>
check_answer() {
  local p="$WORKDIR/$1"
  [ -f "$p" ] || fail "required artifact $1 was not written to the working directory"
  bun "$CORPUS/lib/check-answer.ts" "$p" "$2" || fail "$1 does not match the expected answer"
}

# assert_src_unchanged <fixture-name> [dir]
# Research tasks are read-only: the source tree must come back untouched.
assert_src_unchanged() {
  local fixture="$1" dir="${2:-src}"
  diff -r "$CORPUS/fixtures/$fixture/$dir" "$WORKDIR/$dir" >/dev/null 2>&1 \
    || fail "$dir/ was modified; this task is read-only"
}

# ---------- polyglot + read-only helpers (added for the 2026-08 corpus extension) ----------

# run_py_suite [dir] — the fixture's own Python tests must be green (stdlib unittest only).
run_py_suite() {
  local dir="${1:-tests}"
  ( cd "$WORKDIR" && python3 -m unittest discover -s "$dir" -t . -p '*_test.py' ) \
    || fail "fixture test suite did not pass"
}

# run_py_checks — the hidden Python graders must be green.
run_py_checks() {
  ( cd "$WORKDIR" && python3 -m unittest discover -s bench_checks -t . -p '*_check.py' ) \
    || fail "hidden behaviour checks did not pass"
}

# pristine_ref <fixture-name>
# Echoes a temp dir holding exactly what setup.sh lays down (fixture + overlay), minus
# the bookkeeping file. Caller owns the directory.
pristine_ref() {
  local fixture="$1" tmp
  tmp="$(mktemp -d "${TMPDIR:-/tmp}/bench-ref.XXXXXX")"
  cp -R "$CORPUS/fixtures/$fixture/." "$tmp/"
  if [ -d "$TASK_DIR/overlay" ]; then cp -R "$TASK_DIR/overlay/." "$tmp/"; fi
  find "$tmp" -name '.DS_Store' -delete 2>/dev/null
  echo "$tmp"
}

# assert_tree_unchanged <fixture-name> [extra-allowed-name ...]
# Strict read-only guard: the whole working tree must be byte-identical to what setup.sh
# laid down, apart from answer.json, the bookkeeping file and the verifier's own scratch.
assert_tree_unchanged() {
  local fixture="$1"; shift
  local ref; ref="$(pristine_ref "$fixture")"
  local args=(-r -x answer.json -x .bench-fixture -x bench_checks -x '.DS_Store')
  local extra
  for extra in "$@"; do args+=(-x "$extra"); done
  if ! diff "${args[@]}" "$ref" "$WORKDIR" >/dev/null 2>&1; then
    echo "--- unexpected differences ---" >&2
    diff "${args[@]}" "$ref" "$WORKDIR" >&2 | head -40
    rm -rf "$ref"
    fail "the working tree was modified; this task is read-only and must produce only answer.json"
  fi
  rm -rf "$ref"
}
