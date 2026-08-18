# Harness design study

How competing terminal coding agents build their agent loop, and what our harness should change.

Sources: code and prompts read directly. `path:line` for our harness
(`/private/tmp/prime-agent`, read-only fork of prime-agent/pi) and for each competitor.
Measured token floors come from the arena's wire proxy (`spec/metrics.md`).

**Fixed prompt-token floor** — cost paid on every turn of every task, one-word-answer task,
same model, same provider, measured at the wire:

| harness | fixed prompt tokens |
|---|---|
| aider | 561 |
| **prime-agent fork (ours)** | **4,186** |
| prime-agent upstream | 4,476 |
| cline | 5,282 |
| opencode | 6,172 |
| hermes | 13,352 |
| Claude Code | 27,344 |

**Caveat, and it is a serious one.** `docs/fixed-context-open-question.md` blocks that table from
publication: `promptTokens` means different things on OpenAI-shape versus Anthropic-shape APIs
(the former includes cache reads, the latter does not), and several harnesses set explicit
`cache_control` breakpoints, so a heavy-caching harness reports a small *uncached* prompt while
sending the same context. Treat the column above as ordinal at best.

This study independently reproduces the contradiction that doc flags in §3: opencode's tool
descriptions measure ≈11k tokens on their own (see §5), against an observed 6,172-token prompt.
Both cannot be true on the same basis. That is evidence the observed figure is a cached or
partial reading, not that the tool surface is small.

Two consequences for the recommendations below. First, ranking by "floor" alone is unsafe — the
replacement decomposition (`contextTokens` / `billedInputTokens` / `cacheHitRate`) is the right
target. Second, that decomposition makes R3 (cache stability) more important, not less: a change
that does not move `contextTokens` at all can move `billedInputTokens` by an order of magnitude.

The floor is also not the whole story behaviourally. aider is cheapest partly because it starts
blind — no repo map under `--no-git` (`spec/fairness.md`, "Known and accepted") — and pays for it
in turns instead. The quantity that matters is `goodput` (`spec/metrics.md`): tokens spent per
unit of graded progress.

---

## 1. Our harness — prime-agent fork

### System prompt

Assembled in `packages/coding-agent/src/core/system-prompt.ts:39`. Composition, in order:

| block | source | measured |
|---|---|---|
| RLM base prompt | `src/core/prompts/rlm.ts:70` | 7,763 chars ≈ **1,941 tok** |
| sub-agent guidance | `src/core/prompts/rlm.ts:177` | 837 chars ≈ **209 tok** |
| continual-harness state | `src/core/refinement/refinement.ts:403` | 2,707 chars ≈ **677 tok** *with zero entries* |
| skills catalogue | `src/core/skills.ts:436` | ~2.9 KB of descriptions + ~1.4 KB XML for 12 shipped skills ≈ **1,075 tok** if all visible |
| project context (`AGENTS.md`/`CLAUDE.md`) | `src/core/resource-loader.ts:59` | repo-dependent |
| tool schema (`ipython`) | `src/core/bun-repl/tool.ts:10` | ≈ **60 tok** |

(Measured with `chars/4` by running `buildRlmPrompt`/`formatHarnessStateForPrompt` directly;
a real tokenizer will read ~10% lower.)

What it spends the budget on: the REPL contract. Persistence semantics, `%%bash` subshell
rules, `cd()`/`env`, `await import`, the `rlm()` recursion API, `agent_message` routing rules,
and the continual-harness CRUD surface. Roughly 40% of the base prompt is sub-agent and
messaging doctrine.

What it deliberately omits — and this is the reason for the 4,186 floor rather than Claude
Code's 27,344: no coding-style rules, no tone rules, no verification doctrine, no workflow
description, no directory tree, no git status, no per-tool guidance (there is one tool).

Notable verbatim:

> "Use JavaScript for reading, searching, and editing files — it gives you reusable variables
> you can slice, filter, and act on without re-reading. Always assign read/search results to
> named variables so you can revisit them later." — `rlm.ts:31`

> "Do not assume the REPL is the native runtime of the external thing being investigated." —
> `rlm.ts:25`

The base prefix is trained on — `system-prompt.ts:126` calls it "the trained
`buildRlmPrompt` prefix". Everything appended after it (sub-agent guidance, harness state,
skills, project context) is not, and is therefore the safe place to cut.

### Tool surface

**One tool.** `src/core/tools/index.ts:47`: `export const allToolNames: Set<ToolName> = new
Set(["ipython"])`. `bash.ts` and `edit.ts` exist in the tree but are never registered
(`tools/index.ts:53-70`). The schema is a single `code: string` (`bun-repl/tool.ts:10`) — about
60 tokens against Gemini CLI's ~8k and DeepSeek's ~24-tool preset.

Capabilities arrive instead as preloaded REPL bindings: `packages/coding-agent/skills/*`,
injected at `bun-repl/repl-script.ts:589-615`. The injected global set
(`repl-script.ts:185-210`) is `console`, timers, `Buffer`, `URL`, `TextEncoder`, `crypto`,
`display`, `sys`, `util`, `cd`, `pwd`, `env`, `__import`, `rlm` — **no `read`, no `grep`, no
`glob`, no `ls`**.

### Context management

- Trigger: `shouldCompact` at `compaction/compaction.ts:229` — fires only when
  `contextTokens > contextWindow - reserveTokens`, `reserveTokens` default 16,384
  (`settings-manager.ts:863`). That is ~92% of a 200k window; DeepSeek fires at 80%, Gemini at 50%.
- Retention: `keepRecentTokens` default 20,000 (`settings-manager.ts:867`), cut only at
  message boundaries that never split a tool call from its result
  (`compaction/compaction.ts:399`).
- Summary shape: a fixed template — Goal / Constraints / Progress / Key Decisions / Next Steps /
  Critical Context (`compaction/compaction.ts:465`).
- Tool results are truncated to 2,000 chars **only when serialised for the summariser**
  (`compaction/utils.ts:83`), never in live context.
- Genuinely novel: `KERNEL_PERSIST_SUMMARY_NOTE` (`compaction/compaction.ts:498`) tells the
  model its REPL variables survived compaction. No other harness studied has state that
  outlives its own context.
- Sub-agents: `rlm('task')` returns at admission, never blocks; results come back only via
  `agent_message` or files (`rlm.ts:132`).

### Codebase understanding

Fully lazy. No repo map, no index, no directory tree, no `git status` — greps for
`environment_details|directoryStructure|repoMap|git status` across `src/core` return nothing.
Eager loading is `AGENTS.md`/`CLAUDE.md` only (`resource-loader.ts:59`, `:476`).

### Turn economics

Full conversation re-sent every turn, like everyone else. The difference is what enters it:

**REPL output is not truncated at all.** `bun-repl/index.ts:339` accumulates `stdout += chunk`
with no cap, and `bun-repl/tool.ts:85-93` concatenates stdout + stderr + result + traceback
straight into the tool result. `tools/truncate.ts` (2,000 lines / 50 KB) is imported only by
`bash-executor.ts` and `tools/bash.ts` — neither of which is a registered tool. One
`console.log(await Bun.file(big).text())` puts the whole file into context permanently.

### Failure handling

- Provider retries: 3 attempts, exponential backoff from 2s (`settings-manager.ts:39-40`,
  `agent-session.ts:10300`).
- Context overflow: one recovery attempt, compact, retry (`agent-session.ts:1143`, `:8038`).
- Verification: autonomous quality gates run shell commands and feed failures back as
  continuations (`autonomous.ts:352`, `maxRetries: 3`) — but `commands` defaults to `[]`
  (`autonomous.ts:57`), i.e. off.
- **No loop guard.** No detection of repeated identical tool calls anywhere in `src/core`.

---

## 2. DeepSeek — `deepseek-ai/deepseek-harness` (DSH)

