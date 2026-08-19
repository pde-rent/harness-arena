import { describe, expect, test } from "bun:test";
import { allocate, money } from "../src/money";

const amounts = (values: ReturnType<typeof allocate>) => values.map((v) => v.amount);

describe("allocate (hidden checks)", () => {
  test("distributes the remainder to the largest fractional parts, ties to the lowest index", () => {
    expect(amounts(allocate(money(100, "USD"), [1, 1, 1]))).toEqual([34, 33, 33]);
    expect(amounts(allocate(money(10, "USD"), [1, 1, 1, 1]))).toEqual([3, 3, 2, 2]);
    expect(amounts(allocate(money(5, "USD"), [1, 1]))).toEqual([3, 2]);
    expect(amounts(allocate(money(1, "USD"), [1, 1, 1]))).toEqual([1, 0, 0]);
  });

  test("larger remainders win over index order", () => {
    expect(amounts(allocate(money(101, "USD"), [1, 1, 8]))).toEqual([10, 10, 81]);
    expect(amounts(allocate(money(7, "USD"), [3, 1, 1]))).toEqual([4, 2, 1]);
  });

  test("the parts always sum back to the original amount", () => {
    const cases: Array<[number, number[]]> = [
      [100, [1, 1, 1]],
      [9, [2, 3, 5]],
      [1234, [1, 1, 1, 1, 1, 1, 1]],
      [17, [0, 1, 1]],
      [-100, [1, 1, 1]],
      [0, [1, 2]],
    ];
    for (const [total, ratios] of cases) {
      const parts = amounts(allocate(money(total, "USD"), ratios));
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.length).toBe(ratios.length);
    }
  });

  test("keeps the sign of a negative amount", () => {
    expect(amounts(allocate(money(-100, "USD"), [1, 1, 1]))).toEqual([-34, -33, -33]);
    for (const part of allocate(money(-7, "EUR"), [1, 1, 1])) {
      expect(part.amount).toBeLessThanOrEqual(0);
      expect(part.currency).toBe("EUR");
    }
  });

  test("a zero ratio receives nothing", () => {
    expect(amounts(allocate(money(10, "USD"), [0, 1, 1]))).toEqual([0, 5, 5]);
    expect(amounts(allocate(money(11, "USD"), [0, 1, 1]))).toEqual([0, 6, 5]);
  });

  test("still rejects invalid input", () => {
    expect(() => allocate(money(10, "USD"), [])).toThrow();
    expect(() => allocate(money(10, "USD"), [0, 0])).toThrow();
    expect(() => allocate(money(10, "USD"), [-1, 2])).toThrow();
  });
});
