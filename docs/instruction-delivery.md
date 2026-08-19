# Instruction delivery, verified

One instruction file — `corpus/AGENT_INSTRUCTIONS.md`, 89 lines, 4,306 B,
sha256 `6b5051268f4c4b4440fb0b1c1d764850b0bdc2a925451e9db0c92f2c23548a2f` — delivered to every
harness through whichever filename that harness natively reads. Byte-identical everywhere: the
runner materialises it from the `files` map in `runner/harnesses.json`, and each entry's copy was
read from the corpus file at wiring time, never retyped (asserted equal on write).

This document records **whether it arrives**, measured, per harness. Delivery is not assumed
anywhere.

## Method

For each enabled harness, the same one-word task (`corpus/tasks/smoke-ok`: *reply with exactly:
ok*) was run twice in its pinned container (or its isolated native prefix), once without the file
and once with it, changing nothing else. Tokens are the **proxy's own** count of the outgoing
request body — the vendored DeepSeek-V4-Flash tokenizer, one tokenizer for every harness, split
into the five segments defined in `spec/token-accounting.md`. Provider self-reports are not used.

> **Upstream was down for these runs.** Every call returned OpenRouter `401 "User not found."` —
> the benchmark key is dead. That does not affect these numbers: `contextTokens` and the segment
> split are computed by the proxy from the request the harness sent, before the upstream reply,
> and the without/with pairs are otherwise identical runs. It does mean no completions were
> produced and **nothing was billed**. Re-run the pairs when the key is restored if end-to-end
> confirmation is wanted; the deltas below will not move.

## Results

| harness | filename | delivery mechanism | tokens without | tokens with | Δ | segment | verdict |
|---|---|---|---:|---:|---:|---|---|
| prime-agent-fork | `AGENTS.md` | auto-discovery (`-nc` removed) | 3,623 | 4,583 | **+960** | `system` | reading |
| prime-agent-upstream | `AGENTS.md` | auto-discovery (`-nc` removed) | 3,861 | 4,821 | **+960** | `system` | reading |
| pi | `AGENTS.md` | auto-discovery (`-nc` removed, `HOME` redirected) | 1,317 | 2,341 | **+1,024** | `system` | reading |
| claude | `CLAUDE.md` | auto-discovery (never suppressed) | 18,767 | 19,769 | **+1,002** | `currentTurn` | reading |
| opencode | `AGENTS.md` | config `instructions: ["AGENTS.md"]` + `OPENCODE_DISABLE_PROJECT_CONFIG` removed | 6,946 | 7,897 | **+951** | `system` | reading |
| codex | `AGENTS.md` | `project_doc_max_bytes = 32768` | 8,620 | 9,580 | **+960** | `history` | reading |
| aider | `CONVENTIONS.md` | **`--read` (explicit load, not discovery)** | 558 | 1,534 | **+976** | `history` | reading |
| cline | `AGENTS.md` | unconditional workspace pickup (no switch exists) | 4,743 | 5,694 | **+951** | `system` | reading |
| hermes | `AGENTS.md` | `--ignore-rules` removed — **inert under `-z`** | 11,565 | 11,565 | **0** | — | **not reading** |
| cursor | `AGENTS.md` | auto-discovery | 19,509 | 20,559 | **+1,050** | `history` | reading (measured previously; `enabled:false`) |
| gemini-cli | `GEMINI.md` | auto-discovery (no off switch — which this baseline wants) | — | — | — | — | wired, **unverified** |

Δ spread is 951–1,050 for the auto-discovering harnesses, which is the file plus each harness's
own wrapper (provenance header, `<project_context>`-style framing). aider's 976 is the same file
delivered as a read-only chat file. Nothing is anomalous; nothing was tuned to make a number look
right.

The file is planted for hermes too, so the entry is correct the moment the invocation question
below is settled.

### Where it lands, and why that matters

