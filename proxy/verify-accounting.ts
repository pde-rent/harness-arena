// Live verification of the independent token accounting.
//
//   source ~/.prime-bench.env
//   bun run verify-accounting.ts                       # default: one harness per request shape
//   bun run verify-accounting.ts --harnesses codex,claude --prompt "reply with exactly: ok"
//
// Runs ONE one-word prompt through each named harness, each behind its own metering proxy, and
// prints the cross-shape comparison: our counts (one tokenizer, one basis) beside the
// provider-reported ones (three different bases). Reuses runner/harnesses.json for the launch
// spec so nothing about how a harness is wired is duplicated here.
//
// Differs from runner/run.ts in one respect that matters here: it waits for the metering row to
// land before killing the proxy. A streamed /responses row is appended up to ~31 s after the
// stream ends (provider lookup backoff), which is longer than codex takes to exit.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const BENCH = join(import.meta.dir, "..");
const PROMPT = arg("prompt") ?? "reply with exactly: ok";
const OUT = arg("out") ?? join(BENCH, "results", "verify-accounting");
const WANT = (arg("harnesses") ?? "optimus-prime,claude,codex,opencode").split(",");
const HOST_FROM_CONTAINER = process.env.BENCH_CONTAINER_HOST ?? "host.containers.internal";
const MODEL = process.env.BENCH_MODEL ?? "deepseek/deepseek-v4-flash-0731";

function arg(n: string) {
  const i = Bun.argv.indexOf(`--${n}`);
  return i === -1 ? undefined : Bun.argv[i + 1];
}
const sub = (s: string, v: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => v[k] ?? "");

const specs = JSON.parse(readFileSync(join(BENCH, "runner", "harnesses.json"), "utf-8")) as any[];
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, "requests.ndjson");
if (existsSync(LOG) && !Bun.argv.includes("--append")) writeFileSync(LOG, "");

async function startProxy(harness: string) {
  const proc = Bun.spawn(["bun", "run", join(BENCH, "proxy", "server.ts"), "--port", "0"], {
    env: { ...process.env, BENCH_RUN_ID: "verify-accounting", BENCH_HARNESS: harness, BENCH_LOG: LOG },
    stdout: "pipe", stderr: "inherit",
  });
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const m = buf.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
    if (m) { void reader.cancel(); return { proc, port: m[1]! }; }
  }
  proc.kill(9);
  throw new Error(`proxy never reported a port: ${buf.slice(0, 300)}`);
}

const rowCount = () => (existsSync(LOG) ? readFileSync(LOG, "utf-8").split("\n").filter(Boolean).length : 0);

for (const id of WANT) {
  const h = specs.find((s) => s.id === id);
  if (!h) { console.error(`no harness spec: ${id}`); continue; }
  const workdir = join(OUT, "work", id);
  mkdirSync(workdir, { recursive: true });
  const before = rowCount();
  const proxy = await startProxy(id);

  const container = h.container;
  const cWorkdir = container ? (container.workdir ?? "/work") : workdir;
  const baseUrl = container
    ? `http://${HOST_FROM_CONTAINER}:${proxy.port}/v1`
    : `http://localhost:${proxy.port}/v1`;
  const vars = {
    PROMPT, WORKDIR: cWorkdir, MODEL, BASE_URL: baseUrl,
    BASE_URL_ROOT: baseUrl.replace(/\/v1$/, ""), PROMPT_FILE: join(workdir, "prompt.md"),
  };
  writeFileSync(vars.PROMPT_FILE, PROMPT);
  for (const [p, c] of Object.entries(h.files ?? {})) {
    const fp = sub(p, { ...vars, WORKDIR: workdir });
    mkdirSync(join(fp, ".."), { recursive: true });
    writeFileSync(fp, sub(c as string, vars));
  }
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(h.env ?? {})) env[k] = sub(v as string, vars);

  let argv = h.argv.map((p: string) => sub(p, vars));
  let cwd: string | undefined = workdir;
  if (container) {
    const rw = container.argvRewrite ?? {};
    argv = argv.map((p: string) => rw[p] ?? p);
    argv = ["podman", "run", "--rm", "--name", `verify-acct-${id}`,
      "-v", `${workdir}:${cWorkdir}:rw`, "-w", cWorkdir,
      ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
      ...(container.args ?? []), container.image, ...argv];
    cwd = undefined;
  }

  process.stdout.write(`${id.padEnd(20)} running … `);
  const t0 = performance.now();
  const proc = Bun.spawn(argv, { cwd, env: container ? { ...process.env } : { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [so, se] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  writeFileSync(join(workdir, "stdout.txt"), so);
  writeFileSync(join(workdir, "stderr.txt"), se);

  // wait for the metering row — a streamed /responses row lands ~31 s after the stream ends
  const deadline = Date.now() + 60_000;
  while (rowCount() === before && Date.now() < deadline) await Bun.sleep(500);
  await Bun.sleep(1500);
  proxy.proc.kill();
  console.log(`exit=${code} ${Math.round(performance.now() - t0)}ms rows=+${rowCount() - before}`);
}

// ---------- report ----------
const rows = readFileSync(LOG, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
  .filter((r) => r.status === 200 && r.contextTokens != null);

const fmt = (n: any) => (typeof n === "number" ? n.toLocaleString("en-US") : String(n));
console.log("\n=== segment attribution (ours: one tokenizer, one basis) ===");
console.table(rows.map((r) => ({
  harness: r.harness, shape: r.path,
  system: fmt(r.systemTokens), toolSchema: fmt(r.toolSchemaTokens), history: fmt(r.historyTokens),
  toolResult: fmt(r.toolResultTokens), currentTurn: fmt(r.currentTurnTokens),
  sum: fmt(r.segmentSumTokens), context: fmt(r.contextTokens),
  delta: r.segmentReconcileDelta, ok: r.segmentReconcileOk, tools: r.toolCount,
})));

console.log("=== ours vs provider-reported (theirs: three different bases) ===");
console.table(rows.map((r) => ({
  harness: r.harness, shape: r.path,
  ourContext: fmt(r.contextTokens),
  providerPrompt: fmt(r.providerReportedPromptTokens),
  providerCacheRead: fmt(r.providerReportedCachedTokens),
  cacheCtrlBreakpoints: r.cacheControlBreakpoints,
  ratio: r.promptDivergenceRatio,
  ourOut: r.outputTokens, ourContent: r.outputContentTokens, ourReasoning: r.outputReasoningTokens,
  ourToolCall: r.outputToolCallTokens, providerOut: r.providerReportedCompletionTokens,
  costUsd: r.costUsd,
})));

const bad = rows.filter((r) => r.segmentReconcileOk === false);
console.log(bad.length ? `!! ${bad.length} rows failed segment reconciliation` : `OK: all ${rows.length} rows reconcile`);
const ratios = rows.map((r) => r.promptDivergenceRatio).filter((x: any) => typeof x === "number");
if (ratios.length > 1) {
  const min = Math.min(...ratios), max = Math.max(...ratios);
  console.log(`our/provider ratio across shapes: ${min.toFixed(4)} … ${max.toFixed(4)} (spread ${((max / min - 1) * 100).toFixed(1)}%)`);
}
process.exit(bad.length ? 1 : 0);
