# Review — measurement validity and statistics

Reviewer lens: what this rig can honestly claim, and what sample size and controls that costs.
Written without sight of the other two reviews. Numbers are shown with their assumptions so the
arithmetic can be re-run when pilot variance is known.

---

## 0. Standing assumptions used throughout

| symbol | meaning | value used | where it comes from |
|---|---|---|---|
| `T` | tasks | 12 (`smoke-ok` excluded) | corpus README task table |
| `H` | harnesses | 8 enabled | `runner/harnesses.json` (gemini-cli `enabled:false`) |
| `m` | attempts per harness×task | variable | this review |
| `δ` | target effect, log scale | `ln(0.70) = −0.357` | owner's −30% |
| `σ_task` | SD of per-task log token ratio between two harnesses | 0.30–0.60 (unknown) | **not yet measured** |
| `σ_run` | within-cell SD of log tokens / log wall for one harness×task | 0.30–0.50 (unknown) | **not yet measured** |

`σ_task` and `σ_run` are the two numbers the whole design hinges on and **we do not have them
yet**. The only repeated measurement in `results/` is `prime-agent-fork` on `smoke-ok`:
2699 ms vs 4525 ms wall (`ctr-fork`, `ctr-fork2`) — a log spread of 0.52 on the most trivial task
in the corpus, where the model does one turn. That is a lower bound on `σ_run(wall)`, not an
estimate, and it is already larger than the effect we are trying to detect. Everything below
should be recomputed from a real 5×-repeat pilot on three tasks (one per category) before any
run plan is frozen. That pilot costs ~2 h and is the cheapest de-risking available.

---

## 1. Is −30% tokens / +30% speed provable with 12 tasks?

### 1a. First, define the effect. It is currently ambiguous.

"+30% speed" has two readings that differ by a factor of 1.85 in required sample size:

- 30% less wall time → ratio 0.70 → `δ = 0.357`
- 1.30× speed → ratio 0.769 → `δ = 0.262`; sample size scales as `1/δ²` → `(0.357/0.262)² = 1.85×`

Pick one in writing before running. This review assumes the first (the more generous one).

### 1b. Power arithmetic — paired design on log ratios

Design: same 12 tasks, both harnesses, per-task ratio `r_t = tokens_A(t)/tokens_B(t)`, analysed as
`ln r_t`. Paired t-test, α = 0.05 two-sided, power 0.80. With `df = T−1 = 11` the multiplier is
`(t_.975,11 + z_.80)² = (2.201 + 0.842)² = 9.26` (not the textbook 7.85 — small-`T` correction
matters here).

Required tasks `T* = 9.26 · σ² / δ² = 9.26 · σ² / 0.127`

Variance of the paired per-task log ratio at `m` attempts, medians per cell:

`σ² = σ_task² + 2·σ_run²/m`  (median-vs-mean inflation ≈ ×1.1 for small `m`; ignored, conservative in the wrong direction)

| σ_task | σ_run | m=1 | m=3 | m=5 | m=7 |
|---|---|---|---|---|---|
| 0.30 | 0.35 | T*=24 | T*=13 | T*=11 | T*=10 |
| 0.40 | 0.35 | T*=32 | T*=20 | T*=18 | T*=17 |
| 0.30 | 0.50 | T*=43 | T*=19 | T*=14 | T*=13 |
| 0.40 | 0.50 | T*=51 | T*=27 | T*=22 | T*=20 |
| 0.60 | 0.50 | T*=90 | T*=63 | T*=58 | T*=56 |

Read it as: **12 tasks is enough to detect 30% only in the friendliest corner of that table
(`σ_task ≤ 0.30`, `m ≥ 5`), and nowhere else.** At `m = 1` — the design as currently implied —
12 tasks detects 30% under no plausible assumption.

### 1c. And 12 tasks are not 12 independent tasks

The corpus has **3 fixtures** (`pipeline`, `ledger`, `taskq`) and 12 tasks — 4 per fixture. Tasks
sharing a fixture share the codebase the agent must navigate, the file sizes it must read, and the
test runner. Their residuals correlate. With an intraclass correlation `ρ = 0.3` by fixture:

`design effect = 1 + (4−1)·0.3 = 1.9` → **effective T ≈ 12/1.9 = 6.3**

