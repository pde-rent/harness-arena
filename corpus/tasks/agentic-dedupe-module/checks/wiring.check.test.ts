import { describe, expect, test } from "bun:test";
import { SteppingClock, createSleepRecorder } from "../src/clock";
import { CollectingLogger } from "../src/log";
import { MetricsSink } from "../src/metrics";
import { MemoryStore } from "../src/store";
import { DuplicateWindow } from "../src/dedupe";
import { runPipeline, runPipelineBatch } from "../src/pipeline";
import type { PipelineDeps } from "../src/pipeline";

const AUDIT = 'audit|EV-1|1700000001|svc.auth\n{"actor":"u1","action":"login"}';
const AUDIT2 = 'audit|EV-2|1700000001|svc.auth\n{"actor":"u2","action":"login"}';
const METRIC = 'metric|M-1|1700000002|svc.stats\n{"name":"cpu.load","value":3}';
const BAD_VALIDATION = 'audit|EV-9|1|svc.auth\n{"actor":"u"}';

type Deps = PipelineDeps & {
  store: MemoryStore;
  metrics: MetricsSink;
  logger: CollectingLogger;
};

function deps(dedupe?: DuplicateWindow): Deps {
  const d: Deps = {
    logger: new CollectingLogger(),
    metrics: new MetricsSink(),
    clock: new SteppingClock({ start: 1_700_000_000_000, step: 1 }),
    sleep: createSleepRecorder().sleep,
    store: new MemoryStore(),
  };
  if (dedupe) (d as PipelineDeps).dedupe = dedupe;
  return d;
}

describe("pipeline duplicate suppression", () => {
  test("without a window supplied nothing is suppressed", async () => {
    const d = deps();
    const first = await runPipeline(AUDIT, d);
    const second = await runPipeline(AUDIT, d);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.stage).toBe("done");
    expect(second.output?.detail.stage).toBe("amend");
    expect(d.metrics.read("pipeline.duplicate")).toBe(0);
  });

  test("first occurrence is handled normally", async () => {
    const d = deps(new DuplicateWindow(16));
    const result = await runPipeline(AUDIT, d);
    expect(result.ok).toBe(true);
    expect(result.stage).toBe("done");
    expect(result.output?.handler).toBe("audit");
    expect(d.store.get("audit", "EV-1")?.actor).toBe("u1");
    expect(d.metrics.read("pipeline.duplicate")).toBe(0);
    expect(d.metrics.read("pipeline.accepted")).toBe(1);
  });

  test("a repeat is suppressed with the specified result", async () => {
    const d = deps(new DuplicateWindow(16));
    await runPipeline(AUDIT, d);
    const before = d.metrics.read("handler.audit.invocations");
    const journal = d.store.keys("audit.journal").slice();
    const result = await runPipeline(AUDIT, d);
    expect(result.ok).toBe(false);
    expect(result.stage).toBe("duplicate");
    expect(result.kind).toBe("audit");
    expect(result.id).toBe("EV-1");
    expect(result.error).toBe("duplicate:EV-1");
    expect(result.output).toBeUndefined();
    expect(Array.isArray(result.issues)).toBe(true);
    // no handler ran, so nothing new was written
    expect(d.metrics.read("handler.audit.invocations")).toBe(before);
    expect(d.store.keys("audit.journal")).toEqual(journal);
    expect(d.metrics.read("pipeline.duplicate")).toBe(1);
    expect(d.metrics.read("pipeline.accepted")).toBe(1);
    expect(d.metrics.read("pipeline.declined")).toBe(0);
  });

  test("distinct ids are unaffected", async () => {
    const d = deps(new DuplicateWindow(16));
    const a = await runPipeline(AUDIT, d);
    const b = await runPipeline(AUDIT2, d);
    const c = await runPipeline(METRIC, d);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(d.metrics.read("pipeline.duplicate")).toBe(0);
    expect(d.store.get("audit", "EV-2")?.actor).toBe("u2");
  });

  test("eviction lets an old id through again", async () => {
    const d = deps(new DuplicateWindow(1));
    await runPipeline(AUDIT, d);
    await runPipeline(AUDIT2, d);
    const again = await runPipeline(AUDIT, d);
    expect(again.ok).toBe(true);
    expect(again.stage).toBe("done");
    expect(d.metrics.read("pipeline.duplicate")).toBe(0);
  });

  test("a disabled window suppresses nothing", async () => {
    const d = deps(new DuplicateWindow(0));
    const second = await runPipeline(AUDIT, d);
    expect(second.ok).toBe(true);
    const third = await runPipeline(AUDIT, d);
    expect(third.ok).toBe(true);
    expect(third.stage).toBe("done");
    expect(d.metrics.read("pipeline.duplicate")).toBe(0);
  });

  test("rejected events never enter the window", async () => {
    const w = new DuplicateWindow(16);
    const d = deps(w);
    const bad = await runPipeline(BAD_VALIDATION, d);
    expect(bad.stage).toBe("validate");
    const parseFail = await runPipeline("not-an-event", d);
    expect(parseFail.stage).toBe("parse");
    expect(w.size).toBe(0);
    expect(d.metrics.read("pipeline.duplicate")).toBe(0);
  });

  test("the window is shared across a batch", async () => {
    const d = deps(new DuplicateWindow(16));
    const results = await runPipelineBatch([AUDIT, AUDIT2, AUDIT, METRIC, METRIC], d);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.stage)).toEqual([
      "done",
      "done",
      "duplicate",
      "done",
      "duplicate",
    ]);
    expect(results[2]?.error).toBe("duplicate:EV-1");
    expect(results[4]?.error).toBe("duplicate:M-1");
    expect(d.metrics.read("pipeline.duplicate")).toBe(2);
    expect(d.metrics.read("pipeline.received")).toBe(5);
    // the metric handler only aggregated the first sample
    expect(d.store.get("metric", "svc.stats/cpu.load")?.count).toBe(1);
  });

  test("a window supplied to a batch stays usable afterwards", async () => {
    const w = new DuplicateWindow(16);
    const d = deps(w);
    await runPipelineBatch([AUDIT, AUDIT2], d);
    expect(w.size).toBe(2);
    expect(w.has("EV-1")).toBe(true);
    const after = await runPipeline(AUDIT, d);
    expect(after.stage).toBe("duplicate");
  });
});
