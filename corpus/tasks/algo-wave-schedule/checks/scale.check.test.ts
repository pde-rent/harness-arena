import { describe, expect, test } from "bun:test";
import { planWaves, type WaveTaskSpec } from "../src/index";

// Deterministically generated layered graph. No randomness, no clock.
// 400 levels x 100 nodes = 40 000 tasks, ~120 000 edges, plus a 3-cycle
// embedded in every 50th level so the condensation is exercised at scale.
const LEVELS = 400;
const WIDTH = 100;

function buildGraph(): WaveTaskSpec[] {
  const id = (l: number, k: number) => `L${String(l).padStart(4, "0")}N${String(k).padStart(3, "0")}`;
  const tasks: WaveTaskSpec[] = [];
  for (let l = 0; l < LEVELS; l += 1) {
    for (let k = 0; k < WIDTH; k += 1) {
      const deps: string[] = [];
      if (l > 0) {
        deps.push(id(l - 1, k));
        deps.push(id(l - 1, (k * 7 + 3) % WIDTH));
        deps.push(id(l - 1, (k * 13 + 11) % WIDTH));
      }
      if (l % 50 === 0 && k < 3) {
        // 3-cycle among the first three nodes of this level: 0 -> 1 -> 2 -> 0
        deps.push(id(l, (k + 2) % 3));
      }
      tasks.push({ id: id(l, k), priority: (k * 31) % 17, cost: 1, deps });
    }
  }
  return tasks;
}

describe("planWaves scales linearly in the graph", () => {
  test("a 40k-node, 120k-edge graph is planned well inside the budget", () => {
    const tasks = buildGraph();
    expect(tasks.length).toBe(LEVELS * WIDTH);

    const started = Bun.nanoseconds();
    const plan = planWaves(tasks, { capacity: 1_000_000_000 });
    const elapsedMs = (Bun.nanoseconds() - started) / 1e6;

    // Structural sanity: capacity is far larger than any level, so every
    // component lands in its own longest-path level.
    expect(plan.waves.length).toBe(LEVELS);
    expect(plan.totalCost).toBe(LEVELS * WIDTH);
    expect(plan.waves[0]!.cost).toBe(WIDTH);
    expect(plan.waves[LEVELS - 1]!.cost).toBe(WIDTH);
    expect(plan.levels["L0000N000"]).toBe(1);
    expect(plan.levels["L0000N001"]).toBe(1);
    expect(plan.levels["L0000N002"]).toBe(1);
    expect(plan.levels["L0001N000"]).toBe(2);
    expect(plan.levels["L0399N042"]).toBe(400);

    // The cyclic levels condense their first three nodes into one component.
    const cyc = plan.components.find((c) => c.includes("L0050N000"))!;
    expect(cyc).toEqual(["L0050N000", "L0050N001", "L0050N002"]);

    // A quadratic implementation cannot finish this in the budget.
    expect(elapsedMs).toBeLessThan(6000);
  }, 60_000);
});
