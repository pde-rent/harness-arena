# Bench harnesses — install + headless invocation reference

Host: darwin arm64 (M3), 2026-08-18. All smoke tests run through `ori` with
`$BENCH_MODEL` (unpinned — provider pinning is a separate worker's problem).

Credentials: `source ~/.prime-bench.env` → `OPENROUTER_API_KEY`, `BENCH_MODEL`,
`BENCH_PROVIDER_ONLY`. Never echo the key.

## Summary

| Harness | Binary | Version | Headless flag | Usage JSON |
|---|---|---|---|---|
| Claude Code | `/Users/derpa/.local/bin/claude` | 2.1.234 | `-p --output-format json` | yes |
| opencode | `/Users/derpa/.opencode/bin/opencode` | 1.18.18 | `run --format json` | yes (step_finish) |
| Hermes | `/Users/derpa/.local/bin/hermes` | git @ `~/.hermes/hermes-agent` (py 3.11.15) | `-z PROMPT` | yes (`--usage-file`) |
| Prime Agent (upstream) | `/Users/derpa/.bench-harnesses/prime-agent-upstream/node_modules/.bin/prime-agent` | 0.7.3 | `-p --mode json` | yes (per-message) |
| Codex CLI | `/Users/derpa/.bench-harnesses/codex/bin/codex` | 0.147.0 | `exec --json` | yes (turn.completed) |
| oh-my-pi | `/opt/harness/bin/pi` (in image) | pi 0.84.2 + omp 0.2.0 | `-p --mode json` | yes (per-message) |

Observed provider for `$BENCH_MODEL` unpinned: **StreamLake** (from
`GET /api/v1/generation?id=<responseId>`, model resolved to
`deepseek/deepseek-v4-flash-20260731`). Not deepinfra ⇒ pinning proxy required.

---

## 1. Claude Code

- Binary: `/Users/derpa/.local/bin/claude` → `/Users/derpa/.local/share/claude/versions/2.1.234`
- Version: `2.1.234 (Claude Code)`
- Already installed; nothing done.

Verified headless (run from the target cwd):

```bash
source ~/.prime-bench.env
cd /path/to/workdir
ori claude --model "$BENCH_MODEL" -p "PROMPT" --output-format json
# prompt from file / stdin:
ori claude --model "$BENCH_MODEL" -p "$(cat task.md)" --output-format json
cat task.md | ori claude --model "$BENCH_MODEL" -p --output-format json
```

Machine-readable output: single JSON object on stdout. Observed top-level keys:
`is_error, duration_api_ms, num_turns, stop_reason, session_id, total_cost_usd,
usage, modelUsage, permission_denials, terminal_reason, subtype, api_error_status,
result, ttft_ms, type, duration_ms, uuid`.
`usage` = `input_tokens, cache_creation_input_tokens, cache_read_input_tokens,
output_tokens, output_tokens_details.thinking_tokens, server_tool_use, service_tier,
cache_creation, speed`.
`modelUsage["<model>"]` = `inputTokens, outputTokens, cacheReadInputTokens,
cacheCreationInputTokens, webSearchRequests, costUSD, contextWindow,
maxOutputTokens, canonicalModel, provider`.
Also `--output-format stream-json --include-partial-messages` for event streams.

cwd: process cwd. Extra roots via `--add-dir`.

Non-interactive/approvals: `-p` still enforces permissions; for unattended edits add
`--permission-mode acceptEdits` or `--dangerously-skip-permissions` (full bypass).
`permission_denials` in the result JSON tells you if anything was blocked.

⚠ Blockers / cost notes:
- A second model call fires per run for session-title generation, observed as
  `anthropic/claude-haiku-4.5` (`query_source: generate_session_title`), and it is
  billed (~$0.005/run) and pollutes `modelUsage`. Suppress with
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` (env var exists in the binary;
  **not re-verified** — the retest costs ~$0.19).
- Large system prompt: the smoke run charged 35 402 input tokens / $0.197 for a
  one-word answer. Highest fixed overhead of the four.
- stderr carries `[claude-code:unrecognized_model]` lines for non-Anthropic models;
  harmless, but keep stdout/stderr separated when parsing.

## 2. opencode

- Binary: `/Users/derpa/.opencode/bin/opencode`
- Version: `1.18.18`
- Already installed; nothing done.

Verified headless:

```bash
source ~/.prime-bench.env
ori opencode --model "$BENCH_MODEL" run --format json --auto \
  --dir /path/to/workdir "PROMPT"
# prompt from file:
ori opencode --model "$BENCH_MODEL" run --format json --auto "$(cat task.md)"
# attach files instead of inlining: -f FILE (repeatable)
```

Machine-readable output: JSON Lines (one event per line). Observed event `type`
values: `step_start`, `text`, `step_finish`. Usage lives on `step_finish`:
`part.tokens = {total, input, output, reasoning, cache:{write, read}}` and
`part.cost`. Every line also has `type, timestamp, sessionID, part`.
`opencode stats` and `opencode export <sessionID>` give post-hoc totals.

cwd: `--dir <path>` (or run from the dir). Model flag: `-m/--model` (ori sets it).

Non-interactive/approvals: `--auto` auto-approves every permission not explicitly
denied. Without it a permission request will block the run.

⚠ Blockers:
- opencode's stored credential at `/Users/derpa/.local/share/opencode/auth.json`
  takes precedence over Ori's injected key — ori warns about it on every launch.
  It worked here, but for reproducibility either delete that entry or accept that
  the stored OpenRouter key (not `$OPENROUTER_API_KEY`) is what gets billed.

## 3. Hermes (Nous Research)

Installed by me:

```bash
curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/bench-harnesses/hermes-install.sh
bash /tmp/bench-harnesses/hermes-install.sh --non-interactive --skip-setup --skip-browser --skip-computer-use
```

(No npm involved — Hermes is Python/uv. Installer log: `/tmp/bench-harnesses/hermes-install.log`.)

- Binary: `/Users/derpa/.local/bin/hermes` (bash shim → `~/.hermes/hermes-agent/venv/bin/python ~/.hermes/hermes-agent/hermes`)
- Code: `~/.hermes/hermes-agent` (git checkout). Data/config: `~/.hermes/config.yaml`, `~/.hermes/.env`
- Version: `hermes --version` prints `Python: 3.11.15 / OpenAI SDK: 2.24.0`; use
  `hermes version` for the release/update line.

Verified headless:

```bash
source ~/.prime-bench.env
ori hermes --model "$BENCH_MODEL" \
  -z "PROMPT" \
  --usage-file /tmp/run/usage.json \
  --in /path/to/workdir --yolo --accept-hooks < /dev/null
# prompt from file:
ori hermes --model "$BENCH_MODEL" -z "$(cat task.md)" --usage-file /tmp/run/usage.json
```

`-z/--oneshot` prints ONLY the final answer text to stdout (no banner, no session id).

Machine-readable usage: `--usage-file PATH` (one-shot only, written even on failure).
Observed keys: `estimated_cost_usd, cost_status, cost_source, input_tokens,
output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
total_tokens, api_calls, model, provider, session_id, completed, failed,
service_tier`. Observed values: `provider: "openrouter"`, `api_calls: 1`.
There is no JSON event stream for the transcript itself — stdout is plain text.

cwd: `--in DIR`. Model/provider: `-m/--model`, `--provider openrouter`, `--reasoning LEVEL`.

Non-interactive/approvals: `-z` auto-bypasses approvals by design. Add `--yolo`
(bypass dangerous-command prompts) and `--accept-hooks` (auto-approve unseen shell
hooks) for a fully unattended run. Redirect `< /dev/null` for safety.

⚠ Notes:
- Loads memory, rules, skills and `AGENTS.md` from cwd — for a clean benchmark add
  `--ignore-user-config` and/or `--ignore-rules`, else prior learned state leaks in.
- Baseline system prompt is heavy: 14 066 input tokens for the one-word smoke run.
- Nothing blocks; run completed unattended.

## 4. Prime Agent (upstream, PrimeIntellect-ai/prime-agent)

Installed by me, into a private prefix so it cannot collide with the local fork at
`/private/tmp/prime-agent` (that repo was NOT touched):

```bash
D=/Users/derpa/.bench-harnesses/prime-agent-upstream; mkdir -p $D/dl; cd $D/dl
curl -fsSL -o prime-agent-0.7.3.tgz https://github.com/PrimeIntellect-ai/prime-agent/releases/download/v0.7.3/prime-agent-0.7.3.tgz
curl -fsSL -o SHA256SUMS      https://github.com/PrimeIntellect-ai/prime-agent/releases/download/v0.7.3/SHA256SUMS
grep prime-agent-0.7.3.tgz SHA256SUMS > sel && shasum -a 256 -c sel   # OK
cd $D && printf '{"name":"prime-agent-upstream-prefix","private":true}' > package.json
bun add ./dl/prime-agent-0.7.3.tgz
PRIME_AGENT_BOOTSTRAP_TOOLS_ON_INSTALL=1 PRIME_AGENT_BOOTSTRAP_KERNEL_ON_INSTALL=1 \
  PRIME_AGENT_INSTALL_UV=1 bun pm trust --all      # runs the blocked postinstall
```

The official installer (`https://app.primeintellect.ai/prime-agent/install.sh`,
saved at `/tmp/bench-harnesses/prime-agent-install.sh`) was NOT used: it does
`npm install -g` (forbidden here) and would install system-wide. The bun path above
installs the identical, checksum-verified release tarball.