MIT, developer preview v0.1.0-rc.7, commit `99f6f02`. Node/TS monorepo, plugin architecture over
Cordis. https://github.com/deepseek-ai/deepseek-harness

Not published: the SWE-bench/Terminal-Bench framework behind DeepSeek's own paper numbers — the
V3.2 paper (arxiv 2512.02556) says those used an *internal* framework. DSH ships no benchmark
runner, loader or scorer. So "DeepSeek's harness" as a public artifact is DSH, and its eval
scaffolding could not be verified.

### System prompt

There is no monolithic prompt. `packages/core/system-prompt/src/index.ts:56-62` defines a
registry of ordered `PromptSection`s: `-100` harness identity, `0` deployment persona,
`100-199` tool guidance. Plugins register sections; assembly concatenates.

- Identity is one line: `'You are an AI agent powered by DeepSeek Harness.'`
  (`system-prompt/src/index.ts:361`).
- **Default persona is the empty string** (`packages/bundle/base/cordis.patch.yml:431`).
- Static section text across all tool packages totals ≈4.3 KB (~1.1k tok). It is spent on
  per-tool one-liners that steer *away* from the shell:
  > "Use the read tool — not shell commands like cat — to inspect text files." —
  > `packages/fs/tool-fs/src/read.ts:73`
  > "Use the grep tool — not shell grep or rg — to search file contents." —
  > `packages/fs/tool-fs-search/src/grep.ts:279`
  > "Check the `[exit code: N]` marker on every bash result; investigate failures before moving
  > on." — `packages/bash/tool-bash/src/index.ts:239`
- Largest single block is plan mode (~2.4 KB, `cordis.patch.yml:267-280`), including the
  cache-aware note: *"The tool catalog stays the same across modes for request-cache stability."*

**The important trick.** Everything dynamic is *not* in the system prompt. It is a durable
user-role snapshot re-emitted only when its text changes
(`packages/core/agent-loop/src/runtime-context.ts:64-78`):

```
Current runtime context. This snapshot supersedes earlier runtime-context snapshots.
```
(`packages/core/system-prompt/src/index.ts:239`)

`project()` returns `undefined` when the rendered text equals the retained one — no message,
no cache break. The system prefix stays byte-stable for the whole session.

### Tool surface

21 `tool-*` packages, 48 unique tool names; the CLI "standard" preset mounts ~24
(`apps/cli/config/agent-presets/standard/agent.cordis.yml`): `bash`, `read`, `read_image`,
`write`, `edit`, `glob`, `grep`, `job_output/list/kill`, `skill`, `get/create/update_goal`,
`send_message`, `interrupt_agent`, `list_agents`, `subagent`, `subagent_fork`, `workflow`,
`ralph`, `ask_user_question`, `todo_write`, `web_search`. Full schemas: `docs/tool-catalog.md`,
81 KB / 1873 lines.

Philosophy: many narrow tools **plus** a general bash, with prompt text actively discouraging
shell use for read and search. Bash is for execution, not exploration.

**DSH also ships our bet, as an opt-in mode.** Under `mode: code` the wire tool array is
filtered to `run_code` alone (`packages/core/tools/src/index.ts:996-1000`) and every other tool
is rendered into the prompt as a *typed SDK* in section `tools:sdk` at order 150
(`index.ts:875-892`). The model writes an async TS body calling `await tools.name(args)`;
nested dispatches re-enter the guarded pipeline and only the curated outer result enters
history (`packages/core/tools/src/code-mode.ts`). Default is `native` (`cordis.patch.yml:424`).

That is the single most useful data point in this study: the strongest current performer
implements the single-code-tool design, **keeps the narrow tools as the default**, and — when
in code mode — still gives the model a generated, typed API rather than prose docs.

### Context management

Four independent stages, cheapest first:

1. **Spill at creation.** Tool results over `maxInlineBytes` (50,000, `cordis.patch.yml:350-352`)
   are written to `/tmp/dsh-spill-*` (0700/0600, `packages/spill/spill-local/src/store.ts:28`).
   The model sees head + tail at half budget each (`spill-policy/src/index.ts:95-101`) plus:
   > "(… Full formatted result stored at: `<path>`. Use read with offset/limit, or grep this
   > path to search within it.)" — `spill-policy/src/index.ts:107`
2. **In-place pruning.** Results over 8,192 chars are rewritten to head 4,096 + tail 1,024 with
   `'\n\n[... tool result middle pruned ...]\n\n'` between
   (`packages/compaction/compaction-tool-result-pruner/src/config.ts:7-13`, wired at
   `cordis.patch.yml:361-365`).
3. **Compaction** at **80%** of the window, retaining a verbatim **16%** tail
   (`packages/compaction/compaction-basic/src/config.ts:20-23`). Head becomes
   `<compacted-summary>`, capped at 8,192 tokens (`summarizer.ts:21,69`). Sections: Primary
   Request and Intent / Key Technical Concepts / Files and Code / Errors and Fixes / Pending
   Jobs / Current Work / Next Step / Critical Context. The summariser request replays
   system+tools+region and puts the instruction in the *final user message*, so the KV cache is
   reused.
4. **Overflow**: provider `CONTEXT_WINDOW_EXCEEDED` triggers compaction with retention 0,
   `maxOverflowRetries: 1` (`compaction-basic/src/index.ts:180-189`).

Cuts are legal only where in-flight tool calls = 0 (`compaction/src/tool-pairing.ts:10-38`).
Token accounting is a heuristic, no tokenizer: chars/4 + 4/block + 4/message
(`packages/llm/token-meter/src/estimate.ts:13-19`).

Sub-agents: `subagent` (continuable, background by default) and `subagent_fork` (one-shot,
foreground) — `cordis.patch.yml:313-330`.

### Codebase understanding

Grep-first, read-on-demand. No repo map, no eager tree, no embeddings. `glob`/`grep` spawn
bundled `@vscode/ripgrep` directly, no shell. `AGENTS.md`/`CLAUDE.md` (+ `.local.md` overlays)
discovered upward to `.git`, byte-budgeted at 65,536 (`cordis.patch.yml:232-234`).
Read-before-edit is enforced by an event gate, not prompt text
(`packages/fs/fs-observation-policy/src/index.ts`).

### Turn economics

Tool output dominates and is re-sent verbatim — no N-turn expiry — but it is bounded three
times before it can hurt (spill → prune → compact). Read limits: 2,000 lines / 2,000 chars per
line / 50 KB (`tool-fs/src/read.ts:16`). Grep: 250 matches, 2,000 bytes per line. Glob: 100
results. Up to 10 parallel tool calls (`packages/core/agent-loop/src/constants.ts:6`).

### Failure handling

- LLM retry: `maxRetries = 2`, 500 ms → 10 s, jitter 0.1, honours `Retry-After`
  (`packages/llm/llm/src/retry-policy.ts:14-23`). Attempt count is reconstructed from the
  session log rather than held in memory (`llm-retry/src/index.ts:183-190`).
- **Repeat-tool guard** at thresholds `[3,5,8]` identical consecutive calls
  (`packages/guard/repeat-tool-reminder/src/index.ts:71-79`):
  > "The repeated calls are not making progress. Do not call this tool with these exact
  > arguments again. Inspect the latest result and choose a different action, different
  > arguments, or finish the task."
- No max-steps loop breaker in the agent loop; budget lives in the goal system.
- No test-running policy in any prompt. The only verification instruction is the goal driver:
  *"Make concrete progress and verify the result. Before claiming completion, gather
  evidence…"* (`packages/goal/goal-round-driver/src/prompt.ts:12-25`).
- Sandbox `read-only | workspace-write | danger-full-access`, default workspace-write + ask
  (`cordis.patch.yml:175,196-205`), with a one-shot escalation path
  (`packages/sandbox/sandbox/src/escalation.ts:44-56`).

---

## 3. Gemini CLI (google-gemini/gemini-cli v0.55.1)

