// Counts non-blank, non-comment-only lines across every .ts file in a directory tree.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function isCode(line: string): boolean {
  const t = line.trim();
  if (t.length === 0) return false;
  if (t.startsWith("//")) return false;
  if (t.startsWith("/*") || t.startsWith("*/") || t.startsWith("*")) return false;
  return true;
}

const root = process.argv[2];
if (!root) {
  console.error("usage: loc.ts <dir>");
  process.exit(2);
}
let total = 0;
for (const f of files(root).sort()) {
  const n = readFileSync(f, "utf8").split("\n").filter(isCode).length;
  total += n;
  if (process.env.LOC_VERBOSE) console.error(`${n}\t${f}`);
}
console.log(String(total));
