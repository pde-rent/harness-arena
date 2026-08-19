import { describe, expect, test } from "bun:test";
import {
  abs,
  add,
  compareMoney,
  currencyExponent,
  formatMoney,
  money,
  mul,
  negate,
  parseMoney,
  sub,
  sum,
  zero,
} from "../src/money";
import { LedgerError } from "../src/types";

describe("money construction", () => {
  test("uppercases the currency code", () => {
    expect(money(100, "usd")).toEqual({ amount: 100, currency: "USD" });
  });

  test("rejects fractional minor units", () => {
    expect(() => money(1.5, "USD")).toThrow(LedgerError);
  });

  test("knows currency exponents", () => {
    expect(currencyExponent("USD")).toBe(2);
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("KWD")).toBe(3);
    expect(currencyExponent("XYZ")).toBe(2);
  });
});

describe("arithmetic", () => {
  test("adds and subtracts within a currency", () => {
    expect(add(money(250, "USD"), money(125, "USD")).amount).toBe(375);
    expect(sub(money(250, "USD"), money(300, "USD")).amount).toBe(-50);
  });

  test("rejects mixed currencies", () => {
    expect(() => add(money(1, "USD"), money(1, "EUR"))).toThrow(/currency mismatch/);
  });

  test("multiplies with half-even rounding", () => {
    expect(mul(money(100, "USD"), 0.125).amount).toBe(12);
    expect(mul(money(100, "USD"), 0.175).amount).toBe(18);
    expect(mul(money(-100, "USD"), 0.125).amount).toBe(-12);
  });

  test("negate, abs, sum and compare", () => {
    expect(negate(money(5, "USD")).amount).toBe(-5);
    expect(abs(money(-5, "USD")).amount).toBe(5);
    expect(sum([money(1, "USD"), money(2, "USD")], "USD").amount).toBe(3);
    expect(sum([], "USD")).toEqual(zero("USD"));
    expect(compareMoney(money(1, "USD"), money(2, "USD"))).toBe(-1);
    expect(compareMoney(money(2, "USD"), money(2, "USD"))).toBe(0);
  });
});

describe("formatting", () => {
  test("formats with grouping and the currency exponent", () => {
    expect(formatMoney(money(123_456, "USD"))).toBe("1,234.56 USD");
    expect(formatMoney(money(-5, "USD"))).toBe("-0.05 USD");
    expect(formatMoney(money(1234, "JPY"))).toBe("1,234 JPY");
    expect(formatMoney(money(123_456, "USD"), { withCurrency: false })).toBe("1,234.56");
  });

  test("round-trips through parseMoney", () => {
    expect(parseMoney("1,234.56", "USD").amount).toBe(123_456);
    expect(parseMoney("-0.05", "USD").amount).toBe(-5);
    expect(parseMoney("1234", "JPY").amount).toBe(1234);
    expect(() => parseMoney("abc", "USD")).toThrow(LedgerError);
  });
});
