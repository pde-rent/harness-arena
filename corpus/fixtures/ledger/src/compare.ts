import { splitCode } from "./accounts";
import type { Comparator, Money } from "./types";

export interface HasPostedAt {
  readonly postedAt: string;
}

export interface HasAmount {
  readonly amount: Money | number;
}

export interface HasAccount {
  readonly account: string;
}

function amountValue(value: Money | number): number {
  return typeof value === "number" ? value : value.amount;
}

function compareNumbers(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function compareStrings(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

export const byPostedAt: Comparator<HasPostedAt> = (a, b) => compareStrings(a.postedAt, b.postedAt);

export const byAmount: Comparator<HasAmount> = (a, b) =>
  compareNumbers(amountValue(a.amount), amountValue(b.amount));

export const byAccountCode: Comparator<HasAccount> = (a, b) => {
  const left = splitCode(a.account);
  const right = splitCode(b.account);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const result = compareStrings(left[index] as string, right[index] as string);
    if (result !== 0) return result;
  }
  return compareNumbers(left.length, right.length);
};

export function composeComparators<T>(...comparators: readonly Comparator<T>[]): Comparator<T> {
  return (a, b) => {
    for (const comparator of comparators) {
      const result = comparator(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

export function reverse<T>(comparator: Comparator<T>): Comparator<T> {
  return (a, b) => -comparator(a, b);
}

export function on<T, U>(select: (value: T) => U, comparator: Comparator<U>): Comparator<T> {
  return (a, b) => comparator(select(a), select(b));
}

export function byKey<T, K extends keyof T>(key: K): Comparator<T> {
  return (a, b) => {
    const left = a[key];
    const right = b[key];
    if (typeof left === "number" && typeof right === "number") return compareNumbers(left, right);
    return compareStrings(String(left), String(right));
  };
}

export function sorted<T>(items: readonly T[], comparator: Comparator<T>): T[] {
  return items
    .map((value, index) => ({ value, index }))
    .sort((a, b) => {
      const result = comparator(a.value, b.value);
      return result === 0 ? a.index - b.index : result;
    })
    .map((wrapped) => wrapped.value);
}
