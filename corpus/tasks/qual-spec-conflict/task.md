# Assess a proposed specification against this ledger

This repository is a double-entry accounting library. A specification for a new feature has been
added at `SPEC.md` in the root of the repository. It has seven numbered requirements, `R1` to `R7`.

Before anyone writes the feature, decide whether the specification can be implemented as written
against this codebase. Two of its requirements cannot both hold, given an invariant this
repository already enforces. Find the pair, name the code that makes them irreconcilable, and say
which of the two must be relaxed for the rest of the specification to become implementable.

## Constraints

- Do not modify or delete any file in this repository. This is a read-only assessment. Do not
  implement the feature, and do not edit `SPEC.md`, `src/` or `tests/`.
- The only artifact you produce is a new file `answer.json` in the root of the repository.
- Base the answer on reading the code and the specification. Every value asked for below is
  derivable from the source text of this repository.

## Definitions used by the answer

- A requirement is **implementable as written** if it can be implemented exactly as it stands, in
  new code, without modifying any function already exported from `src/`, without changing the
  behaviour any existing test asserts, and without any other requirement of the specification
  having to be relaxed first.
- A requirement is **blocked by the conflict** otherwise. This includes both members of the
  conflicting pair themselves, and every requirement that cannot be implemented unless one member
  of that pair is relaxed.
- Every one of `R1` to `R7` falls into exactly one of those two groups.

## The artifact

Write `answer.json` in the root of the repository with exactly these nine keys and nothing else:

```json
{
  "satisfiable": true,
  "conflictingRequirements": ["<requirement label>", "<requirement label>"],
  "violatedInvariant": "<exact name, as spelled in the source, of the function in src/ that enforces the invariant by rejecting the offending input>",
  "invariantFile": "<repository-relative path of the file that function is defined in>",
  "violatedInvariantErrorCode": "<the exact error code string that function raises for this violation>",
  "requirementToRelax": "<requirement label>",
  "implementableAsWritten": ["<requirement label>"],
  "blockedByConflict": ["<requirement label>"],
  "notes": "<free prose: the argument for the conflict. Not scored.>"
}
```

Rules for the answer:

- `satisfiable` is `true` only if all seven requirements can hold at once as written; otherwise
  `false`.
- Requirement labels are written exactly as the specification writes them, for example `R1`.
- `conflictingRequirements` holds exactly two labels. Order does not matter.
- `violatedInvariant` is a bare identifier, with no parentheses, no file prefix and no arguments.
  It names the function that actually rejects the offending input, not a helper that merely reports
  on it.
- `violatedInvariantErrorCode` is the code string exactly as it appears in the source.
- `requirementToRelax` is the member of the conflicting pair that can be changed without altering
  the behaviour of anything already exported from `src/` — that is, the one that is not simply a
  restatement of a rule this repository already enforces.
- `implementableAsWritten` and `blockedByConflict` use the definitions given above. Together they
  contain each of `R1` to `R7` exactly once. Order does not matter within either list.
- `notes` is free prose and is not scored, but the key must be present.
