# Dependency elimination — `optimus-prime` coding-agent monorepo

**Question:** for every non-provider-SDK runtime dependency in `~/Work/optimus-prime`, can it be
replaced by a Bun/web primitive, inlined as a small vendored implementation, or must it be kept?
Target: ≤10 runtime deps for the product.

**Scope.** `packages/coding-agent` (23 declared), `packages/tui` (6), `packages/agent` (2).
`packages/ai` (11) is owned by another worker and is excluded — but its overlaps are noted where
they change the count.

**Evidence rule.** Every verdict carries a `path:line` or a command that was actually run.
Sizes were measured, not estimated. Anything not verified is labelled **UNVERIFIED** and is not
used to support a conclusion.

**Repo was treated as read-only.** No file in `optimus-prime` was modified. All measurement was
done from outside the tree (a symlinked `node_modules` in a scratch dir).

---

## Part 0 — Two things that change every verdict

### 0.1 The shipped runtime is Bun, and only Bun

This was assumed to be dual Node/Bun. It is not.

```
packages/coding-agent/dist/bundle/cli.js:1   #!/usr/bin/env bun
packages/coding-agent/package.json:108-110   "engines": { "bun": ">=1.3.0" }
package.json (root):                          "engines": { "bun": ">=1.3.0" }
install.sh:894-897                            refuses to install unless bun >= 1.3.0 is present
install.sh:983-1070                           installs bun for the user if missing
```

`scripts/bundle.mjs:39` sets esbuild `platform: "node"`, which is a *module-resolution* mode
(`main`/`require` conditions), not a runtime claim. The `bin` entry it produces is executed by
`bun`. The compiled binaries are `bun build --compile` (`scripts/build-binaries.sh:105-112`).

**Consequence:** `Bun.Glob`, `Bun.stripANSI`, `Bun.color`, `Bun.enableANSIColors`, native
proxy-aware `fetch`, and native TS `import()` are all available on the shipped runtime. Every
"but Node can't do that" objection is void for the CLI.

The one place this does *not* apply: `@earendil-works/pi-coding-agent`, `pi-tui` and
`pi-agent-core` are also published as npm **libraries** (`main: ./dist/index.js`, and
`packages/coding-agent/docs/sdk.md` documents in-process embedding). A library consumer could be
on Node. Replacements below are marked where they would be Bun-only and therefore confined to
CLI-side code rather than library code.

Verified against the installed toolchain (bun 1.3.11):

```
$ bun -e 'console.log(typeof Bun.stripANSI, typeof Bun.Glob, typeof Bun.color, typeof Bun.enableANSIColors)'
function function function boolean
```

### 0.2 `zod` is an undeclared runtime dependency

`@agentclientprotocol/sdk` declares zod as a **peer** dependency and ships runtime zod validators:

```
node_modules/@agentclientprotocol/sdk/package.json:81-83   "peerDependencies": { "zod": "^3.25.0 || ^4.0.0" }
$ rg '"zod"' packages/*/package.json package.json   → no hits
$ ls node_modules/zod && rg '"version"' node_modules/zod/package.json   → 3.25.76
```

Nothing in this repo declares zod. It resolves today only because Bun hoists it to the root
`node_modules` to satisfy the peer range. This is a latent install-correctness bug independent of
any elimination work: a stricter installer, a different hoisting layout, or a peer-range change
breaks `--mode acp` at runtime, not at install time. **The true external dep count is 24, not 23.**

---

## Part 1 — Measured weight

Install size is the whole resolved subtree (own files + all transitive packages, excluding
duplicates already counted). Bundle contribution is `bun build --minify --target=node` of a
single-import entry — i.e. what the dep actually costs the shipped artifact.

| dep | install (tree) | transitive pkgs | bundle (min) |
|---|---:|---:|---:|
| `koffi` | 28,076 KB | 0 | external (0) |
| `glob` | 5,734 KB | 6 | 80 KB |
| `@agentclientprotocol/sdk` | 5,167 KB | 0 (+zod undeclared) | 272 KB |
| `@mariozechner/clipboard` | 4,439 KB | 2 | external (0) |
| `cli-highlight` | 3,093 KB | 32 | 1,098 KB |
| `extract-zip` | 2,801 KB | 14 | 39 KB |
| `hosted-git-info` | 2,701 KB | 1 | 29 KB |
| `@silvia-odwyer/photon-node` | 2,213 KB | 0 | external (0) |
| `jiti` (`jiti/static`) | 1,710 KB | 0 | **1,621 KB** |
| `undici` | 1,604 KB | 0 | external (0) |
| `typebox` | 1,447 KB | 0 | 84 KB |
| `yaml` | 670 KB | 0 | 113 KB |
| `minimatch` | 610 KB | 2 | 25 KB |
| `diff` | 601 KB | 0 | 23 KB |
| `marked` | 459 KB | 0 | 41 KB |
| `file-type` | 361 KB | 9 | 69 KB |
| `mime-types` | 243 KB | 1 | 148 KB |
| `proper-lockfile` | 102 KB | 3 | 21 KB |
| `uuid` | 64 KB | 0 | 6 KB |
| `ignore` | 63 KB | 0 | 4 KB |
| `chalk` | 43 KB | 0 | 7 KB |
| `get-east-asian-width` | 14 KB | 0 | 4 KB |
| `strip-ansi` | 10 KB | 1 | <1 KB |

Baselines: `node_modules` = 381 MB, `packages/coding-agent/dist/bundle` = 13 MB.

Two entries invert the intuition:

- **`jiti` is the most expensive thing in the bundle.** The main entry is 178 KB, but the code
  imports `jiti/static` (`extensions/loader.ts:333`, `harness-reloader.ts:89`), which is 1,621 KB
  minified — a full transpiler. In the built bundle it is a dedicated 2.3 MB chunk
  (`dist/bundle/jiti-static-UCYGOAUA.js`). It is also load-bearing (§2.11).
- **`chalk` is nearly free** (43 KB / 7 KB) despite being the most-cited "obvious cut". The prize
  there is the call-site count, not the bytes.

Largest bundle chunks, for orientation:

```
$ ls -S packages/coding-agent/dist/bundle/*.js | head -4
2.3M chunk-2PZHRVIX.js
2.3M jiti-static-UCYGOAUA.js
2.0M chunk-4TC7UH2U.js
1.8M code-highlighter-3KEKSM5B.js   ← cli-highlight + highlight.js + parse5
```

---

## Part 2 — Verdicts

### 2.1 `chalk` — REPLACE (~25 LOC)

**tui: dead.** Declared at `packages/tui/package.json:41`, zero imports in `packages/tui/src`
(`rg chalk packages/tui/src` → no hits). tui emits raw `\x1b[…]` itself.

**coding-agent: 12 style getters, ~170 call sites, all of the form `chalk.X(string)`.**

| style | uses | style | uses |
|---|---:|---|---:|
| `dim` | 55 | `gray` | 2 |
| `red` | 45 | `blue` | 2 |
| `yellow` | 32 | `underline` | 1 |
| `green` | 16 | `magenta` | 1 |
| `bold` | 13 | `italic` | 1 |
| `strikethrough` | 2 | `inverse` | 1 |

Never used anywhere: `chalk.hex()`, `.rgb()`, `.bgHex()`, `.bgRgb()`, `.ansi256()`, `.level`,
`new Chalk()`, `supportsColor`, tagged templates, `.bold.red` chaining.

Heaviest consumers: `src/package-manager-cli.ts:2` (~49 sites), `src/main.ts:13` (~27 sites),
`src/cli/daemon-ps.ts:4`, `src/cli/daemon-ps-format.ts:1`, `src/cli/daemon-list-format.ts:1`,
`src/cli/public-command.ts:1`, `src/cli/daemon-stop-confirm.ts:14`, `src/core/model-resolver.ts:287`.

