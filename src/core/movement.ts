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

/** Opposing squads this close to each other meet in battle. */
export const ENGAGE_RADIUS = 18;

/** A hostile squad this close to a stronghold keeps it from being taken. */
export const CONTEST_RADIUS = 30;

/**
 * How far an enemy squad looks for a holding of the player's to strike: a
 * town's march from its neighbours, so the war spreads from the front the
 * player opens rather than every roaming squad making straight for the keep
 * on the first day.
 */
export const STRIKE_RANGE = 220;

/**
 * Where the `index`th squad to halt at a stronghold stands, from its
 * centre: the first on it, the rest in rings close about it. Every place is
 * near enough that the squad holds the stronghold, counts against anyone
 * taking it, and meets in battle an enemy who marches onto it. (How the map
 * draws them is its own affair.)
 */
export function settleOffset(index: number): Point {
  if (index <= 0) return { x: 0, y: 0 };
  const angle = -Math.PI / 2 + ((index - 1) % 6) * (Math.PI / 3);
  const radius = 11 + Math.floor((index - 1) / 6) * 5;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

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
 * holds, other than one it is standing on, for a beaten garrison is driven
 * off its stronghold, leaving it to be taken. With nowhere else to go it
 * backs directly away from the victor, which keeps a rout from stranding it
 * in place.
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
    if (d < CAPTURE_RADIUS) continue;
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

/**
 * Where an enemy squad at (x, y) strikes: the nearest of the player's
 * holdings within reach; failing that, the nearest unclaimed stronghold
 * within reach, so the enemy's front creeps toward the player and the keep
 * comes within reach in time, even of a player who never moves.
 */
export function strikeTarget(nodes: MapNode[], x: number, y: number, range = STRIKE_RANGE): MapNode | null {
  const nearest = (owner: MapNode['owner']) => {
    let best: MapNode | null = null;
    let bestDist = range;
    for (const n of nodes) {
      if (n.owner !== owner) continue;
      const d = Math.hypot(n.x - x, n.y - y);
      if (d <= bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return best;
  };
  return nearest('player') ?? nearest('neutral');
}

/**
 * Whether two opposing squads meet in battle: when they come within
 * ENGAGE_RADIUS of each other, or when both stand at the same stronghold
 * (within CONTEST_RADIUS of it), since a stronghold cannot be shared. Without
 * the second, a defender just outside an attacker's reach would still keep
 * the attacker from taking the place, and neither would ever fight.
 */
export function squadsMeet(nodes: MapNode[], a: Point, b: Point): boolean {
  if (Math.hypot(a.x - b.x, a.y - b.y) < ENGAGE_RADIUS) return true;
  return nodes.some((n) =>
    Math.hypot(a.x - n.x, a.y - n.y) < CONTEST_RADIUS && Math.hypot(b.x - n.x, b.y - n.y) < CONTEST_RADIUS);
}

