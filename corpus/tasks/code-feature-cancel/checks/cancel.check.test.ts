import { describe, expect, test } from "bun:test";
import { ManualClock } from "../src/clock";
import { recordingPlugin } from "../src/plugins";
import { Scheduler, createScheduler } from "../src/scheduler";
import type { QueueOptions, TaskHandler, TickOutcome } from "../src/types";

const ok: TaskHandler = (ctx) => ({ ok: true, value: ctx.task.id });
const fail: TaskHandler = () => ({ ok: false, error: "nope" });

function setup(overrides: Partial<QueueOptions> = {}): {
  scheduler: Scheduler;
  clock: ManualClock;
  log: string[];
  ran: string[];
} {
  const clock = new ManualClock(0);
  const log: string[] = [];
  const ran: string[] = [];
  const scheduler = createScheduler({
    clock,
    seed: 5,
    handlers: {
      ok,
      fail,
      spy: (ctx) => {
        ran.push(ctx.task.id);
        return { ok: true, value: ctx.task.id };
      },
    },
    plugins: [recordingPlugin("rec", log)],
    ...overrides,
  });
  return { scheduler, clock, log, ran };
}

function ranIds(outcomes: TickOutcome[]): string[] {
  return outcomes
    .filter((o) => o.kind === "ran")
    .map((o) => (o as { taskId: string }).taskId);
}

describe("cancel: API shape", () => {
  test("cancel is a method on Scheduler taking an id", () => {
    const { scheduler } = setup();
    expect(typeof (scheduler as unknown as { cancel: unknown }).cancel).toBe("function");
    expect(Scheduler.prototype.cancel.length).toBe(1);
  });

  test("cancelling a pending task returns true and sets the state", () => {
    const { scheduler } = setup();
    scheduler.enqueue({ id: "a", handler: "spy", deps: ["missing"] });
    expect(scheduler.require("a").state).toBe("pending");
    expect(scheduler.cancel("a")).toBe(true);
    expect(scheduler.require("a").state).toBe("cancelled");
  });

  test("cancelling a ready task returns true and drops it from the ready queue", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy" },
      { id: "b", handler: "spy" },
    ]);
    scheduler.tick(); // promotes both, runs one
    const stillReady = scheduler.readyOrder();
    expect(stillReady.length).toBe(1);
    const target = stillReady[0]!;
    expect(scheduler.require(target).state).toBe("ready");
    expect(scheduler.cancel(target)).toBe(true);
    expect(scheduler.require(target).state).toBe("cancelled");
    expect(scheduler.readyOrder()).not.toContain(target);
  });

  test("finishedAt is stamped with the current clock time", () => {
    const { scheduler, clock } = setup();
    scheduler.enqueue({ id: "a", handler: "spy", deps: ["missing"] });
    clock.advance(750);
    expect(scheduler.cancel("a")).toBe(true);
    expect(scheduler.require("a").finishedAt).toBe(750);
  });

  test("cancellation never writes to error", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy", deps: ["missing"] },
      { id: "b", handler: "spy", deps: ["a"] },
    ]);
    scheduler.cancel("a");
    expect(scheduler.require("a").error).toBe(null);
    expect(scheduler.require("b").error).toBe(null);
  });
});

describe("cancel: no-op cases", () => {
  test("unknown id returns false and does not throw", () => {
    const { scheduler } = setup();
    scheduler.enqueue({ id: "a", handler: "spy", deps: ["missing"] });
    expect(scheduler.cancel("nope")).toBe(false);
    expect(scheduler.counts()).toEqual({
      pending: 1,
      ready: 0,
      running: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    });
  });

  test("a done task is a no-op and its dependents are untouched", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy" },
      { id: "b", handler: "spy", deps: ["a"] },
    ]);
    scheduler.tick();
    expect(scheduler.require("a").state).toBe("done");
    expect(scheduler.cancel("a")).toBe(false);
    expect(scheduler.require("a").state).toBe("done");
    expect(scheduler.require("b").state).not.toBe("cancelled");
    scheduler.runAll();
    expect(scheduler.require("b").state).toBe("done");
  });

  test("a failed task is a no-op", () => {
    const { scheduler } = setup({ failDependentsOnFailure: false });
    scheduler.enqueue({ id: "a", handler: "fail" });
    scheduler.runAll();
    expect(scheduler.require("a").state).toBe("failed");
    expect(scheduler.cancel("a")).toBe(false);
    expect(scheduler.require("a").state).toBe("failed");
    expect(scheduler.counts().cancelled).toBe(0);
  });

  test("cancelling twice returns false the second time and changes nothing", () => {
    const { scheduler, clock } = setup();
    scheduler.enqueue({ id: "a", handler: "spy", deps: ["missing"] });
    expect(scheduler.cancel("a")).toBe(true);
    const before = scheduler.require("a");
    clock.advance(100);
    expect(scheduler.cancel("a")).toBe(false);
    expect(scheduler.require("a")).toEqual(before);
  });

  test("a running task cannot be cancelled from inside its own handler", () => {
    const clock = new ManualClock(0);
    const seen: boolean[] = [];
    const scheduler = createScheduler({
      clock,
      handlers: {
        selfCancel: (ctx) => {
          expect(ctx.task.state).toBe("running");
          seen.push(scheduler.cancel(ctx.task.id));
          return { ok: true, value: 1 };
        },
        ok,
      },
    });
    scheduler.enqueueAll([
      { id: "a", handler: "selfCancel" },
      { id: "b", handler: "ok", deps: ["a"] },
    ]);
    scheduler.runAll();
    expect(seen).toEqual([false]);
    expect(scheduler.require("a").state).toBe("done");
    expect(scheduler.require("b").state).toBe("done");
    expect(scheduler.counts().cancelled).toBe(0);
  });
});

