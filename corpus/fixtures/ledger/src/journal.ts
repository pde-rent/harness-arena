import { createTransaction, fixedClock, validateEntries, type TransactionInput } from "./entries";
import { isUnder } from "./accounts";
import { LedgerError, type Clock, type Entry, type Transaction } from "./types";

export interface JournalOptions {
  readonly clock?: Clock;
}

export interface JournalEntryRow {
  readonly transactionId: string;
  readonly postedAt: string;
  readonly description: string;
  readonly entry: Entry;
}

export class Journal {
  private readonly transactions: Transaction[] = [];
  private readonly index = new Map<string, Transaction>();
  private readonly clock: Clock;

  constructor(options: JournalOptions = {}) {
    this.clock = options.clock ?? fixedClock;
  }

  post(tx: Transaction): Transaction {
    if (this.index.has(tx.id)) {
      throw new LedgerError("JOURNAL_DUPLICATE_TX", `transaction already posted: ${tx.id}`);
    }
    validateEntries(tx.entries);
    this.transactions.push(tx);
    this.index.set(tx.id, tx);
    return tx;
  }

  record(input: TransactionInput): Transaction {
    return this.post(createTransaction(input, this.clock));
  }

  all(): Transaction[] {
    return [...this.transactions];
  }

  get(id: string): Transaction | undefined {
    return this.index.get(id);
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  get size(): number {
    return this.transactions.length;
  }

  rows(): JournalEntryRow[] {
    const rows: JournalEntryRow[] = [];
    for (const tx of this.transactions) {
      for (const entry of tx.entries) {
        rows.push({
          transactionId: tx.id,
          postedAt: tx.postedAt,
          description: tx.description,
          entry,
        });
      }
    }
    return rows;
  }

  rowsFor(prefix: string): JournalEntryRow[] {
    return this.rows().filter((row) => isUnder(row.entry.account, prefix));
  }

  between(fromInclusive: string, toExclusive: string): Transaction[] {
    return this.transactions.filter((tx) => tx.postedAt >= fromInclusive && tx.postedAt < toExclusive);
  }

  filter(predicate: (tx: Transaction) => boolean): Transaction[] {
    return this.transactions.filter(predicate);
  }
}
