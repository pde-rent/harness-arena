# Independent token accounting

Token measurement no longer depends on any provider's or harness's self-report. Every request and
every response is counted by us, at the wire, with **one tokenizer applied identically to every
harness**. Provider-reported numbers are still recorded — beside ours, never instead of them — and
the divergence between the two is published, because on a caching harness that gap *is* the
finding.

This closes correctness blocker 1 in `framework.md` and answers `docs/fixed-context-open-question.md`.

## The problem it replaces

The old table read the provider's `usage` block. That block does not mean the same thing twice:

- OpenAI-shape `prompt_tokens` **includes** cache reads.
- Anthropic-shape `input_tokens` **excludes** them.
- Harnesses that set `cache_control: {type: "ephemeral"}` breakpoints report a small *uncached*
  prompt while sending the same context.

Measured live, on the same harness, on the same one-word task, with a byte-identical request body:

| run | our `contextTokens` | provider `input_tokens` | provider cache read |
|---|---|---|---|
| claude, run A | 18,768 | **69** | 19,456 |
| claude, run B | 18,768 | **18,757** | 768 |

The provider's number moved by **272x** between two runs of the same prompt. Ours did not move at
all. Any table built on the provider's number was measuring cache weather, not harness design.

## The tokenizer

| | |
|---|---|
| model | `deepseek/deepseek-v4-flash-0731` |
| tokenizer | `deepseek-ai/DeepSeek-V4-Flash-0731` — the model's **own** vocabulary |
| vendored at | `proxy/tokenizer/tokenizer.json` (6.4 MB), `tokenizer_config.json`, `config.json` |
| sha256 | `8f9f37ca37fdc4f5fd36d5cf4d3b0e8392edb4e894fd10cc0d70b4957c8633cf` |
| type | byte-level BPE, 128,000 vocab, 127,741 merges, 1,283 added tokens, no normalizer |
| implementation | `proxy/tokenizer.ts` — pure TS, **zero runtime dependencies** |

The real tokenizer was obtainable, so no substitute was needed. It is vendored on disk and the
sha256 is recorded on every metering row (`tokenizerSha256`), so a run can be proved to have used
this exact vocabulary.

`proxy/tokenizer.ts` is our own implementation rather than a library because every JS binding for
HF tokenizers drags a native toolchain (`@huggingface/transformers` pulls `onnxruntime` and
`sharp`; the Node entry point fails to load on this machine at all). A measurement instrument that
cannot be installed reproducibly is not an instrument. 150 lines of byte-level BPE, differential
tested, is the smaller risk.

### Is it exact?

**Exact for the model's vocabulary. Not the biller's count.** Both halves matter.

*Exact for the vocabulary*: our encoder was differential-tested against two independent reference
implementations and produced **byte-identical token id sequences** on every case:

| reference | cases | tokens | result |
|---|---|---|---|
| `@huggingface/transformers` (transformers.js) | 3,067 | 148,256 | 3,067/3,067 identical |
| `tokenizers` (the HuggingFace Rust original, via `uv run`) | 2,019 | 122,229 | 2,019/2,019 identical |

Cases: curated adversarial strings (CJK, Cyrillic, Arabic, emoji + ZWJ sequences, digit runs,
whitespace runs, CRLF, special tokens, code, URLs, JSON), every string field of real captured
harness traffic, and ~5,000 seeded random strings over a mixed alphabet. Reproduce with
`bun run validate-tokenizer.ts` and `uv run --with tokenizers validate-tokenizer.py`.

*Not the biller's count*: what a harness puts on the wire is JSON. What the model is billed for is
the serving stack's rendered prompt — the chat template's role markers and turn delimiters, plus
whatever format the provider renders tool schemas into. Neither is observable from the proxy, and
the model's `tokenizer_config.json` ships no `chat_template`, so the rendering cannot even be
reconstructed. We therefore count **the content the harness sent**, not the final rendered prompt.

