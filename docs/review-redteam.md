# Red-team review of the harness arena

Adversarial position paper. Written blind (no sight of the other reviewers). Attacks both the
current framework and `docs/critique-external.md`. Assumes both are wrong somewhere.

Scope of what was read: `spec/metrics.md`, `spec/fairness.md`, `README.md`,
`docs/critique-external.md`, `/tmp/bench-harnesses/corpus/**` (all 12 `task.md`, all `verify.sh`,
`lib/task.sh`, `lib/check-answer.ts`, the graders' hidden checks), `runner/harnesses.json`,
`runner/run.ts`, `runner/report.ts`, `containers/Containerfile.*`, `HARNESSES.md`.

---

## 0. The finding that outranks everything else

`runner/report.ts:104-105`:

```ts
const tokensOk = tokensDelta <= -30;
const speedOk = speedDelta >= 30;
```

The reporting tool hard-codes the owner's desired marketing claim as a pass/fail ✓/✗ column. The
instrument prints "did we hit -30% / +30%" on every run. That is not a benchmark, that is a
scoreboard for one pre-announced result, and every design decision downstream of it — task
selection, flag choice, which runs are discarded — now has a gradient pointing at it. Nobody
outside the project will read past that line once they find it.

Everything else in this document is secondary to: **delete the target constants from the tool, or
publish nothing.** Report Δ; let a reader decide whether -30% is impressive.

---

## 1. Conflict of interest: we wrote the corpus and we are in it

The fork's differentiator is a **single persistent JavaScript REPL tool + preloaded skills**. Here
is what that shape is good at, and here is what the corpus asks for.

### 1.1 The corpus is monolingual and it is our language

All three fixtures (`ledger`, `pipeline`, `taskq`) are zero-dependency TypeScript run under `bun`
(`corpus/README.md`, fixtures table). Twelve of twelve tasks. No Python, no Go, no Rust, no C, no
polyglot repo, no build step, no lockfile, no `node_modules`, no network, no git history, no
migrations, no framework, no generated code, no >5k-LOC module.

A persistent **JavaScript** REPL in a **JavaScript/TypeScript** repo can `import` the code under
test and interrogate live objects. In a Python or Go corpus, that same REPL is a shell with extra
steps. We picked, without adversarial review, the one language where our tool shape is natively
privileged. This is the single biggest bias in the project and it is not in `spec/fairness.md`.

### 1.2 Specific tasks that reward "run the code" over "read the code"

These are not hypotheticals; the wording is in the tasks:

- `research-retry-policy/task.md`: `backoffDelaysMs` "must reflect the real behaviour of the code,
  **including any clamping**, and must stop where the code stops sleeping". Expected
  `[50,150,450,1000]` — the clamp at 1000 and the "4 delays for 5 attempts" off-by-one are exactly
  the two things a reader gets wrong and an evaluator gets right for free.
- `research-audit-handler/task.md`: `storeNamespaces` "must contain the **fully-resolved namespace
  strings as they exist at runtime** (not the names of the constants or the template
  expressions)". Expected `["audit","audit.journal"]`. This is a template-literal evaluation
  problem. It is *written as* a request to execute code.
- `agentic-script-report`: the entire task is "drive the library in-process and dump state". A
  persistent REPL holding a live scheduler across turns is the reference implementation of this
  task's workflow. Expected artifact includes `snapshot.rngState`, `hookSequence`, jittered backoff
  — values nobody derives by reading.
- `research-delete-graph` / `research-retry-callsites`: import-graph and call-site enumeration.
  Scriptable in a few lines; tedious by grep+read. Both graded on exact set equality, where one
  missed call site = zero.

Rough count: **4 of 12 tasks (33%) have a headline requirement phrased in terms of runtime values**,
and a 5th (`agentic-script-report`) is a REPL session serialised to disk. If a rival author had
handed us this corpus with those sentences in it, we would have called it rigged.

### 1.3 Skills are switched off for everyone except us

`spec/fairness.md` claims host contamination is controlled. Look at what "controlled" means per
harness in `runner/harnesses.json`:

| harness | skills status |
|---|---|
| opencode | `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` |
| pi 0.84.2 | `-ns` — notes call it "MANDATORY", it strips `<available_skills>` |
| hermes | `--ignore-rules` skips skills/memory/SOUL.md |
| cline / codex / claude | HOME / CODEX_HOME redirected to an empty dir → no skills |
| **prime-agent-fork** | **no skills flag at all**, and `containers/Containerfile.prime-agent-fork` explicitly `COPY dist/skills/ /opt/harness/dist/skills/` |

So: every competitor runs with its skill layer amputated, and ours runs with its skill layer
shipped into the image on purpose. There is a defensible argument ("theirs are user-installed host
contamination, ours are in-package defaults") — but it is an *argument*, it is nowhere in
`spec/fairness.md`, and the effect size is unmeasured. Right now the honest description of the
comparison is "our harness with its skills vs. their harnesses with theirs removed".

Minimum fix: run the fork **both ways** (skills on / skills off) and publish both rows. If the
skills are worth anything, the delta is the interesting number and it is ours to claim; if they are
not, we have lost nothing and gained the fairness argument.

### 1.4 Other structural tilts

- **No git repo anywhere in the corpus.** Documented as costing aider its repo map
  (`spec/fairness.md`, "Known and accepted"). It also removes `git diff`/`git log`/`git stash` as
  navigation and undo tools for *every* harness, and removes the entire class of task ("what
  changed", "revert this") where git-native harnesses win. We disabled a capability axis we do not
  compete on.
- **Read-only research tasks are trapped for edit-first harnesses.** `assert_src_unchanged`
  (`corpus/lib/task.sh`) fails the run if `src/` differs *at all*. An agent that reaches the right
  answer by temporarily instrumenting a file and forgetting to revert scores zero on a research
  task. A REPL-first harness never touches the file in the first place. This is a real capability
  difference, but it is graded as *correctness*, and it silently punishes exactly the harnesses
  whose idiom is "edit, observe, revert".
- **Prompt-shape neutrality is asserted, not tested.** `spec/fairness.md` says `task.md` is scanned
  to name no tool or vendor. Naming no tool is not the same as favouring no tool. "Report the
  fully-resolved runtime value" names no tool and favours one.

### 1.5 What a neutral task set looks like, and what to do with this one

Neutral means the *shape* of the winning strategy is not fixed by the task:

1. ≥2 languages, at least one where a JS REPL is worthless (Python, Go).
2. ≥2 tasks in a real git repo with history.
3. ≥2 tasks with an external dependency / build step / failing install.
4. ≥1 task where the correct action is to **refuse or ask** (bad spec, contradictory constraints).
5. ≥1 task with a large file that does not fit comfortably in context.
6. Task authorship split: someone who does not touch the harness writes them, or they are lifted
   from real bug reports unmodified.

What to do now, given we are not rebuilding the corpus this week:

- **Publish the 12 tasks and the fixtures with the results.** A biased corpus that is fully open is
  a weaker claim; a biased corpus that is hidden is a scandal.
- **Report by category** (`coding` / `research` / `agentic`) and never as one aggregate number. If
  our win is concentrated in the 4 research tasks, that is visible immediately, which is the point.
- **State the monolingual/no-git/REPL-friendly bias in the headline**, not in an appendix. Owning it
  costs less than being caught with it.
- Treat the research category as **provisional**: it is the category most obviously shaped like our
  tool, and the one whose result we should discount hardest in our own reading.

---

## 2. Gameability, metric by metric

For each: how an author who wanted to win could get the number without getting better, then whether
*we* are at risk of it accidentally.

### tokens to goal
- **Game:** truncate tool output aggressively; never re-read; skip verification; drop the system
  prompt to nothing; answer from a prior guess. All reduce tokens and reduce solve rate — but the
  reporting only compares tokens **on commonly-solved tasks** (`report.ts:84`), so tokens burned on
  the tasks you failed are erased from the comparison. Fail hard on 6, be lean on 6, look 40%
  cheaper.
- **Also:** a run whose metering rows never arrive counts as **zero tokens**. `runner/harnesses.json`
  documents exactly this for hermes ("METERING GAP … the proxy wrote NO row"). Zero-token solved
  runs are free wins and nothing in `report.ts` rejects them.
- **Our risk: high.** Not by intent — via the `anySolved` + solved-runs-only median path (see
  below), and via any stream-abort behaviour in our own client.

### time to goal
- **Game:** parallelise nothing, but skip the verification step; return before tests finish; keep
  the process alive doing nothing after the answer lands (wall is measured to exit, `run.ts:258`);
  or simply be a native binary with a fast start (`wallMs` includes startup, per `spec/fairness.md`).
- **Also:** on this rig time is dominated by **upstream 429 retries** on a rate-limited pinned model
  (`spec/fairness.md`, "Open"). Harnesses differ in retry policy, so we are partly measuring
  backoff configuration. Retries are recorded; they are not currently excluded by `report.ts`.
- **Our risk: medium-high.** Whoever tunes our retry/backoff for the benchmark window is tuning the
  metric.

### solve rate
- **Game:** overfit to *these* graders. The graders are readable in the corpus repo; the hidden
  checks are not, but their shape is (restore pristine tests, run `bun test bench_checks`). Ship
  behaviour that satisfies the observable spec exactly.
- **Our risk: high and structural.** We can read `checks/` and `expected.json`. Every prompt-tuning
  iteration we do against a known-failing task is holdout leakage. There is no wall between
  "debugging the harness" and "fitting the answer key" when the same person has both.

### cost per success
- **Game:** cache-shaping. `spec/metrics.md` correctly separates cache classes, but cost is a
  *priced* function, and prices are config (`runner/harnesses.json` carries per-harness `cost` blocks
  in the injected `models.json` — ours declares `cacheRead: 0`, `cacheWrite: 0`). If cost is ever
  folded from harness-declared prices rather than one central table, this is trivially riggable.
- **Our risk: low if the proxy prices centrally; verify that it does before publishing a $ number.**

### tool-F1 (critique's proposal)
- **Game:** it is the most gameable metric on the list. F1 needs a "needed tools" gold set, and the
  gold set is written by us. A harness with a single REPL tool has a **denominator of one**: it can
  hardly call a wrong tool. Adopting tool-F1 as proposed would hand our harness a near-perfect score
  by construction and would rank a 40-tool harness that used 39 correctly as worse.
- **Our risk: catastrophic if adopted naively.** Do not adopt tool-F1 across harnesses with
  different tool cardinalities. It is not comparable.

### blast radius (critique's proposal)
- **Game:** minimise lines touched → gets you a one-line patch that papers over the root cause,
  which `code-diagnose-boundary/task.md` explicitly forbids. Blast radius rewards precisely the
  behaviour that task is designed to fail.
- **Our risk: medium.** Also note `code-refactor-validators/verify.sh` already has an
  anti-blast-radius metric (`MAX_LOC=280`) that is **directly gameable by joining lines**: `loc.ts`
  counts non-blank non-comment lines, so semicolon-chaining or removing line breaks passes the
  budget with zero deduplication. A harness whose model writes denser code passes a "did you
  refactor" check without refactoring.

### recovery rate (critique's proposal)
- **Game:** define "recovery" as "eventually produced output after an error" and every harness that
  retries scores 100%. It is only meaningful with injected, deterministic faults — which we do not
  have and which cost real days to build.
- **Our risk: low, because we cannot compute it at all today.**

### The one we are most likely to do to ourselves, accidentally

`report.ts:42-45,84`. `common` is built from `anySolved` — **any** attempt solving counts the task
as solved for the head-to-head — and tokens/wall are medians over **solved runs only**. With
`--attempts 3`, a harness that solves a task 1 time in 3 contributes its single lucky, cheap run to
the token and speed comparison, and its two expensive failures vanish. That is best-of-k reported as
if it were pass@1. Combined with the hardcoded ✓ at -30%, this is the mechanism by which we publish
a false claim in complete good faith. Default is `--attempts 1` (`run.ts:43`), which hides the bug
until the day someone raises attempts to reduce noise — i.e. the day we start believing the numbers.

---

## 3. Where the external critique is wrong or overreaching

It is well-organised, mostly sensible as a taxonomy, and it contains at least four claims that
should not survive contact with this rig.

### 3.1 "Identical weights move SWE-bench 10-20 points across harnesses" — unverified, and irrelevant

`docs/critique-external.md` states this with no citation we can check (the doc itself flags the
provenance as unverified). What would make it true: SWE-bench Verified scores for the same model
under two harnesses, same date, same scaffold budget, published with logs. What would make it false:
the same comparison showing spread inside noise (SWE-bench Verified n=500; a 10-point gap is ~50
instances — large, but so are the confounds: retry policy, context limit, patch-format compliance,
test-timeout).

**It does not matter for our design either way.** We already hold model and provider fixed. The
claim is used to justify a conclusion ("hold the model fixed") we implemented before we read it. If
the number is quoted in our writeup as support, we inherit an unverifiable claim for zero gain.
Drop it.

### 3.2 "Adopt SWE-bench Verified / Terminal-Bench / Aider polyglot as a public floor" — priced honestly, this is a bad trade *now*

Concretely, for **this** rig:

- Every harness is currently wired through a bespoke per-harness adapter in
  `runner/harnesses.json` — one for the Anthropic shape, one for `/responses` (codex forced a proxy
  extension), one per custom-provider config file. Gemini CLI is **disabled** because the proxy
  cannot speak its wire shape at all. SWE-bench harness adapters are written against *their*
  runner, not ours; each harness needs a new adapter on the SWE-bench side too.
- SWE-bench Verified needs per-instance Docker images with the right Python toolchain. That is a
  different container story from `containers/Containerfile.*` (one small image per harness), on a
  16GB M3 that already refuses to run two heavy processes.
- Runtime: 500 instances × N harnesses × k attempts on a model that is **intermittently
  rate-limited** (`spec/fairness.md`, "Open"). One run at a time is mandatory because parallel load
  inflated timings 20-70× during development. At an optimistic 3 min/instance serialised, one
  harness × one attempt on the full set is ~25 hours of wall clock. Seven harnesses = a week of
  machine time per sweep, before a single retry.
- Cost: token spend is the smaller half; the machine time and the "one run at a time" constraint are
  the binding ones.

Honest estimate: **5-10 engineering days for the first credible SWE-bench Verified number, plus
multi-day sweeps thereafter.** Terminal-Bench and Aider polyglot are cheaper individually but each
carries its own adapter + grader story.

Verdict: **not now.** A public floor is worth exactly one thing — external calibration, "our corpus
is not insane". You can buy 80% of that for ~1 day with a much smaller purchase: run 20-30 Aider
polyglot exercises (plain source files, per-exercise tests, no Docker matrix) through the existing
runner as a sanity check. If it later matters, do SWE-bench Verified on a **fixed 50-instance
subset**, published as a subset, and never claim the headline number.

### 3.3 "Context sustainability: slope of *useful* context" — not computable, delete it

There is no operator that partitions a token into useful and not-useful. Any implementation reduces
to a proxy (was it re-read later? did it appear in the final diff? did an LLM judge call it
relevant?) and each proxy is either circular (useful = present in the successful run) or an
LLM-judged opinion smuggled into a metric labelled "sustainability". This is the critique's worst
recommendation: it sounds like the most rigorous item on the list and it is the only one that
cannot be computed at all.

What *is* computable and nearby, and which we should say instead: `redundantToolCalls`,
`toolResultShare`, unique-vs-repeated prompt bytes (all already in `spec/metrics.md`), plus the one
honest goal-retention test — **pass rate after a compaction event vs. runs with no compaction**.
That is a difference of two measurable numbers and answers the real question ("did compaction lose
the thread") without pretending to score a token's usefulness.

Same objection, smaller, to "plan adherence" and "mid-run goal drift": both require an LLM judge
reading trajectories, and both would be run by us, on our harness, against our own notion of the
plan.

### 3.4 The private holdout — held out from whom?

The critique's own test is: "if internal pass rate climbs and holdout is flat, you overfit". That
test requires the holdout to be unseen by the person tuning the harness. Here, one person writes the
tasks, writes the graders, writes the expected answers, and tunes the harness. A holdout that its
author has read is a delayed training set, not a holdout. Worse, the *failure analysis* loop —
"harness failed task 7, why?" — is precisely the leak, and it is the loop we cannot avoid because it
is how the harness gets better.

The only versions of this that mean anything:

1. Someone else writes the holdout tasks and does not show us the graders' contents; we get only
   pass/fail. Requires a second person. Cheap, if a second person exists.
2. The holdout is **third-party** (this is the real argument for a public benchmark, and a better
   one than the critique's "public floor" framing).
3. We keep the holdout, admit it is not a holdout, and use it as a *regression* set — declared as
   such, never quoted as evidence against overfitting.

Anything else is theatre. If we cannot do (1) or (2), do (3) and say so.

### 3.5 Other unfalsifiable / infrastructure-assuming items

- **"pass^k"** — needs k× runs on a rate-limited model that already forces serial execution. Real
  cost: multiplies every sweep by k. Worth it at k=3 for a *subset*; not worth it corpus-wide yet.
- **"Safety and permissions: unauthorized read/write/egress rate"** — every harness in
  `runner/harnesses.json` is launched with approvals bypassed (`--yolo`, `--auto`,
  `--dangerously-bypass-approvals-and-sandbox`, `acceptEdits`, `--auto-approve true`) precisely so
  runs are unattended. Measuring "approval-gate bypasses" on a rig that disables every approval gate
  is a null measurement. Either measure the permission layer as its own experiment with gates on, or
  do not list it.
- **"Idempotency: rerun and compare repo state"** — measurable, cheap, and genuinely good. It is the
  one item in the recovery/robustness section we could implement today. Credit where due.
- **"Precision/recall of findings against a gold JSON set"** — that is what the four research tasks
  already are, minus the partial credit. Not new.
- **"20-turn vs 50-turn pass rate"** — assumes we control turn caps uniformly. We do not: each
  harness has its own iteration cap semantics, and forcing them equal is itself a config
  intervention that changes each harness differently.
- **The dashboard's ordering** (`Success @ budget` first) is right and matches `spec/metrics.md`'s
  "solve rate dominates". No objection there.

---

## 4. What both documents ignore

Neither `spec/metrics.md` nor the critique addresses any of the following. Several are more likely
to invalidate our first numbers than anything either document argues about.

1. **The model is the ceiling, and it may be too low to resolve harness quality.** We pinned a
   *flash*-class model, rate-limited upstream. If it fails `agentic-script-report` under every
   harness, that task contributes nothing but noise and cost. Floor and ceiling effects compress all
   harnesses toward each other, and the residual differences are then dominated by luck. Nothing in
   either document proposes checking this. **It is checkable in one run: score the corpus with a
   strong model under one harness.** If the strong model does not clear the tasks, the corpus is
   measuring nothing.

2. **Rate limiting is a confound, not just noise.** `spec/fairness.md` records that retries are
   recorded so runs "can be excluded". `report.ts` does not exclude them. Worse, 429 storms are
   time-correlated: a harness benchmarked during a bad ten minutes loses on wall time for reasons
   that have nothing to do with it. Interleave the harness order per task instead of sweeping one
   harness at a time, or the time axis is partly a clock.

3. **Timeouts silently relabel "slow" as "wrong".** `run.ts:249` kills at `timeoutSeconds`; the
   outcome becomes `timeout` and `solved=false`. Timeouts are 480-1200s and were chosen by the same
   people who tune the harness. A harness that is 20% slower does not lose 20% of a speed metric —
   it falls off a cliff into the solve-rate metric, which "dominates". Timeout choice is therefore a
   *hidden weighting of speed into correctness*, and it is currently unjustified. Publish the wall
   time distribution against the cap; if any harness's runs cluster near the cap, the cap is the
   result.

4. **Wrong-but-lucky passes.** `lib/check-answer.ts` lowercases and trims everything (`normStr`),
   so `withretry` matches `withRetry` despite four task files insisting on "exact identifiers as
   spelled in the source". Numeric strings coerce to numbers. Arrays are order-insensitive unless
   listed in `$ordered`. Set-equality answers with 3-5 elements drawn from a small file list are
   guessable at non-trivial rates by a model that greps once and pattern-matches. And
   `code-fix-failing-test` is graded by tests the agent can see fail — the classic
   "fix-until-green" target where a wrong-but-passing fix is a pass. None of this is fatal; all of it
   needs the reference-solution sanity check (`verify-all.sh` proves fail-before/pass-after, which is
   good) extended to **"does a deliberately wrong solution fail?"** — currently untested.

5. **Single machine, single OS, single arch.** Everything is one M3 with 16GB, macOS host,
   podman/Linux containers, one run at a time. Container image sizes differ substantially (our image
   carries a Python venv + ipython; aider is a venv; claude is node:22-slim), and `wallMs` includes
   container start (`run.ts:246-258`). Page cache state, image layer warmth and thermal throttling
   over a multi-hour sweep are all uncontrolled and all correlate with sweep order. At the ±30%
   effect size we intend to claim, this is not negligible.

6. **Long-horizon variance: one early wrong turn dominates.** On the four 1200s agentic tasks, the
   outcome is largely decided in the first two turns (did it find all three normalisation sites,
   did it read the right file). That is a near-binary, high-variance event. With `--attempts 1`
   (`run.ts:43`) we are sampling a Bernoulli once per cell. There is no per-task variance estimate
   anywhere in the pipeline.

7. **12 tasks cannot separate harness quality from luck, and the arithmetic is not close.** 12
   binary outcomes, one attempt each. A 2-task difference in solve rate between two harnesses is
   inside the noise of a coin that is only slightly biased; the 95% CI on 8/12 spans roughly 35-90%.
   Any claim of the form "harness A solves more" needs either many more tasks or many more attempts,
   and attempts are cheaper. **Neither document says how many tasks or attempts would be needed to
   support the claim we intend to make.** That is the omission that should worry us most, because
   the -30%/+30% target implies a precision the sample size cannot deliver.

8. **No baseline for "how much of this is the harness at all".** There is no control condition — no
   "bare model in a loop with two tools" reference harness. Without it, the spread between harnesses
   has no scale: is 20% of tokens a lot? Compared to what? A trivially simple in-house reference
   loop would give every number a denominator and costs less than a day.

9. **Nobody has stated the hypothesis.** "-30% tokens / +30% speed" is a target, not a hypothesis.
   The hypothesis is something like "on TypeScript maintenance tasks, a single-REPL harness reaches
   the same solve rate with fewer tokens". That is a narrower and defensible claim, and it is the
   one the corpus can actually support. Write it down *before* the numbers arrive, along with what
   result would falsify it. Preregistration is free and it is the cheapest available defence against
   the conflict of interest in §1.

---

## 5. The honest minimum — one day of work

Priority order. Everything here is achievable with the existing runner, proxy and corpus.

**Fix first (≈2h, blocking):**

1. Delete `tokensOk` / `speedOk` and the ✓/✗ column (`report.ts:104-107`). Report Δ with a CI.
2. Change `common` from `anySolved` to **all-attempts-solved**, and compute token/wall medians over
   **all** attempts of a commonly-solved task, not just the solved ones (`report.ts:42-45,84`).
   Otherwise attempts>1 silently becomes best-of-k.
3. Reject runs with **zero metered tokens** as `discarded_no_metering` instead of counting them as
   free (the hermes gap in `runner/harnesses.json` proves this happens).
4. Exclude runs that hit upstream 429s from the **timing** comparison only (already recorded, just
   not applied).

**Measure (≈4h of machine time, mostly unattended):**

5. **12 tasks × the 9 enabled harnesses × 3 attempts**, interleaved by task (harness order rotated), one
   run at a time. 3 attempts is the minimum that gives any variance estimate at all.
6. Add **one control harness**: the simplest possible loop (read/write/bash) so every number has a
   denominator.
7. Run the fork **twice**: skills on and skills off. Publish both.

**Publish (≈2h):**

8. Three tables, in this order:
   - **Solve rate per task per harness, as `k/3`**, broken out by category. No aggregate.
   - **Median tokens and median wall on commonly-solved tasks**, with min/max across attempts shown
     next to the median. Not a single Δ.
   - **Fixed context cost** per harness (already measured; it is the most defensible number in the
     project — it is a direct wire measurement of a one-word task and nobody can argue with it).
9. A **limitations section** stating, in the body and not an appendix: monolingual TypeScript/bun
   corpus; no git; tasks authored by a competitor; 12 tasks / 3 attempts is underpowered; skills
   disabled for rivals and (if unchanged) enabled for us; timeouts chosen by us; model is
   rate-limited flash-class.
10. Publish the corpus, graders, expected answers, `harnesses.json` and the raw `requests.ndjson`.

### What that day's numbers can and cannot support

**Can support:**
- "Fixed context cost per turn ranges 561 → 27,344 tokens across harnesses, measured at the wire."
  That is a strong, novel, unarguable result and it does not depend on the corpus at all.
- "On 12 TypeScript maintenance tasks, harnesses A/B/C solved k/12; here is every run."
- "Among commonly-solved tasks, harness X used N% fewer tokens (range …)" — as an observation with a
  visible range, on a named and disclosed corpus.

**Cannot support, and must not be written:**
- "-30% tokens / +30% speed versus the field." Twelve self-authored tasks on one language cannot
  carry a generalised efficiency claim, at any attempt count.
- Any ranking of solve rate as if the differences were significant.
- Anything about safety, permissions, recovery or plan adherence — none of it is instrumented, and
  every harness runs with approvals disabled.

If only one sentence survives from this review: **the -30/+30 target is currently hardcoded into the
tool that decides whether we hit it.** Remove it before anything is published.
