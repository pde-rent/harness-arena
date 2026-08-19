import { describe, expect, test } from "bun:test";
import { formatMoney } from "../src/money";
import { renderTrialBalance, statement, statementRows, trialBalance } from "../src/report";
import { makeJournal, makeRegistry } from "./fixtures";

describe("trialBalance", () => {
  const registry = makeRegistry();
  const report = trialBalance(makeJournal(), { registry });

  test("puts each account on its normal side", () => {
    const byAccount = new Map(report.rows.map((row) => [row.account, row]));
    expect(byAccount.get("assets:cash")?.debit.amount).toBe(85_000);
    expect(byAccount.get("assets:cash")?.credit.amount).toBe(0);
    expect(byAccount.get("income:sales")?.credit.amount).toBe(25_000);
    expect(byAccount.get("income:sales")?.debit.amount).toBe(0);
    expect(byAccount.get("expenses:rent")?.debit.amount).toBe(15_000);
  });

  test("resolves names and types from the registry", () => {
    const sales = report.rows.find((row) => row.account === "income:sales");
    expect(sales?.name).toBe("Sales");
    expect(sales?.type).toBe("income");
  });

  test("sorts rows by hierarchical account code", () => {
    expect(report.rows.map((row) => row.account)).toEqual([
      "assets:bank",
      "assets:cash",
      "equity:opening",
      "expenses:rent",
      "income:sales",
    ]);
  });

  test("totals both sides and balances", () => {
    expect(report.totalDebit.amount).toBe(125_000);
    expect(report.totalCredit.amount).toBe(125_000);
    expect(report.balanced).toBe(true);
  });

  test("renders a total line", () => {
    const lines = renderTrialBalance(report);
    expect(lines).toHaveLength(6);
    expect(lines[5]).toContain("TOTAL");
    expect(lines[5]).toContain(formatMoney(report.totalDebit));
  });

  test("works without a registry", () => {
    const bare = trialBalance(makeJournal());
    expect(bare.balanced).toBe(true);
    expect(bare.rows[0]?.name).toBe("assets:bank");
  });
});

describe("statement", () => {
  const journal = makeJournal();

  test("filters by account prefix and totals the subtree", () => {
    const report = statement(journal, { prefix: "assets" });
    expect(report.total.amount).toBe(110_000);
    expect(report.page.total).toBe(3);
    expect(report.page.items.map((row) => row.account)).toEqual([
      "assets:cash",
      "assets:bank",
      "assets:cash",
    ]);
  });

  test("carries a running balance in posting order", () => {
    const rows = statementRows(journal, { prefix: "assets" });
    expect(rows.map((row) => row.balance)).toEqual([100_000, 125_000, 110_000]);
  });

  test("sorts by amount then date then account", () => {
    const rows = statementRows(journal, { sort: "amount" });
    expect(rows.map((row) => row.amount.amount)).toEqual([
      15_000, 15_000, 25_000, 25_000, 100_000, 100_000,
    ]);
    expect(rows.slice(0, 2).map((row) => row.account)).toEqual(["assets:cash", "expenses:rent"]);
  });

  test("sorts by amount descending", () => {
    const rows = statementRows(journal, { sort: "amountDesc" });
    expect(rows[0]?.amount.amount).toBe(100_000);
    expect(rows[5]?.amount.amount).toBe(15_000);
  });

  test("paginates the rows with 1-based pages", () => {
    const first = statement(journal, { page: 1, pageSize: 4 });
    expect(first.page.items).toHaveLength(4);
    expect(first.page.totalPages).toBe(2);
    expect(first.page.hasNext).toBe(true);

    const second = statement(journal, { page: 2, pageSize: 4 });
    expect(second.page.items).toHaveLength(2);
    expect(second.page.hasNext).toBe(false);
    expect(second.page.hasPrev).toBe(true);
  });

  test("an unknown prefix yields one empty page", () => {
    const report = statement(journal, { prefix: "assets:vault" });
    expect(report.page.items).toEqual([]);
    expect(report.page.totalPages).toBe(1);
    expect(report.total.amount).toBe(0);
  });
});
