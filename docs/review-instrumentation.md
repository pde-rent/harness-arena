# Review: instrumentation feasibility

Position paper, one of three independent reviews. Lens: **can this be collected, from where, at
what cost, and how does it break.** Written against `/tmp/bench-harnesses` as it stands
(proxy 3-shape shim, 8 enabled harnesses, 12 tasks, podman for 4 of 8).

Ruling scale: **free** (already on the wire / on disk, <1h of code) · **cheap** (a bounded proxy
or runner change, <½ day) · **expensive** (new subsystem or per-run model spend) ·
**infeasible** · **uneven** (obtainable for some harnesses only ⇒ not publishable as a
comparison).

---

## 0. Bugs that outrank every proposed metric

These make numbers the contract *already promises* wrong. Fix before adding anything.

### 0.1 `promptTokens` is not the same quantity across wire shapes — BLOCKER

`proxy/server.ts:61-67` (OpenAI shape) sets `acc.prompt = u.prompt_tokens`, which in OpenAI
accounting **includes** `prompt_tokens_details.cached_tokens`. `proxy/server.ts:68-77` (Anthropic
shape) sets `acc.prompt = u.input_tokens`, which in Anthropic accounting **excludes**
`cache_read_input_tokens` and `cache_creation_input_tokens`.

So `promptTokens` for `claude` is uncached-input-only, while for every other harness it is the
whole context. `spec/metrics.md:37` defines `promptTokens` as "context size at this turn" and
`/tmp/bench-harnesses/runner/harnesses.json` (pi notes) confirms the OpenAI reading
(`1270 + 256 = 1526`). Cross-shape context comparison, `contextSeries`, `peakContext`,
`cacheHitRate`, the fixed-overhead table (`HARNESSES.md:515-526`) and `tokenDrift` are all
mixing two definitions today.

Fix: on the Anthropic branch, `acc.prompt = input_tokens + cache_read_input_tokens +
cache_creation_input_tokens`. Verdict **free**. Priority **P0**.

### 0.2 `cacheWriteTokens` is never captured

`spec/metrics.md:39,89` publishes it; `absorb()` has no `cache_creation_input_tokens` /
`cache_write_input_tokens` field at all. Cache writes are the *premium* class — the cost model is
wrong for exactly the harness (`claude`) that writes the most cache. **free**, **P0**.

### 0.3 Temperature and max-tokens are not pinned

`rewrite()` (`proxy/server.ts:142-151`) forces `model` and `provider` only. The critique's very
first control ("fixed model, provider, temperature, and max tokens",
`docs/critique-external.md:37`) is currently **not enforced**: each harness ships its own
sampling params, and `spec/fairness.md` does not list this as controlled or accepted. Any pass@k
/ pass^k variance number is measuring harness sampling policy, not harness quality — which may be
defensible, but it must be a stated choice, not an accident.

