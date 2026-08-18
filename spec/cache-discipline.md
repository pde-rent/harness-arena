# Cache discipline

Providers cache on an exact prefix match. Change one token early in the request and every token
after it is re-billed at full rate — a cache read is roughly an order of magnitude cheaper, so
prefix instability is the single most expensive mistake a harness can make, and it is invisible
in raw token counts.

This is in direct tension with the thing we want to be good at. Compaction, summarisation and
memory enrichment all *rewrite context*. Done naively, every clever context intervention
detonates the cache and costs the user more than the tokens it saved.

The resolution is not to compact less. It is to **make every mutation land at the end**.

## The ordering rule

Context is assembled most-stable-first, so that the mutable region is always a suffix:

| region | changes | cacheable |
|---|---|---|
| system prompt | never within a session | yes — the deepest prefix |
| tool schemas | never within a session | yes |
| project instructions | never within a session | yes |
| session-scoped state (memories, skills, harness entries) | frozen at session start | yes |
| conversation history | append-only | yes, up to the last turn |
| current turn | every request | no, and it should not be |

Anything that can change mid-session must live **after** everything that cannot. A single
mutable field placed early — a timestamp, a token counter, a "memories updated" block — is
worth more lost cache than its entire content.

## Rules

1. **The system prompt is immutable for the life of a session.** We currently rebuild it on
   every refine and every memory write, which invalidates the deepest and most expensive prefix
   there is. New knowledge is appended as a message, never folded back into the preamble.
2. **Enrichment appends, never injects.** Retrieved files, recalled memories and skill content
   enter as new trailing messages. Injecting them into the system prompt is the classic
   cache-killer: it multiplies the cost of the *entire* conversation to add one paragraph.
3. **Do not send an empty section.** Describing a store with nothing in it costs real tokens on
   every turn. Omit the block entirely rather than rendering "(none)".
4. **Compaction is a deliberate, rare cut, not continuous nibbling.** Rewriting history
   invalidates everything from the cut point on, so it must buy enough headroom to be worth one
   full re-bill. Many small compactions cost more than one large one, for less benefit.
5. **After a cut, the new prefix is frozen too.** The summary that replaces the removed history
   must itself be stable — regenerating or re-ranking it on later turns pays the invalidation
   again, every time.
6. **Nothing volatile in the prefix.** No timestamps, no elapsed-time counters, no remaining-
   budget figures, no re-ordered lists, no set iteration order. Sort deterministically.
7. **Place cache breakpoints at the stable/mutable boundary**, not inside a region that changes.

## Measurement

Discipline that is not measured decays. Every run records:

- **`prefixStability`** — longest common prefix over consecutive requests' message-hash arrays,
  as a fraction of the prior request. 1.0 is pure append; anything lower means something earlier
  was rewritten.
- **`cacheDefeatEvents`** — each drop in prefix stability, attributed to the segment that moved
  (system / tools / instructions / session state / history). This names the culprit rather than
  reporting that cost went up.
- **`cacheHitRate`** — cache reads as a share of context.
- **`recompactionRate`** — compactions per run, and tokens reclaimed per compaction. Frequent
  small cuts are a design smell.
- **`costPerUsefulToken`** — spend divided by *new* context introduced, which is what separates
  a harness that carries a large but stable context cheaply from one that carries a small
  context expensively.

`prefixStability` is the metric that makes the claim testable. A harness can be simultaneously
the most sophisticated at context engineering and the cheapest to run — but only if every
intervention is append-shaped, and the only way to know is to measure the prefix.
