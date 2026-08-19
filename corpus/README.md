# Agent benchmark corpus

24 graded tasks used to compare coding agents head to head on **tokens-to-goal** and
**wall-time-to-goal at equal quality**, plus one ungraded fixed-overhead control (`smoke-ok`).

Quality is held constant by construction: every task has a **deterministic, agent-independent
grader**. No LLM judge, no human reading. A run either satisfies `verify.sh` or it does not.

## Layout

```
corpus/
  fixtures/<name>/           pristine, self-contained TypeScript repos (bun test, zero deps)
  CONTRIBUTOR_CONTRACT.md    the rules a new task must satisfy (read before adding one)
  lib/task.sh                shell helpers sourced by every setup.sh / verify.sh
  lib/check-answer.ts        deterministic JSON answer comparator for answer.json tasks
  tasks/<id>/
    task.md                  the prompt, handed VERBATIM and IDENTICALLY to every agent
    setup.sh                 materialize a clean working copy into $WORKDIR
    verify.sh                exit 0 = solved, non-zero = not solved
    meta.json                { id, category, difficulty, timeoutSeconds, description }
    overlay/                 optional: files layered over the fixture (e.g. a seeded bug)  [given to the agent]
    checks/                  optional: hidden behaviour tests, staged only at verify time  [NEVER given to the agent]
    solution/files/          reference solution, used ONLY by verify-all.sh                [NEVER given to the agent]
    solution/apply.sh        optional: reference steps that are not plain file copies
  verify-all.sh              proves each grader fails before the work and passes after
```

## Runner contract

The runner owns process spawning, token accounting and the proxy. Per task it must:

1. `export WORKDIR=<fresh empty path>` and run `tasks/<id>/setup.sh`.
2. Hand the agent **the exact bytes of `task.md`** as its prompt, with its cwd set to `$WORKDIR`.
   Nothing else. No extra system prompt about the task, no hints, no tool suggestions.
3. Kill the agent at `meta.json.timeoutSeconds`.
4. Run `tasks/<id>/verify.sh` with the same `WORKDIR`. Exit code is the result.

Guarantees the runner can rely on:

- `setup.sh` is idempotent (it wipes and re-materializes `$WORKDIR`) and finishes in well under a second.
- `verify.sh` needs no network, no clock, no model, and is safe to run repeatedly.
- Nothing under `solution/` or `checks/` is ever materialized into `$WORKDIR` by `setup.sh`.
- `$WORKDIR/bench_checks/` is created (and overwritten) by `verify.sh` only; agents never see it.
- Read-only tasks are enforced by `assert_src_unchanged` (source tree only) or, for the two
  strict ones, `assert_tree_unchanged` (whole tree, `answer.json` the only permitted addition).
- `$WORKDIR/.bench-fixture` records which fixture was used.

## Grading rules these tasks follow

- **Behaviour, not source text.** Graders run tests. Source grepping is only ever used as a
  secondary structural constraint (e.g. "this duplicated block must not appear three times"),
  never as the primary signal.
- **Tamper-proof.** `verify.sh` restores the fixture's pristine `tests/` before running, so an
  agent cannot pass by deleting or weakening an assertion. Agent-authored *new* test files survive.
- **Hidden checks.** Tasks with a spec are graded by tests the agent never sees, staged into
  `$WORKDIR/bench_checks/` at verify time. This kills solutions that special-case the visible test.
- **Exact artifacts.** Research tasks are graded by comparing `answer.json` against a stored
  expected answer with `lib/check-answer.ts`: key order and array order are ignored, strings are
  trimmed/case-folded, everything else is strict (missing key, extra key, wrong identifier = fail).
- **Harness-neutral prompts.** `task.md` never names a tool, CLI, skill, MCP server or agent
  feature. It states the goal, the constraints, and the required artifact.
- **Unscored prose.** Judgement tasks ask for a `notes` key so the answer has to justify itself,
  and `verify.sh` deletes that key before comparing. Prose is never graded and no task anywhere
  in the corpus needs a model to grade it.

## The original 12 tasks

