# Harness A/B runner

Drives every harness over the same corpus, on the same model and provider, and reports
tokens-to-goal and time-to-goal.

```sh
source ~/.prime-bench.env
bun run run.ts --dry-run                       # setup + graders only, no model calls
bun run run.ts --harnesses claude,prime-agent-fork --attempts 3
bun run report.ts ../results/<stamp>/results.ndjson --baseline claude
```

## Pieces

| | |
|---|---|
| `harnesses.json` | one entry per harness: argv template, env, whether it is enabled |
| `run.ts` | per (harness × task × attempt): clean workdir → dedicated metering proxy → headless run → grade |
| `report.ts` | solve rate, totals, and the head-to-head deltas against a baseline |
| `../proxy/` | forces model + provider on every request and meters tokens/TTFB |
| `../corpus/` | tasks: `task.md`, `setup.sh`, `verify.sh`, `meta.json` |

## Placeholders in `harnesses.json`

`{{PROMPT_FILE}}` · `{{PROMPT}}` · `{{WORKDIR}}` · `{{MODEL}}` · `{{BASE_URL}}` — substituted in
both `argv` and `env` values. `{{BASE_URL}}` is the per-run proxy, which is what makes the
model+provider pin and the metering apply to that harness.

## Fairness rules baked in

- One fresh working copy per run; nothing leaks between runs or between harnesses.
- The prompt text is byte-identical for every harness (`task.md`).
- Token/time deltas are computed only over tasks **both** harnesses solved, so giving up early
  never looks like a win. Solve rate is reported first and separately.
- Medians across attempts, not means — one slow run cannot dominate.
- `report.ts` exits non-zero if any run was served by a provider other than the pin.

## Caveats

- Wall time includes harness startup, which is part of time-to-goal but favours nothing in
  particular; report it alongside token counts rather than alone.
- Run on an otherwise idle machine. Timings inflate badly under parallel load.

## Container mode

A harness entry may carry a `container` block; when it does, `run.ts` executes it inside
`podman run --rm` instead of on the host:

```json
"container": {
  "image": "bench/claude:pinned",
  "workdir": "/work",
  "argvRewrite": { "claude": "/opt/harness/bin/claude" }
}
```

- the task working copy is bind-mounted at `workdir` (default `/work`), so `setup.sh` and
  `verify.sh` keep running on the host against the same directory;
- only the harness's declared `env` crosses the boundary (`-e`), so the real
  `OPENROUTER_API_KEY` never reaches the agent;
- `{{WORKDIR}}` resolves to the in-container path in `argv`/`env`, while per-run `files`
  are still written on the host side of the same mount;
- `{{BASE_URL}}` points at `host.containers.internal:<proxy port>` — the metering proxy
  stays on the host. Override the hostname with `BENCH_CONTAINER_HOST`.

`--native` forces the host path for every harness; entries without a `container` block
always run natively. `--dry-run` is unaffected. Images and their pins:
`../containers/README.md`.
