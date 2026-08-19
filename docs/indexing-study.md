# Indexing study — does a coding agent need a codebase index?

**Question (from the project owner):** does our harness — and the pre-fork prime-agent / pi it
descends from — do any codebase or knowledge parsing/indexing? Semantic or lexical search? AST
parsing, a symbol index, a lexicon? If not, would adding it actually improve anything, or would
it just cost tokens and over-complicate the stack?

**Evidence rule for this document.** Every behavioural claim carries a `path:line` or a command
that was actually run. Anything not verified from source is labelled **UNVERIFIED** and is not
used to support a conclusion.

Versions read: our fork at `/private/tmp/prime-agent` (v0.7.2, read-only clone),
`prime-agent` upstream 0.7.3, `@earendil-works/pi-coding-agent` 0.84.2, aider 0.86.2.

---

## Part 1 — Ground truth

### 1.1 Ours (`/private/tmp/prime-agent`, prime-agent fork v0.7.2)

**Tool surface is exactly one tool.**

```
packages/coding-agent/src/core/tools/index.ts:46   export type ToolName = "ipython";
packages/coding-agent/src/core/tools/index.ts:47   export const allToolNames: Set<ToolName> = new Set(["ipython"]);
packages/coding-agent/src/core/tools/index.ts:55   // The agent's code-execution tool is the Bun REPL (Bun-only fork).
```

The single tool is a persistent Bun REPL, named `ipython` for prompt/trained-prefix compatibility
(`packages/coding-agent/src/core/bun-repl/tool.ts:69`). Shell access is a `%%bash` cell inside the
same tool (`bun-repl/tool.ts:74`, dispatch at `bun-repl/repl-script.ts:352`).

| | finding | citation |
|---|---|---|
| (a) eager repo map / symbol index / file tree | **none.** `buildSystemPrompt` emits cwd, date, project context files, skills, subagent guidance and harness state — no tree, no map, no symbol list | `core/system-prompt.ts:38-165` |
| (b) lexical search | **no search tool at all.** The model must run `rg`/`grep` itself inside a `%%bash` cell. ripgrep is still *managed* (downloaded/pinned) but only for the interactive TUI file picker and postinstall, never exposed to the model | `utils/tools-manager.ts:76-93`; consumers `postinstall.ts:20`, `modes/interactive/interactive-mode.ts:1381`, `modes/agents-view/agents-view-mode.ts:730` |
| (c) AST / tree-sitter | **none.** No tree-sitter dependency, no parser, no query files anywhere under `packages/*/src` | `rg -rn "tree-sitter\|treeSitter" packages/*/src` → no hits |
| (d) LSP | **none.** Only ACP (agent-client protocol) for editor embedding, which is not a language server | `src/modes/acp/` |
| (e) embeddings / semantic search | **none.** The only `embedding` hit in the tree is an unrelated comment | `modes/acp/acp-mode.ts:424` |
| (f) session start vs on demand | at start: `AGENTS.md`/`CLAUDE.md` walk (`core/resource-loader.ts:59`, `:83-113`), skills (`core/skills.ts`, preloaded as REPL globals via `PRIME_AGENT_REPL_SKILLS`, `bun-repl/repl-script.ts:598-624`), harness state. Everything else is on demand | as cited |
| (g) does any of it enter the prompt prefix | context files, the skills block and the **mutable** harness-state block are all concatenated into the system prompt | `core/system-prompt.ts:106,131,143-157`; block built at `core/refinement/refinement.ts:403` |

**Two secondary findings that matter more than the indexing question.**

1. **Our fork bounds no tool output.** The REPL result is assembled by raw concatenation of
   stdout + stderr + result + traceback with no line, byte or char cap
   (`core/bun-repl/tool.ts:82-95`). `rg -n "truncat|MAX_|maxBytes|maxLines" src/core/bun-repl/*.ts`
   returns nothing relevant. The truncation utility exists and is exported — `DEFAULT_MAX_LINES =
   2000`, `DEFAULT_MAX_BYTES = 50KB`, `GREP_MAX_LINE_LENGTH = 500`
   (`core/tools/truncate.ts:11-13`) — and after the fork **nothing calls it**, because the tools
   that used to call it (read/grep/find/ls) were deleted. A single `cat` of a large file, or an
   unbounded `rg`, lands in context whole.
2. **We deleted search tools our ancestor still has.** See 1.2.

### 1.2 pi (`@earendil-works/pi-coding-agent` 0.84.2) — our pre-fork ancestor

The brief describes pi as "4 tools (read, bash, edit, write)"; the package description says the
same (`package.json:4`). **The installed 0.84.2 ships seven**, and three of them are navigation
tools:

```
dist/core/tools/index.d.ts:23  export type ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls";
```

| | finding | citation |
|---|---|---|
| (a) eager map/index | **none** | no repomap/symbol module in `dist/core` |
| (b) lexical search | **real, bounded, structured.** `grep` shells out to a managed ripgrep binary with `--json --line-number --color=never --hidden`, default **100 matches**, long lines cut at **500 chars**, whole output capped at 50KB | `dist/core/tools/grep.js:99` (`ensureTool("rg")`), `:140-148`, `:26` (`DEFAULT_LIMIT = 100`), `:81` (limits stated in the tool description the model sees) |
| | `read` is paged: `offset`/`limit` params, 2000-line / 50KB cap, and the description tells the model to continue with `offset` | `dist/core/tools/read.js:19-20,141` |
| | `find` wraps `fd`, default 1000 results | `dist/core/tools/find.js:7,24` |
| (c) AST / tree-sitter | **none** | no hits in `dist/core` |
| (d) LSP | **none** | — |
| (e) embeddings | **none** | — |
| (f) session start | `AGENTS.override.md` / `AGENTS.md` / `CLAUDE.md` discovery | `dist/core/resource-loader.js:32` |
| (g) prefix | context files + skills into the system prompt; **no index material** | same shape as ours |

The important delta: **pi's search results are bounded and self-describing; ours are unbounded
shell output.** The 100-match / 500-char / 50KB envelope was designed to keep a search from
eating the window. We removed the mechanism and kept nothing in its place.

### 1.3 prime-agent upstream (0.7.3)

Identical philosophy to ours, same single tool:

```
node_modules/prime-agent/dist/core/tools/index.d.ts:11  export type ToolName = "ipython";
```

