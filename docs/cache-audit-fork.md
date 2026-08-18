# Cache-discipline audit — prime-agent fork

Audited against `spec/cache-discipline.md`. Source: `/private/tmp/prime-agent` (read-only).
Every `path:line` below was opened and read. Claims carried over from
`docs/harness-design-study.md` were re-verified independently; two of its `path:line` refs were
wrong and are corrected here.

## Cost model used throughout

From `packages/ai/src/cache-pricing.ts:10-12` (VERIFIED):

| | multiple of base input price |
|---|---|
| uncached input | 1.0 |
| cache read | **0.1** |
| cache write, 5m | **1.25** |
| cache write, 1h | 2.0 |

Default retention is `"short"` (5m) — `packages/ai/src/providers/openai-completions.ts:104-112`,
`packages/ai/src/providers/anthropic.ts:54-62`. `PI_CACHE_RETENTION=long` overrides.

Define **billed-input multiple** = billed input cost ÷ (contextTokens × base input price).

- Ideal warm append-only turn: prefix read 0.1 + small delta written 1.25 ⇒ **≈0.1**
- Prefix broken (full re-write): **1.25** ⇒ **12.5× the ideal**
- No `cache_control` at all: **1.0** ⇒ **10× the ideal**

Token figures marked *measured* were produced by running `formatHarnessStateForPrompt`,
`buildRlmPrompt`, `buildSubagentGuidance` under `bun` against the read-only tree, `chars/4`. A
real tokenizer reads ~10% lower. Nothing here is estimated by eye.

---

## 1. Assembled request, in turn order

Built at `packages/agent/src/agent-loop.ts:508-512`:

```
llmContext = { systemPrompt: config.getSystemPrompt?.() ?? context.systemPrompt,
               messages: llmMessages, tools: context.tools }
```

`getSystemPrompt` is a live closure — `packages/coding-agent/src/core/agent-session.ts:8581`
(`() => this.systemPrompt`) — so it reads whatever `agent.state.systemPrompt` holds at request
build time. A mid-turn mutation lands on the *next* request with no lag. VERIFIED.

System prompt composition, default (non-custom) path,
`packages/coding-agent/src/core/system-prompt.ts:116-166`:

| # | segment | src | mutability | measured |
|---|---|---|---|---|
| 1 | RLM base prompt | `system-prompt.ts:116` → `prompts/rlm.ts:70-110` | **per-session unique** (see F2) | 5,919 ch ≈ **1,480 tok** |
| 2 | sub-agent guidance | `system-prompt.ts:131` | frozen | 837 ch ≈ **209 tok** |
| 3 | **continual-harness state** | `system-prompt.ts:138-140` | **mutates mid-session** | 2,707 ch ≈ **677 tok** *empty* |
| 4 | additional guidance | `system-prompt.ts:142-145` | frozen | 0 by default |
| 5 | project context (`AGENTS.md`/`CLAUDE.md`) | `system-prompt.ts:148-154` | frozen | repo-dependent |
| 6 | skills catalogue | `system-prompt.ts:158-160` → `skills.ts:436-467` | frozen, but see F7 | 5,564 ch ≈ **1,391 tok** (12 shipped skills) |
| 7 | appendSystemPrompt | `system-prompt.ts:162-164` | frozen | 0 by default |

Then: tool schemas (`bun-repl/tool.ts:10-15`, one tool, `code: string`, ≈60 tok — no volatile
interpolation anywhere in any tool schema, VERIFIED clean), then history, then current turn.

### Inversions

**Inversion 1 (the worst).** Segment 3 — the only mid-session-mutable segment in the whole
system prompt — sits *before* segments 4, 5, 6 and 7, all of which are frozen at session start.
`system-prompt.ts:138-140` vs `:142`, `:148`, `:158`, `:162`. A single
`rlm.harness.create_memory(...)` therefore re-bills the project-context payload and the
1,391-token skills catalogue on top of everything downstream. VERIFIED.

