// Independent token accounting: count every request and response with ONE tokenizer — the
// benchmark model's own — instead of trusting each provider shape's `usage` block.
//
// Why: OpenAI-shape `prompt_tokens` INCLUDES cache reads, Anthropic-shape `input_tokens` EXCLUDES
// them, and harnesses that set `cache_control` breakpoints report a small uncached prompt while
// sending the same context. Provider-reported numbers are therefore not comparable across
// harnesses. These are, because they are computed from the bytes on the wire by one function.
//
// Caveat carried in the docs: we count the CONTENT the harness put on the wire, not the serving
// stack's final rendered prompt (chat template + its own tool-schema rendering are added
// server-side and are unobservable from here). Consistent estimator for cross-harness comparison,
// not the biller's count. Cost stays provider-derived.

import { loadTokenizer } from "./tokenizer";

const tok = loadTokenizer();
export const TOKENIZER_SHA = tok.sha256;
export const TOKENIZER_VOCAB = tok.size;

export type Kind = "openai" | "anthropic" | "responses";
export type SegName = "system" | "toolSchema" | "history" | "toolResult" | "currentTurn";
const SEG_ORDER: SegName[] = ["system", "toolSchema", "history", "toolResult", "currentTurn"];

// ---------- text extraction ----------
const isObj = (v: any) => v && typeof v === "object";

/** Text of a message `content` field: a string, or a block array (anthropic / openai parts). */
function contentText(c: any): string {
  if (c == null) return "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map(blockText).filter(Boolean).join("\n");
  if (isObj(c)) return blockText(c);
  return String(c);
}

/** One content block. Text-bearing fields are taken verbatim; anything else is serialized, since
 *  the model still receives it as tokens. */
function blockText(b: any): string {
  if (b == null) return "";
  if (typeof b === "string") return b;
  if (!isObj(b)) return String(b);
  switch (b.type) {
    case "text": case "input_text": case "output_text": return b.text ?? "";
    case "thinking": return b.thinking ?? "";
    case "redacted_thinking": return b.data ?? "";
    case "reasoning": return contentText(b.summary ?? b.content ?? "");
    case "tool_use": case "tool_call":
      return `${b.name ?? ""}\n${stable(b.input ?? b.arguments ?? {})}`;
    case "tool_result": case "function_call_output":
      return contentText(b.content ?? b.output ?? "");
    case "image": case "input_image": case "image_url":
      // an image is not tokenized by this tokenizer; record its reference only
      return typeof b.image_url === "string" ? b.image_url : stable(b.source ?? b.image_url ?? {});
    default: return stable(b);
  }
}

/** Deterministic JSON (key-sorted) so the same schema always tokenizes to the same number. */
export function stable(v: any): string {
  const seen = new WeakSet();
  const walk = (x: any): any => {
    if (!isObj(x)) return x;
    if (seen.has(x)) return "[circular]";
    seen.add(x);
    if (Array.isArray(x)) return x.map(walk);
    const out: Record<string, any> = {};
    for (const k of Object.keys(x).sort()) out[k] = walk(x[k]);
    return out;
  };
  try { return JSON.stringify(walk(v)) ?? ""; } catch { return ""; }
}

// ---------- request segmentation ----------
export type Segments = {
  systemTokens: number;
  toolSchemaTokens: number;
  historyTokens: number;
  toolResultTokens: number;
  currentTurnTokens: number;
  /** sum of the five segments */
  segmentSumTokens: number;
  /** the same content tokenized as one string — segments must reconcile with this */
  contextTokens: number;
  /** contextTokens - segmentSumTokens; nonzero only from BPE merges across segment joins */
  segmentReconcileDelta: number;
  toolCount: number;
  messageCount: number;
  toolResultCount: number;
  /** explicit `cache_control` breakpoints the harness set — the reason its reported prompt is low */
  cacheControlBreakpoints: number;
};

class Bag {
  private parts: Record<SegName, string[]> =
    { system: [], toolSchema: [], history: [], toolResult: [], currentTurn: [] };
  add(seg: SegName, text: string) { if (text) this.parts[seg].push(text); }
  segText(seg: SegName) { return this.parts[seg].join("\n"); }
  wholeText() { return SEG_ORDER.map((s) => this.segText(s)).filter(Boolean).join("\n"); }
}

function countCacheControl(o: any, depth = 0): number {
  if (depth > 20 || !isObj(o)) return 0;
  let n = 0;
  if (!Array.isArray(o) && o.cache_control) n++;
  for (const v of Array.isArray(o) ? o : Object.values(o)) n += countCacheControl(v, depth + 1);
  return n;
}

