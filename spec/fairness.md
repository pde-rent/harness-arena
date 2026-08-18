# Fairness rules

A benchmark is only worth the biases it controls for. These are the ones found so far, how
they are handled, and the ones that remain.

## Controlled

| risk | control | how it was caught |
|---|---|---|
| Different inference providers behind the same model id | proxy injects `provider.only`, and a run served by another provider is discarded | an unpinned probe was served by StreamLake, not DeepInfra |
| Harness self-reported token counts disagreeing with reality | all published numbers come from the wire; harness output is a cross-check only | Claude Code reports an Anthropic-price `total_cost_usd` that is fiction on this route |
| Host config leaking into a run | per-run config/home dirs for every harness | opencode was silently loading the user's `~/.claude/skills`, `~/.agents/skills` and an installed plugin into every run |
| Repo instructions favouring one harness | **one identical instruction file delivered to every harness** via whichever mechanism that harness natively reads; byte-equivalence of what lands in context is verified per harness | three harnesses were found silently reading host state (see below) |
| Hidden extra billed calls | session-title / summarisation calls disabled | opencode and hermes each fired one per run |
| Agents "passing" by weakening tests | graders restore a pristine `tests/` before running; hidden checks staged only at verify time | — |
| Exit codes lying about success | grading uses the deterministic verifier only | hermes exits 0 even when the model call failed |
| Prompt wording favouring a harness | one `task.md` per task, byte-identical for all, scanned to mention no tool, CLI, agent, model or vendor | — |
| Machine load distorting timings | one run at a time, containers with fixed CPU/memory | timings inflated 20-70x under parallel load during development |

## Instruction injection

Earlier the rig suppressed all repo instructions. That is fair but unrealistic: real users ship
an instructions file, and a harness that uses one well should get credit for it.

So every run instead receives the **same** `corpus/AGENT_INSTRUCTIONS.md`, delivered through
whatever file each harness natively reads (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`,
`.clinerules`, `CONVENTIONS.md`, …). Rules:

- The **content is byte-identical** for every harness. Only the filename differs.
- The file is harness-neutral: it names no tool, CLI, model or vendor, and describes methods
  conditionally ("where the harness supports parallel workers") so it never assumes a
  capability only some have.
- Delivery is **verified, not assumed**: for each harness we measure prompt tokens with and
  without the file. A harness whose count does not move is not reading it, and that is
  reported rather than quietly tolerated.
- The per-harness token cost of the same file is itself a published metric — harnesses differ
  in whether they inject it once, every turn, or cached, and that difference is real.

Harnesses that cannot be made to read any instruction file are reported as such; their results
are still valid, but they are competing without a briefing the others got.

Separately, three harnesses were caught reading host state nobody asked for — opencode
(`~/.claude/skills`, `~/.agents/skills`, an installed plugin), pi (`~/.agents/skills`), and
cline (unconditional workspace rules). All are now neutralised or measured. Containers make
this structural rather than a matter of remembering the right flag.

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