| id | category | fixture | what it tests | timeout |
|---|---|---|---|---|
| `code-diagnose-boundary` | coding | ledger | An off-by-one in the zero-padding of the money formatter drops the leading zero for sub-unit amounts; no existing test catches it and the symptom is reported from a downstream consumer, so the root cause must be traced from the CSV export back into the formatter. | 900s |
| `code-feature-cancel` | coding | taskq | The task queue ships a "cancelled" TaskState that no code path ever produces; implement Scheduler.cancel(id) to spec, including the transitive cascade onto dependents, the no-op states, the drain/ready-order guarantees, snapshot round-tripping and silence on the plugin hooks. | 1200s |
| `code-fix-failing-test` | coding | ledger | A seeded defect in the money allocation routine makes four existing tests fail; fix the production code without touching the tests. | 600s |
| `code-refactor-validators` | coding | pipeline | The three validator modules under src/validate each carry their own near-identical copy of the same issue-construction, field-lookup and measurement helpers; the copies must be consolidated into one shared implementation with no behaviour change, the existing suite green and the public API of src/validate/index.ts untouched. | 900s |
| `research-audit-handler` | research | pipeline | Trace which function ultimately handles an audit event through a multi-hop dispatch chain and report the chain plus the store namespaces it writes, as answer.json. | 600s |
| `research-delete-graph` | research | taskq | Determine the blast radius of deleting src/graph.ts: direct importers, imported symbols, and which test files would fail, as answer.json. | 600s |
| `research-retry-callsites` | research | pipeline | Enumerate every withRetry call site across the source tree and identify which ones bypass metrics reporting, as answer.json. | 600s |
| `research-retry-policy` | research | pipeline | Locate the retry policy definition, report its parameters, the exact backoff delay sequence it produces including clamping, and which policy the alert path uses, as answer.json. | 480s |
| `agentic-csv-roundtrip` | agentic | ledger | The library writes CSV but cannot read it back. Build a new RFC4180-style parser module that inverts the existing writer (quoting, embedded delimiters and newlines, empty fields, custom delimiter, LF and CRLF, LedgerError rejection of malformed input), a typed journal-CSV reader on top of it, wire both into the public index, and add new tests — a multi-step new-module-plus-wiring task graded by hidden behaviour checks. | 1200s |
| `agentic-dedupe-module` | agentic | pipeline | Multi-step build: author a dependency-free bounded duplicate-id window module to an exact spec, wire it into runPipeline/runPipelineBatch through the existing dependency-injection shape so redelivered ids are suppressed without breaking any existing behaviour, and add a new test file covering it. | 1200s |
| `agentic-multifile-fix` | agentic | pipeline | Event id canonicalisation (trim + upper case) is implemented three different ways in three different files: the parser trims but does not upper-case, the identity validator upper-cases but does not trim, and the transform step does neither. A padded or lower-case id is therefore parsed, validated and stored under three spellings. The existing suite is green, so the agent must find every site; fixing one file still fails the hidden checks. | 1200s |
| `agentic-script-report` | agentic | taskq | Write scripts/report.ts that drives the scheduler through a fully specified deterministic scenario (retries, backoff jitter, dependency chain, cascading failure, plugin hooks, snapshot round-trip) and writes report.json; graded by running the script and comparing the artifact. | 1200s |

## The 9 tasks added in the bias-correction extension

The original 12 were all zero-dependency TypeScript on Bun — the single environment where a
persistent JavaScript REPL is natively privileged, and the environment the benchmark's own author
builds a harness for. These 9 are the correction. Three categories were added: `algorithmic`
(real mathematical difficulty), `qualitative` (judgement and explanation, still graded
deterministically), and `quantitative` (chained numeric derivation where an early error
propagates).