The surprise is `src/modes/interactive/theme/theme.ts` — assumed to be the main consumer, it has
**6 call sites** (`:531,535,539,543,547,1307`), all attribute styles. Every colour there is
already hand-rolled truecolor/256 (`hexToRgb`, `\x1b[38;2;r;g;bm`, per-channel resets
`\x1b[39m`/`\x1b[49m`, `rgbTo256` from pi-tui). chalk is not doing the theming.

Two constraints an inline must honour:
1. `main.ts:151` and `main.ts:1066` assign styles as first-class values
   (`const color = cond ? chalk.red : chalk.yellow`) — the replacement must be a function map.
2. `main.ts:1375` nests (`chalk.dim(\`…${chalk.gray(…)}\`)`) — the outer style must re-open after
   the inner close code, which is chalk's one non-obvious behaviour and ~3 lines to reproduce.

Enable/disable gate: `Bun.enableANSIColors` (already honours `NO_COLOR`/`FORCE_COLOR`/TTY).

**Verdict: REPLACE.** ~25 LOC. Delete from tui outright. Risk: low, but 170 mechanical edits —
do it with a codemod, not by hand.

### 2.2 `strip-ansi` — REPLACE (0 LOC)

4 src sites, all default import, all `stripAnsi(str)` single-arg:
`src/core/bash-executor.ts:13` (used `:70`), `src/modes/interactive/components/collapsible-error.ts:2`
(`:15`), `src/modes/interactive/components/bash-execution.ts:2` (`:73`),
`src/core/tools/render-utils.ts:4` (`:41`).

**The repo already has a better one.** `packages/tui/src/utils.ts:904` implements `stripAnsi`
handling CSI/OSC/DCS/APC, already consumed at `markdown.ts:913,934`, `fullscreen.ts:331,531,551,607`,
`tui.ts:1264,1267`. `Bun.stripANSI()` is also native.

**Verdict: REPLACE.** Zero new code — import the in-repo function (works on Node too) or use
`Bun.stripANSI`. 34 test files also import it; a re-export shim keeps them green.

### 2.3 `uuid` — REPLACE (0 LOC)

One site: `src/core/session-manager.ts:20` `import { v7 as uuidv7 }`, used once at `:279` in
`createSessionId()`.

**v7's time-ordering is not relied on.** Every ordering path sorts on filesystem mtime or an
explicit timestamp field, never on the id: `session-manager.ts:722,764` (`b.mtime - a.mtime`),
`:2075,:2082` (`b.modified - a.modified`), `:1818` (`entry.timestamp`). No sort/compare on session
ids anywhere. Ids are opaque filenames (`${sessionId}.jsonl`, `:282`) behind a 100-attempt
collision-retry loop with an `existsSync` check — the code does not even trust uniqueness.

**Verdict: REPLACE** with `crypto.randomUUID()`. Nothing observes the version or embedded time.

### 2.4 `glob` — REPLACE (1 line)

One site: `src/core/package-manager.ts:27`, call at `:2209`:

```ts
globSync(entry, { cwd: root, absolute: true, dot: false, nodir: false })
```

Gated by `hasGlobPattern(entry)` at `:406` (`s.includes("*") || s.includes("?")`), so literal
paths never reach it. Result is `.map(resolve)`.

Direct equivalent: `new Bun.Glob(entry).scanSync({ cwd: root, absolute: true, dot: false, onlyFiles: false })`
(`nodir: false` ≡ `onlyFiles: false`). Bun.Glob supports `**`, braces, extglob.

**Verdict: REPLACE.** 5,734 KB and 6 transitive packages for one call. Best weight-per-risk in the
whole audit. Bun-only, but the call site is CLI-side package installation, not library API.

### 2.5 `minimatch` — REPLACE (~10 LOC), semantics checked

Two consumers, and they differ — this is where "check every call site" paid off.

**`src/core/model-resolver.ts:8`**, call at `:281`:
```ts
minimatch(fullId, globPattern, { nocase: true }) || minimatch(m.id, globPattern, { nocase: true })
```
Gated at `:266` on `pattern.includes("*") || includes("?") || includes("[")`. Real patterns are
model selectors (`*sonnet*`, `anthropic/*`). **`nocase: true` is the one non-default option, and
`Bun.Glob` has no `nocase`.** Model ids are ASCII, so pre-folding both sides with `toLowerCase()`
is exact. Note the double match against `fullId` and `m.id` — that already compensates for `*` not
crossing `/`, so the `*` vs `**` distinction is preserved by Bun.Glob's identical rule.

**`src/core/package-manager.ts:29`**, calls at `:780,781,782,788,789,790` — all
`minimatch(x, normalizedPattern)` with **no options object**:
```ts
minimatch(rel, p) || minimatch(name, p) || minimatch(filePathPosix, p)
```
Negation is *not* minimatch's job here: leading `!`/`+`/`-` sigils are stripped by the caller in
`applyPatterns` (`:826-828`). Paths are pre-normalised to POSIX by `toPosixPath`. Dotfiles are
excluded earlier by explicit `entry.name.startsWith(".")` checks, so the `dot` default is
irrelevant. `**` does appear in user manifests — Bun.Glob handles it.

**Verdict: REPLACE** with `new Bun.Glob(p).match(x)` plus a `toLowerCase()` fold at the one
`nocase` site. ~10 LOC. Risk: low-medium — the `nocase` fold is the only semantic edit and it is
provably safe for ASCII model ids. Add a case-sensitivity test.

### 2.6 `file-type` — INLINE (~30 LOC)

One site: `src/utils/mime.ts:2`, call at `:18`. Only `.mime` is read.

```
src/utils/mime.ts:4    IMAGE_MIME_TYPES = new Set(["image/jpeg","image/png","image/gif","image/webp"])
src/utils/mime.ts:22   if (!IMAGE_MIME_TYPES.has(fileType.mime)) return null;
```

A library that sniffs ~200 formats is used to answer a 4-way question, and every other answer is
discarded. The sniff window is 4100 bytes; the four signatures need ≤12 (`FFD8FF`, `\x89PNG`,
`GIF8`, `RIFF….WEBP`).

Consumers: `src/cli/file-processor.ts:7,38`; `src/core/bun-repl/tool.ts:4` imports only the Set.
`skills/attach-image/SKILL.md:25` already duplicates the list independently.

**Trust boundary check:** this is content-sniffing of a user-supplied file, but the function is
allow-list shaped — it returns `null` for anything it does not positively recognise. A 4-signature
inline is strictly *more* conservative than the library, not less. Safe.

**Verdict: INLINE.** ~30 LOC. Removes 361 KB and 9 transitive packages.

### 2.7 `extract-zip` — REPLACE (~5 LOC)

One site: `src/utils/tools-manager.ts:3`, call at `:233` — `await extractZip(archivePath, { dir: extractDir })`.

Extracts downloaded release archives for `fd` and `rg` from hardcoded GitHub release URLs
(`:196`). Only the **Windows** assets are `.zip` (`*-pc-windows-msvc.zip`); darwin/linux are
`.tar.gz` and are already extracted by shelling out — `spawnSync("tar", ["xzf", …])` at `:225`.
So this is a Windows-only branch duplicating a mechanism the file already uses.

Windows is a real target (`scripts/build-binaries.sh:48,100,109-110` → `pi.exe`). Windows 10+
ships bsdtar as `tar.exe` in System32 and it reads `.zip`, so `tar xf` collapses both branches.

**Trust boundary check:** remote archive extraction, so zip-slip matters. Mitigations already in
place: https-only hardcoded GitHub URL; post-extraction the code only ever selects a file named
`fd.exe`/`rg.exe` (`findBinaryRecursively`, `:158`) and runs `--version` verification before
keeping it. bsdtar strips `..` components. Do **not** hand-roll a zip reader — shell to `tar`.

