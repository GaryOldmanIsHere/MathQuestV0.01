import type { Squad } from '../core/types';
import { cellsOf, squadMemberIds } from '../core/squad';

// Where things stand on the 3D battlefield, as pure numbers, so the staging
// can be tested without a renderer.
//
// World axes: x runs from the attacker's side (negative) to the defender's
// (positive), z toward the camera, y up. One unit of length is roughly a
// soldier's height.

export const CELL_X = 1.7; // spacing between battle columns
export const CELL_Z = 1.9; // spacing between grid rows
export const GAP = 1.9; // half the no man's land between the two front ranks

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
      x: sign * (GAP + (2 - col) * CELL_X),
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

/** The opening and resting view: the whole field from the front, a little above. */
export const WIDE: Shot = { target: [0, 0.6, 0], azimuth: 0, elevation: 0.42, distance: 15 };

/**
 * A closer view on a unit about to act: swung a little toward its own side
 * so that it and the line it faces are both in frame.
 */
export function focusOn(p: Placement): Shot {
  return {
    target: [p.x * 0.55, 0.8, p.z * 0.6],
    azimuth: -p.facing * 0.32,
    elevation: 0.36,
    distance: p.large ? 13 : 11.5,
  };
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
