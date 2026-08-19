# Upstream PR & Issue Review

Review of **open** pull requests and issues on the two repos our fork descends from, judged against our de-Pythoned, Bun-only tree.

- **Date:** 2026-08-18
- **Scope:** open PRs only (114 total: 64 + 50) and open issues (8 + 92).
- **Our fork base:** upstream `875aba965`; local tree at `2a4594ed4`. Upstream `main` is ~13 commits further — those are being merged by another worker and are **excluded** here.
- **This is review only.** Nothing was implemented; the fork tree was never written to.

---

## 1. Lineage (established, not assumed)

```
earendil-works/pi              @ 0.84.2   ← original ("pi")
        │  vendored fork (source copied, renamed piConfig → prime-agent)
        ▼
PrimeIntellect-ai/prime-agent  @ 0.7.2    ← our direct upstream
        │  fork @ 875aba965
        ▼
our fork  (Python removed, Bun REPL, Bun-only toolchain)
```

Two facts that shape every verdict below:

1. **prime-agent *vendors* pi; it does not depend on it.** `packages/coding-agent/package.json` is literally `@earendil-works/pi-coding-agent`, and `packages/{ai,agent,tui}` are `pi-ai` / `pi-agent-core` / `pi-tui`. The root `package.json` dependency on `@earendil-works/pi-coding-agent@^0.7.2` resolves to the in-repo workspace. **⇒ a pi fix never reaches us automatically. Every pi fix is a manual port.**
2. **pi has moved 0.7.2 → 0.84.2 and restructured.** pi now has `packages/agent/src/harness/*`, `packages/ai/src/api/*`, `packages/server`, `packages/session-backends`, `packages/tui/src/{tui-alt-screen,tui-main-screen,layout,selection-navigation}.ts`. We have none of those (we have `packages/ai/src/providers/*` and a single `packages/tui/src/tui.ts`). **⇒ roughly half of all pi PRs land in files we do not have.** pi also has **no Python/IPython at all** any more — it de-Pythoned independently of us, which is why pi PRs are usually more portable in *intent* than prime-agent's kernel PRs.

---

## 2. SECURITY AND DATA-LOSS FIRST

These get ported even where awkward. Every one was confirmed to reach our fork by reading our code, not by reading the PR description.

### 2.1 Security