**Verdict: REPLACE** with the existing tar path. 2,801 KB and 14 transitive packages.
Risk: medium-low, and entirely Windows-shaped — needs a Windows CI check, not a code review.

### 2.8 `hosted-git-info` — REPLACE (~30 LOC)

Two sites, `src/utils/git.ts:152` and `:178`, both `hostedGitInfo.fromUrl(candidate)`. Only four
fields are read: `.domain`, `.user`, `.project`, `.committish`. None of `.browse()`, `.file()`,
`.https()`, `.docs()`, `.ssh()`, `.tarball()` — the URL-template machinery that is the package's
actual reason to exist — is touched.

It is not producing browsable URLs. It is a git *source* parser for the package/skill installer
(`GitSource`, `git.ts:9-22`). And the file already contains hand-rolled equivalents:
`splitRef()` at `:24` and `parseGenericGitUrl()` at `:78`, the latter being the fallback when
`fromUrl` returns null (`:193`). `hosted-git-info` adds only shorthand recognition
(`github:u/p`, `gitlab:u/p`, `bitbucket:`, `gist:`, bare `u/p`) for four hosts.

The 2.9 MB is not the library:
```
$ du -sh node_modules/hosted-git-info/lib node_modules/hosted-git-info/node_modules
 32K  .../lib
2.9M  .../node_modules      ← one nested lru-cache, memoising a few installer URLs
```

**Verdict: REPLACE** — extend the existing `parseGenericGitUrl` with a 4-entry shorthand table.
~30 LOC. Risk: low; the fallback parser is already the one handling every explicit-scheme and
scp-like form.

### 2.9 `mime-types` + `@types/mime-types` — DELETE (unused)

Declared at `packages/tui/package.json:39,43`. **Zero imports of `mime-types` (or `mime`) in
`packages/tui/src` or `packages/coding-agent/src`.**

The `mimeType` identifiers in the tree are plain strings on the app's own types:
`packages/tui/src/terminal-image.ts:351` compares hardcoded literals, `:417` interpolates;
`packages/tui/src/components/image.ts:41,53,59,62,88,121,125` passes the string through.
coding-agent sniffs from content instead (`src/utils/mime.ts:22,26`).

Also note `@types/mime-types` is a types-only package sitting in `dependencies`, not
`devDependencies` — it ships to every consumer for nothing.

**Verdict: DELETE both.** Zero code to write. (If ever needed: `Bun.file(path).type`.)

### 2.10 `marked` (coding-agent declaration) — DELETE (phantom)

```
$ rg '"marked"' packages/*/package.json
packages/tui/package.json:42
packages/coding-agent/package.json:64
$ rg 'from "marked"' packages/coding-agent/src   → no hits
```

`packages/coding-agent` declares marked and never imports it; it reaches marked's behaviour
through `pi-tui`. The declaration is removable with no code change. **The package itself stays**
(see 2.14).

### 2.11 `jiti` — KEEP (load-bearing; the specific blocker is cache eviction + virtual modules)

This is the one the brief flagged, and the answer is: **native `import()` cannot do it.**
The reason is *not* the one that first suggests itself.

What is actually used (`src/core/extensions/loader.ts:333-346`):

```ts
createJiti(import.meta.url, {
  moduleCache: false,
  ...(isBunBinary || isBundledCli
    ? { virtualModules: VIRTUAL_MODULES, tryNative: false }
    : { alias: getAliases() }),
})
await jiti.import(extensionPath, { default: true })
```

Feature set: `moduleCache: false`, `virtualModules`, `tryNative: false`, `alias`, and the
`{ default: true }` interop option. Three distinct jobs:

1. **TypeScript from disk.** Extensions are `~/.prime/agent/extensions/*.ts`, including multi-file
   directories with `index.ts` plus sibling `.ts` helpers (`docs/extensions.md:116-118,225-235`;
   `:178` "Extensions are loaded via jiti, so TypeScript works without compilation").
   *Bun can do this natively.* The Node-can't-transpile objection is void (§0.1).
2. **Bare-specifier → already-loaded in-memory namespace.** `src/core/extensions/bundled-modules.ts:22-40`
   maps 16 bare specifiers (`@earendil-works/pi-*`, legacy `@mariozechner/pi-*`, `typebox`,
   `typebox/compile`, `typebox/value`, `@sinclair/typebox*`) to namespace objects that are
   *already imported into the host process*. The comment at `loader.ts:336-338` states why: a
   file-path alias "would load a second, divergent copy of each package". Inside a
   `bun build --compile` single-file binary there is no path to alias *to* — the module only
   exists as a live namespace object. `Bun.plugin` can resolve specifiers but the compiled-binary
   case has no on-disk target, and `tryNative: false` forces this to apply to the extension's
   whole transitive graph, not just its entry.
3. **Cache eviction for `/reload:harness`.** `src/core/slash-commands.ts:225` → dispatch
   `src/modes/interactive/interactive-mode.ts:4762` → guard at `:8801-8813` (refuses while
   streaming/compacting) → `src/core/harness-reloader.ts:89-97`, which builds a fresh
   `createJiti(import.meta.url, { moduleCache: false })` and re-imports each of the 6 modules in
   `HARNESS_MODULE_MANIFEST` (`.ts` in dev, `.js` fallback at `:73-81`). The property is pinned by
   `test/harness-reloader.test.ts:39-55`.

**Can native `import()` evict cache the same way? No.** The ESM registry is not evictable in Bun or
Node. The standard workaround — a `?t=` cache-busting query — busts only the module you name; the
extension's *transitive* imports keep their cached instances, and extensions are multi-file by
design. You would get a partially-reloaded graph, which is worse than not reloading.

A `Bun.plugin` loader that rewrites every specifier to carry a generation token *would* cascade
eviction and could also serve virtual modules. That is roughly 150-250 LOC of bespoke module
resolution, Bun-only, replacing a maintained package — for the one subsystem where a subtle bug
manifests as "the harness silently kept running old code". The blast radius of getting it wrong is
the entire extension API.

Collateral evidence of how load-bearing the module-realm behaviour is: `interactive-mode.ts:3902`
duck-types instead of `instanceof` because identity fails across jiti realms; `theme.ts:823-827`
shares theme through `globalThis` for the same reason; `components/dynamic-border.ts:7-8`
documents the same hazard.

**Verdict: KEEP.** This is the most expensive keep in the audit (1,621 KB minified, a 2.3 MB
bundle chunk) and it is still the right call. If bytes matter more than the risk, the honest
lever is deleting the *feature* (`/reload:harness` and TS extensions), not reimplementing jiti.

### 2.12 `undici` — REPLACE (delete; verified empirically)

One src site, `src/cli-main.ts:31-37`:

```ts
const [{ EnvHttpProxyAgent, setGlobalDispatcher }, { main }] = await Promise.all([
  import("undici"), import("./main.js"),
]);
// undici's 300s body/headers timeouts abort long local-LLM SSE stalls; provider
// SDKs enforce their own deadlines via retry.provider.timeoutMs.
setGlobalDispatcher(new EnvHttpProxyAgent({ bodyTimeout: 0, headersTimeout: 0 }));
```

Surface: exactly `EnvHttpProxyAgent` + `setGlobalDispatcher`. Not `Agent`, not `ProxyAgent`, not
`fetch`, not a custom dispatcher. Two jobs: (a) honour `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`,
(b) disable undici's 300s body/headers timeouts.

`packages/ai/package.json:84` also declares undici but `rg undici packages/ai/src` is clean —
declared-only, no code coupling.

**On Bun this call is inert.** Bun's global `fetch` is a native implementation, not undici, so
undici's global dispatcher never touches it:

```
$ bun -e 'const u=await import("undici"); console.log(u.fetch === globalThis.fetch)'
false
```

Nothing imports undici's own `fetch`, so `setGlobalDispatcher` currently affects zero requests on
the shipped runtime. Both jobs are already covered natively:

