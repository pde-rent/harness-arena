// Throwaway data generator for the quant-reconcile-books task.
// NOT part of the overlay and never shipped to the agent.
//   bun tasks/quant-reconcile-books/solution/gen.ts
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("../overlay/data/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const EXP: Record<string, number> = { USD: 2, EUR: 2, GBP: 2, JPY: 0, BHD: 3 };

type ARow = {
  txId: string;
  postedAt: string;
  account: string;
  direction: "debit" | "credit";
  amount: string; // decimal major units, non-negative
  currency: string;
  reversalOf: string;
  description: string;
};
type BRow = {
  txId: string;
  postedAtUtc: string;
  account: string;
  amountMinor: number; // B convention: positive = credit, negative = debit
  currency: string;
  reversalOf: string | null;
  note: string;
};

/** Render a non-negative integer of minor units as an exact decimal string. */
function toDecimal(minor: number, currency: string): string {
  const e = EXP[currency] ?? 2;
  const s = String(Math.abs(minor)).padStart(e + 1, "0");
  return e === 0 ? s : `${s.slice(0, s.length - e)}.${s.slice(s.length - e)}`;
}

const a: ARow[] = [];
const b: BRow[] = [];

const ACCOUNTS = [
  "assets:cash:operating",
  "assets:receivable:trade",
  "expenses:ops:hosting",
  "expenses:ops:travel",
  "income:sales:subscription",
  "liabilities:payable:trade",
];

/** Add a pair of perfectly matching rows given A's signed minor amount. */
function matched(
  txId: string,
  postedAt: string,
  currency: string,
  signedMinorA: number,
  signedMinorB: number,
  accountAt: number,
  desc: string,
  currencyB = currency,
): void {
  const account = ACCOUNTS[accountAt % ACCOUNTS.length]!;
  a.push({
    txId,
    postedAt,
    account,
    direction: signedMinorA >= 0 ? "debit" : "credit",
    amount: toDecimal(signedMinorA, currency),
    currency,
    reversalOf: "",
    description: desc,
  });
  b.push({
    txId,
    postedAtUtc: postedAt,
    account,
    amountMinor: -signedMinorB,
    currency: currencyB,
    reversalOf: null,
    note: desc,
  });
}

// ---------------------------------------------------------------- clean rows
const CURRENCY_AT: Record<number, string> = {};
for (const i of [5, 14, 23, 32, 41, 50]) CURRENCY_AT[i] = "JPY";
for (const i of [9, 27]) CURRENCY_AT[i] = "BHD";
for (const i of [3, 11, 19, 28, 36, 44, 52, 60]) CURRENCY_AT[i] = "EUR";

for (let i = 1; i <= 60; i += 1) {
  const currency = CURRENCY_AT[i] ?? "USD";
  const id = `TX-${String(i).padStart(4, "0")}`;
  const month = 1 + (i % 3);
  const day = 1 + (i % 27);
  const hour = 8 + (i % 9);
  const postedAt = `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}:00.000Z`;
  const base = currency === "JPY" ? 800 + i * 13 : currency === "BHD" ? 12000 + i * 137 : 1000 + i * 313;
  const signed = i % 3 === 0 ? -base : base;
  matched(id, postedAt, currency, signed, signed, i, `clean settlement ${i}`);
}

// ------------------------------------------------------- T1: reversal pair (both books)
matched("TX-0101", "2024-02-05T10:00:00.000Z", "USD", 50000, 50000, 1, "duplicate charge");
{
  const account = ACCOUNTS[2]!;
  a.push({
    txId: "TX-0101-REV",
    postedAt: "2024-02-06T10:00:00.000Z",
    account,
    direction: "credit",
    amount: "500.00",
    currency: "USD",
    reversalOf: "TX-0101",
    description: "reversal of TX-0101",
  });
  b.push({
    txId: "TX-0101-REV",
    postedAtUtc: "2024-02-06T10:00:00.000Z",
    account,
    amountMinor: 50000,
    currency: "USD",
    reversalOf: "TX-0101",
    note: "reversal of TX-0101",
  });
}

// -------------------------------- T2: reversal in B whose original is absent from B
b.push({
  txId: "TX-0102-REV",
  postedAtUtc: "2024-02-11T09:15:00.000Z",
  account: ACCOUNTS[3]!,
  amountMinor: 7200,
  currency: "USD",
  reversalOf: "TX-0102",
  note: "reversal of TX-0102",
});

// ----------------------------------------------- T3: fiscal period boundary rows
matched("TX-0110", "2024-03-31T18:30:00.000Z", "USD", 31000, 31000, 0, "at the upper boundary");
matched("TX-0111", "2023-12-31T18:29:59.000Z", "USD", 29000, 29000, 1, "at the lower boundary");
matched("TX-0112", "2023-12-31T18:30:00.000Z", "USD", 27000, 27000, 2, "at the lower boundary");
matched("TX-0113", "2024-03-31T18:29:59.000Z", "USD", 26000, 26000, 3, "at the upper boundary");

// ------------------------------------ T4: same id twice in book A, different amounts
{
  const account = ACCOUNTS[4]!;
  for (const amount of ["100.00", "25.50"]) {
    a.push({
      txId: "TX-0120",
      postedAt: "2024-01-18T11:05:00.000Z",
      account,
      direction: "debit",
      amount,
      currency: "USD",
      reversalOf: "",
      description: "split posting",
    });
  }
  b.push({
    txId: "TX-0120",
    postedAtUtc: "2024-01-18T11:05:00.000Z",
    account,
    amountMinor: -12550,
    currency: "USD",
    reversalOf: null,
    note: "split posting",
  });
}

// ------------------------------------------------------ T5: materiality threshold
matched("TX-0130", "2024-02-14T13:00:00.000Z", "USD", 20000, 19996, 0, "rounding drift");
matched("TX-0131", "2024-02-15T13:00:00.000Z", "USD", 30000, 29995, 1, "rounding drift");
matched("TX-0132", "2024-02-16T13:00:00.000Z", "USD", 40000, 39994, 2, "rounding drift");

// -------------------------------------------------------- T6: an explicit credit
matched("TX-0140", "2024-03-04T15:45:00.000Z", "USD", -75000, -75000, 4, "customer refund");

// ------------------------------------------------------ T7: currency disagreement
{
  const account = ACCOUNTS[5]!;
  a.push({
    txId: "TX-0150",
    postedAt: "2024-03-12T08:20:00.000Z",
    account,
    direction: "debit",
    amount: "120.00",
    currency: "USD",
    reversalOf: "",
    description: "cross-border settlement",
  });
  b.push({
    txId: "TX-0150",
    postedAtUtc: "2024-03-12T08:20:00.000Z",
    account,
    amountMinor: -120,
    currency: "JPY",
    reversalOf: null,
    note: "cross-border settlement",
  });
}

// ------------------------------------------------------------- T8: rounding rows
{
  const rows: [string, string, string, number, number][] = [
    ["TX-0160", "2024-01-09T16:40:00.000Z", "10.125", 1006, 0],
    ["TX-0161", "2024-01-10T16:40:00.000Z", "20.625", 2057, 1],
  ];
  for (const [txId, postedAt, amount, minorB, at] of rows) {
    const account = ACCOUNTS[at]!;
    a.push({
      txId,
      postedAt,
      account,
      direction: "debit",
      amount,
      currency: "USD",
      reversalOf: "",
      description: "sub-cent invoice",
    });
    b.push({
      txId,
      postedAtUtc: postedAt,
      account,
      amountMinor: -minorB,
      currency: "USD",
      reversalOf: null,
      note: "sub-cent invoice",
    });
  }
}

// ---------------------------------------------------------------- T9: unmatched
for (const [txId, postedAt, signed, at] of [
  ["TX-0170", "2024-02-20T10:10:00.000Z", 18000, 0],
  ["TX-0171", "2024-02-21T10:10:00.000Z", -9400, 1],
  ["TX-0173", "2024-03-31T20:00:00.000Z", 5500, 2],
] as [string, string, number, number][]) {
  a.push({
    txId,
    postedAt,
    account: ACCOUNTS[at]!,
    direction: signed >= 0 ? "debit" : "credit",
    amount: toDecimal(signed, "USD"),
    currency: "USD",
    reversalOf: "",
    description: "book A only",
  });
}
for (const [txId, postedAt, signed, at] of [
  ["TX-0172", "2024-02-22T10:10:00.000Z", 16500, 3],
  ["TX-0174", "2024-02-23T10:10:00.000Z", -4300, 4],
] as [string, string, number, number][]) {
  b.push({
    txId,
    postedAtUtc: postedAt,
    account: ACCOUNTS[at]!,
    amountMinor: -signed,
    currency: "USD",
    reversalOf: null,
    note: "book B only",
  });
}

// ------------------------------------------------------ T10: material differences
matched("TX-0180", "2024-03-20T09:00:00.000Z", "USD", 100000, 99000, 0, "large settlement");
matched("TX-0181", "2024-03-21T09:00:00.000Z", "USD", -64000, -63500, 1, "large refund");

// ------------------------------------------------------------------ emit files
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}
a.sort((x, y) => fnv(x.txId + x.amount) - fnv(y.txId + y.amount));
b.sort((x, y) => fnv(y.txId + "#" + y.amountMinor) - fnv(x.txId + "#" + x.amountMinor));

const HEADER = "txId,postedAt,account,direction,amount,currency,reversalOf,description";
const csv = [
  HEADER,
  ...a.map((r) =>
    [r.txId, r.postedAt, r.account, r.direction, r.amount, r.currency, r.reversalOf, r.description].join(","),
  ),
].join("\n");
writeFileSync(`${OUT}books-a.csv`, csv + "\n");

const jsonl = b
  .map((r) =>
    JSON.stringify({
      txId: r.txId,
      postedAtUtc: r.postedAtUtc,
      account: r.account,
      amountMinor: r.amountMinor,
      currency: r.currency,
      reversalOf: r.reversalOf,
      note: r.note,
    }),
  )
  .join("\n");
writeFileSync(`${OUT}books-b.jsonl`, jsonl + "\n");

console.log(`book A rows: ${a.length}\nbook B rows: ${b.length}\ntotal: ${a.length + b.length}`);
