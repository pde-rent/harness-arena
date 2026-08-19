# Provider SDK elimination — packages/ai

Analysis only. No production code written. `~/Work/optimus-prime` treated read-only.
All weights measured on this machine (bun/esbuild), not estimated.

## TL;DR

| SDK | Installed (transitive) | Bundle | Verdict | New code |
|---|---|---|---|---|
| `openai` | 1 pkg / 11.4 MB | 371 KB | **REMOVE** | ~200–280 LOC (≈150 already exists) |
| `@mistralai/mistralai` | 4 pkgs / 11.4 MB | 1120 KB | **REMOVE** | ~60–90 LOC |
| `@anthropic-ai/sdk` | 4 pkgs / 4.3 MB | 251 KB | **REMOVE** | ~180–260 LOC |
| `@google/genai` | 41 pkgs / 30.3 MB | 1264 KB | **REMOVE** — keep Gemini API, **DROP Vertex** | ~250–350 LOC |
| `@aws-sdk/client-bedrock-runtime` | 28 pkgs / 5.4 MB | 0 KB (lazy, unbundled) | **DROP THE PROVIDER** | 0 LOC (or ~450–700 if kept bearer-only) |

Totals removed: **78 npm packages, 62.8 MB on disk, ~3.0 MB of the 13 MB bundle (23%)**.
`packages/ai` runtime deps: **11 → 2**. Whole product: **30 → 24**. ≤10 is *not* reachable by
cutting SDKs — see §8.

Free win found on the way: **`chalk`, `undici`, `zod-to-json-schema` are declared in
`packages/ai/package.json` and imported nowhere in `packages/ai/src|scripts|test`.** Three deps
deletable today with zero code.

---

## 1. Wire-shape census (the load-bearing fact)

**32 providers, 1227 model entries, 9 registered client implementations**
(`packages/ai/src/models.generated.ts`; `KnownProvider` union `packages/ai/src/types.ts:19-51`;
registrations `packages/ai/src/providers/register-builtins.ts:342-396`).

| `api` | models | wire shape |
|---|---|---|
| `openai-completions` | 571 | OpenAI `/chat/completions`, bearer, SSE + `[DONE]` |
| `anthropic-messages` | 306 | Anthropic `/v1/messages`, `x-api-key`, named SSE events |
| `bedrock-converse-stream` | 118 | SigV4 + **binary** `application/vnd.amazon.eventstream` |
| `openai-responses` | 111 | OpenAI `/responses`, bearer, SSE |
| `azure-openai-responses` | 41 | as above + `api-version`, `api-key` header, deployment mapping |
| `mistral-conversations` | 31 | camelCase OpenAI-ish JSON, bearer, SSE |
| `google-generative-ai` | 23 | Google `:streamGenerateContent?alt=sse`, `x-goog-api-key` |
| `openai-codex-responses` | 13 | OpenAI Responses over fetch **+ WebSocket** — *already SDK-free* |
| `google-vertex` | 13 | Google shape + GCP ADC bearer |

By provider: **26 of 32 (81%) are "baseUrl + bearer key over plain HTTPS"** —

- 11 pure `openai-completions`: cerebras, cloudflare-workers-ai, deepseek, groq, huggingface,
  moonshotai, moonshotai-cn, openrouter, prime-inference, xai, zai
- 1 pure `openai-responses`: openai
- 10 pure `anthropic-messages`: anthropic, fireworks, kimi-coding, minimax, minimax-cn,
  vercel-ai-gateway, xiaomi ×4
- 4 mixed but still plain HTTP: cloudflare-ai-gateway, github-copilot, opencode, opencode-go
- **6 genuinely special**: amazon-bedrock (SigV4 + binary frames), google-vertex (ADC),
  google (own shape, but api-key only), mistral (SDK), azure-openai-responses (deployment
  mapping), openai-codex (ChatGPT backend / OAuth / WebSocket — already SDK-free)