- Proxy env — **verified**, not assumed:
  ```
  $ HTTPS_PROXY=http://127.0.0.1:9 bun -e 'await fetch("https://example.com")'
  ERR: Error Unable to connect. Is the computer able to access the url?
  ```
  Bun routed through the bogus proxy instead of reaching the host. Env proxying works.
- The 300s timeout — is an undici default. Bun's fetch has no such body timeout, so there is
  nothing to disable. The provider deadlines the comment refers to (`retry.provider.timeoutMs`)
  are enforced independently.

**Verdict: REPLACE (delete outright).** 1,604 KB. Risk: low *given the Bun-only runtime*. The one
thing to confirm before deleting: `scripts/bundle.mjs:43` externalises undici, so it is resolved
from `node_modules` at runtime — removing the dep and leaving the import would be a hard crash,
so delete the import in the same change.

### 2.13 `typebox` — KEEP (public API **and** a real trust boundary)

The brief asked not to churn a public API for dep count. Two independent reasons make this moot.

**It performs real runtime validation on LLM output.** `packages/ai/src/utils/validation.ts:252`
`Compile(schema)`, `:294` `Value.Convert(tool.parameters, args)`, `:198,306,311` `validator.Check(…)`
— invoked from `packages/agent/src/agent-loop.ts:790` on every model-produced tool call. It also
validates user-authored JSON: `src/modes/interactive/theme/theme.ts:17-18,117-124,688-703`
(`Compile(ThemeJsonSchema)`, `.Check()`, `.Errors()`), and
`src/core/model-registry.ts:27-29,209-216,605-617` for models config. **Never cut validation at a
trust boundary** — this is exactly that.

**It is the declared type of the public extension contract.** `src/core/extensions/types.ts:42,410,470,1001`
type `ToolDefinition`/`defineTool`/`registerTool` on `TSchema`; `docs/extensions.md:1234-1240`
instructs authors to `import { Type } from "typebox"`. And the loader goes out of its way to make
extension-side typebox the *same instance* as the host's:

```
src/core/extensions/loader.ts:43-45,73-78   require.resolve("typebox"|"typebox/compile"|"typebox/value")
                                            aliased, plus @sinclair/typebox compat aliases
src/core/extensions/bundled-modules.ts:15-28  same specifiers → in-process namespaces
```

Dropping it from coding-agent's `dependencies` would also break `require.resolve("typebox")` at
`loader.ts:43` unless you rely on hoisting from `packages/ai` — the exact fragility already
biting `zod` (§0.2). And `packages/agent:21` and `packages/ai:79` need it regardless.

**Verdict: KEEP.**

### 2.14 `marked` (the package, in tui) — KEEP

`packages/tui/src/components/markdown.ts:1` is the only TS importer. It is not a shallow use:

- `class StrictStrikethroughTokenizer extends Tokenizer` overriding `del()` (`:16-31`), reaching
  into `this.lexer.inlineTokens()`.
- Two `TokenizerExtension`s with `start()` hints — `blockMathExtension`, `inlineMathExtension` (`:53-110`).
- Two separate `Marked` instances (`:112-124`) because registering the math extensions measurably
  slows lexing; `pickMarkdownParser()` chooses per text.
- Token coverage is near-full CommonMark+GFM: block cases at `:417-545` (`heading`, `paragraph`,
  `code`, `list`, `table`, `blockquote` recursive, `hr`, `html`, `space`), inline at `:566-635`
  (`text`, `strong`, `em`, `codespan`, `link`, `br`, `del`, `html`). Nested lists recurse
  (`:655-712`). Tables are load-bearing — they feed selection metadata
  (`extractTableCellSelectionRegions`, `markTableCell`, `markTableStart/End`).
- It relies on marked being **streaming-tolerant**: partial documents are re-lexed on every token
  append, and the math extensions degrade to plain text on unterminated delimiters mid-stream.

Honest inline cost: a block+inline CommonMark lexer with nested lists, GFM tables, fenced and
indented code, blockquote nesting, autolinks, the CommonMark emphasis delimiter-stack algorithm
(~200 LOC on its own), raw HTML passthrough, plus a tokenizer-override hook because this code
needs one — **1,500-2,500 LOC**, permanently subtly wrong on adversarial LLM output. Existing test
surface to keep green: `packages/tui/test/markdown.test.ts` (1,280 lines) +
`markdown-latex.test.ts` (212 lines) + a streaming bench.

**Verdict: KEEP.** 459 KB / 41 KB bundle for the correct tool. This is the "a real markdown parser
is not trivial to inline" case the brief anticipated, and it is true. Only the phantom
coding-agent declaration goes (§2.10).

### 2.15 `cli-highlight` — REPLACE with direct `highlight.js` (~90 LOC adapter)

Re-exported at `src/modes/interactive/theme/code-highlighter.ts:7` — the wrapper exists only to
make hljs's ~350 ms import lazy. Four consumers, all in one file: `theme.ts:885` (dynamic import),
`:1202` `supportsLanguage(lang)`, `:1215` `highlight(code, opts)`, and the same pair again at
`:1314,1327` inside `highlightCode`.

Options passed (`theme.ts:1210-1214`): `{ language, ignoreIllegals: true, theme: getCliHighlightTheme(theme) }`.
**Auto-detection is explicitly disabled** — if `supportsLanguage(lang)` is false the code renders
unhighlighted, because hljs auto-detect misidentifies prose. The theme is 16 hljs scopes
(keyword, built_in, literal, number, string, comment, function, title, class, type, attr,
variable, params, operator, punctuation). So cli-highlight's entire job is: run hljs, walk the
token tree, wrap 16 scope names in ANSI.

What it drags in (`node_modules/cli-highlight/package.json`, `bun.lock:535,987-1047`):
`chalk@^4` (a second chalk major), `highlight.js@^10.7.1` (1,670 KB, pinned old), `mz@^2` (51 KB),
`parse5@^5` (323 KB), `parse5-htmlparser2-tree-adapter@^6`, `yargs@^16` (639 KB + 19 transitives).
**You are shipping yargs and parse5 to colour terminal code.** 32 transitive packages; 1,098 KB
minified; the largest lazy chunk in the bundle at 1.8 MB.

And there is genuine duplication:
```
packages/coding-agent/src/core/export-html/vendor/highlight.min.js   121,727 bytes, hljs 10.7.x
packages/coding-agent/src/core/export-html/vendor/marked.min.js       39,055 bytes
```
consumed at `src/core/export-html/index.ts:145` and `export-html/template.js:764,773,1459`. The
repo already carries a self-contained hljs bundle *and* separately installs a 1.7 MB npm hljs of
the same major behind cli-highlight.

**Verdict: REPLACE** — depend on `highlight.js` directly and inline the ~90 LOC ANSI adapter
(map `<span class="hljs-keyword">` → the 16 theme fns, or use hljs's `_emitter`/TokenTree for a
cleaner walk); `supportsLanguage` becomes `hljs.getLanguage(l) !== undefined`.

**Be honest about what this buys:** it is *count-neutral* (−`cli-highlight`, +`highlight.js`). The
win is 32 transitive packages, ~1.4 MB install, and the option to build a language-subset hljs —
`getLanguageFromPath` in `theme.ts` maps 58 extensions to ~45 languages, of which ~15 carry
essentially all traffic. That subset build is where the 1.8 MB chunk actually shrinks.

### 2.16 `yaml` — KEEP (this is the trap)

One import, one call: `src/utils/frontmatter.ts:1` `import { parse }`, used at `:33`. Delimiter
extraction is hand-rolled; yaml sees only the block body. No `stringify`, no Document API, no
options. Superficially the most tempting inline target in the audit.

