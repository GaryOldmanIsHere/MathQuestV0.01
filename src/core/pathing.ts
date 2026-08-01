import type { MapNode } from './types';

// Road-network pathfinding for the overworld. Kept out of the Phaser scene so
// the march rules can be exercised without a renderer.

/**
 * Shortest road route from one stronghold to another, as the list of nodes to
 * visit in order (excluding the start, including the destination). Returns an
 * empty array when already there or when no road connects them.
 */
export function findPath(nodes: MapNode[], from: number, to: number): number[] {
  if (from === to) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(from) || !byId.has(to)) return [];

  const prev = new Map<number, number>();
  const seen = new Set([from]);
  const queue = [from];

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of byId.get(cur)!.links) {
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      prev.set(next, cur);
      if (next === to) return reconstruct(prev, from, to);
      queue.push(next);
    }
  }
  return [];
}

function reconstruct(prev: Map<number, number>, from: number, to: number): number[] {
  const path = [to];
  let cur = to;
  while (prev.has(cur)) {
    cur = prev.get(cur)!;
    if (cur === from) break;
    path.unshift(cur);
  }
  return path;
}

/** The node a losing squad falls back to: the first road out of its current one. */
export function retreatNode(nodes: MapNode[], from: number): number | null {
  const node = nodes.find((n) => n.id === from);
  if (!node || node.links.length === 0) return null;
  return node.links[0];
}
