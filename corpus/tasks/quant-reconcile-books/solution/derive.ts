// Independent derivation of expected.json from the committed overlay data.
// NOT part of the overlay and never shipped to the agent.
//   bun tasks/quant-reconcile-books/solution/derive.ts
import { readFileSync } from "node:fs";

const DATA = new URL("../overlay/data/", import.meta.url).pathname;

// From src/money.ts CURRENCY_EXPONENTS, default 2.
const EXPONENTS: Record<string, number> = {
  USD: 2, EUR: 2, GBP: 2, CHF: 2, JPY: 0, KRW: 0, BHD: 3, KWD: 3,
};
const exponentOf = (c: string) => EXPONENTS[c.toUpperCase()] ?? 2;

/** Exact decimal -> minor units with half-to-even rounding. No floating point. */
function toMinor(decimal: string, currency: string): number {
  const e = exponentOf(currency);
  const neg = decimal.startsWith("-");
  const body = neg ? decimal.slice(1) : decimal;
  const [whole = "0", frac = ""] = body.split(".");
  const kept = (frac + "0".repeat(e)).slice(0, e);
  const rest = frac.slice(e); // digits beyond the currency's exponent
  let value = BigInt(whole) * 10n ** BigInt(e) + BigInt(kept === "" ? "0" : kept);
  if (rest.length > 0 && /[1-9]/.test(rest)) {
    const half = "5" + "0".repeat(Math.max(0, rest.length - 1));
    const cmp = BigInt(rest) - BigInt(half);
    if (cmp > 0n) value += 1n;
    else if (cmp === 0n && value % 2n === 1n) value += 1n;
  }
  const out = Number(value);
  return neg ? -out : out;
}

// Fiscal period: 2024-Q1 in a fixed UTC+05:30 zone.
const OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const LOW = Date.UTC(2024, 0, 1) - OFFSET_MS; // 2023-12-31T18:30:00Z
const HIGH = Date.UTC(2024, 3, 1) - OFFSET_MS; // 2024-03-31T18:30:00Z
const inPeriod = (utc: string) => {
  const t = Date.parse(utc);
  return t >= LOW && t < HIGH;
};

interface Row {
  txId: string;
  postedAt: string;
  currency: string;
  signed: number; // minor units, debit positive (src/entries.ts signedAmount)
  reversalOf: string | null;
}

// ---- book A: CSV, decimal major units, explicit direction ----
const csvLines = readFileSync(`${DATA}books-a.csv`, "utf8").trim().split("\n");
const header = csvLines[0]!.split(",");
const rawA: (Row & { amount: string })[] = csvLines.slice(1).map((line) => {
  const cells = line.split(",");
  const get = (name: string) => cells[header.indexOf(name)]!;
  const amount = get("amount");
  const currency = get("currency");
  const magnitude = toMinor(amount, currency);
  return {
    txId: get("txId"),
    postedAt: get("postedAt"),
    currency,
    amount,
    signed: get("direction") === "debit" ? magnitude : -magnitude,
    reversalOf: get("reversalOf") === "" ? null : get("reversalOf"),
  };
});

// ---- book B: JSONL, minor units, sign inverted (positive = credit) ----
const rawB: Row[] = readFileSync(`${DATA}books-b.jsonl`, "utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const o = JSON.parse(line);
    return {
      txId: o.txId,
      postedAt: o.postedAtUtc,
      currency: o.currency,
      signed: -o.amountMinor,
      reversalOf: o.reversalOf,
    };
  });

// ---- step 1: period filter ----
const perA = rawA.filter((r) => inPeriod(r.postedAt));
const perB = rawB.filter((r) => inPeriod(r.postedAt));

// ---- step 2: collapse repeated ids within a book (sum the signed amounts) ----
function collapse(rows: Row[]): Map<string, Row> {
  const out = new Map<string, Row>();
  for (const r of rows) {
    const prev = out.get(r.txId);
    if (prev === undefined) out.set(r.txId, { ...r });
    else prev.signed += r.signed;
  }
  return out;
}
const colA = collapse(perA);
const colB = collapse(perB);

// ---- step 3: net reversal pairs ----
function net(rows: Map<string, Row>): number {
  let pairs = 0;
  for (const [id, row] of [...rows]) {
    if (row.reversalOf === null) continue;
    const orig = rows.get(row.reversalOf);
    if (orig === undefined) continue;
    if (orig.currency !== row.currency) continue;
    if (orig.signed + row.signed !== 0) continue;
    rows.delete(id);
    rows.delete(row.reversalOf);
    pairs += 1;
  }
  return pairs;
}
const pairsA = net(colA);
const pairsB = net(colB);

// ---- step 4: match and compare ----
const idsA = [...colA.keys()].sort();
const idsB = [...colB.keys()].sort();
const onlyA = idsA.filter((id) => !colB.has(id));
const onlyB = idsB.filter((id) => !colA.has(id));

const MATERIALITY = 5;
const diffs: { id: string; diff: number }[] = [];
let currencyMismatchId = "";
for (const id of idsA) {
  const ra = colA.get(id)!;
  const rb = colB.get(id);
  if (rb === undefined) continue;
  let signedA = ra.signed;
  if (ra.currency !== rb.currency) {
    currencyMismatchId = id;
    // Book B is authoritative on currency: re-express A's decimal amount
    // with B's exponent.
    const original = rawA.find((r) => r.txId === id)!;
    const magnitude = toMinor(original.amount, rb.currency);
    signedA = ra.signed >= 0 ? magnitude : -magnitude;
  }
  const diff = signedA - rb.signed;
  if (Math.abs(diff) > MATERIALITY) diffs.push({ id, diff });
}
diffs.sort((x, y) =>
  Math.abs(y.diff) - Math.abs(x.diff) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
);

const answer = {
  entriesInPeriodA: colA.size,
  entriesInPeriodB: colB.size,
  netReversalPairs: pairsA + pairsB,
  unmatchedIdsOnlyInA: onlyA,
  unmatchedIdsOnlyInB: onlyB,
  materialDifferenceCount: diffs.length,
  largestMaterialDifferenceId: diffs[0]!.id,
  totalDifferenceMinorUnits: diffs.reduce((s, d) => s + d.diff, 0),
  currencyMismatchId,
};

console.log(JSON.stringify(answer, null, 2));
console.log("--- material differences ---");
for (const d of diffs) console.log(`${d.id}\t${d.diff}`);