| id | category | language | what it tests | timeout | why it is not REPL-biased |
|---|---|---|---|---|---|
| `algo-stable-stats` | algorithmic | Python | Kahan-Babuska-Neumaier compensated summation that is order-independent and exact on catastrophically cancelling input with a specified NaN/infinity classification; Welford/Chan streaming moments with an associative parallel merge that survives 1e9-shifted samples; exact-rational quantiles across five interpolation rules plus a weighted variant. Graded by known-answer vectors, `Fraction`-exact references computed inside the check, permutation invariance and merge associativity. | 1800s | A JavaScript REPL cannot import Python. The difficulty is numerical analysis, not observation: running a wrong implementation tells you nothing that the spec did not already say. |
| `algo-exact-dp-allocate` | algorithmic | Python | Hamilton apportionment with a three-key remainder/quota/index tie-break, and minimum-penalty placement over arbitrary per-bucket penalty rows where the greedy exchange argument holds only under discrete convexity — non-convex rows force a DP whose reconstruction must run forward to give the lexicographically smallest optimum. Exact `Fraction` arithmetic, brute-force cross-check inside the grader. | 1800s | Same: not TypeScript, and the trap (greedy silently losing on non-convex input) is recognised by reasoning about the invariant, not by watching output. |
| `algo-wave-schedule` | algorithmic | TypeScript | SCC condensation so cycles and self-loops are legal input, longest-path level assignment (not breadth-first layering), and first-fit capacity packing where deferral cascades downstream and backfilling an earlier wave is mandatory. O(V+E) enforced by a 40k-node scale check. | 1800s | In the biased language on purpose, as a control. Nothing is runtime-only: every expected value is stated by the spec, and the difficulty is the algorithm. |
| `qual-risk-review` | qualitative | TypeScript, read-only | Assess an unapplied proposal held as modified copies under `proposed/`: find which changed handler carries a real defect (a memoised retry promise that caches a failure forever), classify it from a closed vocabulary, name the affected event kinds, confirm the existing suite does not catch it, point at the sibling file that gets the same idea right, and name the numbered claim in `PROPOSAL.md` that the defect falsifies. | 1000s | The proposal is never applied, so there is nothing to run. The visible suite passes with it applied — that is the premise. Reading two files side by side is the only route. |
| `qual-choose-cache` | qualitative | Go, read-only | Two implementations of one cache interface in a 7.5k-line Go service; one leaks a map entry on every probation eviction while `Len()` and `Bytes()` stay correct, so nothing observable is wrong. Recommend which to keep, locate the defect to the method, classify it, derive the insertion count that first triggers it from stated constants, and list every non-test file constructing the rejected one. | 1200s | **The deliberately hostile control.** Not TypeScript, graded without ever invoking `go`, and the defect is invisible to every observable the code exposes. Executing it teaches you nothing; reading `evictProbation` next to `evictOldest` teaches you everything. |
| `qual-spec-conflict` | qualitative | TypeScript, read-only | Judge a seven-requirement spec against the ledger's invariants and establish it is *unsatisfiable*: name the contradictory pair, the function and error code that make them irreconcilable, which of the two must be relaxed, and partition all seven into implementable and blocked. | 1200s | The one task whose correct answer is "this cannot be built". There is no artifact to execute, and the conflict is proved from the source, not observed. |
| `quant-capacity-plan` | quantitative | Python, read-only | Nine dependent derivations: peak events/s from per-hour rates of the billable fleet only, average payload, post-compression throughput, batch fill under a `>=` threshold in KiB, batches/s, shards under two ceilings one of which is MiB/s, an inclusive retention window and replicated hot-tier bytes, the tiered invoice after a free allowance, and the largest retention still inside budget — with an environment TOML silently overriding four defaults. | 1200s | Every input is a committed file. Running the package reproduces the plan only if you already picked the right config, fleet, units and boundary rules; the traps are read, not observed. |
| `quant-index-sizing` | quantitative | Go, read-only | Eight dependent steps over `geosvc`: tiles covering the default region at the default zoom, features indexed, packed R-tree leaf and total node counts from the branching constant, resident bytes from documented per-feature and per-node sizes, cache capacity from the configured budget, and the hit rate and backing-read rate implied by a committed workload file. | 1200s | Non-TypeScript, read-only, and no Go toolchain is assumed. The numbers come from doc comments, defaults and a JSON file. |
| `quant-reconcile-books` | quantitative | TypeScript, read-only | Reconcile two committed exports of one quarter against a prose policy that defines its rounding, currency-exponent and sign semantics *by naming functions in `src/`*. Nine chained keys through traps: a fixed UTC+05:30 fiscal boundary with rows on both edges, an orphan reversal, a repeated id, a half-to-even case that decides materiality, and a currency disagreement. | 1200s | Read-only, artifact-only. A REPL can total a CSV, but every trap is a policy-reading decision made before any arithmetic — and getting one wrong propagates to the headline number. |

