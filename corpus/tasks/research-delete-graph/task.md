# Impact of deleting a module

This repository is an in-memory task queue with a dependency graph, a scheduler, plugins and
snapshot serialisation. Someone has proposed deleting `src/graph.ts` outright.

Work out exactly what that would break.

When you are finished, the repository's own source and test files must be left exactly as you
found them. If you experiment, do it somewhere else or undo it.

Write a file named `answer.json` in the root of this repository, with exactly these three keys and
nothing else:

```json
{
  "directImporters": ["<repository-relative paths of the files that import src/graph.ts directly>"],
  "importedSymbols": ["<every symbol imported from src/graph.ts anywhere else in src/>"],
  "failingTestFiles": ["<repository-relative paths of the test files that would fail if src/graph.ts were deleted>"]
}
```

Rules for the answer:

- `directImporters` covers files under `src/` only. Order does not matter.
- `importedSymbols` is the de-duplicated union of the symbol names imported from `src/graph.ts`
  by files under `src/`, including type-only imports. Use the names as exported by `src/graph.ts`.
- `failingTestFiles` lists the files under `tests/` that would stop passing, whether they fail by
  assertion or by failing to resolve an import.
- Use exact identifiers and exact repository-relative paths.
