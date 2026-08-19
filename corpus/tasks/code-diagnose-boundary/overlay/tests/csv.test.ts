import { describe, expect, test } from "bun:test";
import { csvField, csvRow, journalToCsv, parseCsvLine, toCsv } from "../src/csv";
import { money } from "../src/money";
import { makeJournal } from "./fixtures";

describe("csvField", () => {
  test("leaves plain values unquoted", () => {
    expect(csvField("cash")).toBe("cash");
    expect(csvField(42)).toBe("42");
    expect(csvField(true)).toBe("true");
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  test("quotes separators, quotes and newlines", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("carriage\r")).toBe('"carriage\r"');
    expect(csvField(" padded ")).toBe('" padded "');
  });

  test("respects a custom delimiter", () => {
    expect(csvField("a;b", ";")).toBe('"a;b"');
    expect(csvField("a;b", ",")).toBe("a;b");
  });

  test("renders money without grouping or currency", () => {
    expect(csvField(money(123_456, "USD"))).toBe("1234.56");
    expect(csvField(money(-123, "USD"))).toBe("-1.23");
  });
});

describe("toCsv", () => {
  test("writes a header row by default", () => {
    const out = toCsv([{ a: 1, b: "x,y" }], [
      { header: "a", value: (row) => row.a },
      { header: "b", value: (row) => row.b },
    ]);
    expect(out).toBe('a,b\n1,"x,y"');
  });

  test("can omit the header and change the eol", () => {
    const out = toCsv(
      [{ a: 1 }, { a: 2 }],
      [{ header: "a", value: (row) => row.a }],
      { header: false, eol: "\r\n" },
    );
    expect(out).toBe("1\r\n2");
  });
});

describe("journalToCsv", () => {
  const csv = journalToCsv(makeJournal());
  const lines = csv.split("\n");

  test("emits one line per entry plus a header", () => {
    expect(lines).toHaveLength(7);
    expect(lines[0]).toBe("transaction_id,posted_at,description,account,debit,credit,memo");
  });

  test("splits amounts across the debit and credit columns", () => {
    expect(lines[1]).toBe("tx1,2024-01-05T00:00:00.000Z,opening balance,assets:cash,1000.00,,");
    expect(lines[2]).toBe("tx1,2024-01-05T00:00:00.000Z,opening balance,equity:opening,,1000.00,");
  });

  test("quotes descriptions containing the delimiter", () => {
    expect(lines[3]).toBe('tx2,2024-01-10T00:00:00.000Z,"consulting, invoice #7",assets:bank,250.00,,');
    expect(parseCsvLine(lines[4] as string)[2]).toBe("consulting, invoice #7");
    expect(parseCsvLine(lines[4] as string)[6]).toBe("invoice #7");
  });

  test("round-trips every row through parseCsvLine", () => {
    for (const line of lines) {
      expect(parseCsvLine(line)).toHaveLength(7);
    }
  });
});