- Binary: `/Users/derpa/.bench-harnesses/prime-agent-upstream/node_modules/.bin/prime-agent`
- Version: `0.7.3`
- Bin name is `prime-agent`, **not** `pi` ⇒ no name collision with the fork's `pi`.
- Runtime: the CLI shebang is `#!/usr/bin/env node` and requires Node ≥ 22
  (host has v25.8.1). Install used bun; execution uses node — unavoidable, vendor bundle.

Verified headless:

```bash
source ~/.prime-bench.env
export PATH="/Users/derpa/.bench-harnesses/prime-agent-upstream/node_modules/.bin:$PATH"
cd /path/to/workdir
ori prime-agent --model "$BENCH_MODEL" -p --mode json \
  --no-session --daemon-socket /tmp/run/d.sock --cwd /path/to/workdir "PROMPT" < /dev/null
# prompt from file / stdin (print mode merges piped stdin into the prompt):
cat task.md | prime-agent -p --mode json "Do the task described above"
```

`ori` resolves the harness from PATH, so prepending the prefix bin dir is what
selects upstream. Direct invocation by absolute path works identically.

Machine-readable output: JSON Lines. First line is the session header
`{"type":"session","version":3,"id":...,"timestamp":...,"cwd":...}`, then events:
`agent_start, turn_start, message_start, message_update, message_end, turn_end,
tool_execution_start, tool_execution_update, tool_execution_end, agent_end`
(plus `session_action_update`, `compaction_*`, `auto_retry_*`).
Usage rides on each assistant message object:
`message.usage = {input, output, cacheRead, cacheWrite, totalTokens,
cost:{input, output, cacheRead, cacheWrite, total}}`, alongside
`message.provider` (`"openrouter"`), `message.model`, `message.api`
(`"openai-completions"`), `message.stopReason`, `message.responseId`
(`gen-…` — feed to `GET https://openrouter.ai/api/v1/generation?id=` to learn the
real upstream provider). Sum the last `turn_end`/`agent_end` message usages per run.
Tool events carry `toolName` (`ipython`), `result`, `isError`.

