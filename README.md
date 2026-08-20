# harness-arena

Head-to-head measurement rig for terminal coding agents.

Every harness runs the **same task**, on the **same model**, pinned to the **same inference
provider**, in its **own container**, with its config isolated so nothing leaks in from the
host. All model traffic passes through one local proxy, which is both the pin and the
instrument — so every harness is measured the same way regardless of what it reports about
itself.

| | |
|---|---|
| `spec/` | the measurement contract: metrics, schemas, fairness rules |
| `corpus/` | tasks + deterministic graders + fixtures |
| `proxy/` | pinning + metering proxy (the universal instrument) |
| `runner/` | drives harness × task × attempt, collects results |
| `containers/` | one light image per harness |
| `viewer/` | result tables and timeline charts |
| `results/` | recorded runs |

## Harnesses under test

| harness | version under test |
|---|---|
| `optimus-prime` | 1.0.0 (this fork) |
| `prime-agent-upstream` | 0.7.3 |
| `pi` | 0.84.2 |
| `oh-my-pi` | pi 0.84.2 + extension 0.2.0 |
| `claude` | 2.1.234 |
| `opencode` | 1.18.18 |
| `codex` | 0.147.0 |
| `hermes` | git @ `~/.hermes/hermes-agent` |
| `terminus-2` | terminal-bench 0.2.18 |
| `terminus-kira` | krafton-ai/KIRA @ `652dacbf` (harbor 0.1.44) |
| `aider` | 0.86.2 |
| `cline` | 3.0.55 |
| `cursor` | 2026.08.11-e8db854 (`agent-cli-local` build) |
| `qwen-code` | 0.21.14 (fork of Gemini CLI) |
| `gemini-cli` | not pinnable — no OpenAI-compatible mode |

Names are the registry ids from `runner/harnesses.json` — the same strings `--harnesses` takes.

A preliminary run across all thirteen, with per-harness payload and fixed context cost:
[docs/preliminary-comparison.md](docs/preliminary-comparison.md). It measures overhead and
wiring, not capability — the solve-rate corpus has not been run.

`pi` and `oh-my-pi` are a control/treatment pair: the same pinned pi, with and without the
extension that replaces its system prompt, so the difference between them is the extension.

Every version is pinned in `containers/`, and a harness is only listed once it runs unattended
against the proxy.

## Ground rules

1. **Same model; same provider when pinned.** `deepseek/deepseek-v4-flash-0731`. Pinning works
   only through the request body (`provider.only`), so the proxy injects it and a run served by
   another provider is discarded. The pin is set by `BENCH_PROVIDER_ONLY`, and `""` routes by
   OpenRouter's default instead — useful when the pinned provider's shared pool is congested, at
   the cost of comparability: the same model differs in quantisation, tokenizer and latency
   between providers, so part of any gap becomes the provider rather than the harness. Either way
   the provider that served each request is recorded, and a report from an unpinned run must show
   the provider mix.
2. **Byte-identical prompts.** Every harness gets the same `task.md`, verbatim.
3. **No host contamination.** Per-run config/home dirs; repo-instruction discovery off; the
   real API key never enters a container.
4. **Deterministic grading first.** A task is solved or not by a script, not by an opinion.
   Quality review is a separate, additional axis — it never decides pass/fail.
5. **Report what happened.** Failed runs, discarded runs, and known biases are published with
   the results, not filtered out.