Two lines in `rewrite()`. Recommend pinning `temperature` and leaving `max_tokens` alone (capping
it truncates long edits and would silently convert a harness's edit style into a failure), and
recording the *original* sampling params per request as a fairness column. **free**, **P0**.

### 0.4 The spec's per-request record mostly does not exist

`spec/metrics.md:25-56` lists `seq`, `tRequestMs`, `ttfContentMs`, `ttfReasoningMs`, `thinkingMs`,
`toolCallsIssued`, `toolCallNames`, `toolResultsIn`, `toolResultBytesIn`, `messagesIn`,
`retryOf`. The proxy writes none of them. Everything the critique asks for on the trajectory axis
is downstream of these. Scope them explicitly (§1) rather than discovering at report time that
half the contract is aspirational. **P0** for the subset in §1.1.

### 0.5 The compaction detector will fire on subagent calls

`spec/metrics.md:111-114` detects compaction as ">25% prompt-token drop vs previous turn". A
harness that spawns a subagent (Claude Code) issues a *fresh small-context* request in the middle
of a run; a harness that runs a cheap auxiliary call does the same. Both read as compaction, and
"compaction that lost the thread" then reads as noise. Replace with the prefix-hash detector in
§4.1 — same data, no false positives. **cheap**, **P1**.

### 0.6 The workdir diff is destroyed before it can be read

`runner/run.ts:342` deletes the working copy of every **solved** run, and `verify.sh` mutates the
tree before that: `restore_tests` overwrites `tests/` and `stage_checks` writes `bench_checks/`
(`corpus/lib/task.sh`). Any diff-based metric (edit blast radius, restraint, idempotency, stray
files) must be snapshotted **between** `settleUsageLog` (`runner/run.ts:264`) and the `verify`
call (`runner/run.ts:267`). Also, the runner itself writes harness config *into the workdir*
(`runner/run.ts:212`, plus `.bench-agentdir/`, `.bench-cline-data/`, `.bench-codex-home/`,
`.bench-hermes-usage.json`, `.bench-aider.*`), so every diff needs a per-harness ignore list or
blast radius becomes a measure of how much state a harness dumps in cwd. **cheap**, **P0** —
this is a one-time-only capture; if the first run does not take it, it cannot be recovered.

---

## 1. What the vantage point actually gives you

### 1.1 The whole trajectory is in the *request* bodies — no response parsing needed

The single most important instrumentation fact, and it is not exploited anywhere in the spec:
tool calls and their results arrive back at the proxy in the **next request**, as
`assistant.tool_calls` / `tool_use` blocks with full arguments plus the `tool`/`tool_result`
messages. `proxy/server.ts:183-190` already has the parsed body in hand
(`const j = JSON.parse(raw)`) and throws it away after rewriting.

Log it and you get, harness-agnostically, for all three shapes, with **zero** SSE work:

- the full tool-call trajectory (names + arguments),
- every tool result and its byte size (`toolResultBytesIn`),
- `messagesIn`, role-composition of context, system-prompt bytes, `tools[]` schemas,
- and, by differencing consecutive requests, everything in §4.

Storage: bodies are ~100 KB/request for `claude`, ~40 KB for `opencode`; ×~40 turns ×~100 runs
≈ 0.5 GB raw. Do **not** store raw bodies wholesale. Store per request: system-prompt hash+bytes,
`tools[]` name list + schema bytes + schema hash, per-message `{role, hash, bytes, type}` array,
and tool calls as `{name, argsHash, argsBytes, args-truncated-2KB}`. That is ~2-5 KB/request.
Keep the full first and last body per run for forensics. **cheap** (~120 lines in
`proxy/server.ts`), **P0** — it is the enabling change for over half the critique.

Only two things are *not* in the request stream: the final turn's tool calls (irrelevant — nothing
consumed them) and calls from a stream the harness aborted mid-flight (hermes, codex —
`runner/harnesses.json` hermes note item 3). Both are bounded and countable.

### 1.2 Response-side parsing is a separate, smaller investment

Needed only for: `ttfContentMs` / `ttfReasoningMs` / `thinkingMs` (currently only `ttfbMs` at
`proxy/server.ts:233`, which is first-byte-of-anything and can be an SSE ping), and for
arg-validity with honest recall (§3.2). `feedSSE` already walks every event; adding two timestamp
latches and a per-shape tool-call reassembler is ~80 lines. **cheap**, **P1**.

---

## 2. Rulings — trajectory metrics

### 2.1 Tool precision / recall / F1 vs "needed tools" — **KILL**

**Verdict: infeasible, and a category error on this harness set.**

There is no ground truth for "needed tools", and there cannot be one that is not a transcription
of one harness's tool vocabulary. The set under test spans:

| harness | tool surface (measured / documented) |
|---|---|
| prime-agent fork/upstream | one general tool, `ipython` — arbitrary Python (`HARNESSES.md:208`) |
| hermes | shell/computer-use family, python-centric |
| pi 0.84.2 | exactly 4: `read`, `bash`, `edit`, `write` (`runner/harnesses.json`, pi notes) |
| claude / opencode / cline / codex | 10+ narrow tools incl. subagents |
| aider | **no tools at all** — edits arrive as text blocks in the reply, shell only via suggestion |

