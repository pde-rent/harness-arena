#!/usr/bin/env bun
/**
 * Collect per-harness metadata from the pinned images.
 *
 *   bun run metadata.ts [--json]
 *
 * Everything here is measured inside the harness's own image rather than read from a manifest, so
 * it describes what actually ships. Two things are deliberately not collapsed into one number:
 *
 * - **payload** is `/opt/harness` only, not the image. Image size is dominated by the base OS and
 *   would rank harnesses by their choice of base rather than by what they install.
 * - **packages** counts installed units (node_modules package.json files, python dist-info dirs).
 *   Zero means the harness ships a bundle, NOT that it has no dependencies -- a bundled harness has
 *   simply already resolved them. `shape` records which of the two a row is, because comparing a
 *   bundled 0 against a tree's 300 as if both were dependency counts is meaningless.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HarnessSpec } from "./types.ts";

const root = import.meta.dir;
const asJson = Bun.argv.includes("--json");
const harnesses = JSON.parse(readFileSync(join(root, "harnesses.json"), "utf-8")) as HarnessSpec[];

const PROBE = `
p=$(du -sm /opt/harness 2>/dev/null | cut -f1)
n=$(find /opt/harness -name package.json -path "*node_modules*" 2>/dev/null | wc -l)
d=$(find /opt/harness -maxdepth 6 -name "*.dist-info" 2>/dev/null | wc -l)
echo "$p $((n+d))"
`;

async function probe(image: string): Promise<{ payloadMb: number | null; packages: number | null }> {
	const proc = Bun.spawn(["podman", "run", "--rm", image, "sh", "-c", PROBE], {
		stdin: "ignore",
		stdout: "pipe",
		stderr: "ignore",
	});
	const out = (await new Response(proc.stdout).text()).trim().split(/\s+/);
	if ((await proc.exited) !== 0) return { payloadMb: null, packages: null };
	const [mb, pkgs] = out.map(Number);
	return { payloadMb: Number.isFinite(mb!) ? mb! : null, packages: Number.isFinite(pkgs!) ? pkgs! : null };
}

const rows: Array<Record<string, unknown>> = [];
for (const h of harnesses) {
	const image = h.container?.image;
	const measured = image ? await probe(image) : { payloadMb: null, packages: null };
	rows.push({
		id: h.id,
		label: h.label,
		enabled: h.enabled !== false,
		image: image ?? null,
		containerized: Boolean(image),
		payloadMb: measured.payloadMb,
		packages: measured.packages,
		shape: measured.packages === null ? null : measured.packages > 0 ? "tree" : "bundled",
	});
}

if (asJson) {
	console.log(JSON.stringify(rows, null, 1));
} else {
	const pad = (s: string, n: number) => s.padEnd(n);
	console.log(`${pad("harness", 22)}${pad("payload", 10)}${pad("packages", 10)}${pad("shape", 10)}enabled`);
	for (const r of rows) {
		console.log(
			pad(String(r.id), 22) +
				pad(r.payloadMb === null ? "—" : `${r.payloadMb} MB`, 10) +
				pad(r.packages === null ? "—" : String(r.packages), 10) +
				pad(String(r.shape ?? "—"), 10) +
				String(r.enabled),
		);
	}
}
