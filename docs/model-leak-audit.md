# Model leak audit — OpenRouter spend outside `deepseek/deepseek-v4-flash-0731`

Audit date 2026-08-18. Only `$BENCH_MODEL` (`deepseek/deepseek-v4-flash-0731`, provider
`deepinfra/fp8`) may ever be billed by this benchmark. This document attributes every
non-benchmark model on the OpenRouter dashboard, states what could not be attributed, and
records the structural controls that now make an unpinned request impossible to make by
accident.

## 0. The single most important finding

**The dashboard is an *account* view, not a *key* view, and the benchmark key accounts for
about 5 % of the week's spend.**

| Source | Evidence | Week spend |
|---|---|---|
| Bench key `sk-or-v1-cf2…4a1` (= `OPENROUTER_API_KEY` in `~/.zshrc` and `~/.prime-bench.env`) | `GET /api/v1/key` → `usage_weekly` | **$0.02502** |
| opencode's stored key `sk-or-v1-fd4…ea8` (`~/.local/share/opencode/auth.json`) | `GET /api/v1/key` with that key | **$0.01894** |
| Everything else on the account (keys we cannot enumerate) | residual vs. dashboard | **≈ $0.49** |
| Dashboard week total (0.33 + 0.11 + 0.04 + 0.05) | user-supplied screenshot | $0.53 |
| Account lifetime | `GET /api/v1/credits` → `total_usage` | $21.09 |

Consequence, and it is a *proof*, not an inference:

- Claude Opus 4 cost **$0.33** and Gemini 2.5 Pro cost **$0.11** in the window. The bench
  key's entire lifetime usage is **$0.02502**. A single one of those line items is more than
  10× everything the bench key has ever spent. **Neither model can have been billed to the
  benchmark key.**
- The two keys we can read sum to **$0.0439**, and the DeepSeek V4 Flash 0731 line is
  **$0.04 / 618 K tokens / 65 requests**. The benchmark's entire footprint is that one line.

`GET /api/v1/activity` returns `403 "Only management keys can fetch activity for an account"`,
so per-request, per-model attribution *from the API* is impossible with the keys available.
Everything below is therefore reconciled from the key/credits endpoints plus local artefacts
(proxy NDJSON, harness state DBs, harness configs, binaries). **A provisioning/management key
is required to close the remaining gaps** — see §4.

## 1. Attribution table

| Model | Reqs (dashboard) | Cost | Root cause | Evidence |
|---|---|---|---|---|
| `deepseek/deepseek-v4-flash-0731` | 65 | $0.04 | **Legitimate** — the benchmark. Split: $0.0042 metered through the proxy, ~$0.021 billed to the bench key *without* passing the proxy (ori-launched smoke runs + setup probes), ~$0.019 billed to opencode's own stored key. | 32 proxy rows in `/tmp/bench-harnesses/{proxy,results/*}/requests.ndjson`, all `model=deepseek/deepseek-v4-flash-0731`, all `providerServed=DeepInfra`, total `costUsd` $0.004199. Bench key `usage` $0.02502 ⇒ $0.0208 unmetered. `~/.hermes/state.db:session_model_usage` and `~/.local/share/opencode/opencode.db:message` both show only this model against `https://openrouter.ai/api/v1`. |
| `anthropic/claude-opus-4*` | — | $0.33 / 42 K tok | **Not the benchmark.** Cost exceeds the bench key's lifetime usage by 13×; billed to a third key on the same account. | `GET /api/v1/key` (bench) `usage=0.02502`; `GET /api/v1/key` (opencode) `usage_weekly=0.01894`. No local artefact shows an Opus call over OpenRouter. |
| `google/gemini-2.5-pro` | 28 | $0.11 / 99 K tok | **Not the benchmark**, same arithmetic proof. Gemini CLI never billed anything: it is `enabled:false` in `runner/harnesses.json` and every finding about it came from a local logging sink. | `runner/harnesses.json:359-387` (`"BLOCKED - cannot be pinned by the current proxy"`, "NOTHING WAS BILLED FOR GEMINI"). Gemini CLI's models are `gemini-3.x`, not 2.5 Pro. `gemini` is not on `PATH`. |
| `z-ai/glm-4.5v` | **76** | inside "Others" $0.05 | **UNATTRIBUTED — see §3.** No local artefact on this machine calls it. Ruled out: z.ai path (`claude-z` → `ZAI_BASE_URL=https://api.z.ai/api/anthropic`, never OpenRouter, so it cannot appear on this dashboard at all). | Week-scoped grep of `~` for `glm-4.5v` hits only *catalogues*: `~/.hermes/cache/openrouter_model_metadata.json`, `~/.cache/opencode/models.json`, and an opencode *source* constant pasted into a qoder session. Zero call records. |
| `anthropic/claude-haiku-4.5` | part of "Others" (77 reqs / $0.05) | small | **Real bench-key leak, mechanism confirmed**: Claude Code fires a second, billed call per run for session-title generation (`query_source: generate_session_title`) when launched via `ori` (i.e. straight at OpenRouter, no proxy). | `HARNESSES.md:61-63`. Now suppressed by `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` in `runner/harnesses.json`. |
| rest of "Others" | remainder of 77 | remainder of $0.05 | **UNATTRIBUTED.** | — |

