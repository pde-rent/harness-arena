import { describe, expect, test } from "bun:test";
import { allocate, money, roundHalfEven } from "../src/money";
import { LedgerError } from "../src/types";

const amounts = (values: readonly { amount: number }[]) => values.map((value) => value.amount);

describe("allocate", () => {
  test("splits without losing minor units", () => {
    const parts = allocate(money(100, "USD"), [1, 1, 1]);
    expect(amounts(parts)).toEqual([34, 33, 33]);
    expect(parts.reduce((acc, part) => acc + part.amount, 0)).toBe(100);
  });

  test("distributes the remainder by largest fractional share", () => {
    expect(amounts(allocate(money(5, "USD"), [3, 7]))).toEqual([2, 3]);
    expect(amounts(allocate(money(101, "USD"), [50, 50]))).toEqual([51, 50]);
  });

  test("breaks remainder ties by position", () => {
    expect(amounts(allocate(money(10, "USD"), [1, 1, 1, 1]))).toEqual([3, 3, 2, 2]);
  });

  test("keeps the sign of a negative amount", () => {
    const parts = allocate(money(-100, "USD"), [1, 1, 1]);
    expect(amounts(parts)).toEqual([-34, -33, -33]);
    expect(parts.reduce((acc, part) => acc + part.amount, 0)).toBe(-100);
  });

  test("handles zero ratios and zero amounts", () => {
    expect(amounts(allocate(money(100, "USD"), [1, 0]))).toEqual([100, 0]);
    expect(amounts(allocate(money(0, "USD"), [1, 2]))).toEqual([0, 0]);
  });

  test("rejects invalid ratios", () => {
    expect(() => allocate(money(100, "USD"), [])).toThrow(LedgerError);
    expect(() => allocate(money(100, "USD"), [0, 0])).toThrow(/greater than zero/);
    expect(() => allocate(money(100, "USD"), [-1, 2])).toThrow(/non-negative/);
  });
});

describe("roundHalfEven", () => {
  test("rounds halves toward the even neighbour", () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(-0.5)).toBe(0);
    expect(roundHalfEven(-1.5)).toBe(-2);
    expect(roundHalfEven(-2.5)).toBe(-2);
  });

  test("rounds non-halves normally", () => {
    expect(roundHalfEven(2.4)).toBe(2);
    expect(roundHalfEven(2.6)).toBe(3);
    expect(roundHalfEven(-2.6)).toBe(-3);
  });

  test("honours the precision argument", () => {
    expect(roundHalfEven(1.125, 2)).toBe(1.12);
    expect(roundHalfEven(1.135, 2)).toBe(1.14);
    expect(roundHalfEven(1.2345, 3)).toBe(1.234);
  });

  test("rejects a bad precision", () => {
    expect(() => roundHalfEven(1, -1)).toThrow(LedgerError);
    expect(() => roundHalfEven(Number.NaN)).toThrow(LedgerError);
  });
});