| # | Source | Issue | Reaches us? | Where |
|---|---|---|---|---|
| S1 | pa [#1249](https://github.com/PrimeIntellect-ai/prime-agent/pull/1249) | Private session artifacts written world-readable (0644), non-atomically, following pre-planted symlinks | **YES, and worse** | see S1a below |
| S1a | **fork-original — no upstream PR** | **Bun REPL snapshot leaks variable state at 0644.** `mkdir` with no mode → 0755; `writeFile` of `manifest.json`/`data.json` → 0644, non-atomic, symlink-following; `loadSnapshot` swallows all errors in a bare `catch {}` | **YES** | `packages/coding-agent/src/core/bun-repl/state-snapshot.ts:15,22-25,31,34,43` — reached via `core/agent-session.ts:8712,8721` → `bun-repl/index.ts:529,536`. `data.json` holds serialized REPL state — whatever the agent touched, secrets included. **Upstream will never hand us this fix; it is ours to write.** |
| S2 | pa [#1251](https://github.com/PrimeIntellect-ai/prime-agent/pull/1251) | `--no-session` only makes the *root* SessionManager in-memory; every child spawn calls `SessionManager.create()` unconditionally ⇒ descendant transcripts land on disk under an ephemeral parent | **YES** | `core/agent-session-runtime.ts:337`, `core/agent-session.ts:9129`, `modes/daemon/daemon-mode.ts:2529`. **Fork amplification:** `getSessionArtifactDir()` returns undefined iff `!persist` (`session-manager.ts:1435`) and feeds our bun-repl snapshots ⇒ today descendants of an ephemeral parent also persist **REPL variable state** to disk. |
| S3 | pa [#1494](https://github.com/PrimeIntellect-ai/prime-agent/pull/1494) | Daemon persists the **entire `process.env`** plus `apiKey` into durable worker descriptors, and auto-relaunches from the stale persisted command (fail-open recovery) | **YES** | `modes/daemon/daemon-protocol.ts:206-214` (`collectDaemonLaunchEnv` copies all of `process.env` minus `PRIME_AGENT_INTERNAL_*`), `daemon-supervisor.ts:975-981,990-992,2163,2240,2857`. Files are `0600` so severity is moderate, not critical — but creds sit plaintext-at-rest under `~/.prime/agent/`, readable by any same-uid process. For an agent that spawns arbitrary user tools that is a real exposure. |
| S4 | pa [#374](https://github.com/PrimeIntellect-ai/prime-agent/pull/374) | `--no-env` does not isolate: ambient env / Prime-CLI credentials and `X-Prime-Team-ID` leak into sessions the operator believed isolated. Plus a 401 retry loop (lockout amplifier) | **YES** | `core/auth-storage.ts:1079,1083`; `packages/ai/src/providers/openai-completions.ts:478`. `rg 'noEnv\|allowAmbientCredentials' src/cli/args.ts` → empty. Cross-tenant hazard; highest-confidence security port. |
| S5 | pa [#1253](https://github.com/PrimeIntellect-ai/prime-agent/pull/1253) | Killing the kernel abandons in-flight RLM children — they keep running and burning tokens with no owner; orphan `sub-*` session dirs left behind | **YES, we are worse than pre-fix upstream** | our handler contract has no signal at all: `core/tools/kernel-types.ts:14`; `bun-repl/index.ts:241-273` awaits handlers with no cancellation; `shutdown()` `:485`, `kill()` `:510`, `dispose()` `:560`, `disposeSync()` `:567` neither abort nor even wait for in-flight host requests. Upstream at least bounded-waited. |
| S6 | pi [#6513](https://github.com/earendil-works/pi/issues/6513) (fix PR #6539 **closed unmerged**) | Codex cached WebSocket keyed **only by session ID** ⇒ changing credentials mid-session reuses account A's authenticated socket and A's `previous_response_id` for a nominal B request | **YES, verbatim** | `packages/ai/src/providers/openai-codex-responses.ts:857,898` (`websocketSessionCache.get/set(sessionId)`). Cross-account request routing. Unfixed upstream. |
| S7 | pa [#1495](https://github.com/PrimeIntellect-ai/prime-agent/pull/1495) (slice) | MCP servers readable from **project** `settings.json` ⇒ a hostile repo can inject an MCP endpoint; and stdio MCP children inherit the full environment | **YES** | `core/settings-manager.ts:1211` `getMcpServers`; call sites `core/sdk.ts:166`, `core/agent-session-services.ts:190`, `modes/interactive/interactive-mode.ts:8676`. The env-allowlist idea matters for us specifically: our `KEEPER_PRIVATE_KEY`-class vars are currently inheritable. |
| S8 | pa [#1513](https://github.com/PrimeIntellect-ai/prime-agent/pull/1513) | A set-but-**empty** credential env var falls back to the literal, sending the **env var name** to the provider as the API key | **YES, byte-identical** | `core/resolve-config-value.ts:21-22` and `:94-95` (`return envValue \|\| config;` twice) |
| S9 | pa [#525](https://github.com/PrimeIntellect-ai/prime-agent/pull/525) (slice b only) | R2/AWS release secrets exposed as **job-level** env, visible to every step in the publish job including artifact download | **YES** | `.github/workflows/build-binaries.yml:197`. ~15 lines to scope them to the three `run:` steps that need them. (Slices a and c are already-applied / npm-tooling — see §6.) |

### 2.2 Data loss and context loss

| # | Source | Bug | Reaches us? | Where |
|---|---|---|---|---|
| D1 | **fork-original — derived from pa [#1187](https://github.com/PrimeIntellect-ai/prime-agent/pull/1187)** | **`interrupt` is a silent no-op in the Bun REPL.** `protocol.ts:14-17` defines `BunReplInterruptRequest` and `index.ts:367,480-483` send it, but `repl-script.ts`'s stdin switch (`:503-566`) has **no `case "interrupt"`** — it falls to `default: break`. ⇒ every cancel waits the 1s grace then `_restartForRunaway()` SIGKILLs and respawns. **Every Esc during a cell destroys the entire REPL namespace.** | **YES** | `core/bun-repl/repl-script.ts:503-566`, `index.ts:367,456-478`. Squarely in our context-loss priority area. **S to fix.** |
| D2 | **fork-original — derived from pa [#865](https://github.com/PrimeIntellect-ai/prime-agent/pull/865)** | **Runaway restart discards a valid on-disk snapshot.** `restoreState()` exists (`index.ts:533`) but is called only from first-ensure (`provisioner.ts:125`). Auto-snapshots are written (`_scheduleAutoSnapshot`, `index.ts:561`) then ignored on runaway restart. Also: no output-growth heuristic, so a healthy-but-slow cell streaming progress for >120s is SIGKILLed identically to `while(true)` | **YES** | `core/bun-repl/index.ts:460-478` (`_restartForRunaway`), `:334-341` (unbounded collector). This is the classic "Python fix, real JS bug" case: port the *idea*, not the diff. |
| D3 | pi [#7048](https://github.com/earendil-works/pi/issues/7048) (fix PR #7420 **closed unmerged**) | **Compaction persists a truncated summary.** `generateSummary` only throws on `stopReason === "error"`; `"length"` returns a *partial* summary that is persisted as the checkpoint. Sessions resume on a summary ending mid-word; content past the cut is unrecoverable | **YES, verbatim** | `core/compaction/compaction.ts:602` and `:873` (turn-prefix path). Fix is ~16 lines (`assertSummaryComplete`), already written in the closed PR. **Highest value-per-line in the whole review.** |
| D4 | pi [#7053](https://github.com/earendil-works/pi/issues/7053) — **no open PR** | **Parallel tool batches lose completed results.** `createToolResultMessage`/`emitToolResultMessage` run *after* the `Promise.all` barrier, so durability of every result is gated on the slowest sibling. Abort or kill mid-batch ⇒ every toolCall becomes an orphan and the model is fed `No result provided` for results the user watched succeed | **YES, verbatim** | `packages/agent/src/agent-loop.ts:735-741` (parallel) vs `:674-675` (sequential, which persists immediately and is correct). Unfixed upstream. |
| D5 | pa [#881](https://github.com/PrimeIntellect-ai/prime-agent/pull/881) | `waitForIdle()` returns before a scheduled post-compaction continuation runs ⇒ headless/ACP emits a silent `end_turn` mid-compaction-resume and the resumed turn's output never reaches the client | **YES** | `core/agent-session.ts:6573-6596` (gate missing both the awaited promise and the `!_postCompactionContinuationScheduled` guard), fields `:1263-1265`, `:7337-7341`, `:7436`, `:7453-7500` |
| D6 | pi [#8283](https://github.com/earendil-works/pi/pull/8283) | Post-compaction continuation strips only **one** trailing failed assistant message and only checks `stopReason === "error"`, not `"length"` ⇒ `Cannot continue from message role: assistant`, turn dies mid-recovery | **YES, and worse than upstream** | `core/agent-session.ts:8295-8300` |
| D7 | pi [#8297](https://github.com/earendil-works/pi/pull/8297) / issue [#7724](https://github.com/earendil-works/pi/issues/7724) | **Cold restore replays a failed assistant response that live recovery removed.** Live recovery strips it from memory only; nothing marks the persisted entry, so any `buildSessionContext()` rebuild or session reopen replays the failed/truncated turn | **YES** | `core/agent-session.ts:10353-10357`, `:8131-8136`, `:8295-8300`; `SessionMessageEntry` has no `supersedesEntryIds` (`core/session-manager.ts:53`ff) |
| D8 | pa [#1166](https://github.com/PrimeIntellect-ai/prime-agent/pull/1166) (nugget only) | **`_rewriteFile` has no fsync.** `writeFileSync(tmp)` → `renameSync` with no fd fsync and no parent-dir fsync ⇒ power loss can land a zero-length or partial transcript = silent whole-session loss | **YES** | `core/session-manager.ts:1344-1363`. ~20 lines. Harvest this nugget; skip the 1722-line PR it sits in. |
| D9 | pa [#1495](https://github.com/PrimeIntellect-ai/prime-agent/pull/1495) (slice) | Settings written with a raw `writeFileSync` — a crash mid-write corrupts `settings.json` | **YES** | `core/settings-manager.ts:276`. Atomic tmp + `0o600` + rename. MCP-independent; take standalone. |
| D10 | pa [#485](https://github.com/PrimeIntellect-ai/prime-agent/pull/485) | An update interrupted between "prepare restart" and "restore" strands prepared sessions permanently; current code clears the manifest on the **first** restore error, discarding the rest | **YES** | no `daemon-update-manifest.ts` / `daemon-update-recovery.ts` in our tree; `rg 'recoverPendingDaemonUpdateRestart\|retryOnly'` → empty |
| D11 | pa [#1146](https://github.com/PrimeIntellect-ai/prime-agent/pull/1146) | **Session-start notifications are dropped.** `bindActiveSessionState` runs while `clients` is still empty; `notify:` broadcasts with no client check (unlike dialogs) and `broadcastToSession` iterates an empty set | **YES, chain read end-to-end** | `modes/daemon/daemon-mode.ts:1408→1427` → `daemon-extension-binding.ts:83→200→129` → `daemon-mode.ts:6390`. Any extension calling `ctx.ui.notify()` in `session_start` loses it on every daemon session. |
| D12 | pa [#1123](https://github.com/PrimeIntellect-ai/prime-agent/pull/1123) (nugget) | Worker recovery journal lacks atomic compaction and an invalid-record guard | **YES** | `modes/daemon/worker-recovery-journal.ts:106-113` |
| D13 | pi [#7751](https://github.com/earendil-works/pi/pull/7751) | Concurrent manual compaction / auto compaction / tree navigation clobber the shared abort controller and rewrite session state over each other | **PARTIAL** — we already have invocation-scoped ownership checks (`agent-session.ts:7205-7206`, `:11043-11044`) but **not** the entry guards | `agent-session.ts:7138-7152`, `:8255`, `:10895` still set `_compactionAbortController` unconditionally |
| D14 | pa [#522](https://github.com/PrimeIntellect-ai/prime-agent/pull/522) | Ctrl+C / Alt+Up clears the *whole* queue, silently discarding queued agent-to-agent messages | **YES** | no `clearUserQueue` / `separate_message_queues` in our tree; the `agentMessageId` plumbing it needs already exists (`agent-session.ts:576,584,699,741,3265-3269`) |

---

## 3. Master table

Classification key: **PORT** (applies to our code) · **N/A** (deleted/absent code — column says whether the bug survives in the replacement) · **CONFLICTS** (touches code we rewrote) · **SKIP** (cosmetic or against our direction).

### 3.1 `PrimeIntellect-ai/prime-agent` (64 open; 62 reviewed)

| PR | Title | Class | Lands in our tree | Effort |
|---|---|---|---|---|
| [1523](https://github.com/PrimeIntellect-ai/prime-agent/pull/1523) | doctor: repair daemons that lost ownership record | PORT (after upstream-main merge) | `cli/daemon-ps.ts:84`, `cli/daemon-ps-format.ts:35`, `modes/daemon/daemon-supervisor.ts:504,640` | M |
| [1520](https://github.com/PrimeIntellect-ai/prime-agent/pull/1520) | one daemon per socket regardless of spelling | PORT clean | `modes/daemon/daemon-socket.ts`; deletes dup normalizers at `cli/daemon-ps.ts:84`, `package-manager-cli.ts:1179`, `config.ts:577`, `daemon-supervisor-ownership.ts` | S |
| [1519](https://github.com/PrimeIntellect-ai/prime-agent/pull/1519) | send parked queue with Enter after interrupt | PORT clean | `core/agent-session.ts:6558`, `modes/interactive/interactive-mode.ts:4647-4649,7483` | S |
| [1513](https://github.com/PrimeIntellect-ai/prime-agent/pull/1513) | set-but-empty credential env var = missing | **PORT clean · SECURITY** | `core/resolve-config-value.ts:21-22,94-95` | S |
| [1510](https://github.com/PrimeIntellect-ai/prime-agent/pull/1510) | subagents spawn with own reasoning level | PORT (translate) | `core/rlm-runtime.ts:80`, `core/agent-session.ts:9105,9769,9775`, `core/prompts/rlm.ts:134` | M |
| [1500](https://github.com/PrimeIntellect-ai/prime-agent/pull/1500) | Trendshift badge | SKIP (draft, cosmetic) | — | — |
| [1495](https://github.com/PrimeIntellect-ai/prime-agent/pull/1495) | generic kernel-owned MCP runtime | PORT in slices · **SECURITY + DATA-LOSS** | `settings-manager.ts:276,1211`; new `core/mcp/mcp-command.ts`; Python runtime → L reimpl in `core/bun-repl/` | S/M/L |
| [1494](https://github.com/PrimeIntellect-ai/prime-agent/pull/1494) | harden resident session lifecycle | **PORT (2 mech. hunks) · SECURITY** | `modes/daemon/daemon-supervisor.ts:978,990-992` (rest clean), `modes/acp/*`, `daemon-protocol.ts` | M |
| [1493](https://github.com/PrimeIntellect-ai/prime-agent/pull/1493) | default RLM max depth 1→2 | **DEFER** (author: later release; doubles recursion cost) | `core/agent-session.ts:1604` | S |
| [1480](https://github.com/PrimeIntellect-ai/prime-agent/pull/1480) | CI requires linked Linear ticket | SKIP | — | — |
| [1389](https://github.com/PrimeIntellect-ai/prime-agent/pull/1389) | keep original session running when forking | PORT clean (all 12 files, zero fuzz) | `core/agent-session-runtime.ts:492,549`, `core/session-manager.ts:2041`, `modes/daemon/daemon-protocol.ts:63-64` | S |
| [1378](https://github.com/PrimeIntellect-ai/prime-agent/pull/1378) | ACP MCP programs | CONFLICTS (generates **Python** skills) | our skill runtime is JS-only; no `modes/acp/acp-mcp.ts` | L |
| [1372](https://github.com/PrimeIntellect-ai/prime-agent/pull/1372) | keep draft when opening agents view | PORT clean · draft-preservation | `modes/interactive/interactive-mode.ts:6010,6856,4255,4276,4364-4369` | S |
| [1349](https://github.com/PrimeIntellect-ai/prime-agent/pull/1349) | markdownlint across all markdown | SKIP (npm tooling) | — | — |
| [1338](https://github.com/PrimeIntellect-ai/prime-agent/pull/1338) | close late probe sessions | N/A (`core/mcp/mcp-probe.ts` absent; stacked on orphaned base) | — | — |
| [1337](https://github.com/PrimeIntellect-ai/prime-agent/pull/1337) | enforce project MCP trust boundaries | CONFLICTS (imports deleted `core/kernel/`) | mutually exclusive with 1495 | L |
| [1253](https://github.com/PrimeIntellect-ai/prime-agent/pull/1253) | cancel RLM work on host teardown | **PORT (translate) · SECURITY** | `core/tools/kernel-types.ts:14`, `core/bun-repl/index.ts:241-273,485,510,560,567`, `core/agent-session.ts:8823,9764,9823,9203` | M |
| [1252](https://github.com/PrimeIntellect-ai/prime-agent/pull/1252) | handle clipboard helper failures | PORT clean (ignore the `fix(security)` title — no injection) | `utils/clipboard.ts:100-109` | S |
| [1251](https://github.com/PrimeIntellect-ai/prime-agent/pull/1251) | keep no-session descendants ephemeral | **PORT (19/21 clean) · SECURITY** | `core/session-manager.ts:1409,1218`, `core/agent-session-runtime.ts:335,549`, `core/agent-session.ts:9128`, `modes/daemon/daemon-mode.ts:469,1634,2414,2529,5906,6095` | M |
| [1249](https://github.com/PrimeIntellect-ai/prime-agent/pull/1249) | contain private session artifacts | **PORT (mostly clean) · SECURITY** | new `utils/private-files.ts`; `config.ts:594-608`, `core/auth-storage.ts:110-208`, `core/export-html/index.ts:279,312`, `core/refinement/refinement.ts:272,328` (hand-rewrite) | M |
| [1239](https://github.com/PrimeIntellect-ai/prime-agent/pull/1239) | preserve causal prompt correlation | PORT slices (b)+(d) only; rest superseded by 1494. ⚠ reviewers differed — one said skip wholesale as superseded, one found slice (b) is a **live gap**: `snapshot.ts` never populates `children` even though `types.ts:305-306` declares it and `daemon-agent-connection.ts:403,2057` read it, so the roster is permanently `undefined`. Check whether 1494's `get_rlm_children` already covers it before porting (b) | `modes/agent-connection/snapshot.ts`, `cli/daemon-launch.ts:237` | S–M |
| [1236](https://github.com/PrimeIntellect-ai/prime-agent/pull/1236) | secure resident ACP recovery | **SKIP** — superseded by 1494, CI RED, test suite built on deleted `startIpythonFixture()` | — | — |
| [1187](https://github.com/PrimeIntellect-ai/prime-agent/pull/1187) | async `bash()` in IPython kernel | N/A as patch — **but exposes 3 real Bun-REPL gaps (D1 + orphan procs + no output cap)** | `core/bun-repl/repl-script.ts:361-370,503-566` | S–M |
| [1179](https://github.com/PrimeIntellect-ai/prime-agent/pull/1179) | tokens/sec on working loader | PORT clean — **but fix its two rate bugs first** | `modes/interactive/agent-activity.ts:6-12,108-130` | S |
| [1177](https://github.com/PrimeIntellect-ai/prime-agent/pull/1177) | typed system-prompt provenance | PORT (light) — real bug: empty custom prompt silently reverts to built-in | `core/resource-loader.ts:41-44,481-484` | S |
| [1176](https://github.com/PrimeIntellect-ai/prime-agent/pull/1176) | bind artifacts to immutable commits | SKIP as written (all node/npm); ideas portable to `scripts/pack-prime-agent-release.mjs` | — | M |
| [1175](https://github.com/PrimeIntellect-ai/prime-agent/pull/1175) | generic MCP transport foundation | PORT — host half superseded by 1495; **client half is unique and live in our tree** | `skills/{linear,notion}/mcp-client.js:35,232,328-333` | S |
| [1170](https://github.com/PrimeIntellect-ai/prime-agent/pull/1170) | MEM01 canonical fenced storage | CONFLICTS (draft; deleted `kernel/bootstrap.ts` + rewritten `refinement.ts`) | — | L |
| [1169](https://github.com/PrimeIntellect-ai/prime-agent/pull/1169) | incremental structured-output parser | SKIP for now (draft, author: "not merge-ready") | — | L |
| [1168](https://github.com/PrimeIntellect-ai/prime-agent/pull/1168) | C04 bounded child results | SKIP for now (draft) | — | L |
| [1166](https://github.com/PrimeIntellect-ai/prime-agent/pull/1166) | C03 durable terminal delivery | CONFLICTS/blocked (base PR #1130 **closed unmerged**) — **harvest the fsync nugget only** | `core/session-manager.ts:1344-1363` | S (nugget) / L (whole) |
| [1157](https://github.com/PrimeIntellect-ai/prime-agent/pull/1157) | swarm provider-neutral role policy | SKIP (stacked on unmerged C01; 3-arg call we don't have) | — | L |
| [1146](https://github.com/PrimeIntellect-ai/prime-agent/pull/1146) | preserve session-start notifications | **PORT (minimal ~60 lines) · CONTEXT-LOSS** | `modes/daemon/daemon-extension-binding.ts:200`, `daemon-mode.ts:3652,6322,6390,6927,6957` | M |
| [1145](https://github.com/PrimeIntellect-ai/prime-agent/pull/1145) | highlight @file refs and options | PORT clean (byte-identical pre-image) | new `components/prompt-highlight.ts`; `components/user-message.ts`, `slash-command-message.ts` | S |
| [1136](https://github.com/PrimeIntellect-ai/prime-agent/pull/1136) | ctrl+n creates agent at view depth | PORT clean (all anchors byte-identical) | `modes/agents-view/agents-view-mode.ts:1728-1748`, `daemon-mode.ts:1397,1636,5852`, `daemon-protocol.ts:103,141,320,367` | S |
| [1123](https://github.com/PrimeIntellect-ai/prime-agent/pull/1123) | fence daemon lifecycle by durable identity | PORT nugget (journal atomic compaction) | `modes/daemon/worker-recovery-journal.ts:106-113` | S (nugget) / M |
| [1115](https://github.com/PrimeIntellect-ai/prime-agent/pull/1115) · [1106](https://github.com/PrimeIntellect-ai/prime-agent/pull/1106) | swarm test scaffolding | SKIP (test-only, stacked) | — | — |
| [1107](https://github.com/PrimeIntellect-ai/prime-agent/pull/1107) | passivate quiescent roots after restart | **not deep-reviewed** (see §7) | — | — |
| [887](https://github.com/PrimeIntellect-ai/prime-agent/pull/887) | smooth fullscreen wheel scrolling | PORT 1-liner (taste, no bug) | `packages/tui/src/tui.ts:355` | S |
| [881](https://github.com/PrimeIntellect-ai/prime-agent/pull/881) | await post-compaction continuation | **PORT clean · CONTEXT-LOSS** | `core/agent-session.ts:6573-6596,1263-1265,7337,7436,7453-7500` | S |
| [865](https://github.com/PrimeIntellect-ai/prime-agent/pull/865) | recover stuck IPython cells | N/A as patch (DRAFT) — **port the idea → D2** | `core/bun-repl/index.ts:334-341,460-478` | M |
| [800](https://github.com/PrimeIntellect-ai/prime-agent/pull/800) | ACP answers prompts only once admitted | PORT (light rebase) · prereq for 881 | `modes/acp/acp-mode.ts:352`, `modes/daemon/daemon-mode.ts:4003-4007` | S–M |
| [795](https://github.com/PrimeIntellect-ai/prime-agent/pull/795) | fail closed on provider quota exhaustion | PORT classification now (S), defer circuit (L) · **token accounting** | `packages/ai/src/utils/stream-failure.ts:66,100,165` | S / L |
| [644](https://github.com/PrimeIntellect-ai/prime-agent/pull/644) | ACP-provided MCP servers | **not deep-reviewed** (DRAFT; see §7) | — | — |
| [638](https://github.com/PrimeIntellect-ai/prime-agent/pull/638) | trace sharing hint | N/A — **already in our tree** | `modes/interactive/feature-hints.ts:74-75` | — |
| [569](https://github.com/PrimeIntellect-ai/prime-agent/pull/569) | JSON mode types for autonomous mode | PORT (rebase) — real bug: **JSON mode exits 0 on failure** | `modes/print-mode.ts:121,145-147` | M |
| [565](https://github.com/PrimeIntellect-ai/prime-agent/pull/565) | separate active commands from queued input | PORT (translate) · **compaction priority** | `core/agent-session.ts` (no `activeSessionInput` anywhere) | M–L |
| [539](https://github.com/PrimeIntellect-ai/prime-agent/pull/539) | fix model search provider ranking | PORT clean | `modes/interactive/components/model-selector.ts:324-328` | S |
| [531](https://github.com/PrimeIntellect-ai/prime-agent/pull/531) | add claude opus 5 support | N/A — **already in our tree** | `packages/ai/src/models.generated.ts:199,323` | — |
| [525](https://github.com/PrimeIntellect-ai/prime-agent/pull/525) | harden dependency supply chain | slice (a) already applied · **slice (b) PORT · SECURITY** · slice (c) SKIP (npm) | `.github/workflows/build-binaries.yml:197` | S |
| [524](https://github.com/PrimeIntellect-ai/prime-agent/pull/524) | import coding harness sessions | PORT (feature, defer — large, off-priority) | no `core/session-import/` | L |
| [522](https://github.com/PrimeIntellect-ai/prime-agent/pull/522) | separate agent and user message queues | PORT (rebase) · **CONTEXT-LOSS** | `core/agent-session.ts:576,584,699,741,3265-3269` | L |
| [506](https://github.com/PrimeIntellect-ai/prime-agent/pull/506) | restore multi-client session resume | **CONFLICTS — HOLD** (deletes `launchEnv`; collides with 1494's direction) | `modes/daemon/daemon-supervisor.ts:434,777,1075,1092,1099-1110` | L |
| [485](https://github.com/PrimeIntellect-ai/prime-agent/pull/485) | recover sessions after interrupted updates | **PORT (translate) · DATA-LOSS** | new `daemon-update-manifest.ts` + `daemon-update-recovery.ts` | L |
| [480](https://github.com/PrimeIntellect-ai/prime-agent/pull/480) | restore attach transcripts on reconnect | PORT (translate) · **CONTEXT-LOSS** · ⚠ reconcile with our recovery journals first | `modes/daemon/daemon-client.ts:49,225`; `interactive-mode.ts:969,1475,2926,2980-2992` | L |
| [464](https://github.com/PrimeIntellect-ai/prime-agent/pull/464) | make subagent cancellation explicit | PORT (rebase; conflicting upstream) | `core/agent-session.ts:9199,9203,9518,9664-9670`, `daemon-mode.ts:269,4325-4328` | M |
| [447](https://github.com/PrimeIntellect-ai/prime-agent/pull/447) | surface refinement status and outcomes | CONFLICTS (we rewrote refinement for JS) — port the input-barrier subset only; **actively moving upstream, watch it** | `core/refinement/*`, `core/refinement-orchestrator.ts` | L |
| [427](https://github.com/PrimeIntellect-ai/prime-agent/pull/427) | Ghostty inline image placement | SKIP (DRAFT, mis-scoped: touches kernel docs + Python-era skills) | — | — |
| [413](https://github.com/PrimeIntellect-ai/prime-agent/pull/413) | disable Ghostty inline image escapes | PORT clean | `packages/tui/src/terminal-image.ts:61` | S |
| [374](https://github.com/PrimeIntellect-ai/prime-agent/pull/374) | no-env prime auth isolation | **PORT (translate) · SECURITY** | `core/auth-storage.ts:1079,1083`; `packages/ai/src/providers/openai-completions.ts:478` | M |
| [367](https://github.com/PrimeIntellect-ai/prime-agent/pull/367) | anthropic record-valued tool arguments | PORT clean (low impact today — MCP/user skills only) | `packages/ai/src/providers/anthropic.ts:1234-1257` | S |
| [305](https://github.com/PrimeIntellect-ai/prime-agent/pull/305) | plan mode enforced inside the kernel | CONFLICTS — host half portable, **guard is not** (see §5) | `cli/args.ts`, `core/agent-session-config.ts`, `core/keybindings.ts`, `core/slash-commands.ts` | L |
| [276](https://github.com/PrimeIntellect-ai/prime-agent/pull/276) | herdr env vars through daemon protocol | **SKIP — abandoned, 0 changed files confirmed** | — | — |

### 3.2 `earendil-works/pi` (50 open; 49 reviewed)

| PR | Title | Class | Lands in our tree | Effort |
|---|---|---|---|---|
| [8307](https://github.com/earendil-works/pi/pull/8307) | cache-friendly compaction (experimental) | CONFLICTS/blocked — needs `Agent.buildProviderContext()`, `core/experimental.ts`, `cacheFriendly` param, none of which we have | — | L |
| [8302](https://github.com/earendil-works/pi/pull/8302) | Amazon Bedrock Mantle | SKIP (DRAFT, WIP, AWS npm deps) | — | M |
| [8297](https://github.com/earendil-works/pi/pull/8297) | exclude superseded retry attempts from restored context | **PORT (translate) · CONTEXT-LOSS** | `core/agent-session.ts:10353-10357,8131-8136,8295-8300`; `session-manager.ts:53,478,1487,1908`; ⚠ positional collision at `compaction/compaction.ts:636` | M–L |
| [8293](https://github.com/earendil-works/pi/pull/8293) | Baseten GLM-5.2 text-only | N/A (no Baseten provider) | — | — |
| [8291](https://github.com/earendil-works/pi/pull/8291) | configurable editor prompt prefix | SKIP (cosmetic; blocked upstream) | — | M |
| [8287](https://github.com/earendil-works/pi/pull/8287) | replace AI Gateway binding shim | N/A (no binding shim; Workers-only) | — | — |
| [8283](https://github.com/earendil-works/pi/pull/8283) | restore continuation after retry+compaction | **PORT (near-clean) · CONTEXT-LOSS** | `core/agent-session.ts:8295-8300` | S |
| [8262](https://github.com/earendil-works/pi/pull/8262) | hooks on every turn-start path | CONFLICTS — bug is real for us (`runBeforeAgentStart: false` on customTrigger) but our admission pipeline differs | `core/agent-session.ts` `_turnExecutionPolicy`, `:5968` | L |
| [8254](https://github.com/earendil-works/pi/pull/8254) | prevent copilot policy login rate limits | CONFLICTS (translate) | `packages/ai/src/utils/oauth/github-copilot.ts:305,364` | M |
| [8250](https://github.com/earendil-works/pi/pull/8250) | make subagent progress/failures reliable | PORT (adapt) — today failed subagents are returned to the model as **successful** tool results | `examples/extensions/subagent/index.ts:114,413,545,554,588,711,781,863` | M–L |
| [8249](https://github.com/earendil-works/pi/pull/8249) | refresh theme-derived text on invalidation | **PORT the 1-line markdown fix only**; rest CONFLICTS | `packages/tui/src/components/markdown.ts:188,225,411` | S / L |
| [8246](https://github.com/earendil-works/pi/pull/8246) | openai completions reasoning details | PORT (translate) — needs `AssistantMessage.reasoningDetails` + session round-trip check | `packages/ai/src/providers/openai-completions.ts:372-380,891-902` | M |
| [8232](https://github.com/earendil-works/pi/pull/8232) | "DONT MERGE: dev branch" | SKIP (draft, explicitly not for merge) | — | — |
| [8158](https://github.com/earendil-works/pi/pull/8158) | upgrade Mermaid terminal rendering | N/A (no mermaid; drags 3 npm lockfiles) | — | — |
| [8155](https://github.com/earendil-works/pi/pull/8155) | avoid resetting cursor blink during renders | PORT (translate 3-file → 1-file) | `packages/tui/src/tui.ts:393,443,457,512,577,625,703,1529,1962,1987` | M |
| [8141](https://github.com/earendil-works/pi/pull/8141) | preview long read lines | N/A (no `read` tool; DRAFT, author doesn't expect merge) | — | — |
| [8118](https://github.com/earendil-works/pi/pull/8118) | `requiresNonNullAssistantContent` compat flag | PORT clean (drop the `model-config.ts` hunk) | `packages/ai/src/types.ts:296`, `providers/openai-completions.ts:818,1123,1158` | S |
| [8112](https://github.com/earendil-works/pi/pull/8112) | realpath extension entries before jiti | PORT clean (1 line) | `core/extensions/loader.ts:349` (`canonicalizePath` already at `utils/paths.ts:10`) | S |
| [8085](https://github.com/earendil-works/pi/pull/8085) | cancel mouse selection with escape | CONFLICTS (no alt-screen keybinding namespace) | `packages/tui/src/fullscreen.ts:90,176,298,617` | M |
| [8066](https://github.com/earendil-works/pi/pull/8066) | visual-line caching in editor | **PORT clean — best pi PR in the set** (1.6s/keypress at 7k lines) | `packages/tui/src/components/editor.ts:1821,1879,272,554,458,464,1887,1947` | M |
| [8057](https://github.com/earendil-works/pi/pull/8057) | todo renderResult undefined on errors | PORT clean (7 lines) | `examples/extensions/todo.ts:277` | S |
| [8032](https://github.com/earendil-works/pi/pull/8032) | components receive mouse events | N/A (built entirely on `layout.ts`/`LayoutBox`, absent) | — | L |
| [7989](https://github.com/earendil-works/pi/pull/7989) | Qwen Token Plan Individual CN | SKIP (provider add, CN-region) | — | M |
| [7981](https://github.com/earendil-works/pi/pull/7981) | models.dev cost tiers for every provider | N/A/blocked — **we have no tier infra at all** (`Model.cost` has no `tiers`); we under-price long-context by ~10% | `packages/ai/src/types.ts:443`, `models.ts:51` | L (prereq) |
| [7970](https://github.com/earendil-works/pi/pull/7970) | show when transcript is scrolled up | N/A (needs `ScrollView`/flex layout) | — | M |
| [7961](https://github.com/earendil-works/pi/pull/7961) | Sonnet 5 no temperature | N/A — **already in our tree** | `packages/ai/scripts/generate-models.ts:315` | — |
| [7953](https://github.com/earendil-works/pi/pull/7953) | expose tool metadata at stream start | N/A — bug **cannot** occur here (both our paths verified correct) | `modes/print-mode.ts:106`; `modes/daemon/compact-session-stream.ts:6-52` | — |
| [7952](https://github.com/earendil-works/pi/pull/7952) | messageId/timestamp in markdown transformer | N/A (no `markdown-transform.ts`) | — | — |
| [7950](https://github.com/earendil-works/pi/pull/7950) | plan-mode progress robust and tolerant | PORT | `examples/extensions/plan-mode/utils.ts:109,130,135,141,151,161`; `index.ts:227,258` (⚠ do **not** take the `PLAN_MODE_TOOLS` line) | S–M |
| [7948](https://github.com/earendil-works/pi/pull/7948) | defer extension runtime reloads | CONFLICTS (right fix, wrong shape; also our `core/harness-reloader.ts`) | `core/extensions/{runner,types}.ts:356,664,245,345,1484` | L |
| [7801](https://github.com/earendil-works/pi/pull/7801) | lazily load syntax grammars | SKIP (DRAFT, ~4% win) | — | — |
| [7784](https://github.com/earendil-works/pi/pull/7784) | derive recovery state from record queries | N/A — bug class **cannot** occur (we have no SQLite/harness-v2 session store) | — | — |
| [7762](https://github.com/earendil-works/pi/pull/7762) | LM Studio provider | PORT optional (value = do we want local LM Studio?) | `packages/ai/src/providers/` | M |
| [7757](https://github.com/earendil-works/pi/pull/7757) | opt out of fullscreen copy-on-select | CONFLICTS (translate ~20 lines) | `packages/tui/src/tui.ts:315,798-800` | M |
| [7751](https://github.com/earendil-works/pi/pull/7751) | prevent concurrent session rewrites | **PORT the 3 entry guards only** · DATA-LOSS (partly mitigated already) | `core/agent-session.ts:7138-7152,8255,10895` (`isCompacting` exists at `:4159`) | M |
| [7742](https://github.com/earendil-works/pi/pull/7742) | Ollama Cloud support | SKIP (auto-closed by contributor gate — abandoned) | — | M |
| [7694](https://github.com/earendil-works/pi/pull/7694) | avoid Linux clipboard X11 leaks | **PORT the 1-line Linux gate only** (DRAFT; upstream will fix in the dep) | `utils/clipboard-native.ts:15`; `utils/clipboard-image.ts:279-280` | S |
| [7680](https://github.com/earendil-works/pi/pull/7680) | handle selection page keybindings | CONFLICTS — cherry-pick per-selector handlers, drop capture machinery | `packages/tui/src/keybindings.ts:43-44,164-165` | M (reduced) |
| [7648](https://github.com/earendil-works/pi/pull/7648) | retry transient Codex websocket errors | PORT (translate `api/` → `providers/`) | `packages/ai/src/providers/openai-codex-responses.ts:222,704` | M |
| [7610](https://github.com/earendil-works/pi/pull/7610) | LLM Gateway + DevPass providers | SKIP (auto-closed; duplicates OpenRouter) | — | L |
| [7602](https://github.com/earendil-works/pi/pull/7602) | configurable summarization models | CONFLICTS (every anchor diverged) — genuine value (cheap-model compaction) but a rewrite | `core/settings-manager.ts:874,899`; `compaction/compaction.ts:759` | L |
| [7548](https://github.com/earendil-works/pi/pull/7548) | sandbox issue analysis tools | N/A (~95% CI infra for a workflow we don't have; our bash tool already has the `operations` hook at `core/tools/bash.ts:40,66,145`) | — | — |
| [7148](https://github.com/earendil-works/pi/pull/7148) | experimental loadout management | SKIP (DRAFT; author: "not for merging… over-engineered") | — | — |
| [6881](https://github.com/earendil-works/pi/pull/6881) | use provider-reported cost | **PORT · TOKEN ACCOUNTING** — but fix 2 defects first (see §4) | `packages/ai/src/models.ts:62`; `providers/openai-completions.ts:1015-1022`; `providers/anthropic.ts:557` **and** `:706` | M |
| [6654](https://github.com/earendil-works/pi/pull/6654) | promptCacheKey stream option | PORT optional (cache-cost upside; opt-in) | `packages/ai/src/types.ts`; 4 OpenAI-family providers | M |
| [6572](https://github.com/earendil-works/pi/pull/6572) | render image blocks in user messages | CONFLICTS heavy (our `user-message.ts` diverged: OSC-133, slash masking) | `components/user-message.ts:1-40` | L |
| [6534](https://github.com/earendil-works/pi/pull/6534) | add developer message role | SKIP — half lands in `api/`+`harness/` we lack; maintainer hostile ("we never discussed this") | — | L |
| [6216](https://github.com/earendil-works/pi/pull/6216) | Bedrock Mantle OpenAI Responses | SKIP (duplicated by 8302; Node-only AWS SDK deps) | — | L |
| [5735](https://github.com/earendil-works/pi/pull/5735) | defer extension reload requests safely | **SKIP — superseded by 7948** (same issue lineage, same files, same tests) | — | — |
| [5262](https://github.com/earendil-works/pi/pull/5262) | Anthropic Vertex provider | SKIP unless Claude-on-Vertex is wanted (adds `google-auth-library`) | — | L |

---

## 4. Prioritised port list

Ordered by (severity × confidence) ÷ effort. Items marked ★ are **fork-original** — no upstream PR exists and none will.

### Tier 1 — do these first (all S, all confirmed live)

1. **D3 · pi #7048 compaction truncation** — `core/compaction/compaction.ts:602,873`. Add `assertSummaryComplete` (throw on `"length"`, not just `"error"`). The full patch already exists in closed PR [#7420](https://github.com/earendil-works/pi/pull/7420); lift it. *Rationale: silent, unrecoverable context destruction that looks valid. 16 lines.*
2. **★ D1 · Bun REPL `interrupt` no-op** — `core/bun-repl/repl-script.ts:503-566`. Add the missing `case "interrupt"`. *Rationale: today every Esc during a cell SIGKILLs the REPL and destroys the whole namespace. This is our own bug, in our own priority area, and nobody upstream will find it.*
3. **S8 · pa #1513 empty credential env var** — `core/resolve-config-value.ts:21-22,94-95`. Byte-identical apply. *Rationale: highest value-per-line; stops leaking an env var **name** to providers as a key.*
4. **D6 · pi #8283 continuation after retry+compaction** — `core/agent-session.ts:8295-8300`. *Rationale: we are strictly worse than upstream (we check only `error`, and strip only one message). Cheap standalone hardening even if #8297 lands later.*
5. **D5 · pa #881 await post-compaction continuation** — `core/agent-session.ts:6573-6596`. **Apply pa #800 first** (881's diff base is 800's head). *Rationale: headless/ACP silently drops the resumed turn's output.*
6. **D8 · pa #1166 fsync nugget** — `core/session-manager.ts:1344-1363`. ~20 lines; ignore the 1722-line PR around it. *Rationale: power loss can currently truncate a whole transcript to zero bytes.*
7. **D9 · pa #1495 atomic settings write** — `core/settings-manager.ts:276`. MCP-independent slice.

### Tier 2 — security, worth the awkwardness

8. **S4 · pa #374 no-env auth isolation** (M) — cross-tenant credential/team-ID leak. 5 weeks stale, expect a rebase, small stable surface.
9. **S1 + ★S1a · pa #1249 private artifacts + Bun-REPL snapshot hardening** (M) — port #1249, **then** extend its new `utils/private-files.ts` to `core/bun-repl/state-snapshot.ts`, which #1249 does not cover and which leaks REPL variable state at 0644. Decide two behaviour caveats first: harness persistence gets disabled on Windows, and HTML exports become 0600.
10. **S5 · pa #1253 cancel RLM work on teardown** (M) — plus the Bun-REPL `AbortSignal` plumbing (`core/tools/kernel-types.ts:14`, four teardown paths in `bun-repl/index.ts`). We are worse than pre-fix upstream here.
11. **S2 · pa #1251 ephemeral descendants** (M) — 19/21 files apply clean.
12. **S6 · pi #6513 Codex WebSocket account binding** (M) — unfixed upstream (PR #6539 closed). Key the cache on `(sessionId, accountId)`.
13. **S9 · pa #525(b) scope R2 secrets** (S) — `.github/workflows/build-binaries.yml:197`, ~15 lines.
14. **S3 · pa #1494 resident lifecycle** (M) — only 2 mechanical hunks reject (both `writeJsonAtomically` drift). **Supersedes #1236 and most of #1239.**

### Tier 3 — high value, larger

15. **D4 · pi #7053 parallel tool-result durability** — `packages/agent/src/agent-loop.ts:735-741`. No upstream PR; the sequential path at `:674` shows the correct shape. *Rationale: the model is fed `No result provided` for results the user watched succeed.*
16. **D7 · pi #8297 superseded retry attempts** (M–L) — after #8283. ⚠ positional collision: our `prepareCompaction(pathEntries, settings, force)` takes `force` where upstream inserts `additionalSupersededEntryIds`.
17. **D11 · pa #1146 session-start notifications** (M) — take the minimal ~60-line single-process daemon path; defer the supervisor half.
18. **D10 · pa #485 interrupted-update recovery** (L) — biggest daemon win, biggest rebase (4 weeks stale).
19. **★ D2 · Bun REPL runaway restart** (M) — restore the snapshot after respawn; add an output-growth guard before SIGKILL. Idea from pa #865 (draft), not the diff.
20. **pi #8066 editor visual-line cache** (M) — the one unambiguous pi win; 1.6s/keypress at 7k lines. Audit every `this.state.lines` write for invalidation.
21. **pa #565 → after #800/#881** (M–L) — same session-idle-contract family; includes the `/compact`-defers-its-own-refinement bug.

### Tier 4 — cheap wins, take opportunistically

`pi #8112` (1 line, `core/extensions/loader.ts:349`) · `pi #8057` (7 lines) · `pi #8118` (S, zero-risk) · `pi #8249` markdown cache-clear (1 line) · `pi #7694` Linux clipboard gate (1 line) · `pa #1136` · `pa #1145` · `pa #1372` · `pa #1519` · `pa #1252` · `pa #1177` · `pa #367` · `pa #539` · `pa #413` · `pa #887` · `pa #1175` client half (`skills/{linear,notion}/mcp-client.js` — two live bugs: `enabled` ignored, anonymous MCP impossible).

### Token accounting (our stated priority)

- **pi #6881 provider-reported cost** — **PORT, but the PR has two defects.** (a) `upstream_inference_cost` must be gated on `is_byok` or non-BYOK OpenRouter double-counts ~2×; (b) when `local <= 0` the components keep stale values while `total` is overwritten, so `input+output+cacheRead+cacheWrite ≠ total` — and our `addAssistantUsage` sums components and total independently, so `/session` would silently disagree with itself. Patch **both** `providers/anthropic.ts:557` and `:706` (upstream patches one). Our confirmed bug today: we read no reported cost at all, so zero-catalog-rate gateway models display **$0.00**.
- **pi #7981 cost tiers** — blocked; we have no tier infrastructure (`Model.cost` has no `tiers`, `calculateCost` has no tier branch). We under-price long-context by ~10%. Port the infra first or not at all.
- **pa #1179 tokens/sec** — port, but fix its two rate bugs (inflated first rate from snapshotting `completedTokens` against a later timestamp; rate decaying toward zero because `streamingStartedAt` is never cleared per assistant message, so it measures a turn average through tool execution).
- **pa #795 quota classification** (S slice) — `packages/ai/src/utils/stream-failure.ts:66`. Treating quota errors as transient causes retry amplification across concurrent subagents. Take the classification now; defer the circuit breaker.

### Sequencing constraints (do not reorder blindly)

- **pa #800 → #881 → #565** — one family (the session idle contract). #881's diff base *is* #800's head.
- **pa #1251 before #1389** — #1389's `exportForkBranch()` calls `isPersisted()` twice; #1251 renames it to `allowsPersistence()`.
- **Schema rev collision:** both #1389 and #1494 bump `DAEMON_SCHEMA_REVISION` 16→17 at `modes/daemon/daemon-protocol.ts:63`. Whichever lands second must be renumbered to 18 with a regenerated `DAEMON_SCHEMA_ID`.
- **pa #1523 needs the ~13-commit upstream-main merge first** (its `daemon-supervisor-ownership.ts` context predates our base).
- **`test/agent-session-recursion.test.ts` is deleted in our fork** — its hunks in #1493, #1510, #1253, #1251, #1494 are all N/A. Re-home or drop.
- **`src/utils/shared.ts` (`ensureDir`, `writeJsonAtomically`, `readJsonFile`) is the single recurring conflict source** — it causes rejects in #1249, #1251, #1236 and #1494. Cheapest global fix: reimplement those three on top of #1249's `private-files.ts` rather than patching call sites. That shortens every future upstream merge.
- **pa #1495 vs #1337/#1338 are mutually exclusive** (two incompatible `mcp` CLIs, two `mcp-manager.ts` rewrites). Direction is #1495.
- **pi #7948 supersedes #5735.** **pa #1494 supersedes #1236 and most of #1239.**
- ⚠ **pa #1520 has no migration.** It changes the string that `getDaemonLogPath` / `descriptorKey` / `getDaemonUpdateRestartManifestPath` hash, so existing worker-descriptor dirs and update-restart manifests become unreachable on first run after upgrade. Sessions are safe; in-flight worker adoption across the upgrade is not.
- ⚠ **pa #1495: do not take its `isAuthed` reordering.** It moves the catalog check before `bearerTokenEnvVar`, killing the documented "override catalog name + bearer auth" path, untested. Keep our ordering at `core/mcp/mcp-manager.ts:129-141`.

---

## 5. Notable N/A verdicts where the bug survived the rewrite

The brief asked specifically that Python/kernel fixes not be dismissed. Four cases where the Python patch is dead but the logic bug is alive in our JS:

| Upstream | Verdict on the patch | What actually applies to us |
|---|---|---|
| pa #1187 (async `bash()` in IPython kernel) | N/A — `tools/ipython.ts` deleted | **Three real Bun-REPL gaps:** D1 interrupt no-op; no process group on `%%bash` (`repl-script.ts:361-365` has no `detached:true`/killpg ⇒ REPL SIGKILL orphans every descendant, bypassing our own `core/orphan-process-journal.ts`); no output cap (upstream bounds 32KB tail/stream, we stream unbounded) |
| pa #865 (recover stuck IPython cells, DRAFT) | N/A — GIL/audit-hook machinery meaningless | **D2:** runaway restart discards a valid snapshot; and the flat 120s timeout kills a healthy-but-slow streaming cell exactly as upstream's `totalStreamChars` guard exists to prevent |
| pa #1175 (MCP transport, kernel half) | Python `mcp_base.py` N/A | Reimplemented as `skills/{linear,notion}/mcp-client.js` (identical 470-line duplicates) with **both** bugs live: `:232` `_resolveConfig()` ignores `enabled` (a host-disabled server still connects if creds exist); `:328-333` unconditionally sets `Authorization: Bearer` (anonymous MCP servers are impossible). Fix both copies + rebuild `dist/`. |
| pa #305 (plan mode in the kernel) | Host half PORT, **guard CONFLICTS** | Our REPL sandbox deliberately exposes dynamic import (`repl-script.ts:317,401`), so any in-process JS guard is bypassed by `await import("node:fs")`, and a `%%bash` cell (`repl-script.ts:350`, `Bun.spawn`) bypasses it outright. **The right JS answer is different, not translated:** our REPL is already a separate OS child, so plan mode should launch that child under bwrap/`sandbox-exec` read-only. ⚠ Shipping a plan mode that *claims* to block writes but doesn't is worse than shipping none. |

And two where the bug genuinely **cannot** recur, verified by reading our code:

- **pi #7953** (tool metadata at stream start) — we have no `modes/json-event.ts`; `print-mode.ts:106` writes the raw event with `partial` intact, and `compact-session-stream.ts:6-52` attaches `contentStart` carrying the whole toolCall block. Both paths already carry id + name.
- **pi #7784** (harness-v2 recovery state) — we have no SQLite/`session-backends`; the stale-open-operation-index class doesn't exist in a JSONL `SessionManager`.
- **prime-agent issue #1507** (skills become `_PrimeAgentUnavailableSkill` placeholders after compaction/kernel restore) — **structurally fixed by our JS port.** `repl-script.ts:598-625` re-imports every skill from disk on each REPL boot and `INJECTED.add(spec.global)` excludes them from both snapshot and restore, so a stale snapshot can never overwrite a live skill binding. *Residual:* a failed skill import is swallowed to stderr (`:617-620`), leaving the global `undefined` while the system prompt still advertises it. Worth a diagnostic.

---

## 6. Against our direction — SKIP list

- **pa #1349** markdownlint (`.markdownlint-cli2.yaml`, `scripts/markdownlint/no-hard-wraps.cjs`, npm lockfile churn across 67 files).
- **pa #525 slice (c)** — `packageManager: npm@11.12.1`, an `npm>=11.10.0` engine floor, `npm install --package-lock-only`, and a `node scripts/check-dependency-security.mjs` gate wired into `npm run check`. Slice (a) is already applied in our workflows; take only slice (b).
- **pa #1176** — the entire surface is `node scripts/*.mjs` + `npm ci` + `node --test`. The *hardening ideas* (refuse dirty checkout, pack from `git archive`, assert no symlinks) are legitimate and portable onto our existing `scripts/pack-prime-agent-release.mjs` with node→bun translation.
- **pa #1378** — translates each MCP tool into a session-scoped **Python** program. The concept (ACP-supplied MCP → temporary skills) is worth reimplementing in JS later.
- **pi #8158** — drags `package-lock.json`, `npm-shrinkwrap.json` and `install-lock/package-lock.json`.
- **pi #6216 / #8302 / #5262** — Node-only AWS/Google SDK deps.
- **pa #1480**, **pa #1500** — upstream process and marketing.

**Incidental finding:** our tree still ships `package-lock.json` and has no `bun.lock`. The Bun-only migration is incomplete at the lockfile layer — worth a separate ticket, independent of any port.

---

## 7. Stale, draft, abandoned — do not chase

**Confirmed abandoned**

- **pa #276** — 0 changed files, 3 commits, branch fully reverted. `MERGEABLE` on an empty diff.
- **pi #7742**, **pi #7610** — bot-closed by the contributor gate ("only `lgtm` contributors can open PRs"), untouched since.
- **pa #1236** — CI RED (3 failures), superseded by the same author's #1494.
- **pa #1166** — its base, PR #1130, is **closed and unmerged**; the C01→C02→C03 chain has a dead middle link. Body: "No merge or human-review action is requested yet."
- **pa #1337 / #1338** — stacked on an orphaned `core02-host-request-dispatcher` branch with no open PR; #1338's CI never ran build/tests.
- **pa #1157** — declares dependencies on 4 unmerged commits; its 440-line `daemon-mode` hunk calls a 3-arg `recordRlmSubagentDeletion` that doesn't exist. Body cites "attempt 5".

**Drafts (confirmed via `isDraft`)** — pa #1500, #1176, #1170, #1169, #1168, #865, #795, #644, #427 · pi #8302, #8232, #8141, #7801, #7148.

Notable author statements: **pi #7148** — *"this PR is not for merging. It's 100% over-engineered clanker slop."* **pi #8232** — literally titled "DONT MERGE". **pi #8141** — *"I do not have a strong expectation that this should merge."* **pa #1169** — *"not merge-ready."* **pa #1493** — *"intended for a later release."*

**Merge health:** 34 of 64 prime-agent PRs and 23 of 50 pi PRs are `CONFLICTING`. Everything on prime-agent older than #1136 is conflicting — that repo moves fast and the long tail (#276–#638) is largely dead. **pa #447** is the one older PR still actively maintained (updated today); watch it rather than porting it.

**Contested review:** **pa #1249** and **pa #1252** both carry `CHANGES_REQUESTED` from `Apocrathia`, undismissed for 5 days. For #1252 the objection is correct — it is not a security fix (text always travelled via stdin, there was no injection); port the code, ignore the title.

**Not deep-reviewed** (2 of 114): **pa #1107** (passivate quiescent roots after restart) and **pa #644** (ACP-provided MCP servers, DRAFT). Both fell outside the assigned batches. #1107 is daemon/session-state and probably deserves a look.

---

## 8. Open issues

### 8.1 prime-agent — the issue queue was closed

On **2026-08-15** the maintainers **mass-closed the entire issue backlog** as `NOT_PLANNED` and moved to Discussions ("we've received far more Issues than we can reliably triage"). Only 8 issues remain open and **all are maintainer epics**, not user reports — each is an "Outcome" checklist preserving a closed design PR as history:

| Issue | Epic | Relevance |
|---|---|---|
| [1384](https://github.com/PrimeIntellect-ai/prime-agent/issues/1384) | Bound transcript repair, compaction, autonomous recovery ("fail-closed summaries") | **HIGH** — same ground as D3; preserves closed PR #1165 |
| [1382](https://github.com/PrimeIntellect-ai/prime-agent/issues/1382) | Queued/interrupted/archived session lifecycle recovery ("coalesce child usage updates without losing accounting") | **HIGH** — daemon state + token accounting |
| [1381](https://github.com/PrimeIntellect-ai/prime-agent/issues/1381) | Fence daemon worker identity, recover supervisor ownership | HIGH — matches #1123/#1523 |
| [1380](https://github.com/PrimeIntellect-ai/prime-agent/issues/1380) | Make persisted session/config state crash-safe ("repair incomplete JSONL tails", "write settings atomically") | **HIGH** — exactly D8 + D9 |
| [1383](https://github.com/PrimeIntellect-ai/prime-agent/issues/1383) | Harden MCP OAuth discovery and Codex transports | MED |
| [1379](https://github.com/PrimeIntellect-ai/prime-agent/issues/1379) | CI and release compatibility hardening | LOW (npm-flavoured) |
| [1182](https://github.com/PrimeIntellect-ai/prime-agent/issues/1182) | v0.8 five-stack integration tracker | context |
| [534](https://github.com/PrimeIntellect-ai/prime-agent/issues/534) | Custom endpoint documentation gaps | LOW |

**Read this as a roadmap signal, not a bug list:** upstream has independently converged on our four priority areas. It also means the *real* bug reports now live in the closed pile.

**Recurring themes buried in the mass-close** (all `NOT_PLANNED`, all unfixed, sampled from ~50 closed on 2026-08-15):

- **Worker heap OOM in long sessions** — [#1063](https://github.com/PrimeIntellect-ai/prime-agent/issues/1063) (~4GB heap at 79% context, 1h52m), [#1288](https://github.com/PrimeIntellect-ai/prime-agent/issues/1288) (19 OOM aborts in one day, crash-recovery loop every 2–11 min). No heap-size setting exists. Reaches us — nothing in the JS port changes heap behaviour.
- **Compaction self-amplification** — [#900](https://github.com/PrimeIntellect-ai/prime-agent/issues/900): a 46.7MB / 30k-entry journal with **930 `compaction_outcome` entries, 925 from context-limit errors** and 385 `stopReason:"error"` assistants. Overflow → oversized summary request → fail → persist more debris → repeat. This is D3 + pi #8061 + pi #6879 compounding, observed in production.
- **Daemon lifecycle** — ~20 separate reports (#1416, #1417, #1455, #1491, #1222, #1200, #1199, #1148, #1235, #1072, #1291, #768, #879…). #1371 is notable: *"In-flight prompt is aborted and session archived at daemon stop/restart: the user's turn is silently lost."*
- **[#1507](https://github.com/PrimeIntellect-ai/prime-agent/issues/1507)** — IPython skills become placeholders after compaction/kernel restore. **Does not reach us** (see §5), and it is the clearest evidence that the JS skill port fixed a real class of bug.

### 8.2 pi — unfixed bugs that reach us

Verified against our code. **None of these has an open fix upstream** unless noted.

| Issue | Bug | Reaches us | Severity | Fix PR? |
|---|---|---|---|---|
| [7048](https://github.com/earendil-works/pi/issues/7048) | Compaction summary persisted truncated at token cap | **YES** `compaction.ts:602,873` | **DATA-LOSS** | #7420 **closed** — lift it |
| [7053](https://github.com/earendil-works/pi/issues/7053) | Parallel tool batches lose completed results | **YES** `agent-loop.ts:735-741` | **DATA-LOSS** | none |
| [8061](https://github.com/earendil-works/pi/issues/8061) | Context budget ignores `maxTokens` output reservation ⇒ 400 at 78% input, and overflow recovery retries with the same oversized reservation and fails again | **YES** `compaction.ts:229-232` (`contextTokens > contextWindow - reserveTokens`, default 16384 at `:130`) | **TOKEN ACCOUNTING / wedged session** | none |
| [6879](https://github.com/earendil-works/pi/issues/6879) | Auto-compaction never triggers mid-turn; context sails past 100% until the provider rejects | **YES** — check is at the assistant-message boundary, `agent-session.ts:8156` | **TOKEN ACCOUNTING** | 3 PRs, all closed |
| [7724](https://github.com/earendil-works/pi/issues/7724) | Cold restore replays an overflow assistant that live recovery removed | **YES** | **CONTEXT-LOSS** | #8283, #8297 open |
| [6513](https://github.com/earendil-works/pi/issues/6513) | Codex WebSocket cache keyed only on session ID ⇒ cross-account request routing | **YES** `openai-codex-responses.ts:857,898` | **SECURITY** | #6539 **closed** |
| [7395](https://github.com/earendil-works/pi/issues/7395) | `--mode json` serializes cumulative assistant state on every delta ⇒ quadratic output, long stdout drains | **YES** `modes/print-mode.ts:107` writes the raw event with `partial` intact | **PERF — directly hits harness-arena's headless runs** | none |
| [7995](https://github.com/earendil-works/pi/issues/7995) | `openai-responses` has no `cacheControlFormat: "anthropic"` ⇒ measured **2.5× cost** for Claude via OpenRouter (870-trial benchmark, zero variance) | **YES** — we have the same completions/responses split | **TOKEN ACCOUNTING** | none |
| [8166](https://github.com/earendil-works/pi/issues/8166) | `sendMessage(triggerTurn:false)` from inside a `tool_call` handler while streaming appends between the assistant `tool_calls` and its `toolResult`s, breaking adjacency ⇒ every later turn 400s | **YES** `agent-session.ts:5998` has the same fall-through | correctness (session-fatal) | #8209 closed |
| [7600](https://github.com/earendil-works/pi/issues/7600) | X11 connection leak — 182 sockets over 8 days, fills Xorg's 256-client table | **PARTIAL** — we gate on `DISPLAY\|\|WAYLAND_DISPLAY` (`clipboard-native.ts:12`) but still load the addon on Linux | resource leak | #7694 (draft) |
| [8036](https://github.com/earendil-works/pi/issues/8036) | `edit` tool crashes the TUI rendering a ~14.5MB diff — **and again on every session resume** | **LIKELY** — we have `ToolExecutionComponent` (`components/tool-execution.ts:69`) and no diff-size cap in `core/tools/edit-diff.ts` | crash / session unopenable | none |
| [5886](https://github.com/earendil-works/pi/issues/5886) | Meta-issue: `agent_end` is an agent-loop boundary, not an `AgentSession` settlement ⇒ `Cannot continue from message role: assistant` across compaction, retry, queued steering, RPC hosts | **YES** — same family as pa #800/#881/#565 | CONTEXT-LOSS | partial |
| [8028](https://github.com/earendil-works/pi/issues/8028) | `fullRender` `RangeError: Invalid string length` past the V8 string limit | likely | crash | none |
| [7730](https://github.com/earendil-works/pi/issues/7730) · [7772](https://github.com/earendil-works/pi/issues/7772) · [6665](https://github.com/earendil-works/pi/issues/6665) | High CPU / memory in long sessions; TUI pins a core while streaming (uncached `Intl.Segmenter`, per-chunk Markdown rebuild) | likely | PERF | #8066 helps |
| [8133](https://github.com/earendil-works/pi/issues/8133) · [7553](https://github.com/earendil-works/pi/issues/7553) | Per-model compaction settings; configurable thinking level/model for compaction | YES (single global `reserveTokens`) | feature | #7602 (conflicting) |
| [7779](https://github.com/earendil-works/pi/issues/7779) | `auth.json` / `models-store.json` at 0600 block a second trusted Unix user | YES | UX | none |
| [8305](https://github.com/earendil-works/pi/issues/8305) | pi User-Agent only sent on some API paths; others leak the OpenAI SDK default UA | YES | privacy (minor) | none |

**Explicitly does not reach us:** [8134](https://github.com/earendil-works/pi/issues/8134) (plain-HTTP proxy hang) is an undici 8.7+ `proxyTunnel` regression introduced in pi 0.84.0 — we are on **undici 7.29.0** (`packages/ai/package.json:84`). Note the converse: [7049](https://github.com/earendil-works/pi/issues/7049) asks to *upgrade* to undici 8.8.0 for correct plain-HTTP proxy forwarding, so the original proxy bug may still affect us on 7.x.

### 8.3 The compaction picture, assembled

Four separate unfixed upstream issues compound into one failure mode we can hit today:

```
6879  context sails past 100% mid-turn (check only at message boundary)
  └─ 8061  the threshold never accounted for maxTokens anyway
       └─ provider 400s
            └─ overflow recovery compacts…
                 └─ 7048  …and persists a TRUNCATED summary as the checkpoint
                      └─ 7724/8297  …which cold restore then replays alongside the failed attempt
                           └─ pa#900  …each cycle persisting more debris. Observed: 925 failed compactions in one session.
```

D3 (pi #7048) is the cheapest place to break this chain and should be first.

---

## 9. Method and caveats

- Lineage established from `package.json` workspace names and the npm registry `repository` field, not assumption.
- All 114 open PRs were enumerated and triaged by changed-file path against our tree; 111 were read at diff level. 2 were not deep-reviewed (§7); 1 (pi #8232) is a self-declared "DONT MERGE" branch.
- Every **PORT** verdict was checked by reading our code at the named `path:line`. Every **N/A** verdict states whether the bug survives in the replacement, and several did (§5).
- Several PR verdicts include defects found *in the PR itself* (pi #6881 double-counting and component/total divergence; pa #1179 rate math; pa #1495 `isAuthed` reordering; pa #1520 missing migration). Do not port those blind.
- Line numbers are against the local tree at `2a4594ed4` and will drift once the in-progress upstream-main merge lands.
- The fork tree was never written to; apply-testing ran against throwaway clones.