Note the *custom-prompt* branch of the same function gets this right — `system-prompt.ts:76-89`
puts context files and skills first, harness state at `:105`. The two branches disagree, and the
common branch is the wrong one. VERIFIED.

**Inversion 2.** Segment 1 line 6 — `Conversation log: ${messagesPath}` (`prompts/rlm.ts:85`) —
is a per-session random hex path (`session-manager.ts:332-334`, ids from `session-id.ts:30-33`).
It is stable *within* a session, so it does not break intra-session cache; it makes the prefix
unshareable *across* sessions and across parent/child agents. Same line group:
`Recursive agent depth: ${depth}` (`prompts/rlm.ts:86`) differs parent vs child by construction.
VERIFIED.

---

## 2. Findings

| # | defect | `path:line` | why it defeats cache | est. tokens / billed multiple | conf |
|---|---|---|---|---|---|
| **F1** | `cache_control` emitted for **only two** provider routes | `packages/ai/src/providers/openai-completions.ts:1112-1114` — `cacheControlFormat = "anthropic"` requires `model.id.startsWith("anthropic/")` **and** provider `openrouter` or `prime-inference` (`:1091`). Zero `cacheControlFormat` entries in `models.generated.ts` / `models.ts` / `api-registry.ts`; only the type decl `packages/ai/src/types.ts:311-312` and schema `coding-agent/src/core/model-registry.ts:125` | Anthropic models routed via any other OpenAI-compatible gateway (LiteLLM, Vercel AI gateway, Copilot, self-hosted) send **no breakpoints at all** | multiple **1.0 vs 0.1 → 10× on every turn, on the whole context** | VERIFIED |
| **F2** | Random session-id at system-prompt line 6 | `prompts/rlm.ts:85`; path from `agent-session.ts:4332` (`sessionManager.getSessionFile()`), built `session-manager.ts:332-334` | Prefix is unique per session ⇒ no cross-session reuse and, critically, **no parent↔child reuse**. Every `rlm()` spawn pays a cold write of the full ~3,760-tok fixed prefix | 3,760 tok × (1.25 − 0.1) ≈ **+4,320 billed tok per subagent spawn**; a 10-child run ≈ **+43k** | VERIFIED (cost INFERRED) |
| **F3** | System prompt rebuilt + reassigned mid-session at 7 sites | `agent-session.ts:1386-1387` (init), `:1662-1663` (rlm depth reload), `:2927-2928` (**model-initiated `rlm.harness.*` CRUD, mid-turn**), `:4154-4155` (tool-set change), `:7995-7996` (`/refine` applied), `:8424-8425` (extension resources), `:10729-10730` (`setRlmMaxDepth`). Rebuild re-reads harness state from disk each time: `:4339` → `_loadMergedHarnessState` `:7708-7714` | `cache_control` sits on the system block (`anthropic.ts:975`,`:982`,`:991`; `openai-completions.ts:650-660`; `amazon-bedrock.ts:636-640`) ⇒ one write invalidates system + tools + entire history | per event: full context at 1.25 instead of 0.1 ⇒ **12.5×** for that turn. 50k context ⇒ **+57.5k billed tok per event** | VERIFIED |
| **F4** | Empty harness block rendered unconditionally | `refinement.ts:478-480` pushes `"No saved harness entries yet."` instead of returning `""`; `:482` emits `recent refinements: 0`; passed unconditionally at `agent-session.ts:4339`, rendered at `system-prompt.ts:138` | 677 tok/turn describing an empty store, sitting at the head of the mutable region | **677 tok/turn** *measured* (2,707 chars). ≈68 billed-tok/turn warm; 846 on cold write | VERIFIED — study R1's figure reproduced exactly |
| **F5** | Monotonic counters + wall-clock ids inside the system prompt | `refinement.ts:482` `recent refinements: ${state.refinements.length}`; `:488-490` overflow count; `:449`/`:451` per-kind counts; `:465` `v${entry.version}`; refinement ids minted `refine_${new Date().toISOString()}` at `refinement.ts:848-851` and rendered at `:481` | Every refine bumps a number and injects a timestamp string into the cached prefix | subsumed by F3 (same trigger), but makes the block un-freezable in place | VERIFIED |
| **F6** | Non-deterministic skill ordering | `skills.ts:616` `Array.from(skillMap.values())` — Map insertion order seeded by `readdirSync` (`skills.ts:285`); **zero `.sort()` calls in `skills.ts`**. Feeds `formatSkillsForPrompt` (`skills.ts:452-462`) *and* `getJsSkillRuntimeInfo` (`skills.ts:242-251`) → `prompts/rlm.ts:100-107`, **line ~10 of the prompt**. `resource-loader.ts:757` `readdirSync` also unsorted, no `sort(` in the file | An FS-order change reorders a line near the top of the prefix ⇒ whole prompt invalid | 0 tok, but converts an unrelated FS event into a **1.25× full re-bill** | VERIFIED |
| **F7** | Enrichment folded into the system prompt (extensions) | `agent-session.ts:8402-8425` `extendResourcesFromExtensions` → `_resourceLoader.extendResources` → rebuild | New skills injected into the preamble rather than appended. Bounded: fires only on `startup`/`reload` (`:1404`), and only when a `resources_discover` handler exists (`:8404`) | bounded — 0 in default config | VERIFIED |
| **F8** | Compaction summariser call has no cache prefix | `compaction/compaction.ts:556-612`; `:596-600` uses `SUMMARIZATION_SYSTEM_PROMPT` (`compaction/utils.ts:162`) with the whole conversation flattened into one user message (`:573-589` via `serializeConversation`, `utils.ts:103`) | Auxiliary call shares no prefix with the session ⇒ 100% uncached | at default trigger `contextWindow − 16384` (`compaction.ts:229-233`, `settings-manager.ts:862-868`), a 200k window re-reads ≈184k at 1.0 vs 0.1 ⇒ **+166k billed tok per compaction** | VERIFIED (study cited `:565-600`; real fn is `generateSummary` at `:556-612`) |
| **F9** | Second compaction regenerates the earlier summary | `compaction.ts:578-580`, `:653-659`, `UPDATE_SUMMARIZATION_PROMPT` `:501-538` — prior summary fed as `<previous-summary>` and merged, not carried verbatim | Violates spec rule 5 ("after a cut, the new prefix is frozen too") | ~0 net — the cut invalidates from that point anyway | VERIFIED |
| **F10** | No hysteresis / min-reclaim on compaction | `compaction.ts:641-643` (refuse if last entry is a compaction), `:694-709`, `agent-session.ts:2692-2697`, `:8108-8112` — all boolean guards, no token floor, no cooldown | Currently harmless: with `reserveTokens 16384` / `keepRecentTokens 20000` one cut removes ~90% of a 200k window. Becomes the *frequent small cuts* failure mode the moment those two are tuned closer | 0 today; latent | VERIFIED constants, INFERRED arithmetic |
| **F11** | Dead `new Date()` on the default path; live date on the custom path | `system-prompt.ts:55-59` computes `date` every call; used only at `:92` (custom-prompt branch). `buildRlmPrompt` renders no date (`prompts/rlm.ts:79-110`) | Default path: harmless dead compute. Custom-prompt sessions: a midnight rollover + any rebuild flips the prefix | ~10 tok, custom path only | VERIFIED |
| **F12** | Anthropic-native OAuth path uses 4/4 breakpoints | `anthropic.ts:975` and `:982` mark **both** system blocks, `:1254` last tool, `:1203-1225` last user message | At Anthropic's 4-breakpoint limit ⇒ no headroom to add a breakpoint at a stable/mutable boundary. Nothing in the codebase counts breakpoints (VERIFIED absence) | 0 today, blocks the F13 fix | VERIFIED |
| **F13** | Bedrock sets no cachePoint on tools | `amazon-bedrock.ts:636-640` (system), `:794-804` (last **user** message). No tool cachePoint | Tool schemas re-billed on Bedrock | ≈60 tok here (one tool) — small only because the tool surface is tiny | VERIFIED |