Coverage against the corrections that were asked for:

- **Not TypeScript:** 5 of 9 (`algo-stable-stats`, `algo-exact-dp-allocate`, `quant-capacity-plan`
  in Python; `qual-choose-cache`, `quant-index-sizing` in Go). Required: 3.
- **Read-only, artifact-only:** 6 of 9. Two of them (`qual-choose-cache`, `quant-capacity-plan`)
  use the strict `assert_tree_unchanged` guard — the whole tree must come back byte-identical and
  the only new file may be `answer.json`. The other four use `assert_src_unchanged`, which is
  laxer on purpose: a strict guard punishes harnesses whose idiom is "edit, observe, revert", and
  that is a capability difference, not a correctness one. Required: 2.
- **Hostile to code execution:** `qual-choose-cache`, with `qual-spec-conflict` and
  `qual-risk-review` close behind. Required: 1.
- **Larger fixture:** `geosvc` at 7487 lines across 53 files and 11 packages, 3-4x the original
  fixtures. Required: 1.


## The 3 tasks added in the indexing study

The corpus had six fixtures and no navigation task on the largest one. `geosvc` — 7487 lines,
53 files, 11 packages — carried only sizing and defect-reading tasks, so nothing in the corpus
measured what happens when the answer is a property of the *whole call graph* rather than of one
file. These three close that gap. They exist to settle one question: **does a codebase index or
repo map pay for itself, or does grep-on-demand win?**

All three are read-only, artifact-only, graded by exact `answer.json` comparison with no Go
toolchain and no model in the loop. All three are answerable without any index, by careful
reading — that is the point. An index should make them *cheaper*, not possible.

| id | difficulty | what it asks | why grep alone handles it poorly | what an index gives | timeout |
|---|---|---|---|---|---|
| `research-reach-encode` | hard | Whole-graph backward reachability: every function that can transitively reach `store.EncodeFeature` under a stated edge model, the packages they live in, and the cut vertices on the paths from the HTTP feature route to that sink. | `EncodeFeature` has exactly **one** textual call site, so the answer is invisible to string matching and has to be chained backwards eight hops. Two of those hops go through interfaces — `dst.Insert` in `store.CopyFeatures` and `Backend.Put`/`Backend.Delete` in the handlers — where the call text never names the callee's type. The decoys (`MemStore.Load`, `Compact`, `SetWAL`, `OpenLog`, `cmd/geosvcd/run` registering handlers as values) sit textually closer to the sink than the real answers. The cut-vertex half is not a search at all. | The call graph directly, including interface dispatch resolved to implementing types; the cut question becomes a graph query instead of a hand-run transitive closure. | 900s |
| `research-validate-sites` | medium | Enclosing-scope attribution: for all eight call sites of a method named `Validate` across five packages, the enclosing function, which of the three same-named `Validate` methods is actually invoked, whether the error is propagated unchanged, and which exported `MemStore` mutator delegates validation instead of performing it. | Grep returns the eight lines instantly and then stops being useful: it says nothing about which function encloses each line, and the three distinct `Validate` methods are textually identical at the call site, so the receiver's type must be traced back through struct fields and parameter declarations. A looser search also drags in the five unexported `config` `validate` methods that are out of scope. | Enclosing scope and the resolved callee per call site — a lookup instead of eight manual type traces. | 720s |
| `research-index-signature` | hard | Cross-package impact: given a proposed `error` return added to two `index.Index` methods, every declaration that stops compiling, separately every function that keeps compiling untouched while silently dropping the new error, and the packages involved. | Searching `Remove` returns thirteen non-test lines, nine of them `container/list` calls in three unrelated cache files; searching `Search` returns `store.MemStore.Search`. Neither search distinguishes a call whose results are bound (a compile error) from a bare call statement (still legal, silently lossy), nor follows the propagation one hop further into `index.SearchFiltered` and from there into `service.Service.Query`. | Each selector resolved to its declaring type, plus the callers of the interface methods — which is the entire task. | 900s |

