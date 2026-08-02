import { describe, expect, it } from 'vitest';
import {
  ARRIVE_EPS,
  CAPTURE_RADIUS,
  clampToMap,
  haltSquad,
  orderTo,
  retreatTarget,
  snapOrder,
  stepToward,
  strongholdAt,
} from './movement';
import { MAP_H, MAP_W } from './terrain';
import { NODE_DEFS } from './state';
import { makeSquad } from './squad';
import { makeCharacter } from './character';
import type { MapNode, Squad } from './types';

const NODES: MapNode[] = NODE_DEFS.map((d) => ({ ...d, owner: 'neutral' }));

function squadAt(x: number, y: number, side: 'player' | 'enemy' = 'player'): Squad {
  const leader = makeCharacter('fighter', 1);
  return makeSquad(side, [{ char: leader, cell: 2 }], leader, 0, x, y, 'test');
}

describe('free movement', () => {
  it('moves straight toward any point, not along any network', () => {
    const step = stepToward(0, 0, 100, 0, 10);
    expect(step.x).toBeCloseTo(10);
    expect(step.y).toBeCloseTo(0);
    expect(step.arrived).toBe(false);
  });

  it('travels diagonally rather than in axis-aligned legs', () => {
    const step = stepToward(0, 0, 100, 100, 10);
    expect(step.x).toBeCloseTo(7.07, 1);
    expect(step.y).toBeCloseTo(7.07, 1);
    // the step length is what was asked for, not more
    expect(Math.hypot(step.x, step.y)).toBeCloseTo(10, 5);
  });

  it('snaps onto the destination instead of overshooting it', () => {
    const step = stepToward(0, 0, 5, 0, 1000);
    expect(step).toEqual({ x: 5, y: 0, arrived: true });
  });

  it('reports arrival once inside the epsilon', () => {
    const step = stepToward(0, 0, ARRIVE_EPS / 2, 0, 0.01);
    expect(step.arrived).toBe(true);
  });

  it('converges on the target rather than oscillating around it', () => {
    let x = 0;
    let y = 0;
    let arrived = false;
    for (let i = 0; i < 500 && !arrived; i++) {
      const s = stepToward(x, y, 137, -84, 7);
      x = s.x; y = s.y; arrived = s.arrived;
    }
    expect(arrived).toBe(true);
    expect(x).toBe(137);
    expect(y).toBe(-84);
  });

  it('keeps destinations on the map', () => {
    expect(clampToMap(-50, -50)).toEqual({ x: 0, y: 0 });
    expect(clampToMap(MAP_W + 500, MAP_H + 500)).toEqual({ x: MAP_W, y: MAP_H });
  });
});

describe('march orders', () => {
  it('accepts an arbitrary point, with no stronghold involved', () => {
    const sq = squadAt(100, 100);
    orderTo(sq, 613, 407);
    expect(sq.targetX).toBe(613);
    expect(sq.targetY).toBe(407);
    expect(sq.moving).toBe(true);
  });

  it('clamps an order dragged off the edge of the map', () => {
    const sq = squadAt(100, 100);
    orderTo(sq, -900, 9999);
    expect(sq.targetX).toBe(0);
    expect(sq.targetY).toBe(MAP_H);
  });

  it('does not set a squad marching to where it already stands', () => {
    const sq = squadAt(300, 300);
    orderTo(sq, 300, 300);
    expect(sq.moving).toBe(false);
  });

  it('clears the destination when halted', () => {
    const sq = squadAt(100, 100);
    orderTo(sq, 400, 400);
    haltSquad(sq);
    expect(sq.moving).toBe(false);
    expect(sq.targetX).toBeNull();
    expect(sq.targetY).toBeNull();
  });

  it('snaps a click near a stronghold onto it', () => {
    const town = NODES[4];
    const snapped = snapOrder(NODES, town.x + 6, town.y - 5);
    expect(snapped).toEqual({ x: town.x, y: town.y });
  });

  it('leaves a click in open country exactly where it landed', () => {
    // a point far from every stronghold
    const far = { x: 60, y: 120 };
    expect(strongholdAt(NODES, far.x, far.y)).toBeNull();
    expect(snapOrder(NODES, far.x, far.y)).toEqual(far);
  });
});

describe('stronghold occupancy', () => {
  it('recognises a squad halted on a stronghold', () => {
    const town = NODES[1];
    expect(strongholdAt(NODES, town.x, town.y)?.id).toBe(town.id);
  });

  it('recognises a squad halted just inside the radius', () => {
    const town = NODES[1];
    expect(strongholdAt(NODES, town.x + CAPTURE_RADIUS - 1, town.y)?.id).toBe(town.id);
  });

  it('does not count a squad standing beyond the radius', () => {
    const town = NODES[1];
    expect(strongholdAt(NODES, town.x + CAPTURE_RADIUS + 20, town.y)).toBeNull();
  });

  it('picks the nearer stronghold when two are close', () => {
    const near: MapNode[] = [
      { id: 0, name: 'A', x: 100, y: 100, kind: 'town', owner: 'neutral', links: [] },
      { id: 1, name: 'B', x: 130, y: 100, kind: 'town', owner: 'neutral', links: [] },
    ];
    expect(strongholdAt(near, 105, 100, 40)?.id).toBe(0);
    expect(strongholdAt(near, 125, 100, 40)?.id).toBe(1);
  });
});

describe('retreat', () => {
  it('falls back on the nearest stronghold the side still holds', () => {
    const nodes: MapNode[] = NODES.map((n) => ({ ...n }));
    nodes[0].owner = 'player'; // Fort Melchor
    nodes[8].owner = 'player'; // Castle Verlaine, far away
    const target = retreatTarget(nodes, 'player', nodes[1].x, nodes[1].y, 999, 999);
    expect(target).toEqual({ x: nodes[0].x, y: nodes[0].y });
  });

  it('backs directly away from the victor when the side holds nothing', () => {
    const nodes: MapNode[] = NODES.map((n) => ({ ...n, owner: 'enemy' as const }));
    // beaten squad at (400,300), enemy pressing from the left
    const target = retreatTarget(nodes, 'player', 400, 300, 300, 300);
    expect(target.x).toBeGreaterThan(400); // pushed away from the foe
    expect(target.y).toBeCloseTo(300);
  });

  it('still yields a valid on-map point when the two sides overlap exactly', () => {
    const nodes: MapNode[] = NODES.map((n) => ({ ...n, owner: 'enemy' as const }));
    const target = retreatTarget(nodes, 'player', 400, 300, 400, 300);
    expect(Number.isFinite(target.x)).toBe(true);
    expect(Number.isFinite(target.y)).toBe(true);
    expect(target.x).toBeGreaterThanOrEqual(0);
    expect(target.y).toBeLessThanOrEqual(MAP_H);
  });
});
