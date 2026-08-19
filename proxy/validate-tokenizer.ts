// Differential test: our zero-dep BPE (tokenizer.ts) vs HuggingFace transformers.js, on real
// harness traffic + adversarial strings. Reference-only — the proxy never imports transformers.
//   bun add @huggingface/transformers   # dev-only
//   bun run validate-tokenizer.ts [extra-corpus-file ...]
import { loadTokenizer } from "./tokenizer";
import { PreTrainedTokenizer } from "./node_modules/@huggingface/transformers/dist/transformers.web.js";

const ours = loadTokenizer();
const dir = process.env.BENCH_TOKENIZER_DIR || "./tokenizer";
const ref = new PreTrainedTokenizer(
  JSON.parse(await Bun.file(`${dir}/tokenizer.json`).text()),
  JSON.parse(await Bun.file(`${dir}/tokenizer_config.json`).text()),
);

const cases: string[] = [
  "", "hello", " hello", "hello ", "Hello, world!", "ping", "\n", "\n\n\n", "   ",
  "  def foo(x):\n\treturn x+1\n", "日本語のテスト 123456", "1234567890 42 007",
  "<｜begin▁of▁sentence｜>hi<｜end▁of▁sentence｜>", "emoji 🙂🇫🇷 done", "café naïve résumé",
  "a".repeat(500), "https://example.com/a/b?c=d&e=%20f", '{"a":1,"b":[true,null,"x"]}',
  "```ts\nconst x: number = 1;\n```", "-- ~!@#$%^&*()_+`[]\\{}|;':\",./<>?",
  "СЛОВО кириллица", "العربية نص", "​zero​width", "mixed日本語English123混合",
  "\r\n\r\n", "tab\there", "  leading double space", "trailing   ",
];
// real traffic: every string field in the proxy's own request log + any file passed in
for (const f of ["./requests.ndjson", ...process.argv.slice(2)]) {
  const t = await Bun.file(f).text().catch(() => "");
  if (!t) continue;
  for (const line of t.split("\n").filter(Boolean)) {
    cases.push(line);
    try { collectStrings(JSON.parse(line), cases); } catch {}
  }
}
function collectStrings(o: any, out: string[], depth = 0) {
  if (depth > 12) return;
  if (typeof o === "string") { if (o.length) out.push(o); return; }
  if (Array.isArray(o)) { for (const v of o) collectStrings(v, out, depth + 1); return; }
  if (o && typeof o === "object") for (const v of Object.values(o)) collectStrings(v, out, depth + 1);
}
// random byte-soup: the only way to hit merge paths a curated list never reaches
const alphabet = [..."abcdefghijklmnopqrstuvwxyzABCDEF0123456789 \n\t.,:;'\"(){}[]<>/\\-_=+*#@!?日本語éüαβγ🙂"];
let rng = 1234567;
const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let i = 0; i < 3000; i++) {
  let s = "";
  const n = 1 + Math.floor(rand() * 120);
  for (let j = 0; j < n; j++) s += alphabet[Math.floor(rand() * alphabet.length)];
  cases.push(s);
}

let fail = 0, checked = 0, toks = 0;
for (const s of cases) {
  const a = ours.encode(s);
  const b = ref.encode(s, { add_special_tokens: false }) as number[];
  checked++; toks += a.length;
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    if (fail++ < 10) {
      const at = a.findIndex((x, i) => x !== b[i]);
      console.log(`MISMATCH @${at} ${JSON.stringify(s.slice(0, 160))}\n  ours=${a.slice(Math.max(0, at - 3), at + 4)}\n  ref =${b.slice(Math.max(0, at - 3), at + 4)}`);
    }
  }
}
console.log(`${checked - fail}/${checked} strings identical (${toks.toLocaleString()} tokens), sha256=${ours.sha256.slice(0, 16)} vocab=${ours.size}`);
process.exit(fail ? 1 : 0);