Read from the shipped bundle:
`~/.bench-harnesses/gemini-cli/node_modules/@google/gemini-cli/bundle/chunk-TBDX7VEE.js`
(cited below as `chunk:LINE`).

### System prompt

Composed by `getCoreSystemPrompt` (`chunk:331781`): Preamble → Core Mandates → Sub-Agents →
Agent Skills → Hook Context → (Planning Workflow | Primary Workflows) → Task Tracker →
Operational Guidelines → YOLO → Sandbox → Git Repo → Contextual Instructions. Rendered size
≈24-30 KB ⇒ **~6-7.5k tokens**. Overridable via `GEMINI_SYSTEM_MD` (`chunk:333315`).

The budget goes to doctrine, including an explicit lecture on its own token economics:

> "The agent passes the full history with each subsequent message. The larger context is early
> in the session, the more expensive each subsequent turn is." — `chunk:331843`

> "Never compromise idiomatic quality or completeness … to minimize tool calls" — `chunk:331853`

> "For bug fixes, you must empirically reproduce the failure with a new test case or
> reproduction script before applying the fix." — `chunk:331859`

> "**Validation is the only path to finality.** Never assume success or settle for unverified
> changes." — `chunk:331988`

> "**Strategic Re-evaluation:** If you have attempted to fix a failing implementation more than
> 3 times … Propose a different architectural approach rather than continuing to patch the
> current one." — `chunk:331990`

> "Your own context window is your most precious resource… use sub-agents to 'compress' complex
> or repetitive work." — `chunk:331919`

### Tool surface

~24-30 narrow tools (`chunk:378373-378442`): `list_directory`, `read_file`, `grep_search`
(ripgrep-backed with a JS fallback, `chunk:378405-378412`), `glob`, `replace`, `write_file`,
`run_shell_command`, `web_fetch`, `google_web_search`, `activate_skill`, `ask_user`,
`write_todos`, `enter/exit_plan_mode`, 6× `tracker_*`, `invoke_agent`, MCP resource tools,
background-process tools. Declaration set ≈33 KB of JS source ⇒ **~8k tokens of schemas** — by
itself larger than our entire system prompt.

### Context management

- Auto-compaction at **50%** of the token limit (`DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5`,
  `chunk:334048`, checked `chunk:334174`; `DEFAULT_TOKEN_LIMIT = 1048576`, `chunk:331738`).
- Keeps the most recent **30%** (`COMPRESSION_PRESERVE_THRESHOLD = 0.3`, `chunk:334049`).
- The summary is an XML `<state_snapshot>` with `overall_goal`, `active_constraints`,
  `key_knowledge`, `artifact_trail`, `file_system_state`, `recent_actions`, `task_state`
  (`chunk:332416`) and is described as the agent's *only* memory.
- **Two-pass summarisation**: generate, then self-critique — *"Did you omit any specific
  technical details, file paths, tool results…"* (`chunk:334255`).
- **Pre-compaction tool-output eviction**: budget 50,000 tokens
  (`COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET`, `chunk:334050`); walks history newest→oldest
  and spills over-budget tool outputs to disk (`chunk:334097-334140`).
- Sub-agents as compression: `invoke_agent` plus a built-in `codebase_investigator` on Flash,
  `maxTurns: 50` (`chunk:333186-333230`); user agents default to 30 turns (`chunk:334336`).

### Codebase understanding

Grep-first, no index — but eager at session start (`getEnvironmentContext`, `chunk:333498`): a
`<session_context>` with date, platform, temp dir, workspace dirs and a **directory tree**
(`getIncludeDirectoryTree` defaults true, `chunk:376524`; `MAX_ITEMS = 200`, `chunk:320782`),
a few hundred to ~2k tokens. `GEMINI.md` hierarchy injected as `<loaded_context>` with
global/extension/project precedence (`chunk:332108-332165`). No git status.

### Turn economics

Read limits 2,000 lines / 2,000 chars per line / 20 MB (`chunk:253578-253580`), advertised in
the tool description itself (`chunk:281741`). Tool output truncated at 40,000 chars
(`DEFAULT_TRUNCATE_TOOL_OUTPUT_THRESHOLD`, `chunk:376066`) keeping head 20% / tail 80% and
spilling the rest to a file (`chunk:253981-253995`).

### Failure handling

`DEFAULT_MAX_ATTEMPTS = 10`, 5 s initial / 30 s max backoff (`chunk:307119-307123`); the API
path uses 5 (`chunk:307411`). Prompt-level: the 3-strikes rule above, sandbox auto-recovery
that retries with `additional_permissions` without asking (`chunk:332048-332060`), mandatory
build/lint/typecheck after edits (`chunk:331985`), mandatory test add/update (`chunk:331861`).

---

## 4. Codex CLI (openai/codex v0.147.0)

Read from the compiled binary `~/.bench-harnesses/codex/bin/codex` via `strings -a -n 8`
(cited as `sa8:LINE` or byte offset) — no source tree on disk.

### System prompt

**One prompt per model**, embedded in a JSON model catalog as `instructions_template`
(`sa8:36276, 36402, 36524, 36644, 36757, 36866, 37117`). Sizes: gpt-5.6-* 17,730 chars
(~4.4k tok), gpt-5.5 19,754 (~4.9k), gpt-5.4 12,896 (~3.2k), gpt-5.4-mini 11,114, gpt-5.2
21,544 (~5.4k, the only variant that inlines tool guidelines). Three swappable
`{{personality}}` variants. Separate prompts exist for review (~9.5k chars, `sa8:34299`),
compaction fallback (`sa8:26765`) and voice (`sa8:29920`).

Structure (gpt-5.6): Personality → Writing style → Technical communication → Working with the
user → Intermediate commentary → Final answer → Formatting rules → Visualizations → Rules for
getting work done → File editing constraints → Autonomy and persistence → Destructive Actions →
Using skills. The budget goes to behaviour and output shape, not tool mechanics.

> "Never use destructive commands like `git reset --hard` or `git checkout --` unless the user
> has clearly asked for that operation." — gpt-5.6 File editing constraints

> "You parallelize tool calls whenever you can… You use `multi_tool_use.parallel` for that
> parallelism, and only that. Do not chain shell commands with separators like `echo \"====\";`"
> — gpt-5.5

> "Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly
> ask… Requests for depth, thoroughness, research, investigation, or detailed codebase analysis
> do not count as permission to spawn." — byte 165,988,879

> "Heads up: Long threads and multiple compactions can cause the model to be less accurate.
> Start a new thread when possible." — byte ~167,179,150

### Tool surface

Closest to ours in spirit: **one shell tool plus one patch tool**, and no read/list/grep tools
at all. `shell_command` (`command`, `workdir`, `timeout_ms` default 10,000, `login`,
`sandbox_permissions`, `justification`, `prefix_rule`, `additional_permissions`,
`environment_id`), `exec_command` (PTY), `write_stdin`, `apply_patch` (a *freeform* tool with an
embedded Lark grammar — `"apply_patch_tool_type": "freeform"` on all 8 models), `update_plan`,
`view_image`, `request_permissions`, `get_context_remaining`, `sleep`, `tool_search`,
`web_search`, `image_generation`, plus ~10 multi-agent tools. Description text ≈9.5 KB ⇒
**~2.4k tokens**, roughly a third of Gemini's.

Exposure is dynamic: `ToolExposureSurface` = direct / deferred / code_mode, with BM25
`tool_search` over the deferred set — i.e. tools are paid for only when likely to be needed.

### Context management