Every `T*` in the table above should be compared against 6.3, not 12. That roughly doubles the
shortfall. Fix is structural, not statistical: **more fixtures, not more tasks per fixture**.
Eight fixtures × 3 tasks beats three fixtures × 8 tasks for the same 24 runs.

### 1d. The distribution-free fallback, and its power

Log-ratios will not be normal: timeouts and unsolved attempts produce undefined or infinite
ratios, and the tail is one-sided. The honest low-assumption test is a **sign test on per-task
median ratios**:

| tasks favouring A | two-sided p |
|---|---|
| 12/12 | 0.00049 |
| 11/12 | 0.0063 |
| 10/12 | 0.039 |
| 9/12 | 0.146 |

So a clean sweep is publishable at 12 tasks; 9/12 is not. Power of this test at a true 30% effect
with `σ_task = 0.40`: per-task sign probability `Φ(0.357/0.40) = 0.81`, expected 9.7/12, and
`P(X ≥ 10) ≈ 0.60`. **~60% power** — worse than the t-test but with no distributional debt.
Report both; pre-commit to the sign test as primary if the pilot shows heavy tails.

### 1e. The effect may be much larger than 30%, which changes everything

The published fixed-context floors span **561 → 27,344 tokens, a 48× range** (README.md:23-34).
If the real between-harness token difference on tasks is 2–3×, not 1.43×, then `δ = ln 2 = 0.69`
and `T* = 9.26·0.16/0.48 = 3.1` tasks. **12 tasks is then generous.** The power problem bites
only in the neighbourhood of 30% — precisely the neighbourhood the owner's target names. That is
an uncomfortable coincidence: the claim is stated at exactly the magnitude this design cannot
resolve, and a claim of "3× fewer tokens" would be far easier to defend than "30% fewer".

### 1f. What 12 tasks *can* honestly support

1. **Fixed context cost per harness.** Near-deterministic, one-word task, wire-measured, purely a
   harness property. Three repeats suffice to show the variance is ~0. This is the single most
   defensible number in the rig and it should lead the report.
2. **Effects ≥ 1.8×** with a consistent sign across ≥10/12 tasks, via sign test — no variance
   estimate needed.
3. **Descriptive, corpus-scoped statements**: "on these 12 tasks, harness X used N% fewer tokens
   per successful task (95% CI …)". Scoped to the corpus, not generalised to coding work.
4. **Existence claims**: "harness Y re-reads the same file up to K times", "harness Z's context
   grows 4.1 k tokens/turn". `n = 1` is enough to demonstrate a behaviour exists.
5. **Ordering of solve rate when the gap is huge** (see §1g).

It cannot support: the "at equal quality" qualifier (§1g), a 30% effect at `m = 1`, or any claim
about tasks outside the corpus.

### 1g. "At equal quality" is the clause that breaks first

Attempts within a task are strongly correlated — a task is largely either doable or not for a
given harness. With `ρ_attempt ≈ 0.5` and `m = 5`, design effect `= 1 + 4·0.5 = 3`, so 60
attempts per harness carry the information of ~20 independent draws. At `p ≈ 0.7`:

`SE(p̂) ≈ √(0.7·0.3/20) = 0.102` per arm; paired across tasks with `ρ = 0.6` →
`SE(Δ) ≈ √(2·0.0104·0.4) = 0.091`

**Minimum detectable solve-rate difference ≈ 2.8 × 0.091 ≈ 25 percentage points.**

So "equal quality" can only be asserted with a non-inferiority margin of ~25 pp. A harness that
solves 70% while ours solves 50% would be declared "equal quality" by this design. That is not a
quality control; it is a licence. To get the margin down to 10 pp needs `(25/10)² = 6.25×` the
effective sample — roughly **75 tasks × 5 attempts**, or ~30 tasks across ~10 fixtures if the
clustering is fixed too.

**Verdict on Q1:** the −30%/+30% claim is **not provable at 12 tasks × 1 attempt**, and only
marginally provable at 12 × 5 in the friendliest variance regime — and even then the "at equal
quality" half is unprovable at any `m`, because it is limited by task count, not attempt count.

---

## 2. pass@k vs pass^k — what is affordable, what each buys

