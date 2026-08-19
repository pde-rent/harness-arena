// Deterministic answer comparator for research tasks.
//   bun lib/check-answer.ts <actual.json> <expected.json>
// Exit 0 = match, 1 = mismatch (prints the first differences).
//
// Normalisation applied to BOTH sides so superficial variation does not matter:
//   - object keys ignored for order
//   - arrays are order-insensitive (sorted after normalisation)
//   - strings: trimmed, internal whitespace collapsed, lowercased,
//     surrounding "./" stripped from path-looking values, "\" -> "/"
//   - numbers compared exactly; numeric strings compared as numbers
// Everything else is strict: missing keys, extra keys, wrong identifiers all fail.

type J = unknown;

function normStr(s: string): string {
  let v = s.trim().replace(/\s+/g, " ").replace(/\\/g, "/");
  v = v.replace(/^\.\//, "");
  return v.toLowerCase();
}

// Key names listed in expected.json under "$ordered" keep array order significant.
let ORDERED: Set<string> = new Set();

function norm(v: J, key = ""): J {
  if (typeof v === "string") {
    const n = normStr(v);
    if (/^-?\d+(\.\d+)?$/.test(n)) return Number(n);
    return n;
  }
  if (Array.isArray(v)) {
    const items = v.map((x) => norm(x));
    if (!ORDERED.has(key)) {
      items.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
    }
    return items;
  }
  if (v && typeof v === "object") {
    const out: Record<string, J> = {};
    for (const k of Object.keys(v as Record<string, J>).sort()) {
      const nk = normStr(k);
      out[nk] = norm((v as Record<string, J>)[k], nk);
    }
    return out;
  }
  return v;
}

function diff(a: J, b: J, path: string, out: string[]): void {
  if (out.length >= 8) return;
  const ta = Array.isArray(a) ? "array" : a === null ? "null" : typeof a;
  const tb = Array.isArray(b) ? "array" : b === null ? "null" : typeof b;
  if (ta !== tb) {
    out.push(`${path || "<root>"}: expected ${tb} ${JSON.stringify(b)}, got ${ta} ${JSON.stringify(a)}`);
    return;
  }
  if (ta === "array") {
    const aa = a as J[], bb = b as J[];
    if (aa.length !== bb.length) {
      out.push(`${path}: expected ${bb.length} entries ${JSON.stringify(bb)}, got ${aa.length} ${JSON.stringify(aa)}`);
      return;
    }
    aa.forEach((x, i) => diff(x, bb[i], `${path}[${i}]`, out));
    return;
  }
  if (ta === "object") {
    const ao = a as Record<string, J>, bo = b as Record<string, J>;
    for (const k of Object.keys(bo)) {
      if (!(k in ao)) { out.push(`${path}.${k}: missing`); continue; }
      diff(ao[k], bo[k], `${path}.${k}`, out);
    }
    for (const k of Object.keys(ao)) {
      if (!(k in bo)) out.push(`${path}.${k}: unexpected key`);
    }
    return;
  }
  if (a !== b) out.push(`${path || "<root>"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const [actualPath, expectedPath] = process.argv.slice(2);
if (!actualPath || !expectedPath) {
  console.error("usage: bun check-answer.ts <actual.json> <expected.json>");
  process.exit(2);
}

let actual: J, expected: J;
try {
  actual = JSON.parse(await Bun.file(actualPath).text());
} catch (e) {
  console.error(`answer file is missing or not valid JSON: ${actualPath}`);
  process.exit(1);
}
expected = JSON.parse(await Bun.file(expectedPath).text());

if (expected && typeof expected === "object" && "$ordered" in (expected as Record<string, J>)) {
  const o = (expected as Record<string, J>)["$ordered"] as string[];
  ORDERED = new Set(o.map(normStr));
  delete (expected as Record<string, J>)["$ordered"];
}

const problems: string[] = [];
diff(norm(actual), norm(expected), "", problems);
if (problems.length) {
  console.error("answer mismatch:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log("answer matches");
