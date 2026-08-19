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

// One memo per record store, so pipelines that do not share a store never share
// memo entries.
const auditMemo = new WeakMap<object, Map<string, Promise<string>>>();

function memoFor(ctx: HandlerContext): Map<string, Promise<string>> {
  let memo = auditMemo.get(ctx.store as object);
  if (!memo) {
    memo = new Map();
    auditMemo.set(ctx.store as object, memo);
  }
  return memo;
}

async function dispatchAuditStage(
  record: AuditRecord,
  ctx: HandlerContext,
): Promise<string> {
  const memo = memoFor(ctx);
  const memoKey = `${record.id}:${record.stage}`;
  const cached = memo.get(memoKey);
  if (cached) {
    ctx.metrics.counter("audit.persist.deduplicated");
    return cached;
  }
  const pending = withRetry(
    () => persistAuditRecord(record, ctx),
    DEFAULT_RETRY_POLICY,
    {
      label: "audit.persist",
      sleep: ctx.sleep,
      metrics: ctx.metrics,
      logger: ctx.logger,
      clock: ctx.clock,
    },
  );
  memo.set(memoKey, pending);
  return pending;
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
