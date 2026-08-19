# A malformed amount in the CSV export

This repository is a double-entry accounting ledger library. Its test suite currently passes.

A downstream system that consumes our CSV export has started rejecting rows. The rows it rejects
all involve amounts smaller than one major unit: where it expects a field like `0.05`, our export
writes `.05`. Larger amounts are fine, and the same defect shows up anywhere a monetary value is
rendered for a human, not only in the CSV export.

Find the root cause and fix it, so that a monetary value smaller than one major unit is rendered
with its leading zero, for every currency, positive or negative.

Constraints:

- Fix the root cause once, in the place where the defect actually lives. Do not paper over it at
  each call site.
- Do not change the public API: the exported names and their signatures must stay as they are.
- The existing tests must still pass, and so must the behaviour they describe: grouping
  separators, currency suffixes, currencies with 0, 2 and 3 decimal places, and negative amounts.
