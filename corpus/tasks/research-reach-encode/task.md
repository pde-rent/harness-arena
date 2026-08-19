# Which code can reach the append-log encoder

This repository is a geospatial tile and feature service. One function, `EncodeFeature` in the
`store` package, turns a feature into the bytes that are written to the append log. It is called
from exactly one place, but the code that can *end up* calling it is spread over several packages
and reaches it through several layers of indirection.

Work out the whole set, and then work out which single functions the paths from the HTTP layer all
have to pass through.

## Constraints

- **Do not modify anything that is already in the repository.** This is a read-only investigation
  and the source tree is compared afterwards.
- The single artifact you produce is a file named `answer.json` in the root of the repository.

## How to name a function

Everywhere below, name a function or method as `<package directory>/<Name>`:

- `<package directory>` is the directory holding the file that defines it, relative to the
  repository root, with forward slashes.
- `<Name>` is `Func` for a plain function, or `Type.Method` for a method, with the receiver's type
  written **without** a leading `*`.

Examples of the spelling: `geom/Haversine`, `index/RTree.Insert`, `cmd/geosvcd/run`.

## What counts as a call edge

Say that **A calls B** exactly when one of these holds. Nothing else is an edge.

1. A's body contains a direct call to B, where B is a function or method defined in this
   repository. A call written inside a function literal counts as a call by the function that
   lexically contains that literal. Deferred calls and calls started in a new goroutine count.
2. A's body contains a call to a method through a value whose type is an **interface declared in
   this repository**. That call is an edge to that method on **every** type defined in this
   repository that implements that interface.

And these are explicitly **not** edges:

- A call through an interface declared outside this repository.
- A call to anything defined outside this repository.
- Naming a function without calling it — passing it as an argument, assigning it to a variable or
  a struct field, or registering it as a handler.

Files whose name ends in `_test.go` are ignored completely: never as the source of an edge, never
as the target, and never in any answer below.

**A can reach B** when there is a chain of one or more call edges from A to B.

## The answer file

`answer.json` must be a JSON object with exactly these four keys and no others:

```json
{
  "reachers": ["<function names>"],
  "reachingPackages": ["<package directories>"],
  "cutFunctions": ["<function names>"],
  "notes": "<free prose; not scored>"
}
```

- `reachers` is every function or method in this repository, other than `store/EncodeFeature`
  itself, that can reach `store/EncodeFeature`. Order does not matter. Spell each one using the
  naming rule above.
- `reachingPackages` is the deduplicated set of `<package directory>` values appearing in
  `reachers`. Order does not matter.
- `cutFunctions` is every function or method `X` — excluding `httpapi/Router.handleFeature` and
  `store/EncodeFeature` themselves — with this property: if `X` and all of its call edges are
  deleted from the graph, then `httpapi/Router.handleFeature` can no longer reach
  `store/EncodeFeature`. Each candidate is removed **on its own**, never in combination with
  another. Order does not matter.
- `notes` is free prose and is not graded.
