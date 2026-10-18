// The shape of the class facts scraped from the two source games by
// tools/scrape-expansion.ts, and stored in src/data/expansion/. Facts only:
// numbers, names and which class leads to which. No prose is kept.

export interface SnesClass {
  name: string;
  family: string;
  /** How the class is reached: from a class at a level, by an item, or not at all (a root). */
  from: string | null;
  level: number | null;
  cha: number | null;
  aliMin: number | null;
  aliMax: number | null;
  item: string | null;
  /** A form the class takes rather than a promotion (Vampyre by day). */
  formOf: string | null;
  hp: [number, number];
  str: [number, number];
  agi: [number, number];
  int: [number, number];
  cha0: number;
  ali0: number;
  luk0: number;
  /**
   * Affinities: Physical, Fire, Ice, Electric, Black, White. Null where the
   * source gives none: the SNES undead take no harm except from holy power.
   */
  aff: { p: number | null; f: number | null; i: number | null; e: number | null; b: number | null; w: number | null };
  terrain: string;
  bulk: number;
  large: boolean;
  front: { attack: string; hits: number };
  back: { attack: string; hits: number };
}

export interface SowAttack {
  kind: 'melee' | 'ranged' | 'magic' | 'heal' | 'other';
  /** lightning, fire, ice, dark, holy... as the wiki words it, if any. */
  element: string | null;
  area: string | null;
  range: string | null;
}

export interface SowClass {
  name: string;
  /** The class-table section: 1-4, or unique / dlc / risen / other. */
  group: string;
  tier: number | null;
  type: string;
  movement: string;
  leader: boolean;
  /** Stat minimums to enter the class, as the wiki states them ("21 STR"). */
  reqs: Record<string, number>;
  into: string[];
  /** Ancestor classes by tier ("Upgrade tier 1 units: Fighter"). */
  ancestors: Record<string, string[]>;
  /**
   * Each stat's base and growth as the wiki rates them (Low / Med / High ...).
   * Every class page gives these, so translation works from them throughout.
   */
  ratings: Record<string, { base: string; growth: string }>;
  /** [level 1, level 54] values, on the pages that give numbers too. */
  levels: Record<string, [number | null, number | null]>;
  /** The class's place in the battle order ("Heavy (10th)", "Magic (7th)", "Healing (12th)"). */
  battleOrder: string;
  /** Reach of its special attack, read from its traits: "row", "column" or "area". */
  area: string | null;
  traits: string[];
  attacks: SowAttack[];
  categories: string[];
}