### 2a. Cost of attempts. Money is not the constraint; wall clock is.

Sum of `timeoutSeconds` over the 12 tasks = 4800 (agentic) + 3600 (coding) + 2280 (research)
= **10,680 s = 2.97 h** worst case per harness-sweep. At a realistic 40% of timeout, ≈ **1.19 h**.

| m | serial hours (8 harnesses) | worst case (all timeout) |
|---|---|---|
| 1 | 9.5 | 23.7 |
| 3 | 28.5 | 71.2 |
| 5 | 47.5 | 118.7 |
| 7 | 66.6 | 166.2 |

Money, at the `cost` block declared in `runner/harnesses.json` ($0.08/M in, $0.18/M out): a hard
agentic run at ~1.2 M cumulative prompt + 60 k output ≈ **$0.11**; corpus average nearer $0.05.
`8 × 12 × 5 = 480` runs ≈ **$25–50** including retries.

**Conclusion: `m = 5` costs about fifty dollars and about two days of exclusive Mac time.** The
binding resource is the machine and the 429 window, not the bill. Attempts are cheap; buy them.
`m = 5` is the recommendation. `m = 3` is the floor. `m = 1` is not a benchmark.

### 2b. What each estimator means here

- **pass@k** = "succeeds at least once in k tries". Requires an oracle to pick the winning
  attempt. **Our users have no oracle at use time** — a developer running a terminal agent does
  not know which of 5 runs was the good one. pass@k with k>1 therefore measures something nobody
  can buy. Partial exception: tasks whose tests are visible to the agent (`code-fix-failing-test`,
  `code-refactor-validators`) let a self-verifying harness collapse pass@k toward pass@1 by its
  own effort — and *that* is a real, rankable harness property. Report it as such
  (verification-use rate), not as pass@k.
- **pass@1** = per-attempt success probability. This is what a user gets. Estimate it as the
  pooled `solved/attempts`, clustered by task.
- **pass^k** = "succeeds k times running". The reliability number. With `m = 5` the unbiased
  estimator for pass^3 is `C(c,3)/C(5,3)` where `c` = successes. It has almost no resolution per
  task (5 draws) but aggregates acceptably over 12 tasks.

### 2c. Which gates the headline

**pass@1 gates the headline claim.** pass^3 is reported beside it as a reliability column.
pass@k for k>1 is a diagnostic only, and must never appear in a headline sentence.

Resolution warning: with 5 attempts on one task, observing 5/5 gives a one-sided 95% lower bound
of `0.05^(1/5) = 0.55` on the true per-attempt rate. Per-task pass rates are essentially
uninterpretable at `m = 5`; only the 60-attempt aggregate is.

---

## 3. Rankable metrics vs diagnostics — adjudicating the critique

The critique's blanket claim ("TTFT / tokens-per-sec → model + network, not harness quality",
`docs/critique-external.md:22`) is **two-thirds right and one-third wrong**. Adjudication:

### Rankable — harness-attributable by mechanism

| metric | mechanism that makes it a harness property |
|---|---|
| `solved` / pass@1 | the only outcome. Primary, dominates. |
| **fixed context cost** | one-word task, one turn: everything in the prompt was put there by the harness. Model and network contribute nothing. Cleanest number in the rig. |
| `promptTokens`, `totalTokens` by class | the prompt *is* the harness's output. Model fixed, prompt bytes fixed → any difference is a harness decision. |
| `cacheHitRate` | **the critique misses this one.** Prefix caching requires a byte-stable prompt prefix. A harness that injects a timestamp, reorders tool definitions, or rebuilds its system block each turn destroys the prefix and pays full rate. That is pure harness engineering, visible only at the wire, and it can dominate cost. Strongly rankable. |
| `turns`, `toolCalls`, `redundantToolCalls` | loop control is the harness. |
| `toolResultShare` | truncation and read-window policy is the harness. |
| `overheadRatio` = `(wall − generation)/wall` | the harness's own compute, with the network subtracted out. Rankable, with the machine caveat in §4. |
| tokens / cost / wall **per successful task** | see §5. The headline family. |

### Diagnostics only