Skills shipped (`node_modules/prime-agent/skills/`): agent-message, agent-observe, attach-image,
compact, edit, goal, linear, notion, prime-intellect, refine, rlm-heartbeat, skill-creator,
websearch. **No search, index, or navigation skill.** No tree-sitter, no repo map, no embeddings
(`rg -rn "ripgrep|tree-sitter|repo map|embedding" dist/core` → no hits). So the "one tool, no
index" bet is upstream's, not ours; our fork inherited it and additionally dropped pi's bounded
output helpers by dropping the tools that used them.

### 1.4 aider 0.86.2 — the one harness that really indexes

Aider is the reference implementation of the opposite bet, and it is worth reading closely
because it shows both the payoff and the price.

**How the map is built** (`aider/repomap.py`, 867 lines):

1. **Tag extraction, per file, tree-sitter.** `get_tags_raw` picks a language by extension, loads
   the grammar, runs a `.scm` tags query, and classifies captures as `def` or `ref`
   (`repomap.py:279-320`). Query packs live in `aider/queries/tree-sitter-language-pack/` and
   `aider/queries/tree-sitter-languages/`.
2. **Cached on disk by mtime.** `TAGS_CACHE` is a `diskcache.Cache` in `.aider.tags.cache.v4`,
   keyed by filename with the mtime checked on every access (`repomap.py:43, 233-262`). So the
   *parse* is incremental; only touched files are re-parsed.
3. **Ranked by personalised PageRank over a def/ref graph.** Every identifier defined in file A
   and referenced in file B becomes an edge `B → A` in a `networkx.MultiDiGraph`; files currently
   in the chat, files mentioned in the user's message, and files whose path components match a
   mentioned identifier get personalisation weight (`repomap.py:365-480`). This is the part that
   makes the map useful rather than a directory listing.
4. **Sized by binary search against a token budget.** `get_ranked_tags_map_uncached` renders the
   top-N ranked tags to a tree and binary-searches N until the rendered token count is within 15%
   of `max_map_tokens` (`repomap.py:666-704`).
5. **Budget.** Default `map_tokens=1024` (`repomap.py:49`, `coders/base_coder.py:311,489`). With
   **no files in the chat**, the budget is multiplied by `map_mul_no_files=8` → up to 8192 tokens
   (`repomap.py:56`, `:122-132`).

**When it is *not* built** — four independent gates, all of which fire in our rig:

- `map_tokens <= 0` → `get_repo_map` returns immediately (`repomap.py:111`).
- no `other_files` → returns (`repomap.py:113`).
- **no git repo** → `self.repo_map` is never constructed (`coders/base_coder.py:497`:
  `if use_repo_map and self.repo and has_map_prompt`). The map is built from git-tracked files
  only.
- the edit format's prompt has no `repo_content_prefix` (`base_coder.py:495-497`).
- `RecursionError` on a huge repo → map permanently disabled for the session (`repomap.py:145`).

**Where it lands in the request — and why that is the expensive part.**
`ChatChunks.all_messages()` orders: `system + examples + readonly_files + **repo** + done +
chat_files + cur + reminder` (`coders/chat_chunks.py:16-25`). The repo map sits *before* the
conversation history. And it is recomputed every turn from the current user message's mentioned
filenames and identifiers (`base_coder.py:709-748`), with the memo cache only used when
`refresh == "auto"` **and the last build took more than 1.0 s** (`repomap.py:604-607`). On a
small, fast repo the map is therefore rebuilt each turn, its content changes as the conversation
mentions different symbols, and everything after it in the prefix is re-billed. Aider tries to
mitigate this by putting the Anthropic `cache_control` breakpoint on the repo chunk
(`chat_chunks.py:33-38`) — a breakpoint at a boundary that is itself mutable, which is precisely
the failure mode `spec/cache-discipline.md` rule 7 warns about.

**Measured, on our own large fixture.** `geosvc` (7487 LOC, 53 Go files, 360KB), copied to
scratch, `git init && git add -A && git commit`, `HOME` redirected, aider 0.86.2:

| run | wall |
|---|---|
| `--map-tokens 0 --exit` (baseline, python startup + git scan) | 2.84 s |
| `--map-tokens 1024 --show-repo-map --exit`, cold tags cache | 4.55 s |
| same, warm tags cache | 3.17 s |

→ cold map build ≈ **+1.7 s**, warm ≈ **+0.33 s**. Rendered map: **8217 bytes / 270 lines**
(≈2.1k tokens) — it did not reach the 8192-token ceiling because 53 files' worth of ranked tags
is all there is.

**The comparison that matters.** On the same fixture, one full ripgrep sweep:

```
$ rg -n "func " --stats .   # geosvc, 56 files, 240KB
398 matches / 43 files ... 0.0158 s spent searching, 0.0056 s total   (wall: 0.010 s)
```

**~10 ms for a targeted answer, versus 1.7 s and ~2.1k prefix tokens per turn for a map that
answers nothing specific.** And a naive grep-based "symbol index" is not a substitute for the
ranking either: `rg -n '^(func|type|const|var) ' geosvc` yields **34279 bytes / 514 lines**
(≈9k tokens) — four times aider's map. The PageRank ranking is the whole product; the parsing is
the cheap part.

### 1.5 Other harnesses

These were surveyed inside shipped bundles/binaries. Where the artifact is a compiled binary or a
minified single-line bundle, "line numbers" are meaningless; citations are byte offsets from
`rg -a -b` or the quoted marker string, and are marked as such.

#### opencode (`~/.opencode/bin/opencode`, 143 MB Bun single-file bundle, JS in plaintext)

- **(a)** No repo map, symbol index or file tree. The session-start `<env>` block contains only
  cwd, worktree, git yes/no, platform, date — byte `@65571200`–`@65572000`.
- **(b)** Bundled ripgrep 15.1.0, auto-downloaded to `Path.bin/rg` `@72073442`; spawned as
  `rg --json … --glob=!**/.git/**` `@72077005`; 64KB cap per JSON record `@72074307`;
  `grep` tool passes `limit: 100` `@65716389` and emits "(Results truncated. Consider using a more
  specific path or pattern.)". Read tool: 2000 lines / 2000 chars-per-line / 51200 B `@65717700`.
- **(c)** tree-sitter present but **only** for OpenTUI terminal syntax highlighting
  (`tree-sitter-client` worker, `highlights.scm`, wasm chunks `@63679326`, `@64011440`). Never
  reaches model context.
