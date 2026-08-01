import { describe, expect, it } from 'vitest';
import { findPath, retreatNode } from './pathing';
import { NODE_DEFS } from './state';
import type { MapNode } from './types';

const NODES: MapNode[] = NODE_DEFS.map((d) => ({ ...d, owner: 'neutral' }));

describe('road pathfinding on the campaign map', () => {
  it('returns nothing when already at the destination', () => {
    expect(findPath(NODES, 4, 4)).toEqual([]);
  });

  it('finds a direct hop between linked strongholds', () => {
    expect(findPath(NODES, 0, 1)).toEqual([1]);
  });

  it('excludes the start and includes the destination', () => {
    const path = findPath(NODES, 0, 8);
    expect(path).not.toContain(0);
    expect(path[path.length - 1]).toBe(8);
  });

  it('walks only along real road links', () => {
    const path = findPath(NODES, 0, 8);
    let cur = 0;
    for (const next of path) {
      const node = NODES.find((n) => n.id === cur)!;
      expect(node.links, `no road from ${cur} to ${next}`).toContain(next);
      cur = next;
    }
  });

  it('takes a shortest route from the player HQ to the enemy castle', () => {
    // 0 -> 1 -> 4 -> 6/7 -> 8 and 0 -> 2 -> 4 -> ... are both length 4
    expect(findPath(NODES, 0, 8)).toHaveLength(4);
  });

  it('is symmetric in length on a bidirectional network', () => {
    expect(findPath(NODES, 0, 8)).toHaveLength(findPath(NODES, 8, 0).length);
  });

  it('connects every stronghold to every other', () => {
    for (const a of NODES) {
      for (const b of NODES) {
        if (a.id === b.id) continue;
        expect(findPath(NODES, a.id, b.id).length, `${a.id} -> ${b.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('returns nothing for a stronghold that is not on the map', () => {
    expect(findPath(NODES, 0, 999)).toEqual([]);
    expect(findPath(NODES, 999, 0)).toEqual([]);
  });

  it('returns nothing when the network is severed', () => {
    const split: MapNode[] = [
      { id: 0, name: 'A', x: 0, y: 0, kind: 'town', owner: 'neutral', links: [1] },
      { id: 1, name: 'B', x: 0, y: 0, kind: 'town', owner: 'neutral', links: [0] },
      { id: 2, name: 'C', x: 0, y: 0, kind: 'town', owner: 'neutral', links: [] },
    ];
    expect(findPath(split, 0, 2)).toEqual([]);
  });
});

describe('retreat', () => {
  it('falls back along a road out of the current stronghold', () => {
    const back = retreatNode(NODES, 4);
    expect(back).not.toBeNull();
    expect(NODES.find((n) => n.id === 4)!.links).toContain(back!);
  });

  it('has nowhere to go from an isolated stronghold', () => {
    const lone: MapNode[] = [
      { id: 0, name: 'A', x: 0, y: 0, kind: 'town', owner: 'neutral', links: [] },
    ];
    expect(retreatNode(lone, 0)).toBeNull();
  });
});
