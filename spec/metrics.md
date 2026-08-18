# Measurement contract

Everything here is derived from one source: the proxy sees every model request a harness
makes, so every harness is measured identically regardless of what it reports about itself.
Harness-native usage output is recorded when available, but only ever as a **cross-check** —
never as the number we publish.

## Why the proxy is the instrument

A coding agent's turn loop is visible from the wire without understanding the harness:

- a **request** carries the whole conversation so far → its prompt-token count *is* the
  context size at that moment, and the message array length is the turn depth;
- the **response** carries the assistant turn → completion tokens, reasoning tokens, and any
  tool calls it decided to make;
- the **next request** carries the tool results → what the tools returned, and how many bytes
  of it re-entered context.

So context growth, tool-call rate, and token drift all fall out of the request sequence. No
harness-specific parsing, no cooperation from the harness required.

## Per-request record (`requests.ndjson`)

One row per model request. This is the raw telemetry; everything else is derived.

| field | meaning |
|---|---|
| `runId`, `harness`, `task`, `attempt` | run identity |
| `seq` | 0-based index of this request within the run — the turn number |
| `tRequestMs` | ms since run start when the request was issued |
| `ttftMs` | time to first token of any kind |
| `ttfReasoningMs` | time to first reasoning token (null if the turn did not think) |
| `ttfContentMs` | time to first *visible* token — what the user actually waits for |
| `thinkingMs` | first reasoning token → first content token: the visible stall |
| `generationMs` | first token → last token |
| `durationMs` | request issued → last byte |
| `inputTokens` | prompt tokens billed at full rate (uncached) |
| `cacheReadTokens` | prompt tokens served from cache (cheap) |
| `cacheWriteTokens` | prompt tokens written into cache (premium) |
| `promptTokens` | all of the above — **context size at this turn** |
| `outputTokens` | visible completion tokens |
| `reasoningTokens` | thinking tokens (billed as output, invisible to the user) |
| `toolCallsIssued` | tool calls in this response |
| `toolCallNames` | their names, for a tool-mix histogram |
| `toolResultsIn` | tool results carried into this request |
| `toolResultBytesIn` | how much tool output re-entered context |
| `messagesIn` | conversation length at this turn |
| `providerServed` | must match the pin, else the run is discarded |
| `costUsd` | priced per class, not from a flat token count |
| `status`, `error`, `retryOf` | failures and retries |

Token classes are kept separate everywhere because they do not cost the same. A cache read is
roughly an order of magnitude cheaper than a fresh input token, so a harness with a large but
highly-cached prompt can be cheaper in money than a harness with a small uncached one — while
still being slower, because cached or not, those tokens still traverse the context window.
Both readings are reported; neither is allowed to stand in for the other.

Note on terminology: caching applies to the **input** side. There is no such thing as a cached
output token — output is generated fresh every turn. What varies on the output side is the
split between `outputTokens` (visible) and `reasoningTokens` (thinking), which are billed the
same but felt very differently by a user waiting at a prompt.

## Per-run metrics (derived)

**Speed**
- `ttftMs` — time to first token of the *run*. What the user feels before anything happens.
- `ttfContentMs` — time to the first *visible* token. On a thinking model this is the number
  that matches the felt experience; `ttftMs` alone flatters a harness that streams reasoning.
- `wallMs` — process start → exit. Time to completion, including harness startup.
- `generationMs` — summed response durations. Wall minus this is harness overhead (its own
  tooling, file IO, orchestration) — a real and rarely-reported cost.
- `tokensPerSec` — output tokens ÷ generation seconds.
- `overheadRatio` — `(wallMs - generationMs) / wallMs`.
- `firstEditMs` — time until the first file mutation in the workdir. How long the harness
  reads before it starts doing. Measured by watching the workdir, not the wire.

**Thinking**
- `thinkingMsTotal` — summed `thinkingMs`, and its share of `wallMs`.
- `reasoningTokensTotal`, and `reasoningShare` = reasoning ÷ (reasoning + output).
- `thinkingByTurn` — `thinkingMs` per turn. Rising means the harness is deliberating more as
  context grows; falling means it settles into execution. Both are informative, neither is
  automatically better.
- `thinkingPerTurnSlope` — least-squares slope over that series, in ms per turn.
- `thinkingFrontloaded` — share of total thinking spent in the first third of turns. A harness
  that plans once and executes beats one that re-deliberates every turn, at equal outcome.

**Effort**
- `turns` — request count. The loop length.
- Token totals per class: `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens`,
  `reasoningTokens`, and `totalTokens`.
