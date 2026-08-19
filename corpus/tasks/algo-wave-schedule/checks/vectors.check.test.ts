import { describe, expect, test } from "bun:test";
import { WavePlanError, planWaves, type WaveTaskSpec } from "../src/index";

const t = (
  id: string,
  priority: number,
  cost: number,
  deps: string[] = [],
): WaveTaskSpec => ({ id, priority, cost, deps });

describe("planWaves known-answer vectors", () => {
  test("empty graph", () => {
    expect(planWaves([], { capacity: 10 })).toEqual({
      waves: [],
      components: [],
      levels: {},
      totalCost: 0,
    });
  });

  test("single task", () => {
    expect(planWaves([t("only", 3, 4)], { capacity: 10 })).toEqual({
      waves: [{ wave: 1, tasks: ["only"], cost: 4 }],
      components: [["only"]],
      levels: { only: 1 },
      totalCost: 4,
    });
  });

  test("diamond where a shortest-path layering disagrees with the longest path", () => {
    // A -> B, A -> C, B -> C.  A breadth-first layering would put C in wave 2.
    const plan = planWaves(
      [t("A", 0, 1), t("B", 0, 1, ["A"]), t("C", 0, 1, ["A", "B"])],
      { capacity: 10 },
    );
    expect(plan).toEqual({
      waves: [
        { wave: 1, tasks: ["A"], cost: 1 },
        { wave: 2, tasks: ["B"], cost: 1 },
        { wave: 3, tasks: ["C"], cost: 1 },
      ],
      components: [["A"], ["B"], ["C"]],
      levels: { A: 1, B: 2, C: 3 },
      totalCost: 3,
    });
  });

  test("a cycle is condensed rather than rejected", () => {
    const plan = planWaves(
      [
        t("A", 0, 1, ["C"]),
        t("B", 0, 1, ["A"]),
        t("C", 0, 1, ["B"]),
        t("D", 0, 1, ["B"]),
      ],
      { capacity: 10 },
    );
    expect(plan).toEqual({
      waves: [
        { wave: 1, tasks: ["A", "B", "C"], cost: 3 },
        { wave: 2, tasks: ["D"], cost: 1 },
      ],
      components: [["A", "B", "C"], ["D"]],
      levels: { A: 1, B: 1, C: 1, D: 2 },
      totalCost: 4,
    });
  });

  test("self-loop and disconnected components", () => {
    const plan = planWaves(
      [t("S", 0, 1, ["S"]), t("T", 0, 1), t("U", 0, 1, ["T"])],
      { capacity: 10 },
    );
    expect(plan).toEqual({
      waves: [
        { wave: 1, tasks: ["S", "T"], cost: 2 },
        { wave: 2, tasks: ["U"], cost: 1 },
      ],
      components: [["S"], ["T"], ["U"]],
      levels: { S: 1, T: 1, U: 2 },
      totalCost: 3,
    });
  });

  test("first-fit packing backfills an earlier wave and pushes a dependent", () => {
    const plan = planWaves(
      [
        t("P1", 9, 4),
        t("P2", 8, 3),
        t("P3", 7, 1),
        t("P4", 6, 3),
        t("X", 5, 1, ["P2"]),
      ],
      { capacity: 5 },
    );
    expect(plan).toEqual({
      waves: [
        { wave: 1, tasks: ["P1", "P3"], cost: 5 },
        { wave: 2, tasks: ["P2"], cost: 3 },
        { wave: 3, tasks: ["P4", "X"], cost: 4 },
      ],
      components: [["P1"], ["P2"], ["P3"], ["P4"], ["X"]],
      levels: { P1: 1, P2: 1, P3: 1, P4: 1, X: 2 },
      totalCost: 12,
    });
  });

  test("an oversized component takes a wave to itself", () => {
    const plan = planWaves([t("A", 5, 2), t("H", 4, 7), t("B", 3, 1)], {
      capacity: 3,
    });
    expect(plan).toEqual({
      waves: [
        { wave: 1, tasks: ["A", "B"], cost: 3 },
        { wave: 2, tasks: ["H"], cost: 7 },
      ],
      components: [["A"], ["H"], ["B"]],
      levels: { A: 1, H: 1, B: 1 },
      totalCost: 10,
    });
  });

  test("an oversized cyclic component rolls up its members' costs", () => {
    const plan = planWaves(
      [
        t("small", 9, 1),
        t("R", 5, 3, ["Q"]),
        t("Q", 4, 4, ["R"]),
        t("tail", 1, 1, ["R"]),
      ],
      { capacity: 5 },
    );
    expect(plan).toEqual({
      waves: [
        { wave: 1, tasks: ["small"], cost: 1 },
        { wave: 2, tasks: ["R", "Q"], cost: 7 },
        { wave: 3, tasks: ["tail"], cost: 1 },
      ],
      components: [["small"], ["Q", "R"], ["tail"]],
      levels: { small: 1, R: 1, Q: 1, tail: 2 },
      totalCost: 9,
    });
  });

  test("equal priorities are broken by ascending id", () => {
    const plan = planWaves([t("beta", 2, 1), t("alpha", 2, 1), t("gamma", 2, 1)], {
      capacity: 2,
    });
    expect(plan).toEqual({
      waves: [
        { wave: 1, tasks: ["alpha", "beta"], cost: 2 },
        { wave: 2, tasks: ["gamma"], cost: 1 },
      ],
      components: [["alpha"], ["beta"], ["gamma"]],
      levels: { alpha: 1, beta: 1, gamma: 1 },
      totalCost: 3,
    });
  });

  test("input validation", () => {
    expect(() => planWaves([], { capacity: 0 })).toThrow(WavePlanError);
    expect(() => planWaves([t("a", 0, 1), t("a", 0, 1)], { capacity: 4 })).toThrow(
      WavePlanError,
    );
    expect(() => planWaves([t("a", 0, 1, ["nope"])], { capacity: 4 })).toThrow(
      WavePlanError,
    );
    expect(() => planWaves([t("a", 0, 0)], { capacity: 4 })).toThrow(WavePlanError);

    try {
      planWaves([t("a", 0, 1, ["nope"])], { capacity: 4 });
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as WavePlanError).code).toBe("UNKNOWN_DEP");
    }
    try {
      planWaves([t("a", 0, 1), t("a", 1, 1)], { capacity: 4 });
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as WavePlanError).code).toBe("DUPLICATE_ID");
    }
    try {
      planWaves([], { capacity: -1 });
      throw new Error("expected a throw");
    } catch (err) {
      expect((err as WavePlanError).code).toBe("BAD_CAPACITY");
    }
  });
});
