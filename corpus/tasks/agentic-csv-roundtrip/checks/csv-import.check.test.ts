import { describe, expect, test } from "bun:test";
import { parseCsv, parseJournalCsv } from "../src/csv-import";
import { csvRow, journalCsvRows, journalToCsv } from "../src/csv";
import { LedgerError } from "../src/types";
import { money } from "../src/money";
import { makeJournal } from "../tests/fixtures";

const NASTY: string[][] = [
  ["plain", "with,comma", 'say "hi"'],
  ["line1\nline2", "carriage\rreturn", "crlf\r\ninside"],
  ["", " padded ", "trailing "],
  ["a", "", ""],
  ['"leading quote', 'trailing quote"', ',",\n'],
  ["tab\there", "semi;colon", "0.05"],
];

function write(rows: string[][], delimiter: string, eol: string): string {
  return rows.map((row) => csvRow(row, { delimiter })).join(eol);
}

describe("parseCsv quoting", () => {
  test("plain fields", () => {
    expect(parseCsv("a,b,c")).toEqual([["a", "b", "c"]]);
  });

  test("quoted field containing the delimiter", () => {
    expect(parseCsv('a,"b,c",d')).toEqual([["a", "b,c", "d"]]);
  });

  test("doubled quotes inside a quoted field", () => {
    expect(parseCsv('a,"say ""hi""",b')).toEqual([["a", 'say "hi"', "b"]]);
    expect(parseCsv('"""",x')).toEqual([['"', "x"]]);
  });

  test("newlines inside a quoted field do not end the record", () => {
    expect(parseCsv('a,"line1\nline2",c')).toEqual([["a", "line1\nline2", "c"]]);
    expect(parseCsv('a,"line1\r\nline2",c')).toEqual([["a", "line1\r\nline2", "c"]]);
    expect(parseCsv('"one\ntwo"\n"three"')).toEqual([["one\ntwo"], ["three"]]);
  });

  test("preserves leading and trailing spaces", () => {
    expect(parseCsv('" padded ",x')).toEqual([[" padded ", "x"]]);
    expect(parseCsv(" raw ,x")).toEqual([[" raw ", "x"]]);
  });

  test("empty fields in every position", () => {
    expect(parseCsv("a,,")).toEqual([["a", "", ""]]);
    expect(parseCsv(",a,")).toEqual([["", "a", ""]]);
    expect(parseCsv(',"",')).toEqual([["", "", ""]]);
    expect(parseCsv("")).toEqual([]);
  });

  test("ragged records are reported as-is", () => {
    expect(parseCsv("a,b\nc\nd,e,f")).toEqual([["a", "b"], ["c"], ["d", "e", "f"]]);
  });
});

describe("parseCsv line endings", () => {
  test("LF and CRLF both end a record", () => {
    expect(parseCsv("a,b\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\r\nc,d")).toEqual([["a", "b"], ["c", "d"]]);
    expect(parseCsv("a,b\r\nc,d\r\n")).toEqual([["a", "b"], ["c", "d"]]);
  });

  test("a single trailing terminator adds no empty record", () => {
    expect(parseCsv("a,b\n")).toEqual([["a", "b"]]);
    expect(parseCsv("a,b")).toEqual(parseCsv("a,b\n"));
  });
});

describe("parseCsv custom delimiter", () => {
  test("semicolon", () => {
    expect(parseCsv('a;"b;c";d', { delimiter: ";" })).toEqual([["a", "b;c", "d"]]);
    expect(parseCsv("a,b;c", { delimiter: ";" })).toEqual([["a,b", "c"]]);
  });

  test("tab", () => {
    expect(parseCsv('x\t"y\tz"', { delimiter: "\t" })).toEqual([["x", "y\tz"]]);
  });
});

describe("parseCsv malformed input", () => {
  const cases: string[] = ['a,"b', '"unterminated', 'a,"b"c', '"a"x,y'];

  for (const bad of cases) {
    test(`rejects ${JSON.stringify(bad)}`, () => {
      let caught: unknown;
      try {
        parseCsv(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LedgerError);
      expect((caught as LedgerError).code).toBe("CSV_PARSE");
    });
  }
});

describe("round-trip property", () => {
  for (const delimiter of [",", ";", "\t"]) {
    for (const eol of ["\n", "\r\n"]) {
      test(`writer then parser is the identity (delimiter=${JSON.stringify(delimiter)}, eol=${JSON.stringify(eol)})`, () => {
        expect(parseCsv(write(NASTY, delimiter, eol), { delimiter })).toEqual(NASTY);
      });
    }
  }

  test("single cells round-trip individually", () => {
    for (const cell of NASTY.flat()) {
      const rows = [[cell, "sentinel"]];
      expect(parseCsv(write(rows, ",", "\n"))).toEqual(rows);
    }
  });
});

describe("journal round-trip", () => {
  const journal = makeJournal();

  test("rebuilds the exported rows exactly", () => {
    expect(parseJournalCsv(journalToCsv(journal))).toEqual(journalCsvRows(journal));
  });

  test("works with a custom delimiter and CRLF", () => {
    const csv = journalToCsv(journal, { delimiter: ";", eol: "\r\n" });
    expect(parseJournalCsv(csv, { delimiter: ";" })).toEqual(journalCsvRows(journal));
  });

  test("typed money fields, with the empty side null", () => {
    const rows = parseJournalCsv(journalToCsv(journal));
    expect(rows[0]?.debit).toEqual(money(100_000, "USD"));
    expect(rows[0]?.credit).toBeNull();
    expect(rows[1]?.debit).toBeNull();
    expect(rows[1]?.credit).toEqual(money(100_000, "USD"));
    expect(rows[3]?.description).toBe("consulting, invoice #7");
    expect(rows[3]?.memo).toBe("invoice #7");
    expect(rows[0]?.transactionId).toBe("tx1");
    expect(rows[0]?.postedAt).toBe("2024-01-05T00:00:00.000Z");
    expect(rows[0]?.account).toBe("assets:cash");
  });

  test("honours the currency option", () => {
    const csv = "transaction_id,posted_at,description,account,debit,credit,memo\ntx,t,d,assets:cash,10,,";
    expect(parseJournalCsv(csv, { currency: "JPY" })[0]?.debit).toEqual(money(10, "JPY"));
    expect(parseJournalCsv(csv, { currency: "BHD" })[0]?.debit).toEqual(money(10_000, "BHD"));
  });

  test("header:false treats every record as data", () => {
    const body = journalToCsv(journal, { header: false });
    expect(parseJournalCsv(body, { header: false })).toEqual(journalCsvRows(journal));
  });

  test("rejects a bad header and a wrong field count", () => {
    const badHeader = "a,b,c,d,e,f,g\ntx,t,d,assets:cash,10.00,,";
    const badWidth = "transaction_id,posted_at,description,account,debit,credit,memo\ntx,t,d";
    for (const bad of [badHeader, badWidth]) {
      let caught: unknown;
      try {
        parseJournalCsv(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(LedgerError);
      expect((caught as LedgerError).code).toBe("CSV_SHAPE");
    }
  });
});

describe("public surface", () => {
  test("the new names are re-exported from the index", async () => {
    const api = await import("../src/index");
    expect(typeof api.parseCsv).toBe("function");
    expect(typeof api.parseJournalCsv).toBe("function");
    expect(api.parseCsv("a,b")).toEqual([["a", "b"]]);
  });
});
