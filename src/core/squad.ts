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

export function squadMemberIds(sq: Squad): number[] {
  return sq.grid.filter((id): id is number => id !== null);
}

export function memberRow(sq: Squad, charId: number): Row {
  const cell = sq.grid.indexOf(charId);
  return CELL_ROW[cell];
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

/** Auto-place a character in a sensible cell for their class's preferred row. */
export function autoPlace(sq: Squad, char: Character): boolean {
  const def = classOf(char.classId);
  const order: Row[] =
    def.preferredRow === 'front' ? ['front', 'mid', 'back'] :
    def.preferredRow === 'back' ? ['back', 'mid', 'front'] : ['mid', 'front', 'back'];
  for (const row of order) {
    const col = row === 'back' ? 0 : row === 'mid' ? 1 : 2;
    for (const r of [1, 0, 2]) {
      const cell = r * 3 + col;
      if (sq.grid[cell] === null && squadMemberIds(sq).length < 5) {
        sq.grid[cell] = char.id;
        return true;
      }
    }
  }
  return false;
}