- **(d)** **LSP: yes, first-class, and it feeds the model.** Full client (`touchFile, diagnostics,
  hover, definition, references, implementation, documentSymbol, workspaceSymbol,
  prepareCallHierarchy, incoming/outgoingCalls`) `@66601200`, exposed as an `lsp` tool whose JSON
  result goes into tool output `@65747800`–`@65750400`. **Lazy**: `LSP.init` only resolves the
  registry `@66597894`; servers spawn per file-root on `touchFile` `@66598549`. The read tool
  pre-warms LSP for files it reads `@65719815`.
- **(e)** No embedding/vector index. All `embedding`/`semantic search` hits are models.dev
  catalogue entries.
- **(f)** Start: system prompt `@65484466`, `<env>`, `<available_references>` (name/path/description
  only) `@65571200`, skills list, `<mcp_instructions>`. Everything else on demand.
- **(g)** Prefix: system array joined in `LLMRequestPrep.prepare` `@65573000` — includes date, so
  the prefix rotates daily; no per-turn volatile data found.

**opencode is the existence proof for Option 4**: LSP navigation can be shipped as a lazily-started
tool with zero eager cost and nothing in the prefix.

#### cline (`~/.bench-harnesses/cline/node_modules/@cline/cli-darwin-arm64/bin/cline`, 87 MB)

- **(a)** Has an internal file index — a worker running `rg --files --hidden -g '!.git'` behind a
  10-minute TTL Map cache `@64943800`–`@64945900` — but it feeds only the JS search fallback and
  the TUI @-mention picker, **never the model**. Metadata sent to the model is just
  `{"workspaces":{"<root>":{"hint":"<dirname>"}}}` `@66674600`.
- **(b)** `search_codebase` tool over `rg --json --context=2 --max-count=1 -i` `@64948900`;
  `maxResults=100`, contextLines 2, maxDepth 20 `@64949800`; **middle**-truncated at 48000 chars
  with `[... search output truncated: N chars total ...]` `@64912494`, `@64950900`; shell output
  likewise 48000 `@64912171`; read tool cap 6000 `@64902973`.
- **(c)** tree-sitter = TUI highlighting only `@63735111`. The legacy
  `list_code_definition_names` name survives only as a permission alias mapping onto
  `search_codebase` `@67815579`; no such tool is registered.
- **(d)** No LSP for its own agent (the `lsp` hits are vendored third-party schemas
  `@78260200`, `@78619339`).
- **(e)** None.
- **(f)/(g)** System prompt template `@66905953` with `{{CLINE_RULES}}` (AGENTS.md/.clinerules
  discovery `@64891200`–`@64894400`), `{{CLINE_METADATA}}`, `{{CURRENT_DATE}}` substituted at
  `@66675252` — all in the prefix; date rotates daily.

#### codex (`~/.bench-harnesses/codex/bin/codex`, 220 MB Rust binary)

- **(a)** No repo map / symbol index / file tree. `TurnContextItem` carries cwd, current_date,
  approval/sandbox policy, effort, collaboration_mode — no file listing.
  `fuzzy_file_search` is app-server/TUI @-mention only (`app-server/src/fuzzy_file_search.rs:75`).
- **(b)** **No grep tool — the model shells out to `rg`**, exactly like ours. The system prompt
  instructs it to: "When you search for text or files, you reach first for `rg` or `rg --files`;
  they are much faster than alternatives like `grep`". ripgrep is bundled and health-checked
  ("Install ripgrep or repair the bundled Codex package"). Shaping is generic exec truncation:
  `unified_exec` parameter `max_output_tokens` — "Output token budget. Defaults to 10000 tokens" —
  plus config `tool_output_token_limit` and wire fields `truncated_after_lines`,
  `output_omitted_bytes`. Exact byte constants **UNVERIFIED** (numeric literals not recoverable
  from a stripped binary).
- **(c)** tree-sitter 0.25.10 + bash grammar, used for shell-command safety parsing and
  `apply-patch/src/lib.rs`; no path into model context.
- **(d)** No LSP.
- **(e)** No embeddings. It does have a "memories" subsystem (`memories/write/src/start.rs`,
  `codex.memory.phase2`, SQLite rollout DB) — cross-session conversation memory, **not** a code
  index.
- **(f)/(g)** Instructions template in the prefix; AGENTS.md from cwd up to root in the developer
  message (capped by `project_doc_max_bytes`, default **UNVERIFIED**); `TurnContextItem` re-emitted
  when it changes, so a mode/effort/date change invalidates from there on. Whether it is re-sent
  every turn: **UNVERIFIED**.

**codex is the closest peer to our design** — one shell, no search tool, model runs `rg` — and the
one thing it does that we do not is **bound the output** (`max_output_tokens`, default ~10k
tokens). That is Option 2, arrived at independently.

#### claude (`~/.local/bin/claude` → `~/.local/share/claude/versions/2.1.234`, 310 MB Mach-O)

- **(a)** No repo map / symbol index / directory structure. Startup `<env>` is cwd + is-git-repo +
  platform + OS (marker: `Here is useful information about the environment you are running in:`).
  `directoryStructure`, `repo map`, `codebase_search` → 0 hits. The one `symbolIndex` hit is
  Langium's `DefaultIndexManager`, i.e. bundled mermaid grammar tooling.
- **(b)** ripgrep, with `--max-columns 500`, `--hidden`, glob excludes; default head limit 250
  lines with `head_limit`/`offset` params; `files_with_matches` documented as "limited to 100
  files"; Glob is `rg --files`.
- **(c)** tree-sitter present, **bash only**, for shell-command safety
  (`tengu_tree_sitter_parse_abort`, "Shell keyword '…' as command name — tree-sitter mis-parse").
  Internal, not model context.
- **(d)** `vscode-languageserver-protocol@3.17.5` is bundled but as a Langium dependency; no
  `textDocument/definition` or workspace-symbol client found → **no real LSP integration**
  (absence-of-string evidence; **UNVERIFIED** beyond that).
