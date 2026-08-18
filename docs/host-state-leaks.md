# Host-state leakage

> **Scope, stated up front.** These magnitudes were measured on one developer's machine and are
> a property of **that machine's dotfiles**, not of the harnesses. "Claude Code costs 30% more"
> is not a finding — "Claude Code reads `~/.claude` and this machine had 8k tokens of it" is.
> The *capability* to read host state is the product property; the number is not transferable.
>
> **This is not the benchmark baseline.** The benchmark has exactly one baseline — a clean
> container with an identical instruction file for every harness (see `spec/baseline.md`).
> Everything below is a secondary observation, published as disclosure rather than as a score.

What each harness reads from the developer's machine that the task never asked for.

Found while containerising the benchmark: the same harness, same prompt, same model, produced
different token counts natively than in a clean container. Every delta turned out to be host
state. It is reported here because it is a real product property — it changes cost, behaviour
and reproducibility on a user's machine, and none of these harnesses disclose it.

Deltas are prompt tokens for an identical one-word task, native versus container.

| harness | native | container | Δ | what it read |
|---|---|---|---|---|
| Claude Code | 27,344 | 19,013 | **−30.5%** | `~/.claude`: global CLAUDE.md, skills, plugins |
| opencode | 6,172 | 7,329 | **+18.7%** | `~/.claude/skills`, `~/.agents/skills`, an installed plugin, global AGENTS.md — **and a user "orchestrator" agent that replaced the system prompt and removed `edit`/`write`** |
| hermes | 13,352 | 12,233 | −8.4% | `.cursor/rules/*.mdc` as "Project Context", plus a `browser_exec` tool acquired from a host playwright install |
| prime-agent (upstream) | 4,476 | 4,085 | −8.7% | 3 skills from `~/.agents/skills` |
| prime-agent (our fork) | 4,186 | 3,847 | −8.1% | 3 skills from `~/.agents/skills` |
| pi | 1,526 | — | prompt 2,638 → 3,865 chars | `~/.agents/skills`, unless `-ns` is passed |
| cline | 5,282 | — | +197 | workspace `.clinerules` / `AGENTS.md`, **unconditional — no switch exists** |
| cursor | 19,509 | 19,478 | −0.2% | none — the only harness that was already clean |
| aider | 561 | — | 0 | no instruction-file discovery at all |
| codex | 9,879 | — | 0 | suppressible via `project_doc_max_bytes=0` |
| gemini-cli | ~7.5k est. | — | +324 | `GEMINI.md` — **no working suppression found** |

## Classes of leak, worst first

**1. Silent identity replacement.** opencode loaded a user-defined "orchestrator" agent that
*replaced the system prompt* and shipped 8 tools instead of the stock 10. Natively it was not
running opencode at all — it was running the user's custom agent wearing opencode's name. Any
benchmark, bug report or comparison made on that machine measured something else entirely, and
nothing in the output said so.

**2. Acquired capabilities.** hermes gained a `browser_exec` tool because playwright happened to
be installed on the host. The harness's tool surface is not a property of the harness; it is a
property of the machine.

**3. Cross-vendor reading.** opencode reads `~/.claude/skills`; cursor reads `CLAUDE.md`.
Harnesses ingest *other vendors'* configuration files. A user who writes instructions for one
agent is silently instructing several.

**4. Instruction and skill pickup.** The common case — global CLAUDE.md / AGENTS.md /
`.cursor/rules` / skills directories. Usually wanted, but it means a harness's token cost and
behaviour on a real machine are not the ones in any published figure.

**5. Unsuppressable pickup.** cline and gemini-cli read workspace rules with no available
switch. For a benchmark that is a declared bias; for a user it means no way to get a clean run.

## Why it is still worth publishing

Not as a ranking. As disclosure — these are the parts that hold on any machine:

- **Reproducibility.** Two engineers on the same repo get different agent behaviour because of
  files outside it. Bug reports are not comparable.
- **Cost.** A harness's real-world prompt can be far larger than its stock prompt — 44% larger
  in one case here. Any published token or price figure is a floor, and the gap depends on the
  user's own files.
- **Security and privacy.** These are files on a developer's machine being read and shipped to
  a provider without a prompt or a log line. Credentials in a rules file, a private
  architecture note, a client name — all leave the machine silently.
- **Comparability.** Any benchmark run outside a container is partly measuring its author's
  dotfiles. Ours was, until we containerised.

Reported as a first-class dimension: `readsHostState` (paths), `unsuppressable` (yes/no),
`replacesSystemPrompt` (yes/no), `acquiresToolsFromHost` (yes/no), `crossVendorReads` (paths),
and the measured native-vs-clean token delta.
