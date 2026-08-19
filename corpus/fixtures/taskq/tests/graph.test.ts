import { describe, expect, test } from "bun:test";
import { CycleError, DependencyGraph } from "../src/graph";

function build(edges: [string, string][]): DependencyGraph {
  const graph = new DependencyGraph();
  for (const [from, to] of edges) graph.addEdge(from, to);
  return graph;
}

describe("DependencyGraph", () => {
  test("topoSort respects edge direction", () => {
    const graph = build([
      ["a", "b"],
      ["b", "c"],
      ["a", "d"],
    ]);
    const order = graph.topoSort();
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("d"));
    expect(order.length).toBe(4);
  });

  test("topoSort is deterministic across identical builds", () => {
    const edges: [string, string][] = [
      ["a", "c"],
      ["b", "c"],
      ["c", "d"],
    ];
    expect(build(edges).topoSort()).toEqual(build(edges).topoSort());
  });

  test("detectCycles finds multi node cycles", () => {
    const graph = build([
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
      ["x", "y"],
    ]);
    const cycles = graph.detectCycles();
    expect(cycles.length).toBe(1);
    expect([...cycles[0]!].sort()).toEqual(["a", "b", "c"]);
    expect(graph.hasCycle()).toBe(true);
  });

  test("self edges are rejected", () => {
    const graph = new DependencyGraph();
    expect(() => graph.addEdge("a", "a")).toThrow(CycleError);
  });

  test("topoSort throws on cycles", () => {
    const graph = build([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(() => graph.topoSort()).toThrow(CycleError);
  });

  test("dependentsOf is transitive and ancestorsOf is its inverse", () => {
    const graph = build([
      ["a", "b"],
      ["b", "c"],
      ["c", "d"],
      ["e", "d"],
    ]);
    expect(graph.dependentsOf("a")).toEqual(["b", "c", "d"]);
    expect(graph.directDependentsOf("a")).toEqual(["b"]);
    expect(graph.dependentsOf("d")).toEqual([]);
    expect(graph.ancestorsOf("d")).toEqual(["a", "b", "c", "e"]);
  });

  test("removeNode detaches both directions", () => {
    const graph = build([
      ["a", "b"],
      ["b", "c"],
    ]);
    graph.removeNode("b");
    expect(graph.hasNode("b")).toBe(false);
    expect(graph.dependentsOf("a")).toEqual([]);
    expect(graph.dependenciesOf("c")).toEqual([]);
    expect(graph.edges()).toEqual([]);
  });

  test("dependenciesOf reports direct upstream nodes", () => {
    const graph = build([
      ["a", "c"],
      ["b", "c"],
    ]);
    expect(graph.dependenciesOf("c").sort()).toEqual(["a", "b"]);
    expect(graph.nodes()).toEqual(["a", "c", "b"]);
  });
});
