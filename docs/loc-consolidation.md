# optimus-prime — LOC consolidation plan

Analysis only. No repository file was modified. All figures are measured, not estimated by eye;
the method for each is stated inline so a reviewer can re-derive it.

Measured against `~/Work/optimus-prime` @ 2026-08-18.

---

## 0. Baseline

`packages/{agent,ai,coding-agent,tui}/src`, excluding `packages/*/test`:

| package | raw lines | code lines | comment | blank |
|---|---:|---:|---:|---:|
| agent | 2,317 | 1,759 | 326 | 232 |
| ai (excl. generated) | 13,500 | 11,235 | 901 | 1,364 |
| coding-agent | 117,780 | 100,878 | 6,870 | 10,032 |
| tui | 14,667 | 11,503 | 1,368 | 1,796 |
| **subtotal** | **148,264** | **125,375** | 9,465 | 13,424 |
| `ai/src/models.generated.ts` (generated) | 21,891 | ~11,700 | — | — |
| **total** | **170,155** | **~137,075** | | |

The owner's "~138K" is the **code-line** figure. This document quotes raw line deltas (what a diff
shows) and gives the code-line equivalent at the headline, since roughly 15% of raw lines are
blank/comment.

Test mass, reported separately and never counted toward any target: **449 files, 156,614 lines**
across `packages/*/test`. The suite is larger than the source it guards. §7.

---

## 1. Method

Five independent measurements, all reproducible:

1. **File reachability.** Import graph over every `.ts/.tsx` in `packages/*/src`, `packages/*/test`,
   `scripts/`, `packages/*/scripts/`, and `packages/coding-agent/examples/`. Static `import`/`export
   … from`, plus `import()` and `require()` string forms. Roots = every path named in each
   package's `exports`/`main`/`bin` fields, plus all tests and build scripts. Result: 10 src files
   unreached — five of which turned out to be reached by non-import mechanisms (§2 states which).
2. **Declaration reachability.** Real TypeScript AST (`ts.createSourceFile`), not regex. Every
   top-level declaration in every src file, with true spans. Roots = exported declarations whose
   identifier occurs in any *other* src file, any test, any build script, or any example; plus any
   declaration referenced from module-level side-effect code. Then transitive closure through
   declaration bodies. Anything not reached is dead. A first regex-based pass over-reported by
   ~2.5× (regex brace-counting is defeated by regex literals and template strings); those numbers
   were discarded.
3. **Dynamic-dispatch guard.** Every identifier that appears anywhere as a quoted string literal
   was collected separately, so a symbol reached by string-keyed dispatch or by the extension API's
   `handlers.get("tool_result")` style lookup is flagged rather than declared dead. Every deletion
   below was additionally confirmed by a whole-repo `rg` (including `docs/`, `*.md`, `install.sh`,
   `examples/`) showing the identifier occurs in its defining file only.
4. **Clone detection.** Line-window hashing (window 6 and 8) after comment/whitespace
   normalisation, extended maximally, non-overlapping. Two modes: verbatim (type-1) and
   identifier-blinded (type-2, keywords preserved). Plus an AST pass hashing normalised function
   bodies.
5. **Structural counts.** AST census of try/catch shapes, `if (…) throw` guards, `??` defaults,
   re-export-only files, method-size histograms per god class.

---

## 2. Dead code — safe deletions

Ranked by lines ÷ risk. Every entry here is verified unreachable by all three of: import graph,
AST declaration closure, and whole-repo `rg` including markdown, shell, and example workspaces.

### D1 — `modes/interactive/path-formatting.ts` — **−301**

*Risk: none.* The single highest-value safe deletion.

- File: `packages/coding-agent/src/modes/interactive/path-formatting.ts` (301 lines, 15 exports).
- **Zero importers.** `rg 'path-formatting'` across the whole repo returns nothing outside the file
  itself — not from src, not from tests, not from docs, not from the extension examples.
- It is a copy of code that still lives in `interactive-mode.ts`. Clone detection pairs
  `path-formatting.ts:128↔interactive-mode.ts:2045` (33 lines verbatim),
  `:90↔:1965` (28), `:46↔:1827` (23), `:266↔:2008` (18), `formatSplashCwd` (12) — and the
  remaining functions match on shape with only identifier drift. The extraction was performed and
  then never wired; the original was never removed.
- Behaviour that must not regress: none. Nothing calls it.
- Reviewer verification: `rg -l 'path-formatting|formatSplashCwd|getCompactExtensionLabels'` →
  hits only `interactive-mode.ts` (the live copies) and
  `test/interactive-mode-status.test.ts` (which imports from `interactive-mode.js`, not from the
  deleted file). `bun run check` + `bun run test` unchanged.

### D2 — `core/autonomous-continuation-manager.ts` — **−298**

*Risk: none.*

- 297-line file plus one manifest line in `core/harness-reloader.ts:47`.
- Zero importers. The only textual reference in the repo is
  `harness-reloader.ts` `HARNESS_MODULE_MANIFEST`, which lists it explicitly as
  `{ id: "autonomous-continuation-manager", wired: false }` — the manifest's own doc comment calls
  these "dead modules (currently unwired in the running app)".