/**
 * Segment a request body. The five segments partition every token-bearing field of the body, in
 * the same way for all three shapes:
 *   system      — system prompt / system instruction (wherever the shape puts it)
 *   toolSchema  — tool & function definitions plus tool_choice
 *   history     — prior conversation turns: earlier user messages, and every assistant turn,
 *                 including the ones this agentic loop has already produced. This is the segment
 *                 that grows as a run goes on.
 *   toolResult  — tool output fed back in, anywhere in the conversation
 *   currentTurn — the newest user message: the instruction the model is answering right now
 */
export function segmentRequest(kind: Kind, body: any): Segments {
  const b = new Bag();
  let toolCount = 0, messageCount = 0, toolResultCount = 0;

  // tool schemas: identical field in all three shapes
  const tools = body?.tools ?? body?.functions;
  if (Array.isArray(tools) && tools.length) {
    toolCount = tools.length;
    for (const t of tools) b.add("toolSchema", stable(t));
  }
  if (body?.tool_choice && typeof body.tool_choice !== "string") b.add("toolSchema", stable(body.tool_choice));

  if (kind === "openai") {
    const msgs: any[] = Array.isArray(body?.messages) ? body.messages : [];
    messageCount = msgs.length;
    const lastUser = lastIndex(msgs, (m) => m?.role === "user");
    msgs.forEach((m, i) => {
      const role = m?.role;
      if (role === "system" || role === "developer") { b.add("system", contentText(m.content)); return; }
      if (role === "tool" || role === "function") {
        toolResultCount++; b.add("toolResult", contentText(m.content)); return;
      }
      const seg: SegName = i === lastUser ? "currentTurn" : "history";
      b.add(seg, contentText(m?.content));
      if (Array.isArray(m?.tool_calls)) for (const tc of m.tool_calls) b.add(seg, stable(tc));
      if (m?.function_call) b.add(seg, stable(m.function_call));
    });
  } else if (kind === "anthropic") {
    b.add("system", contentText(body?.system));
    const msgs: any[] = Array.isArray(body?.messages) ? body.messages : [];
    messageCount = msgs.length;
    // the newest user message is the last one carrying a non-tool_result block
    const lastUser = lastIndex(msgs, (m) => m?.role === "user" && blocks(m?.content).some(
      (x: any) => x?.type !== "tool_result"));
    msgs.forEach((m, i) => {
      const seg: SegName = i === lastUser ? "currentTurn" : "history";
      for (const blk of blocks(m?.content)) {
        if (isObj(blk) && blk.type === "tool_result") { toolResultCount++; b.add("toolResult", blockText(blk)); }
        else b.add(seg, blockText(blk));
      }
    });
  } else {
    b.add("system", contentText(body?.instructions));
    const input = body?.input;
    if (typeof input === "string") { messageCount = 1; b.add("currentTurn", input); }
    else if (Array.isArray(input)) {
      messageCount = input.length;
      const lastUser = lastIndex(input, (it) =>
        it?.role === "user" && (it?.type === undefined || it?.type === "message"));
      input.forEach((it, i) => {
        const type = it?.type;
        if (type === "function_call_output" || type === "computer_call_output" ||
            type === "local_shell_call_output" || type === "custom_tool_call_output") {
          toolResultCount++; b.add("toolResult", contentText(it.output ?? it.content)); return;
        }
        if (it?.role === "system" || it?.role === "developer") { b.add("system", contentText(it.content)); return; }
        const seg: SegName = i === lastUser ? "currentTurn" : "history";
        if (type === "function_call" || type === "custom_tool_call") { b.add(seg, `${it.name ?? ""}\n${it.arguments ?? ""}`); return; }
        if (type === "reasoning") { b.add(seg, blockText(it)); return; }
        b.add(seg, contentText(it?.content ?? it?.text ?? it));
      });
    }
  }

  const per = Object.fromEntries(SEG_ORDER.map((s) => [s, tok.countText(b.segText(s))])) as Record<SegName, number>;
  const segmentSumTokens = SEG_ORDER.reduce((a, s) => a + per[s], 0);
  const contextTokens = tok.countText(b.wholeText());
  return {
    systemTokens: per.system,
    toolSchemaTokens: per.toolSchema,
    historyTokens: per.history,
    toolResultTokens: per.toolResult,
    currentTurnTokens: per.currentTurn,
    segmentSumTokens,
    contextTokens,
    segmentReconcileDelta: contextTokens - segmentSumTokens,
    toolCount, messageCount, toolResultCount,
    cacheControlBreakpoints: countCacheControl(body),
  };
}

const blocks = (c: any): any[] => (Array.isArray(c) ? c : c == null ? [] : [c]);
function lastIndex<T>(arr: T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
  return -1;
}

