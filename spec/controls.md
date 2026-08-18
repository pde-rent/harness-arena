# Experimental controls

Everything the proxy forces so that a comparison measures harnesses rather than their
configuration choices. The proxy terminates TLS, so it can normalise any request field before
it reaches the provider — this is the only place where "the same settings for everyone" can
actually be enforced, since no two harnesses expose the same knobs.

## Forced

| field | forced to | why |
|---|---|---|
| `model` | the benchmark model | harnesses remap, alias, or fall back to their own default |
| `provider.only` | one provider + quantisation, `allow_fallbacks: false` | the same model id is otherwise served by whichever provider is cheapest that minute |
| reasoning effort | one level for all | the largest single lever on output tokens; see below |
| `temperature`, `top_p`, `top_k` | fixed | a T=0 harness against a T=1 harness is a different experiment |
| `max_tokens` | fixed ceiling | otherwise a harness that truncates looks efficient |
| `seed` | fixed where supported | reduces run-to-run spread at no cost |

## Reasoning effort, specifically

Each request shape expresses it differently — `reasoning.effort` or `reasoning.max_tokens`
(OpenAI-ish), `thinking.budget_tokens` (Anthropic), `reasoning` on the Responses shape,
`thinkingConfig.thinkingLevel` (Gemini). The proxy strips whatever the harness sent and
substitutes one normalised setting expressed in that shape's own vocabulary.

**The tension, stated honestly:** choosing a sensible reasoning level is itself a harness design
decision, and forcing it removes credit for doing that well. So the original value is not
discarded — it is recorded per harness as `requestedReasoning` in the harness profile, and
published. The comparison runs at a fixed level; what each harness *would have chosen* remains
visible as a design fact.

If a harness parses reasoning output and breaks when the level changes, that is a finding about
the harness, not a reason to exempt it. Any harness that must be exempted is reported as
uncontrolled on that axis rather than quietly excluded.

## Recorded but not forced

- **Retry policy.** The proxy absorbs upstream 429s under one uniform policy so no harness's
  retry loop sits on the timing path. Residual retries are counted per run, never excluded
  post-hoc — post-hoc exclusion is a researcher degree of freedom.
- **Turn/iteration caps.** No harness exposes a uniform one, so the proxy enforces a **request
  budget** instead, which is identical for everyone.
- **Tool surface.** Not normalised. The tools a harness ships *are* the harness.
- **System prompt.** Not normalised, for the same reason. Only the shared instruction file is
  held constant.

## Verification

A control that is not verified is a comment. For each harness, after normalisation:

1. Capture the outbound request as the provider receives it and assert the forced fields hold.
2. Confirm the harness still completes a task — normalisation must not silently break it.
3. Record the pre-normalisation value so the harness's own choice stays published.

Any request arriving on a path the proxy cannot rewrite is **refused**, not passed through. An
unmeasurable, uncontrolled request is worse than a failed one.