Read that as: **1044 of 1227 models (85%) speak one of three bearer-token-over-HTTPS-with-SSE
grammars.** Mistral is a fourth that is a 60-line variation of the first. Only **131 models across
2 providers** (Bedrock 118, Vertex 13) need anything exotic.

The 32→21 trim is **already reverted** — commit `3594c0268 feat(ai): restore full 32-provider
catalogue`, an ancestor of HEAD; 648 → 1227 models, bundle +2.1%, **zero new dependencies**. That
is the proof of the thesis: the catalogue grows without deps because the wire shapes repeat.

So: adding *more* providers costs zero SDKs. The catalogue grows by adding a `baseUrl` + a `compat`
row (`packages/ai/src/providers/openai-completions.ts:1077-1167`), never by adding a dependency.
The Anthropic wire shape in particular is **not** a one-provider format — 16 providers
(vercel-ai-gateway, fireworks, huggingface, xiaomi ×4, minimax, kimi-coding, cerebras, xai,
opencode…) expose Anthropic-compatible endpoints. That is a second lingua franca, and it is
already parsed by hand here.

## 2. Measured weight

**Installed size** — transitive closure walked from `packages/ai`, deduped, `node_modules/`
excluded from each package's own byte count (script: scratchpad `dep.ts`):

```
@anthropic-ai/sdk                pkgs=4   4.3 MB
@aws-sdk/client-bedrock-runtime  pkgs=28  5.4 MB   (+@smithy/* ×6)
@google/genai                    pkgs=41 30.3 MB   (google-auth-library, gtoken, protobufjs, ws)
@mistralai/mistralai             pkgs=4  11.4 MB   (zod v3, zod-to-json-schema)
openai                           pkgs=1  11.4 MB
--------------------------------------------------
total                            78     62.8 MB
```

Kept deps for contrast: `typebox` 1.4 MB, `partial-json` 48 KB, `proxy-agent` 27 pkgs / 4.6 MB,
`undici` 1.6 MB.

**Bundle contribution** — `packages/coding-agent/dist/bundle` (esbuild, code-split, 13 MB / 38
chunks). Chunks attributed by grepping the retained `node_modules/...` path comments:

| chunk | bytes | contents |
|---|---|---|
| `chunk-JKD2QGOP.js` | 1 263 927 | `@google/genai` + google-auth-library + gtoken/ecdsa/bignumber |
| `mistral-FC6JRF2Z.js` | 1 120 413 | `@mistralai/mistralai` + zod v3 + zod-to-json-schema |
| `chunk-ENTVCTJV.js` | 370 710 | `openai` (client.mjs, azure.mjs, core, internal) |
| `anthropic-VRTLBXDX.js` | 251 093 | `@anthropic-ai/sdk` + our provider |
| — | **0** | `@aws-sdk/*` — **not in the bundle at all** |

Bedrock is invisible to esbuild because the import goes through a variable indirection:
`packages/ai/src/providers/register-builtins.ts:89`
(`const importNodeOnlyProvider = (specifier: string) => import(specifier);`) called at `:313`.
So it is 5.4 MB of `node_modules` that ships to every user and is loaded from disk at runtime,
paying install cost with zero bundling benefit.

Isolated minified `export *` builds (esbuild `--bundle --minify`), as a second opinion on
irreducible code mass: anthropic 87 KB, openai 152 KB, aws 472 KB, google 632 KB, mistral 757 KB.

## 3. What we actually use from each SDK

### `openai` — a dumb transport
- Constructed in 3 places only: `openai-completions.ts:500`, `openai-responses.ts:210`,
  `azure-openai-responses.ts:228` (`AzureOpenAI`).
- Calls: `client.chat.completions.create(params, opts).withResponse()` (`openai-completions.ts:161`),
  `client.responses.create(...).withResponse()` (`openai-responses.ts:106`, `azure:98`).
  `.withResponse()` exists only to read `status`/`headers`/`x-request-id`.
