#!/usr/bin/env bun
/**
 * Turn results.ndjson into the head-to-head report.
 *
 *   bun run report.ts <results.ndjson> [--baseline claude]
 *
 * Design notes, all of them the result of review findings:
 *
 * - **No target thresholds.** An earlier version printed ✓/✗ against a -30%/+30% goal. A
 *   measurement tool that grades against the owner's desired answer is not a measurement tool.
 * - **Failures are never dropped.** The headline efficiency number is portfolio cost-per-
 *   success over ALL tasks: total spend ÷ total successes. Conditioning on "tasks both
 *   solved" is a collider — it deletes exactly the hard tasks the efficient harness lost.
 * - **Medians over ALL attempts**, not over successful ones. Taking the median of successes
 *   with attempts>1 silently becomes best-of-k with the failures erased.
 * - Solve counts are reported as k/m per task, so variance is visible rather than averaged away.
 */
import { readFileSync } from "node:fs";
import type { RunResult } from "./types.ts";

const path = Bun.argv[2];
if (!path) throw new Error("usage: bun run report.ts <results.ndjson> [--baseline <harness>]");
const baselineIndex = Bun.argv.indexOf("--baseline");
const baselineId = baselineIndex === -1 ? undefined : Bun.argv[baselineIndex + 1];

const results = readFileSync(path, "utf-8")
	.split("\n")
	.filter(Boolean)
	.map((line) => JSON.parse(line) as RunResult);

const harnesses = [...new Set(results.map((r) => r.harness))].sort();
const tasks = [...new Set(results.map((r) => r.task))].sort();
const pad = (value: string | number, width: number) => String(value).padEnd(width);

function median(values: number[]): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Runs for a cell, excluding ones discarded for provider drift — those are reported separately. */
function runsFor(harness: string, task?: string) {
	return results.filter(
		(r) => r.harness === harness && (task === undefined || r.task === task) && r.outcome !== "discarded_unpinned",
	);
}

console.log("## Solve counts (k of m attempts)\n");
console.log(`${pad("task", 26)}${harnesses.map((h) => pad(h, 16)).join("")}`);
for (const task of tasks) {
	const row = harnesses.map((h) => {
		const runs = runsFor(h, task);
		const solved = runs.filter((r) => r.solved).length;
		return pad(runs.length === 0 ? "-" : `${solved}/${runs.length}`, 16);
	});
	console.log(`${pad(task, 26)}${row.join("")}`);
}

console.log("\n## Portfolio totals — ALL tasks, failures included\n");
console.log(
	`${pad("harness", 22)}${pad("solved", 10)}${pad("tokens", 12)}${pad("tok/success", 14)}${pad("$/success", 12)}${pad("wall(s)", 10)}`,
);
for (const harness of harnesses) {
	const runs = runsFor(harness);
	const solved = runs.filter((r) => r.solved).length;
	const tokens = runs.reduce((total, r) => total + r.totalTokens, 0);
	const cost = runs.reduce((total, r) => total + r.costUsd, 0);
	const wall = runs.reduce((total, r) => total + r.wallMs, 0);
	// Spend is charged whether or not the run succeeded; a harness that solves nothing has an
	// undefined efficiency, which is reported as such rather than as a flattering blank.
	const perSuccess = solved === 0 ? `- (0/${runs.length})` : Math.round(tokens / solved).toString();
	const costPer = solved === 0 ? `- (0/${runs.length})` : (cost / solved).toFixed(4);
	console.log(
		`${pad(harness, 22)}${pad(`${solved}/${runs.length}`, 10)}${pad(tokens, 12)}${pad(perSuccess, 14)}${pad(costPer, 12)}${pad(Math.round(wall / 100) / 10, 10)}`,
	);
}

console.log("\n## Per-run distribution — medians over ALL attempts, with range\n");
console.log(`${pad("harness", 22)}${pad("tokens med [min-max]", 30)}${pad("wall(s) med [min-max]", 28)}${pad("turns", 8)}`);
for (const harness of harnesses) {
	const runs = runsFor(harness);
	if (runs.length === 0) continue;
	const tok = runs.map((r) => r.totalTokens);
	const wall = runs.map((r) => Math.round(r.wallMs / 100) / 10);
	const turns = runs.map((r) => r.requests);
	const span = (values: number[], med: number) =>
		`${med} [${Math.min(...values)}-${Math.max(...values)}]`;
	console.log(
		`${pad(harness, 22)}${pad(span(tok, median(tok)), 30)}${pad(span(wall, median(wall)), 28)}${pad(median(turns), 8)}`,
	);
}

if (baselineId && harnesses.includes(baselineId)) {
	console.log(`\n## Ratios vs ${baselineId} — portfolio, all tasks\n`);
	console.log(`${pad("harness", 22)}${pad("tok/success", 16)}${pad("$/success", 16)}${pad("solved", 10)}`);
	const baseRuns = runsFor(baselineId);
	const baseSolved = baseRuns.filter((r) => r.solved).length;
	const baseTok = baseRuns.reduce((t, r) => t + r.totalTokens, 0);
	const baseCost = baseRuns.reduce((t, r) => t + r.costUsd, 0);
	for (const harness of harnesses) {
		const runs = runsFor(harness);
		const solved = runs.filter((r) => r.solved).length;
		if (solved === 0 || baseSolved === 0) {
			console.log(`${pad(harness, 22)}${pad("n/a", 16)}${pad("n/a", 16)}${pad(`${solved}/${runs.length}`, 10)}`);
			continue;
		}
		const tokRatio = runs.reduce((t, r) => t + r.totalTokens, 0) / solved / (baseTok / baseSolved);
		const costRatio = runs.reduce((t, r) => t + r.costUsd, 0) / solved / (baseCost / baseSolved);
		console.log(
			`${pad(harness, 22)}${pad(`${tokRatio.toFixed(2)}x`, 16)}${pad(`${costRatio.toFixed(2)}x`, 16)}${pad(`${solved}/${runs.length}`, 10)}`,
		);
	}
	console.log(
		"\nRatios are descriptive, not verdicts. Solve counts dominate: a harness that solves more\ntasks is better even when its ratio is worse. With few tasks and few attempts these ratios\ncarry wide uncertainty — read the range column above before drawing a conclusion.",
	);
}

const discarded = results.filter((r) => r.outcome === "discarded_unpinned");
const zeroToken = results.filter((r) => r.outcome !== "discarded_unpinned" && r.requests === 0);
if (discarded.length > 0) {
	console.log(`\n## Discarded — provider drift (${discarded.length})\n`);
	for (const run of discarded) console.log(`  ${run.runId}: ${run.providersServed.join(", ")}`);
}
if (zeroToken.length > 0) {
	console.log(`\n## Suspect — no model requests recorded (${zeroToken.length})\n`);
	for (const run of zeroToken) console.log(`  ${run.runId}: ${run.outcome}, exit ${run.exitCode}`);
	console.log("  A run with zero requests did not do the task; it must not be read as cheap.");
}
