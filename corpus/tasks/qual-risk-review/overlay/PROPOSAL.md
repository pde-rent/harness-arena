# Proposal: memoise handler persistence so redeliveries are not written twice

Author: R. Okafor
Status: proposed, not yet applied

## Motivation

Upstream producers redeliver events. When the same audit event arrives twice inside one process
with the same record store, `persistAuditRecord` runs twice and writes two journal rows. The same
is true of trace spans: the same span id gets written again. We want the second delivery of an
identifier we have already persisted to be a no-op instead of a repeat write.

## What changed

Nothing in `src/` has been touched. The modified copies of the two files I want to change are in
`proposed/`, mirroring their real paths:

- `proposed/src/handlers/audit.ts`
- `proposed/src/handlers/trace.ts`

In both files I added a memo of the in-flight/completed persistence promise, held in a `WeakMap`
keyed on the record store instance, and consulted before starting a new `withRetry` sequence. The
audit memo key is `id:stage`; the trace memo key is the span key. Nothing else in either file
changed: the records built, the retry policies, the returned `HandlerOutput` shapes and the log
lines are all as they were.

## Safety argument

I believe the following claims hold for the proposal as written. Each is numbered so it can be
referred to individually.

- **C1** — The memo is keyed on the record store instance, so two pipelines that do not share a
  record store never share memo entries.
- **C2** — Within one record store, a second delivery of an audit identifier whose first delivery
  already succeeded is deduplicated: `persistAuditRecord` is not called a second time for it.
- **C3** — An amend is keyed separately from the original write, so the write-then-amend
  progression of a repeated audit event still produces two rows in the audit journal namespace.
- **C4** — If a persistence attempt ultimately fails, nothing is remembered about it, so a later
  delivery of the same identifier starts a fresh retry sequence against the store.
- **C5** — The trace half of the change forgets a span whose export ended in failure, so the next
  delivery of that span is exported again rather than being served from the memo.
- **C6** — The repository's existing test suite passes unchanged with the proposal applied.

## Why I think this is safe to merge

The dedupe only ever suppresses work we have already done successfully, the memo cannot outlive
the store it is keyed on, and the failure path is unchanged, so the blast radius is limited to
repeat deliveries.