- Constructor options used: `apiKey`, `baseURL`, `defaultHeaders`, `dangerouslyAllowBrowser`
  (+ Azure `apiVersion`). **No `fetch` override, no client-level timeout/maxRetries/agent.**
- Request bodies are 100% hand-built (`openai-completions.ts:508-622`). Tool-call delta
  accumulation is hand-written (`:233-269`, `:346-370`). The SDK contributes: URL join, auth
  header, SSE iterator, retry, `APIError`.
- **`openai-codex-responses.ts` already has zero SDK runtime**: raw `fetch` at `:223`, its own SSE
  parser `:504-554`, its own retry loop `:217-265`, its own error parse `:1185`, plus a WebSocket
  transport `:733-1183`. That file is the finished template — the replacement is largely a
  copy-paste, not a design exercise.

### `@anthropic-ai/sdk` — an HTTP client + a type package
- One runtime import: `anthropic.ts:1`. Everything else is `import type` (`:2-8`).
- 4 × `new Anthropic(...)` (`:863` cloudflare gateway, `:886` copilot, `:907` OAuth, `:928` api key)
  and exactly one method call: `client.messages.create({...,stream:true}, opts).asResponse()` `:526`.
- `.asResponse()` deliberately bypasses the SDK's stream machinery. **The SSE decoder is already
  ours**: `:235-325` (CR/LF/CRLF, comments, multi-line `data:`), `:327-384` iterator,
  `:386-406` error events, `:408-452` event filter. Deltas `:600-644`, block types `:557-598`.
- SDK-supplied and load-bearing: `anthropic-version: 2023-06-01` default header, retry/backoff
  (`maxRetries` plumbed at `:524`), 600 s default timeout, **null-header-means-delete** semantics
  relied on at `:873-874` to strip `x-api-key`/`Authorization` for the Cloudflare gateway, and the
  duck-typed `APIError` shape consumed by `packages/ai/src/utils/stream-failure.ts:116-172`.

### `@google/genai`
- Values used: `GoogleGenAI` (`google.ts:337`, `google-vertex.ts:344`/`:358`), and three enums that
  are just string constants — `FinishReason`/`FunctionCallingConfigMode` (`google-shared.ts:3`,
  used `:299-338`), `ThinkingLevel` (`google-vertex.ts:57-63`). `google.ts` already avoids the enum
  and casts string literals (`:378, 422, 425, 428`) — proof they are inert.
- Exactly one method: `client.models.generateContentStream(params)`
  (`google.ts:86`, `google-vertex.ts:103`). No `countTokens`, no files/caches APIs.
- Zero self-parsing: the SDK's async iterator, HTTP, `?alt=sse`, p-retry and error mapping are all
  used as-is.
- **Vertex auth is the entire dependency.** ADC discovery, service-account JWT→token, gcloud
  refresh tokens, metadata server, token refresh, all inside `google-auth-library`, pulled in
  transitively (`google-vertex.ts:404-432` just supplies `project`/`location`).

### `@mistralai/mistralai`
- One file: `mistral.ts:1` value import, `:2-8` types. `new Mistral({apiKey, serverURL})` `:64-67`
  **per request**. One call: `mistral.chat.stream(payload, opts)` `:77`.
- **SDK retries are explicitly disabled** (`:211-236`, `retries:{strategy:"none"}`). So the SDK
  provides a URL join and an SSE decoder. Nothing else.
- The camelCase field names (`maxTokens`, `toolCallId`, `finishReason`) are the real wire format,
  not an SDK translation — a fetch POST to `${baseUrl}/v1/chat/completions` is a straight swap.

### `@aws-sdk/client-bedrock-runtime`
- One file: `amazon-bedrock.ts:1-23`. One command: `ConverseStreamCommand` `:212`, sent `:214`,
  iterated `:224`. Plus `BedrockRuntimeServiceException` (`instanceof` `:306`) and 6 enums.