Context window 272,000 on all catalog models; `auto_compact_token_limit` is **null** for all
eight ⇒ compaction runs **server-side** (`/responses/compact`, `responses_compaction_v2`), with
the local `auto_compact_fallback_prompt` only as fallback. Config knobs seen:
`reminder_threshold_tokens`, `auto_compact_fallback_buffer_tokens`,
`model_auto_compact_token_limit_scope` (`total` | `body_after_prefix`),
`RolloutBudgetConfigToml{limit_tokens, reminder_at_remaining_tokens, sampling_token_weight,
prefill_token_weight}`. Cache-friendly injection tags `<context_window_guidance>`,
`<environment_context>`, `<collaboration_mode>`. The model can query its own remaining budget
via `get_context_remaining`.

### Codebase understanding

Grep-via-shell only. No index, no eager tree, no eager git status. Eager injections:
`agents_md`, `personality`, `context_window_guidance`, `plugins_instructions`,
`collaboration_mode`, `apps_instructions`, `environments_instructions`,
`approved_command_prefixes`. `AGENTS.md` walks up (`file-system/src/find_up.rs`), capped by
`project_doc_max_bytes` ("project doc exceeds remaining budget; truncating", byte 167,087,112).
Re-injection is explicitly supersede-shaped: *"These AGENTS.md instructions replace all
previously provided AGENTS.md instructions."*

### Turn economics

Truncation is **token-based**, not byte-based: `tool_output_token_limit`, per-call
`max_output_tokens` default 10,000 tokens, and "Warning: truncated output (original token
count: N)" (byte 165,987,461). Telemetry records
`_codex_executed_tool_call_truncated{original_bytes, max_bytes, omitted_calls}`.

### Failure handling

