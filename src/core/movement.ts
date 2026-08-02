import type { MapNode, Squad } from './types';
import { MAP_H, MAP_W } from './terrain';

// Free movement across the overworld. A squad marches toward any point the
// player picks; roads and strongholds no longer constrain where it may go.

/** How close counts as "arrived". */
export const ARRIVE_EPS = 2;

/** A squad halted this close to a stronghold is occupying it. */
export const CAPTURE_RADIUS = 28;

/** Clicking this close to a stronghold snaps the order onto it. */
export const SNAP_RADIUS = 30;

export interface Point {
  x: number;
  y: number;
}

export function clampToMap(x: number, y: number): Point {
  return {
    x: Math.max(0, Math.min(MAP_W, x)),
    y: Math.max(0, Math.min(MAP_H, y)),
  };
}

/**
 * Move a point up to `distance` toward a target, in a straight line.
 * Reports arrival when the remaining gap is within ARRIVE_EPS, so a caller
 * never overshoots and oscillates around the destination.
 */
export function stepToward(
  x: number, y: number,
  tx: number, ty: number,
  distance: number,
): { x: number; y: number; arrived: boolean } {
  const dx = tx - x;
  const dy = ty - y;
  const gap = Math.hypot(dx, dy);
  if (gap <= Math.max(ARRIVE_EPS, distance)) {
    return { x: tx, y: ty, arrived: true };
  }
  return {
    x: x + (dx / gap) * distance,
    y: y + (dy / gap) * distance,
    arrived: false,
  };
}

/** The stronghold a point sits inside, if any (nearest wins on overlap). */
export function strongholdAt(
  nodes: MapNode[],
  x: number, y: number,
  radius = CAPTURE_RADIUS,
): MapNode | null {
  let best: MapNode | null = null;
  let bestDist = radius;
  for (const n of nodes) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d <= bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

/** Snap a click near a stronghold onto it, so capturing stays easy to aim. */
export function snapOrder(nodes: MapNode[], x: number, y: number): Point {
  const node = strongholdAt(nodes, x, y, SNAP_RADIUS);
  return node ? { x: node.x, y: node.y } : clampToMap(x, y);
}

/**
 * Where a beaten squad falls back to: the nearest stronghold its own side
 * holds. With no holdings left it simply backs directly away from the victor,
 * which keeps a rout from stranding it in place.
 */
export function retreatTarget(
  nodes: MapNode[],
  side: 'player' | 'enemy',
  x: number, y: number,
  fromX: number, fromY: number,
  fallbackDistance = 90,
): Point {
  let best: MapNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (n.owner !== side) continue;
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  if (best) return { x: best.x, y: best.y };

  const dx = x - fromX;
  const dy = y - fromY;
  const len = Math.hypot(dx, dy);
  if (len === 0) return clampToMap(x, y + fallbackDistance);
  return clampToMap(x + (dx / len) * fallbackDistance, y + (dy / len) * fallbackDistance);
}

/** Point a squad at a destination. */
export function orderTo(sq: Squad, x: number, y: number): void {
  const dest = clampToMap(x, y);
  sq.targetX = dest.x;
  sq.targetY = dest.y;
  sq.moving = Math.hypot(dest.x - sq.x, dest.y - sq.y) > ARRIVE_EPS;
}

export function haltSquad(sq: Squad): void {
  sq.moving = false;
  sq.targetX = null;
  sq.targetY = null;
}
