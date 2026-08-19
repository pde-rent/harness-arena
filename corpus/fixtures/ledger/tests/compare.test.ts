import { describe, expect, test } from "bun:test";
import { byAccountCode, byAmount, byKey, byPostedAt, composeComparators, on, reverse, sorted } from "../src/compare";
import { money } from "../src/money";

interface Row {
  readonly account: string;
  readonly postedAt: string;
  readonly amount: { amount: number; currency: string };
  readonly tag: string;
}

const row = (account: string, postedAt: string, amount: number, tag: string): Row => ({
  account,
  postedAt,
  amount: money(amount, "USD"),
  tag,
});

const rows: Row[] = [
  row("assets:cash", "2024-01-10T00:00:00.000Z", 300, "a"),
  row("assets:bank", "2024-01-05T00:00:00.000Z", 300, "b"),
  row("expenses:rent", "2024-01-10T00:00:00.000Z", 100, "c"),
  row("assets:bank", "2024-01-10T00:00:00.000Z", 300, "d"),
];

describe("single-key comparators", () => {
  test("byPostedAt orders ISO timestamps", () => {
    expect(sorted(rows, byPostedAt).map((r) => r.tag)).toEqual(["b", "a", "c", "d"]);
  });

  test("byAmount reads minor units from Money or numbers", () => {
    expect(sorted(rows, byAmount).map((r) => r.tag)).toEqual(["c", "a", "b", "d"]);
    expect(byAmount({ amount: 5 }, { amount: money(5, "USD") })).toBe(0);
  });

  test("byAccountCode orders segment by segment", () => {
    expect(byAccountCode({ account: "assets:bank" }, { account: "assets:cash" })).toBe(-1);
    expect(byAccountCode({ account: "assets" }, { account: "assets:bank" })).toBe(-1);
    expect(byAccountCode({ account: "assets:bank" }, { account: "assets-x" })).toBe(-1);
    expect(byAccountCode({ account: "assets:bank" }, { account: "assets:bank" })).toBe(0);
  });
});

describe("composeComparators", () => {
  test("falls through to later keys on ties", () => {
    const cmp = composeComparators<Row>(byPostedAt, byAccountCode, byAmount);
    expect(sorted(rows, cmp).map((r) => r.tag)).toEqual(["b", "d", "a", "c"]);
  });

  test("is stable for fully tied rows", () => {
    const tied = [row("assets:cash", "2024-01-01T00:00:00.000Z", 1, "x"), row("assets:cash", "2024-01-01T00:00:00.000Z", 1, "y"), row("assets:cash", "2024-01-01T00:00:00.000Z", 1, "z")];
    const cmp = composeComparators<Row>(byPostedAt, byAccountCode, byAmount);
    expect(sorted(tied, cmp).map((r) => r.tag)).toEqual(["x", "y", "z"]);
    expect(sorted(tied, reverse(cmp)).map((r) => r.tag)).toEqual(["x", "y", "z"]);
  });

  test("with no comparators it preserves input order", () => {
    expect(sorted(rows, composeComparators<Row>()).map((r) => r.tag)).toEqual(["a", "b", "c", "d"]);
  });

  test("reverse flips a comparator without breaking stability", () => {
    expect(sorted(rows, reverse(byAmount)).map((r) => r.tag)).toEqual(["a", "b", "d", "c"]);
  });

  test("on and byKey adapt other shapes", () => {
    const byTag = byKey<Row, "tag">("tag");
    expect(sorted(rows, byTag).map((r) => r.tag)).toEqual(["a", "b", "c", "d"]);
    const byAccountLength = on<Row, number>((r) => r.account.length, (a, b) => a - b);
    expect(sorted(rows, byAccountLength).map((r) => r.tag)).toEqual(["a", "b", "d", "c"]);
  });

  test("does not mutate the input array", () => {
    const input = [...rows];
    sorted(input, byAmount);
    expect(input.map((r) => r.tag)).toEqual(["a", "b", "c", "d"]);
  });
});
