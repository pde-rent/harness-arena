import { describe, expect, test } from "bun:test";
import { AccountRegistry, parentCode, ancestorCodes, isUnder } from "../src/accounts";
import { FIXED_TIMESTAMP, createTransaction, isBalanced, validateEntries } from "../src/entries";
import { Journal } from "../src/journal";
import { LedgerError, type Entry } from "../src/types";
import { usd } from "./fixtures";

const entry = (account: string, direction: "debit" | "credit", amount: number, id: string): Entry => ({
  id,
  account,
  direction,
  amount: usd(amount),
});

describe("account codes", () => {
  test("walks the hierarchy", () => {
    expect(parentCode("assets:cash:petty")).toBe("assets:cash");
    expect(parentCode("assets")).toBeUndefined();
    expect(ancestorCodes("assets:cash:petty")).toEqual(["assets:cash", "assets"]);
    expect(isUnder("assets:cash", "assets")).toBe(true);
    expect(isUnder("assetsx:cash", "assets")).toBe(false);
  });

  test("registry resolves parents and children", () => {
    const registry = new AccountRegistry("USD");
    registry.registerAll([{ code: "assets" }, { code: "assets:cash" }, { code: "assets:cash:petty" }]);
    expect(registry.parentOf("assets:cash:petty")?.code).toBe("assets:cash");
    expect(registry.childrenOf("assets").map((account) => account.code)).toEqual(["assets:cash"]);
    expect(registry.require("assets:cash").type).toBe("asset");
    expect(() => registry.require("nope:here")).toThrow(LedgerError);
    expect(() => registry.register({ code: "assets" })).toThrow(/already registered/);
    expect(() => registry.register({ code: "Bad Code!" })).toThrow(/invalid account code/);
  });
});

describe("entry validation", () => {
  test("accepts a balanced transaction and defaults the clock", () => {
    const tx = createTransaction({
      id: "tx1",
      description: "sale",
      entries: [
        { account: "assets:cash", direction: "debit", amount: usd(500) },
        { account: "income:sales", direction: "credit", amount: usd(500) },
      ],
    });
    expect(tx.postedAt).toBe(FIXED_TIMESTAMP);
    expect(tx.entries.map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(isBalanced(tx.entries)).toBe(true);
  });

  test("uses an injected clock", () => {
    const tx = createTransaction(
      {
        id: "tx1",
        description: "sale",
        entries: [
          { account: "assets:cash", direction: "debit", amount: usd(1) },
          { account: "income:sales", direction: "credit", amount: usd(1) },
        ],
      },
      () => "2030-06-01T12:00:00.000Z",
    );
    expect(tx.postedAt).toBe("2030-06-01T12:00:00.000Z");
  });

  test("rejects unbalanced debits and credits", () => {
    expect(() =>
      validateEntries([entry("assets:cash", "debit", 500, "a"), entry("income:sales", "credit", 400, "b")]),
    ).toThrow(/do not equal credits/);
  });

  test("rejects degenerate entry sets", () => {
    expect(() => validateEntries([entry("assets:cash", "debit", 1, "a")])).toThrow(/at least two entries/);
    expect(() =>
      validateEntries([entry("assets:cash", "debit", 1, "a"), entry("assets:bank", "debit", 1, "a")]),
    ).toThrow(/duplicate entry id/);
    expect(() =>
      validateEntries([entry("assets:cash", "debit", 1, "a"), entry("assets:bank", "debit", 1, "b")]),
    ).toThrow(/at least one credit/);
  });

  test("rejects zero, negative and mixed-currency amounts", () => {
    expect(() =>
      createTransaction({
        id: "tx",
        description: "bad",
        entries: [
          { account: "assets:cash", direction: "debit", amount: usd(0) },
          { account: "income:sales", direction: "credit", amount: usd(0) },
        ],
      }),
    ).toThrow(/must not be zero/);
    expect(() =>
      createTransaction({
        id: "tx",
        description: "bad",
        entries: [
          { account: "assets:cash", direction: "debit", amount: usd(-1) },
          { account: "income:sales", direction: "credit", amount: usd(1) },
        ],
      }),
    ).toThrow(/must not be negative/);
  });

  test("the journal refuses duplicate transaction ids", () => {
    const journal = new Journal();
    const input = {
      id: "tx1",
      description: "sale",
      entries: [
        { account: "assets:cash", direction: "debit" as const, amount: usd(1) },
        { account: "income:sales", direction: "credit" as const, amount: usd(1) },
      ],
    };
    journal.record(input);
    expect(() => journal.record(input)).toThrow(/already posted/);
    expect(journal.size).toBe(1);
  });
});
