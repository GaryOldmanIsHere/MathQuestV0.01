import type { Squad } from '../core/types';
import { cellsOf, squadMemberIds } from '../core/squad';

// Where things stand on the 3D battlefield, as pure numbers, so the staging
// can be tested without a renderer.
//
// World axes: x runs from the attacker's side (negative) to the defender's
// (positive), z toward the camera, y up. One unit of length is roughly a
// soldier's height.

export const CELL_X = 1.7; // spacing between battle columns
export const CELL_Z = 2.4; // spacing between grid rows
export const GAP = 1.9; // half the no man's land between the two front ranks
/**
 * How far each row nearer the camera stands to the right of the one behind
 * it. Ogre Battle 64 sets its formations on the diagonal, so that a unit
 * never stands straight behind another and hidden by it; so does this.
 */
export const ROW_SHEAR = 1.0;

export interface Placement {
  x: number;
  z: number;
  /** +1 faces the defenders (toward +x), -1 the attackers. */
  facing: 1 | -1;
  /** Large units stand across two cells and are drawn larger. */
  large: boolean;
}

/**
 * Each member's place on the field. The front column stands nearest the
 * centre line; a large unit stands between its two cells.
 */
export function placements(sq: Squad, side: 'left' | 'right'): Map<number, Placement> {
  const out = new Map<number, Placement>();
  const sign = side === 'left' ? -1 : 1;
  for (const id of squadMemberIds(sq)) {
    const cells = cellsOf(sq, id);
    const col = cells.reduce((s, c) => s + (c % 3), 0) / cells.length; // 0 back .. 2 front
    const row = Math.floor(cells[0] / 3);
    out.set(id, {
      x: sign * (GAP + (2 - col) * CELL_X) + (row - 1) * ROW_SHEAR,
      z: (row - 1) * CELL_Z,
      facing: side === 'left' ? 1 : -1,
      large: cells.length > 1,
    });
  }
  return out;
}

/** A camera position looking at a point: azimuth around y (0 = from +z), elevation, distance. */
export interface Shot {
  target: [number, number, number];
  azimuth: number;
  elevation: number;
  distance: number;
}

/**
 * Which way the camera looks across the field: always from a little to the
 * attackers' side, as Ogre Battle 64's diagonal camera does. Seen so, each
 * nearer row stands further right on screen, adding to the rows' shear
 * rather than undoing it.
 */
export const DIAGONAL = -0.24;

/** The opening and resting view: the whole field, from the diagonal, a little above. */
export const WIDE: Shot = { target: [0, 0.6, 0], azimuth: DIAGONAL, elevation: 0.5, distance: 17 };

/** The battle camera's field of view, in degrees (vertical), and the screen's shape. */
export const FOV = 38;
export const ASPECT = 800 / 600;

/**
 * A closer view on a unit about to act and the units it acts on, from the
 * same diagonal, drawn back just far enough that all of them are in frame.
 */
export function frameAction(actor: Placement, targets: Placement[]): Shot {
  const pts = [actor, ...targets];
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const large = pts.some((p) => p.large);
  // Wide enough for the spread across, with a body's width to spare at each
  // side (more for great beasts), and for the spread in depth.
  const across = maxX - minX + (large ? 4.4 : 3);
  const half = Math.atan(Math.tan((FOV / 2) * (Math.PI / 180)) * ASPECT) * 0.8;
  const distance = Math.min(WIDE.distance + 2, Math.max(9.5, across / 2 / Math.tan(half) + (maxZ - minZ) * 0.5 + 3));
  return {
    target: [(minX + maxX) / 2, 0.8, (minZ + maxZ) / 2],
    azimuth: DIAGONAL,
    elevation: 0.42,
    distance,
  };
}

/** A closer view on one unit about to act. */
export function focusOn(p: Placement): Shot {
  return frameAction(p, []);
}

export function cameraPosition(s: Shot): [number, number, number] {
  const [tx, ty, tz] = s.target;
  const flat = Math.cos(s.elevation) * s.distance;
  return [tx + Math.sin(s.azimuth) * flat, ty + Math.sin(s.elevation) * s.distance, tz + Math.cos(s.azimuth) * flat];
}

export function lerpShot(a: Shot, b: Shot, t: number): Shot {
  const l = (x: number, y: number) => x + (y - x) * t;
  return {
    target: [l(a.target[0], b.target[0]), l(a.target[1], b.target[1]), l(a.target[2], b.target[2])],
    azimuth: l(a.azimuth, b.azimuth),
    elevation: l(a.elevation, b.elevation),
    distance: l(a.distance, b.distance),
  };
}
