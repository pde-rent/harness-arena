// OpenRouter shim proxy: forces model + provider pin, meters every request to NDJSON.
// Run: bun run server.ts [--port N]
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
// Independent token accounting — one tokenizer (the benchmark model's own), applied identically
// to every harness, so measurement never depends on a provider's or harness's self-report.
import {
  segmentRequest, newOutAcc, absorbStreamDelta, absorbFullResponse, countOutput, reconcileOk,
  TOKENIZER_SHA, TOKENIZER_VOCAB, RECONCILE_TOLERANCE,
  type OutAcc, type Segments,
} from "./accounting";

const UPSTREAM = "https://openrouter.ai/api/v1";
/**
 * Credentials come from the environment, falling back to ~/.prime-bench.env.
 *
 * The fallback is not a convenience. The key was deliberately removed from shell startup files
 * so that no tool on the machine can spend it by accident — which means a proxy relying on
 * ambient environment silently starts with no key and every upstream call returns
 * 401 "User not found". That failure is quiet and looks like a provider problem, so the file
 * is read here explicitly rather than depending on how the process was launched.
 */
function loadBenchEnv(): void {
  const path = join(homedir(), ".prime-bench.env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, name, rawValue] = m;
    if (process.env[name]) continue; // an explicit environment value always wins
    process.env[name] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}
loadBenchEnv();

const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) {
  console.error("FATAL: OPENROUTER_API_KEY not set, and ~/.prime-bench.env did not supply it");
  process.exit(1);
}
const MODEL = process.env.MODEL || "deepseek/deepseek-v4-flash-0731";
const PROVIDER_ONLY = process.env.BENCH_PROVIDER_ONLY || "deepinfra/fp8";
const LOG = process.env.BENCH_LOG || "./requests.ndjson";
const RUN_ID = process.env.BENCH_RUN_ID || "no-run-id";
const HARNESS = process.env.BENCH_HARNESS || "unknown";
// Identity of the tokenizer used for OUR counts. It is the benchmark model's own vocab,
// vendored under proxy/tokenizer/ — no network access at measurement time.
const TOKENIZER_ID = process.env.BENCH_TOKENIZER_ID || "deepseek-ai/DeepSeek-V4-Flash-0731";
// Opt-in: write every rewritable request body to this directory, so a segment attribution can be
// audited (or re-segmented) after the run. Off by default — bodies carry the whole task context.
const CAPTURE_DIR = process.env.BENCH_CAPTURE_DIR || "";
// Hard-fail default: a request the shim cannot pin is REFUSED, not proxied. An unmeasurable
// (and unpinned) request is worse than a failed one — that is how the model leaks happened.
// Set BENCH_ALLOW_UNPINNED=1 for deliberate exploration; every pass-through is still logged
// with violation="unpinned_passthrough" so it can never be silent.
const ALLOW_UNPINNED = process.env.BENCH_ALLOW_UNPINNED === "1";
// GET/HEAD metadata paths that cannot create a billable generation. Everything else that is
// not a rewritable shape is refused.
const SAFE_READONLY = /^\/(models(\/[^/]+)*|generation|key|credits|auth(\/.*)?)$/;

// Harness handshake/telemetry endpoints that carry no model, no prompt and no tokens. They are
// still refused -- nothing unpinnable is proxied -- but the refusal is not a pin violation, so it
// cannot discard an otherwise correctly pinned run.
//
// Claude Code calls /api/hello once at startup. Counting that as a violation threw away runs whose
// actual model traffic was pinned exactly right, which is a false negative in the direction that
// silently removes a harness from the comparison.
const NON_BILLABLE_HANDSHAKE = /^\/api\/hello$/;

const argPort = (() => {
  const i = process.argv.indexOf("--port");
  return i >= 0 ? Number(process.argv[i + 1]) : 0;
})();

// ---------- metering ----------
type Row = Record<string, unknown>;
function writeRow(r: Row) {
  try {
    appendFileSync(LOG, JSON.stringify(r) + "\n");
  } catch (e) {
    console.error("log write failed", e);
  }
}

