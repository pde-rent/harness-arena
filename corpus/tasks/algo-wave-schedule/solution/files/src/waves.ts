/**
 * Wave scheduling over a task dependency graph.
 *
 * The graph may contain cycles; they are condensed into strongly connected
 * components (Tarjan, iterative so that deep graphs do not blow the stack) and
 * every component is scheduled as one atomic unit.
 */

export class WavePlanError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WavePlanError";
    this.code = code;
  }
}

export interface WaveTaskSpec {
  id: string;
  priority: number;
  cost: number;
  deps?: readonly string[];
}

export interface WavePlanOptions {
  capacity: number;
}

export interface WaveAssignment {
  wave: number;
  tasks: string[];
  cost: number;
}

export interface WavePlan {
  waves: WaveAssignment[];
  components: string[][];
  levels: Record<string, number>;
  totalCost: number;
}

interface Component {
  members: number[]; // task indices
  key: string; // lexicographically smallest member id
  priority: number; // max member priority
  cost: number; // sum of member costs
  level: number;
}

export function planWaves(
  tasks: readonly WaveTaskSpec[],
  options: WavePlanOptions,
): WavePlan {
  const capacity = options.capacity;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new WavePlanError(
      "BAD_CAPACITY",
      `capacity must be an integer of at least 1: ${capacity}`,
    );
  }

  const n = tasks.length;
  const indexById = new Map<string, number>();

  for (let i = 0; i < n; i += 1) {
    const task = tasks[i] as WaveTaskSpec;
    if (typeof task.id !== "string" || task.id.length === 0) {
      throw new WavePlanError("BAD_ID", `task ids must be non-empty strings`);
    }
    if (!Number.isInteger(task.priority)) {
      throw new WavePlanError(
        "BAD_PRIORITY",
        `priority must be an integer: ${task.id}`,
      );
    }
    if (!Number.isInteger(task.cost) || task.cost < 1) {
      throw new WavePlanError(
        "BAD_COST",
        `cost must be an integer of at least 1: ${task.id}`,
      );
    }
    if (indexById.has(task.id)) {
      throw new WavePlanError("DUPLICATE_ID", `duplicate task id: ${task.id}`);
    }
    indexById.set(task.id, i);
  }

  // successors[i] = indices that depend on i;  predecessors are the deps.
  const succ: number[][] = [];
  const preds: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    succ.push([]);
    preds.push([]);
  }
  for (let i = 0; i < n; i += 1) {
    const deps = (tasks[i] as WaveTaskSpec).deps ?? [];
    const seen = new Set<number>();
    for (const dep of deps) {
      const at = indexById.get(dep);
      if (at === undefined) {
        throw new WavePlanError(
          "UNKNOWN_DEP",
          `task ${(tasks[i] as WaveTaskSpec).id} depends on unknown id: ${dep}`,
        );
      }
      if (seen.has(at)) continue;
      seen.add(at);
      preds[i]!.push(at);
      succ[at]!.push(i);
    }
  }

  if (n === 0) {
    return { waves: [], components: [], levels: {}, totalCost: 0 };
  }

  const compOf = tarjan(n, succ);
  const compCount = compOf.reduce((m, c) => (c > m ? c : m), -1) + 1;

  const components: Component[] = [];
  for (let c = 0; c < compCount; c += 1) {
    components.push({
      members: [],
      key: "",
      priority: 0,
      cost: 0,
      level: 1,
    });
  }
  for (let i = 0; i < n; i += 1) {
    const task = tasks[i] as WaveTaskSpec;
    const comp = components[compOf[i]!]!;
    if (comp.members.length === 0) {
      comp.key = task.id;
      comp.priority = task.priority;
    } else {
      if (task.id < comp.key) comp.key = task.id;
      if (task.priority > comp.priority) comp.priority = task.priority;
    }
    comp.members.push(i);
    comp.cost += task.cost;
  }

  // Condensation edges, deduplicated.
  const compSucc: number[][] = components.map(() => []);
  const compIndegree: number[] = components.map(() => 0);
  const edgeSeen = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    const from = compOf[i]!;
    for (const j of succ[i]!) {
      const to = compOf[j]!;
      if (from === to) continue;
      const key = from * compCount + to;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      compSucc[from]!.push(to);
      compIndegree[to]! += 1;
    }
  }

  // Longest-path level assignment over the condensation, O(V + E) via Kahn.
  const queue: number[] = [];
  for (let c = 0; c < compCount; c += 1) {
    if (compIndegree[c] === 0) queue.push(c);
  }
  let head = 0;
  let settled = 0;
  const remaining = [...compIndegree];
  while (head < queue.length) {
    const c = queue[head]!;
    head += 1;
    settled += 1;
    const lvl = components[c]!.level;
    for (const d of compSucc[c]!) {
      const target = components[d]!;
      if (lvl + 1 > target.level) target.level = lvl + 1;
      remaining[d]! -= 1;
      if (remaining[d] === 0) queue.push(d);
    }
  }
  if (settled !== compCount) {
    // Unreachable: the condensation of a directed graph is acyclic.
    throw new WavePlanError("INTERNAL", "condensation was not acyclic");
  }

  // Deterministic processing order: level asc, priority desc, key asc.
  const order = components.map((_, c) => c);
  order.sort((a, b) => {
    const ca = components[a]!;
    const cb = components[b]!;
    if (ca.level !== cb.level) return ca.level - cb.level;
    if (ca.priority !== cb.priority) return cb.priority - ca.priority;
    return ca.key < cb.key ? -1 : ca.key > cb.key ? 1 : 0;
  });

  // First-fit packing from the earliest permissible wave.
  const remainingCapacity: number[] = [];
  const waveMembers: number[][] = []; // wave index -> task indices
  const assignedWave = new Array<number>(compCount).fill(0);

  for (const c of order) {
    const comp = components[c]!;
    let earliest = 1;
    for (const i of comp.members) {
      for (const p of preds[i]!) {
        const pc = compOf[p]!;
        if (pc === c) continue;
        const w = assignedWave[pc]! + 1;
        if (w > earliest) earliest = w;
      }
    }

    let placed = -1;
    if (comp.cost > capacity) {
      for (let w = earliest; ; w += 1) {
        if (w > remainingCapacity.length) {
          remainingCapacity.push(capacity);
          waveMembers.push([]);
        }
        if (waveMembers[w - 1]!.length === 0) {
          placed = w;
          break;
        }
      }
      remainingCapacity[placed - 1] = 0;
    } else {
      for (let w = earliest; ; w += 1) {
        if (w > remainingCapacity.length) {
          remainingCapacity.push(capacity);
          waveMembers.push([]);
        }
        if (remainingCapacity[w - 1]! >= comp.cost) {
          placed = w;
          break;
        }
      }
      remainingCapacity[placed - 1]! -= comp.cost;
    }

    assignedWave[c] = placed;
    for (const i of comp.members) waveMembers[placed - 1]!.push(i);
  }

  const byPriorityThenId = (a: number, b: number): number => {
    const ta = tasks[a] as WaveTaskSpec;
    const tb = tasks[b] as WaveTaskSpec;
    if (ta.priority !== tb.priority) return tb.priority - ta.priority;
    return ta.id < tb.id ? -1 : ta.id > tb.id ? 1 : 0;
  };

  const waves: WaveAssignment[] = waveMembers.map((members, at) => {
    const sorted = [...members].sort(byPriorityThenId);
    let cost = 0;
    for (const i of sorted) cost += (tasks[i] as WaveTaskSpec).cost;
    return { wave: at + 1, tasks: sorted.map((i) => (tasks[i] as WaveTaskSpec).id), cost };
  });

  const levels: Record<string, number> = {};
  for (let i = 0; i < n; i += 1) {
    levels[(tasks[i] as WaveTaskSpec).id] = components[compOf[i]!]!.level;
  }

  const outComponents = order.map((c) =>
    components[c]!.members
      .map((i) => (tasks[i] as WaveTaskSpec).id)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
  );

  let totalCost = 0;
  for (const wave of waves) totalCost += wave.cost;

  return { waves, components: outComponents, levels, totalCost };
}

