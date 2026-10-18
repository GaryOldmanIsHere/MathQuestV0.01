import type { Character, ClassDef, March, Row, Squad } from './types';
import { CELL_ROW } from './types';
import { classOf } from '../data/registry';
import { pick, SQUAD_NAMES } from '../data/names';

let nextSquadId = 1;

export function makeSquad(
  side: 'player' | 'enemy',
  members: { char: Character; cell: number }[],
  leader: Character,
  nodeId: number,
  x: number,
  y: number,
  name?: string,
): Squad {
  const grid: (number | null)[] = new Array(9).fill(null);
  for (const m of members) grid[m.cell] = m.char.id;
  return {
    id: nextSquadId++,
    name: name ?? pick(SQUAD_NAMES),
    side,
    grid,
    leaderId: leader.id,
    nodeId,
    x,
    y,
    targetX: null,
    targetY: null,
    moving: false,
  };
}

/** A squad holds five places; a large unit fills two of them. */
export const SQUAD_PLACES = 5;

/** Each member once, though a large one stands in two cells. */
export function squadMemberIds(sq: Squad): number[] {
  return [...new Set(sq.grid.filter((id): id is number => id !== null))];
}

/** The cells a member stands in: one, or two side by side for a large unit. */
export function cellsOf(sq: Squad, charId: number): number[] {
  return sq.grid.flatMap((id, cell) => (id === charId ? [cell] : []));
}

/** A member's battle row: the row of the foremost cell it stands in. */
export function memberRow(sq: Squad, charId: number): Row {
  const cells = cellsOf(sq, charId);
  const front = cells.reduce((best, c) => (c % 3 > best % 3 ? c : best), cells[0]);
  return CELL_ROW[front];
}

/** How many of the squad's five places are taken. */
export function placesUsed(sq: Squad): number {
  return squadMemberIds(sq).reduce((n, id) => n + (cellsOf(sq, id).length > 1 ? 2 : 1), 0);
}

/**
 * The cells a unit of `size` would take with its anchor at `cell`: the cell
 * itself, and for a large unit the cell beside it toward the front (or, on
 * the front column, toward the back). Null if the grid edge forbids it.
 */
export function footprint(cell: number, size: 1 | 2): number[] | null {
  if (size === 1) return [cell];
  const col = cell % 3;
  return col < 2 ? [cell, cell + 1] : [cell - 1, cell];
}

/**
 * Put a unit at `cell` (moving it if it is already in the squad). Fails if
 * the cells are taken by someone else or the squad has no room.
 */
export function placeAt(sq: Squad, char: Character, cell: number): boolean {
  const size = classOf(char.classId).size;
  const cells = footprint(cell, size);
  if (!cells) return false;
  if (cells.some((c) => sq.grid[c] !== null && sq.grid[c] !== char.id)) return false;
  const already = sq.grid.includes(char.id);
  if (!already && placesUsed(sq) + size > SQUAD_PLACES) return false;
  for (let c = 0; c < 9; c++) if (sq.grid[c] === char.id) sq.grid[c] = null;
  for (const c of cells) sq.grid[c] = char.id;
  return true;
}

/**
 * How a class marches. Translated classes say; for the rest it follows from
 * movement and role: fliers fly, back-rank casters and healers are slow,
 * classes that cross rough ground freely are light, everyone else is heavy.
 */
export function marchOf(def: ClassDef): March {
  if (def.march) return def.march;
  if (def.moveType === 'fly') return 'fly';
  const back = def.attacks.back;
  if (def.gender !== 'X' && def.preferredRow === 'back' && (back?.type === 'magic' || back?.type === 'heal')) return 'slow';
  if (def.moveType === 'fast') return 'light';
  return 'heavy';
}

export const SQUAD_TYPE_LABEL: Record<March, string> = {
  slow: 'Slow infantry',
  heavy: 'Heavy infantry',
  light: 'Light infantry',
  heavyCav: 'Heavy cavalry',
  lightCav: 'Light cavalry',
  fly: 'Flying',
};

/**
 * The squad's type, from its make-up, by Symphony of War's rules:
 *   - flying when fliers are at least as many as everyone else, with no
 *     horses and no large unit that cannot fly to hold it down;
 *   - cavalry when horses outnumber the infantry: light cavalry if light
 *     troops are the majority, heavy otherwise;
 *   - slow when at least half are casters and healers;
 *   - light when light troops outnumber heavy and slow together by one;
 *   - heavy infantry otherwise.
 * Fliers in a squad that cannot fly march with it as light troops.
 */
export function squadType(chars: Character[]): March {
  const n = { slow: 0, heavy: 0, light: 0, heavyCav: 0, lightCav: 0, fly: 0 };
  let grounded = false;
  for (const c of chars) {
    const def = classOf(c.classId);
    const m = marchOf(def);
    n[m]++;
    if (def.size === 2 && m !== 'fly') grounded = true;
  }
  if (chars.length === 0) return 'heavy';
  const horses = n.heavyCav + n.lightCav;
  const walkers = n.slow + n.heavy + n.light;
  if (n.fly > 0 && horses === 0 && !grounded && n.fly >= walkers) return 'fly';
  const light = n.light + n.fly;
  const infantry = walkers + n.fly;
  if (horses > infantry) {
    return light + n.lightCav > n.heavyCav + n.heavy + n.slow ? 'lightCav' : 'heavyCav';
  }
  if (n.slow * 2 >= chars.length) return 'slow';
  if (light >= n.heavy + n.slow + 1 && horses < infantry) return 'light';
  return 'heavy';
}

/** Base march speed in px per second: Symphony of War's movement 5 / 6 / 7. */
export function moveSpeed(t: March): number {
  switch (t) {
    case 'slow': return 24;
    case 'heavy': case 'light': return 29;
    default: return 35;
  }
}

/**
 * Auto-place a character in a sensible cell for their class's preferred row.
 * A large unit takes two cells side by side, front pair first.
 */
export function autoPlace(sq: Squad, char: Character): boolean {
  const def = classOf(char.classId);
  if (placesUsed(sq) + def.size > SQUAD_PLACES) return false;
  const order: Row[] =
    def.preferredRow === 'front' ? ['front', 'mid', 'back'] :
    def.preferredRow === 'back' ? ['back', 'mid', 'front'] : ['mid', 'front', 'back'];
  for (const row of order) {
    const col = row === 'back' ? 0 : row === 'mid' ? 1 : 2;
    for (const r of [1, 0, 2]) {
      if (placeAt(sq, char, r * 3 + col)) return true;
    }
  }
  return false;
}