Measured, that puts us consistently *below* the provider on every shape:

| harness | shape | ours | provider prompt | ours ÷ theirs |
|---|---|---|---|---|
| codex | `/responses` | 8,620 | 9,655 | 0.893 |
| prime-agent-fork | `/chat/completions` | 3,623 | 3,847 | 0.942 |
| opencode | `/chat/completions` | 6,946 | 7,329 | 0.948 |
| claude | `/messages` | 18,767 | 19,269 | 0.974 |

A 6-11% shortfall — the per-message and per-tool envelope — and it is *stable*: the same harness
reproduces its own ratio to 4 decimal places across runs (opencode 0.9477 / 0.9478 / 0.9465 /
0.9463 on four separate calls). It varies across harnesses only because harnesses differ in how
many messages and tools they send, which is precisely the property being measured.

So: **a consistent estimator for cross-harness comparison, not the biller's count.** That is a
legitimate basis for ranking harnesses against each other and an illegitimate basis for predicting
an invoice. Both claims are stated on the table wherever these numbers are published; neither is
allowed to stand in for the other.

The rows above are also the reason a shape-specific correction is *not* applied. The residual is
harness-specific, not shape-specific, so "correcting" it would be fitting noise.

## Segment attribution

Every token-bearing field of a request is assigned to exactly one of five segments:

| segment | definition |
|---|---|
| `systemTokens` | system prompt / system instruction, wherever the shape puts it |
| `toolSchemaTokens` | tool & function definitions, plus a non-string `tool_choice` |
| `historyTokens` | prior conversation turns: earlier user messages, and **every** assistant turn, including those this agentic loop has already produced. The segment that grows as a run goes on. |
| `toolResultTokens` | tool output fed back in, anywhere in the conversation |
| `currentTurnTokens` | the newest user message — the instruction the model is answering now |

### Where each segment lives, per request shape

| segment | `/chat/completions` (OpenAI) | `/messages` (Anthropic) | `/responses` |
|---|---|---|---|
| system | messages with `role: system \| developer` | top-level `system` (string or block array) | top-level `instructions`, plus `input` items with `role: system \| developer` |
| toolSchema | `tools[].function` / legacy `functions[]` | `tools[]` (`input_schema`) | `tools[]` (`parameters`) |
| toolResult | messages with `role: tool \| function` | `tool_result` **blocks**, which live inside a *user* message | `function_call_output`, `computer_call_output`, `local_shell_call_output`, `custom_tool_call_output` items |
| currentTurn | the last `role: user` message | the last user message carrying a non-`tool_result` block | the last `type: message, role: user` item |
| history | every other message, incl. `tool_calls` | every other block | every other item, incl. `function_call` and `reasoning` |

The Anthropic shape is the one that needs block-level rather than message-level classification: a
tool result is a *block inside a user message*, so classifying by message role would charge tool
output to the user turn.

Serialization rules, applied identically everywhere: tool schemas and tool-call arguments are
tokenized as key-sorted JSON (`stable()`), so the same schema always yields the same number
regardless of key order; text blocks are tokenized verbatim; blocks with no text (images) are
recorded by reference only, since this tokenizer does not price them.

### The sum-to-total assertion

`segmentSumTokens` is the sum of the five segments. `contextTokens` is the *same content*
tokenized as one string. These are not trivially equal — BPE can merge across the joins between
segments — so both are computed and the difference stored as `segmentReconcileDelta`, with
`segmentReconcileOk` false and a loud stderr line whenever `|delta| > 5`.

Observed: **delta = 0 on every live request measured**, across all three shapes, single-turn and
multi-turn. (A contrived 29-token body produced delta = 1, which is the expected boundary effect.)

## Output side

Generated tokens are counted from the streamed deltas, not from the final usage chunk, and split
three ways:

- `outputContentTokens` — visible content
- `outputReasoningTokens` — reasoning / thinking
- `outputToolCallTokens` — tool names and argument JSON
- `outputTokens` — their sum

