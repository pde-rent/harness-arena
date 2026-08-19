#!/usr/bin/env bun
/**
 * Head-to-head harness benchmark runner.
 *
 * For every (harness × task × attempt):
 *   1. materialize a clean working copy with the task's setup.sh
 *   2. start a dedicated metering proxy (model + provider pinned, one per run)
 *   3. run the harness headlessly against the task prompt, cwd = the working copy
 *   4. grade with the task's verify.sh
 *   5. fold the proxy's NDJSON rows into one result record
 *
 * Everything is offline except the model calls, which all go through the proxy.
 *
 *   bun run run.ts --harnesses claude,prime-agent --tasks all --attempts 1
 *   bun run run.ts --dry-run          # setup + verify only, no model calls
 *   bun run run.ts --native           # force the host path, ignore `container` specs
 *
 * A harness with a `container` spec runs inside `podman run --rm`: the workdir is
 * bind-mounted, only its declared env crosses the boundary (so the real API key never
 * does), and the host-side proxy is reached at `host.containers.internal:<port>`.
 * setup.sh, verify.sh and the proxy all stay on the host.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessSpec, RunResult, TaskMeta, UsageRow } from "./types.ts";

const root = import.meta.dir;
const benchRoot = join(root, "..");
const corpusDir = join(benchRoot, "corpus");
const proxyEntry = join(benchRoot, "proxy", "server.ts");

function arg(name: string, fallback?: string): string | undefined {
	const i = Bun.argv.indexOf(`--${name}`);
	return i === -1 ? fallback : (Bun.argv[i + 1] ?? fallback);
}
const has = (name: string) => Bun.argv.includes(`--${name}`);

const dryRun = has("dry-run");
/** Force the host/native path even for harnesses that declare a `container`. */
const forceNative = has("native");
/**
 * Provider endpoints a run must never reach directly. Blackholed inside every container so a
 * harness carrying its own credentials cannot bill traffic that bypasses the meter.
 */
const EGRESS_BLACKHOLE = [
	"openrouter.ai",
	"api.openrouter.ai",
	"api.anthropic.com",
	"api.openai.com",
	"generativelanguage.googleapis.com",
	"api.z.ai",
	"open.bigmodel.cn",
];

/** Hostname a container uses to reach the host-side metering proxy. */
const HOST_FROM_CONTAINER = process.env.BENCH_CONTAINER_HOST ?? "host.containers.internal";
const attempts = Number(arg("attempts", "1"));
const outDir = arg("out", join(benchRoot, "results", new Date().toISOString().replace(/[:.]/g, "-")))!;

/** Load harness registry; only enabled entries run. */
function loadHarnesses(): HarnessSpec[] {
	const all = JSON.parse(readFileSync(join(root, "harnesses.json"), "utf-8")) as HarnessSpec[];
	const wanted = arg("harnesses", "all");
	const enabled = all.filter((h) => h.enabled !== false);
	if (!wanted || wanted === "all") return enabled;
	const ids = new Set(wanted.split(","));
	return enabled.filter((h) => ids.has(h.id));
}

function loadTasks(): TaskMeta[] {
	const glob = new Bun.Glob("tasks/*/meta.json");
	const metas: TaskMeta[] = [];
	for (const rel of [...glob.scanSync({ cwd: corpusDir })].sort()) {
		metas.push(JSON.parse(readFileSync(join(corpusDir, rel), "utf-8")) as TaskMeta);
	}
	const wanted = arg("tasks", "all");
	if (!wanted || wanted === "all") return metas;
	const ids = new Set(wanted.split(","));
	return metas.filter((t) => ids.has(t.id));
}

function substitute(value: string, vars: Record<string, string>): string {
	return value.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? "");
}

