import type { Terrain } from '../core/terrain';
import { COLS, MAP_H, MAP_W, ROWS, TILE, terrainAtTile } from '../core/terrain';

// The campaign map's shape in 3D, worked out apart from any renderer: where
// a map point stands in the world, how high the ground is there, and where
// the camera looks from.
//
// The game keeps playing on the terrain grid (src/core/terrain.ts); the 3D
// map is grown from that same grid, so hills stand where marching is slow
// and water lies where it is slower still. One tile is one world unit: map
// pixel (x, y) is world (x / TILE, z = y / TILE), with height in y.

/** Ground vertices per tile edge. */
export const SUB = 2;
export const VERTS_X = COLS * SUB + 1;
export const VERTS_Z = ROWS * SUB + 1;
export const WORLD_W = MAP_W / TILE;
export const WORLD_D = MAP_H / TILE;
/** The height of the water's surface. */
export const WATER_LEVEL = -0.2;

export function toWorld(x: number, y: number): { x: number; z: number } {
  return { x: x / TILE, z: y / TILE };
}

export function toMap(wx: number, wz: number): { x: number; y: number } {
  return { x: wx * TILE, y: wz * TILE };
}

/** Deterministic noise in [0, 1) for an integer lattice point. */
function lattice(i: number, j: number, seed: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

/** How much of the ground within `r` tiles is of this kind, 0..1. */
function share(grid: Terrain[], col: number, row: number, kind: Terrain, r: number): number {
  let n = 0;
  let of = 0;
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      of++;
      if (terrainAtTile(grid, col + dc, row + dr) === kind) n++;
    }
  }
  return n / of;
}

/** How high a tile's ground wants to be, before smoothing. */
function tileHeight(grid: Terrain[], col: number, row: number, seed: number): number {
  const t = terrainAtTile(grid, col, row);
  const n = lattice(col, row, seed);
  switch (t) {
    // Ranges rise toward their heart: a peak among peaks stands tallest.
    case 'mountain': return 0.8 + share(grid, col, row, 'mountain', 2) * 4.2 + n * 1.3;
    case 'forest': return 0.28 + n * 0.22;
    case 'water': return -0.75;
    case 'road': return 0.12;
    default: return 0.1 + n * 0.22;
  }
}

/**
 * The ground's height at every vertex of the map's mesh, row by row
 * (VERTS_X a row, VERTS_Z rows). Each vertex starts as the mean of the tiles
 * it touches and is smoothed, then the shore is fixed: a water tile's centre
 * always lies under the water and every other tile's centre above it.
 */
export function heightField(grid: Terrain[], seed = 1): Float32Array {
  const tiles = new Float32Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) tiles[row * COLS + col] = tileHeight(grid, col, row, seed);
  }
  const tileAt = (c: number, r: number) => tiles[Math.max(0, Math.min(ROWS - 1, r)) * COLS + Math.max(0, Math.min(COLS - 1, c))];
  let h = new Float32Array(VERTS_X * VERTS_Z);
  for (let j = 0; j < VERTS_Z; j++) {
    for (let i = 0; i < VERTS_X; i++) {
      // The vertex's place in tiles; it touches the tiles around that point.
      const u = i / SUB - 0.5;
      const v = j / SUB - 0.5;
      const c0 = Math.floor(u);
      const r0 = Math.floor(v);
      const fu = u - c0;
      const fv = v - r0;
      h[j * VERTS_X + i] =
        tileAt(c0, r0) * (1 - fu) * (1 - fv) + tileAt(c0 + 1, r0) * fu * (1 - fv) +
        tileAt(c0, r0 + 1) * (1 - fu) * fv + tileAt(c0 + 1, r0 + 1) * fu * fv;
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float32Array(h.length);
    for (let j = 0; j < VERTS_Z; j++) {
      for (let i = 0; i < VERTS_X; i++) {
        let sum = 0;
        let w = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= VERTS_X || jj >= VERTS_Z) continue;
            const k = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1;
            sum += h[jj * VERTS_X + ii] * k;
            w += k;
          }
        }
        next[j * VERTS_X + i] = sum / w;
      }
    }
    h = next;
  }
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const k = (row * SUB + SUB / 2) * VERTS_X + col * SUB + SUB / 2;
      h[k] = terrainAtTile(grid, col, row) === 'water' ? Math.min(h[k], WATER_LEVEL - 0.15) : Math.max(h[k], WATER_LEVEL + 0.1);
    }
  }
  return h;
}

/** How far the ground runs on past the map's edges, in world units. */
export const MARGIN = 30;

/**
 * A coordinate past the map's edge reflected back onto it, so the land
 * beyond the campaign carries on as a mirror of the land within.
 */
export function mirror(v: number, size: number): number {
  const period = size * 2;
  const m = ((v % period) + period) % period;
  return m <= size ? m : period - m;
}

/** The ground's height under a map point (map pixels), between the vertices. */
export function heightAt(field: Float32Array, x: number, y: number): number {
  const u = Math.max(0, Math.min(VERTS_X - 1.0001, (x / TILE) * SUB));
  const v = Math.max(0, Math.min(VERTS_Z - 1.0001, (y / TILE) * SUB));
  const i = Math.floor(u);
  const j = Math.floor(v);
  const fu = u - i;
  const fv = v - j;
  const at = (a: number, b: number) => field[b * VERTS_X + a];
  return at(i, j) * (1 - fu) * (1 - fv) + at(i + 1, j) * fu * (1 - fv) + at(i, j + 1) * (1 - fu) * fv + at(i + 1, j + 1) * fu * fv;
}

// ------------------------------------------------------------- the camera --

