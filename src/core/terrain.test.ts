import { describe, expect, it } from 'vitest';
import {
  baseTerrainAt,
  buildTerrainGrid,
  COLS,
  MAP_H,
  MAP_W,
  ROWS,
  speedMultiplierAt,
  TERRAIN_SPEED,
  terrainAtPoint,
  TILE,
} from './terrain';
import { NODE_DEFS } from './state';
import type { MapNode } from './types';

const NODES: MapNode[] = NODE_DEFS.map((d) => ({ ...d, owner: 'neutral' }));
const GRID = buildTerrainGrid(NODES);

describe('terrain grid', () => {
  it('covers the whole playfield', () => {
    expect(GRID).toHaveLength(COLS * ROWS);
    expect(COLS * TILE).toBeGreaterThanOrEqual(MAP_W);
    expect(ROWS * TILE).toBeGreaterThanOrEqual(MAP_H);
    expect(GRID.every((t) => t !== undefined)).toBe(true);
  });

  it('is deterministic - two builds agree tile for tile', () => {
    expect(buildTerrainGrid(NODES)).toEqual(GRID);
  });

  it('clamps out-of-bounds lookups instead of returning undefined', () => {
    expect(terrainAtPoint(GRID, -500, -500)).toBeDefined();
    expect(terrainAtPoint(GRID, MAP_W + 999, MAP_H + 999)).toBeDefined();
  });

  it('contains genuinely varied country, not one flat surface', () => {
    const kinds = new Set(GRID);
    expect(kinds.size).toBeGreaterThan(2);
    expect(kinds.has('road')).toBe(true);
  });
});

describe('movement costs', () => {
  it('never makes any terrain impassable', () => {
    for (const speed of Object.values(TERRAIN_SPEED)) {
      expect(speed).toBeGreaterThan(0);
    }
  });

  it('makes roads the fastest going and open plain second', () => {
    expect(TERRAIN_SPEED.road).toBeGreaterThan(TERRAIN_SPEED.plain);
    for (const [kind, speed] of Object.entries(TERRAIN_SPEED)) {
      if (kind !== 'road') expect(speed).toBeLessThanOrEqual(TERRAIN_SPEED.road);
    }
  });

  it('slows a march through forest, mountain, and water', () => {
    expect(TERRAIN_SPEED.forest).toBeLessThan(TERRAIN_SPEED.plain);
    expect(TERRAIN_SPEED.mountain).toBeLessThan(TERRAIN_SPEED.plain);
    expect(TERRAIN_SPEED.water).toBeLessThan(TERRAIN_SPEED.plain);
  });

  it('charges the cost of the tile a squad is standing on', () => {
    // find one tile of each kind present and confirm the lookup agrees
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * TILE + TILE / 2;
        const y = row * TILE + TILE / 2;
        const kind = terrainAtPoint(GRID, x, y);
        expect(speedMultiplierAt(GRID, x, y)).toBe(TERRAIN_SPEED[kind]);
      }
    }
  });

  it('lets fliers ignore the ground entirely', () => {
    const rough: Array<[number, number]> = [];
    for (let row = 0; row < ROWS && rough.length < 4; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * TILE + TILE / 2;
        const y = row * TILE + TILE / 2;
        if (terrainAtPoint(GRID, x, y) === 'mountain') {
          rough.push([x, y]);
          break;
        }
      }
    }
    expect(rough.length).toBeGreaterThan(0);
    for (const [x, y] of rough) {
      expect(speedMultiplierAt(GRID, x, y, false)).toBeLessThan(1);
      expect(speedMultiplierAt(GRID, x, y, true)).toBe(1);
    }
  });
});

describe('ground by squad type', () => {
  const first = (kind: string): [number, number] => {
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * TILE + TILE / 2;
        const y = row * TILE + TILE / 2;
        if (terrainAtPoint(GRID, x, y) === kind) return [x, y];
      }
    }
    throw new Error(`no ${kind} on the map`);
  };

  it('does not slow light troops in forest or hills', () => {
    for (const kind of ['forest', 'mountain']) {
      const [x, y] = first(kind);
      expect(speedMultiplierAt(GRID, x, y, 'heavy')).toBeLessThan(1);
      expect(speedMultiplierAt(GRID, x, y, 'light')).toBe(1);
      expect(speedMultiplierAt(GRID, x, y, 'lightCav')).toBe(1);
    }
  });

  it('speeds heavy cavalry on open ground and bogs it down in rough', () => {
    const [px, py] = first('plain');
    const [fx, fy] = first('forest');
    expect(speedMultiplierAt(GRID, px, py, 'heavyCav')).toBeGreaterThan(speedMultiplierAt(GRID, px, py, 'heavy'));
    expect(speedMultiplierAt(GRID, fx, fy, 'heavyCav')).toBeLessThan(speedMultiplierAt(GRID, fx, fy, 'heavy'));
  });

  it('gives fliers no road bonus, and everyone else one', () => {
    const [x, y] = first('road');
    expect(speedMultiplierAt(GRID, x, y, 'fly')).toBe(1);
    for (const t of ['slow', 'heavy', 'light', 'heavyCav', 'lightCav'] as const) {
      expect(speedMultiplierAt(GRID, x, y, t)).toBeGreaterThan(1);
    }
  });
});

describe('roads', () => {
  it('lays a road corridor over every stronghold', () => {
    for (const n of NODES) {
      expect(terrainAtPoint(GRID, n.x, n.y), `${n.name} is not on a road`).toBe('road');
    }
  });

  it('runs road along the midpoint of each linked pair', () => {
    for (const n of NODES) {
      for (const linkId of n.links) {
        const m = NODES.find((o) => o.id === linkId)!;
        const mx = (n.x + m.x) / 2;
        const my = (n.y + m.y) / 2;
        expect(terrainAtPoint(GRID, mx, my), `${n.name}-${m.name} midpoint`).toBe('road');
      }
    }
  });

  it('does not pave the whole map', () => {
    const paved = GRID.filter((t) => t === 'road').length;
    expect(paved).toBeGreaterThan(0);
    expect(paved).toBeLessThan(GRID.length * 0.5);
  });

  it('overlays roads on top of the natural landscape', () => {
    // at least one stronghold sits where the raw landscape was not plain,
    // proving the road stamp actually overrides the base terrain
    const overridden = NODES.some((n) => {
      const base = baseTerrainAt(Math.floor(n.x / TILE), Math.floor(n.y / TILE));
      return base !== 'plain';
    });
    expect(overridden).toBe(true);
  });
});