describe("cancel: cascade", () => {
  test("transitive dependents are cancelled, not failed", () => {
    const { scheduler, ran } = setup();
    scheduler.enqueueAll([
      { id: "root", handler: "spy" },
      { id: "mid", handler: "spy", deps: ["root"] },
      { id: "leaf", handler: "spy", deps: ["mid"] },
      { id: "far", handler: "spy", deps: ["leaf"] },
      { id: "other", handler: "spy" },
    ]);
    expect(scheduler.cancel("root")).toBe(true);
    for (const id of ["root", "mid", "leaf", "far"]) {
      expect(scheduler.require(id).state).toBe("cancelled");
    }
    expect(scheduler.byState("failed")).toEqual([]);
    expect(scheduler.counts().failed).toBe(0);
    expect(scheduler.counts().cancelled).toBe(4);
    scheduler.runAll();
    expect(ran).toEqual(["other"]);
    expect(scheduler.counts()).toEqual({
      pending: 0,
      ready: 0,
      running: 0,
      done: 1,
      failed: 0,
      cancelled: 4,
    });
  });

  test("cascade still cancels when running through the failure-cascade path is disabled", () => {
    const { scheduler } = setup({ failDependentsOnFailure: false });
    scheduler.enqueueAll([
      { id: "root", handler: "spy" },
      { id: "mid", handler: "spy", deps: ["root"] },
      { id: "leaf", handler: "spy", deps: ["mid"] },
    ]);
    expect(scheduler.cancel("root")).toBe(true);
    expect(scheduler.counts().cancelled).toBe(3);
    scheduler.runAll();
    expect(scheduler.counts().cancelled).toBe(3);
    expect(scheduler.counts().failed).toBe(0);
  });

  test("terminal dependents keep their state", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy" },
      { id: "b", handler: "spy", deps: ["a"] },
      { id: "c", handler: "spy", deps: ["a"] },
    ]);
    scheduler.tick(); // a
    scheduler.tick(); // b or c
    const done = scheduler.byState("done").map((t) => t.id);
    expect(done.length).toBe(2);
    const survivor = ["b", "c"].find((id) => !done.includes(id))!;
    // survivor is still ready/pending; a is done so cancelling a is a no-op.
    expect(scheduler.cancel("a")).toBe(false);
    expect(scheduler.require(survivor).state).not.toBe("cancelled");
  });

  test("a diamond cancels every downstream node exactly once", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "top", handler: "spy" },
      { id: "l", handler: "spy", deps: ["top"] },
      { id: "r", handler: "spy", deps: ["top"] },
      { id: "bottom", handler: "spy", deps: ["l", "r"] },
    ]);
    expect(scheduler.cancel("l")).toBe(true);
    expect(scheduler.require("l").state).toBe("cancelled");
    expect(scheduler.require("bottom").state).toBe("cancelled");
    expect(scheduler.require("top").state).toBe("pending");
    expect(scheduler.require("r").state).toBe("pending");
    scheduler.runAll();
    expect(scheduler.require("top").state).toBe("done");
    expect(scheduler.require("r").state).toBe("done");
    expect(scheduler.counts().cancelled).toBe(2);
    expect(scheduler.counts().failed).toBe(0);
  });

  test("cancelling an upstream dependency does not fail the dependents later", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy" },
      { id: "b", handler: "spy", deps: ["a"] },
    ]);
    scheduler.cancel("a");
    scheduler.runAll();
    expect(scheduler.require("b").state).toBe("cancelled");
    expect(scheduler.require("b").error).toBe(null);
  });
});

