# The baseline

There is exactly one. Every published number comes from it, and anything measured outside it is
labelled as such.

**A clean container, plus one identical instruction file, for every harness.**

| | |
|---|---|
| environment | a per-harness container; no host home, no host config, no host tools |
| host state | none reachable — nothing from `~/.claude`, `~/.agents`, `~/.cursor`, `~/.config`, or anywhere else |
| instruction file | `corpus/AGENT_INSTRUCTIONS.md`, byte-identical, delivered through whichever filename each harness natively reads |
| model / provider / sampling / reasoning effort | forced identically by the proxy (`spec/controls.md`) |
| model catalogue | served by the proxy as a single entry, so a harness that inspects it sees a constant |
| task prompt | `task.md`, byte-identical for every harness |
| workdir | fresh per run, materialised by the task's `setup.sh` |

## Why one baseline and not two

An earlier design measured harnesses with *all* instruction files suppressed, and separately
noted what each one picked up from the host. That produced two half-truths: a stock-prompt
number nobody experiences, and a contaminated number that measured the author's dotfiles.

The single baseline gives every harness the same briefing — the one we would actually write for
a coding agent — and lets each read it through its own mechanism. A harness that uses a good
instructions file well *should* score better for it. That is a real capability, not noise.

## What this requires, per harness

Delivery is **verified, not assumed**. For each harness we measure prompt tokens with and
without the file. If the count does not move, that harness is not reading it, and it competes
without a briefing the others got — reported, not silently tolerated.

Two harnesses read instruction files with no available off switch (cline, gemini-cli). Under
suppression that was an uncontrollable bias; under this baseline it is simply how they are
configured, and the problem disappears.

## What is measured outside the baseline

- **Host-state leakage** (`docs/host-state-leaks.md`) — a qualitative product property, and a
  disclosure about reproducibility and privacy. Never a ranking.
- **Fixed context cost** — the token floor with the baseline instruction file in place. It is
  the tax every turn of every task pays, and it is comparable precisely because the baseline is
  identical.