- Config, verbatim `:117-190`: `{ profile }`, optional `endpoint`, `region` or nothing,
  dummy creds under `AWS_BEDROCK_SKIP_AUTH`, `requestHandler` (dynamic `@smithy/node-http-handler`
  `:164` + `proxy-agent` `:166`), and bearer via `config.token` + `authSchemePreference:
  ["httpBearerAuth"]` `:187-190`.
- **We never pass real credentials.** Everything rides the SDK default chain: env keys, named
  profiles / `~/.aws/config`, `credential_process`, SSO, assume-role chaining, web identity, IMDS.
  Tests confirm the surface: `packages/ai/test/bedrock-utils.ts:12-19` accepts `AWS_PROFILE` |
  IAM key pair | `AWS_BEARER_TOKEN_BEDROCK`.
- **No retry config anywhere** → we silently inherit standard mode, 3 attempts, retry quota,
  and SigV4 clock-skew correction.

## 4. Replacement cost, per SDK

| Piece | LOC | Notes |
|---|---|---|
| **Shared** SSE reader + framing + abort | 80–110 | already exists twice (`anthropic.ts:235-384`, `openai-codex-responses.ts:504-554`) — factor once, reuse everywhere |
| **Shared** retry/backoff (`Retry-After`, `x-should-retry`, jitter, never after body starts) | 50–80 | the only genuinely subtle shared piece |
| `openai` completions + responses + Azure | 200–280 | ~150 liftable verbatim from codex file |
| `@anthropic-ai/sdk` | 180–260 | URL+headers 50, abort/timeout 30, error class 40, retry 60, misc 30 |
| `@mistralai/mistralai` | 60–90 | 30 if SSE is shared |
| `@google/genai` — Gemini API path | 250–350 | URL, `x-goog-api-key`, config→body split (`generationConfig`/`thinkingConfig` nesting), `systemInstruction` wrap, error map, local enums |
| `@google/genai` — Vertex path | +350–500 | of which 250–400 is ADC alone |
| Bedrock — eventstream binary decoder | 180–260 | prelude, CRC32 table, typed headers, frame reassembly across chunks |
| Bedrock — SigV4 via `crypto.subtle` HMAC-SHA256 | 150–200 | canonical request, header canonicalisation, scope, signing-key chain, payload hash |
| Bedrock — credential chain parity | 600–1200 | ini parse, profile chaining, `credential_process`, SSO cache+refresh, STS, IMDSv2 |
| Bedrock — retry/clock-skew/endpoint partitions | 180–320 | FIPS, dualstack, gov, cn, global inference profiles |

Type declarations are a separate, optional cost: ~600–900 LOC to restate `openai/resources/*`
shapes, ~200–400 for Anthropic, ~120 for Mistral, ~150 for Google. **Cheaper alternative: keep the
SDKs as `devDependencies` for types only.** They then cost 0 bytes at install-for-users, 0 bytes
in the bundle, and still type-check the request bodies. This is the single highest-leverage move
in this document and it is what makes the Anthropic/OpenAI removals near-free.

## 5. The hard parts, named

**Bedrock is the outlier, and not because of SigV4.** SigV4 over Web Crypto is ~175 LOC and
testable against AWS's published canonical-request vectors — annoying, not scary. The real costs
are (a) the **binary eventstream decoder**, needed regardless of auth mode, ~220 LOC of CRC32 and
frame reassembly that nothing else in the codebase needs; and (b) the **credential chain**, which
we depend on entirely and implicitly — SSO refresh, `credential_process`, role chaining, IMDSv2,
and mid-stream credential expiry. A 90%-correct chain is broken exactly for the enterprise users
who chose Bedrock. Add silent loss of retry + clock-skew correction and FIPS/GovCloud/cn endpoint
rules (`amazon-bedrock.ts:855-890` already special-cases GovCloud — the surface is real).

**Vertex is the same story in Google clothes.** `google-vertex.ts` supplies `project` and
`location` and lets `google-auth-library` do everything else. Reimplementing service-account
JWT signing + gcloud refresh tokens + metadata server + workload identity + token refresh
mid-stream is 250–400 LOC of security-critical code that no test in the repo would catch failing
(`google-vertex-api-key-resolution.test.ts` mocks the SDK and asserts only ctor args).