Transport-level recovery (`recovery_succeeded` / `recovery_failed_transient` /
`recovery_failed_permanent`), SSE resume by event id, websocket→HTTP fallback. Self-correction
is prompt-level: gpt-5.2's "Validating your work" (start specific, broaden; iterate formatting
up to 3 times; never fix unrelated bugs), compressed in newer prompts to "verify it in
proportion to risk". Runtime nudges catch tool misuse: *"patch detected without explicit call
to apply_patch. Rerun as [\"apply_patch\", \"<patch>\"]"*.

---

## 5. opencode

Read from the installed bundle under `~/.opencode/node_modules`; citations are line numbers in
the extracted bundle text (`oc.txt:LINE`).

### System prompt

**Nine per-model variants** (`oc.txt:111116`). Sizes: `codex` 7,440 chars ≈1.9k tok (smallest),
default `Oi` 8,522 ≈2.1k, `muse` 9,304, gemini `Vi` 15,406 ≈3.9k (largest). Sections: Tone and
style · Proactiveness · Following conventions · Code style · Task Management · Doing tasks ·
Tool usage policy · Git/GitHub (the gemini variant adds "Core Mandates").

> "You are OpenCode, the best coding agent on the planet." — `oc.txt:110969`

> "THE PROBLEM CAN NOT BE SOLVED WITHOUT EXTENSIVE INTERNET RESEARCH." — `oc.txt:110560`

> "**Always check if you have already read a file, folder, or workspace structure before
> reading it again.**" — `oc.txt:110648`

> "You are NEVER allowed to stage and commit files automatically." — `oc.txt:110562`

The dedup instruction is worth noting: opencode pushes re-read avoidance onto the *model*,
where cline enforces it in the harness.

### Tool surface

~19 tools. Canonical set `["bash","read","edit","glob","grep","webfetch","task","todowrite",
"websearch","lsp","skill"]` (`oc.txt:111506`) plus `write` (`:111552`), `apply_patch`
(`:111619`), `plan_exit` (`:111241`), `question` (`:111250`), `invalid` (`:111556`) and 3 MCP
tools (`:111209`). Description sizes in chars: bash **3,940** (templated with OS, shell and an
entire git section), apply_patch 1,842, task 1,707, write 951, todowrite 540, question 516,
plan_exit 483, websearch 476, lsp 345, webfetch 316, read 304, skill 197, grep 179, glob 168 —
**≈11k tokens of tool descriptions**, before parameter schemas. Native JSON schemas via
`toJsonSchemaDocument` (`oc.txt:111494`).

opencode therefore spends about **five times more on tool definitions than on its system
prompt**. Its 6,172-token measured floor is mostly tool surface, not prose.

### Context management

Two independent mechanisms:

1. **Continuous pruning.** Walks backward, skips the last 2 user turns, marks completed tool
   outputs `compacted` once cumulative output exceeds 40,000 chars and pruned exceeds 20,000;
   `skill` outputs are exempt. Renders as `[Old tool result content cleared]`
   (`oc.txt:111132`, `:112566`).
2. **LLM compaction** when context exceeds `model.limit.input − min(20000, maxOutputTokens)` —
   a hard headroom subtraction, not a ratio. Preserved tail =
   `preserve_recent_tokens ?? min(15000, max(2000, floor(limit*0.25)))`, turn-aligned
   (`oc.txt:111132`).

Sub-agents: `task` takes `subagent_type`, is **resumable via `task_id`**, and can run in the
background (`oc.txt:111478-111494`), with built-in specialist prompts for file search
(`:111734`) and code review (`:111868`).

### Codebase understanding

`AGENTS.md` injected with *"These instructions replace all previously loaded ambient
instructions."* (`oc.txt:112700`). Nested `AGENTS.md` files are attached to `read` output inside
a system-reminder block (`:111474`). LSP diagnostics are **not** in the system prompt — they are
appended to `edit`/`write`/`patch` results as `<diagnostics file="...">` (`:112115`), plus a
standalone `lsp` tool (`:111561`). *Unresolved:* two ambient-context code paths coexist in the
binary (`oc.txt:112700` vs an `Instruction` service at `:111228` that also globs
`~/.claude/CLAUDE.md` and `CONTEXT.md`); which is live was not determined.

### Turn economics

Caps `maxLines = 2000`, `maxBytes = 51200`, user-overridable via `tool_output.max_lines /
max_bytes`; bash buffers `maxBytes*2` and spills to a file kept 7 days. webfetch 5 MB / 30 s /
120 s (`oc.txt:111545`). Tool outputs are re-sent verbatim every turn until pruned or compacted.

### Failure handling

Retryable predicate `/429|500|502|503|504|524/` plus rate-limit and overloaded regexes
(`oc.txt:111125`). Hard step ceiling emitting *"CRITICAL - MAXIMUM STEPS REACHED … Tools are
disabled until next user input"* (`:112688`).

---

## 6. cline and aider

### cline (CLI v3.0.55)

Installed at `~/.bench-harnesses/cline/node_modules/@cline/*`. The prompts ship as plain string
constants in the type declarations, so they can be read exactly rather than recovered from a
bundle.

**Correction to a common assumption:** this CLI does **not** use XML-in-prompt pseudo-tools. That
was the VSCode extension's design. The CLI uses native function calling with JSON schemas —
verified by `toJSONSchema` usage in `@cline/shared/dist/index.js` and by the tool definitions in
`@cline/core/dist/index.js`.

**System prompt.** Two variants, measured by parsing the constants:
`DEFAULT_CLINE_SYSTEM_PROMPT` 3,695 chars ≈ **924 tok**, `YOLO_CLINE_SYSTEM_PROMPT` 2,847 chars
≈ **712 tok** (`@cline/shared/dist/prompt/system.d.ts:1-2`). Plan-mode instructions add 1,759
chars when active (`prompt/cline.d.ts:14`). Placeholders `{{CLINE_RULES}}` and
`{{CLINE_METADATA}}` are appended last. The `<env>` block is **inside the system prompt** — four
lines: platform, date, IDE, cwd — not a per-turn re-injection.

The budget goes almost entirely to two things: parallelism and verification.

> "You can call multiple tools in a single response. Before using tools, identify every
> independent read, search, command, or edit needed for the next step and emit all of those tool
> calls now… Do not split independent reads, searches, checks, or edits across separate turns."
> — `prompt/system.d.ts:1`

> "Always verify the files you have edited or created at the end of the task to ensure they are
> completed and working as expected." — `prompt/system.d.ts:1`

> "After applying your fix, you must run the relevant test suite to confirm your changes actually
> resolve the problem. If tests fail, analyze the failures, revise your fix, and re-run until
> tests pass. Do not consider the task complete until the test suite related to the files you
> have touched passes." — YOLO variant, `prompt/system.d.ts:2`

The YOLO (background) variant also forces an explicit terminator: *"You should only end the task
when all the requirements are met by calling the `submit_and_exit` tool."*

**Tool surface.** Core set: `read_files`, `search_codebase`, `run_commands`,
`fetch_web_content`, `apply_patch`, `editor`, `skills`, `ask_question`, `submit_and_exit`,
`spawn_agent`, plus ~18 `team_*` multi-agent tools (extracted from
`@cline/core/dist/index.js`). Core descriptions total ≈4,368 chars ≈ **1,092 tok** (approximate:
extracted by locating each `name:"x", description:` pair in the minified bundle, so a couple of
lengths may be mis-attributed). Note the plural names — `read_files`, `run_commands` take
arrays, which is how the prompt's parallelism doctrine is actually cashed in: batching lives in
the schema, not only in the prose.

**Context management.** Compaction ratios observed in `@cline/core/dist/index.js` as minified
constants `uk = 0.5` and `cF = 0.7`, combined as
`modelMaxTokens < maxInputTokens ? floor(maxInputTokens*0.5) : floor(triggerTokens*0.7)`,
clamped to `min(maxInputTokens, triggerTokens-1)`. A `0.9` factor also appears nearby. The exact
composition was not fully resolved from the minified source — treat the ratios as observed, not
as a confirmed policy.

**Turn economics.** Head-and-tail truncation with explicit model-facing guidance, e.g.
*"truncated (start and end preserved); pipe through grep/head/tail when…"* and
*"truncated N chars to fit provider request budget"* — i.e. there is a per-request rebuild pass
that re-truncates to fit, not only a one-time cap at creation.

**Codebase understanding.** `AGENTS.md` (5 references) and `.clinerules` are discovered
unconditionally; `spec/fairness.md` records the measured leak at +197 tokens and notes there is
no switch to disable it.

### aider

Installed at `~/.bench-harnesses/aider/venv/lib/python3.12/site-packages/aider`.

**System prompt.** `coders/editblock_prompts.py:8` — the whole `main_system` is under 30 lines:

> "Act as an expert software developer. Always use best practices when coding. Respect and use
> existing conventions, libraries, etc that are already present in the code base."

then a numbered procedure whose entire content is the edit protocol: ask for files you need,
explain in a few sentences, emit `*SEARCH/REPLACE` blocks, and
*"ONLY EVER RETURN CODE IN A *SEARCH/REPLACE BLOCK*!"*. Two example messages follow
(`editblock_prompts.py:31-55`) — few-shot demonstrations of the format rather than instructions.
`coders/base_prompts.py` is 2,384 bytes; `coders/editblock_prompts.py` 5,723;
`prompts.py` 2,354.

**Tool surface: zero.** There are no tool schemas at all. Edits are text the model writes into
its reply and aider parses. That is the whole explanation of the 561-token floor — not a leaner
prompt, but the complete absence of a tool surface.

**Context management.** `models.py:346`:
`self.max_chat_history_tokens = min(max(max_input_tokens / 16, 1024), 8192)` — a hard cap on
chat history, floor 1,024, ceiling 8,192, defaulting to 1,024 (`models.py:327`). Beyond it,
history is summarised (`history.py:27` `summarize`, `:33` `summarize_real`, `:98`
`summarize_all`).

**Codebase understanding.** A repo map exists (`repomap.py`) gated on `use_repo_map`, set
per-model (`models.py:424` onward). The arena runs aider with `--no-git`, so the map is empty and
aider starts blind (`spec/fairness.md`, "Known and accepted") — the 561 figure is therefore a
lower bound that would not hold on a git-backed corpus.

**Failure handling.** No agentic verification loop: aider proposes edits and the user (or a
`--auto-test` command) drives validation. It is a different point on the curve — cheapest floor,
most turns, least autonomy.

---

## 7. Comparison

### System prompt and fixed floor

| | ours | DeepSeek DSH | Gemini CLI | Codex CLI | opencode | cline | aider |
|---|---|---|---|---|---|---|---|
| prompt tokens | ~2.8k assembled | ~1.1k static sections | ~6-7.5k | 3.2-5.4k per model | 1.9-3.9k (9 variants) | ~0.9k | ~1.3k |
| tool schema tokens | **~60** | ~24 tools, 81 KB catalogue | ~8k | ~2.4k | **~11k** | ~1.1k core | **0** |
| measured wire floor (blocked, see caveat) | **4,186** | not measured | not measured | not measured | 6,172 | 5,282 | 561 |
| budget spent on | REPL contract + delegation doctrine | per-tool one-liners | doctrine, validation, economics lecture | behaviour, output shape, destructiveness | tone + tool descriptions | parallelism + verification | edit format |
| deliberately omits | style, tone, verification, workflow | persona, tone, style, safety prose | tool mechanics | tool mechanics | — | — | everything |

### Tools

| | philosophy | count |
|---|---|---|
| ours | one general code-execution tool | **1** |
| DSH | narrow tools + bash; opt-in `code` mode filtering to `run_code` with a generated typed SDK | ~24 of 48 |
| Gemini | many narrow | ~25-30 |
| Codex | one shell + one freeform patch tool, dynamic exposure with BM25 `tool_search` | ~24 max, gated |
| opencode | many narrow, very verbose descriptions | ~19 |
| cline | narrow tools, native function calling, **array-valued** so one call batches many reads/commands | ~10 core + ~18 `team_*` |
| aider | none — the model emits SEARCH/REPLACE blocks | 0 |

### Context management

| | trigger | keeps | continuous eviction between compactions |
|---|---|---|---|
| ours | `window − 16,384` (~92%) | 20,000 tok tail | **none** |
| DSH | 80% | 16% tail | spill @50 KB → file; prune @8,192 chars → head 4k + tail 1k |
| Gemini | 50% | 30% tail | pre-compaction tool-output eviction, 50k-token budget, spill to disk |
| Codex | server-side | unknown | per-call 10,000-token output cap |
| opencode | `input_limit − min(20k, maxOut)` | `min(15k, max(2k, 25%))` | prune @40k chars → `[Old tool result content cleared]` |
| cline | ratios `0.5`/`0.7` observed, composition unresolved | — | per-request rebuild that re-truncates to fit |
| aider | history capped at `min(max(maxInput/16, 1024), 8192)` | — | none |

Only two harnesses put the summarisation request *in cache-prefix position*: DSH explicitly
(`compaction-basic/src/summarizer.ts:25-30`) and Codex by doing it server-side. Ours does the
opposite (`compaction/compaction.ts:574-598`).

### Codebase understanding

| | eager | lazy |
|---|---|---|
| ours | `AGENTS.md`/`CLAUDE.md` | everything else |
| DSH | AGENTS.md (64 KB budget) | ripgrep grep/glob, read-on-demand |
| Gemini | dir tree (200 items) + GEMINI.md + platform/date | grep-first |
| Codex | AGENTS.md + env XML | grep via shell only |
| opencode | AGENTS.md + `<env>` | grep-first, LSP on demand |
| cline | `<env>` (4 lines, inside the system prompt) + AGENTS.md/.clinerules | `search_codebase`, `read_files` |
| aider | repo map (git-backed only) | — |

Nobody studied builds a semantic index. The spread is entirely in how much of the workspace is
described eagerly.

### Turn economics

Every harness re-sends the full conversation each turn. The difference is what is allowed into
it and what is allowed to stay:

- **Bounded at creation:** DSH (spill 50 KB), Gemini (40k chars), Codex (10k tokens), opencode
  (2,000 lines / 50 KB), cline (head+tail, re-truncated per request to fit the budget).
- **Bounded afterwards:** DSH pruner, Gemini pre-compaction eviction, opencode pruning pass.
- **Unbounded:** ours (`bun-repl/index.ts:339`).

### Failure handling

| | retries | loop guard | verification |
|---|---|---|---|
| ours | 3, backoff 2s (`settings-manager.ts:39`) | **none** | quality gates, **default off** (`autonomous.ts:57`) |
| DSH | 2, honours `Retry-After` | repeat-tool reminder @[3,5,8] | goal driver demands evidence |
| Gemini | 10, 5-30 s | 3-strikes rule in prompt | mandatory build/lint/typecheck + tests |
| Codex | transport-level recovery, SSE resume | — | "validate in proportion to risk"; 3 formatting iterations |
| opencode | 429/5xx predicate | hard step ceiling | — |

---

## 8. Adversarial read of our design

### Where the single-REPL bet wins, with evidence

1. **Tool schema cost is ~60 tokens** (`bun-repl/tool.ts:10`) against opencode's ~11k
   (`oc.txt:111506` and the per-tool char counts) and Gemini's ~8k (`chunk:281737-282306`).
   opencode's `bash` description alone is 3,940 chars — half of our entire base prompt. This is
   the single reason we sit at 4,186 while opencode sits at 6,172 despite our much longer prose.
2. **Composition inside one turn.** Search → filter → slice → act is one cell. A narrow-tool
   harness pays a round trip per step. The competitors claw this back with parallelism (DSH
   `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10`, `agent-loop/src/constants.ts:6`; Codex
   `multi_tool_use.parallel`) — which is a partial substitute, not an equal one.
3. **State that outlives the context window.** `KERNEL_PERSIST_SUMMARY_NOTE`
   (`compaction/compaction.ts:498`) tells the model its variables survived compaction. No other
   harness studied has any memory that survives its own summarisation. This is a genuine and
   under-exploited advantage.
4. **Delegation is a function call**, not a tool schema (`rlm.ts:132`).

### Where it loses

1. **No truncation contract — the big one.** Narrow tools own their output shape, so every
   competitor bounds output at the tool boundary. A single `code` tool cannot know what its
   output means, so ours bounds nothing: `bun-repl/index.ts:339` accumulates without a cap and
   `bun-repl/tool.ts:85-93` forwards it whole. `tools/truncate.ts` exists and is dead code with
   respect to the only registered tool. One careless `console.log` permanently inflates every
   subsequent turn.
2. **Policy has nowhere to hook.** DSH enforces read-before-edit with an event gate
   (`packages/fs/fs-observation-policy/src/index.ts`), opencode attaches LSP diagnostics to edit
   results (`oc.txt:112115`), Codex constrains destructive git commands in prompt *and* in the
   patch tool's grammar. All of those are tool-boundary hooks. With one general tool every
   policy must become prompt prose (weak) or REPL-level interception (work not done, except for
   `edit`).
3. **Trivial lookups cost authored code.** "read lines 40-80 of X" is a JSON argument elsewhere;
   here it is a program, with output tokens and a syntax-failure mode. The REPL also rewrites
   top-level declarations into globals (`bun-repl/transform.ts:1-14`) — necessary for
   persistence, but a real divergence from plain JS semantics that the model must not trip over.
4. **Discoverability costs a turn.** A narrow tool advertises its arguments in its schema. Our
   skills advertise a name and a sentence, then require reading `SKILL.md`
   (`rlm.ts:104`) — an extra round trip per new skill. DSH's code mode solves exactly this by
   rendering the tools as a *typed SDK* into the prompt (`packages/core/tools/src/index.ts:875-892`).
   We pay the single-tool discount and then pay it back in turns.
5. **Auditability.** "Run this arbitrary JS" is harder to approve than `edit(path, old, new)`.
   `spec/fairness.md` already records upstream prime-agent as executing model-authored code
   unsandboxed with no approval gate.
6. **The strongest current performer hedged.** DeepSeek implemented this design and shipped it
   as an opt-in mode with `native` as the default (`cordis.patch.yml:424`,
   `packages/core/tools/src/index.ts:996-1000`). That is not proof the bet is wrong, but it is
   evidence that the people with the most eval signal did not make it the default.

**Net:** the win is real and quantified. We are currently taking all of the costs and none of
the available mitigations, and the mitigations are cheap — bound output at the REPL boundary,
preload file primitives as bindings, and index skill APIs instead of describing them.

### What we simply lack

- **Any bound on tool output.** All six others have one. This is the biggest gap.
- **Any cheap eviction between compactions.** DSH pruner, Gemini pre-compaction eviction,
  opencode `[Old tool result content cleared]`, cline's per-request re-truncation. We go from
  "keep everything" straight to "summarise everything" at ~92% of the window.
- **Batching.** cline's `read_files` / `run_commands` take arrays and the prompt spends real
  budget insisting on it; DSH allows 10 parallel calls; Codex has `multi_tool_use.parallel`. Our
  single tool can express batching inside a cell, but nothing in the prompt tells the model to
  gather independent reads into one cell rather than one per turn — a free win we do not take.
- **Cache-stable prompt discipline for dynamic state.** DSH's supersede-shaped runtime-context
  snapshot (`runtime-context.ts:64-78`), Codex's supersede-shaped AGENTS.md re-injection. We
  mutate the system prompt mid-session instead (`agent-session.ts:2927`, `:7995`).
- **A no-progress guard.** DSH's repeat-tool reminder, Gemini's 3-strikes rule, opencode's step
  ceiling. We have none.
- **Verification doctrine.** Gemini: *"Validation is the only path to finality."* DSH's goal
  driver demands evidence before completion. We have the machinery (`autonomous.ts`) with the
  commands list empty by default.
- **Self-critique of the compaction summary.** Gemini's second pass (`chunk:334255`).
- **Editor feedback on edits.** opencode returns `<diagnostics>` with every edit result.
- A repo map. Deliberate, and shared with DSH and Codex — not a gap.

---

## 9. Recommendations, ranked by impact ÷ effort

Every item is a deletion or a rewiring of something that already exists, except R4 and R6.
The numbering is the rank.

| # | change | effort | tokens-to-goal | time-to-goal |
|---|---|---|---|---|
| R1 | gate the continual-harness block on having entries | trivial | **−677/turn** on fresh sessions | small TTFT win |
| R2 | truncate + spill REPL output | small (code exists) | removes unbounded tail | large on bad turns |
| R3 | stop mutating the system prompt mid-session | medium | neutral count, large cost | large (cache reads) |
| R4 | preload `read`/`grep`/`glob`/`ls` REPL bindings | medium | fewer output tokens/turn | fewer turns to first edit |
| R5 | make the summariser call a cache prefix | small | −(whole conversation) per compaction | faster compaction |
| R6 | repeat-call guard (prompt sentence first) | trivial | large on failing runs | large on failing runs |
| R7 | trim the skills catalogue to an index | trivial | −400-600/turn | — |
| R8 | fix `skills/edit/SKILL.md` | trivial | small | removes a failure mode |
| R9 | compact at ~80% instead of ~92% | trivial (config) | neutral | avoids overflow churn |
| R10 | gate delegation doctrine on depth budget | trivial (209 tok) / risky (467 tok) | −209 safe, −467 unsafe | — |
| R11 | one verification sentence in appended guidance | trivial | +~30/turn, −rework | fewer wrong finishes |
| R12 | one batching sentence in appended guidance | trivial | −turns × floor | fewer round trips |

Ship first: R1, R2, R8 — all trivial, none behavioural. Then R6 + R11 + R12 as a single
three-sentence prompt diff; a turn saved is worth more than any per-turn trim on this list, so
these punch above their rank. R3 and R5 are the money changes and need a measured A/B. R4 is the
one that makes the single-tool bet actually pay.

---

### R1 — gate the continual-harness block on having entries

**What.** `formatHarnessStateForPrompt` (`src/core/refinement/refinement.ts:403`) emits **2,707
chars ≈ 677 tokens with zero entries** — 16% of our measured 4,186 floor spent describing an
empty store. It is passed unconditionally (`agent-session.ts:4339`).

**Mechanism.** Return `""` when `totalEntries === 0`. Separately, delete the duplicated call
contract: `refinement.ts:432` restates at length what `rlm.ts:43` already says (skills are
preloaded bindings, read SKILL.md, `rlm()` returns at admission, no invented wrappers). Keep one
copy.

**Effect.** −677 tok on every turn of a fresh session; roughly −300 on sessions with entries.
At 30 turns that is ~20k tokens of pure floor.

**Risk.** Near zero — the model loses a description of something that does not exist. The only
care needed: when the first entry is created mid-session the block appears, which changes the
prompt — so do R3 first or the two fixes fight each other.

**Measured.** One-word-answer probe, comparing `contextTokens` at `seq=0` — not `promptTokens`,
for the reasons in `docs/fixed-context-open-question.md`. Our own harness is measured against
itself here, so the cross-shape problem does not apply, but the cache-read problem does: use the
`uncachedInput + cacheRead + cacheWrite` sum.

### R2 — truncate and spill REPL output

**What.** `ipython` results are unbounded (`bun-repl/index.ts:339`, `bun-repl/tool.ts:85-93`).

**Mechanism.** Reuse `src/core/tools/truncate.ts` — already written, already tested, currently
reachable only from the unregistered `bash` tool. Apply DSH's two-stage shape at
`bun-repl/tool.ts:85`: over ~8k chars keep head 4k + tail 1k with an explicit marker
(`compaction-tool-result-pruner/src/config.ts:7-13`); over 50 KB write the full text to a file
under the session dir and replace it with head/tail plus the retrieval hint DSH uses verbatim —
*"Full formatted result stored at: `<path>`. Use read with offset/limit, or grep this path to
search within it."* (`spill-policy/src/index.ts:107`). Truncate head **and** tail so a stack
trace keeps both its exception line and its innermost frames.

**Effect.** Caps the worst-case turn. Today the failure is silent and permanent: the oversized
result is re-sent on every subsequent turn until compaction.

**Risk.** Truncating something needed → the model re-reads. The spill file makes that recoverable
rather than lossy, which is why the spill half is not optional. Do not truncate `isError`
results below the point where the error message survives.

**Measured.** `toolResultShare`, `contextGrowthPerTurn`, `peakContext` on a task that reads a
large file.

### R3 — stop mutating the system prompt mid-session

**What.** Any harness-state write rebuilds the system prompt and reassigns
`agent.state.systemPrompt` (`agent-session.ts:2927` for kernel-side CRUD, `:7995` for `/refine`).
Prompt caching puts `cache_control` on the system prompt (`packages/ai/src/types.ts:311`), so one
`refine.run()` invalidates the cached prefix for the remainder of the session. Cache reads cost
~10% of fresh input (`packages/ai/src/cache-pricing.ts:10`), and `spec/metrics.md` notes this is
often where the cost difference between harnesses actually lives.

**Mechanism.** Copy DSH exactly. Remove `harnessState` from `buildSystemPrompt`
(`system-prompt.ts:105`, `:138`). Render it instead as a trailing user-role snapshot, re-emitted
only when its text changes — `packages/core/agent-loop/src/runtime-context.ts:64-78` returns
`undefined` when the rendered text equals the retained one — headed with the supersede line
(`packages/core/system-prompt/src/index.ts:239`):

> "Current runtime context. This snapshot supersedes earlier runtime-context snapshots."

Then delete the two rebuild call sites.

**Effect.** No change in token count; a large change in what those tokens cost and in TTFT.
On a 30-turn session with one refinement at turn 10, ~20 turns stop paying full rate on the
whole prefix.

**Risk.** Medium. State moves from a high-salience position (system prompt) to a lower one
(mid-conversation), so instruction-following on harness entries may weaken — this must be A/B'd
on solve rate, not assumed. Ordering also matters: the snapshot must land before the model acts
on it.

**Measured.** `cacheHitRate` and `billedInputTokens` (the decomposition proposed in
`docs/fixed-context-open-question.md`), plus `costDrift` (`spec/metrics.md`), on a task scripted
to force one refinement mid-session; solve rate as the guard. This is the recommendation the new
decomposition was built to make visible — `contextTokens` will not move at all.

### R4 — preload file primitives as REPL bindings

**What.** The injected global set (`bun-repl/repl-script.ts:185-210`) has `cd`, `pwd`, `env`,
`display`, `rlm` — and no `read`, `grep`, `glob`, or `ls`. Every file lookup is a program the
model must author.

**Mechanism.** Add four bindings next to `cd`/`pwd` in the same injection path
(`repl-script.ts:589-615`): `read(path, {offset, limit})`, `grep(pattern, {glob, path})` backed
by ripgrep, `glob(pattern)`, `ls(dir)` — each returning already-truncated results using the
limits from R2 and the constants everyone else converged on (2,000 lines, 2,000 chars per line,
50 KB; grep 250 matches; glob 100 results — DSH `tool-fs/src/read.ts:16`,
`tool-fs-search/src/{grep,glob}.ts`; Gemini `chunk:253578-253580`; opencode `maxLines=2000`,
`maxBytes=51200`). Advertise them by name only, in the existing runtime-label line
(`rlm.ts:3`) — not with per-tool prose. Prompt cost ≈ 20 tokens.

**Effect.** Cuts output tokens per exploration turn, removes a class of failed cells, and gives
truncation a place to live at the point of creation instead of after the fact. This is the
mitigation that makes the single-tool bet actually pay.

**Risk.** Scope creep — four names, one line, no prose. If it grows into a documented tool
catalogue we have rebuilt opencode's 11k-token surface inside our prompt.

**Measured.** `outputTokens` per turn, `toolCalls`, `firstEditMs`, cell error rate
(`isError` share of REPL results).

### R5 — make the summariser call a cache prefix

**What.** `summarizeMessages` (`compaction/compaction.ts:565-600`) serialises the entire
conversation into a single user message under a *different* system prompt
(`SUMMARIZATION_SYSTEM_PROMPT`, `compaction/utils.ts:162`). Zero cache reuse: one compaction of a
150k-token conversation costs ~150k full-rate input tokens.

**Mechanism.** DSH's comment states the design and the reason
(`compaction-basic/src/summarizer.ts:25-30`): keep the session's own system prompt, tools and
message prefix in front, and deliver the summarisation directive as the **final user message**,
so the auxiliary call is a genuine prefix of the last routed request. Carry over their guards
against the model continuing the conversation — *"Output only the checkpoint text: do not call
any tool or take any other action."* Also adopt their prior-summary rule: *"If the conversation
already contains a `<compacted-summary>` block, it is a PRIOR checkpoint. Do not copy it forward
verbatim."*

**Effect.** Turns a full-price re-read into a cache hit at every compaction.

**Risk.** The model may try to continue the conversation instead of summarising — which is
exactly what our current serialise-to-text approach was built to prevent
(`compaction/utils.ts:96`, "prevents the model from treating it as a conversation to continue").
DSH solves it with wording, not with re-serialisation. Verify the summary quality before/after,
and keep the current path as fallback.

**Measured.** `costUsd` on the compaction turn, and summary quality via solve rate after
compaction (`spec/metrics.md` records whether a run survives its compactions).

### R6 — repeat-call guard

**What.** No detection of repeated identical tool calls anywhere in `src/core`.

**Mechanism.** Cheapest version first: one sentence in the appended guidance, modelled on
Gemini's rule (`chunk:331990`) — after three failed attempts at the same fix, change approach
rather than continue patching. If measurement shows loops persisting, add DSH's harness-side
guard: thresholds `[3,5,8]` on identical consecutive calls, keyed on the normalised cell source,
injecting *"The repeated calls are not making progress. Do not call this tool with these exact
arguments again."* (`repeat-tool-reminder/src/index.ts:71-79`).

**Effect.** Loops dominate `goodput` on failed tasks — tokens spent with the grader signal flat.

**Risk.** False positives on legitimately repeated commands (re-running a test after an edit).
Trigger only on *identical consecutive* calls, which an intervening edit breaks.

**Measured.** `redundantToolCalls` (`spec/metrics.md`), and `goodput` on tasks the harness fails.

### R7 — trim the skills catalogue to an index

**What.** `formatSkillsForPrompt` (`skills.ts:436-466`) emits name, type, binding, full
description and absolute location per skill — ~2.9 KB of descriptions plus ~1.4 KB of XML for the
12 shipped skills, ≈1,075 tokens if all are visible.

**Mechanism.** For JS skills the binding name is the address; drop `<type>` and `<location>`
(derivable, and the prompt already explains how to resolve skill-relative paths at
`skills.ts:447`). Cap each description at ~120 chars. `prime-intellect`'s description alone is
499 chars.

**Effect.** −400 to −600 tokens per turn.

**Risk.** Worse skill routing. This is the one recommendation with a real accuracy trade-off, so
measure solve rate on tasks that require a specific skill, not just the floor.

**Measured.** Fixed-floor probe plus solve rate on skill-dependent tasks.

### R8 — fix `skills/edit/SKILL.md`

**What.** It documents Python keyword arguments — `await edit(path="pkg/file.py", old_str=old,
new_str=new)` — and an IPython-style shell entry point `!edit --path ... --old-str ...`. The
actual binding is positional JS: `run(path, oldStr, newStr)` (`skills/edit/skill.js:31`). The
system prompt documents the correct form (`rlm.ts:111`) and `refinement.ts:432` explicitly states
that *"Skills ship no CLI entry points, so never invoke them as shell commands."* The SKILL.md
contradicts both.

**Effect.** Removes wasted turns whenever the model follows the skill's own documentation.

**Risk.** None.

**Measured.** Cell error rate on edit-heavy tasks.

### R9 — compact at ~80% instead of ~92%

**What.** `shouldCompact` fires at `contextTokens > contextWindow − 16,384`
(`compaction/compaction.ts:229`, `settings-manager.ts:863`) — ~92% of a 200k window. DSH uses
80% (`compaction-basic/src/config.ts:20`), Gemini 50% (`chunk:334048`), opencode a 20k headroom
subtraction like ours.

**Mechanism.** Config only: raise `reserveTokens`, or switch to a ratio.

**Effect.** Neutral on tokens; avoids the overflow path (`agent-session.ts:8038`), where a
failed request is followed by compaction and a retry — a whole wasted round trip.

**Risk.** More frequent compaction means more summary-induced loss. Gemini's 50% is aggressive
because it pairs with a two-pass self-critiqued summary; ours has neither, so 80% is the right
target, not 50%.

**Measured.** `compactions` count and whether runs still succeed afterwards, plus `retries`.

### R10 — gate delegation doctrine on the depth budget

**What.** Recursion and messaging doctrine costs **467 tokens** inside `buildRlmPrompt`
(measured by rebuilding the prompt with `allowRecursion: false` and the `agent_*` skills
removed), plus **209 tokens** in `buildSubagentGuidance` (`rlm.ts:177`) — 676 tokens, ~16% of the
floor, paid on every task including the ones that never delegate. Codex takes the opposite
position and forbids sub-agents unless explicitly requested (byte 165,988,879).

**Mechanism.** The 209 is already conditional on `hasIpython` and `allowRecursion`
(`system-prompt.ts:129`) — extend it to `rlmMaxDepth > 0` and consider depth 0 as the default for
one-shot tasks.

**Risk.** The 467 sits inside the **trained** prefix — `system-prompt.ts:126` describes
`buildRlmPrompt` as "the trained `buildRlmPrompt` prefix". Cutting trained text risks
off-policy degradation that no token count will show. Treat the 209 as safe to gate and the 467
as an experiment requiring a solve-rate A/B, not a saving to book.

**Measured.** Fixed-floor probe for the token delta; solve rate on delegation-heavy tasks as the
guard.

### R11 — one verification sentence

**What.** Autonomous quality gates exist and default to no commands (`autonomous.ts:57`,
`DEFAULT_AUTONOMOUS_GATES.commands = []`). Nothing in the prompt tells the model to verify.

**Mechanism.** One line appended to guidance, not new machinery. Gemini's framing is the
tersest that works: *"Validation is the only path to finality. Never assume success or settle
for unverified changes."* (`chunk:331988`). DSH's equivalent lives in the goal driver:
*"Before claiming completion, gather evidence that the whole objective is achieved."*
(`goal-round-driver/src/prompt.ts:12-25`).

**Effect.** ~+30 tokens per turn against a reduction in confidently-wrong finishes. This is the
one place where spending tokens is likely correct.

**Risk.** Over-verification on trivial tasks inflates turns. Measure `turns` alongside solve
rate.

### R12 — one batching sentence

**What.** Nothing in our prompt tells the model to put independent reads, searches and commands
into a *single* cell. Every turn costs the full 4,186-token floor plus the whole conversation, so
a turn saved is worth more than any per-turn trimming on this list.

**Mechanism.** One line, modelled on cline's — which spends a large share of a 924-token prompt
on exactly this (`@cline/shared/dist/prompt/system.d.ts:1`): *"Before acting, identify every
independent read, search, or command the next step needs and issue them in one cell. Do not wait
for one independent result before requesting another."* This is the one place our design should
beat the many-tools harnesses outright: they need `multi_tool_use.parallel` or array-valued
schemas to batch, we just need a `Promise.all`.

**Effect.** Directly reduces `turns`, which multiplies against the floor. Cheapest item on this
list per token spent.

**Risk.** Over-batching wastes work when an early result would have made later reads
unnecessary. Scope the instruction to *independent* work, as cline does.

**Measured.** `turns`, `actionRate`, and `tokensPerTurn` (`spec/metrics.md`).

---

## Verification notes

Could not verify:

- **DeepSeek's actual eval harness.** DSH ships no benchmark runner; the V3.2 paper
  (arxiv 2512.02556) states SWE-bench Verified was scored with an internal framework. Whether
  DSH is that framework is unknown.
- **Rendered prompt token counts at runtime** for any competitor — all competitor figures are
  `chars/4` over source or bundle text, not tokenizer output. Our own figures are `chars/4` over
  actually-rendered prompts, so they are comparable to each other but ~10% high in absolute
  terms.
- **Codex numeric defaults** (`project_doc_max_bytes`, `tool_output_token_limit`, compaction
  percentage) are compiled integer constants, not strings, and were not recoverable from the
  binary. Its server-side compaction prompt is not public.
- **opencode's ambient-context path**: two code paths coexist in the binary
  (`oc.txt:112700` vs `:111228`); which is live was not determined.
- **Gemini's serialized schema size** was measured over JS source, not over the wire.
- **cline's compaction policy**: the ratios `0.5` and `0.7` are visible as minified constants in
  `@cline/core/dist/index.js`, but how they combine with `triggerTokens` was not fully resolved.
  Its per-tool description sizes were extracted from the minified bundle by pairing
  `name:"x", description:` and may be mis-attributed by a few hundred chars.
- **A common claim about cline is wrong** and worth recording: the v3.0.55 CLI uses native
  function calling with JSON schemas, not the XML pseudo-tool protocol of the VSCode extension.
  Any comparison that charges cline for an XML tool protocol is measuring the wrong artifact.
- **Our own token figures** are `chars/4` over rendered prompts, cross-checked against the
  arena's measured 4,186-token wire floor; individual block figures are not independently
  wire-verified.
