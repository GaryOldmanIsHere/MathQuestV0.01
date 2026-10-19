import { describe, expect, it } from 'vitest';
import {
  ARRIVE_EPS,
  CAPTURE_RADIUS,
  clampToMap,
  CONTEST_RADIUS,
  ENGAGE_RADIUS,
  haltSquad,
  orderTo,
  retreatTarget,
  settleOffset,
  snapOrder,
  stepToward,
  squadsMeet,
  STRIKE_RANGE,
  strikeTarget,
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

describe('where the enemy strikes', () => {
  const opening = () => NODE_DEFS.map((d): MapNode => ({
    ...d, owner: d.kind === 'hq-player' ? 'player' : d.kind === 'town' ? 'neutral' : 'enemy',
  }));

  it('leaves the keep alone on the first day: no roaming squad starts within reach', () => {
    const nodes = opening();
    // The roamers start on the towns of the middle and east (Midfield, Saltmarsh, Ashfield).
    for (const id of [4, 5, 7]) expect(strikeTarget(nodes, nodes[id].x, nodes[id].y)).toBeNull();
  });

  it('strikes at the nearest holding within reach as the front moves up', () => {
    const nodes = opening();
    nodes[1].owner = 'player'; // Elm Vale taken
    nodes[2].owner = 'player'; // Riverwatch taken
    expect(strikeTarget(nodes, nodes[4].x, nodes[4].y)?.name).toBe('Elm Vale'); // from Midfield, a step nearer
    expect(strikeTarget(nodes, nodes[5].x, nodes[5].y)?.name).toBe('Riverwatch'); // from Saltmarsh
  });

  it('can reach the keep from a town next to it', () => {
    const nodes = opening();
    const elmVale = nodes[1];
    expect(strikeTarget(nodes, elmVale.x, elmVale.y)?.name).toBe('Fort Melchor');
  });

  it('ignores what is not the player\'s, and anything out of range', () => {
    const nodes = opening();
    expect(strikeTarget(nodes, nodes[0].x + STRIKE_RANGE + 1, nodes[0].y)).toBeNull();
    nodes[0].owner = 'enemy';
    expect(strikeTarget(nodes, nodes[0].x, nodes[0].y)).toBeNull();
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

  it('drives a beaten garrison off the stronghold it holds, to its next one', () => {
    const nodes: MapNode[] = NODES.map((n) => ({ ...n }));
    nodes[8].owner = 'enemy'; // Castle Verlaine, where the garrison stands
    nodes[6].owner = 'enemy'; // Stonegate
    const castle = nodes[8];
    const target = retreatTarget(nodes, 'enemy', castle.x + 5, castle.y, castle.x - 18, castle.y);
    expect(target).toEqual({ x: nodes[6].x, y: nodes[6].y });
  });

  it('pushes a garrison with nowhere else to go out of its stronghold\'s reach', () => {
    const nodes: MapNode[] = NODES.map((n) => ({ ...n }));
    nodes[8].owner = 'enemy';
    const castle = nodes[8];
    const target = retreatTarget(nodes, 'enemy', castle.x, castle.y, castle.x - 18, castle.y);
    expect(Math.hypot(target.x - castle.x, target.y - castle.y)).toBeGreaterThan(CAPTURE_RADIUS);
    expect(target.x).toBeGreaterThan(castle.x); // away from the victor
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

describe('squads parked at a stronghold', () => {
  const spots = Array.from({ length: 13 }, (_, i) => settleOffset(i));

  it('stand close enough to hold it, to contest it, and to meet an enemy who marches onto it', () => {
    for (const p of spots) {
      const r = Math.hypot(p.x, p.y);
      expect(r).toBeLessThan(CAPTURE_RADIUS);
      expect(r).toBeLessThan(CONTEST_RADIUS);
      expect(r).toBeLessThan(ENGAGE_RADIUS);
    }
  });

  it('each have a spot of their own, the first on the centre', () => {
    expect(spots[0]).toEqual({ x: 0, y: 0 });
    const keys = new Set(spots.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`));
    expect(keys.size).toBe(spots.length);
  });
});

describe('when opposing squads meet', () => {
  const castle = NODES[8];

  it('within reach of each other, anywhere', () => {
    expect(squadsMeet(NODES, { x: 300, y: 100 }, { x: 300 + ENGAGE_RADIUS - 1, y: 100 })).toBe(true);
    expect(squadsMeet(NODES, { x: 300, y: 100 }, { x: 300 + ENGAGE_RADIUS + 1, y: 100 })).toBe(false);
  });

  it('whenever both stand at the same stronghold, however far apart on it', () => {
    const d = CONTEST_RADIUS - 2;
    const attacker = { x: castle.x - d, y: castle.y };
    const defender = { x: castle.x + d, y: castle.y };
    expect(Math.hypot(attacker.x - defender.x, attacker.y - defender.y)).toBeGreaterThan(ENGAGE_RADIUS);
    expect(squadsMeet(NODES, attacker, defender)).toBe(true);
  });

  it('not when only one of them is at the stronghold', () => {
    const inside = { x: castle.x + 10, y: castle.y };
    const outside = { x: castle.x + 10 + ENGAGE_RADIUS + 5, y: castle.y };
    expect(squadsMeet(NODES, inside, outside)).toBe(false);
  });

  it('so no squad can keep a stronghold from being taken without being fought for it', () => {
    // Anyone who contests the stronghold stands within reach of anyone on it.
    for (let k = 0; k < 13; k++) {
      const parked = { x: castle.x + settleOffset(k).x, y: castle.y + settleOffset(k).y };
      for (let a = 0; a < 16; a++) {
        const r = CONTEST_RADIUS - 0.5;
        const contester = { x: castle.x + Math.cos(a) * r, y: castle.y + Math.sin(a) * r };
        expect(squadsMeet(NODES, parked, contester)).toBe(true);
      }
    }
  });
});

