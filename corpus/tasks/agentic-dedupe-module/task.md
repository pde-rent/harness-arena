# Suppress duplicate event ids in the pipeline

This repository is an event-processing pipeline library. Its test suite currently passes.

Events arriving from upstream are occasionally redelivered, so the same event id can be processed
more than once. Add a bounded, in-memory duplicate-id window, wire it into the pipeline so a
redelivered event is not handed to a handler a second time, and cover the new module with a test
of your own.

There are three pieces of work, and all three are required.

## 1. A new module: `src/dedupe.ts`

Create `src/dedupe.ts`. It must be self-contained: no new dependencies, no imports from anywhere
else in this repository, no timers, no clock, no randomness. Its behaviour must be fully
deterministic.

It must export exactly this class, with these names and signatures:

```ts
export class DuplicateWindow {
  constructor(capacity: number);
  readonly capacity: number;
  get size(): number;
  record(id: string): boolean;
  has(id: string): boolean;
  clear(): void;
}
```

Required semantics:

- `record(id)` returns `true` if `id` is already being remembered by the window at the moment of
  the call, and `false` otherwise. Either way, after the call the window remembers `id` (subject
  to the capacity rules below). `record` is the only method that mutates membership.
- `has(id)` returns whether `id` is currently remembered. It never mutates anything.
- `size` is the number of ids currently remembered.
- `capacity` is the value the constructor was given, unchanged.
- The window is **insertion-ordered and bounded**. Once it is holding `capacity` ids, recording a
  new, not-yet-remembered id evicts the **oldest inserted** id first, so `size` never exceeds
  `capacity`. Example, capacity 2: record `a`, `b`, `c` → `a` has been evicted, `b` and `c` remain,
  and a subsequent `record("a")` returns `false`.
- Re-recording an id that is already remembered **does not change its insertion position** and
  does not change `size`. Example, capacity 2: record `a`, `b`, `a`, `c` → `a` is the oldest and is
  the one evicted by `c`; `b` and `c` remain.
- A capacity that is not a finite number greater than zero (`0`, a negative number, `NaN`) disables
  the window entirely: `record` always returns `false` and remembers nothing, `has` always returns
  `false`, and `size` is always `0`. A non-integer positive capacity is rounded **down** to the
  nearest integer for the purpose of the bound (capacity `2.7` behaves as a bound of 2), while the
  `capacity` property still reports the value that was passed in.
- `clear()` forgets everything; `size` becomes `0`.

## 2. Wire it into the pipeline

- Add a new **optional** field `dedupe?: DuplicateWindow` to the exported `PipelineDeps` interface
  in `src/pipeline.ts`. This is the only way a window may be supplied — do not add a module-level
  mutable singleton.
- When `deps.dedupe` is not supplied, the pipeline must behave exactly as it does today. Pick a
  default that is a disabled window, so that no existing behaviour changes.
- Add `"duplicate"` to the `PipelineStage` union in `src/types.ts`.
- In `runPipeline`, the duplicate check happens **after** the event has parsed successfully, passed
  validation and been transformed, and **before** the handler is resolved or invoked. Use the id of
  the event at that point.
  - If `record(id)` reports the id was already seen, `runPipeline` must **not** invoke any handler
    and must return, exactly:
    - `ok: false`
    - `stage: "duplicate"`
    - `kind`: the event's kind
    - `id`: the event's id
    - `issues`: the validation issues collected for this event
    - `error`: the string `` `duplicate:${id}` `` (for id `EV-1`, exactly `duplicate:EV-1`)
    - no `output` field, or `output` left `undefined`
    - and it must increment the metrics counter named exactly `pipeline.duplicate` by 1, and must
      **not** increment `pipeline.accepted` or `pipeline.declined` for that event.
  - If the id had not been seen, processing continues exactly as it does today.
- An event that fails to parse or fails validation is dead-lettered as it is today and must never
  reach the duplicate check, so its id is never recorded in the window.
- `runPipelineBatch` must share the **same** window across every event in the batch, just as it
  already shares the logger, metrics, clock, store and registry.

## 3. A test of your own

Add at least one **new** test file under `tests/` (a `*.test.ts` file that does not already exist)
that exercises `DuplicateWindow`. All existing test files must remain and must still pass
unchanged.

## Constraints

- No new dependencies; nothing outside the standard library.
- Do not change any existing exported name or signature; only add.
- The whole suite under `tests/` must pass when you are done.