A "needed tool" list makes `prime-agent` score F1 = 1.0 by construction (it has one tool, it is
always the needed one) and makes `aider` score 0/0 (undefined). Any gold list drawn from the
richer surfaces is a rubric that says "be Claude Code". Publishing an F1 across these numbers is
worse than publishing nothing, because it looks like a measurement.

**Replacement (cheap, defensible): canonical action verbs.** Classify every tool call — by tool
name where the surface is narrow, by parsing the command/code argument where it is not — into
`{read, search, edit, write, exec, verify, delegate, other}`. Report the **verb mix**, not an F1.
`bun test`/`tsc` → `verify`; `rg`/`grep`/`find` → `search`; `cat`/`sed -n` → `read`.

Honest caveat that must ship with it: for `ipython`-style harnesses the verb is only legible by
parsing model-authored *Python* (`open()`, `subprocess`, `Path.write_text`), which is a
best-effort classifier. Publish the **unclassified rate per harness** next to the mix; if it
exceeds ~15% for a harness, that harness's mix is not comparable and must be footnoted, not
averaged. **cheap** on §1.1, **P2**.

### 2.2 Argument validity rate against the tool schema — **cheap, but measure it on the response side**

**Mechanism:** every request body carries `tools[]` with full JSON Schema (that is precisely why
`claude` costs 27 344 fixed tokens and `aider` 561, `HARNESSES.md:515-526`). Validate each emitted
tool call's arguments against the schema from the same conversation.

**Failure mode — and it is decisive for *where* you validate:** if you read calls out of the
*next request* (§1.1), you only see the calls the harness chose to forward. A harness that
locally rejects a malformed call and silently re-prompts never shows you the malformed call, so
its arg-validity reads 100%. That is **uneven**. Validating from the *response* stream (§1.2)
sees what the model actually emitted regardless of harness policy, and is the only fair version.

Cost: a structural JSON-Schema checker (required keys, types, enums, no-extra-keys) is ~80 lines;
do not pull a full validator. Note what this actually measures: schema *design* quality (small,
unambiguous schemas → fewer malformed calls) plus how much of the tool contract the harness
crams into prose instead of schema. That is a legitimate harness property.

Second, nearly-free signal in the same place: **tool-error rate** — count `tool_result` /
`is_error` / `tool` messages whose content matches an error shape, and the *retry-after-error*
depth. Real, harness-agnostic, no schema work.

**Verdict: cheap. Priority P2** (P3 if response-side parsing slips).

### 2.3 Minimum necessary tool calls — **KILL**

Same defect as F1, one level worse: the minimum depends on the tool surface. Reading three files
is 3 calls for `pi`, 1 `ipython` call for `prime-agent`, and 0 for `aider` (it asks the user to
add them). A per-task "minimum" is a fiction; a per-harness minimum is not comparable.

Keep the descriptive form that already exists: **tool calls on solved runs, median, per harness,
with verb mix** (`spec/metrics.md:99` `toolMix`). Do not normalise it into a score.
`redundantToolCalls` (same tool + same args hash) survives — that one is **free** on §1.1 and is
genuinely harness-attributable. **P2.**

### 2.4 Edit blast radius — **free, with two hard preconditions**

**Mechanism:** `setup.sh` materialises a pristine `cp -R fixtures/<name>` and records the fixture
in `$WORKDIR/.bench-fixture` (`corpus/lib/task.sh`). Denominator ground truth already exists:
`corpus/tasks/<id>/solution/files/**` is the exact set of files that had to change (4 files for
`code-refactor-validators`, 3 for `agentic-multifile-fix`, 5 for `agentic-dedupe-module`). So
`diff -r fixtures/<f> $WORKDIR` gives files-touched and lines-changed for free, and
`|touched \ needed|` is the blast radius.

