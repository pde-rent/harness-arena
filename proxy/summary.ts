// bun run summary.ts <requests.ndjson>
const file = process.argv[2] || process.env.BENCH_LOG || "./requests.ndjson";
const PIN = process.env.BENCH_PROVIDER_ONLY || "deepinfra/fp8";
const pinName = PIN.split("/")[0].toLowerCase(); // "deepinfra"

const rows = (await Bun.file(file).text())
  .split("\n").filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } })
  .filter(Boolean) as any[];

if (!rows.length) { console.log(`no rows in ${file}`); process.exit(0); }

const pct = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

const groups = new Map<string, any[]>();
for (const r of rows) {
  const k = `${r.harness}`;
  (groups.get(k) || groups.set(k, []).get(k)!).push(r);
}

const fmt = (n: number) => n.toLocaleString("en-US");
const table: any[] = [];
const bad: any[] = [];

for (const [harness, rs] of groups) {
  const ttfb = rs.map((r) => r.ttfbMs).filter((x) => typeof x === "number");
  table.push({
    harness,
    reqs: rs.length,
    errs: rs.filter((r) => r.status !== 200).length,
    prompt: rs.reduce((a, r) => a + (r.promptTokens || 0), 0),
    completion: rs.reduce((a, r) => a + (r.completionTokens || 0), 0),
    reasoning: rs.reduce((a, r) => a + (r.reasoningTokens || 0), 0),
    cached: rs.reduce((a, r) => a + (r.cachedTokens || 0), 0),
    total: rs.reduce((a, r) => a + (r.totalTokens || 0), 0),
    costUsd: +rs.reduce((a, r) => a + (r.costUsd || 0), 0).toFixed(6),
    p50ttfb: pct(ttfb, 50),
    p95ttfb: pct(ttfb, 95),
    wallMs: rs.reduce((a, r) => a + (r.totalMs || 0), 0),
  });
  for (const r of rs) {
    const p = (r.providerServed || "").toLowerCase().replace(/\s+/g, "");
    // Only generation paths carry a provider; /models & friends are metadata GETs with
    // providerServed null and would otherwise fail the pin assert every run.
    const isGen = /\/(chat\/completions|completions|messages|responses)$/.test(r.path || "");
    if (isGen && r.status === 200 && p !== pinName) bad.push(r);
  }
}

console.table(table.map((t) => ({
  ...t, prompt: fmt(t.prompt), completion: fmt(t.completion), total: fmt(t.total),
})));

const providers = new Map<string, number>();
for (const r of rows) providers.set(r.providerServed ?? "null", (providers.get(r.providerServed ?? "null") || 0) + 1);
console.log("providersServed:", Object.fromEntries(providers));

// ---------- independent accounting (ours vs theirs) ----------
// Our counts come from one tokenizer applied to the wire bytes, identically for every harness.
// The provider-reported ones do not share a basis: OpenAI-shape prompt_tokens includes cache
// reads, Anthropic-shape input_tokens excludes them. The divergence column is a finding about
// the harness's caching, not noise to be averaged away.
const acct = rows.filter((r) => r.status === 200 && typeof r.contextTokens === "number");
if (acct.length) {
  const byH = new Map<string, any[]>();
  for (const r of acct) (byH.get(r.harness) || byH.set(r.harness, []).get(r.harness)!).push(r);
  const sum = (rs: any[], k: string) => rs.reduce((a, r) => a + (r[k] || 0), 0);
  console.log("\nindependent token accounting — tokenizer:",
    acct[0].tokenizer, `sha256=${acct[0].tokenizerSha256}`, `vocab=${acct[0].tokenizerVocab}`);
  console.table([...byH].map(([harness, rs]) => ({
    harness,
    reqs: rs.length,
    context: fmt(sum(rs, "contextTokens")),
    system: fmt(sum(rs, "systemTokens")),
    toolSchema: fmt(sum(rs, "toolSchemaTokens")),
    history: fmt(sum(rs, "historyTokens")),
    toolResult: fmt(sum(rs, "toolResultTokens")),
    currentTurn: fmt(sum(rs, "currentTurnTokens")),
    output: fmt(sum(rs, "outputTokens")),
    reasoning: fmt(sum(rs, "outputReasoningTokens")),
    provPrompt: fmt(sum(rs, "providerReportedPromptTokens")),
    provCacheRead: fmt(sum(rs, "providerReportedCachedTokens")),
    cacheCtrl: sum(rs, "cacheControlBreakpoints"),
    // >1 means the provider under-reports the context we measured (cache reads excluded);
    // <1 means it over-reports it (chat template + server-side tool rendering we cannot see).
    ourOverTheirs: sum(rs, "providerReportedPromptTokens")
      ? +(sum(rs, "contextTokens") / sum(rs, "providerReportedPromptTokens")).toFixed(3) : null,
    costUsd: +sum(rs, "costUsd").toFixed(6),   // provider-derived; we cannot price a request
  })));
  const unreconciled = acct.filter((r) => r.segmentReconcileOk === false);
  console.log(unreconciled.length
    ? `!! ${unreconciled.length}/${acct.length} rows failed segment reconciliation: ${unreconciled.slice(0, 5).map((r) => r.requestId).join(", ")}`
    : `segments reconcile with the whole-context count on all ${acct.length} rows`);
}


// Pin-gate refusals / unpinned pass-throughs. These never reach status 200, so the provider
// check above cannot see them — surface them explicitly or a leak stays invisible.
const viol = rows.filter((r: any) => r.violation);
if (viol.length) {
  console.log(`\n!! PIN GATE: ${viol.length} unpinnable request(s) — the harness tried to bypass the pin`);
  const byKind = new Map<string, number>();
  for (const r of viol as any[]) byKind.set(r.violation, (byKind.get(r.violation) || 0) + 1);
  console.log("   ", Object.fromEntries(byKind));
  for (const r of (viol as any[]).slice(0, 20)) console.log(`   ${r.ts} ${r.harness} ${r.path} ${r.violation}`);
}

if (bad.length) {
  console.log(`\n!! PROVIDER PIN VIOLATION: ${bad.length}/${rows.length} rows not served by "${pinName}"`);
  for (const r of bad.slice(0, 20)) console.log(`   ${r.ts} ${r.harness} ${r.requestId} provider=${r.providerServed} model=${r.model}`);
  process.exit(1);
} else {
  console.log(`\nOK: all ${rows.length} rows served by "${pinName}" (pin ${PIN} held)`);
}
