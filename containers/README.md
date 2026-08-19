# Containerized harnesses

One image per harness, so a broken image can never affect the others. The container runs
**only the agent**. Everything that measures or grades stays on the host:

```
host                                                   container
────────────────────────────────────────────────       ─────────────────────────────
setup.sh  ──► results/<stamp>/work/<runId>  ──bind mount──►  /work   (rw)
metering proxy (holds the real OPENROUTER_API_KEY)
   listening on 127.0.0.1:<random>          ◄── http://host.containers.internal:<port>/v1
verify.sh ──► reads the same workdir afterwards
```

The container gets a dummy key only (`bench-dummy`); the real key never crosses the
boundary. Verified: `podman run` with each harness's declared env has **0** environment
variables matching `OPENROUTER|sk-or-v1`.

## Reaching the host proxy

`host.containers.internal` resolves inside containers on this podman/applehv setup
(→ `192.168.127.254`, the gvproxy host address) and reaches a host process bound on
`0.0.0.0` (Bun's default). Verified live before wiring anything. **No `--network=host`
and no `--add-host` were needed.** Override the hostname with `BENCH_CONTAINER_HOST` if a
future machine behaves differently.

## Images

| Harness | Base (digest-pinned) | Harness version pin | Size |
|---|---|---|---|
| `optimus-prime` | `oven/bun@sha256:6068a9d4…5ee2` (bun 1.3.14, Debian 13) | local repo `/private/tmp/prime-agent` @ `3701f4e`, `@earendil-works/pi-coding-agent` 0.7.2 — prebuilt `dist/` COPYed in | 399 MB |
| `prime-agent-upstream` | `node@sha256:253da198…7a24` (node:22-slim, bookworm) | prime-agent **0.7.3** release tarball, sha256 `2a188738…2784` checked in-build | 959 MB |
| `claude` | `node@sha256:253da198…7a24` | `@anthropic-ai/claude-code@`**2.1.234** | 682 MB |
| `opencode` | `node@sha256:253da198…7a24` | `opencode-ai@`**1.18.18** | 632 MB |
| `hermes` | `python@sha256:9c900dea…bfc9` (python:3.11-slim) | `NousResearch/hermes-agent` @ `e02d1e41fc6104187e20af9eac8b2820566e3508` (v0.20.4), deps via `uv sync --locked` | 446 MB |
| `codex` | `debian@sha256:817e6cf9…ade0` (bookworm-slim) | OpenAI Codex CLI **0.147.0**, `codex-package-aarch64-unknown-linux-musl.tar.gz`, sha256 `89cbf79b…1401` checked in-build | 428 MB |
| `terminus-2` | `python@sha256:2c941e86…3c4a` (python:3.12-slim, trixie) | `terminal-bench`**==0.2.18** from PyPI into a venv; agent class `terminal_bench.agents.terminus_2.Terminus2` | 865 MB |
| `terminus-kira` | `python@sha256:2c941e86…3c4a` (python:3.12-slim, trixie) | `harbor`**==0.1.44** + `krafton-ai/KIRA` @ `652dacbf14d29ea93a83c496ee91e0e5ba286721` (source checkout, not on PyPI) | 1.33 GB |
| `cursor` | `debian@sha256:817e6cf9…ade0` (bookworm-slim) | Cursor CLI **2026.08.11-e8db854**, `agent-cli-local-package.tar.gz`, sha256 `30482dfb…f284` checked in-build | 502 MB |
| `qwen-code` | `bench/base:pinned` (node:22-slim, digest-pinned) | `@qwen-code/qwen-code@`**0.21.14** (`--ignore-scripts`) | 537 MB |

In-image paths the runner invokes (recorded as `container.argvRewrite` in
`runner/harnesses.json`):

| Harness | entry | `HOME` |
|---|---|---|
| `optimus-prime` | `bun /opt/harness/bundle/cli.js` | `/home/bench` |
| `prime-agent-upstream` | `/opt/harness/node_modules/.bin/prime-agent` | `/home/bench` |
| `claude` | `/opt/harness/bin/claude` | `/home/bench` |
| `opencode` | `/opt/harness/bin/opencode` | `/home/bench` |
| `hermes` | `/opt/harness/bin/hermes` | `/home/bench` |
| `terminus-2` | `/opt/harness/bin/terminus-2` (`terminus-2/entry.py`) | `/home/bench` |
| `terminus-kira` | `/opt/harness/bin/terminus-kira` (`terminus-kira/entry.py`) | `/home/bench` |
| `codex` | `/opt/harness/bin/codex` | `/home/bench` |
| `cursor` | `/opt/harness/bin/cursor-agent-local` | `{{WORKDIR}}/.bench-cursor-home` |
| `qwen-code` | `/opt/harness/bin/qwen` | `{{WORKDIR}}/.bench-qwen-home` |

Every image uses `WORKDIR /work`, a clean empty `HOME`, and no host home is ever mounted.
Rootless podman maps the container's root to the invoking host user, so files the agent
writes into `/work` land on the host owned by that user — `verify.sh` reads them normally.

## Build

```sh
podman machine start bench-vm
podman system connection default bench-vm     # never use podman-machine-default

./build.sh                 # all images, prints the size table
./build.sh claude hermes   # a subset, by harness id
```

`build.sh` picks the build context per harness. All images download their harness and
build from an empty context except `optimus-prime`, whose context is the fork's package
dir narrowed by `ignorefile.optimus-prime` (allow-list, ~14 MB instead of the whole
repo with `node_modules`). **The fork repo is only ever read** — nothing installs or builds
inside it; the image copies the already-built `dist/`. If `dist/` is stale, run
`bun run build` in the fork on the host *before* building the image.

## Run

```sh
source ~/.prime-bench.env
cd ../runner
bun run run.ts --tasks smoke-ok --harnesses claude        # containerized (default)
bun run run.ts --tasks smoke-ok --harnesses claude --native   # old host path
bun run run.ts --dry-run                                   # setup + verify only
```

A harness runs in a container iff its `harnesses.json` entry has a `container` block:

```json
"container": {
  "image": "bench/claude:pinned",
  "workdir": "/work",
  "argvRewrite": { "claude": "/opt/harness/bin/claude" },
  "args": []
}
```

`argvRewrite` maps host paths in `argv` to their in-image paths (binary, bundle entry,
and — for both prime-agent builds — the daemon socket, which must live outside the
virtiofs bind mount: `chmod` on a socket in `/work` fails with `EINVAL`, so it is
rewritten to `/tmp/...`). `args` is appended to `podman run` for anything image-specific.
Harnesses without a `container` block keep running natively, and `--native` forces the
host path for everything.

## Verification results (smoke task `reply with exactly: ok`)

All five: exit 0, one `/chat/completions` (or `/messages`) row with
`providerServed = DeepInfra`, model forced to the pinned id.

| Harness | native promptTokens | containerized | Δ | cause |
|---|---|---|---|---|
| `optimus-prime` | 4,186 (re-measured via `--native`: 4,205) | **3,847** | −8.1% | native loaded 3 user skills from `~/.agents/skills` (`coord`, `solidity-audit`, `swarm`) |
| `prime-agent-upstream` | 4,476 | **4,085** | −8.7% | same three user skills |
| `opencode` | 6,172 | **7,329** | +18.7% | native loaded `~/.config/opencode/AGENTS.md` **and** a user "orchestrator" agent that *replaces* the system prompt and drops the `edit`/`write` tools (8 tools vs 10 stock) |
| `hermes` | 13,352 | **12,233** | −8.4% | native injected "Project Context" from the user's `.cursor/rules/*.mdc`, plus a `browser_exec` tool from the host playwright install |
| `claude` | 27,344 | **19,013** | −30.5% | native read the user's `~/.claude` (global `CLAUDE.md` + installed skills/plugins) |

Each delta was diagnosed by capturing the outgoing request body against a local sink that
returns 500 — **no model calls, no cost** — and diffing the system prompt native vs
container. In every case the container prompt is the *stock* harness prompt and the host
prompt carries user state. The container numbers are the clean baselines; the native
figures are contaminated, which is exactly what containerization was meant to remove.
The `--native` fallback was re-run for `optimus-prime` and reproduced the documented
host figure (4,205 vs 4,186), so the deltas are contamination, not measurement noise.

`AGENTS.md` planted in the workdir → byte-identical request body for all five harnesses
(`optimus-prime`, `prime-agent-upstream`, `claude`, `opencode`, `hermes`), and the
planted marker never appears in the prompt. Repo-instruction discovery stays off.

## Notes / trade-offs

- `prime-agent-upstream` bakes its tool + kernel bootstrap at build time (≈485 MB of the
  959 MB) so runs need no registry access. Drop the bootstrap ENV in the Containerfile if
  you prefer a ~470 MB image plus a first-run download.
- `opencode` keeps a warmed npm cache (93 MB) at `/opt/harness/npm-cache`: opencode
  installs `@opencode-ai/plugin` into the *per-run* `OPENCODE_CONFIG_DIR`, which cannot be
  baked, but the cache makes that install offline-capable. Proven with the registry
  blackholed.
- `hermes` omits browser/computer-use/whisper extras — unreachable in headless `-z` runs
  and huge. Consequence: the container has 17 tools where the host has 18 (`browser_exec`).
  That is a deliberate, reported capability difference, not an accident.
- `optimus-prime` ships python3 + ipython (~150 MB) for model-authored Python via the
  shell; the harness's own `ipython` tool turned out to be a Bun JS/TS REPL, so that layer
  can be dropped if size matters more.
- `claude` is 682 MB mostly because the CLI itself is a 311 MB native binary.
- `codex` is now **token-verified containerized**: exit 0, one `/responses` row,
  `providerServed = DeepInfra`, 10,615 promptTokens. It speaks only the OpenAI *Responses*
  API, which the proxy rewrites and meters; the earlier "run `--native` until the proxy
  handles that shape" advice is obsolete. Its row is written up to ~31 s after the harness
  exits (the responses shape carries no provider name, so the proxy looks it up from
  `GET /api/v1/generation`), which is why `runner/run.ts` waits for a row rather than for
  an empty log to go quiet.
- `qwen-code` is a fork of Gemini CLI, registered under its own id. Upstream
  `@google/gemini-cli` has no Containerfile because it cannot be pinned at all: no
  OpenAI-compatible mode exists in 0.55.1, so it stays disabled in the registry.
- `terminus-2` is the only harness that is not a CLI: it is a Python class the upstream
  terminal-bench harness drives, and it acts by typing into a tmux session. `terminus-2/entry.py`
  is the whole adapter — it starts a local tmux session and hands it to a stock `Terminus2`.
  Upstream's `TmuxSession` runs every tmux command through `docker exec` into a *separate* task
  container; the adapter subclasses it and swaps only that exec primitive for a local subprocess
  (and disables asciinema recording, an upstream bench artefact). Prompts, parsers, episode loop
  and token accounting are untouched. `tmux` is therefore a hard runtime dependency of the image.
  It also has no instruction-file discovery of any kind, so the baseline `AGENTS.md` is planted
  for parity but never reaches its context — reported, per `spec/fairness.md`.
- `terminus-kira` is the same shape of adapter one framework generation later. It subclasses
  *harbor*'s Terminus 2 (harbor is the successor package to terminal-bench) and pins harbor
  0.1.44, the version its own `uv.lock` resolves — so it deliberately does not share the
  terminus-2 image. It is not on PyPI in any form, so the checkout is pinned by commit SHA and
  the repo root goes on `PYTHONPATH` (the agent resolves its prompt template relative to its own
  source file and imports a top-level `anthropic_caching` module that only exists there).
  `harbor run` is **not** used: it brings its own container, task format and grader, so it would
  measure a different corpus scored by a different grader. `terminus-kira/entry.py` implements
  harbor's `BaseEnvironment` against this container (exec via subprocess, upload/download via
  shutil) and hands it to the stock agent, whose own `TmuxSession` is unmodified. Unlike
  terminus-2 it uses native tool calling, so its requests carry a `tools` schema.