**Preconditions (both are §0.6):** snapshot between `runner/run.ts:264` and `:267`, and apply a
per-harness ignore list for the config/state the runner and the harnesses themselves write into
cwd.

**Failure modes:** (a) legitimate variation — a correct solution may touch a file the reference
did not (a new test file is *required* by `agentic-dedupe-module` and `agentic-csv-roundtrip`), so
report "files touched outside the reference set", never a ratio that punishes extra tests; (b)
whitespace/format-only churn inflates line counts — diff with `-w` as a second column; (c) for
the four **research** tasks blast radius must be 0 by definition and `assert_src_unchanged`
already grades it, so exclude them.

**Verdict: free. Priority P1** — and P0 for the *capture*, since it is unrecoverable after the fact.

### 2.5 Plan adherence / goal drift — **expensive and noisy; defer**

**Mechanism if done:** the last request body of a run contains the entire conversation, so the
judge input is one blob ≈ `peakContext` (10k-80k tokens depending on harness). ~100 runs ⇒ 2-6M
judge input tokens per full sweep, plus a rubric and a human calibration set the critique itself
demands ("calibrate it on a small human set").

**Failure mode that kills it for a *comparison*:** trajectory length is harness-correlated
(`claude` 27k fixed overhead and subagents vs `aider` 561 and one turn). A judge reading a long
trajectory sees more opportunities to call drift; a one-shot harness cannot drift because it never
gets a second turn. You would be measuring turn count with extra steps and extra variance.

**Cheap surrogate that is actually harness-neutral (see §4.2):** anchor-token retention. Do that
instead for the first run. **Verdict: expensive. Priority P4 / cut for now.**

### 2.6 Verification use (did it run tests before declaring done) — **cheap, and do it at the container/PATH boundary, not the wire**

Wire detection is **uneven**: for `pi`/`claude`/`codex` a `bun test` shows up as a legible shell
tool call; for `prime-agent`/`hermes` it is inside model-authored Python; for `aider` it is a
shell *suggestion* auto-approved by `--yes-always` and never a tool call at all.

**The honest instrument: a `bun` shim on PATH.** Every fixture is bun-only
(`corpus/README.md`, "Tooling rule"), so a wrapper script at the head of `PATH` that appends
`{ts, argv, cwd, exitCode, durationMs}` to a per-run log and then `exec`s the real `bun` catches
every verification attempt from every harness, whatever tool surface it has, whether the command
came from a shell tool or from `subprocess.run` inside Python. `runner/run.ts` already builds the
child env for both paths (native `env`, container `-e`), so this is one extra dir + one PATH entry.

Gives, all free once installed: `ranTestsBeforeStop` (bool), `firstVerifyMs`, verification count,
whether the last verification was green, and — valuable and unasked-for — **wasted tail**: wall
time and tokens spent after the last green verification.

