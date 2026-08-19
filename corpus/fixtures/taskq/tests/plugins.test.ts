import { describe, expect, test } from "bun:test";
import {
  DuplicatePluginError,
  HOOK_NAMES,
  PluginRegistry,
  recordingPlugin,
} from "../src/plugins";
import { Lcg, createRng, sampleFloats } from "../src/rng";
import type { Plugin, Task } from "../src/types";

const task = {
  id: "t1",
  seq: 0,
  priority: 0,
  deps: [],
  handler: null,
  payload: null,
  state: "pending",
  attempts: 0,
  maxAttempts: 1,
  createdAt: 0,
  availableAt: 0,
  startedAt: null,
  finishedAt: null,
  result: null,
  error: null,
} satisfies Task;

describe("PluginRegistry", () => {
  test("hooks fire in registration order by default", () => {
    const log: string[] = [];
    const registry = new PluginRegistry();
    registry.registerAll([
      recordingPlugin("first", log),
      recordingPlugin("second", log),
    ]);
    registry.emit("onEnqueue", { task, at: 0 });
    expect(log).toEqual(["first:onEnqueue:t1", "second:onEnqueue:t1"]);
  });

  test("order field wins over registration order", () => {
    const log: string[] = [];
    const registry = new PluginRegistry();
    registry.register(recordingPlugin("late", log, 10));
    registry.register(recordingPlugin("early", log, -5));
    registry.register(recordingPlugin("mid", log, 0));
    registry.emit("onStart", { task, attempt: 1, at: 0 });
    expect(log).toEqual([
      "early:onStart:t1",
      "mid:onStart:t1",
      "late:onStart:t1",
    ]);
    expect(registry.names()).toEqual(["early", "mid", "late"]);
  });

  test("duplicate names rejected, unregister removes", () => {
    const registry = new PluginRegistry();
    registry.register({ name: "p" });
    expect(() => registry.register({ name: "p" })).toThrow(DuplicatePluginError);
    expect(registry.has("p")).toBe(true);
    expect(registry.unregister("p")).toBe(true);
    expect(registry.unregister("p")).toBe(false);
    expect(registry.size).toBe(0);
  });

  test("throwing plugins are isolated and logged", () => {
    const log: string[] = [];
    const bad: Plugin = {
      name: "bad",
      onComplete: () => {
        throw new Error("boom");
      },
    };
    const registry = new PluginRegistry();
    registry.register(bad);
    registry.register(recordingPlugin("good", log));
    const delivered = registry.emit("onComplete", { task, result: null, at: 0 });
    expect(delivered).toBe(1);
    expect(log).toEqual(["good:onComplete:t1"]);
    expect(registry.errors()).toEqual([
      { plugin: "bad", hook: "onComplete", message: "boom" },
    ]);
    registry.clearErrors();
    expect(registry.errors()).toEqual([]);
  });

  test("listeners reports only plugins implementing a hook", () => {
    const registry = new PluginRegistry();
    registry.register({ name: "a", onFail: () => {} });
    registry.register({ name: "b" });
    expect(registry.listeners("onFail")).toEqual(["a"]);
    expect(registry.listeners("onEnqueue")).toEqual([]);
    expect(HOOK_NAMES).toEqual(["onEnqueue", "onStart", "onComplete", "onFail"]);
  });
});

describe("Lcg", () => {
  test("same seed yields the same stream", () => {
    expect(sampleFloats(new Lcg(42), 5)).toEqual(sampleFloats(createRng(42), 5));
  });

  test("different seeds diverge and floats stay in range", () => {
    const a = sampleFloats(new Lcg(1), 4);
    const b = sampleFloats(new Lcg(2), 4);
    expect(a).not.toEqual(b);
    for (const value of a) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test("state can be captured and replayed", () => {
    const rng = new Lcg(9);
    rng.nextUint32();
    const state = rng.getState();
    const first = sampleFloats(rng, 3);
    const replay = new Lcg(0);
    replay.setState(state);
    expect(sampleFloats(replay, 3)).toEqual(first);
  });

  test("nextInt is bounded and validates its argument", () => {
    const rng = new Lcg(3);
    for (let i = 0; i < 20; i += 1) {
      const value = rng.nextInt(7);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(7);
    }
    expect(() => rng.nextInt(0)).toThrow(RangeError);
  });
});
