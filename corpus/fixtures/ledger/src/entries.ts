import { assertValidCode } from "./accounts";
import { add, isNegative, isZero, zero } from "./money";
import { LedgerError, type Clock, type Direction, type Entry, type Money, type Transaction } from "./types";

export const FIXED_TIMESTAMP = "2024-01-01T00:00:00.000Z";

export const fixedClock: Clock = () => FIXED_TIMESTAMP;

export interface EntryInput {
  readonly id?: string;
  readonly account: string;
  readonly direction: Direction;
  readonly amount: Money;
  readonly memo?: string;
}

export interface TransactionInput {
  readonly id: string;
  readonly description: string;
  readonly postedAt?: string;
  readonly entries: readonly EntryInput[];
}

export function createEntry(input: EntryInput, index = 0): Entry {
  if (isNegative(input.amount)) {
    throw new LedgerError("ENTRY_NEGATIVE", `entry amounts must not be negative: ${input.amount.amount}`);
  }
  if (isZero(input.amount)) {
    throw new LedgerError("ENTRY_ZERO", `entry amounts must not be zero for account ${input.account}`);
  }
  return {
    id: input.id ?? `e${index + 1}`,
    account: assertValidCode(input.account),
    direction: input.direction,
    amount: input.amount,
    ...(input.memo === undefined ? {} : { memo: input.memo }),
  };
}

export function totalFor(entries: readonly Entry[], direction: Direction): Money {
  const currency = entries[0]?.amount.currency ?? "USD";
  return entries
    .filter((entry) => entry.direction === direction)
    .reduce((acc, entry) => add(acc, entry.amount), zero(currency));
}

export function isBalanced(entries: readonly Entry[]): boolean {
  const debits = totalFor(entries, "debit");
  const credits = totalFor(entries, "credit");
  return debits.amount === credits.amount;
}

export function validateEntries(entries: readonly Entry[]): void {
  if (entries.length < 2) {
    throw new LedgerError("TX_TOO_FEW_ENTRIES", "a transaction needs at least two entries");
  }
  const currency = (entries[0] as Entry).amount.currency;
  for (const entry of entries) {
    if (entry.amount.currency !== currency) {
      throw new LedgerError(
        "TX_MIXED_CURRENCY",
        `all entries must share a currency: ${currency} vs ${entry.amount.currency}`,
      );
    }
  }
  const ids = new Set<string>();
  for (const entry of entries) {
    if (ids.has(entry.id)) {
      throw new LedgerError("ENTRY_DUPLICATE_ID", `duplicate entry id: ${entry.id}`);
    }
    ids.add(entry.id);
  }
  if (!entries.some((entry) => entry.direction === "debit")) {
    throw new LedgerError("TX_NO_DEBIT", "a transaction needs at least one debit entry");
  }
  if (!entries.some((entry) => entry.direction === "credit")) {
    throw new LedgerError("TX_NO_CREDIT", "a transaction needs at least one credit entry");
  }
  const debits = totalFor(entries, "debit");
  const credits = totalFor(entries, "credit");
  if (debits.amount !== credits.amount) {
    throw new LedgerError(
      "TX_UNBALANCED",
      `debits (${debits.amount}) do not equal credits (${credits.amount})`,
    );
  }
}

export function createTransaction(input: TransactionInput, clock: Clock = fixedClock): Transaction {
  if (input.id.trim().length === 0) {
    throw new LedgerError("TX_NO_ID", "a transaction needs a non-empty id");
  }
  const entries = input.entries.map((entry, index) => createEntry(entry, index));
  validateEntries(entries);
  return {
    id: input.id,
    description: input.description,
    postedAt: input.postedAt ?? clock(),
    entries,
  };
}

export function transactionTotal(tx: Transaction): Money {
  return totalFor(tx.entries, "debit");
}

export function accountsTouched(tx: Transaction): string[] {
  return [...new Set(tx.entries.map((entry) => entry.account))].sort();
}

export function signedAmount(entry: Entry): number {
  return entry.direction === "debit" ? entry.amount.amount : -entry.amount.amount;
}