- Its contents are a second copy of logic already live inside `AgentSession`: type-2 clones pair
  `autonomous-continuation-manager.ts:238 _parseSlashCommand ↔ agent-session.ts:1832
  _parseAutonomousSlashCommand` (31 lines), `:275 _snapshotState ↔ :2588
  _snapshotAutonomousRuntimeState` (12), `:288 _restoreStateSnapshot ↔ :2601
  _restoreAutonomousRuntimeSnapshot` (8), `:254 _formatStatus ↔ :1848 _formatAutonomousStatus` (5).
  Deleting it loses nothing; the live implementation is `AgentSession`'s.
- Reviewer verification: delete file + manifest entry; `/reload:harness` still reports the
  remaining four wired modules.

### D3 — `modes/daemon/daemon-shared.ts` — **−136**

*Risk: none.*

- Zero importers (the only `rg` hit for the string is an unrelated temp-dir name in
  `test/daemon-mode.test.ts:6244`).
- Every line of it is duplicated in live code: `daemon-shared.ts:8 ↔ daemon-supervisor.ts:159`
  (61 lines verbatim), `:17 ↔ daemon-mode.ts:248 ↔ daemon-supervisor.ts:168` (52 × 3),
  `:69 ↔ daemon-mode.ts:300` (39), `:113 ↔ daemon-command.ts:1631` (24). Same story as D1: a
  shared-module extraction that was written and abandoned.
- **Do not** "fix" this by making the three live sites import the dead file — that is the
  consolidation in M3, and it is a separate, riskier change. Deleting the orphan is free; folding
  the three live copies together is not.

### D4 — `core/index.ts` — **−85**

*Risk: none.* Re-export-only barrel, zero importers anywhere in the repo (`rg 'core/index.js'` → 0).
Ceremonial forwarding for a module boundary nothing crosses.

### D5 — `core/refinement-orchestrator.ts` — **−35**

*Risk: none.* 34-line file plus its `harness-reloader.ts:48` manifest entry; same `wired: false`
status as D2. Contains a 19-line block already present at `agent-session.ts:468`.

### D6 — the `wired: false` machinery itself — **−25**

*Risk: low.* Once D2 and D5 land, `HARNESS_MODULE_MANIFEST` has no unwired entries. The `wired`
field, the `dead` counter in `HarnessReloadSummary`, and the branch that reports "not wired" become
constant. Removing them removes the concept, not just the data. Reviewer: `/reload:harness` output
loses the "0 dead" line.

### D7 — 27 residual unreachable declarations — **−122**

*Risk: none individually; each was `rg`-confirmed single-file-only.*

| lines | location | symbol |
|---:|---|---|
| 15 | `utils/changelog.ts:82` | `getNewEntries` |
| 14 | `core/resolve-config-value.ts:111` | `resolveHeaders` |
| 14 | `ai/src/utils/oauth/index.ts:82` | `refreshOAuthToken` |
| 12 | `core/tools/edit-diff.ts:413` | `computeEditDiff` |
| 10 | `ai/src/utils/oauth/index.ts:71` | `getOAuthProviderInfoList` |
| 7 | `utils/shared.ts:111` | `safeJsonParse` |
| 7 | `modes/interactive/theme/theme.ts:1115` | `isLightTheme` |
| 6 | `ai/src/utils/overflow.ts:146` | `getOverflowPatterns` |
| 4 | `core/tools/render-utils.ts:61` | `ToolRenderResultLike` |
| 3 | `ai/src/api-registry.ts:84` | `getApiProviders` |
| 3 | `modes/daemon/daemon-protocol.ts:84` | `DaemonPromptAdmissionCancellationResult` |
| 11 × 1 | `daemon-protocol.ts:83,243,836–845`, `rpc-types.ts:352` | orphan one-line type aliases |
| 2 × 1 | `core/agent-messages.ts:9`, `core/agent-observe.ts:4` | `*_IMPORT_NAME` consts |

`safeJsonParse` deserves a note: it sits in `utils/shared.ts`, the file the brief names as the home
for consolidated helpers, and nothing uses it — while 116 sites elsewhere hand-roll
`try { JSON.parse(x) } catch { return undefined }`. That is M5.

**Safe-deletion subtotal: −1,002 raw (≈ −850 code lines).**

### Explicitly NOT dead — false positives a naive grep produces

Stated because the brief asked how each was verified:

- `core/bun-repl/repl-script.ts` (781), `transform.ts` (442), `cell.ts` (53) — unreachable in the
  import graph because the REPL is a **spawned child process**: `bun-repl/index.ts:203` resolves
  `join(dir, "repl-script.ts")` at runtime and execs it. `repl-script.ts` then statically imports
  `cell.ts` and `transform.ts`. All three are live. Documented in `docs/rlm-runtime.md`.
- `src/bun/cli.ts` (13) and `src/bun/register-bedrock.ts` (5) — entry point for
  `build:binary` (`bun build --compile ./dist/bun/cli.js`), not referenced from any source file.
- `cli/command-registry.ts` `COMMAND_SPECS` (142) and `cli/owned-session-worker.ts`
  `runOwnedSessionWorkerFrontend` (279) — a cross-file-reference-only analysis flags both, because
  their sole callers are *in the same file* (`PUBLIC_COMMAND_NAMES` at :155,
  `maybeRunOwnedSessionWorkerFrontend` at :474). The AST closure keeps them. Live.
