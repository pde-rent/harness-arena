import { describe, expect, test } from "bun:test";
import { DuplicateWindow } from "../src/dedupe";

describe("DuplicateWindow", () => {
  test("reports repeats and evicts oldest first", () => {
    const w = new DuplicateWindow(2);
    expect(w.record("a")).toBe(false);
    expect(w.record("b")).toBe(false);
    expect(w.record("a")).toBe(true);
    expect(w.size).toBe(2);
    expect(w.record("c")).toBe(false);
    expect(w.has("a")).toBe(false);
    expect(w.has("b")).toBe(true);
    expect(w.has("c")).toBe(true);
  });

  test("capacity zero disables the window", () => {
    const w = new DuplicateWindow(0);
    expect(w.record("a")).toBe(false);
    expect(w.record("a")).toBe(false);
    expect(w.size).toBe(0);
  });

  test("clear forgets everything", () => {
    const w = new DuplicateWindow(4);
    w.record("a");
    w.clear();
    expect(w.size).toBe(0);
    expect(w.record("a")).toBe(false);
  });
});
