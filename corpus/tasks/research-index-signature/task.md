# Cost out a change to the index interface

This repository is a geospatial tile and feature service. The `index` package declares an
interface named `Index` that two implementations satisfy, and the rest of the service talks to
whichever one configuration selected.

A change to that interface has been proposed. Nobody has written a line of it yet. Your job is to
say, before anyone starts, exactly what it would touch — and, just as importantly, what it would
quietly change without touching.

## The proposed change

Two methods of the `Index` interface get a new final `error` result:

- `Search(b geom.BBox) []Entry` becomes `Search(b geom.BBox) ([]Entry, error)`
- `Remove(id string) bool` becomes `Remove(id string) (bool, error)`

Nothing else about the interface changes. No other type, function or method in the repository is
being redesigned at the same time.

Assume this about how the change would be carried out, and assume nothing beyond it:

- Every implementation of `Index` is updated to the new signatures.
- A function that now receives an error it cannot deal with on the spot passes it on by adding a
  final `error` result to its own signature — unless it already returns an `error`, in which case
  it reuses that one and its signature is unchanged.
- A call whose results were already being discarded is **left exactly as written**. Nobody goes
  looking for extra places to improve while making this change.

## Constraints

- **Do not modify anything that is already in the repository.** Do not carry out the change. This
  is a read-only estimate and the source tree is compared afterwards.
- The single artifact you produce is a file named `answer.json` in the root of the repository.
- Ignore files whose name ends in `_test.go` entirely.

## How to name things

Name every item as `<package directory>/<Name>`, where `<package directory>` is the directory
holding the file that declares it, relative to the repository root, and `<Name>` is:

- `Func` for a plain function,
- `Type.Method` for a method, with the receiver's type written without a leading `*`, or
- `Type` for a type declaration.

Examples of the spelling: `geom/Haversine`, `index/RTree.Insert`, `index/Entry`, `cmd/geosvcd/run`.

## The answer file

`answer.json` must be a JSON object with exactly these four keys and no others:

```json
{
  "compileBreaking": ["<item names>"],
  "behaviourOnly": ["<item names>"],
  "packagesAffected": ["<package directories>"],
  "notes": "<free prose; not scored>"
}
```

- `compileBreaking` is every item whose own declaration or body has to be edited because the
  repository would otherwise no longer compile. An item belongs here only if leaving it exactly as
  written is not an option. Order does not matter.
- `behaviourOnly` is every item that still compiles without any edit, and that nobody edits, but
  whose behaviour changes anyway because a call it makes now hands back a value it never looks at.
  Nothing may appear in both lists. Order does not matter.
- `packagesAffected` is the deduplicated set of `<package directory>` values appearing in either
  list. Order does not matter.
- `notes` is free prose and is not graded.
