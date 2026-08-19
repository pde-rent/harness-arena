# openrouter-shim

Local Bun proxy that sits between a coding agent and OpenRouter. It is the measurement +
control point for the four-way harness benchmark: it **forces** the model and the provider
pin on every request and **meters** every request into NDJSON.

Why it exists: OpenRouter provider pinning only works via the request-body field
`provider: { only: [...] }`. `ori` only lets a harness pass `--model <id>`, and no harness
exposes provider routing — so the pin must be injected in-flight.

## Run

```sh
source ~/.prime-bench.env          # OPENROUTER_API_KEY, BENCH_MODEL, BENCH_PROVIDER_ONLY
bun run server.ts --port 8791      # omit --port (or 0) to get a free port, printed on start
```

Startup prints the base URL. Point every harness at:

```
http://localhost:<port>/v1
```

`/v1`, `/api/v1` and a bare path all work (`/v1/chat/completions`, `/chat/completions`, …).
Any `Authorization` / `x-api-key` the client sends is **discarded** and replaced with the
real key from the environment, so harnesses can be given a dummy key.

## Env

| Var | Default | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | — | required; read from env, never written to disk |
| `BENCH_MODEL` | `deepseek/deepseek-v4-flash-0731` | forced into every request body |
| `BENCH_PROVIDER_ONLY` | `deepinfra/fp8` | injected as `provider.only[0]`, `allow_fallbacks:false` |
| `BENCH_LOG` | `./requests.ndjson` | metering file (appended) |
| `BENCH_RUN_ID` | `no-run-id` | stamped on every row |
| `BENCH_HARNESS` | `unknown` | stamped on every row — start one proxy per harness |
| `BENCH_TOKENIZER_DIR` | `./tokenizer` | vendored vocabulary used for our own counts |
| `BENCH_TOKENIZER_ID` | `deepseek-ai/DeepSeek-V4-Flash-0731` | recorded on every row |
| `BENCH_CAPTURE_DIR` | *(off)* | if set, every rewritable request body is written here for audit |

`BENCH_RUN_ID` / `BENCH_HARNESS` are read at **start**, so the runner should launch a fresh
proxy per harness run (or per run id) and point that harness at its port.

## Pin gate (hard-fail) — default on

A request the shim cannot pin is **refused**, not proxied. An unmeasurable request is worse
than a failed one: unpinned pass-through is how non-benchmark models got billed
(`~/Work/harness-arena/docs/model-leak-audit.md`).

- Not a rewritable shape, and not a GET/HEAD to a non-billable metadata path
  (`/models…`, `/generation`, `/key`, `/credits`, `/auth…`) → **403**, `violation:
  "unpinnable_path"`, NDJSON row written, `REFUSED …` on stderr. (e.g. a Gemini
  `:generateContent` post, `/embeddings`.)
- Rewritable path with a missing / non-JSON body, so `model` could not be forced → **403**,
  `violation: "unparseable_body"`.
- `BENCH_ALLOW_UNPINNED=1` opts out for deliberate exploration. The pass-through is still
  logged with `violation: "unpinned_passthrough"` — never silent.

## Never launch a measured run through `ori`

`ori <harness>` rewrites the harness base URL back to `https://openrouter.ai/api/v1` and
injects the key, so the proxy never sees the traffic: no model force, no provider pin, no
metering row, and any auxiliary call (session titles, model routers, weak models) is billed
against whatever model the harness picked. Wire each harness to the proxy through its own
native mechanism instead.

## What gets rewritten

For `/chat/completions`, `/completions` (OpenAI shape), `/messages` (Anthropic shape) and
`/responses` (OpenAI Responses shape — what codex 0.147 speaks, it dropped chat completions):

- `model` → `$BENCH_MODEL`
- `provider` → `{ only: ["$BENCH_PROVIDER_ONLY"], allow_fallbacks: false }`
- OpenAI shape only: `usage: { include: true }` and, when `stream:true`,
  `stream_options: { include_usage: true }` (this is what makes the final usage chunk appear;
  verified live).

Every other path (`/models`, `/generation`, …) is passed through untouched with the real key.

## Streaming

The upstream reader is pumped by the shim, which enqueues each chunk to the client *before*
parsing it. Nothing is buffered; `ttfbMs` is measured at the first byte actually forwarded.
Verified: SSE lines arrive at the client incrementally (~100 ms apart) while the usage row is
still written at stream end. The pump keeps draining upstream even if the client detaches
mid-stream, so an aborting harness cannot lose its usage row.

## NDJSON columns

| Field | Meaning |
|---|---|
| `ts` | ISO timestamp, request completion |
| `runId`, `harness` | from `BENCH_RUN_ID` / `BENCH_HARNESS` |
| `requestId` | proxy-local unique id |
| `path` | normalized upstream path (`/chat/completions`, `/messages`, …) |
| `model` | model reported by the response (proves the force worked) |
| `providerServed` | `provider` from the response / SSE (`"DeepInfra"` when the pin holds) |
| `streamed` | request had `stream:true` |
| `promptTokens` / `completionTokens` / `totalTokens` | usage |
| `reasoningTokens` | reasoning/thinking tokens |
| `cachedTokens` | prompt tokens served from cache |
| `costUsd` | OpenRouter-reported cost for the call |
| `ttfbMs` | ms from request receipt to first upstream byte forwarded |
| `totalMs` | ms to full response / stream end |
| `status` | upstream HTTP status (`0` = transport failure) |
| `error` | `null`, or upstream error body (truncated 500 chars) |