| segment | harnesses | cost behaviour |
|---|---|---|
| `system` | prime-agent-fork, prime-agent-upstream, pi, opencode, cline | inside the cacheable prefix — paid once, reused every turn |
| `history` | codex, aider, cursor | in the conversation, ahead of the newest turn; still prefix-stable, so a provider doing longest-prefix caching keeps it cached, but any harness that rewrites earlier turns (compaction, retries appending) re-sends it |
| `currentTurn` | claude | attached to the **first user message**. On turn 1 it is the newest content, i.e. after every cache breakpoint; from turn 2 it sits in `history` |

Five of the eleven put the briefing in the cacheable prefix. Claude Code is the outlier: the
briefing rides the user turn, so on a one-shot task it is fresh input every time rather than
prefix-cached.

## Host suppression versus workspace reading

The baseline needs both: **no host state, every workspace instruction file.** Several flags
conflated the two. What each entry does now:

| harness | workspace switch changed | host suppression, unchanged |
|---|---|---|
| prime-agent-fork / -upstream | `-nc` dropped — `--no-context-files` is the *only* context switch and blocked workspace files too | container's empty `HOME`, per-run `PRIME_AGENT_CODING_AGENT_DIR` |
| pi | `-nc` dropped (same coarse flag) | **`HOME` now redirected** to a per-run empty dir (pi runs native, so the container was not doing this job), plus `PI_CODING_AGENT_DIR`, `-ns` (skills), `-ne`, `-np`, `-na`, `--offline` |
| claude | nothing to change | container's empty `HOME` (`~/.claude` unreachable) |
| opencode | `instructions: []` → `["AGENTS.md"]`, **and** `OPENCODE_DISABLE_PROJECT_CONFIG` removed | `OPENCODE_CONFIG_DIR`, `OPENCODE_PURE`, `OPENCODE_DISABLE_DEFAULT_PLUGINS` / `_EXTERNAL_SKILLS` / `_CLAUDE_CODE` / `_CLAUDE_CODE_SKILLS` / `_CLAUDE_CODE_PROMPT`, `OPENCODE_AUTH_CONTENT`, empty container `HOME` |
| codex | `project_doc_max_bytes` 0 → 32768 | per-run `CODEX_HOME`; `--ignore-rules` (execpolicy, unrelated) kept |
| hermes | `--ignore-rules` dropped | per-run `HERMES_HOME`, empty container `HOME` |
| aider | `--read <file>` added | per-run `HOME`, per-run `--env-file` |
| cline | none exists | per-run `HOME`, `CLINE_DIR`, `--config`, `--data-dir` |
| cursor | none needed | per-run `HOME`, `CURSOR_DATA_DIR`, `--authless` |
| gemini-cli | none exists (and none is wanted now) | per-run `HOME` + `GEMINI_CLI_HOME` |

Two flags turned out to be genuinely coarse, and both were resolved by leaning on the container
rather than the flag:

- **`-nc` (prime-agent family, pi)** — `--no-context-files` is one switch for global *and*
  workspace `AGENTS.md`/`CLAUDE.md`; there is no finer form. Dropped, because the container (or,
  for pi, a redirected `HOME`) already denies the host. Host suppression is preserved, and it no
  longer depends on the same flag that gates the briefing.
- **`OPENCODE_DISABLE_PROJECT_CONFIG`** — reads as a host-suppression var but is workspace-scoped
  (project `opencode.json` / `.opencode` / `instructions`). With it set, `instructions` is never
  read and a workdir `AGENTS.md` is invisible: proved against a logging sink, request body
  9,791 B with the var, 14,196 B without it, identical 10 tools. Removed. Consequence: a corpus
  task that shipped its own `opencode.json` would now be honoured — none do.

## hermes: the one that cannot receive it as configured

`--ignore-rules` was removed and the token count did not move by a single token. The reason is
not a flag:

`-z/--oneshot` enters `hermes_cli/oneshot.py`, which constructs `AIAgent` directly and never
loads project context at all. `--ignore-rules` (which maps to `skip_context_files` /
`skip_memory`) is **inert on that path** — it only ever applied to the chat path. Proved against
a logging sink, same container, `AGENTS.md` present in cwd:

| invocation | system prompt | `# Project Context` block | tools |
|---|---|---:|---|
| `hermes -z "…"` (current config) | 8,431 chars | absent | 17 |
| `hermes chat -q "…" -Q` | 25,060 chars | **present, file verbatim** | 18 |

So hermes *can* receive the briefing — but only by switching the invocation from `-z` to
`chat -q`, which changes the harness being measured: 18 tools instead of 17, session persistence
back on, `--usage-file` is a top-level flag not available on `chat`, and the second-billed-call
analysis (title generation) would have to be redone. That is a harness-configuration decision,
not an instruction-delivery one, so it is **flagged here and not applied**. `--ignore-rules`
stays removed: it is a no-op under `-z` and is the prerequisite for the `chat -q` path.

**Until that is settled, hermes competes without the briefing every other harness gets.**

## Cross-vendor reading, and why no workdir carries two files

Each run gets its own workdir (`work/<harness>__<task>__<attempt>`), so the plants never share a
directory — but the rule still binds *within* a workdir, because several harnesses read other
vendors' filenames:

- **cursor** reads `AGENTS.md`, `CLAUDE.md` *and* `.cursor/rules/*.mdc`. It gets `AGENTS.md` only.
- **claude** gets `CLAUDE.md` only.
- **opencode** reads `~/.claude/skills` on a real machine (suppressed here) and workspace
  `AGENTS.md`. It gets `AGENTS.md` only.
- **cline** reads `.clinerules` *and* `AGENTS.md`, both unconditionally. It gets `AGENTS.md` only
  — planting `.clinerules` as well would brief it twice.
- **hermes** takes the first match of `.hermes.md` → `AGENTS.md` → `CLAUDE.md` → `.cursorrules`,
  so one file is enough by construction.

Any corpus task that later ships an instruction file of its own would break this: cline, cursor
and gemini-cli would read it in addition to the baseline file, with no switch to stop them. No
task ships one today.

## aider is not equivalent

aider has no instruction-file discovery of any kind — verified previously by planting `AGENTS.md`
and `CONVENTIONS.md` and watching the prompt stay byte-identical at 561 tokens. The file is
therefore delivered with `--read <file>`, aider's documented conventions-file path.

That is a **different mechanism**, and the difference is worth stating wherever aider's numbers
appear: the other harnesses *discover* the file and frame it as authoritative project context
(a provenance-labelled block in the system prompt, or a `<project_context>` wrapper), while aider
receives it as a read-only file added to the chat — same bytes, different position, different
framing, and it lands in `history` rather than `system`. It is the closest available equivalent,
not the same thing.

## gemini-cli

Wired to `GEMINI.md` and left `enabled:false`; no live call was spent. Its pickup was already
proven against a local sink (body 47,303 → 47,627 B with a planted `GEMINI.md`). The
previously-unsolved problem — no working switch to *suppress* `GEMINI.md` — stops being a problem
under this baseline: reading it is exactly what we want. Re-verify the token delta when the proxy
speaks the Gemini shape and the entry is enabled.

## Reproducing

```sh
cd /tmp/bench-harnesses/runner
bun run run.ts --harnesses <id> --tasks smoke-ok --attempts 1 --out /tmp/with
# remove the entry's instruction file from `files` in harnesses.json for the without-run
```

Read `contextTokens` and the `systemTokens` / `toolSchemaTokens` / `historyTokens` /
`toolResultTokens` / `currentTurnTokens` split straight from the proxy's `requests.ndjson`;
`run.ts`'s folded `promptTokens` is the provider's number and is zero when upstream rejects.