The hypothesis these three test: if an index helps, its advantage should show up here and nowhere
else, because these are the only tasks in the corpus whose answer is a property of the call graph.
If grep-on-demand matches an indexed harness on all three, the index is not paying for itself.

Fairness notes, checked against `spec/fairness.md`:

- No requirement is phrased in terms of a runtime-observed value. Every answer is fixed by the
  source as committed; nothing has to be executed, and executing the service would not reveal any
  of it. The corpus's declared count of runtime-value-phrased tasks stays at 1.
- Nothing rewards a code-execution harness in particular. Writing a throwaway parser to answer
  them is a legitimate strategy and is available to every competitor equally — which is exactly
  what the experiment wants to measure against a pre-built index.
- Difficulty scales with the fixture: the work is proportional to how much of an 11-package
  service you have to hold in view at once, not to counting anything.
- Each `task.md` names no tool, CLI, agent, model or vendor, and is handed to every harness byte
  for byte.


## Fixtures

Self-contained TypeScript, run with `bun test`, no dependencies, no network, no build step, and
deterministic (clocks and RNGs are injected).

| fixture | language | files | total LOC | domain |
|---|---|---|---|---|
| `pipeline` | TypeScript (bun) | 25 | 2114 | event ingestion: parse -> validate -> transform -> registry -> handlers, with retry/backoff and metrics |
| `ledger` | TypeScript (bun) | 20 | 2000 | double-entry accounting: money/allocation, accounts, journal, balances, comparators, pagination, CSV |
| `taskq` | TypeScript (bun) | 19 | 2378 | in-memory task queue: dependency graph, priorities, store, plugins, backoff, scheduler, snapshots |
| `numerics` | Python 3.11 (stdlib) | 17 | 1788 | telemetry statistics: compensated summation, streaming moments, exact-rational quantiles, histograms, intervals, apportionment, decimal rounding |
| `capacity` | Python 3.11 (stdlib) | 18 | 918 | metrics-ingest capacity planner: config layering over committed environment TOML, measured per-hour rates, batching, sharding, retention, tiered pricing |
| `geosvc` | Go (stdlib) | 53 | 7487 | geospatial tile/feature service: geometry, slippy-map tiles, R-tree and grid indexes, two competing cache implementations, store + WAL, HTTP API |

Every `setup.sh` is a file copy; the whole corpus materializes in well under a second. The three
TypeScript fixtures are small enough that a research question is a reading exercise rather than a
search problem; `geosvc` is deliberately far larger so context management is actually exercised.

### Toolchain the graders need

| fixture | needed to solve | needed by `verify.sh` |
|---|---|---|
| `pipeline`, `ledger`, `taskq` | `bun` | `bun` |
| `numerics` | `python3` >= 3.11 | `python3` |
| `capacity` | `python3` >= 3.11 | `python3` (read-only task; grading is `answer.json` only) |
| `geosvc` | nothing — all five tasks are read-only analysis | `python3` only, for the `notes` strip; **`go` is never invoked** |

Container images must therefore carry `bun` and `python3`. A Go toolchain is *not* required: the
five Go tasks are graded entirely by comparing `answer.json`, which is the point of them.

## Adding a task

0. Read `CONTRIBUTOR_CONTRACT.md`. It is shorter than this file and it is where the mistakes are.
1. Pick a fixture (or add one under `fixtures/`, keeping the zero-dependency + deterministic rules).
2. `mkdir -p tasks/<id>` and write `task.md`, `meta.json`, `setup.sh`, `verify.sh`.
   Copy the shape of an existing task; both scripts must `source ../../lib/task.sh`.
3. Put the deterministic grader in `checks/` (hidden tests) and/or an exact `expected.json`.
4. Write the reference solution into `solution/files/` (a file tree overlaid onto `$WORKDIR`).
5. Run `./verify-all.sh <id>`. It must report `fail(ok)` untouched and `pass(ok)` with the solution.
   A grader that already passes untouched is a broken grader and the task is not admissible.