### Verified clean (negatives worth recording)

- **Compaction shape is good.** Rare and large, not continuous nibbling. Cut is token-budget
  based (`compaction.ts:397-459` `findCutPoint`, walks back to `keepRecentTokens` = 20,000 then
  snaps to a valid boundary at `:422-431`), turn-aligned, never orphans a tool call
  (`:310-348`). VERIFIED.
- **Stored summaries are byte-stable.** Stored once (`compaction.ts:833-838`), re-materialised
  from constants each turn — `session-manager.ts:575-583` → `messages.ts:465-472` with static
  `COMPACTION_SUMMARY_PREFIX`/`SUFFIX` (`messages.ts:13-19`). No timestamp, token count, or
  "compacted N messages" reaches the wire. VERIFIED — spec rule 5 satisfied for the text itself.
- **No continuous tool-output pruning.** Compaction is the only history-mutating mechanism
  in-tree. VERIFIED absence across `packages/coding-agent/src` and `packages/agent/src`.
- **System prompt is memoised**, not rebuilt per turn — `agent-session.ts:1254`
  `_baseSystemPrompt`, rebuild sites are all event-driven. VERIFIED. (The study did not say
  otherwise, but it was worth ruling out.)
- **No context-percentage / budget counters in prompt text.** `context-tree.ts:143-151` is
  TUI-only (`agent-session.ts:11125`, `:11224`). `goals.ts:220-223,245-248,267-270` renders
  token/time budgets but into `<goal_context>` *message* text (`goals.ts:162-163`) — append-only,
  frozen into history, does not retro-invalidate. VERIFIED.
