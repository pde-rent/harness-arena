# Research corpus — solve rates across fourteen harnesses

Seven research tasks, every enabled harness, one attempt each: **98 cells, complete**. Same model,
every harness in its own pinned container, all traffic through the metering proxy.

| | |
|---|---|
| Tasks | the 7 `research-*` tasks (medium difficulty, 480-900s timeouts) |
| Model | `deepseek/deepseek-v4-flash-0731` |
| Provider routing | OpenRouter default, unpinned — see *Provider mix* |
| Attempts | 1 per cell |

## Solve rate

| harness | solved | tokens/success | $/success | median wall |
|---|---:|---:|---:|---:|
| `claude` | 7/7 | 150,669 | $0.0142 | 97s |
| `codex` | 7/7 | 232,833 | $0.0066 | 168s |
| `prime-agent-upstream` | 7/7 | 251,058 | $0.0085 | 125s |
| `qwen-code` | 7/7 | 309,802 | $0.0105 | 100s |
| `cline` | 6/7 | 258,404 | $0.0072 | 124s |
| `cursor` | 6/7 | 264,417 | $0.0087 | 168s |
| `hermes` | 6/7 | 313,510 | $0.0083 | 134s |
| `oh-my-pi` | 6/7 | 265,836 | $0.0085 | 140s |
| `opencode` | 6/7 | 214,347 | $0.0056 | 78s |
| `optimus-prime` | 6/7 | 291,231 | $0.0091 | 131s |
| `pi` | 6/7 | 131,837 | $0.0040 | 87s |
| `terminus-kira` | 6/7 | 267,570 | $0.0087 | 267s |
| `terminus-2` | 5/7 | 118,254 | $0.0058 | 303s |
| `aider` | 0/7 | — | — | — |

## aider's 0/7 is an artefact, not a result

`aider` made **exactly one request per task** where every other harness took 8-13 turns, exited 0,
and failed verification every time. Its entry uses `--message`, aider's one-shot headless mode: a
single request-edit cycle, then exit. It is not being given the iteration the others get, so its
row measures the harness configuration rather than aider. Do not rank it against multi-turn
harnesses; either report it as one-shot or exclude it until the entry is changed.

That uniformity is the tell. A harness that is merely weaker fails unevenly across tasks; one that
fails every task identically is usually mis-wired, and this rig has now produced that shape twice.

## Provider mix

| provider | requests |
|---|---:|
| DeepInfra | 96 |

Single provider throughout, so the comparison is not confounded despite running unpinned.

## What this does not show

**One attempt per cell.** `terminus-kira` was independently observed completing roughly half its
attempts on a trivial task, so a single attempt cannot separate flaky from incapable. Several 6/7
rows here may be flakiness rather than a genuine miss.

**Research tasks only.** The agentic, algorithmic, coding, qualitative and quantitative categories
are not included — they run 400-700s per cell and the full matrix is roughly 47 hours.

**The Terminus pair does not read the instruction file.** They have no instruction-file discovery,
so the shared baseline reaches them only if the agent reads it, unlike every other harness.

**Both Terminus harnesses are bounded at 50 episodes**, deviating from upstream's unlimited
default, after KIRA's completion handshake livelocked for 940,000 tokens on a one-word task.
