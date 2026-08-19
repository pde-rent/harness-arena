import { describe, expect, test } from "bun:test";
import { planWaves, type WaveTaskSpec, type WavePlan } from "../src/index";

// A fixed, deterministic mid-sized graph with cycles, disconnected pieces,
// a self-loop, wide fan-out and capacity pressure.
function fixture(): WaveTaskSpec[] {
  const tasks: WaveTaskSpec[] = [
    { id: "root-a", priority: 5, cost: 3, deps: [] },
    { id: "root-b", priority: 5, cost: 4, deps: [] },
    { id: "root-c", priority: 1, cost: 2, deps: ["root-c"] },
    { id: "mid-1", priority: 4, cost: 2, deps: ["root-a"] },
    { id: "mid-2", priority: 4, cost: 5, deps: ["root-a", "root-b"] },
    { id: "mid-3", priority: 3, cost: 1, deps: ["root-b"] },
    { id: "ring-p", priority: 7, cost: 2, deps: ["mid-1", "ring-r"] },
    { id: "ring-q", priority: 2, cost: 3, deps: ["ring-p"] },
    { id: "ring-r", priority: 6, cost: 1, deps: ["ring-q"] },
    { id: "leaf-x", priority: 0, cost: 1, deps: ["ring-q", "mid-2"] },
    { id: "leaf-y", priority: 9, cost: 6, deps: ["mid-3"] },
    { id: "iso-1", priority: 8, cost: 1, deps: [] },
    { id: "iso-2", priority: 8, cost: 1, deps: ["iso-1"] },
  ];
  for (let i = 0; i < 12; i += 1) {
    tasks.push({
      id: `fan-${String(i).padStart(2, "0")}`,
      priority: i % 5,
      cost: (i % 3) + 1,
      deps: i % 4 === 0 ? ["mid-3"] : ["leaf-y"],
    });
  }
  return tasks;
}

const CAPACITY = 8;

function componentOf(plan: WavePlan, id: string): string[] {
  return plan.components.find((c) => c.includes(id))!;
}

function waveOf(plan: WavePlan, id: string): number {
  return plan.waves.find((w) => w.tasks.includes(id))!.wave;
}