- **No git branch / status / `process.env` in any prompt string.** VERIFIED absence.
- **Tool schemas carry nothing volatile.** `bun-repl/tool.ts:11-14`, `tools/bash.ts:286-287`,
  `tools/edit.ts:39-56` — static literals or module constants only. VERIFIED.
- **Project-context file order is deterministic** — fixed candidate list, root→cwd ancestor
  chain, `resource-loader.ts:58-113`. VERIFIED.
- **Harness-state entries are sorted** deterministically inside the block
  (`refinement.ts:441-443`, by `path\0title\0id`). VERIFIED. (`overviewForPrompt`
  `refinement.ts:496-501` is *not* sorted, but it feeds `/refine` user prompts at `:871`/`:940`,
  not the system prompt.)
- **Message serialisation is deterministic.** `openai-completions.ts:743+` rebuilds the array
  from source-literal key order; no `sort`/`reverse`/Map iteration in the request path;
  `transform-messages.ts:155-176` injects `timestamp: Date.now()` but that field is never
  emitted on the wire. VERIFIED. One residual: `openai-completions.ts:888`
  `arguments: JSON.stringify(tc.arguments)` re-serialises parsed tool-call args each request —
  stable for a given in-memory object, but not guaranteed identical to the original wire bytes
  after a session reload from disk. INFERRED risk, listed as C8.
- **`transformContext` is extension-gated** (`sdk.ts:334-337` → `extensions/runner.ts:858-873`,
  which `structuredClone`s per request). No-op in default config. VERIFIED.

### Corrections to `docs/harness-design-study.md`

- R1's 677 tok / 2,707 chars for the empty harness block: **reproduced exactly**. Its
  `refinement.ts:403` ref is the function signature; the unconditional-emptiness is at `:478-480`.
- R3's `agent-session.ts:2927` and `:7995`: correct, but **incomplete** — there are 7 rebuild
  sites, not 2 (F3).
- R5's `compaction/compaction.ts:565-600`: wrong range. The function is `generateSummary` at
  `:556-612`. `utils.ts:162` is correct.
- The study does **not** contain F1, F2, F6 or F13. F1 is the largest single finding in this
  audit and is a pure infrastructure defect, not a context-engineering one.

---

## 3. Ordered change plan

Ranked by impact ÷ risk.