**Anthropic is genuinely cheap, with three specific traps:**
1. Retry semantics — `overloaded_error` is a real, frequent event on this path
   (`stream-failure.ts` has a dedicated kind). Retrying a partially-consumed stream, or parsing
   `retry-after` as seconds-vs-HTTP-date wrong, regresses into either hammering 529s or giving up
   on transients. Test it explicitly.
2. `null`-header deletion (`anthropic.ts:873-874`). A naive `Object.assign` sends
   `x-api-key: null` to the Cloudflare gateway → auth failures that look like gateway bugs.
3. `AnthropicOptions.client?: Anthropic` (`anthropic.ts:222`) is public API for injecting
   `AnthropicVertex`/`AnthropicBedrock`. Removing the SDK breaks that contract unless a
   `{messages:{create():{asResponse()}}}` shim interface is kept. Cheap to keep; must be deliberate.
   (The OAuth path `:906-926` also changes wire fingerprint — `x-stainless-*` headers disappear
   alongside the spoofed `claude-cli` UA. Behaviour change, not a no-op.)

**Prompt caching is not a hard part.** It is `cache_control` objects in the body plus an
`anthropic-beta` header string (`anthropic.ts:854-860`, `:170-171`) — already hand-assembled here.
Same for thinking blocks, signatures, and tool-call framing: all already ours.

**Where a hand-rolled client is worse, honestly:** long-tail error typing (we duck-type `APIError`
today, so removing it is invisible until request-id extraction and failure classification quietly
break); API drift on request *types* (this code already sends fields newer than the SDK types —
`anthropic.ts:1013-1019`, `:1258` — so dropping types makes silent 400s easier); and Google's
`FinishReason` exhaustiveness check (`google-shared.ts:335-338` uses a `never` guard that becomes a
runtime throw on unknown strings once the enum is hand-written — make it tolerant).

## 6. Drift risk vs test coverage

`packages/ai/test/` — 72 test files + 6 helpers. `vitest.config.ts` is 8 lines: no `setupFiles`, no
`globalSetup`, no MSW, **no network guard**. 35 files go live (env keys, or `test/oauth.ts:57`
reading `~/.pi/agent/auth.json` — 17 files go live even with zero env vars); 37 are pure unit tests
using dead-baseUrl + `onPayload` capture (`mistral-reasoning-mode.test.ts:21-33`) or `vi.mock`.
A clean local run is **321 passed / 651 skipped** (`MERGE-REPORT.md:104`) — two thirds of the suite
never executes in CI.

| provider | offline net | depth | verdict for a rewrite |
|---|---|---|---|
| anthropic-messages | `anthropic-sse-parsing` (278 L), eager-tool-input, oauth, thinking-disable, cache-retention | SSE decode, tools, thinking, caching, OAuth | **best covered** — safe |
| openai-completions | tool-choice (1031 L), cache-control-format, empty-tools (`vi.mock("openai")`), thinking-as-text, prompt-cache, reasoning-replay, tool-result-images, response-model | deep | **safe** |
| openai-codex-responses | `openai-codex-stream.test.ts` (1012 L), codex-oauth, fast-mode | deep (WS live-only) | safe (already SDK-free) |
| openai-responses / shared | copilot-provider (259 L), partial-json-cleanup, empty-tool-result, foreign-toolcall-id | good; caching + reasoning replay live-only | safe |
| google / google-shared | convert-tools (187 L), gemini3-unsigned-tool-call, image-tool-result-routing, thinking-signature | request-side only; **streaming live-only** | needs a recorded-SSE fixture test |
| google-vertex | thinking-budget (73 L), api-key-resolution (223 L, `vi.mock("@google/genai")`) | ctor args only | **no net** |
| mistral | reasoning-mode (80 L), tool-schema (61 L) — payload capture only | **zero response/stream parsing offline** | needs a fixture test (cheap) |
| amazon-bedrock | thinking-payload (209 L), endpoint-resolution (131 L, SDK mocked) | **converse-stream decoding untested offline** | **no net at all** |
| azure-openai-responses | `azure-openai-base-url` (136 L, `vi.mock("openai")`) | URL/deployment math only | thin |
| github-copilot | oauth (196 L), anthropic (108 L), transform-messages (191 L) | surprisingly good | safe |
| groq/cerebras/xai/huggingface/deepseek/moonshot/minimax/kimi/xiaomi/vercel-ai-gateway/opencode | none dedicated | thin config over the well-covered shared clients | risk is baseUrl/header drift, not client logic |

