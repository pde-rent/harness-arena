import { describe, expect, test } from "bun:test";
import { ManualClock } from "../src/clock";
import { CycleError } from "../src/graph";
import { recordingPlugin } from "../src/plugins";
import { Scheduler, createScheduler } from "../src/scheduler";
import type { QueueOptions, TaskHandler } from "../src/types";

const ok: TaskHandler = (ctx) => ({ ok: true, value: ctx.task.id });
const fail: TaskHandler = () => ({ ok: false, error: "nope" });
const boom: TaskHandler = () => {
  throw new Error("thrown");
};

function setup(overrides: Partial<QueueOptions> = {}): {
  scheduler: Scheduler;
  clock: ManualClock;
  log: string[];
} {
  const clock = new ManualClock(0);
  const log: string[] = [];
  const scheduler = createScheduler({
    clock,
    seed: 5,
    handlers: { ok, fail, boom },
    plugins: [recordingPlugin("rec", log)],
    ...overrides,
  });
  return { scheduler, clock, log };
}

describe("Scheduler", () => {
  test("runs ready tasks in priority order", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "low", priority: 1, handler: "ok" },
      { id: "high", priority: 9, handler: "ok" },
      { id: "mid", priority: 5, handler: "ok" },
    ]);
    const outcomes = scheduler.runAll();
    expect(outcomes.filter((o) => o.kind === "ran").map((o) => (o as { taskId: string }).taskId))
      .toEqual(["high", "mid", "low"]);
    expect(scheduler.counts().done).toBe(3);
    expect(scheduler.isDrained()).toBe(true);
    expect(scheduler.get("high")?.result).toBe("high");
  });

  test("dependencies gate execution regardless of priority", () => {
    const { scheduler } = setup();
    scheduler.enqueue({ id: "build", priority: 0, handler: "ok" });
    scheduler.enqueue({ id: "deploy", priority: 100, deps: ["build"], handler: "ok" });
    expect(scheduler.readyOrder()).toEqual([]);
    const first = scheduler.tick();
    expect(first.kind).toBe("ran");
    expect((first as { taskId: string }).taskId).toBe("build");
    const second = scheduler.tick();
    expect((second as { taskId: string }).taskId).toBe("deploy");
    expect(scheduler.tick().kind).toBe("idle");
    expect(scheduler.topoOrder()).toEqual(["build", "deploy"]);
  });

  test("cycles are rejected and leave no residue", () => {
    const { scheduler } = setup();
    scheduler.enqueue({ id: "a", handler: "ok" });
    scheduler.enqueue({ id: "b", deps: ["a"], handler: "ok" });
    expect(() => scheduler.enqueue({ id: "c", deps: ["b"], handler: "ok" })).not.toThrow();
    expect(() => scheduler.enqueue({ id: "a2", deps: ["c"], handler: "ok" })).not.toThrow();
    const before = scheduler.size;
    expect(() => scheduler.enqueue({ id: "loop", deps: ["loop"], handler: "ok" })).toThrow(
      CycleError,
    );
    expect(scheduler.size).toBe(before);
    expect(scheduler.get("loop")).toBeUndefined();
  });

  test("failures retry with exponential backoff on the injected clock", () => {
    const attempts: number[] = [];
    const flaky: TaskHandler = (ctx) => {
      attempts.push(ctx.attempt);
      return ctx.attempt < 3 ? { ok: false, error: "flaky" } : { ok: true, value: "recovered" };
    };
    const { scheduler, clock } = setup({
      handlers: { flaky },
      defaultMaxAttempts: 3,
      backoff: { baseDelayMs: 100, factor: 2, maxDelayMs: 10_000, jitter: false },
    });
    scheduler.enqueue({ id: "t", handler: "flaky" });
    scheduler.runAll();
    expect(attempts).toEqual([1, 2, 3]);
    expect(clock.now()).toBe(300);
    const task = scheduler.require("t");
    expect(task.state).toBe("done");
    expect(task.attempts).toBe(3);
    expect(task.result).toBe("recovered");
  });

  test("exhausted retries fail the task and cascade to dependents", () => {
    const { scheduler } = setup();
    scheduler.enqueue({ id: "root", handler: "fail" });
    scheduler.enqueue({ id: "mid", deps: ["root"], handler: "ok" });
    scheduler.enqueue({ id: "leaf", deps: ["mid"], handler: "ok" });
    scheduler.enqueue({ id: "free", handler: "ok" });
    scheduler.runAll();
    expect(scheduler.require("root").state).toBe("failed");
    expect(scheduler.require("mid").state).toBe("failed");
    expect(scheduler.require("leaf").state).toBe("failed");
    expect(scheduler.require("leaf").error).toBe("dependency failed: root");
    expect(scheduler.require("free").state).toBe("done");
    expect(scheduler.dependentsOf("root")).toEqual(["mid", "leaf"]);
  });

  test("thrown handler errors and missing handlers become failures", () => {
    const { scheduler } = setup();
    scheduler.enqueue({ id: "throws", handler: "boom" });
    scheduler.enqueue({ id: "absent", handler: "nowhere" });
    scheduler.runAll();
    expect(scheduler.require("throws").error).toBe("thrown");
    expect(scheduler.require("absent").error).toBe("missing handler: nowhere");
    expect(scheduler.counts().failed).toBe(2);
  });

  test("plugin hooks fire in the documented order", () => {
    const { scheduler, log } = setup({ defaultMaxAttempts: 2 });
    scheduler.enqueue({ id: "good", handler: "ok" });
    scheduler.enqueue({ id: "bad", handler: "fail", maxAttempts: 1 });
    scheduler.runAll();
    expect(log).toEqual([
      "rec:onEnqueue:good",
      "rec:onEnqueue:bad",
      "rec:onStart:good",
      "rec:onComplete:good",
      "rec:onStart:bad",
      "rec:onFail:bad",
    ]);
    expect(scheduler.pluginErrors()).toEqual([]);
    expect(scheduler.pluginNames()).toEqual(["rec"]);
  });

  test("scheduled tasks wait for their availability window", () => {
    const { scheduler, clock } = setup();
    scheduler.enqueue({ id: "later", handler: "ok", availableAt: 500 });
    expect(scheduler.tick().kind).toBe("idle");
    expect(scheduler.require("later").state).toBe("pending");
    clock.advance(499);
    expect(scheduler.tick().kind).toBe("idle");
    clock.advance(1);
    expect(scheduler.tick().kind).toBe("ran");
    expect(scheduler.require("later").state).toBe("done");
    expect(scheduler.require("later").finishedAt).toBe(500);
  });

  test("handlers can draw deterministic randomness", () => {
    const draws: number[] = [];
    const rand: TaskHandler = (ctx) => {
      draws.push(ctx.random());
      return { ok: true };
    };
    const run = (): number[] => {
      draws.length = 0;
      const scheduler = createScheduler({
        clock: new ManualClock(0),
        seed: 11,
        handlers: { rand },
      });
      scheduler.enqueueAll([
        { id: "a", handler: "rand" },
        { id: "b", handler: "rand" },
      ]);
      scheduler.runAll();
      return [...draws];
    };
    expect(run()).toEqual(run());
  });

  test("state queries reflect progress", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "ok" },
      { id: "b", deps: ["a"], handler: "ok" },
    ]);
    expect(scheduler.pendingOrder()).toEqual(["a", "b"]);
    expect(scheduler.isDrained()).toBe(false);
    scheduler.tick();
    expect(scheduler.byState("done").map((t) => t.id)).toEqual(["a"]);
    scheduler.runAll();
    expect(scheduler.counts()).toEqual({
      pending: 0,
      ready: 0,
      running: 0,
      done: 2,
      failed: 0,
      cancelled: 0,
    });
    expect(scheduler.isBlocked()).toBe(true);
  });
});