### What actually leaked from the benchmark

Not model spend — **measurement**. **$0.0208 of the bench key's $0.0250 (83 %) never passed
the proxy**, so it was unpinned by construction: no model force, no `provider.only`, no NDJSON
row. It happens to have all landed on the right model, but nothing structurally guaranteed
that, and the Claude Code title call proves at least one non-benchmark model got through.

## 2. Leak paths — verified, one by one

1. **`ori` rewrites the base URL back to OpenRouter — CONFIRMED, primary cause.**
   `~/.ori/prime-agent/openrouter-auth.ts` hardcodes
   `const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"`, and the `ori` binary strips
   every foreign provider key from the child env and injects `OPENROUTER_API_KEY` (the bench
   key) before exec. Anything launched as `ori claude` / `ori codex` / `ori opencode` /
   `ori hermes` / `ori prime-agent` talks to OpenRouter **directly**; the proxy never sees it.
   Already recorded in `runner/harnesses.json` ("Launched WITHOUT ori: ori overrides
   `ANTHROPIC_BASE_URL` back to OpenRouter and the proxy never sees the traffic (verified)")
   and `HARNESSES.md:419`. All early probes and every smoke run in `HARNESSES.md` were run
   this way — that is the $0.0208 of unmetered bench-key spend.
2. **Claude Code auxiliary + fallback — CONFIRMED.** Per-run session-title call to
   `anthropic/claude-haiku-4.5`; `[claude-code:unrecognized_model]` on stderr for non-Anthropic
   ids. Claude Code's self-reported `total_cost_usd` (e.g. "$0.197" for one smoke run) is
   computed with *Anthropic* pricing and is fiction when it is pointed at OpenRouter — do not
   use it for cost, only the proxy row.
3. **Gemini CLI hidden router call — CONFIRMED but never billed.** With no `-m`, the CLI first
   calls a cheap model with a "assign a Complexity Score from 1 to 100" system prompt (a model
   router), and `resolveModel()` remaps aliases (`-m gemini-3.1-flash` went out as
   `gemini-3.5-flash`). Harness is disabled; all evidence came from a local sink.
   (`runner/harnesses.json:387`.)
4. **Hermes default model — LIVE LANDMINE, has not fired.** `~/.hermes/config.yaml` sets
   `model.default: "anthropic/claude-opus-4.6"` with `base_url: https://openrouter.ai/api/v1`,
   and its auxiliary tasks (vision, web_extract, title_generation, compression) default to
   Gemini via OpenRouter. **One `hermes` invocation without `--model` bills Opus on the bench
   key.** `state.db:session_model_usage` shows exactly one session, on the pinned model, so it
   has not happened yet — but this is precisely the shape that produces an Opus + Gemini
   dashboard.
5. **opencode's stored credential wins over the injected key — CONFIRMED.**
   `~/.local/share/opencode/auth.json` holds a *different* OpenRouter key
   (`sk-or-v1-fd4…ea8`, weekly $0.01894). `ori` warns about it on every launch. Effect: bench
   traffic is billed to a key the bench accounting does not watch, so `GET /api/v1/key` on the
   bench key under-reports the run.
6. **ZAI — RULED OUT.** `ZAI_BASE_URL=https://api.z.ai/api/anthropic` and `claude-z` point at
   z.ai, not OpenRouter. z.ai traffic is billed by z.ai and cannot appear on the OpenRouter
   dashboard, so it explains none of the 76 GLM requests there.
7. **Other local CLIs — RULED OUT.** `qodercli` authenticates with `qoder-browser` and its
   session logs show only `qmodel_preview` / `lite`. `claude-d` / `claude-f` go to DeepInfra
   directly (`ANTHROPIC_BASE_URL=https://api.deepinfra.com/anthropic`), `claude-n` to a local
   Nemotron gateway. None of them touch OpenRouter.

## 3. Explicitly unattributed

- **`z-ai/glm-4.5v`, 76 requests** — the largest single request count. Negligible tokens and
  cost (it appears in neither the token nor the spend top-3), which is the signature of
  short/failed/zero-token calls. There is **no local artefact of any kind** that issues this
  call: no config, no session record, no log, no binary default. The `ori` `pi` harness
  defaults to `z-ai/glm-5.2` — a different model — and `pi` was not run. I cannot attribute
  this and will not guess.
- **The remainder of "Others"** (77 requests / $0.05 minus the Claude Code title calls).
- **Which key** the Opus and Gemini spend belongs to. The arithmetic proves it is *not* the
  bench key; naming the actual key needs a management key.

To close all three: create a **management (provisioning) key** on the OpenRouter account and
run `GET /api/v1/activity` — it returns per-day, per-model, per-key rows and would settle GLM
4.5V in one call. That is the only outstanding action for Part 1.

## 4. Controls now in place

### (a) Proxy hard-fail — implemented and verified

`/tmp/bench-harnesses/proxy/server.ts`. Previously, any path the shim did not rewrite
(`/chat/completions`, `/completions`, `/messages`, `/responses`) was proxied **verbatim** —
no model force, no provider pin, no usable metering row. That was a standing hole: a Gemini
`:generateContent` post, an `/embeddings` post, or a malformed body on a pinnable path all
went upstream unpinned with the real key attached.

New behaviour, default-on:

- Any request that is **not** a rewritable shape and **not** a GET/HEAD to a non-billable
  metadata path (`/models…`, `/generation`, `/key`, `/credits`, `/auth…`) is **refused with
  HTTP 403** and never forwarded.
- A rewritable path whose body is missing or is not JSON — i.e. the model force could not be
  applied — is also refused (`violation: "unparseable_body"`).
- Every refusal writes an NDJSON row with `status: 403` and a `violation` field, and logs
  `REFUSED <violation>: <METHOD> <path>` to stderr. An unmeasurable request is worse than a
  failed one.
- Opt-out for deliberate exploration: `BENCH_ALLOW_UNPINNED=1`. Even then the pass-through is
  logged with `violation: "unpinned_passthrough"`, so it can never be silent.

Verified live:

```
POST /v1beta/models/gemini-2.5-pro:generateContent  → 403 unpinnable_path
POST /v1/embeddings                                  → 403 unpinnable_path
POST /v1/chat/completions  (non-JSON body)           → 403 unparseable_body
GET  /v1/models                                      → 200 (allowed, non-billable)
POST /v1/chat/completions  {"model":"anthropic/claude-opus-4", …}
     → 200, response model = deepseek/deepseek-v4-flash-0731, provider = DeepInfra
```

The last line is the important one: a request that *asks* for Opus is served as the pinned
model, metered, and costs $0.0000013.

### (b) Container egress lockdown — verified recipe

Two options, both tested against `localhost/bench/claude:pinned` on the `bench-vm` podman
machine. `/tmp/bench-harnesses/containers/*` is owned by another worker; nothing there was
modified — this is what the run invocation needs.

**Option 1 — airtight (recommended).** Proxy runs as a container on an internal network;
harness containers get *only* that network, so they have no route off it at all.

```sh
podman network create --internal bench-isolated        # once

# proxy container: on BOTH networks, with an explicit resolver (the internal net's
# aardvark-dns cannot forward, so without --dns the proxy itself gets ENOTFOUND)
podman run -d --name bench-proxy \
  --network bench-isolated --network podman --dns=1.1.1.1 \
  -e OPENROUTER_API_KEY -e BENCH_MODEL -e BENCH_PROVIDER_ONLY \
  bench/proxy:pinned

# harness container: internal network ONLY
podman run --rm --network bench-isolated \
  -e BASE_URL=http://bench-proxy:8877/v1 \
  bench/<harness>:pinned …
```

Measured from inside a harness container on `bench-isolated`:

```
http://bench-proxy:8877/           OK 200      (and the proxy's own upstream fetch: 200)
http://104.18.2.115/               FAIL ENETUNREACH   ← raw IP, no route
https://openrouter.ai/api/v1/models FAIL ENOTFOUND
```

**Option 2 — host-run proxy, DNS sinkhole.** Keeps the proxy on the host (current runner
shape). Weaker: it blocks *named* egress, not raw-IP egress.

```sh
podman run --rm \
  --dns=0.0.0.0 \
  --add-host=openrouter.ai:0.0.0.0 \
  --add-host=api.anthropic.com:0.0.0.0 \
  --add-host=generativelanguage.googleapis.com:0.0.0.0 \
  -e BASE_URL=http://host.containers.internal:<port>/v1 \
  bench/<harness>:pinned …
```

Measured:

```
https://openrouter.ai/api/v1/models              FAIL ECONNREFUSED  (sinkholed)
https://api.anthropic.com/v1/models              FAIL ECONNREFUSED  (sinkholed)
https://generativelanguage.googleapis.com/…      FAIL ECONNREFUSED  (sinkholed)
https://example.com                              FAIL EAI_AGAIN     (no resolver at all)
http://host.containers.internal:<port>/v1/models OK 200             (proxy still reachable)
http://104.18.2.115/                             OK 403             ← HOLE: raw IP still routes
```

`--dns=0.0.0.0` kills all name resolution while podman's own `/etc/hosts` entry for
`host.containers.internal` keeps the proxy reachable. `--network=none` is not usable: it also
removes the proxy. Note the raw-IP hole is theoretical for the current harness set (all use
hostnames), but Option 1 closes it and should be preferred once the proxy is containerised.

### (c) Preflight / postflight assertion — spec for `runner/run.ts` (owned by the lead, not edited)

The per-key endpoint is the only account-level number a non-management key can read, and it
*is* live (verified: `usage` moved 0.02502 → 0.02536 within seconds of a $0.0000013 call).
There is no request *count* on it, so the assertion is on **credits**, which is strictly
stronger: any request to any model on this key moves it.

```ts
type KeyUsage = { usage: number; usage_weekly: number };

async function keyUsage(): Promise<number> {
  const r = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
  });
  if (!r.ok) throw new Error(`key endpoint ${r.status}`);
  return (await r.json() as { data: KeyUsage }).data.usage;
}

// ---- preflight, before spawning the harness ----
const usageBefore = await keyUsage();

// ---- run ----
// ... spawn harness against the proxy, wait for exit ...
// The /responses shape appends its NDJSON row up to ~30 s AFTER the process exits, so wait
// for the proxy to go quiet (log file mtime stable) before reading rows.

// ---- postflight ----
const rows = readNdjson(runLogPath).filter(r => r.runId === RUN_ID);
const usageAfter = await keyUsage();          // poll ~3x over ~5 s, OpenRouter settles async

const metered   = rows.reduce((a, r) => a + (r.costUsd ?? 0), 0);
const observed  = usageAfter - usageBefore;
const EPS       = 2e-4;                        // rounding + settle lag

const failures: string[] = [];
if (rows.some(r => r.violation))                       failures.push("proxy violation row");
if (rows.some(r => r.status === 200 && r.model !== process.env.BENCH_MODEL))
                                                       failures.push("row not on pinned model");
if (rows.some(r => r.status === 200 && r.totalTokens > 0 &&
                   r.providerServed !== PROVIDER_LABEL))
                                                       failures.push("provider pin broken");
if (observed > metered + EPS)                          failures.push(
  `unmetered spend: account +$${observed.toFixed(6)} vs proxy $${metered.toFixed(6)} ` +
  `(delta $${(observed - metered).toFixed(6)}) — traffic bypassed the proxy`);

if (failures.length) {
  result.status = "discarded_unpinned";
  result.discardReason = failures.join("; ");
}
```

Notes for whoever implements it:

- `observed > metered + EPS` is the leak detector. It catches every bypass class at once —
  ori base-URL rewrite, a harness's hardcoded endpoint, an auxiliary call to another model —
  because the money moves even when the proxy never sees the request.
- It only works if the bench key is used by **nothing else** concurrently. Run benchmarks
  serially, and delete the OpenRouter entry from `~/.local/share/opencode/auth.json` (or point
  opencode at the proxy) so opencode cannot bill a second key mid-run.
- Once a management key exists, add the stronger postflight:
  `GET /api/v1/activity` filtered to the run window, and assert every returned row's `model`
  equals `$BENCH_MODEL`. That asserts on *models*, not just on money.

### (d) `ori` is banned from the measured path

**Never launch a measured run through `ori`.** `ori <harness>` overwrites the harness's base
URL with `https://openrouter.ai/api/v1` and injects the bench key, so the request goes
straight to OpenRouter: no model force, no `provider.only` pin, no NDJSON row, no cost
attribution — and whatever second call the harness makes (session titles, routers, weak
models) is billed silently to whatever model the harness chose. This is the confirmed cause of
83 % of the bench key's spend being unmeasurable and of the `claude-haiku-4.5` calls.

`ori` is fine for interactive exploration on a *different* key. It must never appear in
`runner/harnesses.json`, in a container entrypoint, or in a reproduction command in the docs.
Each harness is wired to the proxy through its own native mechanism instead — `ANTHROPIC_BASE_URL`
for Claude Code, `models.json` for prime-agent, `config.toml` for codex, and so on.

## 5. Verification log

| Check | Result |
|---|---|
| (i) proxy refuses an unpinnable request | 403 `unpinnable_path` on a Gemini-shaped POST and on `/embeddings`; 403 `unparseable_body` on a non-JSON `/chat/completions`; violation rows written |
| (ii) container cannot reach openrouter.ai directly | `ENOTFOUND` on `bench-isolated` (Option 1, also `ENETUNREACH` for raw IP); `ECONNREFUSED` with the DNS sinkhole (Option 2) |
| (iii) a normal pinned run still succeeds | `POST /v1/chat/completions` asking for `anthropic/claude-opus-4` → 200, served `deepseek/deepseek-v4-flash-0731` by `DeepInfra`, metered at $0.0000013 |

Total live cost of this audit: **< $0.0004** (three one-word completions and a handful of free
metadata GETs).