/**
 * Where the map camera looks from: the ground point it looks at, how far
 * back it stands, which way it faces (yaw 0 looks north, up the map) and
 * how steeply it looks down (pitch, radians above the horizon).
 */
export interface MapView {
  x: number;
  z: number;
  distance: number;
  yaw: number;
  pitch: number;
}

export const VIEW_LIMITS = { minDistance: 9, maxDistance: 62, minPitch: 0.55, maxPitch: 1.3 };

/** The opening view: the whole campaign in sight, looking up the map from the south. */
export const OVERVIEW: MapView = { x: WORLD_W / 2, z: WORLD_D / 2 + 2, distance: 56, yaw: 0, pitch: 1.0 };

/** A view kept in bounds: looking at the map, from a sensible distance and angle. */
export function clampView(v: MapView): MapView {
  const tau = Math.PI * 2;
  return {
    x: Math.max(0, Math.min(WORLD_W, v.x)),
    z: Math.max(0, Math.min(WORLD_D, v.z)),
    distance: Math.max(VIEW_LIMITS.minDistance, Math.min(VIEW_LIMITS.maxDistance, v.distance)),
    yaw: ((v.yaw % tau) + tau + Math.PI) % tau - Math.PI,
    pitch: Math.max(VIEW_LIMITS.minPitch, Math.min(VIEW_LIMITS.maxPitch, v.pitch)),
  };
}

/** The camera's position for a view, and the point it looks at. */
export function viewCamera(v: MapView): { position: [number, number, number]; target: [number, number, number] } {
  const flat = Math.cos(v.pitch) * v.distance;
  return {
    position: [v.x + Math.sin(v.yaw) * flat, Math.sin(v.pitch) * v.distance, v.z + Math.cos(v.yaw) * flat],
    target: [v.x, 0, v.z],
  };
}

/**
 * Move a view by an amount of ground as the camera sees it: `right` along
 * the screen's horizontal, `forward` away from the camera.
 */
export function panView(v: MapView, right: number, forward: number): MapView {
  return clampView({
    ...v,
    x: v.x + Math.cos(v.yaw) * right - Math.sin(v.yaw) * forward,
    z: v.z - Math.sin(v.yaw) * right - Math.cos(v.yaw) * forward,
  });
}

/**
 * How much larger squads are drawn when the camera stands back: true size
 * up close, and growing past `FIGURE_FULL_AT` so that a leader stays
 * legible from across the map, as Ogre Battle 64 keeps its map sprites.
 */
export const FIGURE_FULL_AT = 20;
export function figureScale(distance: number): number {
  return Math.max(1, distance / FIGURE_FULL_AT);
}

/** How far inside the map's edges a parked squad is always drawn. */
export const PARKED_MARGIN = 12;

/**
 * Where the `index`th of `count` squads parked at a stronghold at (x, y) is
 * drawn: in an arc in front of it on the camera's side (the camera, turned
 * by `yaw`, stands toward (sin yaw, cos yaw) on the map), spreading as their
 * figures `grow`. Where that arc would leave the map, as before a stronghold
 * on the southern edge seen from the south, it stands behind the building
 * instead; either way it stays on the map, where it can be seen and clicked.
 */
export function parkedAt(
  x: number, y: number, index: number, count: number, yaw: number, grow: number,
): { x: number; y: number } {
  const toward = Math.PI / 2 - yaw;
  const r = (count > 1 ? 30 : 22) * grow;
  const spot = (facing: number) => {
    const angle = facing + (index - (count - 1) / 2) * 0.62;
    return { x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r };
  };
  const inside = (p: { x: number; y: number }) =>
    p.x >= PARKED_MARGIN && p.x <= MAP_W - PARKED_MARGIN && p.y >= PARKED_MARGIN && p.y <= MAP_H - PARKED_MARGIN;
  let p = spot(toward);
  if (!inside(p)) p = spot(toward + Math.PI);
  return {
    x: Math.min(MAP_W - PARKED_MARGIN, Math.max(PARKED_MARGIN, p.x)),
    y: Math.min(MAP_H - PARKED_MARGIN, Math.max(PARKED_MARGIN, p.y)),
  };
}

/** Zoom by a factor (below 1 closer), easing the camera down as it nears the ground. */
export function zoomView(v: MapView, factor: number): MapView {
  const distance = v.distance * factor;
  const k = (distance - VIEW_LIMITS.minDistance) / (VIEW_LIMITS.maxDistance - VIEW_LIMITS.minDistance);
  return clampView({ ...v, distance, pitch: 0.7 + Math.max(0, Math.min(1, k)) * 0.35 });
}

/** Ease one view toward another. */
export function lerpView(a: MapView, b: MapView, k: number): MapView {
  let dy = b.yaw - a.yaw;
  if (dy > Math.PI) dy -= Math.PI * 2;
  if (dy < -Math.PI) dy += Math.PI * 2;
  return {
    x: a.x + (b.x - a.x) * k,
    z: a.z + (b.z - a.z) * k,
    distance: a.distance + (b.distance - a.distance) * k,
    yaw: a.yaw + dy * k,
    pitch: a.pitch + (b.pitch - a.pitch) * k,
  };
}

/** The direction of a heading in eighths, counting clockwise from +x (on the map: 0 east, 2 south, 4 west, 6 north). */
export function octant(dx: number, dy: number): number {
  return ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8;
}

/**
 * Which way a heading on the map (map pixels: +x east, +y south) runs on
 * screen for a camera turned by `yaw`, as an octant: 0 right, 2 toward the
 * camera, 4 left, 6 away.
 */
export function screenOctant(dx: number, dy: number, yaw: number): number {
  return octant(dx * Math.cos(yaw) - dy * Math.sin(yaw), dx * Math.sin(yaw) + dy * Math.cos(yaw));
}