- `cacheHitRate` — `cacheReadTokens ÷ promptTokens`. The difference between an expensive
  harness and a cheap one is often here, not in context size.
- `costUsd` — priced per class. Reported beside raw tokens, never instead of them.
- `tokensPerTurn` — mean and max.
- `toolCalls` — total, and per turn.
- `toolMix` — histogram of tool names. Reveals *strategy*: greps vs reads vs edits vs shell.
- `actionRate` — share of turns that issued at least one tool call. The remainder are turns
  spent talking rather than acting.
- `toolResultShare` — `toolResultBytesIn` as a share of prompt growth. Separates harnesses that
  paste whole files into context from ones that read surgically.
- `redundantToolCalls` — repeated identical calls (same tool, same arguments). Re-reading a
  file it already has is pure waste and shows up nowhere else.
- `peakContext` and its share of the model's window — how close it came to the ceiling.

**Drift** — does the harness get more expensive as the task goes on?
- `contextSeries` — `promptTokens` by turn. Its slope is context growth per turn.
- `contextGrowthPerTurn` — least-squares slope over the series.
- `contextFinal / contextFirst` — how much the conversation inflated end to end.
- `tokenDrift` — slope of total tokens per turn. Flat is good; a rising slope means the
  harness is re-sending an ever-larger conversation to make the same amount of progress.
- `compactions` — turns where `promptTokens` dropped sharply (a summarisation/compaction
  event). Detected as a drop of >25% versus the previous turn. Recorded with how many tokens
  were reclaimed and whether the run still succeeded afterwards — a compaction that loses the
  thread is worse than one that never fired.
- `costDrift` — slope of per-turn cost. Diverges from `tokenDrift` whenever cache behaviour
  changes mid-run, which is exactly when it is worth knowing.

**Outcome**
- `solved` — the deterministic grader, and nothing else.
- `outcome` — `solved | verify_failed | timeout | harness_error | discarded_unpinned`.
- `retries` — upstream 429/5xx retries. They inflate wall time without being the harness's
  fault, so affected runs can be excluded from timing comparisons.
- `goodput` — tokens spent per unit of progress, where progress is the grader's own signal
  (tests turned green, required artifacts produced). The efficiency number that survives
  contact with a task the harness failed.

## Quality review (separate axis, never decides pass/fail)

The grader answers *did it work*. It cannot answer *is this good work*. So each solved run's
diff is additionally scored 1-5 on:

- **correctness** — beyond the grader: does it hold for inputs the tests do not cover?
- **completeness** — did it do the whole task, including the parts not tested?
- **elegance** — would a reviewer merge this, or ask for it to be rewritten?
- **restraint** — did it change only what the task required? Drive-by edits, stray files,
  reformatting, and dead scaffolding all cost points.

Scored blind: the reviewer sees the task and the diff, never the harness name. A fixed rubric
with worked examples per score, and the same reviewer model for every run. Reported as a
separate table beside the deterministic results — a harness that passes the grader with an
unmaintainable diff has not actually won.

## Reporting rules

- Token and time comparisons are computed **only over tasks both harnesses solved**, so
  giving up early can never look like efficiency.
- Medians across attempts, never means — one slow run must not decide a comparison.
- Solve rate is reported first, separately, and dominates: a harness that solves more tasks
  is better even if its efficiency numbers are worse.
- Every discarded run is listed with its reason.
- Fixed context cost (the one-word-task floor) is published per harness, because it is the
  tax every turn of every task pays.

## Collection hazards

Real failures found while building the rig. Each one silently produces *plausible but wrong*
numbers, which is worse than an obvious crash.

- **Aborted response bodies.** Several harnesses stop reading the stream as soon as they have
  the text they want. A tap that only parses on stream completion loses the entire usage
  record — the run looks free. The proxy therefore drains upstream eagerly rather than relying
  on the client finishing the body.
- **Late-arriving rows.** Where the provider is not carried in the response, it has to be
  resolved by a follow-up lookup that can 404 for several seconds. A metering row can land
  ~30s *after* the harness process exits. The runner waits for the log to go quiet before
  folding usage, instead of reading it at exit.
- **Self-reported usage is not evidence.** One harness reports a cost figure computed at a
  different vendor's prices than the route actually used. Harness-native numbers are recorded
  only to cross-check the wire, never to replace it.
- **Exit codes lie.** At least one harness exits 0 after its model call failed outright.
  Grading uses the deterministic verifier; exit codes are recorded, not trusted.
- **Provider drift.** An unpinned request is served by whichever provider is cheapest at that
  moment. Any run whose `providerServed` is not the pin is discarded and listed, never
  silently included.
