# Plan capacity-bounded execution waves over a task dependency graph

This repository is an in-memory task queue library with a dependency graph, priorities and a
scheduler. Its test suite currently passes.

Add a **wave planner**: given a set of tasks with dependencies, priorities and integer costs,
split them into a numbered sequence of *waves*. Everything in wave 1 may start immediately;
everything in wave *n* may start once every wave before it has finished.

Create a new file `src/waves.ts` and re-export its public names from `src/index.ts`. The module
must be self-contained: no new dependencies, no timers, no clock, no randomness, no floating-point
arithmetic in any cost or level computation. It does not have to use the existing
`DependencyGraph`; it is free to build its own structures.

## Required exports

```ts
export class WavePlanError extends Error {
  readonly code: string;
}

export interface WaveTaskSpec {
  id: string;
  priority: number;
  cost: number;
  deps?: readonly string[];
}

export interface WavePlanOptions {
  capacity: number;
}

export interface WaveAssignment {
  wave: number;      // 1-based
  tasks: string[];   // ids, in the order described under "Wave contents"
  cost: number;      // exact integer sum of the costs of `tasks`
}

export interface WavePlan {
  waves: WaveAssignment[];
  components: string[][];
  levels: Record<string, number>;
  totalCost: number;
}

export function planWaves(
  tasks: readonly WaveTaskSpec[],
  options: WavePlanOptions,
): WavePlan;
```

`WavePlanError` must set `name` to `"WavePlanError"` and carry a `code` property.

An entry in `deps` names the id of a task that must run **no later than** this task. Read every
edge as *dependency → dependent*.

## Validation

`capacity` is checked first: it must be an integer of at least 1, otherwise throw `WavePlanError`
with code `"BAD_CAPACITY"`. Then each task, in the order given, is checked in this order:

| condition | code |
|---|---|
| `id` is not a non-empty string | `"BAD_ID"` |
| `priority` is not an integer (any sign is fine) | `"BAD_PRIORITY"` |
| `cost` is not an integer of at least 1 | `"BAD_COST"` |
| `id` equals the id of an earlier task in the list | `"DUPLICATE_ID"` |

Once every task is known, each entry of every `deps` array is resolved; an entry that names no
task in the list throws `WavePlanError` with code `"UNKNOWN_DEP"`. A `deps` array that lists the
same id more than once is legal and the repeats are ignored. A missing `deps` is the same as `[]`.

An empty task list returns `{ waves: [], components: [], levels: {}, totalCost: 0 }`.

## Step 1 — condense cycles

Cycles are **legal input** and must never be rejected. A task may depend on itself, and two tasks
may depend on each other. Compute the **strongly connected components** of the dependency graph.
Every SCC is scheduled as one atomic unit: all of its members land in the same wave and carry the
same level. A task with no cycle through it is an SCC of one.

The **cost of a component** is the exact integer sum of the costs of its members. The **priority
of a component** is the maximum priority among its members. The **key of a component** is the
lexicographically smallest of its member ids (plain `<` on the strings; ids are unique, so keys
are unique).

## Step 2 — assign a level by longest path

Levels are assigned over the condensation — the acyclic graph whose nodes are the components —
using the longest-path recurrence:

> `level(C) = 1` if `C` has no predecessor component, otherwise
> `level(C) = 1 + max{ level(P) : P is a predecessor component of C }`.

Dependencies **inside** a component are ignored here; only edges that leave one component and
enter another count.

This is **not** the same as a breadth-first layering that takes `1 + min` over predecessors, and
the difference is not cosmetic. Worked example — three tasks, `B` depends on `A`, and `C` depends
on both `A` and `B`:

- A breadth-first layering reaches `C` directly from `A` and assigns `A = 1`, `B = 2`, `C = 2`.
  That is wrong: `C` depends on `B`, and `B` is in level 2.
- The longest-path recurrence gives `A = 1`, `B = 2`, `C = 1 + max(1, 2) = 3`, which is correct.

`levels` in the result maps **every task id** to the level of the component it belongs to.

