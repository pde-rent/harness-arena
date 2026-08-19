import { describe, expect, test } from "bun:test";
import { csvField } from "../src/csv";
import { formatMoney, money } from "../src/money";

describe("money formatting (hidden checks)", () => {
  test("amounts below one major unit keep a leading zero", () => {
    expect(formatMoney(money(5, "USD"))).toBe("0.05 USD");
    expect(formatMoney(money(50, "USD"))).toBe("0.50 USD");
    expect(formatMoney(money(0, "USD"))).toBe("0.00 USD");
    expect(formatMoney(money(-5, "USD"))).toBe("-0.05 USD");
    expect(formatMoney(money(9, "EUR"), { withCurrency: false })).toBe("0.09");
  });

  test("works for every currency exponent", () => {
    expect(formatMoney(money(5, "BHD"))).toBe("0.005 BHD");
    expect(formatMoney(money(0, "BHD"))).toBe("0.000 BHD");
    expect(formatMoney(money(7, "JPY"))).toBe("7 JPY");
    expect(formatMoney(money(0, "JPY"))).toBe("0 JPY");
  });

  test("larger amounts and grouping are unaffected", () => {
    expect(formatMoney(money(123_456, "USD"))).toBe("1,234.56 USD");
    expect(formatMoney(money(-123, "USD"))).toBe("-1.23 USD");
    expect(formatMoney(money(1234, "JPY"))).toBe("1,234 JPY");
    expect(formatMoney(money(100, "USD"))).toBe("1.00 USD");
    expect(formatMoney(money(1_000_000, "USD"), { withCurrency: false })).toBe("10,000.00");
    expect(formatMoney(money(123_456, "USD"), { groupSeparator: "" })).toBe("1234.56 USD");
  });

  test("the csv export inherits the fix", () => {
    expect(csvField(money(5, "USD"))).toBe("0.05");
    expect(csvField(money(-5, "USD"))).toBe("-0.05");
    expect(csvField(money(123_456, "USD"))).toBe("1234.56");
  });
});
