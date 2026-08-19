import { defaultClock, noopSleep } from "./clock";
import { DuplicateWindow } from "./dedupe";
import { CollectingLogger, type Logger } from "./log";
import { MetricsSink } from "./metrics";
import { parseEvent } from "./parse";
import { defaultRegistry, type HandlerRegistry } from "./registry";
import { DEFAULT_RETRY_POLICY, type RetryPolicy, withRetry } from "./retry";
import { MemoryStore } from "./store";
import { transformEvent } from "./transform";
import { errorsOf, hasBlockingIssue, runValidators, summarizeIssues } from "./validate";
import type {
  Clock,
  Event,
  Handler,
  HandlerContext,
  HandlerOutput,
  PipelineResult,
  PipelineStage,
  RecordStore,
  SleepFn,
  ValidationIssue,
} from "./types";

export const DEAD_LETTER_NAMESPACE = "deadletter";

export interface PipelineDeps {
  logger?: Logger;
  metrics?: MetricsSink;
  clock?: Clock;
  sleep?: SleepFn;
  store?: RecordStore;
  registry?: HandlerRegistry;
  retryPolicy?: RetryPolicy;
  tags?: Record<string, string>;
  dedupe?: DuplicateWindow;
}

export interface ResolvedPipeline {
  ctx: HandlerContext;
  registry: HandlerRegistry;
  policy: RetryPolicy;
  tags: Record<string, string>;
  dedupe: DuplicateWindow;
}

export function resolvePipelineDeps(deps: PipelineDeps = {}): ResolvedPipeline {
  const ctx: HandlerContext = {
    logger: deps.logger ?? new CollectingLogger(),
    metrics: deps.metrics ?? new MetricsSink(),
    clock: deps.clock ?? defaultClock(),
    sleep: deps.sleep ?? noopSleep,
    store: deps.store ?? new MemoryStore(),
  };
  return {
    ctx,
    registry: deps.registry ?? defaultRegistry,
    policy: deps.retryPolicy ?? DEFAULT_RETRY_POLICY,
    tags: deps.tags ?? {},
    dedupe: deps.dedupe ?? new DuplicateWindow(0),
  };
}

async function executeHandler(
  handler: Handler,
  name: string,
  event: Event,
  ctx: HandlerContext,
  policy: RetryPolicy,
): Promise<HandlerOutput> {
  return withRetry((attempt) => {
    ctx.metrics.counter(`handler.${name}.invocations`);
    return handler({ ...event, body: { ...event.body, _attempt: attempt } }, ctx);
  }, policy, {
    label: `handler.${name}`,
    sleep: ctx.sleep,
    metrics: ctx.metrics,
    logger: ctx.logger,
    clock: ctx.clock,
  });
}

async function persistDeadLetter(
  stage: PipelineStage,
  raw: string,
  reason: string,
  ctx: HandlerContext,
  policy: RetryPolicy,
): Promise<string> {
  const key = `${stage}:${ctx.clock.now()}`;
  await withRetry(
    () => {
      ctx.store.put(DEAD_LETTER_NAMESPACE, key, { stage, raw, reason });
    },
    policy,
    {
      label: "deadletter.write",
      sleep: ctx.sleep,
      metrics: ctx.metrics,
      logger: ctx.logger,
    },
  );
  ctx.metrics.counter(`pipeline.rejected.${stage}`);
  return key;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failure(
  stage: PipelineStage,
  kind: PipelineResult["kind"],
  id: string,
  issues: ValidationIssue[],
  error: string,
): PipelineResult {
  return { ok: false, stage, kind, id, issues, error };
}

export async function runPipeline(
  raw: string,
  deps: PipelineDeps = {},
): Promise<PipelineResult> {
  const { ctx, registry, policy, tags, dedupe } = resolvePipelineDeps(deps);
  ctx.metrics.counter("pipeline.received");

  let parsed;
  try {
    parsed = parseEvent(raw);
  } catch (error) {
    const reason = describeError(error);
    await persistDeadLetter("parse", raw, reason, ctx, policy);
    ctx.logger.error("parse failed", { reason });
    return failure("parse", "unknown", "", [], reason);
  }

  const issues = runValidators(parsed, { metrics: ctx.metrics });
  if (hasBlockingIssue(issues)) {
    const reason = summarizeIssues(errorsOf(issues));
    await persistDeadLetter("validate", raw, reason, ctx, policy);
    ctx.logger.warn("validation rejected event", { id: parsed.id, reason });
    return failure("validate", parsed.kind, parsed.id, issues, reason);
  }

  const event = transformEvent(parsed, { clock: ctx.clock, tags });

  if (dedupe.record(event.id)) {
    ctx.metrics.counter("pipeline.duplicate");
    ctx.logger.warn("duplicate event suppressed", { id: event.id });
    return failure("duplicate", event.kind, event.id, issues, `duplicate:${event.id}`);
  }

  const handler = registry.resolveHandler(event.kind);
  const name = registry.nameFor(event.kind);
  ctx.metrics.counter(`pipeline.routed.${name}`);

  try {
    const output = await executeHandler(handler, name, event, ctx, policy);
    ctx.metrics.counter(output.accepted ? "pipeline.accepted" : "pipeline.declined");
    return {
      ok: output.accepted,
      stage: "done",
      kind: event.kind,
      id: event.id,
      issues,
      output,
    };
  } catch (error) {
    const reason = describeError(error);
    await persistDeadLetter("handle", raw, reason, ctx, policy);
    ctx.logger.error("handler failed", { id: event.id, reason });
    return failure("handle", event.kind, event.id, issues, reason);
  }
}

export async function runPipelineBatch(
  raws: string[],
  deps: PipelineDeps = {},
): Promise<PipelineResult[]> {
  const resolved = resolvePipelineDeps(deps);
  const shared: PipelineDeps = {
    logger: resolved.ctx.logger,
    metrics: resolved.ctx.metrics,
    clock: resolved.ctx.clock,
    sleep: resolved.ctx.sleep,
    store: resolved.ctx.store,
    registry: resolved.registry,
    retryPolicy: resolved.policy,
    tags: resolved.tags,
    dedupe: resolved.dedupe,
  };
  const results: PipelineResult[] = [];
  for (const raw of raws) {
    results.push(await runPipeline(raw, shared));
  }
  return results;
}

export function countAccepted(results: PipelineResult[]): number {
  return results.filter((result) => result.ok).length;
}
