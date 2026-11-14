import { describe, expect, it } from 'vitest';
import type { Terrain } from '../core/terrain';
import { buildTerrainGrid, COLS, MAP_H, MAP_W, ROWS, TILE } from '../core/terrain';
import { newCampaign, NODE_DEFS } from '../core/state';
import {
  clampView, figureScale, FIGURE_FULL_AT, heightAt, heightField, lerpView, mirror, octant, OVERVIEW, panView, PARKED_MARGIN, parkedAt, screenOctant, SUB, toMap, toWorld,
  VERTS_X, VERTS_Z, VIEW_LIMITS, viewCamera, WATER_LEVEL, WORLD_D, WORLD_W, zoomView,
} from './worldMap';

const GRID = buildTerrainGrid(newCampaign().nodes);
const FIELD = heightField(GRID);
const centre = (col: number, row: number) => heightAt(FIELD, (col + 0.5) * TILE, (row + 0.5) * TILE);

describe('the map in world space', () => {
  it('puts one tile to a world unit, and back', () => {
    expect(toWorld(32, 48)).toEqual({ x: 2, z: 3 });
    expect(toMap(2.5, 7)).toEqual({ x: 40, y: 112 });
  });
});

describe('the ground', () => {
  it('has a height for every vertex, the same every time', () => {
    expect(FIELD.length).toBe(VERTS_X * VERTS_Z);
    expect(heightField(GRID)).toEqual(FIELD);
    expect(FIELD.every(Number.isFinite)).toBe(true);
  });

  it('lies under the water exactly where the grid has water, and above it elsewhere', () => {
    let water = 0;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const wet = GRID[row * COLS + col] === 'water';
        if (wet) water++;
        expect(centre(col, row) < WATER_LEVEL, `tile ${col},${row}`).toBe(wet);
      }
    }
    expect(water).toBeGreaterThan(0);
  });

  it('keeps even a lone pond under water and a lone islet above it', () => {
    const grid: Terrain[] = new Array(COLS * ROWS).fill('plain');
    grid[10 * COLS + 10] = 'water';
    grid.fill('water', 20 * COLS, 25 * COLS);
    grid[22 * COLS + 30] = 'plain';
    const field = heightField(grid);
    expect(heightAt(field, 10.5 * TILE, 10.5 * TILE)).toBeLessThan(WATER_LEVEL);
    expect(heightAt(field, 30.5 * TILE, 22.5 * TILE)).toBeGreaterThan(WATER_LEVEL);
  });

  it('raises mountains above the open country', () => {
    const mean = (kind: Terrain) => {
      let sum = 0;
      let n = 0;
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          if (GRID[row * COLS + col] !== kind) continue;
          sum += centre(col, row);
          n++;
        }
      }
      return sum / n;
    };
    expect(mean('mountain')).toBeGreaterThan(mean('plain') + 1);
    expect(mean('forest')).toBeGreaterThan(mean('water'));
  });

  it('reads heights between the vertices smoothly', () => {
    const v = (i: number, j: number) => FIELD[j * VERTS_X + i];
    const step = TILE / SUB;
    expect(heightAt(FIELD, 10 * step, 7 * step)).toBeCloseTo(v(10, 7), 5);
    expect(heightAt(FIELD, 10.5 * step, 7 * step)).toBeCloseTo((v(10, 7) + v(11, 7)) / 2, 5);
    expect(heightAt(FIELD, 10 * step, 7.5 * step)).toBeCloseTo((v(10, 7) + v(10, 8)) / 2, 5);
    // Off the map it holds the edge's height.
    expect(heightAt(FIELD, -50, -50)).toBeCloseTo(v(0, 0), 3);
  });

  it('mirrors the land past the edges', () => {
    expect(mirror(10, 50)).toBe(10);
    expect(mirror(-3, 50)).toBe(3);
    expect(mirror(53, 50)).toBe(47);
    expect(mirror(103, 50)).toBe(3);
    expect(mirror(0, 50)).toBe(0);
    expect(mirror(50, 50)).toBe(50);
  });
});

