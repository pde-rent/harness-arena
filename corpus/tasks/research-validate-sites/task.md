# Attribute every validation call to its enclosing function

This repository is a geospatial tile and feature service. Three different types each declare a
method named exactly `Validate`, and those three methods are invoked from several packages. The
call text looks the same everywhere, so which of the three is actually being run at a given call
site is decided by the type of the value it is called on, not by the line itself.

Map that out.

## Constraints

- **Do not modify anything that is already in the repository.** This is a read-only investigation
  and the source tree is compared afterwards.
- The single artifact you produce is a file named `answer.json` in the root of the repository.

## Scope

Consider every call whose selector is the identifier `Validate`, spelled exactly like that, that
appears anywhere in the repository outside files whose name ends in `_test.go`. Do not include the
declarations of the `Validate` methods themselves, and do not include calls to any other
identifier — a differently spelled method is out of scope even if it does similar work.

## How to name things

- Name the **enclosing function** as `<package directory>/<Name>`, where `<package directory>` is
  the directory holding the file, relative to the repository root, and `<Name>` is `Func` for a
  plain function or `Type.Method` for a method, with the receiver's type written without a leading
  `*`. Examples of the spelling: `geom/Haversine`, `index/RTree.Insert`, `cmd/geosvcd/run`. The
  enclosing function is the innermost named function or method that lexically contains the call.
- Name the **receiver type** as `<package name>.<TypeName>`, always qualified with the name of the
  package that declares the type — including when the call site is inside that same package — and
  always without a leading `*`, whether the value is a pointer or not. For example, a call on a
  value of type `*store.Feature` is reported as `store.Feature`.

## The answer file

`answer.json` must be a JSON object with exactly these four keys and no others:

```json
{
  "callSites": [
    {
      "file": "<repository-relative path of the file containing the call>",
      "enclosing": "<enclosing function, named as above>",
      "receiverType": "<receiver type, named as above>",
      "propagatesUnchanged": true
    }
  ],
  "receiverTypes": ["<the distinct receiver type names>"],
  "delegatingMutators": ["<method names>"],
  "notes": "<free prose; not scored>"
}
```

- `callSites` has exactly one entry per call in scope. Order does not matter.
- `propagatesUnchanged` is `true` only when the enclosing function, on the branch it takes if that
  `Validate` call reports a problem, returns the value it got back from `Validate` itself, with no
  wrapping, no reformatting and no substitution. If the branch returns anything derived from it or
  built around it instead, the value is `false`.
- `receiverTypes` is the deduplicated set of `receiverType` values across `callSites`. Order does
  not matter.
- `delegatingMutators` lists the **bare method names** — no package, no receiver type, for example
  `Insert` — of the exported methods of `store.MemStore` that can add a feature to the store or
  replace one already in it, and whose **own body** contains no call whose selector is the
  identifier `Validate`. Judge only the statements written directly in that method's body; a call
  that some other function it invokes performs does not count. Methods that only remove features,
  or that never change stored features at all, are out of scope. Order does not matter.
- `notes` is free prose and is not graded.
