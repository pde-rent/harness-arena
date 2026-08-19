import { describe, expect, test } from "bun:test";
import { parseCsv, parseJournalCsv } from "../src/csv-import";
import { csvRow, journalCsvRows, journalToCsv } from "../src/csv";
import { LedgerError } from "../src/types";
import { makeJournal } from "./fixtures";

describe("parseCsv", () => {
  test("splits plain records on both line endings", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("")).toEqual([]);
  });

  test("honours quoting", () => {
    expect(parseCsv('a,"b,c","say ""hi""","x\ny"')).toEqual([["a", "b,c", 'say "hi"', "x\ny"]]);
    expect(parseCsv('" padded ",,')).toEqual([[" padded ", "", ""]]);
  });

  test("supports a custom delimiter", () => {
    expect(parseCsv('a;"b;c"', { delimiter: ";" })).toEqual([["a", "b;c"]]);
  });

  test("rejects malformed input with LedgerError CSV_PARSE", () => {
    for (const bad of ['a,"b', 'a,"b"c']) {
      expect(() => parseCsv(bad)).toThrow(LedgerError);
      try {
        parseCsv(bad);
      } catch (error) {
        expect((error as LedgerError).code).toBe("CSV_PARSE");
      }
    }
  });

  test("is the inverse of the writer", () => {
    const rows = [
      ["plain", "with,comma", 'say "hi"'],
      ["new\nline", " padded ", ""],
    ];
    const text = rows.map((row) => csvRow(row)).join("\r\n");
    expect(parseCsv(text)).toEqual(rows);
  });
});

describe("parseJournalCsv", () => {
  const journal = makeJournal();

  test("round-trips the journal export", () => {
    expect(parseJournalCsv(journalToCsv(journal))).toEqual(journalCsvRows(journal));
  });

  test("rejects a wrong shape with LedgerError CSV_SHAPE", () => {
    try {
      parseJournalCsv("a,b,c,d,e,f,g\n1,2,3,4,5,6,7");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerError);
      expect((error as LedgerError).code).toBe("CSV_SHAPE");
    }
  });
});