describe('the map camera', () => {
  it('opens on the whole map, from the south', () => {
    expect(OVERVIEW.x).toBeCloseTo(WORLD_W / 2);
    const cam = viewCamera(OVERVIEW);
    expect(cam.position[2]).toBeGreaterThan(cam.target[2]);
    expect(clampView(OVERVIEW)).toEqual(OVERVIEW);
  });

  it('stands back at its distance, as high as its pitch puts it', () => {
    const v = { x: 10, z: 12, distance: 20, yaw: 0.7, pitch: 0.9 };
    const { position: p, target: t } = viewCamera(v);
    expect(Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2])).toBeCloseTo(20, 5);
    expect(p[1]).toBeCloseTo(20 * Math.sin(0.9), 5);
  });

  it('keeps the view on the map, at sensible distances and angles', () => {
    const v = clampView({ x: -5, z: 999, distance: 1, yaw: 7, pitch: 2 });
    expect(v.x).toBe(0);
    expect(v.z).toBe(WORLD_D);
    expect(v.distance).toBe(VIEW_LIMITS.minDistance);
    expect(v.pitch).toBe(VIEW_LIMITS.maxPitch);
    expect(v.yaw).toBeCloseTo(7 - Math.PI * 2, 5);
    expect(clampView({ ...v, distance: 999, pitch: 0 }).distance).toBe(VIEW_LIMITS.maxDistance);
    expect(clampView({ ...v, pitch: 0 }).pitch).toBe(VIEW_LIMITS.minPitch);
  });

  it('pans the way the camera faces', () => {
    const v = { x: 20, z: 20, distance: 20, yaw: 0, pitch: 1 };
    expect(panView(v, 0, 2)).toMatchObject({ x: 20, z: 18 }); // forward is north
    expect(panView(v, 2, 0)).toMatchObject({ x: 22, z: 20 });
    const turned = panView({ ...v, yaw: Math.PI / 2 }, 0, 2); // looking west
    expect(turned.x).toBeCloseTo(18, 5);
    expect(turned.z).toBeCloseTo(20, 5);
  });

  it('zooms within its limits, looking down more steeply from afar', () => {
    const near = zoomView(OVERVIEW, 0.01);
    const far = zoomView(OVERVIEW, 100);
    expect(near.distance).toBe(VIEW_LIMITS.minDistance);
    expect(far.distance).toBe(VIEW_LIMITS.maxDistance);
    expect(far.pitch).toBeGreaterThan(near.pitch);
  });

  it('turns the short way round', () => {
    const a = { ...OVERVIEW, yaw: 3 };
    const b = { ...OVERVIEW, yaw: -3 };
    expect(lerpView(a, b, 0.5).yaw).toBeCloseTo(Math.PI, 2);
    expect(lerpView(a, b, 1).yaw).toBeCloseTo(3 + (2 * Math.PI - 6), 5);
    expect(lerpView(b, a, 0.5).yaw).toBeCloseTo(-Math.PI, 2);
  });
});

describe('figures on the map', () => {
  it('stand at true size up close and grow as the camera draws back', () => {
    expect(figureScale(VIEW_LIMITS.minDistance)).toBe(1);
    expect(figureScale(FIGURE_FULL_AT)).toBe(1);
    expect(figureScale(OVERVIEW.distance)).toBeCloseTo(OVERVIEW.distance / FIGURE_FULL_AT);
    expect(figureScale(VIEW_LIMITS.maxDistance)).toBeGreaterThan(figureScale(OVERVIEW.distance - 10));
  });
});

describe('squads parked at a stronghold', () => {
  const far = figureScale(OVERVIEW.distance);

  it('stand in front of it, toward the camera, fanned out', () => {
    const [a, b] = [parkedAt(400, 300, 0, 2, 0, 1), parkedAt(400, 300, 1, 2, 0, 1)];
    // From the south (yaw 0) the camera's side is south: larger y.
    expect(a.y).toBeGreaterThan(300);
    expect(b.y).toBeGreaterThan(300);
    expect(a.x).not.toBeCloseTo(b.x);
  });

  it('stay on the map at every stronghold, from the whole-map view, however many are parked', () => {
    for (const n of NODE_DEFS) {
      for (const count of [1, 2, 4]) {
        for (let i = 0; i < count; i++) {
          for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
            const p = parkedAt(n.x, n.y, i, count, yaw, far);
            expect(p.x, `${n.name}`).toBeGreaterThanOrEqual(PARKED_MARGIN);
            expect(p.x, `${n.name}`).toBeLessThanOrEqual(MAP_W - PARKED_MARGIN);
            expect(p.y, `${n.name}`).toBeGreaterThanOrEqual(PARKED_MARGIN);
            expect(p.y, `${n.name}`).toBeLessThanOrEqual(MAP_H - PARKED_MARGIN);
          }
        }
      }
    }
  });

  it('stand behind a stronghold on the southern edge rather than off the map', () => {
    const saltmarsh = NODE_DEFS.find((n) => n.name === 'Saltmarsh')!;
    const p = parkedAt(saltmarsh.x, saltmarsh.y, 0, 2, 0, far);
    expect(p.y).toBeLessThan(saltmarsh.y);
  });
});

describe('headings', () => {
  it('reads a heading in eighths', () => {
    expect(octant(1, 0)).toBe(0);
    expect(octant(1, 1)).toBe(1);
    expect(octant(0, 1)).toBe(2);
    expect(octant(-1, 0)).toBe(4);
    expect(octant(0, -1)).toBe(6);
    expect(octant(1, -0.1)).toBe(0);
  });

  it('turns a heading on the map into one on screen', () => {
    // From the south: east is right, south comes toward the camera.
    expect(screenOctant(1, 0, 0)).toBe(0);
    expect(screenOctant(0, 1, 0)).toBe(2);
    expect(screenOctant(0, -1, 0)).toBe(6);
    // From the north, everything is turned about.
    expect(screenOctant(1, 0, Math.PI)).toBe(4);
    expect(screenOctant(0, 1, Math.PI)).toBe(6);
    // From the east (yaw a quarter turn): north runs right, east comes toward the camera.
    expect(screenOctant(0, -1, Math.PI / 2)).toBe(0);
    expect(screenOctant(1, 0, Math.PI / 2)).toBe(2);
  });
});
