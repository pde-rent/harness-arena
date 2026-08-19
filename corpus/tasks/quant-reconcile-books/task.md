# Reconcile the 2024-Q1 books

This repository is a double-entry accounting library. Two systems recorded the same quarter, and
their exports are committed under `data/`:

- `data/books-a.csv` — the general ledger export.
- `data/books-b.jsonl` — the settlement gateway export.
- `data/POLICY.md` — the reconciliation policy. It is the authority on how the two are compared.

The policy states several of its rules by naming functions in `src/`: the currency exponent, the
rounding rule for sub-unit amounts and the debit/credit sign convention are all defined by this
repository's own code. Read that code and apply exactly what it does. Do not assume two decimal
places, do not assume half-up rounding, and do not assume the two exports share a sign convention.

The data contains deliberate traps. Among them: rows that sit exactly on the period boundary once
the policy's fixed zone offset is applied, a reversal that has no counterpart, an id that appears
on more than one row of the same book, a difference that sits exactly on the materiality
threshold, and a matched id where the two books disagree about the currency.

## What to produce

This is a **read-only** investigation. Do not create, modify, move or delete any file other than
the answer file. Leave `src/`, `tests/` and `data/` exactly as you found them.

Write a file named `answer.json` in the root of this repository, containing exactly these ten keys
and nothing else:

```json
{
  "entriesInPeriodA": 0,
  "entriesInPeriodB": 0,
  "netReversalPairs": 0,
  "unmatchedIdsOnlyInA": ["TX-0000"],
  "unmatchedIdsOnlyInB": ["TX-0000"],
  "materialDifferenceCount": 0,
  "largestMaterialDifferenceId": "TX-0000",
  "totalDifferenceMinorUnits": 0,
  "currencyMismatchId": "TX-0000",
  "notes": "free prose"
}
```

Key by key:

- `entriesInPeriodA` — how many transactions book A contributes to the reconciliation, that is,
  the number of distinct `txId` values left in book A after the period filter, the collapse of
  repeated ids and the netting of reversal pairs described in the policy.
- `entriesInPeriodB` — the same count for book B.
- `netReversalPairs` — how many reversal pairs were removed in total, counting book A and book B
  separately. A pair found in each book counts as two.
- `unmatchedIdsOnlyInA` — every `txId` that survives into book A's set but is absent from book B's.
  An array of ids spelled exactly as they appear in the data. Array order is not graded. Use `[]`
  if there are none.
- `unmatchedIdsOnlyInB` — the same, the other way round.
- `materialDifferenceCount` — how many matched ids have a material difference, as the policy
  defines material.
- `largestMaterialDifferenceId` — the `txId` of the material difference with the greatest absolute
  value. If two are tied, give the lexicographically smallest id.
- `totalDifferenceMinorUnits` — the exact signed integer sum, in minor units, of the differences
  of the material differences only. Immaterial differences contribute nothing. This is an integer,
  not a decimal.
- `currencyMismatchId` — the `txId` of the single matched transaction where the two books record
  different currencies.
- `notes` — free prose, a few sentences on how you handled the boundary cases. This key is not
  graded; it just has to be present.

Every number must be an exact integer. Every id must be spelled exactly as it is spelled in the
data files.
