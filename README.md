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

| harness | fixed context cost, one-word task |
|---|---|
| aider | 561 |
| prime-agent (fork) | 4,186 |
| prime-agent (upstream) | 4,476 |
| cline | 5,282 |
| opencode | 6,172 |
| hermes | 13,352 |
| Claude Code | 27,344 |
| codex | pending |
| pi | pending |
| gemini-cli | pending |

Fixed context cost = prompt tokens billed for a task whose correct answer is one word. It is
the floor every real task pays on every turn, and it is measured at the wire, not self-reported.

## Ground rules

1. **Same model, same provider.** `deepseek/deepseek-v4-flash-0731` pinned to `deepinfra/fp8`.
   Pinning only works via the request body (`provider.only`), so the proxy injects it; a run
   served by any other provider is discarded, not reported.
2. **Byte-identical prompts.** Every harness gets the same `task.md`, verbatim.
3. **No host contamination.** Per-run config/home dirs; repo-instruction discovery off; the
   real API key never enters a container.
4. **Deterministic grading first.** A task is solved or not by a script, not by an opinion.
   Quality review is a separate, additional axis — it never decides pass/fail.
5. **Report what happened.** Failed runs, discarded runs, and known biases are published with
   the results, not filtered out.