// ---------- usage extraction (OpenAI + Anthropic shapes) ----------
type Acc = {
  id?: string;
  model?: string;
  provider?: string;
  prompt: number;
  completion: number;
  reasoning: number;
  cached: number;
  total: number;
  cost: number;
  sawUsage: boolean;
};
const newAcc = (): Acc => ({
  prompt: 0, completion: 0, reasoning: 0, cached: 0, total: 0, cost: 0, sawUsage: false,
});

function absorb(acc: Acc, o: any) {
  if (!o || typeof o !== "object") return;
  if (typeof o.id === "string" && !acc.id) acc.id = o.id;
  if (typeof o.model === "string") acc.model = o.model;
  if (typeof o.provider === "string") acc.provider = o.provider;
  // anthropic message_start wraps the message
  if (o.message) absorb(acc, o.message);
  // responses-api SSE wraps the response object (response.created/.completed)
  if (o.response) absorb(acc, o.response);
  const u = o.usage;
  if (!u || typeof u !== "object") return;
  acc.sawUsage = true;
  if (typeof u.prompt_tokens === "number") {
    // OpenAI shape: absolute values
    acc.prompt = u.prompt_tokens;
    acc.completion = u.completion_tokens ?? 0;
    acc.total = u.total_tokens ?? acc.prompt + acc.completion;
    acc.reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
    acc.cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  } else if (typeof u.input_tokens === "number" || typeof u.output_tokens === "number") {
    // Anthropic shape: message_start has input, message_delta has output
    if (typeof u.input_tokens === "number") acc.prompt = u.input_tokens;
    if (typeof u.output_tokens === "number") acc.completion = u.output_tokens;
    // anthropic: thinking_tokens / cache_read_input_tokens; responses api: reasoning_tokens /
    // input_tokens_details.cached_tokens
    acc.reasoning = u.output_tokens_details?.thinking_tokens
      ?? u.output_tokens_details?.reasoning_tokens ?? acc.reasoning;
    acc.cached = u.cache_read_input_tokens ?? u.input_tokens_details?.cached_tokens ?? acc.cached;
    acc.total = acc.prompt + acc.completion;
  }
  if (typeof u.cost === "number") acc.cost = u.cost;
}

function feedSSE(acc: Acc, text: string, oacc?: OutAcc) {
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    let ev: any;
    try { ev = JSON.parse(payload); } catch { continue; /* partial/non-json */ }
    absorb(acc, ev);
    // our own count of what was generated, from the deltas rather than the final usage chunk
    if (oacc) { try { absorbStreamDelta(oacc, ev); } catch { /* shape we don't model */ } }
  }
}

// Fallback when the stream carried no usage.
async function fetchGeneration(acc: Acc) {
  if (!acc.id) return;
  for (let i = 0; i < 5; i++) {
    await Bun.sleep(400 * (i + 1));
    try {
      const r = await fetch(`${UPSTREAM}/generation?id=${encodeURIComponent(acc.id)}`, {
        headers: { authorization: `Bearer ${KEY}` },
      });
      if (!r.ok) continue;
      const d: any = (await r.json()).data;
      if (!d) continue;
      acc.prompt = d.tokens_prompt ?? d.native_tokens_prompt ?? acc.prompt;
      acc.completion = d.tokens_completion ?? d.native_tokens_completion ?? acc.completion;
      acc.reasoning = d.native_tokens_reasoning ?? acc.reasoning;
      acc.cached = d.native_tokens_cached ?? acc.cached;
      acc.total = acc.prompt + acc.completion;
      acc.cost = d.total_cost ?? acc.cost;
      acc.provider = d.provider_name ?? acc.provider;
      acc.sawUsage = true;
      return;
    } catch { /* retry */ }
  }
}

// The responses-api shape carries usage but no provider name, so ask the generation endpoint for
// the provider ONLY — token counts stay as reported by usage, comparable with the other shapes.
async function fetchProvider(acc: Acc) {
  if (!acc.id || acc.provider) return;
  // OpenRouter indexes a STREAMED generation several seconds after the stream ends (404 until
  // then), so this backs off much further than fetchGeneration. It runs after the client already
  // has the full response, so it delays only the NDJSON row, never the harness.
  for (const wait of [1000, 2000, 3000, 5000, 8000, 12000]) {
    await Bun.sleep(wait);
    try {
      const r = await fetch(`${UPSTREAM}/generation?id=${encodeURIComponent(acc.id)}`, {
        headers: { authorization: `Bearer ${KEY}` },
      });
      if (!r.ok) continue;
      const d: any = (await r.json()).data;
      if (!d?.provider_name) continue;
      acc.provider = d.provider_name;
      return;
    } catch { /* retry */ }
  }
  console.error(`provider lookup failed for ${acc.id}`);
}