cwd: `--cwd <dir>` (or process cwd).

Non-interactive/approvals: none observed — `-p` executed the `ipython` tool and
wrote a file with no prompt (`isError:false` throughout). Prime Agent explicitly
runs model-generated Python with your user permissions and is **not** a sandbox.
Optional bounds: `--autonomous` + `--autonomous-max-turns/-tokens/-timeout-ms`.

⚠ Blockers / gotchas:
- **Shared state with the local fork.** The fork
  (`/private/tmp/prime-agent`, `@earendil-works/pi-coding-agent` 0.7.2) declares the
  same `piConfig` → `{"name":"prime-agent","configDir":".prime/agent"}`. So both use
  `~/.prime/agent` and the same daemon namespace
  (`$TMPDIR/prime-agent-501/daemon.sock`). `prime-agent status` already lists three
  stale 0.7.2 daemons from the fork. For benchmark runs always pass
  `--daemon-socket <run-local path>` and `--no-session` (or `--session-dir`) to keep
  0.7.3 off the shared socket and avoid a version-mismatched daemon.
- Daemon-backed sessions survive terminal exit; `prime-agent shutdown` / `doctor`
  clean up if a run leaks processes.

---

## `ori pi` vs `ori prime-agent` — different products?

**Yes, distinct — but same lineage.**

- `ori pi` launches **Pi** (`pi`, `@earendil-works/pi-coding-agent`,
  github.com/earendil-works/pi, aka badlogic/pi-mono). The repo at
  `/private/tmp/prime-agent` is a checkout of that codebase at 0.7.2 — its
  publishable bin is `pi`.
- `ori prime-agent` launches **Prime Agent** (`prime-agent`, PrimeIntellect-ai),
  which the README states is "built on top of `pi`" and adds the RLM / Continual
  Harness / daemon-session layer. It vendors pi's packages as
  `@earendil-works/pi-agent-core|pi-ai|pi-tui` pinned to prime-agent release tarballs.
- Practical consequence: different bin names, but **identical config dir and daemon
  namespace** (`.prime/agent`) in the versions on this box. Isolate per run.
- Neither `pi` nor `hermes` was on PATH before this work; `pi` is still not installed
  (not requested).

## Ori launcher facts

- `ori` 0.7.1+6e1701e at `/Users/derpa/.local/bin/ori`.
- Launchers: `claude codex grok opencode hermes pi prime-agent|prime dsh`.
- Each accepts `--model <openrouter model id>`, `--reasoning-effort <max|xhigh|high|
  medium|low|minimal|none>`, `--global-auth/--no-global-auth`; everything after is
  passed to the harness untouched.
- Ori resolves each harness from PATH and offers to install it if missing.
- `ori --json` forces machine JSON for ori's own output (harness stdout unaffected).
- All four harnesses launched successfully through `ori <harness> --model $BENCH_MODEL`.

## Smoke tests actually run (prompt: "reply with the single word: ok")

| Harness | dir | result | tokens in/out | cost | provider seen |
|---|---|---|---|---|---|
| claude | /tmp/bench-smoke/claude | ok (empty `result` field, 2 turns) | 35402 / 4 (+31232 cache read) | $0.197 | firstParty via OpenRouter |
| opencode | /tmp/bench-smoke/opencode | `ok` | 7519 / 3 | $0.00106 | openrouter |
| hermes | /tmp/bench-smoke/hermes | `ok` | 14066 / 14 (1536 cache read) | $0.00202 | openrouter |
| prime-agent | /tmp/bench-smoke/prime | `ok` | 4866 / 17 | $0.00069 | openrouter → **StreamLake** |
| prime-agent (tool test) | /tmp/bench-smoke/prime2 | wrote ok.txt via `ipython` tool, no approval prompt | — | — | — |

---

## 5. aider

Installed by me, into a private venv (no npm/node, nothing system-wide):

```bash
mkdir -p ~/.bench-harnesses/aider
uv venv ~/.bench-harnesses/aider/venv --python 3.12
uv pip install --python ~/.bench-harnesses/aider/venv/bin/python aider-chat
```

- Binary: `/Users/derpa/.bench-harnesses/aider/venv/bin/aider`
- Version: `aider 0.86.2` (CPython 3.12.13)
- The user's `~/.aider.conf.yml` was NOT read or written (HOME is redirected per run).

Verified headless (run from the target cwd, **not** through `ori`):

```bash
W=/path/to/workdir
env HOME=$W/.bench-aider-home TERM=dumb \
~/.bench-harnesses/aider/venv/bin/aider \
  --model openai/$BENCH_MODEL --weak-model openai/$BENCH_MODEL \
  --openai-api-base http://localhost:PORT/v1 --openai-api-key bench-dummy \
  --message "PROMPT" \
  --yes-always --no-git --no-auto-commits --no-dirty-commits --map-tokens 0 \
  --no-check-update --no-show-release-notes --no-show-model-warnings \
  --no-detect-urls --no-analytics --no-stream --no-pretty --no-fancy-input \
  --env-file $W/.bench-aider.env \
  --input-history-file $W/.bench-aider.input.history \
  --chat-history-file $W/.bench-aider.chat.history.md \
  --llm-history-file $W/.bench-aider.llm.history
# prompt from file: --message-file PATH
```

`--message` runs exactly one turn and exits. Exit 0 verified.

Wiring: aider's own `--openai-api-base` + `--openai-api-key`; the `openai/` model
prefix routes litellm to the OpenAI-compatible client. `ori` is not involved.

