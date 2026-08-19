export class CycleError extends Error {
  readonly cycles: string[][];

  constructor(cycles: string[][]) {
    super(`dependency cycle detected: ${cycles.map((c) => c.join(" -> ")).join(" | ")}`);
    this.name = "CycleError";
    this.cycles = cycles;
  }
}

export interface GraphEdge {
  from: string;
  to: string;
}

export class DependencyGraph {
  private readonly outgoing = new Map<string, Set<string>>();
  private readonly incoming = new Map<string, Set<string>>();
  private readonly order: string[] = [];

  addNode(id: string): void {
    if (this.outgoing.has(id)) return;
    this.outgoing.set(id, new Set());
    this.incoming.set(id, new Set());
    this.order.push(id);
  }

  hasNode(id: string): boolean {
    return this.outgoing.has(id);
  }

  addEdge(from: string, to: string): void {
    if (from === to) {
      throw new CycleError([[from, to]]);
    }
    this.addNode(from);
    this.addNode(to);
    this.outgoing.get(from)!.add(to);
    this.incoming.get(to)!.add(from);
  }

  removeEdge(from: string, to: string): void {
    this.outgoing.get(from)?.delete(to);
    this.incoming.get(to)?.delete(from);
  }

  removeNode(id: string): void {
    if (!this.outgoing.has(id)) return;
    for (const target of this.outgoing.get(id)!) {
      this.incoming.get(target)?.delete(id);
    }
    for (const source of this.incoming.get(id)!) {
      this.outgoing.get(source)?.delete(id);
    }
    this.outgoing.delete(id);
    this.incoming.delete(id);
    const at = this.order.indexOf(id);
    if (at >= 0) this.order.splice(at, 1);
  }

  nodes(): string[] {
    return [...this.order];
  }

  edges(): GraphEdge[] {
    const out: GraphEdge[] = [];
    for (const from of this.order) {
      for (const to of this.outgoing.get(from)!) {
        out.push({ from, to });
      }
    }
    return out;
  }

  dependenciesOf(id: string): string[] {
    return [...(this.incoming.get(id) ?? [])];
  }

  directDependentsOf(id: string): string[] {
    return [...(this.outgoing.get(id) ?? [])];
  }

  dependentsOf(id: string): string[] {
    const seen = new Set<string>();
    const stack = [...(this.outgoing.get(id) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current) || current === id) continue;
      seen.add(current);
      for (const next of this.outgoing.get(current) ?? []) {
        if (!seen.has(next)) stack.push(next);
      }
    }
    return this.order.filter((node) => seen.has(node));
  }

  ancestorsOf(id: string): string[] {
    const seen = new Set<string>();
    const stack = [...(this.incoming.get(id) ?? [])];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (seen.has(current) || current === id) continue;
      seen.add(current);
      for (const next of this.incoming.get(current) ?? []) {
        if (!seen.has(next)) stack.push(next);
      }
    }
    return this.order.filter((node) => seen.has(node));
  }

  detectCycles(): string[][] {
    const index = new Map<string, number>();
    const low = new Map<string, number>();
    const onStack = new Set<string>();
    const stack: string[] = [];
    const cycles: string[][] = [];
    let counter = 0;

    const strongConnect = (node: string): void => {
      index.set(node, counter);
      low.set(node, counter);
      counter += 1;
      stack.push(node);
      onStack.add(node);

      for (const next of this.outgoing.get(node) ?? []) {
        if (!index.has(next)) {
          strongConnect(next);
          low.set(node, Math.min(low.get(node)!, low.get(next)!));
        } else if (onStack.has(next)) {
          low.set(node, Math.min(low.get(node)!, index.get(next)!));
        }
      }

      if (low.get(node) === index.get(node)) {
        const component: string[] = [];
        for (;;) {
          const popped = stack.pop()!;
          onStack.delete(popped);
          component.push(popped);
          if (popped === node) break;
        }
        const selfLoop = this.outgoing.get(node)?.has(node) ?? false;
        if (component.length > 1 || selfLoop) {
          cycles.push(this.order.filter((id) => component.includes(id)));
        }
      }
    };

    for (const node of this.order) {
      if (!index.has(node)) strongConnect(node);
    }
    return cycles;
  }

  hasCycle(): boolean {
    return this.detectCycles().length > 0;
  }

  topoSort(): string[] {
    const indegree = new Map<string, number>();
    for (const node of this.order) {
      indegree.set(node, this.incoming.get(node)!.size);
    }
    const available = this.order.filter((node) => indegree.get(node) === 0);
    const sorted: string[] = [];

    while (available.length > 0) {
      const node = available.shift()!;
      sorted.push(node);
      for (const next of this.outgoing.get(node)!) {
        const remaining = indegree.get(next)! - 1;
        indegree.set(next, remaining);
        if (remaining === 0) {
          insertByOrder(available, next, this.order);
        }
      }
    }

    if (sorted.length !== this.order.length) {
      throw new CycleError(this.detectCycles());
    }
    return sorted;
  }
}

function insertByOrder(list: string[], id: string, order: string[]): void {
  const rank = order.indexOf(id);
  let at = list.length;
  for (let i = 0; i < list.length; i += 1) {
    if (order.indexOf(list[i]!) > rank) {
      at = i;
      break;
    }
  }
  list.splice(at, 0, id);
}