6. Ask what shape of harness the wording rewards. "Report the fully-resolved runtime value" names
   no tool and still favours one. See the bias review at the end of this file.

## Tooling rule

`bun` / `bunx` only, everywhere in this corpus. Never npm, npx or node.

## Execution-bias review of the original 12

The corpus was authored alongside a harness whose differentiator is a persistent JavaScript REPL,
in the one language where such a tool is natively privileged. Each of the original tasks is
classified below by how much its *shape* rewards executing code over reading it. This is about the
task, not about whether executing code is legitimate — it always is.

| task | verdict | reason | action taken |
|---|---|---|---|
| `code-diagnose-boundary` | neutral | Symptom is reported in prose; the fix is a source edit and the grader runs the fixture's own tests. Every harness must run tests to know it is done; none is privileged in *finding* the cause. | none |
| `code-feature-cancel` | neutral | Large written spec, graded by hidden behaviour tests. Reading the spec and the scheduler dominates; a REPL helps only at the same verification step everyone reaches. | none |
| `code-fix-failing-test` | mildly biased | "Run the tests, find the cause" — the entry point is literally an execution. But the fixture's own runner gives the same output to any harness that can spawn a process, so the advantage is one shell command wide. | none; not worth changing, this is what a bug report looks like |
| `code-refactor-validators` | neutral | Pure reading and editing; the extra structural check is a line budget over `src/validate`. | none |
| `research-audit-handler` | **strongly biased → downgraded to mild** | Asked for "the fully-resolved namespace strings **as they exist at runtime**", i.e. template-literal evaluation, phrased as an instruction to execute. | reworded to ask for the expanded values *the code writes under*, stating they are fixed by the source. Expected answer unchanged; the static route is now explicitly sanctioned. |
| `research-delete-graph` | mildly biased | Import-graph enumeration is a few lines of script and tedious by hand, and it is graded on exact set equality. Legitimately measures a real capability, but it is the capability we built for. | none; flagged. Report this task's result separately. |
| `research-retry-callsites` | mildly biased | Same shape as above: call-site enumeration, exact set equality, one miss = zero. | none; flagged. |
| `research-retry-policy` | **strongly biased → downgraded to mild** | `backoffDelaysMs` "must reflect the **real behaviour** of the code, including any clamping". The clamp and the delays-vs-attempts off-by-one are free to an evaluator and are exactly what a reader gets wrong. | reworded to "must follow the code as written, including any clamping". Expected answer unchanged. |
| `agentic-csv-roundtrip` | neutral | Build a parser to a written spec, graded by hidden checks. Reading the existing writer is the hard part. | none |
| `agentic-dedupe-module` | neutral | Spec-driven module plus wiring; the spec is fully written out, nothing is runtime-only. | none |
| `agentic-multifile-fix` | neutral, and mildly *hostile* to execution | Three divergent implementations of the same normalisation, with a green test suite. Nothing to observe at runtime — the whole difficulty is finding all three sites by reading. | none |
| `agentic-script-report` | **strongly biased, not fixable** | The task *is* a REPL session serialised to disk: drive the library in-process and dump jittered backoff, hook sequences and RNG state. A persistent in-process interpreter is the reference implementation of the workflow. | **not fixed and not deleted.** Rewriting it would destroy the task. It stays, labelled, and its result must be reported separately and discounted. |

Net: after the two rewordings, **1 of 12** original tasks (not 4) has a headline requirement
phrased in terms of runtime-resolved values, and it is declared. Three remain mildly biased by
shape. The 9 tasks added in the extension are the actual correction.

One residual neutrality wart, left deliberately: `agentic-script-report/task.md` names the
repository's JavaScript runtime, because the task's contract is "this file must be runnable and
must write `report.json`" and the runtime is not inferable otherwise. It names a runtime, not a
harness, and the information is equally available to every competitor — but it is the one place
in the corpus where a `task.md` names a command, and it is recorded here rather than hidden.