**Failure modes:** a harness invoking bun by absolute path bypasses the shim (none observed;
check the log's `argv[0]` distribution); `bun test` inside a container needs the shim baked into
the image, so it must be added to `containers/Containerfile.*` or bind-mounted.

**Verdict: cheap. Priority P1** — highest value-per-hour of anything the critique proposed.

---

## 3. Rulings — context intelligence

### 3.1 Unique vs repeated prompt tokens / true re-send rate — **free on §1.1; here is the exact algorithm**

1. Per request, normalise the message array per shape: OpenAI `messages[]`; Anthropic
   `system` (as a synthetic message 0) + `messages[]`; Responses `input[]`.
2. Per message emit `h = hash64(role + "\x00" + canonicalJSON(content))` and `b = byteLength`.
   `Bun.hash` (wyhash) is sufficient — no crypto needed. **Message-level, not token-level:**
   token-level requires a tokenizer that matches the provider's, which we do not have, and the
   answer would not change (harnesses re-send whole messages, not fragments).
3. Maintain a per-run set of seen hashes. `newBytes` = Σb over first-seen hashes; `repeatBytes` =
   the rest.
4. Convert to tokens with the per-request calibration `promptTokens / totalPromptBytes` (this is
   why §0.1 must be fixed first, or `claude`'s ratio is wrong by the cache-read share):
   `resendRate = repeatBytes / totalBytes`, run-level `Σ repeatTokens / Σ promptTokens`.
5. **Compaction rewrite handling:** a compaction replaces a span of messages with one new summary
   message. Its hash is new ⇒ counted as unique, correctly. The *tail* messages retained after it
   are old hashes ⇒ counted as repeats, correctly. No special case needed. What *does* need care
   is a harness that re-serialises an unchanged message differently between turns (key order,
   whitespace, added ids) — that shows up as 100% unique and is a false negative. Guard: canonical
   JSON with sorted keys, and a stripped-ids variant hash; if the two disagree the harness is
   rewriting and must be footnoted.

**Failure mode:** tool results that legitimately change (a re-read of a file the agent just
edited) are new content, not waste — re-send rate is not by itself a badness score. Report it
beside `cacheHitRate`, which is the money consequence.

**Verdict: free. Priority P1.**

### 3.2 Prefix stability / cache-defeat index — **the metric the critique missed** (see §5)

### 3.3 Post-compaction goal retention — **cheap, no judge needed**

The critique's framing ("did compaction preserve the goal") implies a judge. It does not have to.

**Mechanism:** each `task.md` contains a small, exact, deterministic set of anchors — required
artifact names (`answer.json`, `report.json`, `scripts/report.ts`), the exact required JSON keys
(`directImporters`, `importedSymbols`, `failingTestFiles` in
`corpus/tasks/research-delete-graph/task.md`), target identifiers and paths (`src/graph.ts`,
`Scheduler.cancel`, `withRetry`). Extract 5-15 anchors per task **once, by hand or by a
backtick/identifier extractor over `task.md`**, and store them in `meta.json`.

Then, per request after a compaction event: `retention = |anchors present in the serialized
prompt| / |anchors|`, plus the harder one: **is the original `task.md` text still verbatim
present** (substring match on the first 200 chars of the prompt). Three states worth publishing:
task text verbatim retained / summarised (anchors survive) / goal lost (anchors gone).

**Failure modes:** anchors can survive in a stale tool result while the *instruction* is gone —
so report anchor retention split by message role (system/user vs tool-result). A harness that
never compacts scores N/A, not 1.0. Anchor choice is a judgement call and must be committed to
the repo, visible, before the run.

**Verdict: cheap. Priority P1.** It is the one context-intelligence metric that speaks directly
to the RLM / auto-compaction work and it costs no model calls.

### 3.4 Retrieval precision / recall (files retrieved vs files needed) — **uneven; ship the weak version only**

**Numerator problem:** extracting "files retrieved" requires reading path arguments out of tool
calls. Free for `pi`/`claude`/`codex`/`cline`/`opencode` (typed `read` tools); for
`prime-agent`/`hermes` the read is `open("src/graph.ts").read()` inside Python; for `aider` there
is no read at all — files enter the chat by shell `cat` output. Same uneven-surface problem as
§2.1.

**Denominator problem:** "files needed" ≠ "files changed". For `research-delete-graph` the needed
read set is genuinely knowable (the answer *is* a file list — `expected.json` names
`src/scheduler.ts`, `src/promote.ts`, `src/serialize.ts`, `src/index.ts`,
`tests/{graph,scheduler,serialize}.test.ts`), and for `agentic-multifile-fix` the three files that
must change are the ones the reference solution changes. Elsewhere it is a guess.

**Ship:** `neededFilesRead` = share of `solution/files/**` paths (and, for research tasks, the
paths named in `expected.json`) that appear **anywhere** in the run's request bodies as a literal
string. That is a substring search over captured bodies — surface-independent, works even for
`aider` and for python-inside-`ipython`, and it is a genuine recall lower bound. Do **not** report
precision: the denominator (files read that were unnecessary) is not defined, and the same
substring appears in unrelated context.

**Verdict: recall-only, cheap, uneven if done properly ⇒ ship the substring version.
Priority P2.**

### 3.5 20-turn vs 50-turn pass rate — **infeasible via CLI flags; feasible at the proxy**

Checked the actual CLIs on this box:

| harness | turn cap available? |
|---|---|
| claude 2.1.234 | **no** `--max-turns`; only `--max-budget-usd` (verified: `claude --help`) |
| opencode 1.18.18 | none in `run --help` |
| codex 0.147 | none in `exec --help` |
| cline 3.0.55 | `--retries` = consecutive *mistakes*, not turns |
| hermes | none surfaced |
| aider 0.86.2 | `--message` is one-shot; only `--max-chat-history-tokens` |
| prime-agent 0.7.3 / pi 0.84.2 | `--autonomous-max-turns` (default 12) — **only under `--autonomous`**, a different execution mode from the one being benchmarked |

So a uniform turn cap by flag is impossible, and using each harness's nearest equivalent would
compare four different semantics.

**The only harness-agnostic budget point is the proxy**: count requests per `runId`, and once the
cap is hit refuse (or return a terminal error) for the rest of the run. Because grading is
`verify.sh` over the on-disk workdir (`runner/run.ts:267`), a harness cut off mid-run still gets
graded on what it produced — so "pass @ 20 requests vs pass @ 50 requests" is measurable, and the
same mechanism gives the critique's "success @ budget" and a token budget.

**Failure modes:** harnesses react differently to a hard error — several auto-retry (429 retries
are already documented for `pi`, `cline`, `prime-agent`), so the cap must return a
non-retryable 4xx, and retried requests must not consume budget. `hermes` exits 0 regardless
(`spec/fairness.md`, exit codes), which the existing grading already handles. A harness that
writes files only at the very end (aider-style whole-file replies) is penalised more by a cap than
one that edits incrementally — that is a real property, but state it.

**Verdict: infeasible as specified, cheap as a proxy request-budget. Priority P2** — it doubles
the run count, so it belongs to the second sweep, not the first.

---

## 4. Rulings — robustness and safety

### 4.1 Recovery after injected fault — **the cheapest honest fault is at the proxy; tool faults need the container**

Ranked by implementability *without harness cooperation*:

| injection | where | verdict | what it actually measures |
|---|---|---|---|
| upstream 5xx / 429 on request *k* | proxy, ~10 lines | **free** | retry policy + backoff. Already happens naturally (documented for `pi`, `cline`, `prime-agent`) — you could *classify* the natural ones for free today. |
| a test that fails once then passes | the `bun` shim (§2.6): first `bun test` invocation exits 1 with a plausible assertion message, subsequent ones pass through | **cheap** | genuine recovery — did it read the failure, form a hypothesis, re-verify. Uniform across every harness because everything runs bun. **Best value.** |
| a tool that fails once | needs the harness's tool layer | **infeasible / uneven** — except where the tool is a subprocess, in which case it is the row above |
| killed subprocess | container `--pids-limit` / a shim that SIGKILLs its first child | **cheap but uneven** — 4 of 8 harnesses have no `container` spec (`aider`, `cline`, `codex`, `pi` in `runner/harnesses.json`); the shim version works for both paths |
| mid-run redirect (new user instruction) | requires an interactive channel; every harness here is one-shot `-p`/`-z`/`exec` | **infeasible** on this rig |

**Recommendation:** exactly one injected fault for the first serious run — the flaky-test shim —
because it is uniform, deterministic, and grades against the same `verify.sh`. Report
`recoveryRate = solved(with fault) / solved(without fault)` on the same task set.

**Failure mode:** the injected failure text is itself a prompt; write it to look like a real bun
assertion or you are measuring reaction-to-weird-string. Version it in the repo.

**Priority P2** (P1 for the free classification of *natural* 429/5xx recovery, which needs only
the `retryOf` field from `spec/metrics.md:56` that is not yet written).

### 4.2 Idempotency (rerun, compare repo state) — **free**

`--attempts` already exists (`runner/run.ts`). With the §0.6 diff snapshot, comparing the
normalised diff hash across attempts is arithmetic. Also gives pass^k for free. **P2.**

### 4.3 Safety / permissions: unauthorized read / write / egress — **expensive, uneven, and undefined on this corpus. Cut for now.**

Three separate problems:

1. **No policy to violate.** `task.md` never grants or withholds permissions
   (`corpus/README.md`, "Harness-neutral prompts"). "Unauthorized" has no referent. You would be
   inventing a policy post hoc and scoring against it.
2. **The enforcement point exists for half the field.** Only `prime-agent-fork`,
   `prime-agent-upstream`, `claude`, `opencode`, `hermes` have `container` specs;
   `aider`, `cline`, `codex`, `pi` run **native, on the host** — and `codex` runs with
   `--dangerously-bypass-approvals-and-sandbox`, which disables the macOS seatbelt. That is worth
   flagging on its own merits: the rig currently executes model-authored code unsandboxed on the
   user's machine for 4 of 8 harnesses. Containerising them is a prerequisite for *any* safety
   comparison, and arguably for the run itself.
3. **Cost of the actual instrument.** Egress: a per-run internal podman network with only the
   proxy reachable, plus a logging DNS resolver to count phone-home attempts (~half a day, and it
   changes the network path for every timing number already collected). FS: `--read-only` +
   tmpfs + workdir rw gives *prevention*, not *counting*; counting attempts needs an audit layer
   (no `auditd` equivalent that is cheap here on darwin/podman-machine).

**Ship instead, free:** *stray-file rate* — files created in `$WORKDIR` outside the reference set
and outside the harness ignore list, from the §0.6 diff. It captures the real observed misbehaviour
(scratch scripts, backup copies, `.git` dirs) and needs no new subsystem. Duplicate side effects
(double commit / double `rm`) are also visible in the §2.6 shim log for anything shelling out.

**Verdict: expensive + uneven ⇒ cut. Stray-file rate: free, P1.**

### 4.4 Static harness inventory — **half of it is objectively measurable and should be measured, not documented**

Objectively checkable, and **free** once §1.1 lands, because it comes off the wire per run rather
than out of a README:

- tool surface: exact `tools[]` names, count, and total schema bytes per harness per task;
- system-prompt bytes and hash (and whether it varies by task — it should not);
- fixed context floor — already measured (`HARNESSES.md:515-526`), but it should be a run
  artifact, not a hand-maintained table;
- number of *distinct* model roles per run (auxiliary/title/summariser calls) — the fairness work
  already found these in `opencode`, `hermes`, `claude`, `gemini-cli`;
- parallelism / subagents (§5.2);
- startup tax: process start → first proxy request. Free *if* the proxy stamps request-receipt
  time; today `ts` is written at completion.

Subjective / documentation-only, keep in prose and do not score: "control surface", "memory
surface", human gates, native-vs-interpreted. RSS/CPU is measurable (`podman stats` / `rusage`)
but only for the containerised half ⇒ **uneven**, skip.

**Verdict: free for the wire-derived half. Priority P2, and it replaces prose with data.**

---

## 5. What the critique missed — free or near-free from this vantage point

### 5.1 Prefix stability / cache-defeat index — **the single highest-value missed metric**

Per request, take the message-hash array from §3.1 and compute the longest common prefix with the
previous request's array. Three outcomes per turn:

- LCP = len(prev) → pure append. Cache-friendly. Ideal.
- LCP < len(prev) with a *shorter* new array → compaction (a real detector, unlike
  `spec/metrics.md:111`, and it does not false-positive on subagent calls, which have LCP = 0
  *and* a different system-prompt hash).
- LCP < len(prev) with a same-or-longer array → **the harness rewrote history**: reordered
  messages, re-serialised tool results, injected a reminder mid-conversation, or edited an earlier
  message. Every token after the rewrite point is a cache miss.

Publish `prefixStability` = mean LCP / len(prev), and `cacheDefeatEvents` = turns where the rewrite
point is not the tail. This is the mechanism *behind* `cacheHitRate` — the difference between a
$0.20 run and a $0.02 run — and nothing else in the spec or the critique can see it. It is free
once request bodies are hashed, it needs no judge, and it speaks directly to the RLM /
auto-compaction work. **P1.**

### 5.2 Request concurrency / subagent fan-out — free

The proxy sees overlapping in-flight requests within one `runId`. Nothing currently records
request *start* time (`ts` is stamped at completion, `proxy/server.ts:196`), so this is invisible
today; add `tStartMs` and overlapping intervals fall out. It reveals subagent fan-out — a
first-order architectural difference between `claude` and `aider` that currently shows up only as
unexplained token totals and a distorted "turn count". **Free, P1.**

### 5.3 Fixed-overhead decomposition — free

Split the turn-0 prompt into system-prompt bytes / tool-schema bytes / task-prompt bytes /
injected-context bytes. This turns `HARNESSES.md`'s 561 → 27 344 range from a curiosity into an
explanation, and it is the honest denominator for every efficiency claim. **Free, P1.**

### 5.4 Retry amplification and its cost — free today

`status` is already in the NDJSON. Nobody aggregates it. Per harness: 429/5xx count, tokens burned
on requests that were later retried, and wall time lost. `spec/fairness.md` calls retries "not the
harness's fault" — but *how many* retries a harness fires, and whether it re-sends the whole
context each time, is entirely the harness's policy and is a real cost. **Free, P1.**

### 5.5 Tool-result truncation policy — free on §1.1

Bytes of each `tool_result` compared against the actual size of the file/command output on disk.
Separates harnesses that paste whole files into context from ones that window. `spec/metrics.md:102`
has `toolResultShare` but not the truncation behaviour, which is the actionable part. **Free, P2.**

### 5.6 Wasted tail — free once §2.6 exists

Tokens and wall time spent after the last successful verification / last file mutation. Directly
comparable, needs no ground truth, and catches the "declared done three turns ago but kept
talking" failure that nothing else measures. **Free, P1.**

### 5.7 Sampling-parameter disclosure — free

Record each harness's original `temperature` / `top_p` / `max_tokens` / reasoning config before
`rewrite()` overwrites them. Whether or not you pin them (§0.3), you must know them. **Free, P0.**

---

## 6. First-run scope (next 24-48h)

**Do, in this order:**

1. §0.1 + §0.2 + §0.3/§5.7 sampling pin and capture — the proxy's token accounting is wrong across
   shapes today. Nothing else matters until this is right.
2. §1.1 request-body capture (hashes + tools + tool calls, not raw bodies).
3. §0.6 workdir diff snapshot between `runner/run.ts:264` and `:267`, with per-harness ignore
   lists. **Unrecoverable if skipped.**
4. §2.6 `bun` PATH shim (verification use + wasted tail + fault-injection hook for later).
5. Derived-for-free from 1-4: §3.1 re-send rate, §5.1 prefix stability, §5.2 concurrency,
   §5.3 overhead decomposition, §5.4 retry amplification, §2.4 blast radius, §4.3 stray files,
   §3.3 anchor retention.

**Defer:** response-side SSE parsing (§1.2, §2.2), proxy request budgets (§3.5), fault injection
(§4.1), retrieval recall (§3.4).

**Kill:** tool P/R/F1 (§2.1), minimum necessary tool calls (§2.3), plan-adherence judge (§2.5),
unauthorized-access safety metrics on this corpus (§4.3), retrieval *precision* (§3.4).

**Non-negotiable caveat for the writeup:** four harnesses currently execute model-authored code
natively on the host, one of them with the sandbox explicitly disabled. Either containerise them
or say so in the results.