Upstream drift is slow for the stable surfaces we touch: `anthropic-version` has been pinned at
`2023-06-01` since 2023 and additions are opt-in betas; OpenAI `/chat/completions` SSE has been
stable for years; new capability lands as new request *fields*, which we already write by hand and
which no SDK version would have protected us from. The drift that SDKs genuinely absorb is in the
parts we would drop anyway — auth chains, endpoint rulesets, retry policy — i.e. Bedrock and
Vertex. That is the same conclusion from a different direction.

## 7. Ranked plan

**Rung 0 — free (0 LOC).** Delete `chalk`, `undici`, `zod-to-json-schema` from
`packages/ai/package.json`. Not imported anywhere in `src/`, `scripts/`, or `test/`. 11 → 8.

**Rung 1 — `openai` (best weight ÷ risk).** 11.4 MB + 371 KB bundle gone for ~200–280 LOC, ~150 of
it already written in `openai-codex-responses.ts`. Serves 10 + 4 + 1 providers and 723 models —
the highest-leverage single change in the repo. Prerequisite: extract the shared SSE reader +
retry loop first; verify the Azure auth header (`api-key:` vs `Authorization: Bearer`) against a
live Azure deployment. Existing 20 test files cover the swap.

**Rung 2 — `@mistralai/mistralai`.** 1.12 MB of bundle (mostly zod v3, which nothing else needs)
for ~60–90 LOC. Keep `mistral.ts` as its own provider — collapsing it onto `openai-completions.ts`
would need a whole new `compat` axis (camelCase fields, thinking chunks, 9-char tool-call ids,
symbol stripping, `promptMode` vs `reasoningEffort`). Not worth it. Add one recorded-SSE fixture
test first: today's two Mistral tests assert request shape only, so response decoding has no net.

**Rung 3 — `@anthropic-ai/sdk`.** ~180–260 LOC on top of the shared SSE/retry from rung 1, because
the streaming grammar is already ours. Unlocks 306 models across 16 providers. Add two tests before
merging: retry-on-529-with-`retry-after`, and header-deletion for the Cloudflare gateway path.

**Rung 4 — `@google/genai`, split.** Hand-roll the Gemini API path (~250–350 LOC, 23 models,
2 providers, `x-goog-api-key` and nothing else). **Drop `google-vertex`** (13 models, 1 provider):
its whole cost is ADC, and dropping it is what actually deletes google-auth-library, gtoken,
protobufjs and most of the 41-package / 30 MB tree. Vertex users are enterprise GCP shops who can
use the Gemini API key path or an OpenAI-compatible gateway. Needs new tests: a recorded-SSE
fixture test for the Gemini stream, plus a tolerant `mapStopReason`.

