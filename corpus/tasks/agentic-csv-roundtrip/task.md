# Close the CSV loop: add a reader for what we already write

This repository is a double-entry accounting ledger library. Its test suite currently passes.

`src/csv.ts` can *write* CSV — arbitrary tables via `toCsv`, and the journal export via
`journalToCsv` — but the library cannot *read* CSV back. The only reader is `parseCsvLine`, which
splits a single line and therefore cannot handle a field with an embedded newline, which our own
writer happily produces. Build the missing half.

## What to build

### 1. A new module `src/csv-import.ts`

It must export exactly these names:

```ts
export interface CsvParseOptions {
  readonly delimiter?: string;
}

export function parseCsv(text: string, options?: CsvParseOptions): string[][];
```

`parseCsv` turns a whole CSV document into records of fields, and is the inverse of the writer in
`src/csv.ts`. Required behaviour:

- **Quoting (RFC 4180 style).** A field may be wrapped in double quotes. Inside a quoted field, a
  doubled quote `""` denotes one literal `"`, and the delimiter, `\n` and `\r` are ordinary
  characters that belong to the field.
- **Verbatim content.** Nothing is trimmed, unescaped or normalized beyond the quoting rules
  above. Leading and trailing spaces survive, in quoted and unquoted fields alike. A `\r\n`
  *inside* a quoted field stays a `\r\n`.
- **Empty fields.** An empty field yields `""`. This includes an empty first field, an empty field
  in the middle, and an empty last field: `a,,` parses to `["a", "", ""]`.
- **Line endings.** Outside quotes, both `\n` and `\r\n` terminate a record. A single trailing
  record separator at the end of the document does not produce an extra empty record, so
  `"a,b\n"` and `"a,b"` parse alike.
- **Empty document.** `parseCsv("")` returns `[]`.
- **Configurable delimiter.** `options.delimiter` defaults to `","` and may be any single
  character, e.g. `";"` or `"\t"`.
- **Ragged records are allowed.** `parseCsv` does not require every record to have the same number
  of fields; it reports what the document contains.

**Malformed input must be rejected**, not silently repaired. Throw the error type this library
already uses for every other failure: `LedgerError` from `src/types.ts`, constructed with the code
string `"CSV_PARSE"`. At minimum these are malformed:

- a quoted field that is never closed before the end of the document, e.g. `a,"b`;
- a character other than the delimiter or a line ending directly after a closing quote, e.g.
  `a,"b"c`.

### 2. The round-trip property

State it and satisfy it: **for any table of string cells, parsing the writer's output returns the
original cells.** Concretely, for any `rows: string[][]` and any delimiter `d`, writing each row
with `csvRow(row, { delimiter: d })`, joining the lines with `"\n"` or `"\r\n"`, and feeding the
result to `parseCsv(text, { delimiter: d })` must give back exactly `rows` — commas, quotes,
newlines, tabs, leading/trailing spaces, empty cells and all.

(The one degenerate exception, since the two are indistinguishable on the wire: a table that is a
single record holding a single empty cell writes as the empty document and reads back as `[]`.)

### 3. Reading the journal export back

Also from `src/csv-import.ts`, export the higher-level counterpart of `journalToCsv`:

```ts
export interface JournalCsvImportOptions extends CsvParseOptions {
  readonly currency?: string;  // defaults to "USD"
  readonly header?: boolean;   // defaults to true
}

export function parseJournalCsv(text: string, options?: JournalCsvImportOptions): JournalCsvRow[];
```

`JournalCsvRow` is the interface already exported from `src/csv.ts` — reuse it, do not redeclare a
second copy. `parseJournalCsv` parses the document and rebuilds one typed row per record:

- `transactionId`, `postedAt`, `description`, `account` and `memo` are the field strings as parsed.
- `debit` and `credit` are `Money | null`: an empty field is `null`, otherwise the field is read as
  an amount in `options.currency` (default `"USD"`), so `"1000.00"` in USD becomes 100000 minor
  units. The library already has a function that parses a money string.
- When `options.header` is not `false`, the first record is a header row: it must equal the headers
  of `JOURNAL_COLUMNS` in order, and it is not returned as data. When it is `false`, every record
  is data.
- A record whose field count is not 7, or a header row that does not match, is malformed: throw
  `LedgerError` with the code string `"CSV_SHAPE"`.

The guarantee to hold: for any journal, `parseJournalCsv(journalToCsv(journal))` deep-equals
`journalCsvRows(journal)`, for the default delimiter and for a custom one.

### 4. Wiring

Re-export the new module's public names — `parseCsv`, `parseJournalCsv` and both option
interfaces — from `src/index.ts`, alongside the existing exports and in the same style.

### 5. Tests

Add at least one **new** test file of your own under `tests/` covering the new module. The existing
test files must keep passing unchanged; do not weaken, delete or rewrite them.

## Constraints

- No new dependencies, no network. The project runs on its existing zero-dependency setup.
- Do not change the behaviour or signatures of anything already exported, including `csvField`,
  `csvRow`, `toCsv`, `journalToCsv` and `parseCsvLine`.
- The whole test suite must pass when you are done.
