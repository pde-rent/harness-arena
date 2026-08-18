# Harness profile

Static and resource facts about each harness, recorded once per version and carried into every
result file and every view.

Host-state leakage is recorded here as a **qualitative** product property — which paths a
harness reads, whether that can be suppressed, whether it can replace its own system prompt or
acquire tools from the host. The measured magnitudes are specific to the machine they were taken
on and are published as disclosure, never as a comparison axis.

**This never enters the run score.** A harness does not win for being a small binary. The
profile exists to explain *why* two harnesses diverge while running identical model weights —
without it, every difference looks like magic.

## Identity and provenance

| field | why it matters |
|---|---|
| `name`, `version` | the thing under test |
| `releasedAt` | a harness six weeks old is not competing with one six months old; version age explains a lot of capability gaps |
| `commit` / `buildId` | exact artifact, for reproducing a result later |
| `repo`, `license` | is it inspectable, is it forkable |
| `language`, `runtime` | Rust/Go/native binary vs Node vs Python vs Bun — sets the floor on startup and memory |
| `distribution` | single static binary, interpreted + dependency tree, or a wrapper |
| `installedVia` | exact command, so the whole thing reproduces |

## Footprint

| field | how measured |
|---|---|
| `installBytes` | full install prefix on disk, including dependencies |
| `binaryBytes` | the entry artifact alone |
| `fileCount` | how many files an install drops |
| `dependencyCount` | declared runtime dependencies |
| `startupMs` | **process start → first model request leaves the harness.** Read from the proxy: `tRequestMs` of turn 0. This is the user-visible "nothing is happening yet" period, and it includes the harness's own pre-work — config load, indexing, repo scan |
| `readyMs` | process start → exit, on a task requiring no model call at all (`--version`), isolating pure process/runtime cost from any agent behaviour |
| `rssBaselineMb`, `rssPeakMb` | sampled through a run |
| `cpuSeconds` | CPU consumed by the harness process tree, excluding time blocked on the model. Distinguishes a harness that is slow because the model is slow from one that is slow because it is working |
| `processesSpawned` | daemons, workers, language servers, subprocesses left behind |
| `stateBytesPerRun` | what it writes outside the workdir per run |

Footprint numbers are only comparable when collected on an idle machine, in the same container
shape, on the same task. They are recorded with the machine and container spec beside them.

## Capability surface

Inventory, not score. Presence of a feature is not evidence it is used well — the run metrics
decide that.

- **Tools**: count and categories — file read/write/edit, shell, git, search, browser, web
  fetch, MCP, LSP, test runner, subagents.
- **Context management**: compaction or summarisation, memory/instruction files, retrieval or
  repo map, session persistence, resume.
- **Control**: approval modes, permission granularity, hooks, iteration/turn caps, budget caps,
  sandboxing.
- **Interfaces**: interactive TUI, one-shot/headless, structured output (JSON/NDJSON), daemon
  or server mode, editor integration.
- **Offline**: does it function with no network beyond the model endpoint.

## Instrumentation honesty

Whether the harness tells the truth about itself. Every one of these was found the hard way
while building this rig, and each silently corrupts results if unchecked.

| field | meaning | already observed |
|---|---|---|
| `readsHostState` | reads config/skills/rules from the user's home that the task never asked for. Recorded as paths, with `unsuppressable`, `replacesSystemPrompt`, `acquiresToolsFromHost`, `crossVendorReads` and the measured native-vs-clean token delta — see `docs/host-state-leaks.md` | every harness but cursor and aider; one silently replaced its own system prompt with a user-defined agent |
| `hiddenBilledCalls` | extra model calls beyond the task — session titling, summarising, model routing | opencode, hermes, gemini-cli (a "complexity score" router) |
| `honestExitCode` | non-zero when the run actually failed | hermes exits 0 after its model call fails outright |
| `usageSelfReportAccurate` | its own token/cost numbers match the wire | Claude Code reports cost at a different vendor's prices than the route used |
| `honoursModelId` | sends the model you asked for | gemini-cli silently remaps aliases to a different model |
| `respectsInstructionFile` | actually reads the instruction file it was given | verified per harness by prompt-token delta |

A harness scoring badly here is not disqualified. It is *annotated*, and any of its results that
depend on the broken signal are recomputed from the wire instead.

## Where it appears

- `profiles/<harness>.json` — one file per harness per version, committed.
- Embedded in every result file, so a result is interpretable years later without the repo
  state that produced it.
- A dedicated view: identity, footprint, capability matrix, honesty flags — sortable, beside
  the run results but never summed into them.