### C1 — emit `cache_control` on every Anthropic-shape route  *(F1)*

**Change.** Stop deriving `cacheControlFormat` from a hardcoded `model.id` prefix + two provider
names. Drive it from model/provider capability data: any model whose provider advertises
Anthropic-compatible `cache_control` gets it, with an explicit per-provider opt-out.

**Files.** `packages/ai/src/providers/openai-completions.ts:1108-1140` (detection),
`packages/ai/src/models.generated.ts` or the model-registry config that feeds
`packages/coding-agent/src/core/model-registry.ts:125`.

**Must not regress.** Gateways that reject an unknown `cache_control` field must still work —
ship with a one-shot fallback that retries without breakpoints on a 400 mentioning
`cache_control`, and never on a second attempt. Cost accounting
(`openai-completions.ts:1030-1046`) must keep `input = promptTokens − cacheRead − cacheWrite`
correct per shape.

**Proof.** Wire-proxy capture shows `cache_control` present for each configured route; `cacheRead
> 0` on turn 2 of a two-turn probe per provider; `billedInputTokens` drops ~10× with
`contextTokens` unchanged.

---

### C2 — take the per-session identity out of the system prompt  *(F2)*

**Change.** Delete `Conversation log: ${messagesPath}` (`prompts/rlm.ts:85`) and
`Recursive agent depth: ${depth}` (`:86`) from the base prompt. Emit both in a single trailing
session-header **user message** instead. Result: every agent in the tree, at every depth, in
every session, shares one byte-identical system prompt.

**Files.** `packages/coding-agent/src/core/prompts/rlm.ts:79-88`;
`packages/coding-agent/src/core/system-prompt.ts:116-124` (drop `messagesPath`, `rlmDepth` from
the base-prompt inputs); the session-header emission site in `agent-session.ts`.

**Must not regress.** The model must still be able to locate its own transcript, and
`buildChildAgentDoctrine` (`prompts/rlm.ts:90-93`) branches on `depth` — the *doctrine text*
selection can stay in the prompt (it is a small enumerable set) as long as the numeric depth is
not printed. Verify no skill reads the depth line by text.

**Proof.** Two sessions started in the same cwd with the same config produce byte-identical
`systemPrompt` (assert in CI, see §4e). Parent and child likewise. Then: `cacheWrite` on a
child's first turn drops from full-prefix to near-zero.

**Caveat.** The cross-session win only materialises inside the cache TTL — 5m by default
(`openai-completions.ts:104-112`). The parent↔child and rapid-resume wins are the real ones;
`PI_CACHE_RETENTION=long` widens it.

---

### C3 — stop mutating the system prompt mid-session  *(F3, F5)*

**Change.** Remove `harnessState` from `BuildSystemPromptOptions`
(`system-prompt.ts:35`, `:105-107`, `:138-140`). Render it instead as a trailing user-role
snapshot, re-emitted **only when its rendered text differs from the last emitted one**, headed
with a supersede line so stale snapshots are unambiguous. Then delete the rebuild+reassign pairs
at `agent-session.ts:2927-2928` and `:7995-7996`.

The remaining rebuild sites are lower-frequency but should follow: `:1662-1663` and
`:10729-10730` (rlm depth — becomes moot once C2 lands, since depth leaves the prompt),
`:4154-4155` (tool-set change — rare, and the tool array changes anyway so the break is
unavoidable), `:8424-8425` (extension resources — startup/reload only, acceptable).

**Files.** `system-prompt.ts:35,105-107,138-140`; `agent-session.ts:2920-2931`, `:7995-7996`,
`:4324-4341`; the message-emission path.

**Must not regress.** (a) A memory/skill/subagent spec created mid-session must still influence
behaviour in the same session — this is a **salience** change, from system-prompt position to
mid-conversation position, and must be A/B'd on solve rate rather than assumed. (b) `/refine`
must still take effect without a restart. (c) The snapshot must land *before* the model acts on
it, not after.

