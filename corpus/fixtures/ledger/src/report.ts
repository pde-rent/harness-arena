import { isUnder, rootType, type AccountRegistry } from "./accounts";
import { balances, normalBalance, rollup } from "./balance";
import { byAccountCode, byAmount, byPostedAt, composeComparators, reverse, sorted } from "./compare";
import { signedAmount } from "./entries";
import type { Journal } from "./journal";
import { formatMoney, money } from "./money";
import { paginate } from "./paginate";
import type { AccountType, Comparator, CurrencyCode, Money, Page } from "./types";

export interface TrialBalanceRow {
  readonly account: string;
  readonly name: string;
  readonly type: AccountType;
  readonly debit: Money;
  readonly credit: Money;
}

export interface TrialBalance {
  readonly rows: readonly TrialBalanceRow[];
  readonly totalDebit: Money;
  readonly totalCredit: Money;
  readonly balanced: boolean;
  readonly currency: CurrencyCode;
}

export interface ReportOptions {
  readonly registry?: AccountRegistry;
  readonly currency?: CurrencyCode;
}

export function trialBalance(journal: Journal, options: ReportOptions = {}): TrialBalance {
  const currency = options.currency ?? "USD";
  const registry = options.registry;
  const rows: TrialBalanceRow[] = balances(journal, { currency }).map((balance) => {
    const account = registry?.get(balance.account);
    const type = account?.type ?? rootType(balance.account) ?? "asset";
    const net = normalBalance(balance, type);
    const debitNormal = type === "asset" || type === "expense";
    const positive = net >= 0;
    const magnitude = money(Math.abs(net), balance.currency);
    const onDebitSide = debitNormal === positive;
    return {
      account: balance.account,
      name: account?.name ?? balance.account,
      type,
      debit: onDebitSide ? magnitude : money(0, balance.currency),
      credit: onDebitSide ? money(0, balance.currency) : magnitude,
    };
  });

  const ordered = sorted(rows, byAccountCode);
  const totalDebit = ordered.reduce((acc, row) => acc + row.debit.amount, 0);
  const totalCredit = ordered.reduce((acc, row) => acc + row.credit.amount, 0);

  return {
    rows: ordered,
    totalDebit: money(totalDebit, currency),
    totalCredit: money(totalCredit, currency),
    balanced: totalDebit === totalCredit,
    currency,
  };
}

export interface StatementRow {
  readonly transactionId: string;
  readonly postedAt: string;
  readonly description: string;
  readonly account: string;
  readonly direction: "debit" | "credit";
  readonly amount: Money;
  readonly balance: number;
}

export type StatementSort = "date" | "amount" | "amountDesc" | "account";

export interface StatementOptions extends ReportOptions {
  readonly prefix?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly sort?: StatementSort;
}

function statementComparator(sort: StatementSort): Comparator<StatementRow> {
  switch (sort) {
    case "amount":
      return composeComparators<StatementRow>(byAmount, byPostedAt, byAccountCode);
    case "amountDesc":
      return composeComparators<StatementRow>(reverse(byAmount), byPostedAt, byAccountCode);
    case "account":
      return composeComparators<StatementRow>(byAccountCode, byPostedAt, byAmount);
    default:
      return composeComparators<StatementRow>(byPostedAt, byAccountCode, byAmount);
  }
}

export function statementRows(journal: Journal, options: StatementOptions = {}): StatementRow[] {
  const prefix = options.prefix ?? "";
  let running = 0;
  const rows: StatementRow[] = [];
  for (const row of journal.rows()) {
    if (!isUnder(row.entry.account, prefix)) continue;
    running += signedAmount(row.entry);
    rows.push({
      transactionId: row.transactionId,
      postedAt: row.postedAt,
      description: row.description,
      account: row.entry.account,
      direction: row.entry.direction,
      amount: row.entry.amount,
      balance: running,
    });
  }
  return sorted(rows, statementComparator(options.sort ?? "date"));
}

export interface Statement {
  readonly prefix: string;
  readonly total: Money;
  readonly page: Page<StatementRow>;
}

export function statement(journal: Journal, options: StatementOptions = {}): Statement {
  const prefix = options.prefix ?? "";
  const currency = options.currency ?? "USD";
  const rows = statementRows(journal, options);
  const summary = rollup(journal, prefix, { currency });
  return {
    prefix,
    total: money(summary.balance, summary.currency),
    page: paginate(rows, { page: options.page ?? 1, pageSize: options.pageSize ?? 25 }),
  };
}

export function renderTrialBalance(report: TrialBalance): string[] {
  const lines = report.rows.map(
    (row) => `${row.account.padEnd(24)} ${formatMoney(row.debit).padStart(16)} ${formatMoney(row.credit).padStart(16)}`,
  );
  lines.push(
    `${"TOTAL".padEnd(24)} ${formatMoney(report.totalDebit).padStart(16)} ${formatMoney(report.totalCredit).padStart(16)}`,
  );
  return lines;
}