async function sh(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; timeoutMs?: number } = {}) {
	const proc = Bun.spawn(cmd, {
		cwd: opts.cwd,
		env: { ...process.env, ...opts.env },
		// Closed, not inherited. Every harness takes its prompt through argv, and one that finds an
		// open stdin may wait on it: codex exec appends piped stdin to the prompt and announced
		// "Reading additional input from stdin..." before exiting non-zero without ever calling the
		// model.
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = opts.timeoutMs
		? setTimeout(() => {
				timedOut = true;
				proc.kill(9);
			}, opts.timeoutMs)
		: undefined;
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	if (timer) clearTimeout(timer);
	return { exitCode, stdout, stderr, timedOut };
}

/** Start a metering proxy for one run and wait for it to report its port. */
async function startProxy(runId: string, harness: string, logPath: string) {
	const proc = Bun.spawn(["bun", "run", proxyEntry, "--port", "0"], {
		env: { ...process.env, BENCH_RUN_ID: runId, BENCH_HARNESS: harness, BENCH_LOG: logPath },
		stdout: "pipe",
		stderr: "pipe",
	});
	const reader = proc.stdout.getReader();
	const decoder = new TextDecoder();
	let buffered = "";
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) break;
		buffered += decoder.decode(value, { stream: true });
		const match = buffered.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
		if (match) {
			void reader.cancel();
			return { proc, baseUrl: `http://localhost:${match[1]}/v1` };
		}
	}
	proc.kill(9);
	throw new Error(`proxy did not report a port; output so far: ${buffered.slice(0, 400)}`);
}

/**
 * Wait until no new metering rows for this run have appeared for `quietMs`.
 *
 * An empty log is NOT quiet, it is "nothing has landed yet": the responses shape writes its row
 * only after the provider lookup finishes, which backs off to ~31 s past the end of the stream.
 * Returning on zero rows killed the proxy at ~4.5 s and threw the row away, so codex read as
 * zero metered requests on runs that had in fact gone through the proxy correctly. Waiting the
 * full `maxMs` in that case costs time only on runs that are already broken.
 */
