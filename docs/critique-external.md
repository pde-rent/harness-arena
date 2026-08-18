# External critique of the evaluation framework (verbatim, unedited)

> Provenance: supplied by the project owner from an outside expert. Citations in the original
> point at `rahulkashyap.dev`, `martinfowler.com/articles/harness-engineering`,
> `digitalapplied.com`, and `github.com/harness/harness-evals`. **None of these have been
> verified by us.** The argument is retained here because it stands or falls on its own
> reasoning; the citations are not treated as authority.

Your current set is a solid **runtime-telemetry** layer. It will not distinguish a good harness
from a fast one, because it never asks whether the agent solved the task, recovered, stayed
inside permissions, or spent tokens on useful context.

Identical model weights in different harnesses commonly move SWE-bench by **10-20 points**. If
you do not hold the model, task, and budget fixed, you will rank providers, not harnesses.

## What your metrics miss

Every row you listed answers *how the loop ran*. None answers *whether the harness did its job*.

| You measure | What it cannot see |
|---|---|
| TTFT / tokens/sec | Model + network, not harness quality |
| Time to completion | A 40s wrong answer beats a 90s correct one |
| Tool-call counts | Wrong tools, malformed args, redundant reads |
| Context size / token drift | Whether compaction preserved the goal or deleted it |

That last point is the trap. Rising prompt tokens is a useful **symptom**, but it does not tell
you if the harness compacted well, retrieved the right files, or just re-sent the same
conversation. For your RLM / auto-compaction work, that distinction is the whole game.

## Recommended layers

Treat this as a portfolio, not one score. Public 2026 practice is moving to exactly that:
outcome + trajectory + reliability + cost, with a private holdout.

### 1. Experimental controls
- Fixed model, provider, temperature, and max tokens across harnesses.
- Fixed task set, sandbox, and wall-clock / token budget.
- **pass@k** (can it succeed given k tries) and **pass^k** (does it succeed k times in a row).
  Peak score hides variance.
- Log the full config: system prompt, tools, iteration cap, compaction policy, retry policy.
  Those *are* the harness.

### 2. Outcome
- Task success against a deterministic oracle: tests, expected files, expected command results.
- Decompose long tasks: schema preserved, tests green, no extra files, stayed in budget.
- **Cost per successful task** and **tokens per successful task**. Failed runs still cost money.
- For audit pipelines: precision / recall of findings against a gold JSON set, plus file/line
  localization error.

### 3. Trajectory
- Tool precision / recall / F1: needed tools vs called tools.
- Argument validity rate against the tool schema (deterministic, cheap).
- Redundant-call rate and **minimum necessary tool calls** on successes.
- Edit blast radius: files / lines changed vs files that had to change.
- Plan adherence and mid-run goal drift (stated next-step vs original task).
- Verification use: did it run tests / types / linters *before* declaring done?

### 4. Context intelligence
- Prompt / completion / **cached** tokens per turn.
- Unique vs repeated prompt tokens (true re-send rate).
- Compaction events: when, how many tokens dropped, and **post-compaction goal retention**.
- Retrieval quality: files retrieved vs files actually needed (precision/recall).
- Context sustainability: slope of *useful* context, not raw prompt size. Flat-and-wrong is
  worse than rising-and-correct.
- 20-turn vs 50-turn pass rate on the same task. An 80% -> 40% drop is a compaction / memory
  failure, not a model failure.

### 5. Recovery and robustness
- Error-recovery rate after a failed tool, test, or injected fault.
- Mid-session perturbations: unexpected tool failure, user redirect, killed subprocess.
- Idempotency: rerun the same task, compare repo state.
- Prompt / environment robustness: small instruction rewrites should not collapse pass rate.

### 6. Safety and permissions
- Unauthorized read / write / egress / command rate.
- Approval-gate bypasses and sandbox escapes.
- Duplicate side effects (double commit, double `rm`).
- Correct abstention: did it stop when it should have?

### 7. Static harness inventory
- Tool surface: files, shell, git, browser, MCP, LSP, tests.
- Control surface: permissions, hooks, iteration caps, human gates.
- Memory surface: AGENTS.md / skills, compaction, long-term memory, subagents.
- Native vs interpreted overhead: startup time, RSS, CPU.

Do not fold this into the run score. It explains *why* two harnesses diverge on the same model.

## How to run it

- **Public floor:** SWE-bench Verified for repair, Terminal-Bench for CLI autonomy, Aider
  polyglot for edit quality. Baseline, not a winner.
- **Internal golden set:** 20-50 tasks from real failures first, later 200+. Binary graders.
  Version the fixtures.
- **Private holdout:** never used while tuning. If internal pass rate climbs and holdout is
  flat, you overfit the harness.

Keep graders computational wherever possible. Use an LLM judge only for plan adherence and
semantic review, and calibrate it on a small human set.

A practical first dashboard:
1. Success @ budget
2. $ and tokens per success
3. Tool F1 + arg-validity
4. Repeated-token ratio + post-compaction retention
5. Recovery rate after injected failure
6. pass^3 on the holdout

Existing TTFT / tok/s / context-size series stay as **diagnostics**, not ranking metrics.
