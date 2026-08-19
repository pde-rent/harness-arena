export type CurrencyCode = string;

export interface Money {
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export interface Account {
  readonly code: string;
  readonly name: string;
  readonly type: AccountType;
  readonly currency: CurrencyCode;
}

export type Direction = "debit" | "credit";

export interface Entry {
  readonly id: string;
  readonly account: string;
  readonly direction: Direction;
  readonly amount: Money;
  readonly memo?: string;
}

export interface Transaction {
  readonly id: string;
  readonly postedAt: string;
  readonly description: string;
  readonly entries: readonly Entry[];
}

export interface AccountBalance {
  readonly account: string;
  readonly currency: CurrencyCode;
  readonly debit: number;
  readonly credit: number;
  readonly balance: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
  readonly totalPages: number;
  readonly hasNext: boolean;
  readonly hasPrev: boolean;
}

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export type Comparator<T> = (a: T, b: T) => number;

export type Clock = () => string;

export class LedgerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}