async function settleUsageLog(logPath: string, runId: string, quietMs = 4000, maxMs = 60_000): Promise<void> {
	const deadline = Date.now() + maxMs;
	let lastCount = -1;
	let lastChange = Date.now();
	while (Date.now() < deadline) {
		const count = foldUsage(logPath, runId).requests;
		if (count !== lastCount) {
			lastCount = count;
			lastChange = Date.now();
		} else if (count > 0 && Date.now() - lastChange >= quietMs) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}

/**
 * Account spend, straight from the provider. The proxy can only meter what reaches it, so the
 * money is the one signal that moves even when a request bypasses us entirely. Returns null
 * when the lookup fails — a failed lookup must not silently pass a run.
 */
/**
 * Poll the account spend until it stops moving, so a lagging charge from the previous run is not
 * attributed to the next one. Gives up after `maxMs` and returns the last reading rather than
 * blocking a sweep: a stale baseline can only make the check stricter, never laxer.
 */
async function settledAccountSpendUsd(quietMs = 3000, maxMs = 30_000): Promise<number | null> {
	const deadline = Date.now() + maxMs;
	let last = await accountSpendUsd();
	let lastChange = Date.now();
	while (Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
		const now = await accountSpendUsd();
		if (now !== last) {
			last = now;
			lastChange = Date.now();
		} else if (Date.now() - lastChange >= quietMs) {
			return last;
		}
	}
	return last;
}

async function accountSpendUsd(): Promise<number | null> {
	const key = process.env.OPENROUTER_API_KEY;
	if (!key) return null;
	try {
		const response = await fetch("https://openrouter.ai/api/v1/key", {
			headers: { Authorization: `Bearer ${key}` },
		});
		if (!response.ok) return null;
		const body = (await response.json()) as { data?: { usage?: number } };
		return typeof body.data?.usage === "number" ? body.data.usage : null;
	} catch {
		return null;
	}
}

/** Rows the proxy refused or passed through unpinned during this run. */
function violationsFor(logPath: string, runId: string): string[] {
	try {
		return readFileSync(logPath, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as { runId: string; violation?: string })
			.filter((row) => row.runId === runId && row.violation)
			.map((row) => row.violation as string);
	} catch {
		return [];
	}
}

function foldUsage(logPath: string, runId: string) {
	let rows: UsageRow[] = [];
	try {
		rows = readFileSync(logPath, "utf-8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as UsageRow)
			.filter((row) => row.runId === runId);
	} catch {
		// no requests recorded (harness failed before calling the model)
	}
	const sum = (pick: (row: UsageRow) => number | undefined) =>
		rows.reduce((total, row) => total + (pick(row) ?? 0), 0);
	return {
		requests: rows.length,
		promptTokens: sum((r) => r.promptTokens),
		completionTokens: sum((r) => r.completionTokens),
		reasoningTokens: sum((r) => r.reasoningTokens),
		cachedTokens: sum((r) => r.cachedTokens),
		totalTokens: sum((r) => r.totalTokens),
		costUsd: sum((r) => r.costUsd),
		providersServed: [...new Set(rows.map((r) => r.providerServed).filter((p): p is string => Boolean(p)))],
	};
}

async function runOne(harness: HarnessSpec, task: TaskMeta, attempt: number): Promise<RunResult> {
	const runId = `${harness.id}__${task.id}__${attempt}`;
	const taskDir = join(corpusDir, "tasks", task.id);
	const workdir = join(outDir, "work", runId);
	const logDir = join(outDir, "logs");
	mkdirSync(workdir, { recursive: true });
	mkdirSync(logDir, { recursive: true });

	const prompt = readFileSync(join(taskDir, "task.md"), "utf-8");
	const promptFile = join(logDir, `${runId}.prompt.md`);
	writeFileSync(promptFile, prompt);

	// 1. clean working copy
	const setup = await sh(["bash", join(taskDir, "setup.sh")], {
		cwd: taskDir,
		env: { WORKDIR: workdir },
		timeoutMs: 120_000,
	});
	if (setup.exitCode !== 0) {
		throw new Error(`setup.sh failed for ${task.id}: ${setup.stderr.slice(0, 400)}`);
	}

	const usageLog = join(outDir, "requests.ndjson");
	let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
	let exitCode: number | null = null;
	let timedOut = false;
	const stdoutPath = join(logDir, `${runId}.stdout.txt`);
	const stderrPath = join(logDir, `${runId}.stderr.txt`);
	const started = performance.now();

	// Settled, not merely sampled. The provider's credits endpoint lags the request that caused the
	// charge, so in a sweep the previous harness's cost lands inside this run's window and reads as
	// spend that escaped the meter. Waiting for it to stop moving attributes each charge to the run
	// that made it; it does not widen the tolerance, so a real leak is still caught.
	const spendBefore = dryRun ? null : await settledAccountSpendUsd();

	if (!dryRun) {
		proxy = await startProxy(runId, harness.id, usageLog);
		const container = forceNative ? undefined : harness.container;
		// Inside a container the working copy is a bind mount at a fixed path, and the
		// host-side proxy is reachable under a different hostname. Config files are still
		// written on the host (same directory, host path), so they need their own vars.
		const cWorkdir = container ? (container.workdir ?? "/work") : workdir;
		const proxyPort = new URL(proxy.baseUrl).port;
		const baseUrl = container ? `http://${HOST_FROM_CONTAINER}:${proxyPort}/v1` : proxy.baseUrl;
		const vars = {
			PROMPT_FILE: promptFile,
			PROMPT: prompt,
			WORKDIR: cWorkdir,
			MODEL: process.env.BENCH_MODEL ?? "deepseek/deepseek-v4-flash-0731",
			BASE_URL: baseUrl,
			BASE_URL_ROOT: baseUrl.replace(/\/v1$/, ""),
		};
		const fileVars = { ...vars, WORKDIR: workdir };

		// Per-run config files (e.g. a models.json pointing the harness at this run's proxy).
		for (const [rawPath, rawContents] of Object.entries(harness.files ?? {})) {
			const filePath = substitute(rawPath, fileVars);
			mkdirSync(join(filePath, ".."), { recursive: true });
			writeFileSync(filePath, substitute(rawContents, vars));
		}
		const harnessArgv = harness.argv.map((part) => substitute(part, vars));
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(harness.env ?? {})) env[key] = substitute(value, vars);

		let argv = harnessArgv;
		let cwd: string | undefined = workdir;
		const containerName = `bench-${runId.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
		if (container) {
			// argv records host binary/script paths; the image puts them elsewhere.
			const rewrite = container.argvRewrite ?? {};
			argv = harnessArgv.map((part) => rewrite[part] ?? part);
			const envArgs = Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
			argv = [
				"podman",
				"run",
				"--rm",
				// Named so a timeout (which only kills the podman client) can still reap the
				// container instead of leaving the agent running against the dead proxy.
				"--name",
				containerName,
				"-v",
				`${workdir}:${cWorkdir}:rw`,
				"-w",
				cWorkdir,
				// Egress lockdown: the only endpoint a run may reach is the host proxy.
				// Blackholing the provider hostnames stops a harness that kept its own
				// credentials from billing traffic we never metered — which has already
				// happened once. A harness dialling a raw IP still escapes this, which is
				// why the credits-delta assertion below is the real backstop.
				...EGRESS_BLACKHOLE.flatMap((host) => ["--add-host", `${host}:0.0.0.0`]),
				...envArgs,
				...(container.args ?? []),
				container.image,
				...argv,
			];
			// podman itself runs on the host; the container gets only the -e vars above,
			// so the real OPENROUTER_API_KEY never crosses the boundary.
			cwd = undefined;
		}

		const result = await sh(argv, {
			cwd,
			env: container ? {} : env,
			timeoutMs: task.timeoutSeconds * 1000,
		});
		exitCode = result.exitCode;
		timedOut = result.timedOut;
		if (container && timedOut) await sh(["podman", "rm", "-f", containerName], { timeoutMs: 30_000 });
		writeFileSync(stdoutPath, result.stdout);
		writeFileSync(stderrPath, result.stderr);
		// Deliberately NOT killed here. The responses shape resolves its provider with a
		// follow-up lookup that can land ~30s after the harness exits, and that row is written
		// by this proxy — killing it now silently loses the run's usage entirely.
	}

	const wallMs = Math.round(performance.now() - started);

	// Snapshot what the agent produced BEFORE grading. verify.sh restores a pristine tests/
	// and stages hidden checks, so it mutates the tree — read the diff after it runs and you
	// are reading the grader's edits, not the agent's. This is also the only artifact that
	// supports blast-radius and quality review later, so it is never discarded.
	const artifactDir = join(outDir, "artifacts", runId);
	mkdirSync(artifactDir, { recursive: true });
	await sh(["bash", "-c", `cd ${JSON.stringify(workdir)} && tar --exclude .bench-* -cf ${JSON.stringify(join(artifactDir, "produced.tar"))} .`], {
		timeoutMs: 120_000,
	});

	// Some harnesses abort the response body once they have the text they need, and the
	// provider lookup for the final metering row can land well after the process exits
	// (observed up to ~30s for the responses shape). Wait for the log to go quiet before
	// folding, or usage silently reads as zero.
	if (!dryRun) {
		await settleUsageLog(usageLog, runId);
		proxy?.proc.kill();
	}

	// 2. grade
	const verify = await sh(["bash", join(taskDir, "verify.sh")], {
		cwd: taskDir,
		env: { WORKDIR: workdir },
		timeoutMs: 180_000,
	});
	// A harness that exited non-zero did not complete its turn, whatever the verifier then found.
	// Grading purely on the verifier reported a PASS for a crashed harness that never reached the
	// model, because a task may legitimately verify something the model was not needed for --
	// smoke-ok grades only that the workdir exists. Treating the crash as its own outcome keeps a
	// broken harness out of the solve rate instead of inflating it.
	const harnessCrashed = exitCode !== null && exitCode !== 0;
	const solved = verify.exitCode === 0 && !harnessCrashed;

	const usage = foldUsage(usageLog, runId);

	// A run that solved the task without a single metered request did not solve it here: either it
	// answered from somewhere the proxy never saw, or it never called a model at all. codex reported
	// a turn with 10,615 input tokens while the proxy logged nothing, which is indistinguishable
	// from an unpinned run and must not enter a ranking.
	const reachedTheMeter = dryRun || usage.requests > 0;

	// Every model call must have passed the meter. Two independent checks, because each
	// catches what the other misses: the proxy sees refusals it blocked, while the account
	// spend moves for requests that never reached the proxy at all.
	const violations = violationsFor(usageLog, runId);
	if (solved && !reachedTheMeter) violations.push("no_metered_request");
	const spendAfter = dryRun ? null : await accountSpendUsd();
	const unmetered =
		spendBefore !== null && spendAfter !== null
			? Math.max(0, spendAfter - spendBefore - usage.costUsd)
			: 0;
	// Tolerance covers rounding in the provider's own accounting, not a missed request.
	const UNMETERED_TOLERANCE_USD = 2e-4;
	const escaped = unmetered > UNMETERED_TOLERANCE_USD;
	const wrongProvider = usage.providersServed.some((p) => !/deepinfra/i.test(p));

	if (violations.length > 0 || escaped || wrongProvider) {
		const why = [
			violations.length > 0 ? `proxy violations: ${[...new Set(violations)].join(", ")}` : null,
			escaped ? `$${unmetered.toFixed(6)} of spend never reached the meter` : null,
			wrongProvider ? `served by ${usage.providersServed.join(", ")}` : null,
		]
			.filter(Boolean)
			.join("; ");
		return {
			runId,
			harness: harness.id,
			task: task.id,
			category: task.category,
			attempt,
			solved: false,
			outcome: "discarded_unpinned",
			discardReason: why,
			wallMs,
			exitCode,
			stdoutPath,
			stderrPath,
			...usage,
		};
	}

	const outcome: RunResult["outcome"] = solved
		? "solved"
		: timedOut
			? "timeout"
			: exitCode !== 0 && exitCode !== null
				? "harness_error"
				: "verify_failed";

	return {
		runId,
		harness: harness.id,
		task: task.id,
		category: task.category,
		attempt,
		solved,
		outcome,
		wallMs,
		exitCode,
		stdoutPath,
		stderrPath,
		...usage,
	};
}

// ---------------------------------------------------------------------------

const harnesses = loadHarnesses();
const tasks = loadTasks();
mkdirSync(outDir, { recursive: true });

if (harnesses.length === 0) throw new Error("no enabled harnesses; fill in runner/harnesses.json");
if (tasks.length === 0) throw new Error(`no tasks found under ${corpusDir}/tasks`);

console.log(`harnesses: ${harnesses.map((h) => h.id).join(", ")}`);
console.log(`tasks:     ${tasks.length} × ${attempts} attempt(s)`);
console.log(
	`mode:      ${
		forceNative
			? "native (--native forces the host path)"
			: harnesses.map((h) => `${h.id}=${h.container ? h.container.image : "native"}`).join(" ")
	}`,
);
console.log(`out:       ${outDir}${dryRun ? "  (dry run — no model calls)" : ""}\n`);

const results: RunResult[] = [];
const resultsPath = join(outDir, "results.ndjson");

for (const task of tasks) {
	for (const harness of harnesses) {
		for (let attempt = 1; attempt <= attempts; attempt += 1) {
			process.stdout.write(`${task.id} · ${harness.id} · #${attempt} … `);
			try {
				const result = await runOne(harness, task, attempt);
				results.push(result);
				await Bun.write(resultsPath, `${results.map((r) => JSON.stringify(r)).join("\n")}\n`);
				console.log(
					`${result.solved ? "PASS" : `FAIL(${result.outcome})`} · ${Math.round(result.wallMs / 100) / 10}s · ${result.totalTokens} tok`,
				);
			} catch (error) {
				console.log(`ERROR · ${error instanceof Error ? error.message : String(error)}`);
			}
		}
	}
}

console.log(`\nwrote ${resultsPath}`);
console.log(`report with: bun run ${join(root, "report.ts")} ${resultsPath}`);
