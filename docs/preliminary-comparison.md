# Preliminary harness comparison

One task, one attempt, thirteen harnesses. This is a **wiring and overhead** measurement,
not a capability ranking — see *What this does not show* before quoting any of it.

| | |
|---|---|
| Task | `smoke-ok` — the correct answer is the single word `ok` |
| Model | `deepseek/deepseek-v4-flash-0731` |
| Provider pin | `deepinfra/fp8`, forced by the proxy on every request |
| Attempts | 1 |
| Execution | every harness in its own pinned container |
| Run | `results/preliminary`, 2026-08-20 |

## Fixed context cost

Prompt tokens billed for a task whose answer is one word: the floor every real task pays on
every turn, measured at the wire rather than self-reported. Solved runs only, cheapest first.

| harness | prompt tokens | vs leanest | wall | cost |
|---|---:|---:|---:|---:|
| `aider` | 1,541 | 1.0x | 8.2s | $0.00013 |
| `pi` | 2,472 | 1.6x | 5.9s | $0.00015 |
| `prime-agent-upstream` | 5,045 | 3.3x | 7.0s | $0.00040 |
| `cline` | 6,225 | 4.0x | 7.3s | $0.00050 |
| `optimus-prime` | 7,192 | 4.7x | 36.5s | $0.00055 |
| `opencode` | 8,280 | 5.4x | 7.5s | $0.00022 |
| `oh-my-pi` | 14,586 | 9.5x | 7.1s | $0.00112 |
| `cursor` | 15,395 | 10.0x | 9.7s | $0.00123 |
| `claude` | 19,759 | 12.8x | 6.7s | $0.00159 |
| `qwen-code` | 32,427 | 21.0x | 8.3s | $0.00259 |

## What ships

Measured inside each harness's own image. **payload** is `/opt/harness` only — image size is
dominated by the base OS and would rank harnesses by their choice of base. **packages** counts
installed units; a bundled harness has already resolved its dependencies, so it has no
meaningful count and is marked as such rather than shown as zero.

| harness | payload | packages | shape |
|---|---:|---:|---|
| `optimus-prime` | 8 MB | — | bundled |
| `pi` | 130 MB | 165 | tree |
| `qwen-code` | 130 MB | 19 | tree |
| `hermes` | 186 MB | 61 | tree |
| `codex` | 218 MB | — | bundled |
| `oh-my-pi` | 261 MB | 331 | tree |
| `prime-agent-upstream` | 265 MB | 237 | tree |
| `opencode` | 268 MB | — | bundled |
| `cursor` | 290 MB | 8 | tree |
| `claude` | 311 MB | 2 | tree |
| `cline` | 387 MB | 355 | tree |
| `terminus-2` | 605 MB | 122 | tree |
| `aider` | 650 MB | 109 | tree |
| `terminus-kira` | 1067 MB | 153 | tree |

## Runs that did not count

| harness | outcome | metered requests | why |
|---|---|---:|---|
| `hermes` | discarded_unpinned | 5 | proxy violations: unpinnable_path |
| `codex` | discarded_unpinned | 1 | $0.001775 of spend never reached the meter |
| `terminus-2` | discarded_unpinned | 2 | $0.003761 of spend never reached the meter |
| `terminus-kira` | harness_error | 17 | harness exited non-zero |
## What this does not show

**It is not a capability ranking.** One trivial task, one attempt, and the grader checks only that
the working directory exists (`smoke-ok` is a wiring probe by design). Nothing here says which
harness solves real work better. Solve rate over the 25-task corpus is a separate measurement that
has not been run.

**Fixed context is a floor, not a verdict.** A larger prompt buys tools, skills and instructions
that a leaner one does not have. The number says what every turn costs before any work happens; it
does not say whether the spend is earned. `pi` and `oh-my-pi` are the clearest case: identical
runtime, and the ~5.9x difference between them is the orchestrator prompt the extension installs.

**Wall time includes container start and harness startup**, which is part of time-to-goal but is
not model latency. One 36.5s outlier on an otherwise ~7s harness was image pull, not the agent.

**Payload size does not predict prompt size.** The leanest payload here is 40x smaller than the
largest, and the two orderings do not correspond — what a harness ships and what it puts in the
context window are different decisions.

## Known asymmetries

**The Terminus agents do not read the shared instruction file.** Every other harness is handed
`corpus/AGENT_INSTRUCTIONS.md` as `AGENTS.md` and reads it as part of its normal context
discovery. `terminus-2` and `terminus-kira` have no instruction-file discovery at all — their
prompt is the task text plus the terminal screen. The file is planted for parity but only reaches
them if the agent chooses to read it. Their numbers are therefore not directly comparable with the
rest on instruction-following, and `spec/fairness.md` requires this be published rather than
quietly tolerated.

**`qwen-code` is not a gemini-cli stand-in.** It is a fork that speaks the OpenAI shape, registered
under its own id. Official `gemini-cli` remains disabled: its 0.55.1 bundle exposes no
OpenAI-compatible surface, and every base-URL override keeps the Google wire shape the proxy cannot
pin, so enabling it would produce unpinned and unmetered runs.

**`qwen-code` bills a second request per turn unless told not to.** Its managed-memory features
fire a ~9.4k-token extraction subagent alongside the main turn. They are disabled in the per-run
settings; without that, its number here would be inflated by work the task never asked for.

## Open problems

**`hermes` cannot be pinned yet.** It reaches a path the proxy cannot rewrite, so its runs are
refused rather than reported. Five metered requests did go through the pin; the run is discarded on
the unpinnable one. Same class as the Claude Code `/api/hello` handshake, but not yet diagnosed.

**The spend backstop fires on `codex` and `terminus-2`, and I cannot yet say whether it is right.**
Both were served entirely by the pinned provider with real metered requests, so the obvious
explanation was the provider's credits endpoint lagging one run into the next. That explanation
does not survive the arithmetic: codex's unmetered $0.001775 exceeds the previous run's entire cost
($0.000501), and terminus-2's $0.003761 is fourteen times its own. Either these harnesses make a
billable call the proxy never sees, or the account figure moves for a reason not yet understood.
Until that is settled the two are reported as discarded, not as passing — an unexplained gap
between account spend and metered spend is exactly what the check exists to refuse.

**`terminus-kira` exited non-zero** after 17 metered requests. It reached the model repeatedly
through the pin, so this is an agent-loop or completion-detection failure rather than a wiring one.

## Reproducing

```sh
source ~/.prime-bench.env
cd runner
bun run run.ts --tasks smoke-ok --attempts 1 --out "$PWD/../results/preliminary"   # absolute path
bun run metadata.ts
```

The `--out` path must be absolute: a relative one is resolved inside the podman VM and every
container bind mount fails.
