import type { MapNode, March } from './types';

// The overworld ground layer, as data rather than pixels.
//
// Squads move freely across the map, so terrain is what makes geography matter:
// nothing is impassable, but rough ground costs time and roads save it. The
// renderer draws from this same grid, so what a player sees and what movement
// actually charges them can never drift apart.

export type Terrain = 'plain' | 'forest' | 'mountain' | 'water' | 'road';

export const TILE = 16;
export const MAP_W = 800;
export const MAP_H = 560;
export const COLS = Math.ceil(MAP_W / TILE);
export const ROWS = Math.ceil(MAP_H / TILE);

/**
 * Speed multipliers. Nothing here is zero: rough country slows a march, it
 * never forbids one. Roads are the only terrain that beats open ground.
 */
export const TERRAIN_SPEED: Record<Terrain, number> = {
  road: 1.4,
  plain: 1,
  forest: 0.62,
  mountain: 0.45,
  water: 0.35,
};

/**
 * How each squad type takes the ground, where it differs from the table
 * above. Light troops are not slowed by forest or hills; heavy cavalry gains
 * on open ground and loses badly in rough; fliers ignore the ground and with
 * it the road.
 */
export const MARCH_TERRAIN: Partial<Record<March, Partial<Record<Terrain, number>>>> = {
  light: { forest: 1, mountain: 1, water: 0.7 },
  lightCav: { forest: 1, mountain: 1, water: 0.7 },
  heavyCav: { road: 1.5, plain: 1.15, forest: 0.45, mountain: 0.35, water: 0.3 },
  fly: { road: 1, plain: 1, forest: 1, mountain: 1, water: 1 },
};

/** Half-width, in pixels, of the road corridor stamped along each link. */
const ROAD_WIDTH = 11;

/** Deterministic value noise in [0,1) for a tile. */
function tileNoise(col: number, row: number): number {
  const x = col * TILE;
  const y = row * TILE;
  return Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
}

/** The natural landscape, before roads are laid over it. */
export function baseTerrainAt(col: number, row: number): Terrain {
  const x = col * TILE;
  const y = row * TILE;
  const h = tileNoise(col, row);
  if (y < 80 && h > 0.3) return 'mountain';
  if (x > 600 && y > 420 && h > 0.35) return 'water';
  if (h > 0.82 || h < 0.06) return 'forest';
  return 'plain';
}

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

function idx(col: number, row: number): number {
  return row * COLS + col;
}

/** Distance from point p to the segment ab. */
function distToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Build the terrain grid: natural landscape with road corridors stamped along
 * every link between strongholds. Roads no longer constrain where a squad may
 * go — they only make the going quicker.
 */
export function buildTerrainGrid(nodes: MapNode[]): Terrain[] {
  const grid: Terrain[] = new Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      grid[idx(col, row)] = baseTerrainAt(col, row);
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  for (const node of nodes) {
    for (const linkId of node.links) {
      const other = byId.get(linkId);
      if (!other) continue;
      const key = `${Math.min(node.id, linkId)}-${Math.max(node.id, linkId)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      stampRoad(grid, node.x, node.y, other.x, other.y);
    }
  }
  return grid;
}

function stampRoad(grid: Terrain[], ax: number, ay: number, bx: number, by: number): void {
  const minCol = Math.max(0, Math.floor((Math.min(ax, bx) - ROAD_WIDTH) / TILE));
  const maxCol = Math.min(COLS - 1, Math.ceil((Math.max(ax, bx) + ROAD_WIDTH) / TILE));
  const minRow = Math.max(0, Math.floor((Math.min(ay, by) - ROAD_WIDTH) / TILE));
  const maxRow = Math.min(ROWS - 1, Math.ceil((Math.max(ay, by) + ROAD_WIDTH) / TILE));
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const cx = col * TILE + TILE / 2;
      const cy = row * TILE + TILE / 2;
      if (distToSegment(cx, cy, ax, ay, bx, by) <= ROAD_WIDTH) {
        grid[idx(col, row)] = 'road';
      }
    }
  }
}

export function terrainAtTile(grid: Terrain[], col: number, row: number): Terrain {
  const c = Math.max(0, Math.min(COLS - 1, col));
  const r = Math.max(0, Math.min(ROWS - 1, row));
  return grid[idx(c, r)];
}

/** Terrain under a world-space point; out-of-bounds clamps to the nearest tile. */
export function terrainAtPoint(grid: Terrain[], x: number, y: number): Terrain {
  return terrainAtTile(grid, Math.floor(x / TILE), Math.floor(y / TILE));
}

/**
 * How fast a squad of the given type moves over the point it occupies.
 * `true` and `false` stand for flying and heavy infantry.
 */
export function speedMultiplierAt(
  grid: Terrain[],
  x: number,
  y: number,
  march: March | boolean = 'heavy',
): number {
  const type: March = march === true ? 'fly' : march === false ? 'heavy' : march;
  const ground = terrainAtPoint(grid, x, y);
  return MARCH_TERRAIN[type]?.[ground] ?? TERRAIN_SPEED[ground];
}
