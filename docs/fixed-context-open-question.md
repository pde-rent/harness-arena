# The fixed-context table is not trustworthy yet

The "prompt tokens billed for a one-word task" table was the rig's cleanest number. Three
independent findings now say it cannot be published as measured.

## 1. `promptTokens` means different things per API shape

OpenAI-shape `prompt_tokens` **includes** cache reads. Anthropic-shape `input_tokens`
**excludes** them. Harnesses measured on the two shapes are therefore on different bases, and
the Anthropic-shape harness is understated against the rest.

## 2. Several harnesses set explicit cache breakpoints

At least opencode emits `cache_control: {type: "ephemeral"}` breakpoints, and the same
mechanism is the leading explanation for aider's implausibly low 561. A harness that caches
aggressively reports a small *uncached* prompt while still sending the same context. Cheaper
in money, identical in context pressure — and the current table conflates the two.

## 3. The numbers do not reconcile with the tool surface

opencode's tool descriptions alone measure ≈11k tokens, yet its observed prompt was 6,172.
Those cannot both be right on the same basis. Either the descriptions are not all sent, or the
measurement caught a cached figure. Unresolved — and exactly the kind of contradiction that
should block publication rather than be smoothed over.

## What replaces it

Re-measure with `promptTokens = uncachedInput + cacheRead + cacheWrite`, normalised per shape,
and publish **three** columns rather than one:

| column | meaning |
|---|---|
| `contextTokens` | total context put on the wire — the real context-window pressure |
| `billedInputTokens` | what was actually charged at full rate |
| `cacheHitRate` | how much of the context was served from cache |

A harness can legitimately win one and lose another; collapsing them into a single "fixed
context cost" hid that. The decomposition is more useful than the number it replaces, because
it separates *how much context a harness carries* from *how well it caches it* — two different
engineering properties that happen to share a unit.
