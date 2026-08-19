import type { MetricsSink } from "../metrics";
import { DEFAULT_RETRY_POLICY, withRetry } from "../retry";
import { projectBody } from "../transform";
import type { Event, Handler, HandlerContext, HandlerOutput } from "../types";

export const AUDIT_NAMESPACE = "audit";
export const AUDIT_FIELDS = ["actor", "action", "target", "outcome"];

type AuditStage = "write" | "amend";

interface AuditRecord {
  id: string;
  actor: string;
  action: string;
  source: string;
  timestamp: number;
  stage: AuditStage;
  attributes: Record<string, unknown>;
}

function buildAuditRecord(event: Event, stage: AuditStage): AuditRecord {
  const attributes = projectBody(event, AUDIT_FIELDS);
  return {
    id: event.id,
    actor: String(attributes.actor ?? "anonymous"),
    action: String(attributes.action ?? "unspecified"),
    source: event.source,
    timestamp: event.timestamp,
    stage,
    attributes,
  };
}

function selectStage(event: Event, ctx: HandlerContext): AuditStage {
  return ctx.store.get(AUDIT_NAMESPACE, event.id) ? "amend" : "write";
}

function reportAuditVolume(metrics: MetricsSink, stage: AuditStage): void {
  metrics.counter(`audit.${stage}`);
}

export function persistAuditRecord(
  record: AuditRecord,
  ctx: HandlerContext,
): string {
  if (record.actor.length === 0) {
    throw new Error("audit record has no actor");
  }
  const key = `${record.id}:${record.stage}`;
  ctx.store.put(AUDIT_NAMESPACE, record.id, { ...record, key });
  ctx.store.put(`${AUDIT_NAMESPACE}.journal`, key, { ...record, key });
  reportAuditVolume(ctx.metrics, record.stage);
  return key;
}

async function dispatchAuditStage(
  record: AuditRecord,
  ctx: HandlerContext,
): Promise<string> {
  return withRetry(() => persistAuditRecord(record, ctx), DEFAULT_RETRY_POLICY, {
    label: "audit.persist",
    sleep: ctx.sleep,
    metrics: ctx.metrics,
    logger: ctx.logger,
    clock: ctx.clock,
  });
}

async function routeAuditEvent(
  event: Event,
  ctx: HandlerContext,
): Promise<HandlerOutput> {
  const stage = selectStage(event, ctx);
  const record = buildAuditRecord(event, stage);
  ctx.logger.debug("routing audit event", { id: event.id, stage });
  const key = await dispatchAuditStage(record, ctx);
  return {
    handler: "audit",
    accepted: true,
    detail: { key, stage, actor: record.actor },
  };
}

export const auditHandler: Handler = async (event, ctx) =>
  routeAuditEvent(event, ctx);
