import type { GameState } from './state';
import type { ClassDef, MapNode, Squad } from './types';
import { makeCharacter } from './character';
import { autoPlace, makeSquad, placesUsed, squadMemberIds, SQUAD_PLACES } from './squad';
import { strikeTarget, strongholdAt } from './movement';
import type { Point } from './movement';
import { simulateBattle } from './battle';

// The campaign's larger rules: what the enemy's squads set out to do, the
// reinforcements its castle raises, and how the player's army grows (stronger
// recruits, new squads, soldiers moved between squads).

// ------------------------------------------------------------- the enemy --

/** A squad's health as a share of its whole strength, the fallen counted as nothing. */
export function strengthShare(st: GameState, sq: Squad): number {
  const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
  return members.reduce((s, c) => s + Math.max(0, c.hp), 0) / Math.max(1, members.reduce((s, c) => s + c.stats.hp, 0));
}

/** Below this share of its strength an enemy squad falls back to rest rather than attack. */
export const AI_REST_BELOW = 0.5;
/** And it sets out again once it has rested back to this. */
export const AI_READY_AT = 0.8;

export type EnemyOrder =
  | { kind: 'hold' }
  | { kind: 'march'; to: Point; why: 'home' | 'rest' | 'strike' | 'claim' | 'advance' };

/**
 * What a halted enemy squad would do next (the map decides how often to ask,
 * and rolls for whether it sets out at once).
 * - A garrison holds its post, and makes its way back if driven off while
 *   the post is still the enemy's.
 * - A squad too hurt to fight falls back on the nearest of its side's
 *   strongholds and rests there until it is fit again.
 * - Otherwise it strikes at the player's nearest holding in reach, or takes
 *   unclaimed ground; with nothing in reach, it moves up to the enemy's
 *   stronghold nearest the player's keep, so none sits idle in the rear.
 */
export function enemyOrder(st: GameState, sq: Squad): EnemyOrder {
  const here = strongholdAt(st.nodes, sq.x, sq.y);
  const home = sq.home !== undefined ? st.nodes.find((n) => n.id === sq.home) : undefined;
  if (home && home.owner === 'enemy') {
    return here === home ? { kind: 'hold' } : { kind: 'march', to: { x: home.x, y: home.y }, why: 'home' };
  }
  const share = strengthShare(st, sq);
  const resting = here?.owner === 'enemy';
  if (share < AI_REST_BELOW || (resting && share < AI_READY_AT)) {
    if (resting) return { kind: 'hold' };
    const refuge = nearest(st.nodes.filter((n) => n.owner === 'enemy'), sq);
    if (refuge) return { kind: 'march', to: { x: refuge.x, y: refuge.y }, why: 'rest' };
  }
  const target = strikeTarget(st.nodes, sq.x, sq.y);
  if (target) return { kind: 'march', to: { x: target.x, y: target.y }, why: target.owner === 'player' ? 'strike' : 'claim' };
  // Nothing in reach: move up toward the front.
  const keep = st.nodes.find((n) => n.kind === 'hq-player');
  if (keep) {
    const own = Math.hypot(sq.x - keep.x, sq.y - keep.y);
    const forward = nearest(st.nodes.filter((n) => n.owner === 'enemy' && n.kind !== 'hq-enemy' && Math.hypot(n.x - keep.x, n.y - keep.y) < own - 20), keep);
    if (forward) return { kind: 'march', to: { x: forward.x, y: forward.y }, why: 'advance' };
  }
  return { kind: 'hold' };
}

function nearest(nodes: MapNode[], from: Point): MapNode | null {
  let best: MapNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - from.x, n.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

/** Days between the reinforcements the enemy's castle raises. */
export const REINFORCE_EVERY = 5;
/** The most squads the enemy keeps in the field. */
export const ENEMY_SQUADS_MAX = 8;

const REINFORCEMENTS: { name: string; roster: string[] }[] = [
  { name: 'Verlaine Vanguard', roster: ['knight', 'fighter', 'archer', 'cleric'] },
  { name: 'Black Company', roster: ['berserker', 'ninja', 'sorceress', 'fighter'] },
  { name: 'Grave Legion', roster: ['risen-knight', 'risen-soldier', 'risen-archer', 'risen-archmage'] },
  { name: 'Iron Pikes', roster: ['phalanx', 'soldier', 'bowman', 'witch'] },
];

/** The level the enemy's fresh squads come at on a campaign day: a level every five days, from the fifth. */
export function reinforcementLevel(day: number): number {
  return Math.min(14, 5 + Math.floor(day / REINFORCE_EVERY));
}

/**
 * On every fifth day, while the enemy holds its castle and has room for
 * another squad, one marches out of it: a roaming squad, stronger the later
 * it comes. Returns it, or null on other days.
 */
export function reinforce(st: GameState): Squad | null {
  if (st.day % REINFORCE_EVERY !== 0) return null;
  const castle = st.nodes.find((n) => n.kind === 'hq-enemy');
  if (!castle || castle.owner !== 'enemy') return null;
  if (st.squads.filter((s) => s.side === 'enemy').length >= ENEMY_SQUADS_MAX) return null;
  const nth = st.day / REINFORCE_EVERY - 1;
  const kind = REINFORCEMENTS[nth % REINFORCEMENTS.length];
  const level = reinforcementLevel(st.day);
  const members = kind.roster.map((cls, k) => makeCharacter(cls, Math.max(1, level - (k === 0 ? 0 : 1))));
  const round = Math.floor(nth / REINFORCEMENTS.length);
  const sq = makeSquad('enemy', [], members[0], castle.id, castle.x + 14, castle.y + 14, round ? `${kind.name} ${toRoman(round + 1)}` : kind.name);
  for (const c of members) if (autoPlace(sq, c)) st.chars.set(c.id, c);
  st.squads.push(sq);
  return sq;
}

function toRoman(n: number): string {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] ?? String(n);
}

