import { describe, expect, test } from "bun:test";
import { ReadyQueue, compareEntries, sortByPriority, type ReadyEntry } from "../src/priority";
import type { Task } from "../src/types";

function entry(id: string, priority: number, seq: number): ReadyEntry {
  return { id, priority, seq };
}

function task(id: string, priority: number, seq: number): Task {
  return {
    id,
    seq,
    priority,
    deps: [],
    handler: null,
    payload: null,
    state: "ready",
    attempts: 0,
    maxAttempts: 1,
    createdAt: 0,
    availableAt: 0,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  };
}

describe("priority", () => {
  test("higher priority sorts first, ties break by seq", () => {
    expect(compareEntries(entry("a", 5, 1), entry("b", 1, 0))).toBeLessThan(0);
    expect(compareEntries(entry("a", 1, 3), entry("b", 1, 2))).toBeGreaterThan(0);
    expect(compareEntries(entry("a", 1, 1), entry("a", 1, 1))).toBe(0);
  });

  test("sortByPriority orders tasks", () => {
    const sorted = sortByPriority([task("a", 0, 0), task("b", 9, 5), task("c", 9, 1)]);
    expect(sorted.map((t) => t.id)).toEqual(["c", "b", "a"]);
  });

  test("heap pops in priority order", () => {
    const queue = new ReadyQueue();
    for (const e of [
      entry("low", -5, 0),
      entry("high", 10, 1),
      entry("mid", 0, 2),
      entry("high2", 10, 3),
    ]) {
      queue.push(e);
    }
    expect(queue.size).toBe(4);
    expect(queue.peek()?.id).toBe("high");
    expect(queue.drain().map((e) => e.id)).toEqual(["high", "high2", "mid", "low"]);
    expect(queue.size).toBe(0);
    expect(queue.pop()).toBeNull();
  });

  test("duplicate ids are rejected and removal works", () => {
    const queue = new ReadyQueue();
    expect(queue.push(entry("a", 1, 0))).toBe(true);
    expect(queue.push(entry("a", 9, 1))).toBe(false);
    queue.push(entry("b", 2, 1));
    queue.push(entry("c", 3, 2));
    expect(queue.remove("b")).toBe(true);
    expect(queue.remove("b")).toBe(false);
    expect(queue.toSortedArray().map((e) => e.id)).toEqual(["c", "a"]);
  });

  test("heap survives randomised insertion order", () => {
    const queue = new ReadyQueue();
    const ids: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const priority = (i * 37) % 11;
      queue.push(entry(`t${i}`, priority, i));
      ids.push(`t${i}`);
    }
    const drained = queue.drain();
    expect(drained.length).toBe(ids.length);
    for (let i = 1; i < drained.length; i += 1) {
      expect(compareEntries(drained[i - 1]!, drained[i]!)).toBeLessThan(0);
    }
  });
});