describe("planWaves structural invariants", () => {
  const tasks = fixture();
  const plan = planWaves(tasks, { capacity: CAPACITY });

  test("every task appears exactly once across the waves", () => {
    const seen = plan.waves.flatMap((w) => w.tasks);
    expect(seen.length).toBe(tasks.length);
    expect(new Set(seen).size).toBe(tasks.length);
    for (const task of tasks) expect(seen).toContain(task.id);
  });

  test("wave numbers are contiguous from 1 and no wave is empty", () => {
    plan.waves.forEach((w, at) => {
      expect(w.wave).toBe(at + 1);
      expect(w.tasks.length).toBeGreaterThan(0);
    });
  });

  test("each wave's reported cost is the exact integer sum of its tasks", () => {
    const costById = new Map(tasks.map((t) => [t.id, t.cost]));
    let total = 0;
    for (const wave of plan.waves) {
      let sum = 0;
      for (const id of wave.tasks) sum += costById.get(id)!;
      expect(wave.cost).toBe(sum);
      expect(Number.isInteger(wave.cost)).toBe(true);
      total += sum;
    }
    expect(plan.totalCost).toBe(total);
  });

  test("a dependency is in a strictly earlier wave unless it shares an SCC", () => {
    for (const task of tasks) {
      const here = waveOf(plan, task.id);
      const comp = componentOf(plan, task.id);
      for (const dep of task.deps ?? []) {
        const there = waveOf(plan, dep);
        if (comp.includes(dep)) {
          expect(there).toBe(here);
        } else {
          expect(there).toBeLessThan(here);
        }
      }
    }
  });

  test("every member of an SCC shares a wave and a level", () => {
    for (const comp of plan.components) {
      const wave = waveOf(plan, comp[0]!);
      const level = plan.levels[comp[0]!]!;
      for (const id of comp) {
        expect(waveOf(plan, id)).toBe(wave);
        expect(plan.levels[id]).toBe(level);
      }
    }
    expect(componentOf(plan, "ring-p").slice().sort()).toEqual([
      "ring-p",
      "ring-q",
      "ring-r",
    ]);
    expect(componentOf(plan, "root-c")).toEqual(["root-c"]);
  });

  test("components partition the task set and are each sorted by id", () => {
    const flat = plan.components.flat();
    expect(flat.length).toBe(tasks.length);
    expect(new Set(flat).size).toBe(tasks.length);
    for (const comp of plan.components) {
      expect(comp).toEqual([...comp].sort());
    }
  });

  test("components are listed in level asc, priority desc, key asc order", () => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const keys = plan.components.map((comp) => {
      const level = plan.levels[comp[0]!]!;
      const priority = Math.max(...comp.map((id) => byId.get(id)!.priority));
      return { level, priority, key: [...comp].sort()[0]! };
    });
    for (let i = 1; i < keys.length; i += 1) {
      const a = keys[i - 1]!;
      const b = keys[i]!;
      const ordered =
        a.level < b.level ||
        (a.level === b.level &&
          (a.priority > b.priority ||
            (a.priority === b.priority && a.key < b.key)));
      expect(ordered).toBe(true);
    }
  });

  test("levels obey the longest-path recurrence over the condensation", () => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const comp of plan.components) {
      const level = plan.levels[comp[0]!]!;
      let expected = 1;
      for (const id of comp) {
        for (const dep of byId.get(id)!.deps ?? []) {
          if (comp.includes(dep)) continue;
          expected = Math.max(expected, plan.levels[dep]! + 1);
        }
      }
      expect(level).toBe(expected);
    }
  });

  test("wave contents are ordered by priority desc then id asc", () => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const wave of plan.waves) {
      const resorted = [...wave.tasks].sort((a, b) => {
        const pa = byId.get(a)!.priority;
        const pb = byId.get(b)!.priority;
        if (pa !== pb) return pb - pa;
        return a < b ? -1 : a > b ? 1 : 0;
      });
      expect(wave.tasks).toEqual(resorted);
    }
  });

  test("no wave exceeds the capacity unless it holds one oversized component alone", () => {
    for (const wave of plan.waves) {
      if (wave.cost <= CAPACITY) continue;
      const comp = componentOf(plan, wave.tasks[0]!);
      expect([...wave.tasks].sort()).toEqual([...comp].sort());
    }
  });

  test("the plan is stable under permutation of the input", () => {
    const reversed = planWaves([...tasks].reverse(), { capacity: CAPACITY });
    expect(reversed.waves).toEqual(plan.waves);
    expect(reversed.components).toEqual(plan.components);
    expect(reversed.totalCost).toBe(plan.totalCost);
    expect(reversed.levels).toEqual(plan.levels);

    // A second, different permutation: stride the list.
    const strided: WaveTaskSpec[] = [];
    for (let offset = 0; offset < 5; offset += 1) {
      for (let i = offset; i < tasks.length; i += 5) strided.push(tasks[i]!);
    }
    expect(strided.length).toBe(tasks.length);
    const other = planWaves(strided, { capacity: CAPACITY });
    expect(other.waves).toEqual(plan.waves);
    expect(other.components).toEqual(plan.components);
    expect(other.levels).toEqual(plan.levels);
  });

  test("shuffling the deps array of each task changes nothing", () => {
    const flipped = tasks.map((t) => ({ ...t, deps: [...(t.deps ?? [])].reverse() }));
    const other = planWaves(flipped, { capacity: CAPACITY });
    expect(other.waves).toEqual(plan.waves);
    expect(other.components).toEqual(plan.components);
    expect(other.levels).toEqual(plan.levels);
  });

  test("duplicated dependency entries are ignored", () => {
    const doubled = tasks.map((t) => ({
      ...t,
      deps: [...(t.deps ?? []), ...(t.deps ?? [])],
    }));
    expect(planWaves(doubled, { capacity: CAPACITY })).toEqual(plan);
  });

  test("raising the capacity collapses the plan onto the longest-path levels", () => {
    const roomy = planWaves(tasks, { capacity: 1000 });
    expect(roomy.waves.length).toBe(Math.max(...Object.values(roomy.levels)));
    for (const task of tasks) {
      expect(waveOf(roomy, task.id)).toBe(roomy.levels[task.id]!);
    }
    expect(roomy.totalCost).toBe(plan.totalCost);
  });
});