**Proof.** Scripted session containing one `rlm.harness.create_memory` and one `/refine`:
`prefixStability == 1.0` throughout, `hash(systemPrompt)` constant. Guard metric: solve rate on
the arena corpus, unchanged within noise.

---

### C4 — reorder the default branch: harness state last  *(inversion 1)*

**Change.** Move the `system-prompt.ts:138-140` block to after `:164`. One-line reorder. This is
the **safe partial** of C3: if C3 is deferred or fails its A/B, C4 alone confines the blast
radius of a harness write to a 677-token tail instead of also re-billing project context and the
1,391-token skills catalogue. It also makes the two branches of `buildSystemPrompt` agree.

**Files.** `system-prompt.ts:138-164`.

**Must not regress.** The comment at `system-prompt.ts:126-128` asserts a deliberate ordering —
sub-agent guidance immediately before the "harness-state menu", mirroring Claude Code's Agent
tool. Moving the harness block after project context and skills breaks that adjacency. See
tradeoff T2.

**Proof.** Byte-diff two prompts differing only in harness state; assert the common prefix now
extends past the skills catalogue.

---

### C5 — gate the empty harness block  *(F4)*

**Change.** `refinement.ts:478-480` — return `""` when `totalEntries === 0 &&
state.refinements.length === 0`, rather than pushing `"No saved harness entries yet."`. Gate the
whole block at `system-prompt.ts:138` on a non-empty render. Separately, delete the duplicated
call contract at `refinement.ts:432` — `prompts/rlm.ts:39` already states the harness CRUD
surface. Deletion, not addition.

**Files.** `refinement.ts:417-493`; `system-prompt.ts:138-140`.

**Must not regress.** The model must still know the harness API exists — it does, via
`prompts/rlm.ts:39` (VERIFIED present and independent).

**Proof.** `contextTokens` at `seq=0` on a fresh session drops by ≈677 (measured floor
2,707 chars).

**Ordering dependency — real.** Do **C3 (or at minimum C4) first.** Otherwise the first harness
write of a session flips the block from absent to present, which is itself a new prefix break at
a position where none existed before. The two fixes fight each other in the wrong order.

---

### C6 — give the compaction summariser a cache prefix  *(F8)*

**Change.** `generateSummary` (`compaction.ts:556-612`) keeps the session's own system prompt,
tools and message prefix in front, and delivers the summarisation directive as the **final user
message** — making the auxiliary call a genuine prefix of the last routed request.

**Files.** `compaction/compaction.ts:556-612`, `:849-871` (the split-turn variant);
`compaction/utils.ts:162`, `:501-538`.

**Must not regress.** The model must not continue the conversation instead of summarising —
which is exactly what the current serialise-to-text design exists to prevent (`utils.ts:96-103`
docblock). The replacement must carry an explicit "output only the checkpoint text; do not call
any tool" instruction, and the current path must remain as a fallback behind a flag. Summary
quality must be validated before/after, not assumed.

**Proof.** `costUsd` on the compaction turn; post-compaction solve rate as the guard.

---

### C7 — determinism: sort skills and resource paths  *(F6)*

**Change.** `.sort()` by name before returning at `skills.ts:614-618`; sort `readdirSync` output
at `resource-loader.ts:757`. Two lines.

**Files.** `skills.ts:614-618`, `resource-loader.ts:757`.

**Must not regress.** Skill *precedence* on name collision is currently insertion-ordered
(`skills.ts:545-559` collision diagnostics) — sort the **output** for rendering, do not reorder
the resolution map, or user-scoped skills may start losing to project-scoped ones.

**Proof.** Load the same skill set from two directory layouts with different `readdir` order;
assert identical `formatSkillsForPrompt` output and identical `rlm.ts:100-107` line.

---

### C8 — freeze `date`, and freeze reloaded tool-call arguments  *(F11, residual)*

**Change.** (a) Hoist `system-prompt.ts:55-59` to a session-start constant; it is dead on the
default path and a midnight landmine on the custom path. (b) Persist and replay the original
tool-call `arguments` string rather than re-serialising the parsed object at
`openai-completions.ts:888`, so a session reloaded from disk reproduces the same bytes.