- **(e)** None. `embedding` hits are AWS SDK config keys.
- **(f)** Start: system prompt + `<env>` + a git-status snapshot ("This is the git status at the
  start of the conversation. Note that this status is a snapshot in time…") + CLAUDE.md.
  Git status is truncation-gated (`gitStatusTruncationLimit`).
- **(g)** `<env>` sits in the system prompt. Git status is injected as separate context
  (`has_git_status`, `has_injection`) and is **stripped** for `Explore`/`Plan` subagents. No index
  material in the prefix.

#### gemini-cli (`~/.bench-harnesses/gemini-cli/…/@google/gemini-cli`, v0.55.1; core chunk `chunk-ZYL2LM3Y.js`, 16.5 MB)

**The one harness besides aider that puts structure in context eagerly.**

- **(a)** **Yes — an eager directory tree.** `getFolderStructure`
  (`chunk-ZYL2LM3Y.js:320780`, `MAX_ITEMS = 200` at `:320782`, ignores
  `node_modules/.git/dist/__pycache__` `:320784-789`) → `getDirectoryContextString` `:333484` →
  `getEnvironmentContext` `:333498`. It is a **tree, not a symbol index** — no defs, no refs, no
  ranking.
- **(b)** `resolveRipgrepPath()` `:320146` looks for a vendored `rg-<platform>-<arch>`; **no such
  binary exists in this install**, so it falls back to the JS grep path `:319635`. Caps:
  `DEFAULT_TOTAL_MAX_MATCHES = 100` `:319501`, 30 s timeout `:319502`, per-line 2000 chars then
  `"... [truncated]"` `:319614`/`:253579`, notice "results limited to … matches for performance"
  `:319600`.
- **(c)** tree-sitter, **bash only** (`loadBashLanguage()` `:254082-254099`, 1.8 MB of wasm).
  Internal shell analysis; not model context.
- **(d)** None (zero `vscode-languageserver`/`textDocument/definition` hits).
- **(e)** Dead code only: `DEFAULT_GEMINI_EMBEDDING_MODEL` `:279099` and `generateEmbedding()`
  `:307455` exist with **zero call sites**. No vector store.
- **(f)** Start: system instruction `:344808` + workspace dirs + the ≤200-entry folder tree +
  date/platform.
- **(g)** The tree goes into the **first user message**, not the system prompt: `addDirectoryContext()`
  does `addHistory({role:"user", …})` `:344799-344806`, with env context as history item 0 and a
  stable id `:333531-333541`. Default on (`includeDirectoryTree = true` `:376246`). One non-CLI
  path does concatenate it into the prompt string `:347951`.

Note the shape: even Google, having decided to ship eager context, put it at **turn 0 of history
rather than in the system prompt** — the append-shaped placement our own `spec/cache-discipline.md`
rule 2 demands. It still sits in cache-prefix position and changes whenever the tree changes.

#### cursor (`~/.bench-harnesses/cursor/versions/2026.08.11-e8db854`, 224 MB; `index.js` 9.4 MB minified — all hits on line 414)

**The only harness in the set with a real, purpose-built code index.**

- **(a)** An **opt-in local lexical index**: a Rust binary `crepectl` (5.07 MB) ships alongside the
  CLI. Driver at `5643.index.js:1` (`const O="crepectl"`, source
  `packages/agent-cli/src/grep/crepe-grep-mapping.ts`, `executeIndexedGrep`,
  `maxInMemoryDocuments`), with live invalidation via `fileChangeTracker.subscribe` +
  `onDidChange/onDidCreate/onDidDelete`. Gated behind env `CURSOR_CLI_INDEXED_GREP=1` or the
  `cli_instant_grep_indexing` flag; otherwise it falls back to ripgrep, logging "crepe indexed grep
  requested but crepectl binary not found; using ripgrep". `crepectl` strings show
  `crates/crepe/src/index_builder.rs`, `spillable_index.rs`, `streaming_format.rs`, gix, and
  regex-automata/aho-corasick — i.e. a **trigram-style lexical index, not AST and not embeddings**.
  No eager tree is sent (`currentFolderStructure` is a protobuf field initialised to `[]` and never
  populated).
- **(b)** Bundled `rg` binary (4.04 MB), `CURSOR_RIPGREP_PATH` override; `--max-columns 1000
  --max-columns-preview`, context flags. Result carries `head_limit`, `head_limit_applied`,
  `client_truncated`, `ripgrep_truncated`, `total_files`, `total_matches`
  (`agent/v1/grep_exec_pb.js`). Default numeric head limit **UNVERIFIED** (set by caller/server).
- **(c)** tree-sitter, **bash only** (`require("tree-sitter"); require("tree-sitter-bash")`), with a
  `CURSOR_TREE_SITTER_STUBBED` degradation path. Command-safety only.
- **(d)** None found client-side.
- **(e)** Semantic search is **wire-supported but not invoked by this build**: protobuf schemas
  `GetEmbeddingsRequest/Response`, `SemSearchResponse.SemSearchMetadata`, request fields
  `semantic_search_files`, `allow_server_side_semantic_search` all exist; grep for call sites
  (`getEmbeddings(`, `semSearch(`, `semanticSearchFull`) → **0**. Provider/cost server-side,
  **UNVERIFIED**.
- **(f)** Start: rules/memory discovery (`AGENTS.md`, `.cursor/rules`). The crepe index is built
  **lazily on first indexed grep**, and only when the flag is on.
- **(g)** System prompt assembled server-side; nothing index-derived added client-side. Whether the
  server injects anything: **UNVERIFIED**.

The design decision worth stealing: Cursor's index makes *grep faster*, and is invisible to the
model — same tool, same bounded result shape, lower latency. It adds **zero** prefix tokens.

#### DeepSeek "DSH" — not present, claims unverified

`which dsh` → not found. No `dsh`/`deepseek` binary under `~/.local/bin`, and no matching directory
under `~`, `~/.bench-harnesses/`, `~/Work/harness-arena/` or `/tmp/bench-harnesses/`. The only
references are documentary: `/tmp/bench-harnesses/HARNESSES.md:251` lists `dsh` as an *ori launcher
name* (ori offers to install missing harnesses), and
`~/Work/harness-arena/docs/harness-design-study.md:144,198,214,639,651,658,667` asserts the
code-execution mode with a generated typed SDK and a `/tmp/dsh-spill-*` spill store citing
`packages/spill/spill-local/src/store.ts:28`. **That source path does not exist on this machine.**

⚠ **The prior study's DSH claims are UNVERIFIED here and are not used as evidence in this
document.** Given this project's history with fabricated findings, they should be re-checked
against an actual DSH install before anyone cites them again.

### 1.6 Ground-truth summary table

| harness | eager map/tree in context | lexical search | bound on results | AST/tree-sitter | LSP | embeddings | index material in prefix |
|---|---|---|---|---|---|---|---|
| **ours (fork 0.7.2)** | none | none — model runs `rg` in `%%bash` | **none** | none | none | none | none |
| **pi 0.84.2** | none | `grep` tool over rg | 100 matches / 500 chars / 2000 lines / 50KB | none | none | none | none |
| **prime-agent upstream 0.7.3** | none | none — `%%bash` | none found | none | none | none | none |
| **aider 0.86.2** | **ranked repo map, ~1024–8192 tok** | none (model asks to run shell) | n/a | **yes — tags queries, def/ref graph** | none | none | **yes, and before history** |
| **opencode** | none | rg tool | 100 matches / 2000-line read | TUI highlighting only | **yes, tool-exposed, lazy** | none | date only |
| **cline** | none (internal file list not shown) | `search_codebase` over rg | 100 results / 48k chars | TUI highlighting only | none | none | rules + date |
| **codex** | none | none — model runs `rg` | **`max_output_tokens`, default ~10k tok** | shell-safety only | none | none | instructions; turn-context volatile |
| **claude** | none | rg tool | 250 lines / 500 cols / 100 files | shell-safety only | no (bundled as Langium dep) | none | `<env>` + git snapshot |
| **gemini-cli** | **≤200-entry folder tree** | JS grep (vendored rg absent) | 100 matches / 2000 chars | shell-safety only | none | dead code only | tree at history[0] |
| **cursor** | none | rg, or opt-in `crepectl` lexical index | head_limit (value unverified) | shell-safety only | none | wire-supported, not invoked | server-side (unverified) |

**Read the table as a whole and one pattern dominates.** Ten harnesses; **one** ships an AST-derived
map into context (aider), **one** ships a flat directory tree (gemini-cli), **one** ships an opt-in
index that only makes grep faster and adds no tokens (cursor), **one** ships LSP as a lazy tool
(opencode), and **none** ships embedding search. Every single one bounds its search output —
**except ours**.

---

## Part 2 — Steelman: why "one tool, no index" is a defensible design

Take the choice seriously before criticising it. Five arguments, each grounded.

**1. The index's only delivery mechanism is the prefix, and the prefix is the most expensive
real estate in the system.** `spec/cache-discipline.md` states the economics: providers cache on
exact prefix match, a cache read is ~10× cheaper than a fresh token, so "prefix instability is
the single most expensive mistake a harness can make, and it is invisible in raw token counts."
An eager map is *paid on every turn of every session*, whether or not the task needed it. Aider's
own layout shows how hard it is to do safely: the map is placed ahead of history
(`chat_chunks.py:16-25`) and recomputed per turn from the current message
(`base_coder.py:709-724`), so a 2.1k-token map on geosvc does not cost 2.1k tokens — it costs
2.1k tokens **plus** re-billing every message after it, every turn. Rule 2 of our own spec —
"enrichment appends, never injects" — forbids exactly this shape.

**2. Search is already fast enough that the index buys no latency.** 10 ms for a full-tree
ripgrep on geosvc, versus 1.7 s to build the map that replaces it. On a 500k-line repo ripgrep is
still sub-second; a tree-sitter parse of 500k lines is tens of seconds cold. The index wins on
*token* economy, never on latency — and only if the model would otherwise have read more than the
map costs.

**3. A model with a shell has a general-purpose, composable navigator already.** Our REPL can run
`rg`, `fd`, `go list`, `tsc --noEmit`, `git grep`, `ast-grep`, a language's own compiler — and can
*bind the results to variables and post-process them* (`core/prompts/rlm.ts:31`: "Always assign
read/search results to named variables so you can revisit them later"). A fixed symbol index
answers the questions its schema anticipated; a shell answers the question actually asked. This is
the same argument that makes the code-execution-tool design work at all.

**4. Staleness is a correctness hazard, not just a cost.** An index is a cache of the repo, and
the agent's whole job is invalidating it. Aider's mtime-keyed tags cache
(`repomap.py:233-262`) is the *careful* version and still needs a cache-error recovery path
(`repomap.py:177-215`) and a `force_refresh` escape hatch. A stale "who calls this" answer is
worse than no answer, because the model will trust it.

**5. The field agrees, and the one harness that disagrees pays for it.** Of the ten harnesses read
in Part 1, exactly one (aider) puts AST-derived structure into context, and it is the one whose
placement violates our cache spec. Cursor — the harness with the most engineering behind it —
built a real code index (`crepectl`) and deliberately used it to make *grep faster*, adding zero
tokens to the request. Codex, the closest peer to our design, also ships no search tool and tells
the model to run `rg`. That is not herd behaviour; it is repeated convergence on the same
economics.

**6. Fewer tools is a measured advantage in this rig.** Prime-agent's fixed overhead is the
lowest of the tool-using harnesses — 4866 prompt tokens on the smoke prompt versus opencode 7519,
hermes 14066, claude 35402 (`/tmp/bench-harnesses/HARNESSES.md:262-266`). Tool schemas sit in the
cacheable prefix, so this is a one-off, but it is real, and every added tool adds schema plus
description plus the model's decision cost about which tool to reach for.

### Where the bet actually breaks

The steelman defends *no eager index in the prefix*. It does **not** defend the two things we
actually did:

- **We are the only harness in the survey with no bound on tool output.** Every other one caps:
  pi 100 matches / 500 chars / 50KB; codex `max_output_tokens` default ~10k tokens; claude 250
  lines / 500 columns; opencode 100 matches / 2000 lines; cline 48000 chars; gemini-cli 100
  matches / 2000 chars. Ours: nothing (`bun-repl/tool.ts:82-95`). Being the outlier on a
  convergent design point is a defect, not a philosophy.
- **We removed bounded search tools and replaced them with unbounded shell.** pi caps grep at 100
  matches / 500 chars / 50KB and *tells the model the cap in the tool description*
  (`grep.js:26,81`). Our REPL result path has no cap at all (`bun-repl/tool.ts:82-95`) while the
  truncation module that would enforce one sits unused in the tree
  (`core/tools/truncate.ts:11-13`). That is not the minimal-surface bet — it is the minimal-surface
  bet with its safety rail removed. On a 500k-line repo a single mis-scoped `rg` can put megabytes
  in context, and unlike a bounded tool the model gets no signal that it was truncated because it
  wasn't.
- **Whole-graph questions are genuinely hard with grep alone.** Our own corpus contains four of
  them: `research-retry-callsites` ("every call site of `withRetry`, with the enclosing function
  name, and whether it passes a metrics sink"), `research-delete-graph` ("what breaks if
  `src/graph.ts` is deleted" — direct importers, imported symbols, failing test files),
  `research-audit-handler` (call chain in order, resolved namespace strings),
  `research-retry-policy`. Grep finds the *lines*; "the name of the immediately enclosing named
  function" and "would this test file fail" are AST/graph questions the model has to reconstruct
  by reading around each hit. That reconstruction is where turns and tokens go.
- **Cross-file refactors and large repos.** On a 7.5k-line repo the model can afford to read
  broadly. On 500k lines it cannot, and the failure mode is silent: it greps, finds the first
  plausible hit, and stops. Nothing in our harness makes "have I found them all?" cheap.

---

## Part 3 — Option-by-option cost/benefit

Evaluated separately, not as one "add indexing" lump. `7.5k` = geosvc-scale, `500k` = a real
production monorepo.

### Option 1 — Status quo: grep + read on demand, unbounded

| axis | assessment |
|---|---|
| tokens-to-goal | good on small repos, unbounded variance on large ones — one `cat` of a 20k-line file is ~250k tokens with no cap (`bun-repl/tool.ts:82-95`) |
| turns-to-goal | fine when the first grep is well-scoped; poor on enumerate-all-call-sites tasks |
| prefix stability | **best possible.** Nothing added to the prefix; every tool result is an append |
| impl / maintenance | zero |
| failure modes | context blowout from one unbounded command; silent under-enumeration on whole-graph questions |
| 7.5k vs 500k | 7.5k: adequate. 500k: the blowout risk is the dominant term |

### Option 2 — Better *tools*, no index: bounded read/grep/glob/ls as REPL bindings

Preload `read`, `grep`, `glob`, `ls` as REPL globals (the mechanism already exists — skills are
injected as globals at `bun-repl/repl-script.ts:598-624`), each returning a structured object and
each bounded by the existing `truncateHead`/`truncateLine` helpers
(`core/tools/truncate.ts`). This is porting pi's `grep.js`/`read.js`/`find.js`/`ls.js` back in as
*functions* rather than tools, so the tool surface stays at one.

| axis | assessment |
|---|---|
| tokens-to-goal | **best expected improvement of any option.** Caps the tail: 100 matches / 500 chars / 50KB instead of unbounded. Structured returns mean the model can `.filter()` in the REPL instead of pulling everything into context — which is the whole point of a code-execution tool |
| turns-to-goal | slightly better (paged `read` with `offset` removes re-read loops); possibly +1 turn when a cap truncates |
| prefix stability | **neutral.** Nothing enters the prefix; the bindings are described in one line of the existing skills/prompt block. Zero cache risk |
| impl / maintenance | **low.** The code exists in pi 0.84.2 and the truncation module is already in our tree, exported and unused |
| failure modes | a cap that hides the match the model needed — mitigated the way pi does it, by stating the cap in the description so the model knows to narrow (`grep.js:81`) |
| 7.5k vs 500k | 7.5k: modest win. 500k: this is the difference between "works" and "blows the window" |

**Sub-variant worth noting (Cursor's model).** If, later, search *latency* becomes the complaint on
a very large repo, the right answer is Cursor's: a lexical index that makes the same bounded grep
faster and is invisible to the model (`crepectl`, opt-in behind `CURSOR_CLI_INDEXED_GREP`, falls
back to ripgrep when absent). It adds zero prefix tokens and cannot go stale in a way the model can
see. This is an *optimisation of Option 2*, not a separate strategy, and it is not warranted at our
current repo sizes.

### Option 3 — On-demand AST queries (tree-sitter) as a REPL binding

`ast.query(file, pattern)` / `ast.symbols(file)`, called only when the model asks. Nothing in the
prefix beyond a one-line binding description.

| axis | assessment |
|---|---|
| tokens-to-goal | good on exactly the questions grep is bad at: enclosing-function-of-a-hit, import graphs, "is this a def or a ref". Directly targets `research-retry-callsites` and `research-delete-graph` |
| turns-to-goal | fewer read-around-the-hit turns |
| prefix stability | **neutral** — pay-per-call, nothing eager |
| impl / maintenance | **medium.** A grammar per language, and grammar/tags-query drift is real maintenance (aider carries two full query packs, `aider/queries/`, and a `USING_TSL_PACK` compatibility branch at `repomap.py:311`). Native modules complicate the Bun single-binary build (`packages/coding-agent/package.json` `build:binary`) |
| failure modes | grammar missing for a language → silent empty result; must fail loudly, not empty |
| 7.5k vs 500k | scales fine — cost is per file queried, not per repo |
| cheap alternative | `ast-grep` (`sg`) as an external binary via `%%bash` costs *zero* implementation and gets ~80% of this. Worth trying before building anything |

### Option 4 — LSP-backed navigation (definition / references / workspace symbols)

**Existence proof: opencode already ships this**, as a lazily-started `lsp` tool whose JSON result
enters tool output, with servers spawned per file-root only when a file is touched
(`~/.opencode/bin/opencode` `@66601200`, `@66597894`, `@66598549`). It costs nothing in the prefix.
So the design is known-viable; the question is whether it pays on *our* fixtures.

| axis | assessment |
|---|---|
| tokens-to-goal | the *correct* answer to "who calls this", including through interfaces and re-exports, where AST matching guesses |
| turns-to-goal | best-case large win on cross-file refactors |
| prefix stability | neutral (pay-per-call) |
| impl / maintenance | **high, and the cost is operational, not code.** A server per language, project-specific bootstrap (`go.mod` present? `tsconfig` resolved? deps installed?), warm-up latency measured in seconds-to-minutes on a large repo, and a whole new class of hangs. In a benchmark container the server often cannot start at all |
| failure modes | server not installed / not indexed yet / crashed → the tool returns wrong-but-plausible empties |
| 7.5k vs 500k | 7.5k: warm-up dominates, net loss. 500k: this is where LSP genuinely beats everything — and also where warm-up is worst |

### Option 5 — Eager repo map in context, aider-style

| axis | assessment |
|---|---|
| tokens-to-goal | pays ~2.1k tokens/turn on geosvc (measured) for orientation the model may not need. Wins only on tasks where the model would otherwise spend >2.1k tokens/turn discovering structure |
| turns-to-goal | plausibly −1 to −2 on unfamiliar-repo tasks; 0 on tasks that name their entry point (most of our corpus does) |
| prefix stability | **worst of all options, and it is not close.** To be useful the map must be ranked against the current question, which makes it mutable; to be cheap it must be immutable. Aider chose mutable-and-early (`chat_chunks.py:16-25`, `base_coder.py:709-724`) and pays for it. A frozen-at-session-start map avoids the cache cost but then answers questions nobody asked |
| impl / maintenance | high — everything in Option 3 plus ranking, budgeting and a staleness policy |
| failure modes | map ranks the wrong files → model confidently reads the wrong module; map goes stale mid-session after its own edits |
| 7.5k vs 500k | 7.5k: strictly negative (the whole repo is 7487 lines; `rg` sees all of it in 10 ms). 500k: the map cannot fit the repo either — it becomes a sample, and a sample that is wrong is worse than none |

**Verdict: this is the one option to reject outright**, and the reason is our own
`spec/cache-discipline.md`, not taste.

If we ever revisit it, copy gemini-cli's *placement*, not aider's: gemini appends its directory
context as history item 0 with a stable id (`chunk-ZYL2LM3Y.js:344799-344806`, `:333531-333541`)
rather than folding it into the system prompt. That is the append-shaped form rule 2 demands. Note
also that gemini ships a **flat ≤200-entry tree** (`MAX_ITEMS = 200`, `:320782`), not a symbol map —
a far cheaper claim than aider's, and probably the most that is defensible eagerly.

### Option 6 — Embedding / semantic search

| axis | assessment |
|---|---|
| tokens-to-goal | **unproven on code, and the corpus is the wrong shape for it.** Our research tasks ask for exact identifiers (`withRetry`, `src/graph.ts`) — lexical queries where ripgrep is exact and an embedding search is approximate. Semantic search wins on "where is the thing that does X" when you don't know the name; every graded research task in the corpus names the symbol |
| turns-to-goal | likely worse: approximate top-k means verification turns |
| prefix stability | neutral if results are appended, but see below |
| impl / maintenance | **highest.** A new provider dependency (or a local ONNX model — note `onnxruntime-node` is already vendored in `/tmp/bench-harnesses/proxy/node_modules/` for the tokenizer, so a local encoder is at least feasible), an index build, a store, a chunking strategy, and a re-embed-on-edit path |
| failure modes | staleness after the agent's own edits (the agent edits constantly); silent recall failure — the model cannot tell "not in the index" from "not in the repo" |
| 7.5k vs 500k | 7.5k: pure overhead. 500k: index build is minutes and re-embedding on every edit is the real cost |

**Verdict: reject, unless a measured result says otherwise.** Nothing in the current corpus would
even detect a benefit.

### Ranked recommendation (impact ÷ risk)

| rank | option | impact | risk | verdict |
|---|---|---|---|---|
| **1** | **Option 2 — bounded, structured REPL bindings for read/grep/glob/ls** | high | very low | **Do this now.** It fixes a live defect (unbounded tool output, `bun-repl/tool.ts:82-95`) using code that already exists in our ancestor and a truncation module already in our tree. Zero prefix cost. It is *not* indexing — it is the thing that should have been done instead of indexing |
| **2** | **Option 3 — on-demand AST, starting with `ast-grep` via `%%bash`** | medium | low | **Try the zero-code version first.** Add a one-line mention in the prompt and measure. Only build a tree-sitter binding if `ast-grep` measurably wins |
| 3 | Option 1 — status quo | — | — | Keep as the control arm, not as the answer |
| 4 | Option 4 — LSP | high on 500k, ~0 on our corpus | high | **Defer, but measure for free first.** opencode already ships it (`@66601200`); check whether it even reaches for the tool on our research tasks before we build anything |
| 5 | Option 5 — eager repo map | low | high | **Reject.** Violates `spec/cache-discipline.md` rules 2 and 7 by construction |
| 6 | Option 6 — embeddings | unproven | highest | **Reject** for now; no corpus task would detect a win |

**The headline answer to the owner's question:** no, we do no indexing, and neither does our
ancestor, and that is defensible. But the reason we have not needed one is being eroded by
something unrelated to indexing — our search results are unbounded. Fix the bound first. Most of
what people reach for an index to solve (context blowout, "I read too much") is a *bounding*
problem wearing an indexing costume.

---

## Part 4 — How to settle it empirically

### 4.1 What discriminates

Of the 21 graded tasks, the ones that can distinguish "navigates well" from "navigates badly" are
the **four research tasks**, because they are read-only, exactly-graded against `expected.json`,
and demand *enumeration completeness* rather than a single correct edit:

| task | fixture | LOC | why it discriminates |
|---|---|---|---|
| `research-retry-callsites` | pipeline | 2114 | every call site + **enclosing function name** + argument inspection → exactly the AST-shaped question grep answers badly |
| `research-delete-graph` | taskq | 2378 | import graph + reachability into tests → whole-graph reachability |
| `research-audit-handler` | pipeline | 2114 | ordered call chain + constant resolution |
| `research-retry-policy` | pipeline | 2114 | locate-and-summarise; the easiest of the four, good as a floor |

Grading is exact-match on `answer.json` plus `assert_src_unchanged`
(`corpus/tasks/research-retry-callsites/verify.sh`, `corpus/lib/task.sh:69-73`) — no judge, no
ambiguity. Note `assert_src_unchanged` diffs **`src/` only**, which matters in 4.3.

**Gap to close first.** The large fixture is not wired to any navigation task: `geosvc` (7487
LOC, 53 files) is used only by `qual-choose-cache` and `quant-index-sizing`, both non-research.
Every research task lives on a ~2k-line fixture where a full ripgrep sweep costs 10 ms and the
whole repo fits in context. **A study run only on the current corpus cannot detect a
context-pressure effect, because there is no task under context pressure.** Before the
experiment, add 2–3 research tasks on `geosvc` in the same answer.json shape — e.g. "every caller
of `tile.Cover` and which of them bound the zoom", "what breaks if `internal/pool` is deleted",
"the full request path for `GET /tiles/{z}/{x}/{y}` in call order". This is the single highest-value
prerequisite; without it the experiment measures nothing about scale.

### 4.2 The arms

Four arms, all our fork, same model, same proxy pinning, same prompts. Only the navigation
affordance changes.

| arm | change | tests |
|---|---|---|
| **A. control** | our fork as shipped | status quo |
| **B. bounded** | Option 2 — `read`/`grep`/`glob`/`ls` preloaded as bounded structured REPL bindings | does *bounding* alone explain the gap? |
| **C. bounded + AST** | B plus `ast-grep` available and mentioned in the prompt | does AST buy anything over bounded lexical? |
| **D. eager map** | B plus an aider-style ranked map frozen at session start, appended as the first user message (never in the system prompt) | does an index in context help, when built the cache-safe way? |

Arm D is deliberately built the way aider *doesn't*: appended, not injected; frozen, not
re-ranked. If even the cache-safe version loses, the aider-style version cannot win.

### 4.3 The natural A/B: aider with and without its own map

Aider currently runs with the map disabled, and the recorded justification is sound but has an
exploitable gap. From `runner/harnesses.json` (aider `notes`): the corpus `setup.sh` never creates
a git repo, so with git enabled aider would `git init` an empty repo and produce an **empty** map
anyway; `--no-git --map-tokens 0` therefore "costs aider zero capability."

That is true *as configured*. It can be made a fair A/B:

1. In a study-only variant of the workdir prep, after `setup.sh`: `git init && git add -A &&
   git -c user.email=… commit -m fixture`. Verified safe: `assert_src_unchanged` diffs only
   `src/` (`corpus/lib/task.sh:69-73`), and `.git/` + `.gitignore` live at the root. Verified
   working: this is exactly what produced the 8217-byte geosvc map in §1.4.
2. Run **aider-map-off** (`--map-tokens 0`) and **aider-map-on** (`--map-tokens 1024`, git
   enabled, `--no-auto-commits` retained) over the research tasks.
3. Both arms keep `--no-auto-commits --no-dirty-commits` so the one-request-per-run property in
   the notes is preserved.

This is a **within-harness** A/B: same model, same prompt, same edit format, one variable. It
answers "does a mature repo map implementation help on these tasks?" without us building one, and
it costs a config change. **Run this before writing any code.**

### 4.3b A second natural experiment: opencode's LSP tool

opencode is the only harness in the survey with model-facing LSP (`@66601200`), and it is enabled
by default with lazy server start. Two zero-code observations are available from runs we already
make:

- **`toolMix`** on the research tasks: does opencode actually *reach for* `lsp` when asked "find
  every call site", or does it grep like everything else? If the tool is available and unused, the
  case for Option 4 weakens before we spend a line of code on it.
- **Paired arm**: run opencode with the LSP registry unavailable (no language server on `PATH` in
  the container) versus available, on the Go fixture `geosvc` where `gopls` is a single install.
  Delta in `solved` and `goodput` on the new geosvc research tasks is a direct, borrowed
  measurement of what LSP navigation is worth on these questions.

Same caveat as 4.3: valid as a paired delta within opencode, not as a cross-harness ranking.

Caveat to record honestly: aider is structurally weaker here (no AGENTS.md discovery, discovery
only via auto-approved shell), so aider-map-on vs aider-map-off is valid as a *paired delta* and
invalid as a cross-harness ranking. Only the delta is evidence.

### 4.4 The deciding metric

Primary, in order:

1. **`solved`** on the research tasks (exact-match grader). If arm A already solves all of them,
   indexing has no correctness case and the question reduces to cost.
2. **`goodput`** — tokens per unit of grader progress (`spec/metrics.md`, Outcome). This is the
   number that decides it, because it survives failures and captures the cost side.
3. **`cacheHitRate` and `costUsd`** (`spec/metrics.md`, Effort). Arm D must be judged on cost,
   not raw tokens — the whole argument against it is a cache argument. If `prefixStability` is
   not yet implemented (it is specified in `spec/cache-discipline.md` but I did not find it in
   `/tmp/bench-harnesses/proxy/` — **UNVERIFIED whether it is computed anywhere**), the fallback
   is `cacheReadTokens ÷ promptTokens` per turn, which the proxy already records
   (`proxy/server.ts:97`).

Supporting, for mechanism rather than verdict: `turns`, `toolResultShare` ("did we stop pasting
whole files into context"), `redundantToolCalls`, `peakContext`, `contextGrowthPerTurn`.

Design: 4 research tasks (+3 new geosvc ones) × 4 arms × **5 seeds** = 140 runs. Report medians
and the full spread; single runs of an agent are noise.

### 4.5 What would falsify the case for indexing

State the falsifiers up front so the result cannot be argued away:

- **Arm A already solves all research tasks** at comparable `goodput` to B/C → navigation is not
  our bottleneck; ship nothing beyond the bounding fix.
- **B ≈ C** → the AST layer adds nothing over bounded lexical search; drop Option 3.
- **D's `goodput` ≥ B's, or D's `costUsd` > B's at equal `solved`** → the eager map does not pay
  for itself even in its cache-safe form; Option 5 is dead (this is the predicted outcome).
- **aider-map-on ≈ aider-map-off** on paired deltas → a mature, well-ranked repo map does not move
  these tasks; the burden of proof shifts hard onto anyone proposing we build one.
- **On geosvc specifically, if B closes the gap to C and D** → the problem was context pressure,
  i.e. bounding, not structure. That is the hypothesis this whole document predicts.

Conversely, the case for indexing survives only if: on the *new geosvc research tasks*, arm A/B
fail or burn substantially more `goodput` than C or D, **and** the failure mode in the transcripts
is under-enumeration (missed call sites) rather than context blowout. If it is blowout, Option 2
is the fix and no index is warranted.

### 4.6 Order of work

1. Add 2–3 `geosvc` research tasks (prerequisite — without these the study is uninformative).
2. Run the aider map-on/map-off A/B, and read opencode's `toolMix` for `lsp` usage. Zero code.
3. Run arm A vs arm B (bounding only). Low code, fixes a known defect regardless of outcome.
4. Only if 2 or 3 show a structural gap: arms C and D.

---

## Appendix — things I could not verify

Listed explicitly rather than glossed, per the evidence rule.

- **DSH / DeepSeek harness.** Not installed on this machine. The prior study's claims about a
  code-execution mode with a generated typed SDK
  (`~/Work/harness-arena/docs/harness-design-study.md:198,214,639`) cite source paths that do not
  exist here. Re-verify against a real install before citing.
- **`prefixStability`** is specified in `spec/cache-discipline.md` but I found no implementation
  in `/tmp/bench-harnesses/proxy/` (`accounting.ts`, `summary.ts`, `server.ts`). The proxy does
  record `cache_read_input_tokens` (`proxy/server.ts:97`). Whether prefix stability is computed
  anywhere: **unverified**.
- **codex** exact truncation byte constants and `project_doc_max_bytes` default — numeric literals
  not recoverable from the stripped binary.
- **cursor** default grep head limit and any server-side prompt injection — set outside the local
  artifact.
- **claude** LSP absence is argued from missing strings (`textDocument/definition`,
  workspace-symbol) in a 310 MB binary, which is strong but not proof.
- **pi version drift.** The brief describes pi as four tools (read, bash, edit, write) and pi's own
  `package.json:4` still says so, but the installed 0.84.2 exports seven
  (`dist/core/tools/index.d.ts:23`). If the fork was taken from an earlier pi, the grep/find/ls
  tools may never have been ours to lose. Which pi version our fork branched from: **unverified**.
