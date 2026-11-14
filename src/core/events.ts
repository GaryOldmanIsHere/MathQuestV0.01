import type { GameState } from './state';
import type { MapNode, Squad } from './types';
import type { Loot } from './items';
import { addLoot } from './items';
import { allItems } from '../data/registry';
import { rng } from '../data/names';
import { MAP_H, MAP_W } from './terrain';

// Things that happen on the campaign map beside marching and fighting:
// caches buried out in the country for a passing squad to turn up, and what
// a squad's leader says as things happen to it.

/** Something buried out in the country, and whether it has been dug up. */
export interface Cache {
  x: number;
  y: number;
  found: boolean;
}

/** How many caches a campaign buries. */
export const CACHE_COUNT = 7;
/** A cache lies this far at least from any stronghold, and from the map's edge (pixels). */
export const CACHE_CLEAR = 55;
/** A squad marching within this of a cache turns it up; one halting, within the wider reach. */
export const DIG_PASSING = 16;
export const DIG_HALTED = 36;
/** A squad this near an unfound cache spots something glinting. */
export const GLINT_REACH = 80;

/**
 * Bury a campaign's caches: out in open country, clear of the strongholds,
 * the map's edge and each other.
 */
export function buryCaches(nodes: readonly MapNode[], count = CACHE_COUNT, rand: () => number = rng): Cache[] {
  const out: Cache[] = [];
  for (let tries = 0; out.length < count && tries < 4000; tries++) {
    const x = CACHE_CLEAR + rand() * (MAP_W - CACHE_CLEAR * 2);
    const y = CACHE_CLEAR + rand() * (MAP_H - CACHE_CLEAR * 2);
    if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < CACHE_CLEAR)) continue;
    if (out.some((c) => Math.hypot(c.x - x, c.y - y) < 70)) continue;
    out.push({ x: Math.round(x), y: Math.round(y), found: false });
  }
  return out;
}

/** The unfound cache a squad turns up where it now is, if any. */
export function cacheUnder(st: GameState, sq: Squad): Cache | null {
  if (sq.side !== 'player') return null;
  const reach = sq.moving ? DIG_PASSING : DIG_HALTED;
  return (st.caches ?? []).find((c) => !c.found && Math.hypot(c.x - sq.x, c.y - sq.y) <= reach) ?? null;
}

/** The unfound cache within sight of a squad, if any (the nearest). */
export function cacheInSight(st: GameState, sq: Squad): Cache | null {
  if (sq.side !== 'player') return null;
  let best: Cache | null = null;
  let bestD = GLINT_REACH;
  for (const c of st.caches ?? []) {
    const d = Math.hypot(c.x - sq.x, c.y - sq.y);
    if (!c.found && d <= bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

/**
 * Dig a cache up: some Goth, and a supply, gear or a relic, of a standing
 * that rises as the campaign goes on. It is added to the army's stores.
 */
export function openCache(st: GameState, cache: Cache, rand: () => number = rng): Loot {
  cache.found = true;
  const top = Math.max(1, Math.ceil(st.day / 4));
  const loot: Loot = { goth: 40 + Math.floor(rand() * 9) * 10 + st.day * 5, items: [] };
  const roll = rand();
  const kind = roll < 0.45 ? 'gear' : roll < 0.85 ? 'supply' : 'relic';
  const pool = allItems().filter((i) => i.kind === kind && i.rank > 0 && i.rank <= top + 1);
  if (pool.length) loot.items.push(pool[Math.floor(rand() * pool.length)].id);
  addLoot(loot, st.inventory, st);
  return loot;
}

// ----------------------------------------------------------------- speech --

/** What a squad's leader may speak of. */
export type Speech = 'win' | 'capture' | 'find' | 'glint' | 'routed' | 'siege' | 'retreat';

export const LINES: Record<Speech, string[]> = {
  win: ['That settles it.', 'Well fought, everyone.', 'They will think twice now.', 'On to the next.'],
  capture: ['This town is ours now.', 'Raise our banner!', 'The people are free again.', 'We hold it. Rest while you can.'],
  find: ['Hm? Something is buried here.', 'Look at this!', 'Dig here, quickly!', 'Someone hid this well.'],
  glint: ['Did something glint over there?', 'There is something out there.', 'Hold on, what was that?'],
  routed: ['Fall back! Fall back to the keep!', 'We cannot hold. Back to the fort!', 'Pull back, all of you!'],
  siege: ['Your fort is ours by nightfall.', 'Surrender the keep!', 'Not one of you will stand in our way.'],
  retreat: ['Give ground, regroup!', 'Back! We will try again.', 'Not today. Withdraw!'],
};

/** A line for a leader to speak. */
export function lineFor(event: Speech, rand: () => number = rng): string {
  const lines = LINES[event];
  return lines[Math.floor(rand() * lines.length) % lines.length];
}
