# Spec: scheduled revenue recognition

Owner: Finance Platform
Status: proposed, ready for implementation

## Background

We invoice a customer once but earn the revenue over several months. Today the whole invoice is
booked as income the day it is raised. We want a *recognition schedule*: one invoice, split across
several periods, with each period's share booked when that period is reached.

This is a new feature. It is to be built as a new module in this repository on top of the existing
money, entry, transaction and journal code. It must not change the behaviour of anything already
exported.

## Definitions

- A **period key** is a string of the form `YYYY-MM`.
- A **schedule** pairs one invoice total (a `Money` value) with a list of `(period key, weight)`
  rows, in the order the periods are to be recognised.
- A **part** is the amount of the total assigned to one row of the schedule.
- The **receivable account** and the **revenue account** are two account codes supplied with the
  schedule.

## Requirements

**R1 — Schedule validation.** A schedule is accepted only if it has at least two rows, every
period key matches `YYYY-MM`, every period key is distinct, every weight is a positive integer, and
no row's part would come out as zero minor units. A schedule failing any of these is rejected with
an error. It follows that in an accepted schedule every part is at least one minor unit, and
therefore that no single part is equal to the invoice total.

**R2 — Exact split.** The parts are derived from the invoice total and the weights, in minor units,
so that the parts sum back to the invoice total exactly, for every accepted schedule. No minor unit
may be created or lost by the split.

**R3 — Balanced posting.** Every transaction this feature produces is posted through the journal's
post operation, and no transaction that fails the ledger's balance rule — total debits equal to
total credits — is ever posted. The feature introduces no new way to get an unbalanced transaction
into the journal.

**R4 — Schedule listing.** The feature exposes a listing of an accepted schedule's rows — period
key, weight and part — ordered by period key ascending, the ordering being stable with respect to
the input order. The listing is derived from the schedule alone and reads nothing from the
journal.

**R5 — Recognition report.** For a given schedule the feature produces a report with one line per
period, showing the amount recognised in that period, read back from the entries of the
transactions described in R6 and R7 rather than recomputed from the weights.

**R6 — Opening posting.** At the moment a schedule is accepted, the feature posts one transaction,
dated in the schedule's first period, containing exactly two entries: a debit to the receivable
account for the full invoice total, and a credit to the revenue account for the first period's part
only. The deferred remainder — the total minus the first period's part — must not appear as an
entry in this transaction, in any account, under any description. Later periods are posted as
separate transactions when they are reached.

**R7 — Cancellation.** Cancelling a schedule posts a reversing transaction whose entries are the
exact mirror of the entries of the opening transaction described in R6: the same accounts, the same
amounts, the opposite directions.

## Out of scope

Multi-currency schedules, mid-schedule amendments, and any change to the CSV export.
