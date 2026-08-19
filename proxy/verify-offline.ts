// Proof: tokenizing needs no network. Run me with --network=none.
import { loadTokenizer } from "./tokenizer.ts";
import { segmentRequest } from "./accounting.ts";
globalThis.fetch = (() => { throw new Error("network used!"); }) as any;
const t = loadTokenizer("/work/tokenizer");
const body = { messages: [{ role: "system", content: "you are a coding agent" }, { role: "user", content: "ping" }], tools: [{ type: "function", function: { name: "bash", description: "run a command", parameters: {} } }] };
console.log("tokens('hello world') =", t.countText("hello world"));
console.log("sha256 =", t.sha256.slice(0, 16), "vocab =", t.size);
console.log("segments =", JSON.stringify(segmentRequest("openai", body)));
console.log("OFFLINE-OK");
