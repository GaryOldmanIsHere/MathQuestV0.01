import type { Character, ClassDef, Element, Gender, GateStat, PromotionReq, Stats } from './types';
import { genderCompatible } from './types';
import { classOf, findItemByName } from '../data/registry';
import { defaultGearFor, shedForbiddenGear, type Inventory } from './items';
import { claimName, FEMALE_NAMES, freshName, MALE_NAMES, MONSTER_NAMES, pick, rng } from '../data/names';

let nextCharId = 1;

const STAT_KEYS: (keyof Stats)[] = ['hp', 'str', 'vit', 'int', 'men', 'agi', 'dex'];

/** Ogre Battle 64 caps every stat here (func_8016EBC4). */
export const STAT_CAP = 999;

/** Human recruits roll one of the four natural elements; monsters have their own. */
const RECRUIT_ELEMENTS: Element[] = ['wind', 'flame', 'earth', 'water'];

/**
 * The class a unit of `classId` actually is at `level`. Ogre Battle 64 fields
 * a "Paladin" below level 15 as a Knight, and below 6 as a Fighter
 * (func_8016EA54). Classes without lineage are always themselves.
 */
export function classAtLevel(classId: string, level: number): string {
  const l = classOf(classId).lineage;
  if (!l) return classId;
  if (l.tier1 && l.tier2Level && level < l.tier2Level) return l.tier1;
  if (l.tier2 && l.tier3Level && level < l.tier3Level) return l.tier2;
  return classId;
}

/**
 * One level's gains for a class, rolled as the game rolls them: the class's
 * growth plus 0, 1 or 2 (two coin flips) per stat (func_8016EBC4).
 */
export function rollGrowth(def: ClassDef): Stats {
  const out = {} as Stats;
  for (const k of STAT_KEYS) {
    out[k] = def.growth[k] + (rng() < 0.5 ? 0 : 1) + (rng() < 0.5 ? 0 : 1);
  }
  return out;
}

function addCapped(a: Stats, b: Stats): Stats {
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = Math.min(STAT_CAP, a[k] + b[k]);
  return out;
}

/** The built-in classes' deterministic stats: base plus growth for each level past the first. */
export function statsAt(classId: string, level: number): Stats {
  const def = classOf(classId);
  const lv = level - 1;
  const out = {} as Stats;
  for (const k of STAT_KEYS) out[k] = Math.floor(def.base[k] + def.growth[k] * lv);
  return out;
}

/**
 * A new unit's stats. Ogre Battle 64 classes are raised the way the game
 * raises them (func_8016F13C): start from the base stats of the class the unit
 * was at level 1, then one level-up per level, each grown as the class the
 * unit was *at that level*. A level-20 Paladin grew as a Fighter to 6, a
 * Knight to 15, and a Paladin after.
 */
export function generateStats(classId: string, level: number): Stats {
  const def = classOf(classId);
  if (def.source !== 'ob64') return statsAt(classId, level);
  let stats = { ...(def.startBase ?? classOf(classAtLevel(classId, 1)).base) };
  for (let lv = 1; lv < level; lv++) {
    stats = addCapped(stats, rollGrowth(classOf(classAtLevel(classId, lv))));
  }
  return stats;
}

export function makeCharacter(classId: string, level: number, opts?: {
  name?: string;
  ali?: number;
  luk?: number;
  element?: Element;
  /** For classes open to either gender; otherwise the class decides. */
  gender?: Gender;
}): Character {
  const requested = classOf(classId);
  // The game fields a high class below its level as the ancestor it still is.
  const actualId = requested.source === 'ob64' ? classAtLevel(classId, level) : classId;
  const def = classOf(actualId);
  const stats = generateStats(classId, level);
  const gender: Gender = def.gender === 'A' ? opts?.gender ?? (rng() < 0.5 ? 'M' : 'F') : def.gender;
  const namePool = gender === 'M' ? MALE_NAMES : gender === 'F' ? FEMALE_NAMES : MONSTER_NAMES;
  return {
    id: nextCharId++,
    name: opts?.name ? (claimName(opts.name), opts.name) : freshName(namePool),
    classId: actualId,
    gender,
    level,
    exp: 0,
    luk: opts?.luk ?? def.startLuck ?? 50,
    ali: opts?.ali ?? def.startAlignment ?? 30 + Math.floor(rng() * 40),
    element: opts?.element ?? def.element ?? pick(RECRUIT_ELEMENTS),
    stats,
    gear: defaultGearFor(def),
    hp: stats.hp,
    kills: 0,
  };
}

