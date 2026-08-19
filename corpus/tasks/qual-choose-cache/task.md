# Choose between two competing cache implementations

This repository is a geospatial tile and feature service written in Go. Over time it acquired
**two implementations of the same cache interface**, written by different people and both still
wired into the running service. Carrying both is no longer worth it, and exactly one of the two
contains a real defect: a bug that is present in the code as committed, that the repository's own
test suite does not catch, and that would eventually hurt a production deployment.

Your job is to read the code and decide which implementation to keep, which to delete, and to
describe the defect in the one you are dropping precisely enough that someone else could confirm
it without your help.

## Constraints

- **Do not modify the repository.** Do not edit, add, delete, move or reformat any file that is
  already here. This is a read-only investigation, and the working tree is checked afterwards.
- The single artifact you produce is a file named `answer.json` in the root of the repository.
- Do not fix the defect. Only report it.

## The answer file

`answer.json` must be a JSON object with exactly these nine keys and no others:

```json
{
  "interfaceName": "<exact name of the interface that both implementations satisfy>",
  "recommended": "<exact Go type name of the implementation to keep>",
  "rejected": "<exact Go type name of the implementation to drop>",
  "defectFile": "<repository-relative path of the file that contains the defect>",
  "defectSymbol": "<exact name of the function or method whose body contains the defect>",
  "defectKind": "<one of the permitted values listed below>",
  "defectTriggerKeys": 0,
  "callersToUpdate": ["<repository-relative paths>"],
  "notes": "<free prose explaining the defect; not scored>"
}
```

Rules for each key:

- `interfaceName`, `recommended` and `rejected` are Go identifiers spelled exactly as they appear
  in the source, without a package qualifier and without a leading `*`.
- `recommended` is the implementation that should survive **unchanged**; `rejected` is the one that
  carries the defect.
- `defectFile` is a path relative to the repository root, using forward slashes.
- `defectSymbol` names the single function or method whose body is missing or mis-performing the
  work that causes the defect. Give the bare identifier, without a receiver and without
  parentheses.
- `defectKind` must be exactly one of these strings:

  ```
  unbounded-growth
  data-race
  stale-read
  lost-entry
  double-free
  deadlock
  ```

- `defectTriggerKeys` is an integer, derived as follows. Construct the rejected implementation
  with the capacity that the repository's configuration defaults give the feature cache. Then
  insert distinct keys into it one at a time — every key inserted exactly once, no key ever read
  back, nothing ever invalidated or purged. `defectTriggerKeys` is the number of keys that have
  been inserted at the moment the defect first manifests, that is, the ordinal position of the
  insertion during which the implementation first does the wrong thing. Exactly one integer is
  correct.
- `callersToUpdate` lists the repository-relative path of **every file that calls the constructor
  of the rejected implementation**, excluding the file that defines that constructor and excluding
  test files. Order does not matter.
- `notes` is free prose and is not graded; write whatever justification you like.