/** Iterative Tarjan. Returns compOf[node]; component ids are in reverse topological order. */
function tarjan(n: number, succ: readonly number[][]): number[] {
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const compOf = new Array<number>(n).fill(-1);
  const stack: number[] = [];
  let counter = 0;
  let components = 0;

  const frameNode: number[] = [];
  const frameEdge: number[] = [];

  for (let root = 0; root < n; root += 1) {
    if (index[root] !== -1) continue;
    frameNode.push(root);
    frameEdge.push(0);
    index[root] = counter;
    low[root] = counter;
    counter += 1;
    stack.push(root);
    onStack[root] = 1;

    while (frameNode.length > 0) {
      const v = frameNode[frameNode.length - 1]!;
      const edges = succ[v]!;
      const at = frameEdge[frameEdge.length - 1]!;
      if (at < edges.length) {
        frameEdge[frameEdge.length - 1] = at + 1;
        const w = edges[at]!;
        if (index[w] === -1) {
          index[w] = counter;
          low[w] = counter;
          counter += 1;
          stack.push(w);
          onStack[w] = 1;
          frameNode.push(w);
          frameEdge.push(0);
        } else if (onStack[w] === 1) {
          if (index[w]! < low[v]!) low[v] = index[w]!;
        }
      } else {
        frameNode.pop();
        frameEdge.pop();
        if (frameNode.length > 0) {
          const parent = frameNode[frameNode.length - 1]!;
          if (low[v]! < low[parent]!) low[parent] = low[v]!;
        }
        if (low[v] === index[v]) {
          for (;;) {
            const popped = stack.pop()!;
            onStack[popped] = 0;
            compOf[popped] = components;
            if (popped === v) break;
          }
          components += 1;
        }
      }
    }
  }

  return compOf;
}