| metric | why |
|---|---|
| `ttftMs`, `ttfContentMs` | dominated by provider queue depth and prefill. It does carry a harness signal — prefill time scales with prompt length, which the harness controls — but that signal is `promptTokens`, measured through a noisy network. Publish `promptTokens` instead. **Critique is right.** |
| `tokensPerSec` | server-side decode rate. The harness's only lever is prompt length (prefill contention). Not rankable. **Critique is right.** |
| context *size* | **critique is wrong** to file this with the artefacts (`critique-external.md:25`). Context size at the wire is model-independent given a fixed model and prompt; it is the harness's product. What the critique is *right* about is the inference: large context ≠ bad harness, and small context ≠ good one. So rank the **cost**, diagnose the **slope**. `contextGrowthPerTurn`, `tokenDrift`, `costDrift` are diagnostics; `totalTokens per success` is rankable. |
| `thinkingMs*`, `reasoningShare` | model-side unless a harness sets a reasoning-effort parameter. None of the 8 visibly does. Diagnostic. Also compromised: `fairness.md:36-37` records that the Anthropic path can report reasoning > completion tokens, i.e. the accounting is not comparable across request shapes. Do not rank on it until that is fixed. |
| `firstEditMs` | a strategy descriptor. Reading longer before editing is not worse. Diagnostic by nature, not by noise. |
| `costUsd` | correct but derivative; publish beside raw tokens, never instead. |
| quality rubric 1-5 | `metrics.md:138-139` uses **one** reviewer model. A single judge with no calibration set has unmeasured bias and unmeasured reliability. Until ≥2 independent judges are run on the same diffs and Cohen's κ ≥ 0.6 is demonstrated against a small human-scored subset, this is a diagnostic. The runs are cheap — three judge passes over ~100 diffs is minutes — so there is no excuse for not measuring κ. |

---

## 4. Confounds still free to vary

Ranked by how much of a 30% swing each can produce on its own.

### 4.1 Sampling parameters are NOT fixed — the largest uncontrolled confound

`proxy/server.ts:142-149` rewrites `model` and `provider` and nothing else. `temperature`,
`top_p`, `top_k`, `seed`, `max_tokens` all pass through **as each harness chose them**. The
critique asks for fixed temperature (`critique-external.md:37`) and the rig does not do it.
Temperature moves both token count and pass rate materially; a harness at T=0 versus one at T=1
is a different experiment, not a different harness. This alone can exceed 30% on both axes.

Adjudication: a harness's chosen temperature is arguably part of its design. Both readings are
defensible, so **run both arms**: proxy-normalised (`temperature` and `top_p` forced to one value,
`seed` fixed where the provider honours it) as the headline, native-parameter as a diagnostic —
and publish the per-harness native values in the config log either way. Currently we cannot even
state what they are; that must be logged before the next run regardless of which arm wins.

### 4.2 `max_tokens` ceilings differ per harness

`prime-agent-fork`'s injected `models.json` declares `maxTokens: 32768` /
`contextWindow: 1048576`; other harnesses declare their own or none. A lower ceiling truncates
long turns → more turns, or a silent failure. Log and normalise, or accept and publish.

### 4.3 Retry policy under upstream 429 — convert it into a control

`fairness.md:38-39` records that the pinned model is intermittently rate-limited and that
harnesses retry at different rates, and `metrics.md:122` says affected runs *can* be excluded.
"Can be excluded" post hoc is a researcher-degrees-of-freedom hole: whoever excludes gets to
choose the winner.

Better: **the proxy absorbs 429s**. It retries upstream with one uniform policy and never returns
a 429 to any harness. Then no harness's retry code is on the timing path, exclusion rules are
unnecessary, and the confound disappears instead of being adjusted for. Record proxy-side retry
seconds per run and subtract them from `wallMs` to form `wallMs_adjusted`; pre-register which of
the two is the headline. This is the single highest-value change in this review.

### 4.4 Cache warming and run ordering — worth >30% by itself

Provider-side prefix caching is shared across runs and time-ordered. Running all of harness A's
attempts, then all of harness B's, hands the second one a warm cache on shared prefixes and
distorts `cacheReadTokens`, `costUsd`, and TTFT. Same for the Mac's page cache and bun's module
cache on repeated fixture setup.