**Files.** `system-prompt.ts:55-59`; `packages/ai/src/providers/openai-completions.ts:888` and
the session persistence path.

**Must not regress.** (b) must not break providers that require re-normalised JSON.

**Proof.** Save a session, reload it, assert the first request's serialised context is
byte-identical to the last pre-save request's, modulo the appended turn.

---

### C9 — free a breakpoint on the Anthropic OAuth path  *(F12)*, add a Bedrock tool cachePoint *(F13)*

**Change.** Merge or drop one of the two system-block breakpoints at `anthropic.ts:975`/`:982`;
add a tool-schema `cachePoint` in `amazon-bedrock.ts` alongside `:636-640`.

**Files.** `packages/ai/src/providers/anthropic.ts:970-995`,
`packages/ai/src/providers/amazon-bedrock.ts:630-645`, `:790-805`.

**Must not regress.** Never exceed 4 breakpoints on Anthropic — currently enforced only by
construction, with no counter anywhere (VERIFIED absence). Add the assertion while you are here.

**Proof.** Request capture shows ≤4 markers; `cacheRead` covers the tool block on Bedrock.

---

### C10 — min-reclaim guard on compaction  *(F10)*

**Change.** Refuse to compact unless the cut reclaims some floor (tokens or fraction of context).
Purely defensive: today's constants already produce rare, large cuts, but nothing in the code
prevents a config change from turning them into continuous nibbling.

**Files.** `compaction/compaction.ts:229-233`, `settings-manager.ts:862-868`.

**Proof.** `recompactionRate` (`spec/metrics.md`) stays ≤1 per 100k tokens under adversarial
`reserveTokens`/`keepRecentTokens` settings.

---

## 4. Regression test design

The tree already contains the exact instrument needed:
`packages/ai/src/providers/faux.ts:192-198` computes `commonPrefixLength` between consecutive
serialised requests, and `:201-238` reports `cacheRead` / `cacheWrite` from it, keyed by
`options.sessionId`. `serializeContext` (`faux.ts:178-190`) covers system prompt, all messages
and tools. That is an offline, deterministic, zero-cost cache simulator — the CI twin of the
arena's wire proxy.

**Harness.** A `bun test` suite driving a real `AgentSession` against `faux`, with a scripted
turn list. Capture each outgoing `Context` (via the `onPayload` hook, `sdk.ts:314-320`, or a
`streamFn` wrapper) and reduce it to a **segment-hash array**:

```
[ hash(systemPrompt), hash(msg[0]), … hash(msg[n]), hash(tools) ]
```

**Assertions.**

- **A1 — prefix only grows.** For consecutive requests *n−1, n*: the hash array of *n−1* must be
  a prefix of *n*, minus the trailing tool hash. Failure message must name the first differing
  index **and its owner** (`system` / `tools` / `message[i]`) — this is `cacheDefeatEvents`
  attribution from `spec/cache-discipline.md`, enforced rather than merely reported.
- **A2 — the system prompt never changes.** `hash(systemPrompt)` constant across the entire run.
  Stricter than A1 and separately reported, because it is the deepest and most expensive prefix.
  **Allow-list: empty.**
- **A3 — named allow-list for legitimate cuts.** A1 may drop *only* on a turn tagged
  `compaction`, and the tag must come from the harness's own compaction event
  (`compaction.ts:833-838`), not from the test asserting what it expects. Any other drop fails.
  After a compaction the new prefix must itself be stable for all subsequent turns — this is the
  test for spec rule 5, and it is the one F9 currently sits against.
- **A4 — scenario matrix.** Each scenario is a separate scripted session, each must satisfy A1+A2:
  (i) plain multi-turn; (ii) a turn calling `rlm.harness.create_memory`; (iii) `/refine`;
  (iv) `setRlmMaxDepth`; (v) tool-set change via `setActiveToolsByName`; (vi) forced compaction;
  (vii) save → reload → continue.
