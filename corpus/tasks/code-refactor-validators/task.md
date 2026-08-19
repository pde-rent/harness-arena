# Consolidate the duplicated helpers in src/validate

This repository is an event-processing pipeline library. Its test suite currently passes.

The three validator modules — `src/validate/schema.ts`, `src/validate/limits.ts` and
`src/validate/identity.ts` — have drifted into carrying their own private copy of the same
helper code: issue construction, issue-code prefixing, body field lookup, and size/length
measurement. The three copies are near-identical, so every change to that logic currently has
to be made three times.

Remove that duplication: each piece of shared logic must end up defined in exactly one place
inside `src/validate/`, and each validator module must use that single definition instead of
its own copy.

Constraints:

- No behaviour change whatsoever. Every issue that is produced today must still be produced,
  with the same `code`, `field`, `message` and `severity`, in the same order, for the same
  inputs — including boundary cases and events that trigger several issues at once. The
  counters `runValidators` reports through its metrics sink must be unchanged too.
- The existing test suite must still pass, unmodified.
- The public API of `src/validate/index.ts` must not change: the same names must still be
  exported, holding the same kinds of values.
- The modules `src/validate/schema.ts`, `src/validate/limits.ts` and `src/validate/identity.ts`
  must remain importable at those paths and keep exporting the names other modules and the
  tests import from them.

Within those limits you are free: how the shared helpers are named, which file they live in,
and how the code inside `src/validate/` is organised are all up to you. Adding a new module
under `src/validate/` is fine.