Consumers: `src/core/skills.ts:380` (every `SKILL.md`), `src/core/prompt-templates.ts:108`
(slash-command `.md`), `src/core/agent-session.ts:4731`,
`examples/extensions/subagent/agents.ts:52`. **And it is public API** — `src/index.ts:391`
re-exports `parseFrontmatter`/`stripFrontmatter`.

The 12 repo-owned skills are trivially flat — two unquoted `key: value` string pairs:

```
---
name: attach-image
description: Load an on-disk image (PNG, JPEG, GIF, WebP) into the model's context as a viewable attachment so the model can directly SEE it — for screenshots, diagrams, charts, photos, or scanned pages. Use this when you need to perceive an image's visual contents. Requires a vision-capable model; errors clearly otherwise.
---
```

That is the trap. Two things break the "80 lines is enough" story:

1. **The existing test file already pins non-trivial YAML.** `test/frontmatter.test.ts:25-30`
   requires `description: |` block-scalar handling yielding `"Line one\nLine two\n"` (trailing
   newline included). `:21-23` requires malformed input (`foo: [bar`) to **throw** with a message
   matching `/at line 1, column 10/` — yaml's exact error format and position, which feeds the
   user-visible diagnostics at `skills.ts:384-397`. `:5-12` covers quote stripping and hyphenated
   keys; `:43-47` comment-only frontmatter → `{}`. Also `SkillFrontmatter` (`skills.ts:73-78`) has
   a **boolean** field `disable-model-invocation`, so type coercion is in the contract.
2. **The real input set is not the 12 repo skills.** `skills.ts:257-288` recurses arbitrary
   directories looking for `SKILL.md`, authored by users and third parties following other
   harnesses' conventions — `allowed-tools:` lists, nested `model:` maps, `>`-folded descriptions,
   quoted-colon strings. A subset parser mis-reading `description: >` does not crash; it returns a
   plausible wrong string, and skill metadata routes model behaviour. Silent semantic corruption is
   the worst possible failure mode here.

Honest LOC: 80 for the happy path; **300-450** for the actual contract (block scalars with
indentation stripping, flow and block sequences, nested maps, double-quoted escapes, type
coercion, yaml-compatible error positions). That is a real YAML implementation with an unbounded
bug tail.

**Verdict: KEEP.** 670 KB, zero transitives, one function. The `frontmatter.ts` boundary is already
perfect if you ever want to swap in a smaller spec-complete parser — but do not hand-roll the
subset.

### 2.17 `diff` — INLINE (~200-250 LOC), lowest priority

Two call sites, both option-free:
- `src/core/tools/edit-diff.ts:259` — `Diff.diffLines(oldContent, newContent)`
- `src/modes/interactive/components/diff.ts:28` — `Diff.diffWords(oldContent, newContent)`

Only `part.value`, `part.added`, `part.removed` are consumed. **No patch APIs at all** —
`diffChars`, `structuredPatch`, `applyPatch`, `createTwoFilesPatch`, `createPatch`, `parsePatch`
are zero-hit repo-wide. Patch application is hand-rolled string splicing at
`edit-diff.ts:243-250`. `diffLines` is called with no `ignoreWhitespace` / `newlineIsToken`, and
the caller splits on `\n` and pops the trailing `""` itself, so it does not depend on chunk
termination. `diffWords` does depend on diff's word tokenizer grouping whitespace with adjacent
words (comment at `diff.ts:24`) and on the leading-whitespace shape of the first part (`:38-56`).

Honest cost: linear-space Myers producing `{value, added, removed}` chunks ≈ 150 LOC (a naive
O(N·M) LCS is 50 LOC but the edit tool passes whole file contents, so it must be the linear-space
variant); word-level on the same core ≈ 40-60 LOC; plus a bail-out for pathological inputs, which
`diff` v9 provides as `maxEditLength`/timeout and the TUI needs or it hangs. **~200-250 LOC + golden
tests.**

**Verdict: INLINE — but rank it last.** The saving is 601 KB install / 23 KB bundle / 0 transitive
packages: the worst weight-per-LOC ratio in the audit, on the code path whose output the user
reads on every single edit. Do it only if the dep *count* is the binding constraint. If it is done,
behavioural golden tests against current output are mandatory — "looks right" is not "is right".

### 2.18 `ignore` — KEEP

Identical shape in both consumers: `ignore()` → `.add(string[])` → `.ignores(relPosixPath)`.
`filter()` / `createFilter()` / `checkIgnore()` are never used.

- `src/core/package-manager.ts:28` — instances at `:434,486,593,630,710`; `.add()` at `:390`
  inside `addIgnoreRules()` (`:376`), reading `.gitignore`/`.ignore`/`.fdignore`
  (`IGNORE_FILE_NAMES`, `:341`); `.ignores()` at `:459,508,533,539,613,650,735` — note `:539`
  queries `` `${relPath}/` `` for directory semantics. `IgnoreMatcher` (`:343`) is threaded
  through recursion.
- `src/core/skills.ts:3` — instance `:281`, `.add()` `:65`, `.ignores()` `:304,341`.

Replacing it means reimplementing gitignore semantics: negation (`!`), anchoring (leading `/`),
directory-only (`dir/`), `**`, later-rule precedence, and the trailing-slash directory query.
`Bun.Glob` models none of the ordering or negation rules.

**Verdict: KEEP.** 63 KB, 0 transitives, 4 KB bundle — the cheapest dep in the repo and the
hardest of the "small" ones to get right. Nothing to gain.

### 2.19 `proper-lockfile` — KEEP (explicit data-loss boundary)

Nine src sites. Every one sets `stale`; every async one sets an `update` mtime heartbeat.

| site | guards | api | notable options |
|---|---|---|---|
| `src/core/auth-storage.ts:132` | auth tokens JSON (chmod 0600) | `lockSync` | `realpath:false`, manual 10× ELOCKED retry |
| `src/core/auth-storage.ts:187-197` | same | `lock` | retries `{10, factor:2, 100…10000, randomize}`, `stale:30000`, **`onCompromised`** → flag checked at `:200,204,207` |
| `src/core/settings-manager.ts:234` | global + project `settings.json` | `lockSync` | `realpath:false`, manual retry |
| `src/core/session-lease.ts:190-194` | session lease dir, lock at `${dir}.guard` | `lockSync` | `stale:5000`, 100× `Atomics.wait` |
| `src/core/cron-jobs.ts:1504-1508` | cron state files | `lockSync` | `stale:30000`, paths sorted at `:1499` to avoid deadlock |
| `src/modes/daemon/daemon-socket.ts:48-57` | daemon unix socket (skipped on win32) | `lock` | `stale`, `update`, `retries:600` |
| `src/modes/daemon/daemon-socket.ts:169-173` | same | `lockSync` | `stale`, `update`, `retries:0` |
| `src/modes/daemon/daemon-supervisor-ownership.ts:360-370` | supervisor registry | `lock` | `stale`, `update`, `retries` |
| `src/cli/daemon-update-restart.ts:329-339` | update-restart registry | `lock` | `stale`, `update`, `retries` |

Process liveness is checked in app code alongside, not by the library:
`session-lease.ts:175-184` (`isProcessAlive` + a `processStartId` PID-reuse guard),
`daemon-update-restart.ts:348+` (`process.kill(pid, 0)`).

What is guarded: OAuth/API tokens, user settings, session leases, cron state, daemon socket
ownership, supervisor generation — all read-modify-write of JSON. A torn write means lost
credentials or two daemons owning one socket. `onCompromised` at `auth-storage.ts:196-207` is the
only thing preventing a token write after another process stole the lock.

An inline would have to reproduce mkdir-based atomic locking + mtime staleness + a background
heartbeat + `onCompromised` + win32 skips ≈ 200 LOC. The brief's own rule applies verbatim:
*a hand-rolled lockfile that corrupts state is worse than a dependency.*