Config isolation: aider reads `./.aider.conf.yml`, `<git root>/.aider.conf.yml` and
`~/.aider.conf.yml`, and configargparse loads **all** of them even when `-c` is given —
so `-c` is not a suppression mechanism. Redirecting `HOME` is; it also kills
`~/.aider.model.settings.yml` and `~/.aider/oauth-keys.env`. `--env-file` redirects the
`.env` pickup. Residual: a `./.aider.conf.yml` inside the workdir would still apply.

Repo instructions: aider has **no** `AGENTS.md`/`CLAUDE.md`/`CONVENTIONS.md`
auto-discovery — only files passed with `--read`. Planting `AGENTS.md` +
`CONVENTIONS.md` in the workdir left promptTokens byte-identical at **561**.

Repo map / git: `--no-git`. The corpus `setup.sh` scripts never create a git repo, so
with git enabled aider would `git init` the workdir, add `.gitignore`, and still report
`Git repo: .git with 0 files` — an empty repo map (verified for free with
`--exit --show-repo-map`). `--no-git` therefore costs zero capability and avoids
mutating the graded tree. Consequence to carry into the writeup: aider starts with no
repo map and no files in the chat, so it must explore via auto-approved shell commands
(`--suggest-shell-commands`, default on). That is aider's design under this corpus, and
a real handicap versus the tool-using harnesses.

Second billed call: none. aider's weak model covers commit messages (removed by
`--no-auto-commits`) and chat-history summarisation (never triggers on a one-shot).
Exactly one `/chat/completions` row per run, and no `/models` probe.
`--weak-model` is pinned to the same proxy model so nothing can escape the pin.

Machine-readable output: **none.** No JSON mode. stdout carries a plain
`Tokens: 561 sent, 34 received.` line; raw prompts go to `--llm-history-file`.
Meter aider from the proxy NDJSON.

Verified live: exit 0, no prompt, 1 request, `providerServed=DeepInfra`,
**561 promptTokens** for "reply with exactly: ok" — the lowest fixed overhead measured.

## 6. cline

Installed by me, into a private bun prefix (no npm, no global install):

```bash
D=~/.bench-harnesses/cline; mkdir -p $D; cd $D
printf '{"name":"cline-prefix","private":true}' > package.json
bun add cline@3.0.55
```

- Binary: `/Users/derpa/.bench-harnesses/cline/node_modules/.bin/cline`
  → `@cline/cli-darwin-arm64/bin/cline`, a **Mach-O arm64 native executable**
  (no node at run time either).
- Version: `3.0.55`

Verified headless:

```bash
W=/path/to/workdir
mkdir -p $W/.bench-cline-data/settings
cat > $W/.bench-cline-data/settings/providers.json <<'EOF'
{"version":1,"lastUsedProvider":"openai-compatible","providers":{"openai-compatible":{
 "settings":{"provider":"openai-compatible","apiKey":"bench-dummy",
 "model":"MODEL","baseUrl":"http://localhost:PORT/v1"},
 "updatedAt":"2026-01-01T00:00:00.000Z","tokenSource":"manual"}}}
EOF
cd $W && env HOME=$W/.bench-cline-home CLINE_DIR=$W/.bench-cline-config TERM=dumb \
~/.bench-harnesses/cline/node_modules/.bin/cline \
  --json --auto-approve true -c $W \
  --config $W/.bench-cline-config --data-dir $W/.bench-cline-data \
  "PROMPT" < /dev/null
```

A bare positional prompt is already the headless path (act mode + auto-approve);
`-i/--tui` is opt-in. Exit 0 on success, 1 on model error.

⚠ **Wiring gotcha (cost me two runs):** do **not** pass `-P/--provider`, `-m/--model`
or `-k/--key` on the run command line. Doing so makes cline rewrite
`<data-dir>/settings/providers.json` at startup, dropping `baseUrl`/`apiKey` and falling
back to `gpt-4o` against `api.openai.com` — the proxy sees nothing and OpenAI answers
"Incorrect API key provided: bench-dummy". Pre-write `providers.json` instead and pass no
provider flags. The file shape is exactly what
`cline auth -p openai -k KEY -m MODEL -b URL --data-dir DIR` writes (`openai` normalises
to `openai-compatible`).

Isolation: `--config` + `--data-dir` + redirected `HOME`/`CLINE_DIR` keep `~/.cline`
(global settings, providers, skills, hooks, MCP servers, sessions, global `AGENTS.md`)
completely out of the run. Useful escape hatches found in the bundle:
`CLINE_PROVIDER_SETTINGS_PATH`, `CLINE_GLOBAL_SETTINGS_PATH`, `CLINE_MCP_SETTINGS_PATH`,
`CLINE_DATA_DIR`.

