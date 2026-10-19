// Core shared types for the strategy layer and battle simulation.

import type { EquipRules, Gear } from './items';

/** M and F are gendered human lines, X monsters and demi-humans, A a human class open to either. */
export type Gender = 'M' | 'F' | 'X' | 'A';

export type Row = 'front' | 'mid' | 'back';

export type DamageType = 'melee' | 'ranged' | 'magic' | 'heal';

export type MoveType = 'foot' | 'fast' | 'fly';

/**
 * What a member contributes to its squad's march, after Symphony of War's
 * squad types: casters and healers are slow, light troops are not hindered by
 * terrain, cavalry is quick, fliers ignore the ground. The squad as a whole
 * marches as the type its make-up adds up to (see squadType in squad.ts).
 */
export type March = 'slow' | 'heavy' | 'light' | 'heavyCav' | 'lightCav' | 'fly';

/** The elements, in the order Ogre Battle 64's own element table lists them. */
export const ELEMENTS = ['wind', 'flame', 'earth', 'water', 'virtue', 'bane', 'drakonite'] as const;
export type Element = (typeof ELEMENTS)[number];

/** What a class resists: physical blows plus each magical element. 50 = neutral. */
export const RESIST_KEYS = ['physical', 'wind', 'flame', 'earth', 'water', 'virtue', 'bane'] as const;
export type ResistKey = (typeof RESIST_KEYS)[number];
export type Resistances = Record<ResistKey, number>;

export interface Stats {
  hp: number;
  str: number;
  vit: number;
  int: number;
  men: number; // mentality: magic defense
  agi: number;
  dex: number; // dexterity: accuracy and the bow
}

/** Stats a class change can demand a minimum of. */
export type GateStat = Exclude<keyof Stats, 'hp'>;

/** Spells whose actual form depends on the caster's own element. */
export type SpellKind = 'basic' | 'advanced' | 'status' | 'summon';

export interface RowAttack {
  name: string;
  type: DamageType;
  count: number; // number of strikes
  power: number; // multiplier on STR (melee/ranged) or INT (magic/heal)
  target: 'one' | 'row' | 'all' | 'allies';
  element?: Element;
  /**
   * When set, the attack is a slot rather than a fixed spell: it resolves at
   * battle time to the spell of this kind matching the caster's element.
   */
  spell?: SpellKind;
}

export interface PromotionReq {
  classId: string;
  level: number;
  /** Minimum stat values. */
  stats?: Partial<Record<GateStat, number>>;
  aliMin?: number; // minimum alignment (0 chaotic .. 100 lawful)
  aliMax?: number; // maximum alignment
  /** An item the change consumes. Items arrive in Phase 2; until then such routes stay locked. */
  item?: string;
}

/**
 * Promotion lineage, as Ogre Battle 64 records it: below `tier2Level` a unit of
 * this class is still its tier-1 ancestor, below `tier3Level` its tier-2 one.
 */
export interface Lineage {
  tier1?: string;
  tier2Level?: number;
  tier2?: string;
  tier3Level?: number;
}

export interface ClassDef {
  id: string;
  name: string;
  gender: Gender;
  tier: 1 | 2 | 3 | 4;
  desc: string;
  base: Stats;
  growth: Stats; // per-level gains
  attacks: Partial<Record<Row, RowAttack>>;
  promotesTo: PromotionReq[];
  moveType: MoveType;
  /** How the class marches; derived from its movement and role when not given. */
  march?: March;
  preferredRow: Row;
  sprite: string; // sprite sheet key
  palette: string; // palette variant
  resist: Resistances;
  /** Large units (dragons, golems, great beasts) fill two places in a squad. */
  size: 1 | 2;
  /** Fixed element (monsters); humans roll theirs when recruited. */
  element?: Element;
  lineage?: Lineage;
  /**
   * Where a unit of this class starts at level 1, when it has no lineage to
   * be raised through but should not start from its own high-tier base
   * (translated classes no route leads into, on Ogre Battle 64's data).
   */
  startBase?: Stats;
  startAlignment?: number;
  startLuck?: number;
  /** Whether the player can reach this class (story and boss classes cannot). */
  playable: boolean;
  /**
   * Whose rules the class follows: Ogre Battle 64's (rolled growth, stats kept
   * on a class change) or the built-in originals'. Classes translated from
   * other games follow the rules of the dataset they joined.
   */
  source: 'ob64' | 'builtin';
  /** The game a class was taken from, where that is not the dataset itself. */
  origin?: 'snes' | 'sow';
  /** What gear the class can use; derived from its weapon and role when not given. */
  equip?: EquipRules;
  /** What a fresh unit of the class carries (Ogre Battle 64's class records name it). */
  defaultGear?: Partial<Gear>;
  /** The class's number in Ogre Battle 64's class table, for its sprites. */
  ob64Id?: number;
  /** An Ogre Battle 64 class whose sprites this class borrows (translated classes). */
  spriteOf?: number;
}

export interface Character {
  id: number;
  name: string;
  classId: string;
  gender: Gender;
  level: number;
  exp: number;
  luk: number; // luck 0-100
  ali: number; // alignment 0 (chaotic) - 100 (lawful)
  element: Element;
  /** Base stats; gear adds to them (see effectiveStats). */
  stats: Stats;
  gear: Gear;
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

/** Whether a unit of one gender can hold a class of another: A is open to either human gender. */
export function genderCompatible(unit: Gender, target: Gender): boolean {
  if (target === 'A') return unit !== 'X';
  if (unit === 'A') return target !== 'X';
  return unit === target;
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