**Verdict: KEEP.** 102 KB, 3 transitives, no native code. Cheap insurance.

### 2.20 `get-east-asian-width` — KEEP

`packages/tui/src/utils.ts:1`, named export, codepoint API, no options (default
`ambiguousAsWide: false`). Sole consumer is `graphemeWidth()` (`:156`), the primitive behind
`visibleWidth`: `:181` base codepoint after early-returns for zero-width clusters (`:158`), emoji
(`:162` → 2) and regional indicators (`:177` → 2); `:188` additive pass over trailing
halfwidth/fullwidth forms U+FF00–U+FFEF plus a hardcoded +1 for Thai/Lao SARA AM.

No Bun or web primitive provides East Asian Width. `Intl.Segmenter` gives grapheme clusters but
not width. Inlining means vendoring a generated ~500-range Unicode table with binary search — and
this is **accessibility-adjacent**: wrong widths mean a corrupted TUI for CJK users.

**Verdict: KEEP.** 14 KB, 0 transitives, 4 KB bundle.

### 2.21 `@agentclientprotocol/sdk` — KEEP (make it optional + lazy)

Single src consumer, `src/modes/acp/acp-mode.ts`: `:5` namespace import; `:241`
`acp.ndJsonStream(rawStdoutSink(), Readable.toWeb(process.stdin))`; `:243-244` `acp.agent({name})`;
`:246` `acp.PROTOCOL_VERSION`; `:297,346` `acp.methods.client.session.update`; `:398` `.connect(stream)`;
`:403` `await handle.closed`; plus `.onRequest("initialize"|"session/new"|…)` chained off `agent()`.
Four test files import it, including `test/suite/acp-mode.test.ts:1,21` which explicitly exercises
"a REAL @agentclientprotocol/sdk client".

**Runtime, not types.** `dist/acp.js` ships NDJSON framing over WHATWG streams, a JSON-RPC-over-stdio
peer with request routing and `.connect()`/`.closed` lifecycle, generated zod validators
(`schema/zod.gen.js`) and runtime union guards (`guards.gen.js`).

Entered by CLI flag only: `src/cli/args.ts:8` (`Mode = "text"|"json"|"rpc"|"acp"|"daemon"`),
validation `:104`, help `src/cli/command-registry.ts:168`, dispatch
`src/main.ts:176-177,1558-1559,1637-1639`. It exists for ACP-speaking editors (Zed et al.).

Why 5.2 MB: `dist/v2` 1.8 MB (unused experimental v2), `dist/schema` 1.1 MB (generated zod),
`dist/acp.test.js` + map 376 KB, `http-stream.test.js` + map 112 KB, `dist/examples` 108 KB,
`server.test.js` 40 KB, `test-support` 44 KB. **~2.4 MB is shipped tests, examples and dead v2.**
The actually-used v1 path is `dist/acp.js` at 72 KB. It is *not* in `bundle.mjs:43`'s external
list, so it is bundled and dead-code-eliminated → 272 KB minified. The 5.2 MB is an install-disk
cost, not a shipped cost.

Reimplementing = NDJSON JSON-RPC framing + protocol constants, ~200 LOC, but you would own drift
against a spec you do not control, and the zod schema validation is a trust boundary against an
external editor process.

**Verdict: KEEP.** Two cheap actions instead: **declare `zod` explicitly** (§0.2 — this is a real
bug), and move the sdk to `optionalDependencies` with a lazy `await import()` inside the
`appMode === "acp"` branch, so it stops being a hard dep of every install.

### 2.22 `koffi` — KEEP (already optional, already externalised)

`packages/tui/src/terminal.ts:365` `cjsRequire("koffi")`; `:366` `koffi.load("kernel32.dll")`;
`:367-369` three `k32.func(…)` declarations (`GetStdHandle`, `GetConsoleMode`, `SetConsoleMode`);
`:373-376` `GetStdHandle(-10)` → get mode → set `mode | 0x0200`
(`ENABLE_VIRTUAL_TERMINAL_INPUT`). Guarded by `if (process.platform !== "win32") return;` at `:360`.

