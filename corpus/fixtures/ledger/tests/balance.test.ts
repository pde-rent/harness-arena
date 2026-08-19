import { describe, expect, test } from "bun:test";
import {
  balanceOf,
  balances,
  entryCount,
  isJournalBalanced,
  normalBalance,
  rollup,
  rollupTree,
  runningBalance,
} from "../src/balance";
import { makeJournal } from "./fixtures";

describe("balances", () => {
  const journal = makeJournal();

  test("nets debits against credits per account", () => {
    const cash = balanceOf(journal, "assets:cash");
    expect(cash).toEqual({
      account: "assets:cash",
      currency: "USD",
      debit: 100_000,
      credit: 15_000,
      balance: 85_000,
    });
  });

  test("returns a zero balance for untouched accounts", () => {
    expect(balanceOf(journal, "assets:vault").balance).toBe(0);
  });

  test("lists every touched account sorted by code", () => {
    expect(balances(journal).map((balance) => balance.account)).toEqual([
      "assets:bank",
      "assets:cash",
      "equity:opening",
      "expenses:rent",
      "income:sales",
    ]);
  });

  test("the journal is balanced overall", () => {
    expect(isJournalBalanced(journal)).toBe(true);
  });
});

describe("rollups", () => {
  const journal = makeJournal();

  test("sums a subtree by prefix", () => {
    expect(rollup(journal, "assets").balance).toBe(110_000);
    expect(rollup(journal, "income").balance).toBe(-25_000);
    expect(rollup(journal, "").balance).toBe(0);
  });

  test("builds every parent node once", () => {
    const tree = rollupTree(journal);
    const byCode = new Map(tree.map((node) => [node.account, node.balance]));
    expect(byCode.get("assets")).toBe(110_000);
    expect(byCode.get("assets:cash")).toBe(85_000);
    expect(byCode.get("expenses")).toBe(15_000);
    expect(tree.filter((node) => node.account === "assets")).toHaveLength(1);
  });

  test("normalises the sign by account type", () => {
    expect(normalBalance(rollup(journal, "income"), "income")).toBe(25_000);
    expect(normalBalance(rollup(journal, "assets"), "asset")).toBe(110_000);
    expect(normalBalance(balanceOf(journal, "equity:opening"))).toBe(100_000);
  });
});

describe("per-account history", () => {
  const journal = makeJournal();

  test("counts entries touching an account", () => {
    expect(entryCount(journal, "assets:cash")).toBe(2);
    expect(entryCount(journal, "income:sales")).toBe(1);
  });

  test("accumulates a running balance in posting order", () => {
    expect(runningBalance(journal, "assets:cash")).toEqual([100_000, 85_000]);
  });
});