Per shape: OpenAI `choices[].delta.{content,reasoning,reasoning_content,tool_calls}`; Anthropic
`content_block_delta.delta.{text,thinking,partial_json}` plus `content_block_start`; responses
`response.*.delta` typed events. The responses shape re-sends the whole output in
`response.completed` — that object is deliberately ignored so nothing is counted twice. Complete
non-streamed bodies are handled by a separate path.

## Provider numbers are kept

Every row carries both sides and the gap:

`providerReportedPromptTokens` · `providerReportedCompletionTokens` ·
`providerReportedReasoningTokens` · `providerReportedCachedTokens` · `providerReportedTotalTokens` ·
`promptDivergence` · `promptDivergenceRatio` · `outputDivergence`

Plus `cacheControlBreakpoints`: how many explicit `cache_control` markers the harness put in the
body. A harness with a low reported prompt and a high breakpoint count is caching, not economising.

## Cost stays provider-derived

`costUsd` is still OpenRouter's figure for the call, unchanged. We can count tokens; we cannot
price them — the route's per-class rates (fresh input, cache read, cache write, output) are not
exposed per request, and a self-computed price would be a guess dressed as a measurement. Cost is
labelled provider-derived wherever it is published. This is deliberate and is the one number in
the table that is not independently measured.

## Verification

All live, one-word prompt (`corpus/tasks/smoke-ok`: *"reply with exactly: ok"*), each harness in
its pinned container, each behind its own metering proxy. Reproduce with
`bun run proxy/verify-accounting.ts`.

### Three request shapes, one basis

| harness | shape | system | toolSchema | history | toolResult | currentTurn | **sum** | **context** | delta |
|---|---|---|---|---|---|---|---|---|---|
| prime-agent-fork | `/chat/completions` | 3,502 | 116 | 0 | 0 | 5 | 3,623 | 3,623 | 0 |
| opencode | `/chat/completions` | 2,068 | 4,871 | 0 | 0 | 7 | 6,946 | 6,946 | 0 |
| claude | `/messages` | 1,405 | 15,844 | 1,438 | 0 | 80 | 18,767 | 18,767 | 0 |
| codex | `/responses` | 5,185 | 3,331 | 99 | 0 | 5 | 8,620 | 8,620 | 0 |

Five-fold spread in fixed context cost, three different request shapes, one tokenizer, segments
reconciling exactly. The provider-reported column for the same four calls spans 69 … 19,269 for
contexts that differ by 5x — it is not measuring the same quantity twice.

The decomposition is also where the answer lives: prime-agent-fork's 3,623 is 97% system prompt
with one tool, while claude's 18,767 is 84% **tool schemas** across 24 tools. Those are different
engineering decisions, and the single number hid which was which.

### Multi-turn, with tool results

opencode, prompt *"run the shell command: echo hi — then reply with exactly what it printed"*:

| turn | system | toolSchema | history | toolResult | currentTurn | sum | context | delta |
|---|---|---|---|---|---|---|---|---|
| 1 | 2,068 | 4,871 | 0 | 0 | 17 | 6,956 | 6,956 | 0 |
| 2 | 2,068 | 4,871 | 43 | 2 | 17 | 7,001 | 7,001 | 0 |

The fixed segments stay fixed, the assistant's tool call lands in `history` (43), and the two
tokens of `hi` land in `toolResult`. Turn-over-turn growth is attributed rather than aggregated.

### The opencode contradiction — resolved

The open question was: opencode's tool descriptions were estimated at ≈11k tokens, yet its observed
prompt was 6,172. Both cannot be true.

**The 11k estimate is wrong.** Measured with the model's own tokenizer, from the captured request
body, opencode ships **10 tools totalling 4,871 tokens**:

| tool | tokens | | tool | tokens |
|---|---|---|---|---|
| bash | 1,278 | | todowrite | 635 |
| task | 839 | | edit | 446 |
| read | 427 | | webfetch | 313 |
| grep | 294 | | glob | 252 |
| write | 239 | | skill | 148 |

4,871 tool schemas + 2,068 system + 7 user = **6,946**, against a provider-reported 7,329. The
6,172 observation was therefore approximately right and the 11k estimate was not: 4,871 fits inside
6,172 comfortably, 11k never could. The 11k figure appears to have counted opencode's full set of
tool prompt sources rather than the ten tools actually enabled and sent in this configuration —
"the descriptions are not all sent" was the correct branch of that question.

A second correction falls out of the same measurement: **opencode set zero `cache_control`
breakpoints** in the pinned container configuration (`cacheControlBreakpoints: 0`), yet the
provider reported 7,168 of its 7,329 prompt tokens as cache reads. The caching is the provider's
own automatic prefix caching, not a harness-declared breakpoint. `fixed-context-open-question.md`
attributes explicit ephemeral breakpoints to opencode; that is not what this configuration does.
claude is the harness that sets them here (3 per request).

### Offline

Tokenization requires no network at measurement time. Proof, reproducible:

```sh
podman run --rm --network=none -v $PWD:/work:ro -w /work \
  --entrypoint bun bench/prime-agent-fork:pinned run /work/verify-offline.ts
```

Runs in a container with **no network device at all**, with `globalThis.fetch` additionally
replaced by a throwing stub, and still loads the vocabulary, tokenizes, and segments a request.
`tokenizer.ts` and `accounting.ts` import only `node:fs`, `node:path` and `node:url`. The
`@huggingface/transformers` dev dependency exists solely for `validate-tokenizer.ts` and is never
imported by the proxy.

Cost: ~200 ms to load the vocabulary at proxy startup, ~4 µs per token thereafter, with a piece
cache that makes the re-sent system prompt and tool schemas nearly free after the first turn.
Segmentation is deliberately deferred until after the upstream response so it can never inflate
`ttfbMs`.

## What still depends on someone else's numbers

Stated plainly, because the point of this document is that unmeasured quantities get labelled:

1. **`costUsd` is the provider's.** See above. Not independently derivable.
2. **The cache split is the provider's.** We can see *that* a harness declared breakpoints, and we
   can see the whole context we sent, but which tokens were served from cache is knowable only from
   `cache_read_input_tokens` / `prompt_tokens_details.cached_tokens`. `contextTokens` is ours;
   `cacheHitRate` is theirs.
3. **Our output count is a lower bound on tool-call turns.** On a text turn the gap is ~2 tokens
   (end-of-message framing). On a turn whose entire output was a tool call we counted 8 tokens
   against a reported 45: the provider parses the model's raw function-call syntax out of the
   stream before we see it, and bills for framing that never reaches the wire. Direction is known
   and constant (ours ≤ theirs); the magnitude is not recoverable from the proxy. Use
   `outputContentTokens` / `outputReasoningTokens` for the split, and the provider's total when the
   absolute output count matters.
4. **The chat template and server-side tool rendering are unobservable** — the 6-11% shortfall
   documented above.

Everything else — context size, its five-way decomposition, turn-by-turn growth, and the
cross-harness comparison built on them — is computed here, from the wire, by one function.

## Files

| | |
|---|---|
| `proxy/tokenizer.ts` | byte-level BPE over the vendored vocabulary; zero deps |
| `proxy/tokenizer/` | vendored `tokenizer.json` + configs |
| `proxy/accounting.ts` | segmentation per shape, output accumulation, reconciliation |
| `proxy/server.ts` | wiring: measures after the response, writes the columns to NDJSON |
| `proxy/validate-tokenizer.ts` · `.py` | differential tests against the two references |
| `proxy/verify-accounting.ts` | live three-shape verification run |
| `proxy/verify-offline.ts` | the no-network proof |
| `proxy/summary.ts` | per-harness table, ours beside theirs |