## Step 3 — pack the waves under a capacity bound

A wave may hold at most `capacity` units of cost. Because a level may hold more work than a wave
can carry, some components are pushed into later waves, and pushing a component **pushes
everything downstream of it** — the level from step 2 is a lower bound on a component's wave, not
its answer.

Process the components in this order, which is fully determined and is always a valid topological
order of the condensation:

1. level ascending,
2. then component priority **descending**,
3. then component key ascending.

Maintain, for each wave that exists so far, its remaining capacity. For each component `C` in that
order:

- Its **earliest permissible wave** is `1` if `C` has no predecessor component, otherwise
  `1 + max{ assigned wave of P : P is a predecessor component of C }`. Note this uses the wave
  each predecessor was **actually assigned**, not the predecessor's level.
- If `cost(C) <= capacity`: place `C` in the **lowest-numbered** wave `w` with
  `w >= earliest` whose remaining capacity is at least `cost(C)`, creating a new wave at the end
  if no existing one qualifies. Subtract `cost(C)` from that wave's remaining capacity.
- If `cost(C) > capacity`: place `C` in the lowest-numbered wave `w` with `w >= earliest` that is
  currently **empty**, creating a new wave at the end if no existing one qualifies. That wave's
  remaining capacity becomes `0`, so it holds that component and nothing else.

The search always restarts at the earliest permissible wave, so a component **may and must**
backfill room left in an earlier wave even when later waves already hold work. Worked example —
capacity 5, no dependencies except `X` on `P2`:

| id | priority | cost | deps |
|---|---|---|---|
| `P1` | 9 | 4 | — |
| `P2` | 8 | 3 | — |
| `P3` | 7 | 1 | — |
| `P4` | 6 | 3 | — |
| `X` | 5 | 1 | `P2` |

`P1` takes wave 1 (1 unit left). `P2` does not fit in wave 1, so it opens wave 2. `P3` fits in the
1 unit still free in wave 1, so it backfills there rather than joining wave 2. `P4` fits in
neither and opens wave 3. `X` has level 2, but `P2` was assigned wave 2, so `X`'s earliest
permissible wave is 3 and it joins `P4` in wave 3. The result is
wave 1 `["P1","P3"]` cost 5, wave 2 `["P2"]` cost 3, wave 3 `["P4","X"]` cost 4.

These properties follow from the rules and must hold for every plan you produce:

- Wave numbers are contiguous from 1 and no wave is empty.
- Every task appears in exactly one wave.
- Every dependency of a task is in a **strictly earlier** wave, unless the two tasks share an SCC,
  in which case they are in the **same** wave.
- A wave's cost exceeds `capacity` only when that wave holds exactly one component and nothing else.

## Wave contents and result ordering

- `waves` is ordered by wave number, ascending, starting at 1.
- The `tasks` array of a wave holds every id assigned to it, sorted by **priority descending,
  then id ascending**.
- `cost` on a wave, and `totalCost`, are exact integers. No rounding is involved anywhere: every
  cost is an integer and only addition is used.
- `components` lists every SCC exactly once. Each inner array holds that component's member ids
  sorted **ascending by id**. The outer array is in the step-3 processing order: level ascending,
  then component priority descending, then component key ascending.
- `levels` maps every task id to its component's step-2 level.

Every rule above is total: for any legal input there is exactly one correct `WavePlan`, and it
does not depend on the order in which the tasks or their `deps` entries were listed. Planning the
same graph twice with the arrays permuted must produce an identical result.

## Complexity

The condensation and the level assignment together must run in **O(V + E)** time, where `V` is
the number of tasks and `E` the number of dependency edges. Repeated relaxation passes over the
edge set, or recomputing reachability per node, are too slow: the planner is expected to handle a
graph of tens of thousands of tasks and over a hundred thousand edges in well under a second.
Avoid unbounded recursion depth where it is easy to do so.

## Constraints

- No new dependencies; nothing outside the standard library.
- Do not change or remove any existing exported name or signature, and do not change any existing
  test. Only add.
- The whole suite under `tests/` must still pass when you are done.
