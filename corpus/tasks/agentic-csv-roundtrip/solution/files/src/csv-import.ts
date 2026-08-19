import { JOURNAL_COLUMNS, type JournalCsvRow } from "./csv";
import { parseMoney } from "./money";
import { LedgerError, type CurrencyCode, type Money } from "./types";

export interface CsvParseOptions {
  readonly delimiter?: string;
}

export interface JournalCsvImportOptions extends CsvParseOptions {
  readonly currency?: CurrencyCode;
  readonly header?: boolean;
}

function badCsv(message: string): never {
  throw new LedgerError("CSV_PARSE", message);
}

export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
  const delimiter = options.delimiter ?? ",";
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === "\n" || delimiter === "\r") {
    badCsv(`invalid delimiter: ${JSON.stringify(delimiter)}`);
  }

  const records: string[][] = [];
  if (text.length === 0) return records;

  let fields: string[] = [];
  let index = 0;

  for (;;) {
    let value = "";
    if (text[index] === '"') {
      index += 1;
      for (;;) {
        if (index >= text.length) badCsv("unterminated quoted field");
        const char = text[index] as string;
        if (char === '"') {
          if (text[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        value += char;
        index += 1;
      }
      const after = text[index];
      if (after !== undefined && after !== delimiter && after !== "\n" && after !== "\r") {
        badCsv(`unexpected character after a closing quote: ${JSON.stringify(after)}`);
      }
    } else {
      while (index < text.length) {
        const char = text[index] as string;
        if (char === delimiter || char === "\n" || char === "\r") break;
        value += char;
        index += 1;
      }
    }
    fields.push(value);

    const char = text[index];
    if (char === undefined) {
      records.push(fields);
      break;
    }
    if (char === delimiter) {
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      if (text[index] === "\n") index += 1;
    } else {
      index += 1;
    }
    records.push(fields);
    fields = [];
    if (index >= text.length) break;
  }

  return records;
}

function amountField(text: string, currency: CurrencyCode): Money | null {
  return text.length === 0 ? null : parseMoney(text, currency);
}

export function parseJournalCsv(text: string, options: JournalCsvImportOptions = {}): JournalCsvRow[] {
  const currency = options.currency ?? "USD";
  const records = parseCsv(text, options);
  let data = records;

  if (options.header !== false) {
    const head = records[0];
    if (head === undefined) return [];
    const expected = JOURNAL_COLUMNS.map((column) => column.header);
    if (head.length !== expected.length || head.some((cell, i) => cell !== expected[i])) {
      throw new LedgerError("CSV_SHAPE", `unexpected journal csv header: ${head.join(",")}`);
    }
    data = records.slice(1);
  }

  return data.map((record) => {
    if (record.length !== JOURNAL_COLUMNS.length) {
      throw new LedgerError(
        "CSV_SHAPE",
        `expected ${JOURNAL_COLUMNS.length} fields per row, got ${record.length}`,
      );
    }
    const [transactionId, postedAt, description, account, debit, credit, memo] = record as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    return {
      transactionId,
      postedAt,
      description,
      account,
      debit: amountField(debit, currency),
      credit: amountField(credit, currency),
      memo,
    };
  });
}