Control: **randomised interleaved blocks**. One round = every (harness × task) cell once, in a
randomised order; five rounds = `m = 5`. Never run a harness's attempts consecutively. Record
round index as a covariate and check it is not significant.

### 4.5 Time-of-day / upstream load

`tokensPerSec` and TTFT are fully confounded with calendar time unless harnesses are interleaved
inside a short window. Blocked interleaving (§4.4) fixes this too — it is the reason to do it even
if caching were not an issue.

### 4.6 Thermal state of one M3/16 GB over a 48 h sweep

`fairness.md:18` controls parallelism but not sustained-load throttling. A run at hour 40 is not
the same machine as a run at hour 1. Interleaving randomises it away in expectation; also log
CPU frequency / thermal pressure if obtainable, and always report `generationMs` (mostly remote)
beside `wallMs` (local).

### 4.7 Container images are not comparable environments

Python venv (aider) vs native Rust (codex) vs Bun bundle vs Mach-O binary (cline). Startup is
inside `wallMs` and `fairness.md:29-32` accepts this. Fine — but then publish a measured
startup constant per harness (from `smoke-ok`) so a reader can subtract it. Otherwise short tasks
rank harnesses by their packaging.

### 4.8 Corpus authorship and the absence of a holdout

The corpus, the runner, and one of the harnesses under test share an author. `critique-external.md:95-96`
asks for a private holdout and the rig has none. Even with perfect statistics, a 30% win on a
corpus written by the winner's author is not evidence about coding agents; it is evidence about
this corpus. Required: **≥6 tasks, ≥2 new fixtures, authored after the run plan is frozen, run
exactly once, published whether or not they agree with the main set.** If the headline effect
holds on the main set and vanishes on the holdout, publish that.

### 4.9 Selection on the outcome — the collider

`metrics.md:145` computes token and time comparisons only over tasks **both** harnesses solved.
The intent is right (giving up must not look like efficiency), the implementation creates a
collider: conditioning on joint success removes exactly the hard instances where the efficient
harness struggled, and it does so asymmetrically. A harness that fails selectively on the
expensive tasks gets its expensive tasks deleted from its own average.

Fix: keep the both-solved table as a *secondary* view, and make the primary the
per-success portfolio ratio of §5, which spends failures rather than deleting them. Also
pre-register the common task set before looking at results.

---

## 5. Cost per successful task — implementable definition

For harness `h`, task `t`, attempts `a = 1..m`, over the **pre-registered task set** (all 12, not
a solved subset):

```
cost(h,t,a)   billed USD from the proxy rows for that run, all token classes,
              including every attempt that timed out, errored, or produced nothing.
              EXCLUDES runs discarded for provider mispin (metrics.md:150) — those are
              instrument failures, are re-run, and are listed separately.
              INCLUDES upstream-retry cost (we paid for it).

C(h,t) = Σ_a cost(h,t,a)          total spend on that task
S(h,t) = #{a : verify.sh exit 0}  successes on that task

CPS(h)  = Σ_t C(h,t) / Σ_t S(h,t)         portfolio cost per success   ← headline
TPS(h)  = Σ_t tokens(h,t) / Σ_t S(h,t)    tokens per success           ← headline
WPS(h)  = Σ_t wallMs(h,t)  / Σ_t S(h,t)   wall seconds per success
```

Properties, deliberately:

- Failed attempts stay in the numerator and contribute 0 to the denominator. Failure is charged
  at what it actually cost.
- A task solved 0/5 contributes its full spend and no success. It is **not dropped**. This is the
  whole point — it is what closes the §4.9 collider.
- A harness that solves nothing anywhere has `Σ S = 0` → `CPS = ∞`. Publish it as
  `∞ (0/60 solved)`. Never blank, never omitted, never "n/a".
- A harness that quits after two turns gets a tiny numerator and a zero denominator, so quitting
  is punished, not rewarded — the failure mode `metrics.md:145` was written to prevent, handled
  without conditioning on the outcome.
- Per-task `CPS(h,t) = C(h,t)/S(h,t)` is reported in the detail table, `∞` where `S = 0`.

Equivalent decision-relevant form, for a user who simply reruns until it works:

```
ECPS(h) = mean_attempt_cost(h) / p̂(h)     p̂ = pooled pass@1
```

