import { describe, expect, test } from "bun:test";
import { SteppingClock, createSleepRecorder } from "../src/clock";
import { CollectingLogger } from "../src/log";
import { MetricsSink } from "../src/metrics";
import { MemoryStore } from "../src/store";
import { countAccepted, runPipeline, runPipelineBatch } from "../src/pipeline";
import type { PipelineDeps } from "../src/pipeline";

const AUDIT = 'audit|EV-1|1700000001|svc.auth\n{"actor":"u1","action":"login"}';
const METRIC = 'metric|M-1|1700000002|svc.stats\n{"name":"cpu.load","value":3}';
const ALERT =
  'alert|A-1|1700000003|svc.ops\n{"severity":"critical","summary":"disk full"}';
const TRACE =
  'trace|T-1|1700000004|svc.web\n{"traceId":"t1","spanId":"s1","durationMs":12}';
const STRANGE = 'weird|X-1|1700000005|svc.lab\n{"foo":1}';

function deps(): PipelineDeps & { store: MemoryStore; metrics: MetricsSink; logger: CollectingLogger } {
  return {
    logger: new CollectingLogger(),
    metrics: new MetricsSink(),
    clock: new SteppingClock({ start: 1_700_000_000_000, step: 1 }),
    sleep: createSleepRecorder().sleep,
    store: new MemoryStore(),
  };
}

describe("runPipeline", () => {
  test("routes an audit event through to storage", async () => {
    const d = deps();
    const result = await runPipeline(AUDIT, d);
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("done");
    expect(result.output?.handler).toBe("audit");
    expect(result.output?.detail.stage).toBe("write");
    expect(d.store.get("audit", "EV-1")?.actor).toBe("u1");
    expect(d.metrics.read("audit.write")).toBe(1);
    expect(d.metrics.read("pipeline.accepted")).toBe(1);
  });

  test("a repeated audit event is amended", async () => {
    const d = deps();
    await runPipeline(AUDIT, d);
    const second = await runPipeline(AUDIT, d);
    expect(second.output?.detail.stage).toBe("amend");
    expect(d.store.keys("audit.journal")).toEqual(["EV-1:amend", "EV-1:write"]);
  });

  test("aggregates metric events", async () => {
    const d = deps();
    await runPipeline(METRIC, d);
    await runPipeline(METRIC, d);
    expect(d.metrics.read("sample.cpu.load")).toBe(6);
    expect(d.store.get("metric", "svc.stats/cpu.load")?.count).toBe(2);
  });

  test("escalates critical alerts", async () => {
    const d = deps();
    const result = await runPipeline(ALERT, d);
    expect(result.output?.detail.escalate).toBe(true);
    expect(d.store.keys("alert.outbox")).toEqual(["pager:A-1"]);
  });

  test("gives up on an alert with no summary", async () => {
    const d = deps();
    const result = await runPipeline(
      'alert|A-2|1700000003|svc.ops\n{"severity":"info","summary":"  "}',
      d,
    );
    expect(result.ok).toBe(false);
    expect(result.output?.accepted).toBe(false);
    expect(result.output?.detail.attempts).toBe(8);
    expect(d.store.size()).toBe(0);
  });

  test("stores trace spans", async () => {
    const d = deps();
    const result = await runPipeline(TRACE, d);
    expect(result.ok).toBe(true);
    expect(d.store.get("trace.spans", "t1/s1")?.root).toBe(true);
  });

  test("quarantines unknown kinds", async () => {
    const d = deps();
    const result = await runPipeline(STRANGE, d);
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("done");
    expect(result.output?.handler).toBe("fallback");
    expect(result.issues.map((issue) => issue.code)).toContain(
      "schema.unknown_kind",
    );
    expect(d.store.keys("quarantine")).toEqual(["svc.lab:X-1"]);
  });

  test("dead letters unparseable payloads", async () => {
    const d = deps();
    const result = await runPipeline("not-an-event", d);
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("parse");
    expect(d.store.keys("deadletter")).toHaveLength(1);
    expect(d.metrics.read("pipeline.rejected.parse")).toBe(1);
    expect(d.logger.byLevel("error")).toHaveLength(1);
  });

  test("dead letters events that fail validation", async () => {
    const d = deps();
    const result = await runPipeline('audit|EV-2|1|svc.auth\n{"actor":"u"}', d);
    expect(result.stage).toBe("validate");
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
    expect(d.metrics.read("pipeline.rejected.validate")).toBe(1);
    expect(d.metrics.read("deadletter.write.success")).toBe(1);
  });

  test("enriches the event before handling", async () => {
    const d = deps();
    await runPipeline(AUDIT, { ...d, tags: { region: "eu" } });
    expect(d.metrics.read("handler.audit.invocations")).toBe(1);
    expect(d.metrics.read("handler.audit.success")).toBe(1);
  });
});

describe("runPipelineBatch", () => {
  test("shares one context across the batch", async () => {
    const d = deps();
    const results = await runPipelineBatch(
      [AUDIT, METRIC, ALERT, TRACE, STRANGE, "junk"],
      d,
    );
    expect(results).toHaveLength(6);
    expect(countAccepted(results)).toBe(4);
    expect(d.metrics.read("pipeline.received")).toBe(6);
    expect(d.store.namespaces()).toContain("deadletter");
  });

  test("metric snapshots are sorted", async () => {
    const d = deps();
    await runPipelineBatch([AUDIT, METRIC], d);
    const names = Object.keys(d.metrics.snapshot());
    expect(names).toEqual(names.slice().sort());
    expect(names).toContain("pipeline.routed.audit");
  });
});
