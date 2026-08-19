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

async function exportTraceSpan(
  span: Span,
  ctx: HandlerContext,
): Promise<string> {
  return withRetry(() => writeSpan(span, ctx), CONSERVATIVE_RETRY_POLICY, {
    label: "trace.export",
    sleep: ctx.sleep,
    logger: ctx.logger,
  });
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
