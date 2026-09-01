import type { Edge } from "../types";

/**
 * Breadth-first traversal of the confirmed canvas graph.
 *
 * Traversal only. It will not infer, weight, or guess: if it returns nothing,
 * that is a real answer, and it is usually the answer that starts the
 * investigation, "there is no path yet, go and find one."
 *
 * Hand-rolled on purpose. A graph library is not worth its weight for
 * max_hops <= 4 over a working set of forty nodes.
 */

export interface FoundPath {
  node_ids: string[];
  edges: { id: string; relation: string; from_id: string; to_id: string; derived?: boolean }[];
  hops: number;
}

export function findPaths(
  edges: Edge[],
  fromId: string,
  toId: string,
  maxHops = 4,
  maxResults = 8
): FoundPath[] {
  if (fromId === toId) return [];

  const adjacency = new Map<string, { to: string; edge: Edge }[]>();
  for (const e of edges) {
    for (const [a, b] of [
      [e.from_id, e.to_id],
      [e.to_id, e.from_id],
    ]) {
      const list = adjacency.get(a);
      if (list) list.push({ to: b, edge: e });
      else adjacency.set(a, [{ to: b, edge: e }]);
    }
  }

  const results: FoundPath[] = [];
  const queue: { node: string; nodes: string[]; edges: Edge[] }[] = [
    { node: fromId, nodes: [fromId], edges: [] },
  ];

  while (queue.length && results.length < maxResults) {
    const cur = queue.shift()!;
    if (cur.edges.length >= maxHops) continue;

    for (const { to, edge } of adjacency.get(cur.node) ?? []) {
      if (cur.nodes.includes(to)) continue; // simple paths only
      const nodes = [...cur.nodes, to];
      const path = [...cur.edges, edge];

      if (to === toId) {
        results.push({
          node_ids: nodes,
          edges: path.map((e) => ({
            id: e.id,
            relation: e.relation,
            from_id: e.from_id,
            to_id: e.to_id,
            derived: e.derived,
          })),
          hops: path.length,
        });
        if (results.length >= maxResults) break;
        continue;
      }

      queue.push({ node: to, nodes, edges: path });
    }
  }

  return results.sort((a, b) => a.hops - b.hops);
}

/** Neighbours of a node, one hop. Generic over the edge type so the Inspector
 *  keeps the canvas-only fields (analystAsserted, justAccepted) on the way out. */
export function neighbours<E extends Edge>(edges: E[], id: string): { edge: E; other: string }[] {
  const out: { edge: E; other: string }[] = [];
  for (const e of edges) {
    if (e.from_id === id) out.push({ edge: e, other: e.to_id });
    else if (e.to_id === id) out.push({ edge: e, other: e.from_id });
  }
  return out;
}
