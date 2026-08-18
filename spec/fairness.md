# Fairness rules

A benchmark is only worth the biases it controls for. These are the ones found so far, how
they are handled, and the ones that remain.

## Controlled

| risk | control | how it was caught |
|---|---|---|
| Different inference providers behind the same model id | proxy injects `provider.only`, and a run served by another provider is discarded | an unpinned probe was served by StreamLake, not DeepInfra |
| Harness self-reported token counts disagreeing with reality | all published numbers come from the wire; harness output is a cross-check only | Claude Code reports an Anthropic-price `total_cost_usd` that is fiction on this route |
| Host config leaking into a run | per-run config/home dirs for every harness | opencode was silently loading the user's `~/.claude/skills`, `~/.agents/skills` and an installed plugin into every run |
| Repo instructions favouring one harness | discovery disabled where the harness allows it; verified by planting `AGENTS.md` and confirming prompt tokens are unchanged | — |
| Hidden extra billed calls | session-title / summarisation calls disabled | opencode and hermes each fired one per run |
| Agents "passing" by weakening tests | graders restore a pristine `tests/` before running; hidden checks staged only at verify time | — |
| Exit codes lying about success | grading uses the deterministic verifier only | hermes exits 0 even when the model call failed |
| Prompt wording favouring a harness | one `task.md` per task, byte-identical for all, scanned to mention no tool, CLI, agent, model or vendor | — |
| Machine load distorting timings | one run at a time, containers with fixed CPU/memory | timings inflated 20-70x under parallel load during development |

## Known and accepted

- **cline** has no switch for workspace `./.clinerules` / `./AGENTS.md`; discovery is
  unconditional. Measured leak: +197 tokens. Mitigated by shipping neither file in any task.
- **aider** runs with `--no-git`, so it has no repo map and starts blind. Verified to cost
  nothing on this corpus (tasks are not git repos, so the map would be empty anyway), but on a
  git-backed corpus this would be a real handicap and must be revisited.
- **upstream prime-agent** has no approval gate at all — it executes model-authored code
  unsandboxed. That is a genuine capability difference, not a config choice, and containers are
  what make it safe to measure.
- **Harness startup** is inside `wallMs`. It is a real cost the user pays, but it flatters
  long tasks and punishes short ones; `generationMs` is reported alongside so both readings
  are available.

## Open

- Reasoning-token accounting differs between the OpenAI and Anthropic request shapes; the
  Anthropic path can report reasoning tokens exceeding completion tokens.
- The pinned model is intermittently rate-limited upstream. Harnesses retry at different
  rates, which perturbs wall time. Retries are recorded so affected runs can be excluded.
