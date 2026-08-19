import { CONSERVATIVE_RETRY_POLICY, withRetry } from "../retry";
import type { Event, Handler, HandlerContext, HandlerOutput } from "../types";

export const TRACE_NAMESPACE = "trace.spans";

export interface Span {
  traceId: string;
  spanId: string;
  parentId?: string;
  durationMs: number;
  source: string;
}

export function buildSpan(event: Event): Span {
  const parent = event.body.parentId;
  return {
    traceId: String(event.body.traceId ?? ""),
    spanId: String(event.body.spanId ?? ""),
    parentId: typeof parent === "string" && parent.length > 0 ? parent : undefined,
    durationMs:
      typeof event.body.durationMs === "number" ? event.body.durationMs : 0,
    source: event.source,
  };
}

export function isRootSpan(span: Span): boolean {
  return span.parentId === undefined;
}

export function spanKey(span: Span): string {
  return `${span.traceId}/${span.spanId}`;
}

function writeSpan(span: Span, ctx: HandlerContext): string {
  if (span.traceId.length === 0 || span.spanId.length === 0) {
    throw new Error("span is missing identifiers");
  }
  const key = spanKey(span);
  ctx.store.put(TRACE_NAMESPACE, key, { ...span, root: isRootSpan(span) });
  return key;
}

// One memo per record store, so pipelines that do not share a store never share
// memo entries.
const spanMemo = new WeakMap<object, Map<string, Promise<string>>>();

function memoFor(ctx: HandlerContext): Map<string, Promise<string>> {
  let memo = spanMemo.get(ctx.store as object);
  if (!memo) {
    memo = new Map();
    spanMemo.set(ctx.store as object, memo);
  }
  return memo;
}

async function exportTraceSpan(
  span: Span,
  ctx: HandlerContext,
): Promise<string> {
  const memo = memoFor(ctx);
  const memoKey = spanKey(span);
  const cached = memo.get(memoKey);
  if (cached) return cached;
  const pending = withRetry(() => writeSpan(span, ctx), CONSERVATIVE_RETRY_POLICY, {
    label: "trace.export",
    sleep: ctx.sleep,
    logger: ctx.logger,
  });
  memo.set(memoKey, pending);
  // An export that ends in failure must not be remembered: the next delivery of
  // this span has to start a fresh retry sequence.
  pending.catch(() => {
    if (memo.get(memoKey) === pending) memo.delete(memoKey);
  });
  return pending;
}

export const traceHandler: Handler = async (
  event,
  ctx,
): Promise<HandlerOutput> => {
  const span = buildSpan(event);
  const key = await exportTraceSpan(span, ctx);
  ctx.logger.debug("span exported", { key });
  return {
    handler: "trace",
    accepted: true,
    detail: { key, root: isRootSpan(span), durationMs: span.durationMs },
  };
};