export function expToNext(level: number): number {
  return 40 + level * 25;
}

/** Grant exp; returns number of levels gained. */
export function grantExp(c: Character, amount: number): number {
  c.exp += amount;
  let ups = 0;
  while (c.exp >= expToNext(c.level)) {
    c.exp -= expToNext(c.level);
    c.level++;
    ups++;
  }
  if (ups > 0) {
    const def = classOf(c.classId);
    const hpRatio = c.stats.hp > 0 ? c.hp / c.stats.hp : 1;
    if (def.source === 'ob64') {
      // Each level grows as the unit's current class, on top of what it has.
      for (let i = 0; i < ups; i++) c.stats = addCapped(c.stats, rollGrowth(def));
    } else {
      c.stats = statsAt(c.classId, c.level);
    }
    c.hp = Math.max(1, Math.floor(c.stats.hp * hpRatio));
  }
  return ups;
}

/** The item a class change spends, if the dataset has it. */
export function routeItemId(req: PromotionReq): string | null {
  return req.item ? findItemByName(req.item)?.id ?? null : null;
}

/**
 * Whether a unit may take a class change. A route that spends an item needs
 * that item in the inventory given; without an inventory it stays shut.
 */
export function meetsReq(c: Character, req: PromotionReq, inv?: Inventory): boolean {
  if (!genderCompatible(c.gender, classOf(req.classId).gender)) return false;
  if (req.item) {
    const id = routeItemId(req);
    if (!inv || !id || !inv[id]) return false;
  }
  if (c.level < req.level) return false;
  for (const [k, min] of Object.entries(req.stats ?? {}) as [GateStat, number][]) {
    if (c.stats[k] < min) return false;
  }
  if (req.aliMin !== undefined && c.ali < req.aliMin) return false;
  if (req.aliMax !== undefined && c.ali > req.aliMax) return false;
  return true;
}

export function availablePromotions(c: Character, inv?: Inventory): PromotionReq[] {
  return classOf(c.classId).promotesTo.filter((req) => meetsReq(c, req, inv));
}

/** Every class change this character's class offers that their gender can take. */
export function allPromotions(c: Character): PromotionReq[] {
  return classOf(c.classId).promotesTo.filter((req) => genderCompatible(c.gender, classOf(req.classId).gender));
}

/**
 * Class change. In Ogre Battle 64 a unit keeps its own stats and only its
 * future growth changes; the built-in classes re-derive stats instead. An
 * item the route calls for is spent, and gear the new class cannot use
 * goes back to the inventory.
 */
export function promote(c: Character, classId: string, inv?: Inventory): void {
  const req = classOf(c.classId).promotesTo.find((r) => r.classId === classId);
  if (!req || !meetsReq(c, req, inv)) throw new Error(`${c.name} cannot become ${classId}`);
  const spend = routeItemId(req);
  if (spend && inv) {
    inv[spend]--;
    if (inv[spend] <= 0) delete inv[spend];
  }
  c.classId = classId;
  if (inv) shedForbiddenGear(c, inv);
  if (classOf(classId).source !== 'ob64') {
    c.stats = statsAt(classId, c.level);
    c.hp = c.stats.hp;
  }
}

/** OB64-style alignment drift: felling stronger foes is honorable. */
export function shiftAlignment(c: Character, victimLevel: number): void {
  const diff = victimLevel - c.level;
  const delta = diff >= 2 ? 2 : diff >= 0 ? 1 : diff >= -2 ? -1 : -2;
  c.ali = Math.max(0, Math.min(100, c.ali + delta));
}