// ---------------------------------------------------------- the player's army --

/** The most squads the player may field. */
export const PLAYER_SQUADS_MAX = 6;
/** What it costs to found a squad, besides its first soldier. */
export const FOUND_SQUAD_COST = 300;

const NEW_SQUAD_NAMES = ['Iron Band', 'Dawn Company', 'Storm Riders', 'Oak Shields', 'Night Herons', 'Gilded Spears'];

/** The level recruits arrive at: a level under the army's average, never under 3. */
export function recruitLevel(st: GameState): number {
  const mine = st.squads.filter((s) => s.side === 'player').flatMap((s) => squadMemberIds(s)).map((id) => st.chars.get(id)!);
  if (!mine.length) return 3;
  return Math.max(3, Math.round(mine.reduce((s, c) => s + c.level, 0) / mine.length) - 1);
}

/** What it costs to enlist a recruit of a class at a level: monsters and the large come dear, and veterans dearer. */
export function recruitCost(def: ClassDef, level = 3): number {
  const base = def.gender === 'X' ? (def.size === 2 ? 260 : 160) : 90;
  return Math.round(base * (1 + Math.max(0, level - 3) * 0.3));
}

/**
 * Found a new squad at the keep, led by a fresh recruit of the class given.
 * Null if the army is at its limit or the treasury short.
 */
export function foundSquad(st: GameState, classId: string, def: ClassDef): Squad | null {
  const level = recruitLevel(st);
  const cost = FOUND_SQUAD_COST + recruitCost(def, level);
  if (st.squads.filter((s) => s.side === 'player').length >= PLAYER_SQUADS_MAX || st.goth < cost) return null;
  const keep = st.nodes.find((n) => n.kind === 'hq-player')!;
  const leader = makeCharacter(classId, level);
  const taken = new Set(st.squads.map((s) => s.name));
  const name = NEW_SQUAD_NAMES.find((n) => !taken.has(n)) ?? `Company ${st.squads.length + 1}`;
  const sq = makeSquad('player', [], leader, keep.id, keep.x, keep.y + 12, name);
  if (!autoPlace(sq, leader)) return null;
  st.chars.set(leader.id, leader);
  st.squads.push(sq);
  st.goth -= cost;
  return sq;
}

/**
 * Move a soldier from one of the player's squads to another. The leader
 * stays with the squad; the other squad must have the places, and the two
 * must stand together (within a short march) for the soldier to cross.
 */
export function transferMember(st: GameState, from: Squad, to: Squad, charId: number): string | null {
  const c = st.chars.get(charId);
  if (!c || from === to || !from.grid.includes(charId)) return 'Nobody to move.';
  if (charId === from.leaderId) return 'A leader stays with the squad: choose another leader first.';
  if (Math.hypot(from.x - to.x, from.y - to.y) > TRANSFER_REACH) return `${to.name} is too far off: bring the squads together first.`;
  const size = from.grid.filter((id) => id === charId).length;
  if (SQUAD_PLACES - placesUsed(to) < size) return `${to.name} has no room.`;
  const before = [...from.grid];
  from.grid = from.grid.map((id) => (id === charId ? null : id));
  if (!autoPlace(to, c)) {
    from.grid = before;
    return `${to.name} has no room in its ranks.`;
  }
  return null;
}

/** How near two squads must stand for a soldier to pass between them. */
export const TRANSFER_REACH = 60;

// -------------------------------------------------------------- forecasts --

export interface Forecast {
  /** Shares of the trial battles the first squad won, drew and lost: they sum to 1. */
  win: number;
  draw: number;
  loss: number;
}

/**
 * How a fight between two squads is likely to go, were `mine` to attack
 * `theirs` as both stand now: the battle is fought `runs` times over on
 * copies, so nothing in the campaign changes.
 */
export function forecast(st: GameState, mine: Squad, theirs: Squad, runs = 24): Forecast {
  const tally = { attacker: 0, defender: 0, draw: 0 };
  for (let i = 0; i < runs; i++) {
    const side = (sq: Squad) => {
      const squad = structuredClone(sq);
      const chars = new Map(squadMemberIds(sq).flatMap((id) => {
        const c = st.chars.get(id);
        return c ? [[id, structuredClone(c)] as const] : [];
      }));
      return { squad, chars };
    };
    tally[simulateBattle(side(mine), side(theirs)).winner]++;
  }
  const n = Math.max(1, runs);
  return { win: tally.attacker / n, draw: tally.draw / n, loss: tally.defender / n };
}
