# Framework — settled

Reconciles three independent reviews (`docs/review-statistics.md`,
`docs/review-instrumentation.md`, `docs/review-redteam.md`) against an external critique
(`docs/critique-external.md`). Where reviewers disagreed, the disagreement and the ruling are
recorded rather than smoothed over.

## Correctness blockers — nothing is measured until these are fixed

1. **`promptTokens` is not one quantity.** The OpenAI shape's `prompt_tokens` *includes* cache
   reads; the Anthropic shape's `input_tokens` *excludes* them. Every context-size, cache and
   drift number currently mixes two definitions, and the published fixed-context table
   understates the Anthropic-shape harness against all others. Normalise to
   `promptTokens = uncachedInput + cacheRead + cacheWrite` per shape, then re-measure the table.
2. **`cacheWriteTokens` is published but never captured.** Capture it or stop publishing it.
3. **Sampling parameters are not pinned.** The proxy forces model and provider but passes
   `temperature`, `top_p`, `max_tokens` and `seed` through as each harness chose them. A T=0
   harness against a T=1 harness is a different experiment, and that alone can exceed the
   effect being measured. Pin them, and record any harness that refuses.
4. **Retries sit on the timing path.** Each harness retries upstream 429s at its own rate, so
   rate-limit episodes are charged to whichever harness ran during them. The proxy absorbs
   429s under one uniform policy instead; residual retries are recorded, not excluded
   post-hoc, since post-hoc exclusion is a researcher degree of freedom.

## What we are entitled to claim

The stated goal was **-30% tokens and +30% speed to goal, at equal quality**, against the field.

- **"At equal quality" is unreachable here, at any budget.** The minimum detectable
  solve-rate gap with this corpus is roughly 25 points; a 10-point margin needs ~75 tasks.
  Attempts cannot buy this — only tasks can.
- **The token half is reachable but not at 12 tasks × 1 attempt.** Effective sample size is
  ~6, not 12, because tasks share fixtures. Detecting 30% needs 13-27 tasks at 3 attempts.
- **The speed half is marginal on one thermally-shared laptop.** Observed spread on the most
  trivial task was already wider than the effect sought.

Therefore the headline is **not** a percentage claim against the field. It is:

1. **Fixed context cost per harness** — the tokens billed for a task whose answer is one word.
   A 48x range across harnesses, measured at the wire, model-independent. The cleanest number
   the rig produces, and the one least able to be argued with.
2. **Per-task solve counts (k of m)** by category, published as counts, never as a mean.
3. **Portfolio cost-per-success** over all tasks with failures charged — reported with ranges
   and an explicit statement of uncertainty.

A directional token-efficiency claim (e.g. "≥1.8x on this corpus") becomes defensible via a
sign test across tasks. That is the honest ceiling of the current design.

## Metric rulings

**Kept as ranking metrics** — outcome first, always.
- Solve count per task; portfolio tokens- and cost-per-success; wall time with ranges.
- **Fixed context cost.** One reviewer argued context size is a model artefact; overruled — the
  bytes a harness puts on the wire are its own product, not the model's.
- **Cache hit rate.** Strongly harness-attributable via prefix stability, and it can dominate
  real cost independently of context size.

**Kept as diagnostics** — reported, never ranked: TTFT, tokens/sec, thinking time and its
distribution, context series, turn counts, tool mix, overhead ratio.

**Adopted from the critique**: cost and tokens per *successful* task; argument-validity rate;
redundant-call rate; edit blast radius (denominator = files the reference solution touched);
recovery after injected failure; static harness profile kept strictly out of the run score.

**Rejected, with reasons**:
- **Tool precision/recall/F1** — a category error across these harnesses. One has a single
  general code-execution tool (F1 = 1.0 by construction), another has four, another ten-plus,
  another none. Replaced by a **canonical action mix** — read / search / edit / write / exec /
  verify / delegate — classified from tool names and command text, published with a per-harness
  unclassified rate so the classifier's own failures stay visible.
- **"Slope of useful context"** — not computable. "Useful" has no operational definition here.
  Replaced by **prefix stability**: longest common prefix over consecutive message-hash arrays.
  It detects history rewrites that destroy cache, and it is a *correct* compaction detector,
  unlike the earlier ">25% prompt drop" heuristic which false-positives on subagent calls.
- **Private holdout** — theatre when one person writes the tasks, the graders and a competing
  harness. Reinstate only if an outside party holds it.
- **Public benchmark floor** (SWE-bench Verified / Terminal-Bench / polyglot) — 5-10 engineering
  days plus ~25h machine time per sweep on a rate-limited model. Correct eventually; not now.
- **Unauthorized read/write/egress** — no permission policy is stated in any task, so there is
  nothing to violate. Revisit when the corpus has tasks with explicit boundaries.
- **Plan-adherence LLM judge** — length-biased and expensive. Deferred behind the deterministic
  work.
- **20- vs 50-turn pass rate** — no harness exposes a uniform turn cap. Approximated by a proxy
  *request budget*, which is enforceable identically for everyone.

**Added, that nobody proposed**: prefix stability / cache-defeat index; retry amplification;
tool-result truncation rate; fixed-overhead decomposition; stray-file rate.

## Corpus bias — declared, not buried

All 12 tasks are zero-dependency TypeScript on Bun: the single environment where a persistent
JavaScript REPL is natively privileged, and our own harness is the one built around exactly
that. Four tasks require runtime-resolved values, which rewards executing code over reading it.
Meanwhile every rival runs with skills stripped for isolation while our harness ships its skills.

Corrections, in order:
1. Run our harness **twice** — skills on and off — so its skills contribution is a measured
   quantity rather than an unlabelled advantage.
2. Include one deliberately hostile control: a harness-neutral, read-only task in a language
   none of the corpus uses.
3. Publish this section with the results. A benchmark authored by a competitor is only worth
   the biases it declares.

## Run protocol

- Interleave harnesses within each round rather than sweeping one harness at a time, so
  thermal state and upstream rate limits fall on everyone equally.
- One run at a time; no other load on the machine.
- 3 attempts minimum for any published comparison; 1 attempt is a smoke test, not a result.
- A **variance pilot before anything else**: one task, every harness, repeated, to measure
  run-to-run spread. Every power calculation above is provisional until that exists.
- Include a trivial control harness (fixed script, no model) to expose rig overhead.
