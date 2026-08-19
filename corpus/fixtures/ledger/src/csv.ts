import { formatMoney } from "./money";
import type { Journal } from "./journal";
import type { Money } from "./types";

export interface CsvOptions {
  readonly delimiter?: string;
  readonly eol?: string;
  readonly header?: boolean;
}

export type CsvValue = string | number | boolean | Money | null | undefined;

export interface CsvColumn<T> {
  readonly header: string;
  readonly value: (row: T) => CsvValue;
}

const NEEDS_QUOTES = /[",\r\n]/;

export function csvField(value: CsvValue, delimiter = ","): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "object") {
    text = formatMoney(value, { withCurrency: false, groupSeparator: "" });
  } else {
    text = String(value);
  }
  const mustQuote = NEEDS_QUOTES.test(text) || text.includes(delimiter) || text !== text.trim();
  if (!mustQuote) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvRow(values: readonly CsvValue[], options: CsvOptions = {}): string {
  const delimiter = options.delimiter ?? ",";
  return values.map((value) => csvField(value, delimiter)).join(delimiter);
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[], options: CsvOptions = {}): string {
  const eol = options.eol ?? "\n";
  const lines: string[] = [];
  if (options.header !== false) {
    lines.push(csvRow(columns.map((column) => column.header), options));
  }
  for (const row of rows) {
    lines.push(csvRow(columns.map((column) => column.value(row)), options));
  }
  return lines.join(eol);
}

export interface JournalCsvRow {
  readonly transactionId: string;
  readonly postedAt: string;
  readonly description: string;
  readonly account: string;
  readonly debit: Money | null;
  readonly credit: Money | null;
  readonly memo: string;
}

export const JOURNAL_COLUMNS: readonly CsvColumn<JournalCsvRow>[] = [
  { header: "transaction_id", value: (row) => row.transactionId },
  { header: "posted_at", value: (row) => row.postedAt },
  { header: "description", value: (row) => row.description },
  { header: "account", value: (row) => row.account },
  { header: "debit", value: (row) => row.debit },
  { header: "credit", value: (row) => row.credit },
  { header: "memo", value: (row) => row.memo },
];

export function journalCsvRows(journal: Journal): JournalCsvRow[] {
  return journal.rows().map((row) => ({
    transactionId: row.transactionId,
    postedAt: row.postedAt,
    description: row.description,
    account: row.entry.account,
    debit: row.entry.direction === "debit" ? row.entry.amount : null,
    credit: row.entry.direction === "credit" ? row.entry.amount : null,
    memo: row.entry.memo ?? "",
  }));
}

export function journalToCsv(journal: Journal, options: CsvOptions = {}): string {
  return toCsv(journalCsvRows(journal), JOURNAL_COLUMNS, options);
}

export function parseCsvLine(line: string, delimiter = ","): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}