describe("cancel: post-conditions", () => {
  test("a cancelled task never runs, never retries and never leaves the queue blocked", () => {
    const { scheduler, ran } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy", maxAttempts: 5 },
      { id: "b", handler: "spy" },
    ]);
    expect(scheduler.cancel("a")).toBe(true);
    const outcomes = scheduler.runAll();
    expect(ran).toEqual(["b"]);
    expect(ranIds(outcomes)).toEqual(["b"]);
    expect(scheduler.require("a").attempts).toBe(0);
    expect(scheduler.require("a").startedAt).toBe(null);
    expect(scheduler.isDrained()).toBe(true);
  });

  test("a delayed task that is cancelled does not hold up runAll", () => {
    const { scheduler, clock, ran } = setup();
    scheduler.enqueueAll([
      { id: "later", handler: "spy", availableAt: 10_000 },
      { id: "now", handler: "spy" },
    ]);
    expect(scheduler.cancel("later")).toBe(true);
    scheduler.runAll();
    expect(ran).toEqual(["now"]);
    expect(clock.now()).toBe(0);
    expect(scheduler.isDrained()).toBe(true);
  });

  test("cancelled tasks are excluded from readyOrder and pendingOrder but kept in tasks()", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy" },
      { id: "b", handler: "spy", deps: ["a"] },
    ]);
    expect(scheduler.pendingOrder()).toContain("b");
    expect(scheduler.cancel("b")).toBe(true);
    expect(scheduler.pendingOrder()).not.toContain("b");
    expect(scheduler.readyOrder()).not.toContain("b");
    expect(scheduler.byState("cancelled").map((t) => t.id)).toEqual(["b"]);
    expect(scheduler.tasks().map((t) => t.id)).toEqual(["a", "b"]);
    expect(scheduler.get("b")!.state).toBe("cancelled");
    expect(scheduler.require("b").state).toBe("cancelled");
    scheduler.runAll();
    expect(scheduler.require("a").state).toBe("done");
    expect(scheduler.require("b").state).toBe("cancelled");
    expect(scheduler.readyOrder()).toEqual([]);
  });

  test("isDrained becomes true once the only survivor is cancelled", () => {
    const { scheduler } = setup();
    scheduler.enqueue({ id: "a", handler: "spy", deps: ["ghost"] });
    expect(scheduler.isDrained()).toBe(false);
    expect(scheduler.cancel("a")).toBe(true);
    expect(scheduler.isDrained()).toBe(true);
    expect(scheduler.runAll().every((o) => o.kind === "idle")).toBe(true);
  });
});

describe("cancel: plugins", () => {
  test("cancellation fires no hooks at all", () => {
    const { scheduler, log } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy" },
      { id: "b", handler: "spy", deps: ["a"] },
    ]);
    log.length = 0;
    expect(scheduler.cancel("a")).toBe(true);
    expect(log).toEqual([]);
    scheduler.runAll();
    expect(log).toEqual([]);
    expect(scheduler.pluginErrors()).toEqual([]);
  });

  test("no-op cancellations fire no hooks either", () => {
    const { scheduler, log } = setup();
    scheduler.enqueue({ id: "a", handler: "spy" });
    scheduler.runAll();
    log.length = 0;
    expect(scheduler.cancel("a")).toBe(false);
    expect(scheduler.cancel("ghost")).toBe(false);
    expect(log).toEqual([]);
  });
});

describe("cancel: snapshot round-trip", () => {
  test("cancelled tasks survive snapshot and restore", () => {
    const { scheduler, clock } = setup();
    scheduler.enqueueAll([
      { id: "root", handler: "spy" },
      { id: "mid", handler: "spy", deps: ["root"] },
      { id: "solo", handler: "spy" },
    ]);
    scheduler.cancel("root");
    const before = scheduler.counts();
    const drainedBefore = scheduler.isDrained();
    const snap = JSON.parse(JSON.stringify(scheduler.snapshot())) as unknown;

    const clock2 = new ManualClock(clock.now());
    const restored = Scheduler.fromSnapshot(snap, {
      clock: clock2,
      handlers: { spy: ok, ok },
    });
    expect(restored.require("root").state).toBe("cancelled");
    expect(restored.require("mid").state).toBe("cancelled");
    expect(restored.counts()).toEqual(before);
    expect(restored.isDrained()).toBe(drainedBefore);
    expect(restored.readyOrder()).not.toContain("root");
    expect(restored.readyOrder()).not.toContain("mid");
    restored.runAll();
    expect(restored.require("root").state).toBe("cancelled");
    expect(restored.require("mid").state).toBe("cancelled");
    expect(restored.require("solo").state).toBe("done");
    expect(restored.counts().failed).toBe(0);
  });

  test("restore into an existing scheduler keeps cancelled tasks cancelled", () => {
    const { scheduler } = setup();
    scheduler.enqueueAll([
      { id: "a", handler: "spy" },
      { id: "b", handler: "spy", deps: ["a"] },
    ]);
    scheduler.cancel("a");
    const snap = scheduler.snapshot();
    const other = setup().scheduler;
    other.restore(JSON.parse(JSON.stringify(snap)) as unknown);
    expect(other.counts().cancelled).toBe(2);
    expect(other.byState("cancelled").map((t) => t.id)).toEqual(["a", "b"]);
    expect(other.isDrained()).toBe(true);
  });
});