- 148 exports whose only consumers are tests (`AgentsViewMode` and 16 siblings, `main.ts`'s 14
  startup predicates, `daemon-ps.ts`'s 12 parsers, …). These are exported *for* testability. They
  cost an `export` keyword, not lines. Not deletion candidates.

---

## 3. Judgement call — dead public API

### J1 — `packages/agent/src/proxy.ts` — **−350** (whole module)

The largest single dead-code find by line count, and the reason it is not in §2.

- Every top-level declaration in the file is unreachable: `streamProxy` (117),
  `processProxyEvent` (130), `buildProxyRequestOptions` (33), `ProxyAssistantMessageEvent` (22),
  `ProxySerializableStreamOptions` (13), `ProxyMessageEventStream` (12), `ProxyStreamOptions` (5).
  Nothing in the monorepo — src, tests, scripts, examples — calls any of them.
- **But** `packages/agent/src/index.ts` is `export * from "./proxy.js"`, so `streamProxy` is part
  of the published surface of `@earendil-works/pi-agent-core`, and it is documented in
  `packages/agent/README.md` and referenced in that package's `CHANGELOG.md`.
- Removing it is a breaking change for any external consumer. It is 15% of the `agent` package.
- Recommendation: deprecate in the README, delete at the next major. Do not bundle this with the
  §2 deletions.
- Reviewer verification: `rg -l '\bstreamProxy\b'` → `proxy.ts`, `README.md`, `CHANGELOG.md` only.

---

## 4. Duplication — mechanical consolidations

Measured clone mass across `packages/*/src` (excluding the generated catalogue):

| detector | groups | redundant lines |
|---|---:|---:|
| verbatim clones ≥ 8 lines | 132 | 2,283 |
| verbatim clones ≥ 6 lines | 334 | 4,183 |
| identifier-blinded ≥ 8 lines | 268 | 4,276 |
| identifier-blinded ≥ 6 lines | 720 | 9,302 |
| whole-function duplicates (AST, verbatim) | 21 | 290 |
| whole-function duplicates (AST, identifier-blinded) | 40 | 584 |

The ≥6-line identifier-blinded figure (9,302) is **not** a consolidation target — inspection shows
most of it is import blocks, interface field lists, and `switch` arm skeletons that cannot be
merged without inventing worse abstractions. The verbatim ≥8 figure (2,283) is the defensible pool.
Of that, 554 lines are already accounted for by deletions D1/D3, and 212 by M1, leaving ~1,600.

### M1 — `ai/providers/google.ts` ↔ `google-vertex.ts` — **−300**

*Risk: medium.* Highest-value duplication find.

- 466 and 543 lines. After blinding the token `vertex`, a plain `diff` of the two files reports
  **195 differing lines** — i.e. ~350 lines are common. Clone detection confirms a single
  191-line verbatim run (`google.ts:94 ↔ google-vertex.ts:111`) plus 21 and 32-line runs.
- The genuine difference is credential acquisition and base-URL construction. Everything after
  request assembly — streaming, tool-call reassembly, message transformation, usage accounting — is
  the same code twice. `google-shared.ts` (340 lines) already exists as the home.
- Behaviour that must not regress: Vertex OAuth/ADC token acquisition, regional endpoint
  construction, and the `requiresToolCallId` divergence at `google-shared.ts`.
- Reviewer verification: `packages/ai/test/` has provider-level tests for both; run
  `bunx vitest --run` in `packages/ai` and diff the request bodies each provider emits for a fixed
  message list.

### M2 — remaining verbatim clone pool — **−1,050** (of 1,600 measured)

*Risk: low, per-site.* Not one change; ~90 independent small ones. The recovery estimate is
deliberately ~65% of measured, because several groups need a *new* shared module whose import lines
and signature give some of it back. Largest members:

| save | sites |
|---:|---|
| 40 | `core/package-manager.ts:358 ↔ core/skills.ts:33` (`prefixIgnorePattern` + `addIgnoreRules`) |
| 30 | `ai/utils/oauth/openai-codex.ts:50 ↔ oauth/anthropic.ts:51` (`parseAuthorizationInput`) |
| 29 | `daemon-mode.ts:2583 ↔ :3003` (the `if (!stateRef) throw` heartbeat-controller literal) |
| 28 | `agent-connection/daemon-agent-connection.ts:46 ↔ in-process-agent-connection.ts:30` |
| 27 | `ai/providers/register-builtins.ts:203 ↔ :255` (+ 4 more `load*ProviderModule` twins, 12–13 each) |
| 24 | `core/auth-storage.ts:125 ↔ core/settings-manager.ts:227` (lockfile retry loop) |
| 24 | `core/cron-jobs.ts:236 ↔ :340 ↔ :387` |
| 23 | `core/agent-session-runtime.ts:422 ↔ :656`, and `:540 ↔ :602` |
| 23 | `modes/interactive/auth-flows.ts:531 ↔ :646` (`armManualInput`) |
| 22 | `cli/daemon-ps-format.ts:70 ↔ cli/daemon-list-format.ts:105` (`formatTable`) |
| 22 | `cli/daemon-launch.ts:52 ↔ daemon-command.ts:733 ↔ daemon-ps.ts:1217` (`canConnectToDaemon`) |
| 20 | `core/tools/truncate.ts:71 ↔ :157` |
| 19 | `cli/command-registry.ts:335 ↔ core/session-resolver.ts:130` (`editDistance` — twice) |
| 17 | `theme/theme.ts:1051 ↔ core/export-html/ansi-to-html.ts:15` (ANSI colour table) |
| 32 | `prime-team-selector.ts:98 ↔ oauth-selector.ts:265 ↔ extension-selector.ts:103` (`render`) |
| 27 | `ai/providers/resolveCacheRetention` × 4 (bedrock / anthropic / openai-completions / openai-responses) |
| 16 | `daemon-update-restart.ts:160 ↔ daemon-supervisor-ownership.ts:899` (`writeJsonAtomically`) + `isProcessAlive` × 4 |
| 10 | `utils/shared.ts:119 ↔ ai/utils/shared.ts:1` (`isTruthyEnvVar`, verbatim, across packages) |

Destination: `packages/coding-agent/src/utils/shared.ts` for the coding-agent ones,
`packages/ai/src/utils/shared.ts` for the provider ones, `google-shared.ts` for M1's residue.

Behaviour that must not regress, by group: the lockfile retry loop (`auth-storage` ↔
`settings-manager`) is concurrency-critical — the two copies must be shown byte-identical before
merging, and the merged version must keep the synchronous busy-wait (both callers are sync).
`isProcessAlive` has four copies with subtly different `EPERM` handling; check each before merging.

Reviewer verification: after each group, `bun run check` (biome + tsgo) and the package's vitest
suite. Because these are verbatim clones, a correct consolidation produces a zero-behaviour diff;
any test movement means the copies had drifted and the merge was wrong.

### M3 — `daemon-mode.ts` ↔ `daemon-supervisor.ts` — **−350** (of 526 measured)

*Risk: medium — daemon protocol is a public surface.*

Cross-file redundancy between the two, identifier-blinded, window 5: **526 lines**. Largest:

- `daemon-mode.ts:239 ↔ daemon-supervisor.ts:156` — **98 lines** of connection/envelope/framing
  setup, structurally identical.
- `daemon-mode.ts:5380 ↔ daemon-supervisor.ts:3035` — `withSessionNameReservation`, 17 lines.
- `daemon-mode.ts:6757 ↔ daemon-supervisor.ts:4328` — `queueClientCatchup` / `queueCatchup`, 16.
- 11 sites × 5 lines of the same client-lookup-or-error shape; 7 × 5 of the same broadcast shape.
- `daemon-shared.ts` (D3) was an abandoned attempt at exactly this consolidation. Its content shows
  the intended shape: `DAEMON_COMMAND_TYPES`, `promptAdmissionKey`, `isSessionSummary`.

Behaviour that must not regress: the wire protocol. `DAEMON_OUTBOUND_COMPATIBILITY` and
`DaemonProtocolVersion` negotiation must be untouched; a supervisor of version N must still accept a
client of version N−1. Reviewer verification: `test/daemon-mode.test.ts` (the largest single test
file) plus `bun run test:process` for the supervisor process tests, and a manual old-client attach.

### M4 — `core/extensions/runner.ts` `emit*` family — **−150**

*Risk: medium — public extension API.*

Nine methods (`emitMessageEnd` 41, `emitToolResult` 49, `emitToolCall` 22, `emitUserBash` 28,
`emitContext` 31, `emitBeforeProviderRequest` 33, `emitBeforeAgentStart` 65, `emitResourcesDiscover`
47, `emitInput` 30 — 346 lines) are the same loop: for each extension, get handlers for a key, for
each handler, `try` the call, merge the result, `catch` → build message+stack → `this.emitError({
extensionPath, event, error, stack })`. Clone detection finds the tail shared 7× at 13 lines and 6×
at 14. Only the merge step differs.

One generic `runHandlers(eventName, ctx, reducer)` plus nine small reducers ≈ −150.

Behaviour that must not regress: **error isolation**. A throwing extension must not abort the loop
or propagate — the current code continues to the next handler and reports via `emitError`. That is
error handling at a trust boundary (third-party code); the generic version must preserve it
exactly, including the `stack` capture. Reviewer verification: the extension tests plus
`examples/extensions/*` — deliberately throw from each hook type and confirm the agent survives and
the error surfaces identically.

### M5 — fallback-only `catch` blocks — **−350**

*Risk: low, but read the exclusion below.*

Census across src: **908 try/catch sites, 17,667 lines**. Of those, 394 have a catch body of ≤3
lines (~1,970 lines of ceremony), and 177 swallow entirely. The mergeable subset is the
**fallback-only** shapes, where the catch body is a single constant return:

| × | body |
|---:|---|
| 31 | `{ return undefined; }` |
| 25 | `{ return null; }` |
| 19 | `{ return false; }` |
| 17 | `{ continue; }` |
| 13 | `{ return; }` |
| 11 | `{ return []; }` |

116 sites. A `tryOr(fn, fallback)` helper in `utils/shared.ts` (which, per D7, already has an unused
`safeJsonParse` sitting in it) turns a 5-line try/catch into a 1-line call: ≈ −350.

Two further repeated shapes are *not* in scope: `{ this.showError(error instanceof Error ?
error.message : String(error)); }` × 9 (+ 7 with a `return`) is UI error surfacing, and
`{ if (code === "ENOENT") return undefined; throw error; }` × 4 is selective — both are behaviour,
not ceremony.

**Excluded on principle:** the 177 swallow-all catches are a correctness question, not a LOC
question. Several sit around file writes. Do not convert them to a helper as part of a line-count
exercise; audit them separately.

**Mechanical-consolidation subtotal: −2,200 raw (≈ −1,870 code lines).**

---

## 5. The four god modules — what is actually in them

The brief is right that splitting them saves nothing, so this section reports what is *removable*,
not what is movable. Measured composition:

| file | raw | code | class | methods | fields | try/catch | switch |
|---|---:|---:|---|---:|---:|---:|---:|
| `core/agent-session.ts` | 11,044 | 9,587 | `AgentSession` 10,033L | 381 | 141 | 76 (2,149L) | 10 / 39 cases |
| `modes/interactive/interactive-mode.ts` | 9,968 | 8,738 | `InteractiveMode` 9,132L | 349 | 154 | 68 (1,492L) | 10 / 100 cases |
| `modes/daemon/daemon-mode.ts` | 7,096 | 6,523 | `AgentDaemon` 6,484L | 171 | 38 | 78 (1,623L) | 2 / 105 cases |
| `modes/daemon/daemon-supervisor.ts` | 5,235 | 4,923 | `DaemonSupervisor` 4,649L | 125 | 35 | 61 | 2 / 27 cases |

Method-size distribution (raw lines):

| file | 2–3L | 4–10L | 11–30L | 31–100L | 100L+ |
|---|---|---|---|---|---|
| agent-session | 64 (192L) | 90 (622L) | 139 (2,509L) | 75 (4,071L) | 13 (1,981L) |
| interactive-mode | 38 (114L) | 121 (855L) | 125 (2,283L) | 55 (2,654L) | 15 (2,736L) |
| daemon-mode | 10 (30L) | 44 (324L) | 67 (1,220L) | 40 (2,144L) | 10 (2,479L) |
| daemon-supervisor | 7 (21L) | 35 (258L) | 50 (872L) | 25 (1,401L) | 8 (1,934L) |

Responsibility clusters, by method-name topic and lines held:

- **`agent-session.ts` — 11 distinct concerns.** RLM/subagent 1,240L (43 methods) · session
  persistence 1,111L · turn/prompt loop 1,078L · refinement 1,037L · compaction 868L · agent
  messages 714L · autonomous/goals 616L · model/provider 379L · extensions 377L · REPL 299L ·
  unclassified 1,227L. Single largest method `_startRlmChildRun` at 350 lines.
- **`interactive-mode.ts` — mostly one concern (TUI event handling) at enormous width.**
  `setupEditorSubmitHandler` 479L and `handleEvent` 408L are 9% of the file between them; 100
  `case` arms across 10 switches hold 835L.
- **`daemon-mode.ts` — one method, `handleCommand`, is 1,128 lines** and holds a 105-case switch.
  That is 16% of the file and the single largest function in the repository.
- **`daemon-supervisor.ts` — `handleCommand` 554L + `handleWorkerFrame` 430L = 20% of the file.**

### G1 — command-dispatch tables — **−265**

*Risk: medium (daemon protocol).* `AgentDaemon.handleCommand` (105 cases) and
`DaemonSupervisor.handleCommand` (27 cases) pay ~2 lines of `case "x": { … break; }` scaffolding per
arm. A `Record<DaemonCommandType, handler>` removes the scaffolding, not the handlers. **This does
not shrink the behaviour, and it is close to a pure move** — it is listed because the 132 arms are
measurable ceremony, not because decomposition is valuable. If the owner would rather keep the
switch (it type-narrows the discriminated union better than a record does), skip it; the loss is 265
lines, not a principle.

### G2 — repeated in-literal guards — **−50**

`daemon-mode.ts:2583 ↔ :3003` is a 29-line verbatim clone: an `rlmHeartbeatController` object
literal whose four methods each open with the same `if (!stateRef) { throw new Error("RLM heartbeat
state is not ready for this session yet"); }`. Three sites construct this literal
(`createRuntime`, `createSubagentRuntimeHost`, `createRlmSubagentRuntime`). One factory function
taking `() => stateRef` removes ~50 lines. Also counted in M2 — do not double-count.

### G3 — single-statement delegators and accessors — **−230**

*Risk: medium.* `agent-session.ts` has 42 single-statement delegator methods (210L) and 36
accessors (152L); interactive-mode 20 (77L) + 4 (12L); daemon-mode 13 (107L); supervisor 9 (39L).
Roughly 600 lines of `get x() { return this._x; }` and `foo() { return this.bar.foo(); }`. Inlining
recovers ~230 after accounting for the call sites that get longer. **Caveat:** a meaningful share of
these exist because `test/` reaches them (148 exports are test-only, §2). Check each against the
suite before removing; a delegator that exists purely so a test can reach private state is earning
its lines.

**God-module subtotal: −450 raw** (G1 265 + G3 230, minus the ~50 of G2 already counted in M2), ≈
−400 code lines.

What is *not* removable here, stated plainly: the 105 daemon commands, the ~100 interactive event
cases, and `agent-session`'s eleven concerns are distinct behaviours with distinct tests. There is
no refactor that makes them smaller. Splitting `agent-session.ts` into eleven files would produce
eleven files and zero saved lines, plus a new import graph to maintain. **Do not do it for LOC.**

---

## 6. Structural boilerplate and over-general machinery

### S1 — `models.generated.ts` as data, not TypeScript — **−21,881 raw / −11,690 code**

*Risk: low. Counted separately from every other figure in this document.*

`packages/ai/src/models.generated.ts` is 21,891 lines / 612 KB of object literal with a single
`import type { Model }` at the top and one `export const MODELS`. Its only consumers are
`ai/src/models.ts:1`, `ai/test/zen.test.ts:2`, and its own generator. Emitting
`models.generated.json` plus a ~10-line typed loader removes the whole file from the TypeScript
line count and from every `tsgo`/biome pass. `biome.json:40` already excludes it, and `AGENTS.md:21`
already forbids hand-editing it — this change makes that structural rather than conventional.

Changes required: `packages/ai/scripts/generate-models.ts:2440` writes `.json`; `models.ts` imports
it; the package `files`/build must copy the JSON into `dist` (the `copy-assets` script already does
this for themes and templates, so the mechanism exists). Reviewer verification: `MODELS` deep-equals
the previous value; `bun run build` in `packages/ai` still produces a working `dist`.

This is the single largest number in the document and also the least interesting one — it is
bookkeeping, not simplification. Report it separately from the real cuts, as the brief asks.

### S2 — barrels that only forward — **−85 now, ~0 later**

19 re-export-only files, 1,111 lines. Only one is deletable: `core/index.ts` (85 lines, 0 importers
— that is D4). The rest earn their keep: `src/index.ts` (394) is the package's published API,
`core/extensions/index.ts` (146) has 13 importers, `core/refinement/index.ts` 9,
`core/compaction/index.ts` 8, `modes/agent-connection/index.ts` 4. Two are thin
(`components/index.ts` 52 lines / 1 importer, `modes/index.ts` 124 / 2) — inlining those imports
saves ~170 lines but couples call sites to file layout. Marginal; listed for completeness, not
recommended.

### S3 — `if (…) throw new Error(…)` guards — **−700, judgement call, not in the headline**

748 sites, 2,286 lines. The dominant shapes are `{ throw new Error("…"); }` × 344 and the template
form × 215. Biome formats each as three lines; an `assertOk(cond, msg)` helper makes each one line,
for ~1,400 raw lines.

It is not in the headline for two reasons. First, a large share of these *are* input validation at
trust boundaries — the brief forbids cutting those, and this change does not cut them, but it does
make them uniform and therefore easier to skim past. Second, it touches 748 sites for a purely
cosmetic density gain, which is a large review surface for zero behaviour change. If the owner wants
it, take it in the ~350 non-validation invariant asserts first (`if (!stateRef) throw`,
`if (!this.session) throw`) and leave boundary validation as explicit three-line blocks. Estimated
at −700 if pursued fully, deliberately excluded from the bottom line.

### S4 — over-general machinery

Honest result: **there is much less of this than the file sizes suggest.** What the census found:

- `SettingsStorage` (`core/settings-manager.ts:209`) — one-method interface, two implementers
  (`FileSettingsStorage` 62L, `InMemorySettingsStorage` 16L), both used internally by
  `SettingsManager.create` / `.ephemeral`, neither referenced outside the file despite being
  exported. Genuine abstraction (the in-memory one backs ephemeral sessions). Drop the three
  `export` keywords; keep the code. **−0 lines, −3 public symbols.**
- `AuthStorageBackend` — same shape, two implementers, both in the published `index.ts`. Keep.
- `AgentConnection` (`modes/agent-connection/types.ts`) — two implementers
  (`daemon-agent-connection.ts` 2,113L, `in-process-agent-connection.ts` 652L). Two real
  implementations, so not single-implementer tax. **But** the file declares 77 `AgentConnection*`
  types that mirror types already declared elsewhere. Structural comparison (member-name Jaccard
  ≥ 0.75) finds 19 near-exact mirrors totalling **161 lines**, e.g.
  `AgentConnectionSavedSessionInfo ≡ DaemonSavedSessionInfo ≡ SessionInfo` (three copies, 15 lines
  each), `AgentConnectionSessionHeader ≡ SessionHeader`, and nine of the `Session*Entry` variants.
  Plus ~140 lines of pure field-copy mapping (`snapshot.ts` 46 sites,
  `daemon-agent-connection.ts` 93) that exists only to translate between the mirrors.
  Collapsing the mirror onto the source types: **−300, judgement call** — it removes an intentional
  isolation layer between the daemon wire format and the UI, and the daemon protocol is public.
  Listed, not recommended for the first pass.
- Config surfaces nobody sets: the `Settings` interface tree (`CompactionSettings`,
  `AutoRefineSettings`, `RetrySettings`, `TerminalSettings`, `ImageSettings`,
  `ThinkingBudgetsSettings`, `MarkdownSettings`, `BundledSkillsSettings`, `WarningSettings`, …) is
  user-facing documented configuration with defaults in comments. Some keys are surely unset by
  every user, but they are product surface, not tax, and each is one line. **No recommendation.**
- 1,795 `??` default operators — inline option merging, but distributed one-per-site with different
  defaults. No single merge point exists. Not a target.

---

## 7. Test-side mass — reported, not proposed for deletion

**449 files, 156,614 lines** in `packages/*/test`: coding-agent 328 files / 121,691 lines, ai 79 /
17,877, tui 37 / 13,873, agent 5 / 3,173. The suite is 5% larger than the source it guards, and it
is the only thing that makes any change in this document reviewable. **Nothing here is proposed for
deletion.**

Verbatim clone detection over tests (window 10) finds **284 groups, 6,282 redundant lines** —
overwhelmingly repeated *setup*, not repeated assertions:

- `test/daemon-mode.test.ts` — one 11-line daemon-boot block repeated **16×** (165 redundant), a
  12-line variant **14×** (156), a 12-line variant 7× (72), an 18-line block 4× (54). ~450 lines in
  one file, all of it harness construction.
- `test/suite/agent-session-serialized-refine.test.ts` — a 10-line block 11× (100) and an 11-line
  block 9× (88, two of which are in `serialized-refine-config-integration.test.ts`).
- `packages/ai/test/openai-codex-stream.test.ts` — a 45-line fixture 4× (135) and a 17-line one 6×
  (85).
- `packages/ai/test/openai-completions-*.test.ts` — a 14-line request-builder repeated across five
  sibling files (56).
- A 10-line import/mock preamble shared by 11 files across all four packages (100).

Recommendation: extract these into named builders in each package's existing test-utilities module
(`packages/coding-agent/test/utilities.ts` exists and is already imported widely). Realistic
recovery **~3,000 lines with no loss of coverage**, because every instance is verbatim. Report this
number separately and never against the source target — and if a consolidation makes a single test
harder to read in isolation, keep the duplication. Duplication in tests is often the point.

No dead test helpers of any size were found: the test tree's own unused-export analysis returns
nothing above 15 lines.

---

## 8. Ranked plan

Ordered by lines removed ÷ risk. Group A first, in order; Group B independently; Group C only with
an explicit decision.

### Group A — safe deletions (do first, no behaviour touched)

| # | change | files | Δ raw | risk | must not regress | reviewer check |
|---|---|---|---:|---|---|---|
| A1 | delete `path-formatting.ts` | 1 | −301 | none | nothing — 0 importers | `rg 'path-formatting'` → 0; tests import `interactive-mode.js` |
| A2 | delete `autonomous-continuation-manager.ts` + manifest line | 2 | −298 | none | `/reload:harness` lists remaining modules | manifest has no `wired:false` entries |
| A3 | delete `daemon-shared.ts` | 1 | −136 | none | nothing — 0 importers | `rg 'daemon-shared'` → test temp-dir string only |
| A4 | delete `core/index.ts` | 1 | −85 | none | nothing — 0 importers | `bun run check` |
| A5 | delete `refinement-orchestrator.ts` + manifest line | 2 | −35 | none | as A2 | as A2 |
| A6 | remove `wired`/`dead` machinery from `harness-reloader.ts` | 1 | −25 | low | `/reload:harness` still validates 4 modules | run the command |
| A7 | delete 27 unreachable declarations (D7 table) | ~14 | −122 | none | nothing | `bun run check` + full suite |
| | **subtotal** | | **−1,002** | | | |

### Group B — mechanical consolidations (duplication only)

| # | change | Δ raw | risk | must not regress | reviewer check |
|---|---|---:|---|---|---|
| B1 | fold `google-vertex.ts` into `google-shared.ts` | −300 | med | Vertex ADC/OAuth token flow; regional base URL; `requiresToolCallId` split | `packages/ai` suite; diff emitted request bodies for a fixed message list |
| B2 | ~90 verbatim clone merges into `utils/shared.ts` / `ai/utils/shared.ts` | −1,050 | low | lockfile retry semantics (sync busy-wait); the four `isProcessAlive` `EPERM` variants | zero-behaviour-diff expected; any test movement = the copies had drifted |
| B3 | daemon-mode ↔ daemon-supervisor shared framing/reservation/catchup | −350 | med | wire protocol; `DAEMON_OUTBOUND_COMPATIBILITY` version negotiation | `daemon-mode.test.ts`, `bun run test:process`, old-client attach |
| B4 | one generic handler runner for `runner.ts` `emit*` × 9 | −150 | med | extension error isolation: a throwing handler must not abort the loop, must surface via `emitError` with `stack` | throw from each hook in `examples/extensions/*` |
| B5 | `tryOr()` for the 116 fallback-only catches | −350 | low | **not** the 177 swallow-all catches — leave those alone | per-site diff review |
| | **subtotal** | **−2,200** | | | |

### Group C — judgement calls (behaviour or public API)

| # | change | Δ raw | why it is a judgement call |
|---|---|---:|---|
| C1 | `models.generated.ts` → JSON + loader | −21,881 | build/packaging change; counted separately, not a real simplification |
| C2 | delete `agent/src/proxy.ts` | −350 | published API of `@earendil-works/pi-agent-core`, documented in its README; major-version break |
| C3 | daemon/supervisor command dispatch tables | −265 | daemon protocol is public; the `switch` narrows the discriminated union better than a record. Pure ceremony removal — skip if the owner prefers the switch |
| C4 | inline single-statement delegators/accessors | −230 | several exist so tests can reach private state; check each against the suite |
| C5 | collapse the `AgentConnection*` type mirror onto `Daemon*`/`SessionInfo` | −300 | removes a deliberate isolation layer between wire format and UI |
| C6 | `assertOk()` sweep over 748 `if (…) throw` guards | −700 | 748-site review surface for zero behaviour change; several are trust-boundary validation. **Excluded from the bottom line.** |
| C7 | test-side fixture builders | −3,000 | test mass, reported separately; never counted against the source target |

### Top 8 by lines-per-risk

1. **A1** `path-formatting.ts` — 301, zero risk.
2. **A2** `autonomous-continuation-manager.ts` — 298, zero risk.
3. **A3** `daemon-shared.ts` — 136, zero risk.
4. **B2** verbatim clone merges — 1,050 across ~90 sites, low risk each.
5. **A7** 27 unreachable declarations — 122, zero risk.
6. **A4** `core/index.ts` — 85, zero risk.
7. **B5** `tryOr()` for fallback-only catches — 350, low risk.
8. **B1** `google` / `google-vertex` — 300, medium risk, highest single duplication find.

---

## 9. Bottom line

**Realistically removable from hand-written source: ~4,000 raw lines ≈ 3,400 code lines.**

| | raw | code |
|---|---:|---:|
| baseline (excl. generated catalogue) | 148,264 | 125,375 |
| Group A — dead code | −1,002 | −850 |
| Group B — duplication | −2,200 | −1,870 |
| Group C, the defensible parts (C2 + C3 + C4) | −845 | −720 |
| **after** | **~144,200** | **~121,900** |

Adding C1 (the generated catalogue leaving TypeScript) takes the *counted* TypeScript from 170,155
raw / ~137,075 code down to **~144,200 raw / ~121,900 code** — the owner's "138K" becomes about
**122K**. Two-thirds of that headline is one file changing extension. **The real cut is 3,400 code
lines, or 2.7%.**

I am not going to dress that up. The measurements do not support a larger number:

- Total *verified* dead code in 148K raw lines of hand-written source is ~1,350 raw (including the
  public-API `proxy.ts`). That is 0.9%. The two modules the brief already knew about
  (`autonomous-continuation-manager`, `refinement-orchestrator`) plus three more found here
  (`path-formatting.ts`, `daemon-shared.ts`, `core/index.ts`) are essentially all of it. This is not
  a codebase carrying a graveyard.
- Total verbatim clone mass at a 8-line threshold is 2,283 lines — 1.5%. The 9,302 figure from a
  loose 6-line identifier-blinded detector is not real duplication; it is import blocks and
  interface fields, and anyone quoting it is quoting noise.
- The four god files are big because they *do* a lot: 105 daemon commands, ~100 interactive event
  cases, eleven separable concerns in `AgentSession`. Decomposing them moves lines. It does not
  remove them, and the brief is right to refuse to pay for that.

**Irreducible fraction: I judge ~90% of the remaining ~122K code lines load-bearing.** The
remaining ~10% is not recoverable by refactoring — it is recoverable only by a *product* decision.
Three feature clusters account for most of it, measured by method-topic attribution:

- **RLM / subagents** — 1,240L in `agent-session.ts` (43 methods), 1,205L in `daemon-mode.ts`
  (30 methods), `rlm-ledger.ts` 829, `rlm-runtime.ts`, `rlm-max-depth.ts`, `rlm-subagent-display.ts`,
  plus the `bun-repl` host-request bridge. **~4,500 code lines.**
- **Refinement** — 1,037L in `agent-session.ts` (24 methods), `core/refinement/refinement.ts` 991,
  the refine paths in `rpc-client.ts` / `daemon-agent-connection.ts`. **~2,500 code lines.**
- **Autonomous continuation / goals** — 616L in `agent-session.ts`, `core/autonomous.ts`,
  `core/goals.ts`. **~1,200 code lines.**

If any of those three is not carrying its weight as a product, deleting one is worth more than
every consolidation in this document combined. That is the honest answer to "why is this 138K
lines": it is not 138K lines of ceremony, it is roughly 122K lines of load-bearing behaviour, 8K
lines of features that may or may not be wanted, plus a generated file that should never have been
TypeScript.

---

## Appendix — reproduction

Analysis scripts were written to a scratchpad outside the repository and are not part of it. To
reproduce, the five measurements are:

1. Import graph + file reachability — resolve `import`/`export … from`/`import()`/`require()`
   against the workspace package names; roots from `exports`/`main`/`bin` + tests + scripts.
2. Declaration reachability — `ts.createSourceFile` per src file; top-level decls with true spans;
   roots = exported-and-referenced-elsewhere ∪ referenced-from-module-level; transitive closure
   through bodies. Do **not** attempt this with regex brace-matching; it over-reports ~2.5×.
3. Quoted-identifier index — every `["'\`]ident["'\`]` in src+tests, to flag string dispatch.
4. Clone detection — normalise lines (strip `//`, trim), hash windows of 6 and 8, extend maximally,
   drop overlapping groups; run once verbatim and once with non-keyword identifiers blinded.
5. Structural census — AST walk counting `TryStatement` shapes, `IfStatement` → `throw` guards,
   `??` operators, re-export-only files, and per-class method-size histograms.

All line numbers in this document are 1-based and refer to the tree as of 2026-08-18.