`ECPS` equals `CPS` in expectation and is the sentence a reader can act on: *"expected spend to
get this task done once."* Report both; they should agree, and if they diverge, a few expensive
tasks are carrying the portfolio and that must be said.

Confidence intervals: **bootstrap resampling tasks (or, better, fixtures) as the unit**, not
attempts — 2000 resamples, percentile CI, on the ratio `CPS(A)/CPS(B)`. Resampling attempts would
understate the CI by roughly the design effect of §1g.

---

## 6. The exact sentences

### Entitled to publish, given the design recommended here (m = 5, interleaved rounds, proxy-absorbed 429s, normalised sampling params, pre-registered task set, holdout run)

> On a pre-registered 12-task corpus (4 coding, 4 codebase-research, 4 multi-step agentic, built
> over 3 fixtures), with `deepseek/deepseek-v4-flash-0731` pinned to `deepinfra/fp8` and metered
> at the wire, run as 5 randomised interleaved rounds per harness, harness X spent **N% fewer
> billed tokens per successful task** than harness Y (95% CI, task-clustered bootstrap:
> [a%, b%]; per-task sign test k/12, p = …), at a per-attempt solve rate of P% versus Y's Q%
> (difference D pp, 95% CI [l, u]) — a difference this design can bound only to ±25 pp, so
> equality of outcome is **not** established. Wall-clock differences are reported with upstream
> retry time subtracted and are secondary, because the runs share one machine.

### NOT entitled to publish

> Our harness is 30% cheaper and 30% faster than every other coding agent, at equal quality.

Every clause fails: **"30%"** without a CI, at an effect size this design cannot resolve
(§1b); **"cheaper"** without saying tokens-per-success versus per-solved-run (§5); **"faster"**
measured on one thermally-shared laptop against an intermittently rate-limited upstream (§4.3,
§4.6); **"every other"** when gemini-cli is disabled and codex/pi are pending
(`runner/harnesses.json`); **"coding agent"** generalising from 12 tasks over 3 fixtures written
by the winner's author with no holdout (§1c, §4.8); and **"at equal quality"**, which 60
Bernoulli draws per harness cannot certify to better than ±25 pp (§1g).

Also not entitled, and tempting: any sentence using pass@k with k>1 in the headline (§2c); any
ranking on TTFT or tokens/sec (§3); any quality claim from the single-judge rubric before κ is
measured (§3).

---

## 7. Minimum changes that make the claim reachable

1. **Variance pilot first.** 3 tasks × 5 repeats × 2 harnesses ≈ 2 h. Produces `σ_task`, `σ_run`,
   fixture ICC. Every number in §1 is provisional until this exists. Nothing else should be run
   before it.
2. **`m = 5`, randomised interleaved rounds.** ~$50 and ~48 h of exclusive machine time.
3. **Proxy absorbs 429s** with one uniform retry policy; log the absorbed seconds.
4. **Normalise or at minimum log** `temperature`, `top_p`, `max_tokens`, `seed` per harness.
5. **Headline on tokens-per-success (§5)**, both-solved table demoted to secondary.
6. **Grow to ≥8 fixtures / ≥24 tasks** if the 30% figure must survive; the fixture clustering,
   not the task count, is the binding limit.
7. **Sealed holdout**, ≥6 tasks, ≥2 new fixtures, run once, published unconditionally.
8. **Pre-register** the analysis: primary metric, task set, exclusion rules, and the sign-test
   fallback — committed to git before the first scored run, so exclusions cannot be chosen after
   seeing who won.

## 8. Where I am uncertain, and what would settle it

| uncertainty | what settles it |
|---|---|
| `σ_task`, `σ_run` — every power number depends on them | the §7.1 variance pilot |
| fixture ICC (assumed 0.3) | variance components model over the pilot, tasks nested in fixtures |
| whether the true effect is 1.4× or 3× (§1e) | one full `m = 1` sweep, read as a pilot for effect size only, never published as a result |
| attempt-level ICC (assumed 0.5) | pass rates from the same pilot |
| whether harness temperature differences are real | read the request bodies already sitting in `proxy/requests.ndjson` — this is a 10-minute check and should be done today |
| single-judge rubric reliability | 3 judge passes + ~20 human-scored diffs → κ |