// ---------- body rewrite ----------
type Kind = "openai" | "anthropic" | "responses";
function rewrite(kind: Kind, body: any) {
  body.model = MODEL;
  body.provider = { only: [PROVIDER_ONLY], allow_fallbacks: false };
  if (kind === "openai") {
    body.usage = { include: true };
    if (body.stream) body.stream_options = { ...(body.stream_options || {}), include_usage: true };
  }
  return body;
}

let seq = 0;

const server = Bun.serve({
  port: argPort,
  idleTimeout: 255,
  async fetch(req) {
    const t0 = performance.now();
    const requestId = `${Date.now().toString(36)}-${(seq++).toString(36)}`;
    const url = new URL(req.url);
    // normalize: /v1/x, /api/v1/x, /x  ->  upstream /api/v1/x
    let path = url.pathname.replace(/^\/api\/v1/, "").replace(/^\/v1/, "");
    if (!path.startsWith("/")) path = "/" + path;
    const target = UPSTREAM + path + url.search;

    const kind: Kind | null =
      /\/(chat\/completions|completions)$/.test(path) ? "openai"
      : /\/messages$/.test(path) ? "anthropic"
      : /\/responses$/.test(path) ? "responses"
      : null;

    // ---------- pin gate ----------
    // Refuse anything that would otherwise be proxied WITHOUT the model force + provider pin.
    const isRead = req.method === "GET" || req.method === "HEAD";
    const refuse = (violation: string, detail: string) => {
      writeRow({
        ts: new Date().toISOString(), runId: RUN_ID, harness: HARNESS, requestId,
        path, model: null, providerServed: null, streamed: false,
        promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0,
        totalTokens: 0, costUsd: 0, ttfbMs: null,
        totalMs: Math.round(performance.now() - t0),
        status: 403, error: detail, violation,
      });
      console.error(`REFUSED ${violation}: ${req.method} ${path} — ${detail}`);
      return new Response(
        JSON.stringify({ error: { message: `bench-proxy refused: ${violation} (${req.method} ${path}). ${detail}`, code: 403 } }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    };
    // Model-catalogue requests are answered by the shim, never forwarded. A harness that
    // fetches /models and splices the result into its prompt would otherwise pull the entire
    // upstream catalogue into context: measured at +5,126 tokens per request for one harness,
    // and nondeterministic, because the fetch races prompt assembly (the same command produced
    // 14,381 or 19,509 tokens depending on which won). Serving exactly one model makes the
    // catalogue a constant for every harness.
    if (isRead && /^\/models\/?$/.test(path)) {
      const now = Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000);
      const body = {
        object: "list",
        data: [{ id: MODEL, object: "model", created: now, owned_by: "bench" }],
      };
      writeRow({ path, model: MODEL, status: 200, note: "models_catalogue_served_by_shim" });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (!kind && NON_BILLABLE_HANDSHAKE.test(path)) {
      writeRow({ path, model: null, status: 404, note: "non_billable_handshake_refused" });
      return new Response(JSON.stringify({ error: "not served by the bench proxy" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    if (!kind && !(isRead && SAFE_READONLY.test(path))) {
      if (!ALLOW_UNPINNED) {
        return refuse("unpinnable_path",
          "this path is not a rewritable shape, so model + provider.only cannot be forced; " +
          "set BENCH_ALLOW_UNPINNED=1 to proxy it unpinned (exploration only)");
      }
      writeRow({
        ts: new Date().toISOString(), runId: RUN_ID, harness: HARNESS, requestId,
        path, model: null, providerServed: null, streamed: false,
        promptTokens: 0, completionTokens: 0, reasoningTokens: 0, cachedTokens: 0,
        totalTokens: 0, costUsd: 0, ttfbMs: null, totalMs: 0, status: null,
        error: "BENCH_ALLOW_UNPINNED=1", violation: "unpinned_passthrough",
      });
      console.error(`WARNING unpinned passthrough (BENCH_ALLOW_UNPINNED=1): ${req.method} ${path}`);
    }

    const headers = new Headers();
    for (const [k, v] of req.headers) {
      const lk = k.toLowerCase();
      if (["authorization", "x-api-key", "host", "content-length", "connection", "accept-encoding"].includes(lk)) continue;
      headers.set(k, v);
    }
    headers.set("authorization", `Bearer ${KEY}`);

    let outBody: string | undefined;
    let streamed = false;
    // The parsed request body, kept for segment attribution. Tokenizing is deliberately deferred
    // until after the response so it can never inflate ttfbMs.
    let reqBody: any = null;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const raw = await req.text();
      if (kind) {
        // A rewritable path whose body we cannot parse would go upstream unpinned — refuse it.
        let j: any;
        try { j = raw ? JSON.parse(raw) : null; } catch { j = undefined; }
        if (j === undefined || j === null || typeof j !== "object") {
          if (!ALLOW_UNPINNED) {
            return refuse("unparseable_body",
              "body on a pinnable path is missing or not JSON, so the model force could not be applied");
          }
          outBody = raw;
        } else {
          streamed = !!j.stream;
          reqBody = structuredClone(j);   // pre-rewrite: exactly what the harness sent
          outBody = JSON.stringify(rewrite(kind, j));
          headers.set("content-type", "application/json");
        }
      } else outBody = raw;
    }

    const acc = newAcc();
    const oacc = newOutAcc();

    // ---------- independent accounting ----------
    // Everything below is computed by us, from the wire, with one tokenizer. The provider's own
    // numbers are kept beside them as `providerReported*` and the gap is published, because on
    // caching harnesses that gap IS the finding. Cost stays provider-derived: we cannot price a
    // request ourselves.
    const measure = () => {
      let segs: Segments | null = null;
      if (kind && reqBody) {
        try { segs = segmentRequest(kind, reqBody); } catch (e) { console.error("segmentation failed", e); }
      }
      if (segs && !reconcileOk(segs)) {
        console.error(
          `SEGMENT RECONCILE FAIL ${HARNESS} ${requestId} ${path}: sum=${segs.segmentSumTokens} ` +
          `whole=${segs.contextTokens} delta=${segs.segmentReconcileDelta} (tolerance ${RECONCILE_TOLERANCE})`);
      }
      if (CAPTURE_DIR && reqBody) {
        try {
          mkdirSync(CAPTURE_DIR, { recursive: true });
          writeFileSync(`${CAPTURE_DIR}/${HARNESS}-${requestId}.json`,
            JSON.stringify({ harness: HARNESS, requestId, path, kind, body: reqBody }));
        } catch (e) { console.error("capture failed", e); }
      }
      const out = countOutput(oacc);
      return {
        // --- ours: one tokenizer, every harness, every shape ---
        tokenizer: TOKENIZER_ID, tokenizerSha256: TOKENIZER_SHA.slice(0, 16), tokenizerVocab: TOKENIZER_VOCAB,
        contextTokens: segs?.contextTokens ?? null,
        systemTokens: segs?.systemTokens ?? null,
        toolSchemaTokens: segs?.toolSchemaTokens ?? null,
        historyTokens: segs?.historyTokens ?? null,
        toolResultTokens: segs?.toolResultTokens ?? null,
        currentTurnTokens: segs?.currentTurnTokens ?? null,
        segmentSumTokens: segs?.segmentSumTokens ?? null,
        segmentReconcileDelta: segs?.segmentReconcileDelta ?? null,
        segmentReconcileOk: segs ? reconcileOk(segs) : null,
        toolCount: segs?.toolCount ?? null,
        messageCount: segs?.messageCount ?? null,
        toolResultCount: segs?.toolResultCount ?? null,
        cacheControlBreakpoints: segs?.cacheControlBreakpoints ?? null,
        ...out,
        // --- theirs: kept, never substituted for ours ---
        providerReportedPromptTokens: acc.prompt,
        providerReportedCompletionTokens: acc.completion,
        providerReportedReasoningTokens: acc.reasoning,
        providerReportedCachedTokens: acc.cached,
        providerReportedTotalTokens: acc.total,
        // --- the gap, published rather than hidden ---
        promptDivergence: segs ? segs.contextTokens - acc.prompt : null,
        promptDivergenceRatio: segs && acc.prompt ? +(segs.contextTokens / acc.prompt).toFixed(4) : null,
        outputDivergence: acc.completion ? out.outputTokens - acc.completion : null,
      };
    };

    const base = () => ({
      ts: new Date().toISOString(), runId: RUN_ID, harness: HARNESS, requestId,
      path, model: acc.model || MODEL, providerServed: acc.provider ?? null, streamed,
      promptTokens: acc.prompt, completionTokens: acc.completion, reasoningTokens: acc.reasoning,
      cachedTokens: acc.cached, totalTokens: acc.total, costUsd: acc.cost,
      ...measure(),
    });

    let res: Response;
    try {
      res = await fetch(target, { method: req.method, headers, body: outBody });
    } catch (e: any) {
      writeRow({ ...base(), ttfbMs: null, totalMs: Math.round(performance.now() - t0), status: 0, error: String(e) });
      return new Response(JSON.stringify({ error: String(e) }), { status: 502, headers: { "content-type": "application/json" } });
    }

    const outHeaders = new Headers(res.headers);
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");

    const ct = res.headers.get("content-type") || "";
    const isSSE = ct.includes("event-stream");

    if (!isSSE || !res.body) {
      const text = await res.text();
      const ttfb = Math.round(performance.now() - t0);
      if (res.ok) {
        try {
          const j = JSON.parse(text);
          absorb(acc, j);
          absorbFullResponse(oacc, j);   // our own output count, not the usage block
        } catch {}
      }
      const totalMs = Math.round(performance.now() - t0);
      if (kind === "responses" && res.ok) await fetchProvider(acc);
      writeRow({
        ...base(), ttfbMs: ttfb, totalMs,
        status: res.status, error: res.ok ? null : text.slice(0, 500),
      });
      return new Response(text, { status: res.status, headers: outHeaders });
    }

    // SSE: single-pass passthrough + parse. No buffering of our own, but the upstream is drained
    // eagerly rather than piped: some harnesses (codex, hermes) abort the response body as soon as
    // they have the final text, and a pipeThrough/flush tap loses the usage row when they do.
    let ttfb: number | null = null;
    let carry = "";
    let finalized = false;
    const dec = new TextDecoder();
    const reader = res.body.getReader();

    const finalize = async () => {
      if (finalized) return;
      finalized = true;
      if (carry) { feedSSE(acc, carry, oacc); carry = ""; }
      const totalMs = Math.round(performance.now() - t0);
      if (!acc.sawUsage || acc.total === 0) await fetchGeneration(acc);
      else if (kind === "responses") await fetchProvider(acc);
      writeRow({ ...base(), ttfbMs: ttfb, totalMs, status: res.status, error: null });
    };

    const out = new ReadableStream<Uint8Array>({
      start(ctrl) {
        (async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (ttfb === null) ttfb = Math.round(performance.now() - t0);
              // client may already be gone; keep draining upstream for metering either way
              try { ctrl.enqueue(value); } catch { /* client detached */ }
              carry += dec.decode(value, { stream: true });
              const cut = carry.lastIndexOf("\n");
              if (cut >= 0) { feedSSE(acc, carry.slice(0, cut), oacc); carry = carry.slice(cut + 1); }
            }
            try { ctrl.close(); } catch { /* already closed */ }
          } catch (e) {
            try { ctrl.error(e); } catch { /* already closed */ }
          } finally {
            await finalize();
          }
        })();
      },
      // client aborted: do NOT cancel the upstream reader, let the pump finish and meter.
      cancel() { /* no-op */ },
    });

    return new Response(out, { status: res.status, headers: outHeaders });
  },
});

console.log(`openrouter-shim listening: http://localhost:${server.port}`);
console.log(`  base URL for agents: http://localhost:${server.port}/v1`);
console.log(`  model=${MODEL} provider.only=${PROVIDER_ONLY}`);
console.log(`  log=${LOG} runId=${RUN_ID} harness=${HARNESS}`);
console.log(`  tokenizer=${TOKENIZER_ID} vocab=${TOKENIZER_VOCAB} sha256=${TOKENIZER_SHA.slice(0, 16)} (offline)`);
