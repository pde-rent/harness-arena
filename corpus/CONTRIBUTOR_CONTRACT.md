# Contract for authoring a corpus task (read this before writing anything)

Read `corpus/README.md` first — it is the authority. This file only restates the parts a new
task author gets wrong.

## Tooling rule

`bun` / `bunx` only for TypeScript. NEVER npm, npx, node. Python fixtures use `python3` and the
standard library only. Go fixtures use the Go standard library only, no modules beyond the
fixture's own `go.mod`.

## Layout you must produce

```
corpus/fixtures/<fixture>/       pristine, self-contained repo (only if you add a new fixture)
corpus/tasks/<id>/
  task.md        the prompt. Harness-neutral.
  meta.json      { id, category, fixture, difficulty, timeoutSeconds, description }
  setup.sh       chmod +x. `source ../../lib/task.sh` then `materialize <fixture>`
  verify.sh      chmod +x. exit 0 = solved.
  overlay/       optional files layered on the fixture by setup.sh   [SEEN by the agent]
  checks/        hidden tests, staged only at verify time            [NEVER seen by the agent]
  expected.json  optional exact answer for answer.json tasks
  solution/files/  reference solution tree, copied over WORKDIR by verify-all.sh only
```

`setup.sh` and `verify.sh` both start:

```bash
#!/usr/bin/env bash
set -uo pipefail          # setup.sh may use -euo
TASK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$TASK_DIR/../../lib/task.sh"
```

## Helpers available in `lib/task.sh`

Setup: `materialize <fixture>`.

Verify: `need_workdir`, `fail <msg>`, `restore_tests <fixture> [dir]`, `stage_checks`,
`run_suite` (bun test tests), `run_checks` (bun test bench_checks),
`run_py_suite [dir]` (unittest discover, pattern `*_test.py`),
`run_py_checks` (unittest discover in bench_checks, pattern `*_check.py`),
`check_answer <relpath> <expected.json>`, `assert_src_unchanged <fixture> [dir]`,
`assert_tree_unchanged <fixture> [extra-allowed-name ...]` (strict: whole tree byte-identical
to fixture+overlay, only `answer.json` may appear).

## Hard rules

1. **`task.md` is harness-neutral.** It names no tool, CLI, agent, model, vendor, editor or
   skill. No "run the tests with X". State goal, constraints, required artifact.
2. **Do not phrase requirements in terms of runtime-resolved values.** The corpus has a declared
   bias toward harnesses that execute code. Ask for values that are equally derivable by careful
   reading. "the delay sequence the policy produces" is fine; "the value as it exists at runtime"
   is not.
3. **Graders restore pristine tests before grading** (`restore_tests`) so an agent cannot pass by
   weakening assertions. Hidden checks are staged by `stage_checks` at verify time only and must
   never be materialized by `setup.sh`.
4. **Deterministic and offline.** No network, no wall clock, no randomness that is not seeded and
   injected. `verify.sh` must be re-runnable and give the same answer.
5. **A grader that passes on the untouched state is broken.** `./verify-all.sh <id>` must print
   `fail(ok)` untouched and `pass(ok)` with the reference solution. Both directions, every task.
6. **Reference solution is real.** `solution/files/` must contain a genuine working solution, not
   a stub that satisfies the checks by coincidence.
7. **Fast setup.** `setup.sh` well under a second. Fixtures are copied, never built or installed.
8. **Realistic `timeoutSeconds`** — roughly 4-6x what a competent engineer needs, in the
   480-1800 range.

## answer.json tasks

Graded by `lib/check-answer.ts`: key order ignored, array order ignored unless the key is listed
in the expected file's `"$ordered": [...]`, strings trimmed/case-folded, numbers exact, missing
key / extra key / wrong identifier = fail. So:

- Every checkable claim must be **exact and unambiguous**: an identifier as spelled in the
  source, a repository-relative path, an integer, a boolean, a closed-vocabulary enum whose
  permitted values `task.md` lists verbatim.
- Free prose belongs in a key the expected file does not contain — which would fail as an
  "unexpected key". So: put prose in a key the expected file **does** contain and whose value is
  compared, or do not ask for prose at all. The accepted pattern is a `notes` key that
  `verify.sh` deletes from the actual answer before comparing (see below), so the agent is asked
  to justify itself but the justification is unscored.

Unscored-prose pattern, in `verify.sh`:

```bash
python3 - "$WORKDIR/answer.json" <<'PY' || fail "answer.json is not valid JSON"
import json,sys
p=sys.argv[1]; d=json.load(open(p))
d.pop("notes",None)
json.dump(d,open(p,"w"))
PY
```

Never grade prose. Never require an LLM judge.
