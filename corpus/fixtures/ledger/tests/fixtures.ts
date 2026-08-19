import { AccountRegistry } from "../src/accounts";
import { Journal } from "../src/journal";
import { money } from "../src/money";
import type { Money } from "../src/types";

export const usd = (amount: number): Money => money(amount, "USD");

export function makeRegistry(): AccountRegistry {
  const registry = new AccountRegistry("USD");
  registry.registerAll([
    { code: "assets", name: "Assets" },
    { code: "assets:cash", name: "Cash" },
    { code: "assets:bank", name: "Bank" },
    { code: "equity", name: "Equity" },
    { code: "equity:opening", name: "Opening balances" },
    { code: "income", name: "Income" },
    { code: "income:sales", name: "Sales" },
    { code: "expenses", name: "Expenses" },
    { code: "expenses:rent", name: "Rent" },
  ]);
  return registry;
}

export function makeJournal(): Journal {
  const journal = new Journal();
  journal.record({
    id: "tx1",
    description: "opening balance",
    postedAt: "2024-01-05T00:00:00.000Z",
    entries: [
      { account: "assets:cash", direction: "debit", amount: usd(100_000) },
      { account: "equity:opening", direction: "credit", amount: usd(100_000) },
    ],
  });
  journal.record({
    id: "tx2",
    description: "consulting, invoice #7",
    postedAt: "2024-01-10T00:00:00.000Z",
    entries: [
      { account: "assets:bank", direction: "debit", amount: usd(25_000) },
      { account: "income:sales", direction: "credit", amount: usd(25_000), memo: "invoice #7" },
    ],
  });
  journal.record({
    id: "tx3",
    description: "office rent",
    postedAt: "2024-01-15T00:00:00.000Z",
    entries: [
      { account: "expenses:rent", direction: "debit", amount: usd(15_000) },
      { account: "assets:cash", direction: "credit", amount: usd(15_000) },
    ],
  });
  return journal;
}
