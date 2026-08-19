import { AGGRESSIVE_RETRY_POLICY, RetryExhaustedError, withRetry } from "../retry";
import type { Event, Handler, HandlerContext, HandlerOutput } from "../types";

export const ALERT_NAMESPACE = "alert.outbox";
export const SEVERITY_ORDER = ["info", "warning", "critical", "page"];

export interface AlertPayload {
  id: string;
  severity: string;
  summary: string;
  source: string;
  escalate: boolean;
}

export function severityRank(severity: string): number {
  const index = SEVERITY_ORDER.indexOf(severity.toLowerCase());
  return index === -1 ? 0 : index;
}

export function shouldEscalate(event: Event): boolean {
  return severityRank(String(event.body.severity ?? "")) >= 2;
}

export function buildAlertPayload(event: Event): AlertPayload {
  return {
    id: event.id,
    severity: String(event.body.severity ?? "info").toLowerCase(),
    summary: String(event.body.summary ?? "").trim(),
    source: event.source,
    escalate: shouldEscalate(event),
  };
}

function deliver(payload: AlertPayload, ctx: HandlerContext): string {
  if (payload.summary.length === 0) {
    throw new Error("alert summary is empty");
  }
  const channel = payload.escalate ? "pager" : "digest";
  const key = `${channel}:${payload.id}`;
  ctx.store.put(ALERT_NAMESPACE, key, { ...payload, channel });
  return key;
}

async function notifyAlertChannel(
  payload: AlertPayload,
  ctx: HandlerContext,
): Promise<string> {
  return withRetry(() => deliver(payload, ctx), AGGRESSIVE_RETRY_POLICY, {
    label: "alert.notify",
    sleep: ctx.sleep,
    logger: ctx.logger,
  });
}

export const alertHandler: Handler = async (
  event,
  ctx,
): Promise<HandlerOutput> => {
  const payload = buildAlertPayload(event);
  try {
    const key = await notifyAlertChannel(payload, ctx);
    return {
      handler: "alert",
      accepted: true,
      detail: { key, severity: payload.severity, escalate: payload.escalate },
    };
  } catch (error) {
    const attempts =
      error instanceof RetryExhaustedError ? error.attempts : 1;
    ctx.logger.error("alert delivery abandoned", { id: event.id, attempts });
    return {
      handler: "alert",
      accepted: false,
      detail: { severity: payload.severity, attempts },
    };
  }
};
