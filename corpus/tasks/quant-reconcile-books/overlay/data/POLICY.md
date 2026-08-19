# Quarter-close reconciliation policy — 2024-Q1

Two systems recorded the same quarter. `books-a.csv` is the export from the general ledger front
end; `books-b.jsonl` is the export from the settlement gateway. This document is the authority on
how the two are reconciled. Where it says "the same rule as `X` in `src/…`", it means exactly the
behaviour of that function in this repository's source — read it, do not assume.

## 1. Row shapes

`books-a.csv` has a header row and the columns
`txId,postedAt,account,direction,amount,currency,reversalOf,description`.

- `postedAt` is an instant in UTC.
- `amount` is a **non-negative decimal string in major units**. `direction` is `debit` or `credit`.
- `reversalOf` is empty, or the `txId` this row reverses.
- No field of this export ever contains a comma or a quote.

`books-b.jsonl` has one JSON object per line with the fields
`txId`, `postedAtUtc`, `account`, `amountMinor`, `currency`, `reversalOf`, `note`.

- `postedAtUtc` is an instant in UTC.
- `amountMinor` is an **integer number of minor units**.
- `reversalOf` is `null`, or the `txId` this row reverses.

## 2. Signed amounts

Both books are normalised to one signed integer of **minor units** per row, under the convention
used by `signedAmount` in `src/entries.ts`: **a debit is positive and a credit is negative**.

- Book A: convert `amount` from major to minor units (§3), then apply the sign that `direction`
  implies.
- Book B: the settlement gateway writes the **opposite** sign convention — in `amountMinor`, a
  positive number is a credit and a negative number is a debit. The signed amount of a book-B row
  is therefore the negation of `amountMinor`.

## 3. Major units to minor units, and rounding

The number of minor units in one major unit is decided by the currency, exactly as
`currencyExponent` in `src/money.ts` decides it. Do not assume every currency has two decimal
places.

A book-A `amount` may carry more decimal places than its currency's exponent allows. Scale the
decimal value by the currency's exponent and round the result to a whole number of minor units
using the same rule as `roundHalfEven` in `src/money.ts` — a value exactly halfway between two
integers goes to the **even** one. Do the arithmetic exactly on the decimal digits; binary
floating point is not accurate enough to decide the halfway cases in this data.

Book-B amounts are already whole minor units and are never rounded.

## 4. The fiscal period

The fiscal quarter is **2024-Q1** measured in the company's fiscal zone, which is a **fixed offset
of UTC+05:30** all year. There is no daylight saving and no dependence on any current date.

A row is **in period** when its instant, shifted into the fiscal zone, falls in
`2024-01-01T00:00:00` inclusive through `2024-04-01T00:00:00` exclusive. Rows outside the period
are discarded before anything else happens, and take no further part in the reconciliation — they
are neither counted, nor matched, nor reported as unmatched.

## 5. Order of operations

Apply these steps in this order, to each book independently, before the two are compared.

1. **Period filter** (§4). Discard every out-of-period row.
2. **Collapse repeats.** If the same `txId` still appears on more than one row of the *same* book,
   those rows are one transaction that the system split across several postings. Collapse them
   into a single transaction whose signed amount is the **exact integer sum** of the rows' signed
   amounts. The collapsed transaction counts as one entry.
3. **Net reversals.** A row R whose `reversalOf` names a transaction X that is present in the
   **same** book after steps 1 and 2, in the same currency, and whose signed amount is exactly the
   negation of X's signed amount, forms a **reversal pair** with X. Both R and X are removed from
   that book and take no further part: they are not entries, they are not matched, and they are
   never reported as unmatched. A row whose `reversalOf` names a transaction that is not present
   in the same book after steps 1 and 2 is **not** a reversal — it is an ordinary transaction and
   stays.

After step 3, each book holds a set of transactions keyed by `txId`, one per id.

## 6. Matching and comparison

A `txId` present in both books is **matched**. A `txId` present in only one of them is
**unmatched** and is reported against the book that has it.

For a matched id, the **difference** is

```
difference = signed amount in book A  -  signed amount in book B
```

in minor units, as an exact integer.

**Currency disagreement.** If the two books record different currencies for the same matched
`txId`, **book B is authoritative on currency**. Recompute book A's signed amount from its
original decimal `amount` string using book B's currency under §3, keeping book A's direction,
and take the difference against book B as usual.

**Materiality.** A difference whose absolute value is **5 minor units or fewer** is immaterial:
it is ignored entirely, contributes nothing to any total, and is not counted as a difference. A
difference whose absolute value is 6 minor units or more is **material**.

Every material difference in this data is in the same currency, so material differences are summed
as plain integers of minor units, signed, with no currency conversion of any kind.
