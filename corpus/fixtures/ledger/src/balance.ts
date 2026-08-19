import { ancestorCodes, isDebitNormal, isUnder, rootType } from "./accounts";
import type { AccountRegistry } from "./accounts";
import { signedAmount } from "./entries";
import type { Journal } from "./journal";
import { money } from "./money";
import type { AccountBalance, AccountType, CurrencyCode, Money, Transaction } from "./types";

export interface BalanceOptions {
  readonly currency?: CurrencyCode;
  readonly registry?: AccountRegistry;
}

interface Accumulator {
  debit: number;
  credit: number;
  currency: CurrencyCode;
}

function accumulate(transactions: readonly Transaction[], fallbackCurrency: CurrencyCode): Map<string, Accumulator> {
  const totals = new Map<string, Accumulator>();
  for (const tx of transactions) {
    for (const entry of tx.entries) {
      const current = totals.get(entry.account) ?? {
        debit: 0,
        credit: 0,
        currency: entry.amount.currency ?? fallbackCurrency,
      };
      if (entry.direction === "debit") {
        current.debit += entry.amount.amount;
      } else {
        current.credit += entry.amount.amount;
      }
      totals.set(entry.account, current);
    }
  }
  return totals;
}

function toBalance(account: string, acc: Accumulator): AccountBalance {
  return {
    account,
    currency: acc.currency,
    debit: acc.debit,
    credit: acc.credit,
    balance: acc.debit - acc.credit,
  };
}

export function balances(journal: Journal, options: BalanceOptions = {}): AccountBalance[] {
  const currency = options.currency ?? "USD";
  const totals = accumulate(journal.all(), currency);
  return [...totals.entries()]
    .map(([account, acc]) => toBalance(account, acc))
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
}

export function balanceOf(journal: Journal, account: string, options: BalanceOptions = {}): AccountBalance {
  const currency = options.currency ?? "USD";
  const totals = accumulate(journal.all(), currency);
  const acc = totals.get(account) ?? { debit: 0, credit: 0, currency };
  return toBalance(account, acc);
}

export function rollup(journal: Journal, prefix: string, options: BalanceOptions = {}): AccountBalance {
  const currency = options.currency ?? "USD";
  const totals = accumulate(journal.all(), currency);
  const acc: Accumulator = { debit: 0, credit: 0, currency };
  for (const [account, entry] of totals) {
    if (!isUnder(account, prefix)) continue;
    acc.debit += entry.debit;
    acc.credit += entry.credit;
    acc.currency = entry.currency;
  }
  return toBalance(prefix, acc);
}

export function rollupTree(journal: Journal, options: BalanceOptions = {}): AccountBalance[] {
  const currency = options.currency ?? "USD";
  const totals = accumulate(journal.all(), currency);
  const nodes = new Map<string, Accumulator>();
  for (const [account, acc] of totals) {
    for (const code of [account, ...ancestorCodes(account)]) {
      const node = nodes.get(code) ?? { debit: 0, credit: 0, currency: acc.currency };
      node.debit += acc.debit;
      node.credit += acc.credit;
      nodes.set(code, node);
    }
  }
  return [...nodes.entries()]
    .map(([account, acc]) => toBalance(account, acc))
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
}

export function normalBalance(balance: AccountBalance, type?: AccountType): number {
  const resolved = type ?? rootType(balance.account) ?? "asset";
  return isDebitNormal(resolved) ? balance.balance : -balance.balance;
}

export function normalBalanceMoney(balance: AccountBalance, type?: AccountType): Money {
  return money(normalBalance(balance, type), balance.currency);
}

export function isJournalBalanced(journal: Journal): boolean {
  return balances(journal).reduce((acc, balance) => acc + balance.balance, 0) === 0;
}

export function entryCount(journal: Journal, account: string): number {
  return journal.rows().filter((row) => row.entry.account === account).length;
}

export function runningBalance(journal: Journal, account: string): number[] {
  let running = 0;
  return journal
    .rows()
    .filter((row) => row.entry.account === account)
    .map((row) => {
      running += signedAmount(row.entry);
      return running;
    });
}