- `aider`, `cline` and `pi` appeared in `harnesses.json` after this work started and have
  no images yet; they keep running natively until Containerfiles are added.

## Image layout: shared base, separate images

`Containerfile.base` builds `bench/base:pinned` — node:22-slim pinned by digest, plus git, ripgrep
and ca-certificates, and an empty `HOME=/home/bench`. The node-based harness images build FROM it:
claude, opencode, prime-agent-upstream, oh-my-pi. All four share all seven of its layers, so the
OS and runtime are stored once rather than four times. `build.sh` builds it first.

codex and cursor are debian-based and optimus-prime is bun-based, so they keep their own bases;
there is nothing to share without changing what they run on.

### Why not one image containing every harness

It would share a PATH, a global `node_modules`, an npm cache and a HOME between harnesses that all
auto-discover configuration from exactly those locations. `spec/fairness.md` records that failure
happening once already: opencode was silently loading the developer's `~/.claude/skills`,
`~/.agents/skills` and an installed plugin into every run. Co-installing the harnesses reproduces
that inside the container, where it is harder to notice, and it would bias the comparison the
images exist to make fair. It would also couple their dependency resolution, so pinning one CLI
could move another's tree.

The base carries only the OS, the runtime and the three binaries every harness shells out to.
Nothing in it is harness-specific, so nothing in it can leak between them.
