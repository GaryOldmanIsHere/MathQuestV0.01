import type { Character, MoveType, Row, Squad } from './types';
import { CELL_ROW } from './types';
import { classOf } from '../data/classes';
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
    targetNodeId: null,
    pathNodes: [],
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

/** March speed: the squad moves at the pace of its slowest member. */
export function squadMoveType(chars: Character[]): MoveType {
  if (chars.length === 0) return 'foot';
  if (chars.every((c) => classOf(c.classId).moveType === 'fly')) return 'fly';
  if (chars.every((c) => classOf(c.classId).moveType !== 'foot')) return 'fast';
  return 'foot';
}

export function moveSpeed(mt: MoveType): number {
  return mt === 'fly' ? 46 : mt === 'fast' ? 36 : 28; // px per second on the overworld
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
