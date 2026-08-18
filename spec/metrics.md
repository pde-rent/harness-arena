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
| `ttftMs` | time to first token of this response |
| `durationMs` | request start → last byte |
| `promptTokens` | **context size at this turn** |
| `completionTokens`, `reasoningTokens` | generated |
| `cachedTokens` | prompt tokens served from cache |
| `toolCallsIssued` | tool calls in this response |
| `toolCallNames` | their names, for a tool-mix histogram |
| `toolResultsIn` | tool results carried into this request |
| `toolResultBytesIn` | how much tool output re-entered context |
| `messagesIn` | conversation length at this turn |
| `providerServed` | must match the pin, else the run is discarded |
| `costUsd`, `status`, `error` | billing + failures |

## Per-run metrics (derived)

**Speed**
- `ttftMs` — time to first token of the *run* (first request's `ttftMs`). What the user feels.
- `wallMs` — process start → exit. Time to completion, including harness startup.
- `generationMs` — summed response durations. Wall minus this is harness overhead (tooling,
  file IO, its own thinking) — a real and rarely-reported cost.
- `tokensPerSec` — completion tokens ÷ generation seconds.
- `overheadRatio` — `(wallMs - generationMs) / wallMs`.

**Effort**
- `turns` — request count. The loop length.
- `totalTokens`, `promptTokens`, `completionTokens`, `cachedTokens`.
- `tokensPerTurn` — mean and max.
- `toolCalls` — total, and per turn.
- `toolMix` — histogram of tool names. Reveals *strategy*: greps vs reads vs edits vs shell.

**Drift** — does the harness get more expensive as the task goes on?
- `contextSeries` — `promptTokens` by turn. Its slope is context growth per turn.
- `contextGrowthPerTurn` — least-squares slope over the series.
- `contextFinal / contextFirst` — how much the conversation inflated end to end.
- `tokenDrift` — slope of total tokens per turn. Flat is good; a rising slope means the
  harness is re-sending an ever-larger conversation to make the same amount of progress.
- `compactions` — turns where `promptTokens` dropped sharply (a summarisation/compaction
  event). Detected as a drop of >25% versus the previous turn.

**Outcome**
- `solved` — the deterministic grader, and nothing else.
- `outcome` — `solved | verify_failed | timeout | harness_error | discarded_unpinned`.

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
