import { describe, expect, test } from "bun:test";
import { DuplicateTaskError, TaskStore, UnknownTaskError } from "../src/store";
import type { Task } from "../src/types";

function make(id: string, seq: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    seq,
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
    ...overrides,
  };
}

describe("TaskStore", () => {
  test("add rejects duplicates and get returns the stored task", () => {
    const store = new TaskStore();
    store.add(make("a", 0));
    expect(() => store.add(make("a", 1))).toThrow(DuplicateTaskError);
    expect(store.get("a")?.id).toBe("a");
    expect(store.get("missing")).toBeUndefined();
    expect(() => store.require("missing")).toThrow(UnknownTaskError);
    expect(store.size).toBe(1);
  });

  test("update produces a new object and leaves the old one untouched", () => {
    const store = new TaskStore();
    const original = store.add(make("a", 0));
    const updated = store.update("a", { state: "done", result: 42 });
    expect(original.state).toBe("pending");
    expect(updated.state).toBe("done");
    expect(updated.result).toBe(42);
    expect(updated).not.toBe(original);
    expect(store.get("a")).toBe(updated);
  });

  test("update cannot change identity fields", () => {
    const store = new TaskStore();
    store.add(make("a", 3));
    const updated = store.update("a", { state: "ready" } as Partial<Task>);
    expect(updated.id).toBe("a");
    expect(updated.seq).toBe(3);
  });

  test("byState and counts reflect current states", () => {
    const store = new TaskStore();
    store.add(make("a", 0));
    store.add(make("b", 1, { state: "done" }));
    store.add(make("c", 2, { state: "done" }));
    expect(store.byState("done").map((t) => t.id)).toEqual(["b", "c"]);
    expect(store.counts()).toEqual({
      pending: 1,
      ready: 0,
      running: 0,
      done: 2,
      failed: 0,
      cancelled: 0,
    });
  });

  test("all is ordered by seq and bulkLoad replaces contents", () => {
    const store = new TaskStore();
    store.add(make("z", 2));
    store.add(make("y", 0));
    expect(store.ids()).toEqual(["y", "z"]);
    store.bulkLoad([make("n", 5), make("m", 1)]);
    expect(store.ids()).toEqual(["m", "n"]);
    expect(store.size).toBe(2);
  });
});
