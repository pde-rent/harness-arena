import { describe, expect, test } from "bun:test";
import { ManualClock } from "../src/clock";
import { Scheduler } from "../src/scheduler";
import {
  SNAPSHOT_VERSION,
  SnapshotFormatError,
  fromJson,
  isSnapshot,
  parseSnapshot,
  toJson,
} from "../src/serialize";
import type { QueueOptions, TaskHandler } from "../src/types";

const ok: TaskHandler = (ctx) => ({ ok: true, value: `${ctx.task.id}:${ctx.now}` });
const fail: TaskHandler = () => ({ ok: false, error: "nope" });

function options(clock: ManualClock): QueueOptions {
  return {
    clock,
    seed: 17,
    handlers: { ok, fail },
    defaultMaxAttempts: 2,
    backoff: { baseDelayMs: 50, factor: 3, maxDelayMs: 5000, jitter: true },
  };
}

function seeded(clock: ManualClock): Scheduler {
  const scheduler = new Scheduler(options(clock));
  scheduler.enqueueAll([
    { id: "a", handler: "ok", priority: 5, payload: { n: 1 } },
    { id: "b", handler: "ok", deps: ["a"], priority: 1 },
    { id: "c", handler: "fail", priority: 9 },
    { id: "d", handler: "ok", deps: ["b"], availableAt: 40 },
  ]);
  return scheduler;
}

describe("serialize", () => {
  test("snapshot is JSON-safe and round-trips through text", () => {
    const scheduler = seeded(new ManualClock(0));
    scheduler.tick();
    const snapshot = scheduler.snapshot();
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(JSON.parse(toJson(snapshot))).toEqual(snapshot);
    expect(fromJson(toJson(snapshot))).toEqual(snapshot);
    expect(isSnapshot(snapshot)).toBe(true);
  });

  test("restored scheduler continues identically", () => {
    const liveClock = new ManualClock(0);
    const live = seeded(liveClock);
    live.tick();
    live.tick();

    const text = toJson(live.snapshot());
    const restored = Scheduler.fromSnapshot(JSON.parse(text) as unknown, options(new ManualClock(0)));
    expect(restored.snapshot()).toEqual(live.snapshot());

    live.runAll();
    restored.runAll();
    expect(restored.snapshot()).toEqual(live.snapshot());
    expect(restored.tasks()).toEqual(live.tasks());
    expect(restored.counts()).toEqual(live.counts());
  });

  test("graph structure survives the round trip", () => {
    const scheduler = seeded(new ManualClock(0));
    const restored = Scheduler.fromSnapshot(scheduler.snapshot(), options(new ManualClock(0)));
    expect(restored.topoOrder()).toEqual(scheduler.topoOrder());
    expect(restored.dependentsOf("a")).toEqual(["b", "d"]);
  });

  test("ready queue is rebuilt from restored state", () => {
    const clock = new ManualClock(0);
    const scheduler = seeded(clock);
    scheduler.tick();
    const restored = Scheduler.fromSnapshot(scheduler.snapshot(), options(new ManualClock(0)));
    expect(restored.readyOrder()).toEqual(scheduler.readyOrder());
    expect(restored.now).toBe(clock.now());
  });

  test("malformed snapshots are rejected", () => {
    expect(() => parseSnapshot(null)).toThrow(SnapshotFormatError);
    expect(() => parseSnapshot({ version: 99 })).toThrow(SnapshotFormatError);
    const base = seeded(new ManualClock(0)).snapshot();
    expect(() => parseSnapshot({ ...base, time: "soon" })).toThrow(SnapshotFormatError);
    expect(() => parseSnapshot({ ...base, tasks: [{ id: "x", state: "weird", deps: [] }] })).toThrow(
      SnapshotFormatError,
    );
    expect(isSnapshot({ version: 1 })).toBe(false);
  });
});