// ---------- response accounting ----------
export type OutAcc = { content: string; reasoning: string; toolArgs: string };
export const newOutAcc = (): OutAcc => ({ content: "", reasoning: "", toolArgs: "" });

/** One SSE event object, any of the three shapes. Streamed deltas only — the final full object
 *  (responses `response.completed`, openai non-delta chunks) is deliberately ignored so nothing
 *  is counted twice. */
export function absorbStreamDelta(o: OutAcc, ev: any) {
  if (!isObj(ev)) return;
  const t = ev.type;

  // --- responses shape: typed delta events ---
  if (typeof t === "string" && t.endsWith(".delta") && typeof ev.delta === "string") {
    if (t.includes("reasoning")) o.reasoning += ev.delta;
    else if (t.includes("arguments")) o.toolArgs += ev.delta;
    else if (t.includes("output_text") || t.includes("text")) o.content += ev.delta;
    return;
  }
  // --- anthropic shape ---
  if (t === "content_block_delta" && isObj(ev.delta)) {
    const d = ev.delta;
    if (typeof d.text === "string") o.content += d.text;
    if (typeof d.thinking === "string") o.reasoning += d.thinking;
    if (typeof d.partial_json === "string") o.toolArgs += d.partial_json;
    return;
  }
  if (t === "content_block_start" && isObj(ev.content_block)) {
    const cb = ev.content_block;
    if (cb.type === "tool_use" && typeof cb.name === "string") o.toolArgs += cb.name;
    if (cb.type === "text" && typeof cb.text === "string") o.content += cb.text;
    if (cb.type === "thinking" && typeof cb.thinking === "string") o.reasoning += cb.thinking;
    return;
  }
  // --- openai chat.completion.chunk ---
  if (Array.isArray(ev.choices)) {
    for (const ch of ev.choices) {
      const d = ch?.delta;
      if (!isObj(d)) continue;
      if (typeof d.content === "string") o.content += d.content;
      if (typeof d.reasoning === "string") o.reasoning += d.reasoning;
      if (typeof d.reasoning_content === "string") o.reasoning += d.reasoning_content;
      for (const tc of d.tool_calls ?? []) {
        if (typeof tc?.function?.name === "string") o.toolArgs += tc.function.name;
        if (typeof tc?.function?.arguments === "string") o.toolArgs += tc.function.arguments;
      }
    }
  }
}

/** A complete non-streamed response body, any of the three shapes. */
export function absorbFullResponse(o: OutAcc, body: any) {
  if (!isObj(body)) return;
  if (Array.isArray(body.choices)) {                                   // openai
    for (const ch of body.choices) {
      const m = ch?.message ?? {};
      if (typeof m.content === "string") o.content += m.content;
      else o.content += contentText(m.content);
      if (typeof m.reasoning === "string") o.reasoning += m.reasoning;
      if (typeof m.reasoning_content === "string") o.reasoning += m.reasoning_content;
      for (const tc of m.tool_calls ?? []) o.toolArgs += `${tc?.function?.name ?? ""}${tc?.function?.arguments ?? ""}`;
    }
    return;
  }
  if (Array.isArray(body.content) && body.type === "message") {        // anthropic
    for (const blk of body.content) {
      if (blk?.type === "thinking") o.reasoning += blk.thinking ?? "";
      else if (blk?.type === "tool_use") o.toolArgs += `${blk.name ?? ""}${stable(blk.input ?? {})}`;
      else o.content += blockText(blk);
    }
    return;
  }
  if (Array.isArray(body.output)) {                                    // responses
    for (const it of body.output) {
      if (it?.type === "reasoning") o.reasoning += blockText(it);
      else if (it?.type === "function_call") o.toolArgs += `${it.name ?? ""}${it.arguments ?? ""}`;
      else o.content += contentText(it?.content);
    }
  }
}

export type OutCounts = {
  outputContentTokens: number;
  outputReasoningTokens: number;
  outputToolCallTokens: number;
  outputTokens: number;
};
export function countOutput(o: OutAcc): OutCounts {
  const c = tok.countText(o.content), r = tok.countText(o.reasoning), a = tok.countText(o.toolArgs);
  return { outputContentTokens: c, outputReasoningTokens: r, outputToolCallTokens: a, outputTokens: c + r + a };
}

/** Tolerance for the segments-sum-to-total assertion: BPE can merge across the joins between
 *  segments, so a few tokens of slack are expected. Anything larger is a segmentation bug. */
export const RECONCILE_TOLERANCE = Math.max(4, SEG_ORDER.length);
export function reconcileOk(s: Segments): boolean {
  return Math.abs(s.segmentReconcileDelta) <= RECONCILE_TOLERANCE;
}
