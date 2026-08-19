import type { Event, Handler, HandlerContext, HandlerOutput } from "../types";

export const QUARANTINE_NAMESPACE = "quarantine";

export function quarantineKey(event: Event): string {
  return `${event.source || "unknown-source"}:${event.id}`;
}

function quarantine(event: Event, ctx: HandlerContext): string {
  const key = quarantineKey(event);
  ctx.store.put(QUARANTINE_NAMESPACE, key, {
    id: event.id,
    kind: event.kind,
    source: event.source,
    timestamp: event.timestamp,
    keys: Object.keys(event.body).sort(),
  });
  return key;
}

export const fallbackHandler: Handler = async (
  event,
  ctx,
): Promise<HandlerOutput> => {
  const key = quarantine(event, ctx);
  ctx.logger.warn("event quarantined", { id: event.id, kind: event.kind });
  return {
    handler: "fallback",
    accepted: false,
    detail: { key, reason: "no handler registered for kind" },
  };
};