Repo instructions — **partial, accepted bias.** Global/user rules are fully neutralised
by the isolation above, but there is **no switch for workspace rules**: the bundle
discovers `./.clinerules` (file or dir) and `./AGENTS.md` unconditionally. No env var,
flag or settings key exists (grepped `@cline/core`, `@cline/shared`, `@cline/agents` —
the CLI has none of the VSCode extension's per-rule toggle state). Plant test:
`AGENTS.md` + `.clinerules/plant.md` in the workdir moved promptTokens
**5282 → 5479 (+197)**, so pickup is real. The only override is `-s/--system`, which
replaces the whole system prompt and would distort far more than it fixes. Mitigation
relied on: no corpus task ships either file.

Second billed call: **none found** — no session-title or summarisation call; a successful
run produced exactly one `/chat/completions` row. `--compaction agentic` (default) only
fires on long contexts.

Machine-readable output: **yes**, `--json` → NDJSON on stdout, event `type` values
`hook_event`, `agent_event`, `run_result`. The final `run_result` line has
`finishReason`, `iterations`, `durationMs`, `text`, `model.{id,provider}` and
`usage`/`aggregateUsage` = `{inputTokens, outputTokens, cacheReadTokens,
cacheWriteTokens, totalCost}`. Observed `inputTokens: 5282`, matching the proxy exactly;
`totalCost` is 0 for a custom provider.

Verified live: exit 0, no prompt, `providerServed=DeepInfra`, **5282 promptTokens** for
"reply with exactly: ok". 429s on the pinned model are retried (`--retries`, default 6)
and appear as extra rows.

## 7. OpenAI Codex CLI

Installed by me (native aarch64 Rust binary from the GitHub release — no npm, no node
anywhere in the path; `ori codex` exists but is NOT used, it rewrites the base URL back
to OpenRouter and the proxy never sees the traffic):

```bash
D=/Users/derpa/.bench-harnesses/codex; mkdir -p $D/bin $D/dl; cd $D/dl
curl -fsSL -o codex-aarch64-apple-darwin.tar.gz \
  https://github.com/openai/codex/releases/download/rust-v0.147.0/codex-aarch64-apple-darwin.tar.gz
tar xzf codex-aarch64-apple-darwin.tar.gz
mv codex-aarch64-apple-darwin $D/bin/codex && chmod +x $D/bin/codex
xattr -d com.apple.quarantine $D/bin/codex 2>/dev/null
$D/bin/codex --version     # codex-cli 0.147.0
```

- Binary: `/Users/derpa/.bench-harnesses/codex/bin/codex` (220 MB, self-contained)
- Version: `codex-cli 0.147.0` (release tag `rust-v0.147.0`)

Verified headless:

```bash
W=/path/to/workdir
CODEX_HOME=$W/.bench-codex-home BENCH_API_KEY=bench-dummy DO_NOT_TRACK=1 \
  /Users/derpa/.bench-harnesses/codex/bin/codex exec --json \
  --skip-git-repo-check --ephemeral --ignore-rules -C $W \
  --dangerously-bypass-approvals-and-sandbox -o $W/.bench-codex-last.txt \
  -m "$BENCH_MODEL" "PROMPT" < /dev/null
# prompt from stdin: pass `-` (or no prompt arg) and pipe it in
```

`codex exec` is the one-shot mode: no TUI, exits when done, exit 0 on success and 1 on
`turn.failed` (honest, unlike hermes).

Machine-readable output: `--json` → JSONL. Observed `type` values: `thread.started`,
`turn.started`, `item.completed` (with `item.type` = `agent_message` | `error` | …),
`turn.completed`, `turn.failed`. Usage is on `turn.completed`:
`usage = {input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens,
reasoning_output_tokens}`. `-o FILE` writes only the final message text.

cwd: `-C/--cd DIR` (`--add-dir` for extra writable roots).

Non-interactive/approvals: `--dangerously-bypass-approvals-and-sandbox` (also
`-a never` + `-s danger-full-access` as the finer-grained pair). Without it an approval
request stops the run.

Wiring to the proxy: per-run `$CODEX_HOME/config.toml`, so `~/.codex` is never read or
written (codex appends its own `[projects."…"] trust_level` entries to that file, so the
dir must be per run):

```toml
model = "<MODEL>"
model_provider = "bench"
model_context_window = 1048576
project_doc_max_bytes = 0
check_for_update_on_startup = false
disable_response_storage = true

[model_providers.bench]
name = "Bench (pinned proxy)"
base_url = "http://127.0.0.1:<port>/v1"
env_key = "BENCH_API_KEY"
wire_api = "responses"
```

⚠ **Responses API only — the proxy had to be extended.** 0.147 removed chat completions:
`wire_api = "chat"` aborts at startup with "`wire_api = "chat"` is no longer supported".
Codex therefore posts to `POST /v1/responses`, which the shim used to pass through
unpinned. `proxy/server.ts` was extended additively (existing shapes untouched):
`/responses` is now a rewritable shape (model + `provider.only` pinning applies), the SSE
`response` envelope is unwrapped, `input_tokens_details.cached_tokens` /
`output_tokens_details.reasoning_tokens` are read, and the provider name is resolved via
`GET /api/v1/generation` because the responses shape carries it nowhere — not in the body,
not in a header (only `X-Generation-Id` is exposed). OpenRouter does not index a *streamed*
generation immediately (404 for the first ~6 s), so that lookup backs off to 31 s and the
NDJSON row can land up to ~30 s **after** the harness has exited.

⚠ **Streams are now drained eagerly.** Codex aborts the response body the moment it has
the final text, and the old `pipeThrough`/`flush` tap dropped the entire usage row when a
client did that (first codex run: correct answer, zero proxy rows). The shim now pumps the
upstream reader itself and ignores client cancellation for metering. This very likely also
fixes the documented hermes metering gap.

⚠ Fairness / notes:
- `project_doc_max_bytes = 0` disables `AGENTS.md` pickup. Proven: a 2 529 B `AGENTS.md`
  planted in the workdir gave **9 879** promptTokens, identical to no file at all; the same
  file with the default `project_doc_max_bytes = 32768` gave **11 674**.
- **No title/summarisation second call.** Every verified run produced exactly one
  `/responses` request — nothing to disable, unlike opencode (`--title`) and hermes
  (`auxiliary.title_generation.enabled: false`).
- `--dangerously-bypass-approvals-and-sandbox` also turns off the macOS seatbelt sandbox.
  That matches prime-agent's unsandboxed execution but is more permissive than
  `opencode --auto`; it is a real capability difference, not just a flag.
- Every run emits `item.completed` / `error`: "Model metadata for `<model>` not found.
  Defaulting to fallback metadata" — codex guesses context-window and compaction limits for
  a non-OpenAI model. `model_context_window` does not silence it.
- Verified live: exit 0, no prompt, one request, `providerServed=DeepInfra`,
  **9 879 promptTokens** for "reply with exactly: ok".

---

## 9. oh-my-pi (can1357/oh-my-pi)

<https://github.com/can1357/oh-my-pi> — npm `oh-my-pi@0.2.0`.

**It is an extension, not a separate agent.** `pi install oh-my-pi` registers a package that pi
auto-discovers and loads on the next session; the `oh-my-pi` binary in the package is only a
`doctor`/`init` diagnostic tool and never runs a task. So the harness is the same pinned pi as the
`pi` entry, with the extension present.

What it changes, per its README: replaces pi's default system prompt with an orchestrator prompt
that routes work to specialist sub-agents, and adds its own agents (oracle, librarian, explore) and
a skill system with full instruction injection. Configured through `.oh-my-pi.jsonc`.

### Registry consequence

The bare `pi` entry runs with `-ne -ns -np -na` — no extensions, no skills, no prompts, no agents —
which is the right shape for measuring pi itself. Those switches must **not** be carried over here:
each one disables part of what oh-my-pi installs, so copying pi's argv would benchmark stock pi
under another name. The `oh-my-pi` entry therefore passes none of them.

Pairing the two entries is the point: `pi` is the control, `oh-my-pi` is the treatment, and the
difference between them is the extension's effect. Both receive the identical
`corpus/AGENT_INSTRUCTIONS.md` baseline file per `spec/baseline.md`, so the instruction channel is
held constant and only the harness differs.

### Container

`bench/oh-my-pi:pinned`, from `containers/Containerfile.oh-my-pi`: node:22-slim pinned by digest,
both packages installed into one prefix so the extension sits beside the CLI that loads it, empty
in-image `HOME=/home/bench`, git and ripgrep present because pi shells out to them.

### Not yet measured

No smoke run or fixed-context measurement has been taken for this harness yet, so it has no row in
the fixed-context table below. Its prompt overhead is expected to differ substantially from bare
pi, since replacing the system prompt is the extension's primary function — that difference is a
result to report, not a fault to correct.

## Fixed context overhead — all harnesses

| Harness | promptTokens ("reply with exactly: ok") |
|---|---|
| aider | 561 |
| prime-agent (fork) | 4 186 |
| prime-agent (upstream) | 4 476 |
| cline | 5 282 |
| opencode | 6 172 |
| Codex CLI | 9 879 |
| Hermes | 13 352 |
| Claude Code | 27 344 |

---

## 8. Cursor CLI (`cursor-agent`) — pinnable ONLY via the `agent-cli-local` build

Installed by me into an isolated prefix (no npm/node/system-wide install — the package
vendors its own `node`, `rg` and native modules):

```bash
D=~/.bench-harnesses/cursor; V=2026.08.11-e8db854
mkdir -p $D/dl $D/versions/$V $D/local/$V
# the build the public installer ships (NOT pinnable — see below)
curl -fsSL "https://downloads.cursor.com/lab/$V/darwin/arm64/agent-cli-package.tar.gz" \
  -o $D/dl/agent-cli-package-$V.tar.gz          # sha256 46044d6d…41790
tar --strip-components=1 -xzf $D/dl/agent-cli-package-$V.tar.gz -C $D/versions/$V
# the build that IS pinnable
curl -fsSL "https://downloads.cursor.com/lab/$V/darwin/arm64/agent-cli-local-package.tar.gz" \
  -o $D/dl/agent-cli-local-package-$V.tar.gz    # sha256 26220466dfff53ecdacbc874150de33bae1d84e3db6db3db240897266811116e
tar --strip-components=1 -xzf $D/dl/agent-cli-local-package-$V.tar.gz -C $D/local/$V
$D/local/$V/cursor-agent-local --version        # 2026.08.11-e8db854
```

The official installer (`https://cursor.com/install`) was NOT used: it hardcodes
`$HOME/.local/share/cursor-agent`, symlinks `~/.local/bin/{agent,cursor-agent}` — i.e.
installs outside any prefix — and ships only the non-pinnable build.

### Can it be pointed at an arbitrary endpoint? Yes — but not the binary people install.

- `cursor-agent` (package `@anysphere/agent-cli-runtime`) exposes `--base-url`,
  `--local-agent-api-key`, `--authless`, `--enable-bedrock` as hidden options, and **every
  one of them aborts**: `Error: --base-url can only be used with agent-cli-local`.
  In the bundle, `src/main.tsx` calls the entry with no arguments, so `localAgentRuntime`
  is `undefined`, so `product = "agent-cli"` and all local-provider paths are dead
  (`6260.index.js`: `bt = void 0 !== localAgentRuntime`). No env var flips this;
  `CURSOR_AGENT_CLI_LOCAL_MODE` only changes the terminal title and usage string.
- Its only routing knob, `-e/--endpoint` (`CURSOR_API_ENDPOINT`, default
  `https://api2.cursor.sh`), speaks Cursor's proprietary Connect-RPC/protobuf
  `aiserver.v1` protocol — divertible, but not an OpenAI shape and not meterable here.
- `cursor-agent-local` (package `@anysphere/agent-cli-local-runtime`, same version, same
  CDN path with `agent-cli-local-package.tar.gz`) ships the runtime and speaks plain
  **OpenAI `POST {base}/v1/chat/completions`**, `authorization: Bearer <key>`,
  `user-agent: Cursor-CLI/<version> (darwin arm64)`, streamed, 17 tools. With `--authless`
  it needs no Cursor account and contacts no Cursor server at all.

Verified headless:

```bash
W=/path/to/workdir
env HOME=$W/.bench-cursor-home CURSOR_DATA_DIR=$W/.bench-cursor-data \
    CURSOR_AGENT_CLI_AUTHLESS_MODE=true DO_NOT_TRACK=1 TERM=dumb \
~/.bench-harnesses/cursor/local/2026.08.11-e8db854/cursor-agent-local \
  --authless --base-url http://127.0.0.1:PORT/v1 --local-agent-api-key bench-dummy \
  --model "$BENCH_MODEL" --output-format json --force --trust \
  --workspace $W -p "PROMPT" < /dev/null
```

`-p/--print` is the one-shot mode; `--force` (alias `--yolo`) auto-approves every tool and
`--trust` skips the workspace-trust prompt. Output is one JSON object:
`{type, subtype, is_error, duration_ms, duration_api_ms, result, session_id, request_id,
usage:{inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens}}`.

- **Exit codes honest:** 0 on success, 1 on provider failure (verified against a closed
  port: `LocalProviderError: Failed after 3 attempts … ECONNREFUSED`, exit 1).
- **Model fidelity exact:** the requested slug goes out verbatim; no aliasing.
  Self-reported `inputTokens` matched the proxy's `promptTokens` exactly on every run.
- **No second billed call:** exactly one `POST /chat/completions` per run — no titling,
  no summarisation, no router. (`--auto-review` would add a server classifier; not used.)
- **Isolation:** `HOME` + `CURSOR_DATA_DIR` per run. A rule planted at
  `$HOME/.cursor/rules/*.mdc` under the redirected HOME did not reach the request, and
  the outgoing `<user_info>` shows transcripts/terminals resolving under `CURSOR_DATA_DIR`.
- **Repo instructions — `AGENTS.md`, delivery proven.** Sink plant tests: `AGENTS.md`
  read (+581 B), `.cursor/rules/*.mdc` read (+592 B), **`CLAUDE.md` also read** (+554 B),
  `CURSOR.md` not read. Live: `corpus/AGENT_INSTRUCTIONS.md` as `AGENTS.md` moved
  promptTokens **19 509 → 20 559 (+1 050)**, all of it in the proxy's `historyTokens`
  segment (189 → 1 241); it is injected once into the user-message chain, not the system
  prompt.

### ✔ Blocker cleared (2026-08-20) — registry entry is `"enabled": true`

The blocker below was ours, not Cursor's, and it is fixed: `proxy/server.ts` now answers
`GET /models` itself with a single-entry catalogue containing only the pinned model, so
Cursor can no longer ingest OpenRouter's list and the race it caused is gone.

Verified containerized against the live proxy, `smoke-ok`:

```
{"runId":"cursor__smoke-ok__1","solved":true,"outcome":"solved","exitCode":0,"requests":1,
 "promptTokens":15395,"completionTokens":3,"totalTokens":15398,
 "providersServed":["DeepInfra"],"costUsd":0.00123214,"wallMs":9022}
```

Proxy rows for that run: `/models 200 note=models_catalogue_served_by_shim`, then one
`/chat/completions 200 providerServed=DeepInfra promptTokens=15395`. Repeated runs give
**15,395 every time** — no more 14,381/19,509 swing. 15,395 = the documented catalogue-free
14,381 plus the ~1,050 the baseline `AGENTS.md` costs, which is the expected total.

One flake seen, not Cursor's: the runner's account-spend backstop can bill a previous run's
cost to the next attempt when OpenRouter's credits endpoint lags, discarding an attempt as
`$0.001232 of spend never reached the meter` while its own proxy rows are clean.

The original finding, kept for the record:



`cursor-agent-local` unconditionally does `GET {base}/models` at startup and splices
**every returned slug** into the `Task` tool description ("… you may ONLY use model slugs
from this list: - <slug> …"). No flag or env disables it. The proxy's pin gate forwards
`GET /models` to OpenRouter, so Cursor ingests OpenRouter's whole catalogue: the `Task`
schema grows 8 093 B → 24 783 B and promptTokens grow **+5 126 every request**. It is also
a **race** — the fetch is async and sometimes loses to prompt assembly — so the same
command yields **14 381** (catalogue absent) or **19 509** (catalogue present), a 36 %
nondeterministic swing no existing control would catch. Proven both ways against a logging
sink: 400 fake slugs → all 400 in the `Task` description; `/models` → 404 → clean 8 093 B
schema and the run still succeeds.

**Fix required in `proxy/server.ts`** (not edited here — another worker owns it): serve
`GET /models` from the shim as a single-entry list containing only `$BENCH_MODEL` instead
of forwarding it. That kills the contamination and the race at once, and is the correct
control anyway — a harness should not be able to see models other than the pinned one.
Then flip `enabled` to `true`; nothing else in the entry needs to change.

**Done.** The proxy serves the catalogue (`server.ts`, `models_catalogue_served_by_shim`) and
the entry is enabled unchanged apart from `enabled`.

### Measured

| condition | promptTokens |
|---|---|
| native, model catalogue present | 19 509 |
| native, model catalogue absent (**true fixed overhead**) | **14 381** |
| container `bench/cursor:pinned`, catalogue present | 19 478 (−31 vs native) |
| native + `AGENTS.md` (AGENT_INSTRUCTIONS.md), catalogue present | 20 559 |

Container ≈ native (−31 tokens, explained by a shorter workspace path and no git warm-up in
`<user_info>`): **the first harness of the eleven with no detectable host contamination.**

Breakdown of the clean run: system prompt 6.5 KB / 1 444 tokens, tool schemas ~53 KB /
12 145 tokens across 17 tools (Shell, Glob, Grep, AwaitShell, Read, Delete, StrReplace,
Write, EditNotebook, TodoWrite, GenerateImage, AskQuestion, Task, GetMcpTools,
FetchMcpResource, SwitchMode, CallMcpTool) — the tool surface dominates.

Container: `containers/Containerfile.cursor`, digest-pinned debian base, version- and
sha256-pinned `agent-cli-local-package.tar.gz` (linux/arm64
`30482dfb8e846e216199972f79b697ec86b33b074f1016e6ab6cd0710c80f284`), empty build context,
no key inside.

**Bias risk accepted:** this measures Cursor's `agent-cli-local` build, not the `agent-cli`
build a real subscriber runs. Same version, system prompt, tools and schemas — only the
inference transport differs — but it is not literally the shipped product and must be
stated wherever Cursor's numbers are published.

---

## 9. Gemini CLI (`@google/gemini-cli`) — NOT pinnable, stays `"enabled": false`

Installed 0.55.1 into an isolated prefix (`bun add @google/gemini-cli@0.55.1`). It is
trivially **divertible** and completely **unpinnable**, which are not the same thing.

Re-verified 2026-08-20 straight off the installed bundle
(`node_modules/@google/gemini-cli/bundle/*.js`):

| probe | result |
|---|---|
| `grep -o 'OPENAI_[A-Z_]*'` | **0 hits** |
| auth-type literals | `"oauth-personal"` 28, `"gemini-api-key"` 35, `"vertex-ai"` 28, `"cloud-shell"` 6 |
| base-URL overrides | `GOOGLE_GEMINI_BASE_URL` 40, `GOOGLE_VERTEX_BASE_URL` 28, `CODE_ASSIST_ENDPOINT` 24 |

All three overrides redirect the *destination* while keeping the Google
GenerativeLanguage *shape*: model in the URL path
(`POST {base}/v1beta/models/{model}:streamGenerateContent?alt=sse`), `x-goog-api-key` auth,
a `{contents, systemInstruction, tools:[{functionDeclarations}], generationConfig}` body,
and SSE of `GenerateContentResponse` with `usageMetadata`.

`proxy/server.ts` implements `openai`, `anthropic` and `responses`. It does **not** implement
that shape, and its pin gate correctly refuses the path rather than proxying it unpinned —
so enabling this entry would produce runs with no model force, no provider pin and no
metering. An unpinnable harness is worse than a missing one, so it stays out.

Two ways back in, neither taken here: teach the proxy the Gemini shape (URL rewrite for the
model, `x-goog-api-key`, `provider.only` injection, `usageMetadata` accounting), or wait for
upstream to ship OpenAI-compatible endpoints (feature request still open, not shipped).

## 10. Qwen Code (`@qwen-code/qwen-code`) — the pinnable Gemini CLI fork

```bash
mkdir -p ~/.bench-harnesses/qwen-code && cd $_
printf '{"name":"qwen-code-prefix","private":true}' > package.json
bun add @qwen-code/qwen-code@0.21.14
./node_modules/.bin/qwen --version      # 0.21.14
```

Registered as its own id `qwen-code`, **never** as a stand-in for `gemini-cli`: it ships its
own system prompt ("You are Qwen Code … developed by Alibaba Group"), its own 63-tool surface
and its own skills catalogue. Same lineage, different product.

**Wiring is env-only** — no config file is needed for routing:

```bash
OPENAI_BASE_URL={{BASE_URL}}   OPENAI_API_KEY=bench-dummy   OPENAI_MODEL=$BENCH_MODEL
qwen -p "PROMPT" -o json --approval-mode yolo -m "$BENCH_MODEL"
```

Verified against a logging sink: plain streamed `POST {base}/chat/completions`,
`authorization: Bearer <key>`, model verbatim. `QWEN_CODE_SUPPRESS_YOLO_WARNING=1` is
required — the yolo banner otherwise prints to stdout and corrupts the JSON.

- **Second billed call — found and disabled.** A stock run fires **two**
  `/chat/completions`. The second is the *managed memory extraction subagent* (captured
  body: 4 messages, 7 tools, 9,362 promptTokens / 94 completion). Defaults are
  `enableManagedAutoMemory: true`, `enableManagedAutoDream: true`, so the per-run
  `.qwen/settings.json` sets `memory.enableManagedAutoMemory`, `.enableManagedAutoDream`,
  `.enableAutoSkill`, `.enableTeamMemory`, `.enableTeamMemorySync` all `false`. With them
  off: exactly **one** metered request, and the main turn shrinks 32,538 → 31,475
  promptTokens because the memory tooling was in the main prompt too.
- **Exit code honest, `is_error` is not.** Exit 0 on success, non-zero on failure; but a
  failed model call lands as `"result": "[API Error: 500 …]"` with `"is_error": false`.
  Trust the exit code and the meter, not that field.
- **Isolation:** `HOME` + `QWEN_CODE_HOME` redirected into the workdir, so `~/.qwen`
  (settings, memories, skills, extensions, MCP, sessions) is unreachable.
- **Instruction file — delivery proven.** Context-file list is
  `[QWEN.md, AGENTS.md, QWEN.local.md]`, so only `AGENTS.md` is planted (planting `QWEN.md`
  too would deliver the same briefing twice). Containerized: **31,580 → 32,427**
  promptTokens (+847), and the proxy's own `contextTokens` **30,427 → 31,274** (+847 exactly).

Verified containerized against the live proxy, `smoke-ok`:

```
{"runId":"qwen-code__smoke-ok__1","solved":true,"outcome":"solved","exitCode":0,"requests":1,
 "promptTokens":32427,"completionTokens":3,"totalTokens":32430,
 "providersServed":["DeepInfra"],"costUsd":0.002398092,"wallMs":7634}
```

32,427 is the **largest fixed context in the registry** — 63 tools plus a skills catalogue
injected as a `<system-reminder>` in the first user message.
