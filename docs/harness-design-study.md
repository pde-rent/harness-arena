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

The floor is not the whole story. aider is cheapest because it starts blind — no repo map, no
index (`spec/fairness.md`, "Known and accepted") — and pays for it in turns instead. The
quantity that matters is `goodput` (`spec/metrics.md`): tokens spent per unit of graded
progress.

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