**Rung 5 — `amazon-bedrock`: drop the provider.** 118 models, 1 provider, and the only consumer in
the repo of binary eventstream framing, SigV4, `proxy-agent` (`amazon-bedrock.ts:166`), the
`@smithy/node-http-handler` dynamic import, and the entire lazy-provider-override machinery in
`register-builtins.ts:115-320` + `packages/coding-agent/src/bun/register-bedrock.ts`. Deleting it
removes 28 packages / 5.4 MB, one dep (`proxy-agent`, 27 more packages / 4.6 MB), ~968 LOC of
provider code, and a bundling special case. Capability lost: AWS-billed Claude, IAM/SSO-scoped
access, and `AWS_BEDROCK_SKIP_AUTH` proxy setups. Who cares: enterprises with AWS committed spend
and no direct Anthropic contract — a real constituency, but one provider's worth. Nothing in our
own tooling depends on it (no harness-arena or coding-agent code path requires Bedrock; the tests
self-skip without AWS creds). If the owner wants a fallback, ship the **bearer-token-only** client
(`AWS_BEARER_TOKEN_BEDROCK`, no SigV4, no credential chain) at ~450–700 LOC — but note the
eventstream decoder is required even then, so this buys the provider back at roughly the price of
all four other rewrites combined. **Recommendation: drop it, and revisit only if a paying user asks.**

### If one must stay
None of the five earns its place on merit. The closest to a genuine keeper is
`@aws-sdk/client-bedrock-runtime` — and the honest reading of that is not "keep the SDK", it is
"Bedrock is the one provider whose *protocol* does not pay for itself". The correct move is to drop
the provider, not to keep 28 packages for it. Conversely, **do keep all five as
`devDependencies` for types** unless someone wants to hand-maintain ~1500 LOC of interface
declarations; that costs users nothing and preserves the only real drift protection worth having.

## 8. End state

`packages/ai` runtime dependencies: **11 → 2** (`typebox`, `partial-json`).
Removed: 5 SDKs + `chalk` + `undici` + `zod-to-json-schema` (unused) + `proxy-agent` (Bedrock-only).
On disk: −78 packages / −62.8 MB of SDKs, −27 packages / −4.6 MB with `proxy-agent`.
Bundle: −3.0 MB of 13 MB.

Providers still supported: **30 of 32** (everything except `amazon-bedrock` and `google-vertex`),
covering **1096 of 1227 model entries (89%)**. Adding further providers stays free as long as they
speak OpenAI-completions, OpenAI-responses, or Anthropic-messages — which, per §1, covers 26 of the
32 we already ship. The full 32-provider catalogue is already restored (`3594c0268`) and cost zero
dependencies; this plan does not touch that direction of travel.

Whole-product runtime deps (union across `packages/*`, excluding workspace-internal
`@earendil-works/*`): **30 today → 24 after this plan**.

```
today (30): @agentclientprotocol/sdk @anthropic-ai/sdk @aws-sdk/client-bedrock-runtime
  @google/genai @mistralai/mistralai @silvia-odwyer/photon-node @types/mime-types chalk
  cli-highlight diff extract-zip file-type get-east-asian-width glob hosted-git-info ignore
  jiti marked mime-types minimatch openai partial-json proper-lockfile proxy-agent strip-ansi
  typebox undici uuid yaml zod-to-json-schema
```

**The ≤10 whole-product target is not reachable by removing provider SDKs.** The SDKs are 5 of 30.
The remaining 24 live almost entirely in `packages/coding-agent` (19) and `packages/tui` (5):
`jiti`, `glob`, `minimatch`, `marked`, `cli-highlight`, `extract-zip`, `file-type`,
`@silvia-odwyer/photon-node`, `proper-lockfile`, `hosted-git-info`, `uuid`, `yaml`, `diff`,
`ignore`, `strip-ansi`, `chalk`, `get-east-asian-width`, `mime-types`… Several are one-file
replacements against modern Node/Bun (`uuid` → `crypto.randomUUID`, `glob`+`minimatch` → `fs.glob`
/ `Bun.Glob`, `strip-ansi`/`chalk` → ~30 LOC of ANSI, `@types/mime-types` is a dev dep in the wrong
list). A plausible floor is ~8–12 without cutting capability, but reaching it is a
`packages/coding-agent` exercise, not an AI-SDK one. Removing the five SDKs is still the right
first move: it is the largest single mass, the lowest-risk 5 of the 20 that have to go, and it is
what makes "support every provider" and "no dependencies" simultaneously true.