If a stream carries no usage, the proxy falls back to `GET /api/v1/generation?id=<id>`
(retried up to 5x with backoff). In live testing the fallback was never needed — the usage
chunk always arrived.

## Independent token accounting

Every row also carries token counts **we** computed, from the wire, with one tokenizer — the
benchmark model's own vocabulary, vendored at `proxy/tokenizer/`, zero network access. Provider
numbers are kept beside ours as `providerReported*`, never in place of them. Full method, caveats
and live evidence: `~/Work/harness-arena/spec/token-accounting.md`.

| Field | Meaning |
|---|---|
| `tokenizer`, `tokenizerSha256`, `tokenizerVocab` | which vocabulary produced our counts |
| `contextTokens` | whole request content, tokenized as one string — the context we put on the wire |
| `systemTokens` | system prompt / system instruction |
| `toolSchemaTokens` | tool & function definitions (+ non-string `tool_choice`) |
| `historyTokens` | prior turns: earlier user messages and every assistant turn |
| `toolResultTokens` | tool output fed back in |
| `currentTurnTokens` | the newest user message |
| `segmentSumTokens`, `segmentReconcileDelta`, `segmentReconcileOk` | the five segments must reconcile with `contextTokens`; a delta over 5 logs loudly |
| `toolCount`, `messageCount`, `toolResultCount` | shape-independent structure counts |
| `cacheControlBreakpoints` | explicit `cache_control` markers the harness set |
| `outputContentTokens` / `outputReasoningTokens` / `outputToolCallTokens` / `outputTokens` | generated tokens counted from the stream deltas, not the usage chunk |
| `providerReported*` | the provider's own prompt/completion/reasoning/cached/total |
| `promptDivergence`, `promptDivergenceRatio`, `outputDivergence` | ours minus theirs; on a caching harness this gap is the finding |

`costUsd` remains **provider-derived** — we count tokens, we do not price them.

Tokenizing is deferred until after the upstream response, so it can never inflate `ttfbMs`.
Vocabulary load (~200 ms) happens once at proxy startup.

### Extra scripts

```sh
bun run verify-accounting.ts                 # live: one one-word prompt per harness, 3 shapes
bun run verify-offline.ts                    # proves tokenizing needs no network
bun run validate-tokenizer.ts                # differential test vs transformers.js (dev dep)
uv run --with tokenizers validate-tokenizer.py cases.json   # vs the HF Rust original
```

`BENCH_CAPTURE_DIR=<dir>` (opt-in, off by default) writes every rewritable request body to disk so
a segment attribution can be audited or re-segmented after a run.

## Summary

```sh
bun run summary.ts requests.ndjson
```

Per-harness table: requests, errors, prompt/completion/reasoning/cached/total tokens, cost,
p50/p95 ttfb, summed wall time. Then it asserts every 200 row's `providerServed` matches
`$BENCH_PROVIDER_ONLY`; violations are printed loudly and the process exits `1`.

## Limitations / notes

- **Anthropic `/v1/messages` is handled.** OpenRouter exposes a native Anthropic-shaped
  endpoint at `/api/v1/messages` that accepts the `provider` field, so Claude Code via `ori`
  works: verified 200, `model` forced, `provider":"DeepInfra"`, usage metered (streamed and
  non-streamed). Usage is assembled from `message_start` (input) + `message_delta` (output).
- On the Anthropic shape, `reasoningTokens` (`output_tokens_details.thinking_tokens`) can
  exceed `completionTokens` — upstream reports them on a slightly different basis. Treat
  reasoning as indicative, not as a subset of completion, for that shape.
- Only the body shapes above are rewritten. A harness posting to some other completion
  path (e.g. Gemini `:generateContent`) is now **refused with 403** rather than proxied
  unpinned — see "Pin gate" above. Supporting a new harness shape means teaching the shim
  to rewrite it, not relaxing the gate.
- **`/responses` provider name is looked up, not read.** That shape carries the provider
  nowhere — not in the body, not in a response header (only `X-Generation-Id` is exposed)
  — so `providerServed` comes from `GET /api/v1/generation`. OpenRouter does not index a
  *streamed* generation immediately (404 for the first ~6 s), so the lookup backs off up
  to 31 s: a `/responses` row can be appended up to ~30 s **after** the harness process
  exited. Token counts still come from the stream's own usage, so they stay comparable
  with the other shapes. Non-`/responses` rows are unaffected.
- **Streams are drained eagerly, not piped.** Some harnesses (codex, hermes) abort the
  response body as soon as they have the final text. A `pipeThrough`/`flush` tap loses the
  whole usage row when that happens, so the shim pumps the upstream reader itself and
  keeps reading for metering after the client detaches.
- `BENCH_RUN_ID` / `BENCH_HARNESS` are process-level, not per-request; there is no header
  override. One proxy per harness.
- Non-streamed responses are buffered (single JSON, negligible); streamed are not.
- The log file is appended with `appendFileSync` — single process per file is assumed.
