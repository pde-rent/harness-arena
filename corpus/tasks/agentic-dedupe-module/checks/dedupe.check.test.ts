import { describe, expect, test } from "bun:test";
import { DuplicateWindow } from "../src/dedupe";

describe("DuplicateWindow unit behaviour", () => {
  test("first record is new, repeat is a duplicate", () => {
    const w = new DuplicateWindow(4);
    expect(w.record("a")).toBe(false);
    expect(w.record("a")).toBe(true);
    expect(w.record("a")).toBe(true);
    expect(w.size).toBe(1);
  });

  test("has does not mutate membership", () => {
    const w = new DuplicateWindow(4);
    expect(w.has("a")).toBe(false);
    expect(w.size).toBe(0);
    w.record("a");
    expect(w.has("a")).toBe(true);
    expect(w.size).toBe(1);
    expect(w.has("b")).toBe(false);
    expect(w.record("b")).toBe(false);
  });

  test("capacity property reflects the constructor argument", () => {
    expect(new DuplicateWindow(5).capacity).toBe(5);
    expect(new DuplicateWindow(0).capacity).toBe(0);
  });

  test("size never exceeds capacity and eviction is oldest-first", () => {
    const w = new DuplicateWindow(3);
    for (const id of ["a", "b", "c", "d", "e"]) w.record(id);
    expect(w.size).toBe(3);
    expect(w.has("a")).toBe(false);
    expect(w.has("b")).toBe(false);
    expect(w.has("c")).toBe(true);
    expect(w.has("d")).toBe(true);
    expect(w.has("e")).toBe(true);
    expect(w.record("a")).toBe(false);
    expect(w.has("c")).toBe(false);
  });

  test("re-recording does not refresh insertion position", () => {
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

  test("capacity one keeps only the latest id", () => {
    const w = new DuplicateWindow(1);
    expect(w.record("a")).toBe(false);
    expect(w.record("a")).toBe(true);
    expect(w.record("b")).toBe(false);
    expect(w.size).toBe(1);
    expect(w.has("a")).toBe(false);
    expect(w.record("a")).toBe(false);
  });

  test("non-positive or non-finite capacity disables the window", () => {
    for (const cap of [0, -1, -10, Number.NaN]) {
      const w = new DuplicateWindow(cap);
      expect(w.record("a")).toBe(false);
      expect(w.record("a")).toBe(false);
      expect(w.has("a")).toBe(false);
      expect(w.size).toBe(0);
    }
  });

  test("a fractional capacity is floored for the bound", () => {
    const w = new DuplicateWindow(2.7);
    w.record("a");
    w.record("b");
    w.record("c");
    expect(w.size).toBe(2);
    expect(w.has("a")).toBe(false);
    expect(w.capacity).toBe(2.7);
  });

  test("clear resets the window", () => {
    const w = new DuplicateWindow(3);
    w.record("a");
    w.record("b");
    w.clear();
    expect(w.size).toBe(0);
    expect(w.has("a")).toBe(false);
    expect(w.record("a")).toBe(false);
    expect(w.size).toBe(1);
  });

  test("distinct ids are independent", () => {
    const w = new DuplicateWindow(100);
    for (let i = 0; i < 50; i += 1) {
      expect(w.record(`id-${i}`)).toBe(false);
    }
    expect(w.size).toBe(50);
    for (let i = 0; i < 50; i += 1) {
      expect(w.record(`id-${i}`)).toBe(true);
    }
    expect(w.size).toBe(50);
  });
});
