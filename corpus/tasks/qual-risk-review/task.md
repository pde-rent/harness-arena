# Review a proposed change and report the risk in it

This repository is an event-ingestion pipeline. A colleague has proposed a change to it and has
written it up in `PROPOSAL.md` at the root of the repository. The change has **not** been applied:
`src/` still holds the current, shipping code, and the modified copies of the files the proposal
would change are in `proposed/`, laid out under the same relative paths they would occupy in
`src/`. Read both and compare them.

Exactly one of the proposed files contains a real defect. The defect is reachable through normal
operation of the pipeline; it is not a type error, a style problem or a hypothetical. Your job is
to find it, say where it lives, and say what it breaks.

## Constraints

- Do not modify or delete any file in this repository. This is a read-only review. In particular,
  do not edit `src/`, `tests/`, `proposed/` or `PROPOSAL.md`, and do not apply the proposal.
- The only artifact you produce is a new file `answer.json` in the root of the repository.
- Base the answer on reading the code. Every value asked for below is derivable from the source
  text of this repository.

## The artifact

Write `answer.json` in the root of the repository with exactly these nine keys and nothing else:

```json
{
  "verdict": "<one of: accept | accept-with-changes | reject>",
  "riskFile": "<repository-relative path of the file in proposed/ that contains the defect>",
  "riskSymbol": "<exact name, as spelled in the source, of the function in that file where the defect lives>",
  "riskKind": "<one of: cached-failure | dropped-metric | skipped-validation | batch-abort | lost-error | double-count>",
  "affectedEventKinds": ["<exact event kind strings, as spelled in the source, whose processing the defect can change>"],
  "existingTestsCatchIt": true,
  "correctlyHandledFile": "<repository-relative path of the other file in proposed/ that applies the same idea without the defect>",
  "falsifiedClaim": "<exact label, such as C1, of the one claim in the Safety argument section of PROPOSAL.md that the defect makes false>",
  "notes": "<free prose: how you reached the conclusion. Not scored.>"
}
```

Rules for the answer:

- `verdict` uses exactly one of these three values, with these meanings:
  - `accept` — the proposal contains no defect and can be applied as written.
  - `accept-with-changes` — the approach is sound and worth taking, but the proposal as written
    contains at least one defect that must be corrected before it is applied.
  - `reject` — the approach itself is unsound and cannot be corrected without abandoning it.
- `riskFile` and `correctlyHandledFile` are paths inside `proposed/`, written relative to the
  repository root, for example `proposed/src/some/file.ts`.
- `riskSymbol` is a bare identifier, with no parentheses, no file prefix and no arguments.
- `riskKind` uses exactly one of the six listed values and no other string.
- `affectedEventKinds` lists the event kind strings exactly as they are spelled in the source of
  this repository. Include only kinds whose processing the defect can actually change. Order does
  not matter.
- `existingTestsCatchIt` is `true` only if running the repository's existing test suite, unchanged,
  against the proposal would report a failure caused by this defect; otherwise `false`.
- `falsifiedClaim` is one of the claim labels used in `PROPOSAL.md`, given exactly as written there
  (for example `C1`). Exactly one claim in that list is made false by the defect.
- `notes` is free prose and is not scored, but the key must be present.
