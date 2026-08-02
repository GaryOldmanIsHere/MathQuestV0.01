// Core shared types for the strategy layer and battle simulation.

export type Gender = 'M' | 'F' | 'X'; // X = monster/demi-human

export type Row = 'front' | 'mid' | 'back';

export type DamageType = 'melee' | 'ranged' | 'magic' | 'heal';

export type MoveType = 'foot' | 'fast' | 'fly';

export interface Stats {
  hp: number;
  str: number;
  vit: number;
  int: number;
  men: number; // mentality: magic defense
  agi: number;
}

export interface RowAttack {
  name: string;
  type: DamageType;
  count: number; // number of strikes
  power: number; // multiplier on STR (melee/ranged) or INT (magic/heal)
  target: 'one' | 'row' | 'all' | 'allies';
  element?: 'fire' | 'ice' | 'thunder' | 'dark' | 'holy';
}

export interface PromotionReq {
  classId: string;
  level: number;
  cha?: number; // minimum charisma
  aliMin?: number; // minimum alignment (0 chaotic .. 100 lawful)
  aliMax?: number; // maximum alignment
}

export interface ClassDef {
  id: string;
  name: string;
  gender: Gender;
  tier: 1 | 2 | 3;
  desc: string;
  base: Stats;
  growth: Stats; // per-level gains
  attacks: Partial<Record<Row, RowAttack>>;
  promotesTo: PromotionReq[];
  moveType: MoveType;
  preferredRow: Row;
  sprite: string; // sprite sheet key
  palette: string; // palette variant
}

export interface Character {
  id: number;
  name: string;
  classId: string;
  gender: Gender;
  level: number;
  exp: number;
  cha: number; // charisma 0-100
  ali: number; // alignment 0 (chaotic) - 100 (lawful)
  stats: Stats;
  hp: number; // current hp
  kills: number;
}

// A squad is an Ogre Battle "unit": up to 5 members on a 3x3 grid.
// Grid cells are indexed 0..8: columns are rows-of-battle (front/mid/back).
export interface Squad {
  id: number;
  name: string;
  side: 'player' | 'enemy';
  // grid[cell] = character id or null. Cell layout (facing right):
  //   back  mid  front
  //    0     1     2
  //    3     4     5
  //    6     7     8
  grid: (number | null)[];
  leaderId: number;
  // Overworld position/state. Squads move freely: a destination is an
  // arbitrary map point, not a stronghold or a step along a road.
  nodeId: number; // last stronghold occupied, for AI and rally purposes
  x: number;
  y: number;
  targetX: number | null;
  targetY: number | null;
  moving: boolean;
}

export interface MapNode {
  id: number;
  name: string;
  x: number;
  y: number;
  kind: 'hq-player' | 'hq-enemy' | 'town' | 'fort';
  owner: 'player' | 'enemy' | 'neutral';
  /**
   * Strongholds this one is joined to by road. Roads no longer gate movement —
   * squads may march anywhere — they only lay down faster ground and draw the
   * map's road network.
   */
  links: number[];
}

export const CELL_ROW: Row[] = [
  'back', 'mid', 'front',
  'back', 'mid', 'front',
  'back', 'mid', 'front',
];

export function rowCells(row: Row): number[] {
  const col = row === 'back' ? 0 : row === 'mid' ? 1 : 2;
  return [col, col + 3, col + 6];
}