Capability: on Windows, makes the console emit VT sequences for modified keys. Without it,
`Shift+Tab` arrives as plain `\t` (libuv's `ReadConsoleInputW` drops modifier state) — reverse-tab
cycling and other modified bindings degrade. Documented at `packages/tui/CHANGELOG.md:478,488`.

**A fallback already exists**: the whole block is inside `try/catch {}` with an empty handler
(`:377-379`, comment: "koffi not available — Shift+Tab won't be distinguishable from Tab"), and it
is already in `optionalDependencies` (`packages/tui/package.json:46`).

The 28 MB is 18 platform prebuilds and is **a dev-machine cost only**: `scripts/build-binaries.sh:105-112`
passes `--external koffi` to every `bun build --compile`, `:133-138` hand-copies only
`build/koffi/win32_x64/koffi.node` into the Windows output, and `packages/coding-agent/scripts/bundle.mjs:43`
externalises it. **Zero bytes reach non-Windows users.**

**Verdict: KEEP.** The honest alternative is dropping Shift+Tab on Windows, which is an
accessibility/usability regression for a platform you ship binaries for. Not worth it.

### 2.23 `@silvia-odwyer/photon-node` — KEEP

- `src/utils/photon.ts` — loader; `:25` type re-export, `:32-33` module cache, `:116` `loadPhoton()`,
  `:128` dynamic import. Most of the file is a workaround: photon's CJS entry does
  `fs.readFileSync(__dirname + '/photon_rs_bg.wasm')`, which breaks inside a Bun single-file
  binary, so `patchPhotonWasmRead()` monkey-patches `fs.readFileSync` around the import and
  restores it (`:100-110`).
- `src/utils/image-resize.ts` — `PhotonImage.new_from_byteslice`, `get_width/height`, `get_bytes`,
  `get_bytes_jpeg(q)`, `photon.resize(img,w,h,SamplingFilter.Lanczos3)`, `free()`.
- `src/utils/exif-orientation.ts` — `fliph`, `flipv`, `new PhotonImage(bytes,w,h)`,
  `get_raw_pixels()`. **All EXIF parsing (TIFF/IFD walk, JPEG APP1, WebP RIFF chunks) is already
  hand-written pure JS**; photon does only the pixel transforms.
- `src/utils/clipboard-image.ts:56-70` — `convertToPng()` normalises BMP (from WSLg) → PNG.
- `skills/attach-image/skill.js:159,171,180,190,212,236,240,243,258,261,274,340-341` — a duplicate
  implementation for the skill.

Consumers of the resize path: `src/cli/file-processor.ts:6,48` (`-f image.png`) and
`src/modes/interactive/interactive-mode.ts:135,4267,4280` (clipboard paste).

Why resizing is required, stated in-code: `image-resize.ts:23` — "4.5MB of base64 payload.
Provides headroom below Anthropic's 5MB limit"; a Retina screenshot exceeds the per-image byte cap
outright. The 2000×2000 cap (`DEFAULT_OPTIONS`, `:25-30`) bounds token cost. The quality ladder
(`[80,85,70,55,40]`, then 0.75× dimension decay) exists because failure means the attachment is
dropped entirely (`file-processor.ts:49`, "[Image omitted: could not be resized…]"). And
`formatDimensionNote()` tells the model the scale factor so click coordinates still map back —
which only works because *we* control the resize.

No Bun or Node image codec exists. OS-level options (`sips`, ImageMagick, `System.Drawing`) are not
universally installed and would need three code paths plus temp files — strictly worse than one
portable 2.2 MB wasm blob copied once per platform (`build-binaries.sh:123`).

**Verdict: KEEP.** Two cleanups instead: `src/utils/image-convert.ts` is **dead code** (only
consumer is `test/image-processing.test.ts:2`, no src importer), and
`skills/attach-image/skill.js` duplicates `image-resize.ts` + `exif-orientation.ts`.

### 2.24 `@mariozechner/clipboard` — KEEP (already optional; shrink its surface)

`src/utils/clipboard-native.ts:16` `require("@mariozechner/clipboard")` inside `try/catch`, behind
`createRequire`, gated at `:13-14` on `!TERMUX_VERSION && hasDisplay`; failure → `null`. Surface is
3 methods (`:3-7`): `setText`, `hasImage`, `getImageBinary`. In `optionalDependencies`
(`packages/coding-agent/package.json:80`); 5 platform binaries force-installed for cross-compile
(`scripts/build-binaries.sh:68-72`).

**Text: the native module is already the least-used path and can be dropped entirely.**
`src/utils/clipboard.ts:50-52` calls `setText` **only when `p !== "linux"`** — the comment at
`:41-48` explains Linux deliberately skips it because the underlying `clipboard-rs` crate is
X11-only and does not retain selection ownership, so it silently no-ops on Wayland. Existing
fallbacks: OSC 52 (`clipboard.ts:26-33` `emitOsc52`, 100 KB cap; used when remote per `:22`, or as
last resort `:117-120`; also `packages/tui/src/tui.ts:798-800`), `pbcopy` (`:69`), `clip` (`:72`),
`termux-clipboard-set` (`:78`), `wl-copy` (`:95`), `xclip`/`xsel` (`:14-17`).

**Images: this is the irreplaceable part.** `readClipboardImage()` (`clipboard-image.ts:236-282`)
tries `wl-paste --list-types` + `wl-paste --type` (`:100-122`), `xclip -t TARGETS -o` (`:190-215`),
WSL `powershell.exe` + `System.Windows.Forms.Clipboard::GetImage()` to a temp PNG (`:141-188`),
and only then the native module (`:222-232`). But `:276` routes **every non-Linux platform**
straight to the native module, and the PowerShell path is gated on `isWSL()` inside the Linux
branch. So macOS and native Windows have no image fallback:

- OSC 52 is write-only in practice — the read form is disabled by default in essentially every
  terminal, and it carries base64 *text*. It can never carry image bytes.
- `pbpaste` cannot emit image data; getting a PNG off the macOS pasteboard from a shell needs
  `osascript` gymnastics or an ObjC shim.

**Capability lost if removed:** paste-image-from-clipboard breaks on macOS and native Windows;
Linux/WSL keep working.

**Verdict: KEEP.** It is already `optionalDependencies` and already `bundle.mjs:43`-external.
Cheap improvement: drop the `setText` call at `clipboard.ts:50` (zero loss — pbcopy/clip/OSC 52
cover it), shrinking the surface to `hasImage`/`getImageBinary`.

---

## Part 3 — Verdict table

| dep | package | src call sites | install | trans. | bundle | verdict | replacement | LOC | risk |
|---|---|---|---:|---:|---:|---|---|---:|---|
| `mime-types` | tui | **0** | 243 K | 1 | — | DELETE | unused | 0 | none |
| `@types/mime-types` | tui | **0** | — | — | — | DELETE | unused; also wrong section | 0 | none |
| `chalk` | tui | **0** | — | — | — | DELETE | unused | 0 | none |
| `marked` | coding-agent | **0** | — | — | — | DELETE | phantom decl; pkg stays in tui | 0 | none |
| `undici` | coding-agent | 1 (`cli-main.ts:31`) | 1,604 K | 0 | ext | REPLACE | delete — Bun fetch proxies natively (verified), no 300s timeout | 0 | low |
| `glob` | coding-agent | 1 (`package-manager.ts:2209`) | 5,734 K | 6 | 80 K | REPLACE | `Bun.Glob().scanSync()` | ~1 | low |
| `strip-ansi` | coding-agent | 4 | 10 K | 1 | <1 K | REPLACE | `Bun.stripANSI` / `tui/src/utils.ts:904` | 0 | low |
| `uuid` | coding-agent | 1 (`session-manager.ts:279`) | 64 K | 0 | 6 K | REPLACE | `crypto.randomUUID()` | ~1 | low |
| `minimatch` | coding-agent | 8 (2 files) | 610 K | 2 | 25 K | REPLACE | `Bun.Glob().match()` + case fold | ~10 | low-med |
| `extract-zip` | coding-agent | 1 (`tools-manager.ts:233`) | 2,801 K | 14 | 39 K | REPLACE | `tar xf` (already used at `:225`) | ~5 | med (win) |
| `hosted-git-info` | coding-agent | 2 (`git.ts:152,178`) | 2,701 K | 1 | 29 K | REPLACE | extend `parseGenericGitUrl` (`git.ts:78`) | ~30 | low |
| `file-type` | coding-agent | 1 (`mime.ts:18`) | 361 K | 9 | 69 K | INLINE | 4 magic-byte checks | ~30 | low |
| `chalk` | coding-agent | ~170 | 43 K | 0 | 7 K | REPLACE | SGR map + `Bun.enableANSIColors` | ~25 | low (bulk) |
| `cli-highlight` | coding-agent | 4 (`theme.ts`) | 3,093 K | **32** | 1,098 K | REPLACE | direct `highlight.js` + ANSI adapter | ~90 | med |
| `diff` | coding-agent | 2 | 601 K | 0 | 23 K | INLINE | linear-space Myers + word tokenizer | ~250 | med-high |
| `ignore` | coding-agent | 12 (2 files) | 63 K | 0 | 4 K | **KEEP** | gitignore negation/anchoring/precedence | — | — |
| `proper-lockfile` | coding-agent | 9 | 102 K | 3 | 21 K | **KEEP** | data-loss boundary; `onCompromised` on auth tokens | — | — |
| `yaml` | coding-agent | 1 | 670 K | 0 | 113 K | **KEEP** | user-authored input; silent mis-parse | — | — |
| `typebox` | ca + agent + ai | many | 1,447 K | 0 | 84 K | **KEEP** | public extension API + LLM-output validation | — | — |
| `jiti` | coding-agent | 2 | 1,710 K | 0 | **1,621 K** | **KEEP** | no native cache eviction / virtual modules | — | — |
| `marked` | tui | 1 (deep) | 459 K | 0 | 41 K | **KEEP** | Tokenizer subclass + 2 extensions + streaming | — | — |
| `get-east-asian-width` | tui | 1 (`utils.ts:181,188`) | 14 K | 0 | 4 K | **KEEP** | no EAW primitive; a11y-adjacent | — | — |
| `koffi` | tui (opt) | 1 (`terminal.ts:365`) | 28,076 K | 0 | ext | **KEEP** | Windows VT input; already optional + external | — | — |
| `@silvia-odwyer/photon-node` | coding-agent | 4 | 2,213 K | 0 | ext | **KEEP** | no JS image codec; 5 MB API limit | — | — |
| `@mariozechner/clipboard` | ca (opt) | 3 | 4,439 K | 2 | ext | **KEEP** | clipboard image read on macOS + Windows | — | — |
| `@agentclientprotocol/sdk` | coding-agent | 1 (`acp-mode.ts`) | 5,167 K | 0 (+zod) | 272 K | **KEEP** | JSON-RPC runtime for `--mode acp`; make optional+lazy | — | — |
| `zod` | **undeclared** | via acp sdk | 3,000 K | — | — | **DECLARE** | latent install bug (§0.2) | 0 | none |

Counts: **4 DELETE (unused) · 8 REPLACE · 2 INLINE · 11 KEEP · 1 DECLARE.**

---

## Part 4 — Execution plan, ordered by weight saved ÷ risk

| # | action | install saved | trans. pkgs | risk | notes |
|---|---|---:|---:|---|---|
| 1 | Delete 4 unused declarations: `mime-types`, `@types/mime-types`, `chalk` (tui), `marked` (coding-agent) | 243 K | 2 | **none** | package.json only, no code |
| 2 | `glob` → `Bun.Glob().scanSync()` | 5,734 K | 6 | low | one call, `package-manager.ts:2209` |
| 3 | `extract-zip` → `tar xf` | 2,801 K | 14 | med | Windows-only branch; needs a Windows CI run |
| 4 | `hosted-git-info` → extend `parseGenericGitUrl` | 2,701 K | 1 | low | fallback parser already exists at `git.ts:78` |
| 5 | `undici` → delete (Bun proxies natively, verified) | 1,604 K | 0 | low | delete import *and* dep together |
| 6 | `minimatch` → `Bun.Glob().match()` + case fold | 610 K | 2 | low-med | add a case-sensitivity test for `model-resolver.ts:281` |
| 7 | `file-type` → 4 magic-byte checks | 361 K | 9 | low | strictly more conservative than the lib |
| 8 | `uuid` → `crypto.randomUUID()` | 64 K | 0 | low | v7 ordering provably unused |
| 9 | `strip-ansi` → `Bun.stripANSI` / in-repo impl | 10 K | 1 | low | re-export shim keeps 34 test files green |
| 10 | `chalk` → SGR map (coding-agent) | 43 K | 0 | low | 170 mechanical edits — codemod it |
| 11 | `cli-highlight` → `highlight.js` + adapter | 1,423 K net | **32** | med | count-neutral; real prize is a language-subset hljs build |
| 12 | Declare `zod`; make acp sdk optional + lazy | 0 (moves 5.2 M off the hard path) | — | low | fixes a latent install bug |
| 13 | Delete dead `src/utils/image-convert.ts`; de-dup `skills/attach-image/skill.js` | 0 | 0 | low | code hygiene, not a dep |
| 14 | `diff` → inline Myers (**optional**) | 601 K | 0 | med-high | do only if dep *count* is binding |

**Top 8 by ratio:** (1) unused deletions, (2) `glob`, (3) `extract-zip`, (4) `hosted-git-info`,
(5) `undici`, (6) `minimatch`, (7) `file-type`, (8) `uuid`.

Steps 1-10 are independent and parallelisable. Step 11 is the only one needing design (adapter
shape + which languages to bundle). Step 14 needs golden tests before and after.

**Estimated savings, steps 1-11:** ≈ **15.6 MB** of install tree and **66 transitive packages**
(≈ 77 packages total leaving the graph). Bundle: ≈ 255 KB minified from steps 1-10 directly, plus
the 1.8 MB `code-highlighter` chunk shrinking by whatever fraction the hljs language subset cuts.
`undici`, `koffi`, `photon` and `clipboard` are `bundle.mjs:43`-external, so their install savings
do not move the bundle.

---

## Part 5 — Resulting count, and whether ≤10 is reachable

### Before

- `packages/coding-agent`: 23 declared − 3 workspace (`pi-agent-core`, `pi-ai`, `pi-tui`) = **20 external**
- `packages/tui`: **6**
- `packages/agent`: 2 declared − 1 workspace = **1** (`typebox`, shared)
- Overlaps: `chalk` and `marked` are in both coding-agent and tui; `typebox` in all three.

**Unique external packages across the three in-scope packages: 24** (23 declared + undeclared `zod`).

### After steps 1-11

| package | remaining |
|---|---|
| `packages/coding-agent` (10) | `@agentclientprotocol/sdk`, `@silvia-odwyer/photon-node`, `@mariozechner/clipboard`, `highlight.js`, `diff`, `ignore`, `jiti`, `proper-lockfile`, `typebox`, `yaml` |
| `packages/tui` (3) | `get-east-asian-width`, `koffi`, `marked` |
| `packages/agent` (1) | `typebox` (shared) |

**Unique: 13.** Plus `zod` declared explicitly = 14 declared, but zod was always there — the
honest before/after is **24 → 14**, i.e. **10 packages eliminated** and ~66 transitives with them.

### Is ≤10 reachable?

**For these three packages: yes, but only by being precise about what "runtime dep" means.**

Of the 13, three are already `optionalDependencies` — code paths guarded by `try/catch` with
working fallbacks, and `bundle.mjs:43`-external so they contribute zero bytes to the shipped
artifact for users who do not need them:

- `koffi` (`packages/tui/package.json:46`) — Windows only, `terminal.ts:377-379` catch
- `@mariozechner/clipboard` (`packages/coding-agent/package.json:80`) — `clipboard-native.ts:16` catch
- `@agentclientprotocol/sdk` — *should* be optional (step 12); `--mode acp` only

That leaves **10 hard runtime deps**:

```
1. @silvia-odwyer/photon-node   6. marked
2. highlight.js                 7. proper-lockfile
3. diff                         8. typebox
4. get-east-asian-width         9. yaml
5. ignore                      10. jiti
```

Inlining `diff` (step 14, ~250 LOC) takes it to **9**. That is the floor without cutting a feature.

**For the whole product: no.** `packages/ai` holds 11 more, four of which are provider SDKs
(`@anthropic-ai/sdk`, `@aws-sdk/client-bedrock-runtime`, `@google/genai`, `@mistralai/mistralai`)
plus `openai`, `proxy-agent`, `partial-json`, `zod-to-json-schema`. Even at zero non-SDK deps
there, the product total lands around 20. **≤10 is a per-package target these three can hit; it is
not reachable product-wide while five provider SDKs are direct deps.** That is the other worker's
scope, and the honest framing is: this audit gets the non-provider half to 9-10, and the provider
half is where the remaining count lives.

### The stubborn ones, and exactly why

| dep | why it will not go |
|---|---|
| `jiti` | The most expensive item in the bundle (1,621 KB) and still correct to keep. Native `import()` cannot evict the ESM cache transitively, so `/reload:harness` would silently half-reload; and virtual modules have no on-disk target inside a compiled binary, so extensions would get a second divergent copy of every pi package. A `Bun.plugin` reimplementation is ~150-250 LOC of module resolution guarding the entire extension API. |
| `proper-lockfile` | Guards OAuth tokens, settings, session leases, cron state and daemon socket ownership. `onCompromised` (`auth-storage.ts:196-207`) is the only thing preventing a token write after another process steals the lock. A hand-rolled lockfile that corrupts state is worse than a dependency. 102 KB. |
| `yaml` | Looks like the easiest inline (one function, one call) and is the most dangerous. `test/frontmatter.test.ts:21-30` already pins block scalars *and* yaml's exact error positions, and the real inputs are third-party `SKILL.md` files. The failure mode is silent semantic corruption of skill metadata, not a crash. 300-450 LOC for the real contract. |
| `typebox` | Public `pi.registerTool({ parameters })` contract *and* runtime validation of LLM tool arguments (`agent-loop.ts:790`) and user JSON. Never cut validation at a trust boundary; never churn a public API for a count. |
| `marked` | Tokenizer subclass + two extensions + streaming tolerance + GFM tables feeding selection metadata. 1,500-2,500 LOC to reimplement, permanently subtly wrong. |
| `@silvia-odwyer/photon-node` | No image codec exists in Bun or Node. Without resizing, any Retina screenshot exceeds the 5 MB per-image API limit and the attachment is dropped. |
| `ignore` / `get-east-asian-width` | 63 KB and 14 KB, zero transitives — the two cheapest deps in the repo and among the hardest to reimplement correctly (gitignore precedence; the Unicode EAW table). Removing them is pure downside. |
| `highlight.js` | Replaces `cli-highlight` rather than eliminating it. Nobody is writing a syntax highlighter. The win here is 32 transitive packages and a language subset, not the count. |

### Two findings worth acting on regardless of dep count

1. **`zod` is an undeclared runtime dependency** (§0.2) that resolves only by hoisting. Declare it.
2. **`@types/mime-types` sits in `dependencies`** (`packages/tui/package.json:39`) — a types-only
   package shipped to every consumer, for a library that is itself unused.