- **A5 — cross-agent prefix identity.** Two sessions in the same cwd with the same config must
  produce byte-identical system prompts; a parent and its `rlm()` child likewise. This is the
  standing guard for C2 and the only assertion that catches F2-class regressions, since F2 is
  invisible to A1 (it is stable *within* a session).
- **A6 — budget.** Over a 10-turn scripted run:
  `sum(cacheWrite) / sum(contextTokens) < 0.2`. A single number that fails loudly when any of the
  above is circumvented by a path the test does not model.
- **A7 — breakpoint count.** Assert ≤4 `cache_control` markers per request on the Anthropic path,
  and ≥1 on every configured provider route (the standing guard for C1 and F12).

**Determinism note.** `faux.ts:239-246` `splitStringByTokenSize` uses `Math.random()` for
chunking. That affects streaming shape, not `serializeContext`, so prefix hashes are unaffected —
but seed it anyway if the suite ever asserts on chunk boundaries.

**Wiring.** Run under `bun test` in CI on every PR touching `packages/ai/src/providers/**`,
`packages/coding-agent/src/core/{system-prompt,prompts,refinement,compaction,skills,resource-loader}/**`.
Report A1's fraction as `prefixStability` so the CI number and the arena number are the same
metric on the same definition.

---

## 5. Tradeoffs needing a human decision

**T1 — harness-state salience vs. cache (C3).** Moving continual-harness state out of the system
prompt is the single largest recurring saving, but it demotes the harness entries from the
highest-salience position in the request to a mid-conversation one. Our selling point is memory
and knowledge engineering; if instruction-following on harness entries degrades, C3 costs us the
thing we are selling. *Recommendation:* ship C3 behind a flag, A/B on arena solve rate with the
trailing-snapshot form (supersede header, re-emitted only on change), and keep C4 as the
guaranteed-safe fallback if the A/B is negative. Do not ship C3 unmeasured.

**T2 — prompt ordering doctrine vs. cache ordering (C4).** `system-prompt.ts:126-128` documents a
deliberate choice: sub-agent guidance immediately followed by the harness-state "menu", so the
model reads *when to delegate* and then sees *what it can delegate to*. Cache discipline wants
that menu at the very end, after project context and skills. *Recommendation:* C3 dissolves the
conflict (the menu leaves the prompt entirely and becomes a trailing message, which preserves the
read-then-match adjacency in conversation order). If C3 is rejected, take C4 and accept the
doctrine break — 1,391 tok of skills catalogue plus the whole `AGENTS.md` payload is a high price
for adjacency. **Human call required only if C3 is rejected.**

**T3 — session-log path vs. self-inspection (C2).** `prompts/rlm.ts:85` gives the model its own
transcript path. Removing it from the prefix is the only way to get parent↔child prefix sharing,
which for a recursion-first harness is structural, not incidental. *Recommendation:* do not
delete the capability — relocate it to a trailing session-header message, or expose it as a REPL
binding (`rlm.session_log()`) alongside the existing globals. **Needs a check nobody has done:**
grep real transcripts for whether the model actually reads that path. If it never does, delete
outright.

**T4 — cross-provider cache_control vs. gateway compatibility (C1).** Turning `cache_control` on
broadly risks 400s from gateways that reject the field. *Recommendation:* enable by default with
a one-shot no-breakpoint retry and a per-provider opt-out. A 10× billed-input multiple is too
large to leave on the table for an unquantified compatibility risk — but the retry path is not
optional.

**T5 — measurement basis.** Per `docs/fixed-context-open-question.md`, none of the improvements
above will show up in `promptTokens`. C1, C2, C3 and C6 move `billedInputTokens` and
`cacheHitRate` with `contextTokens` **flat**; only C5 and C7 move `contextTokens`. Any A/B run on
the old single-column basis will report these changes as no-ops. The decomposition must land
before the A/Bs, or the A/Bs will falsely exonerate the status quo.
