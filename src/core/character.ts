import type { Character, Gender, PromotionReq, Stats } from './types';
import { classOf } from '../data/classes';
import { FEMALE_NAMES, MALE_NAMES, MONSTER_NAMES, pick, rng } from '../data/names';

let nextCharId = 1;

export function makeCharacter(classId: string, level: number, opts?: {
  name?: string;
  ali?: number;
  cha?: number;
}): Character {
  const def = classOf(classId);
  const stats = statsAt(classId, level);
  const namePool = def.gender === 'M' ? MALE_NAMES : def.gender === 'F' ? FEMALE_NAMES : MONSTER_NAMES;
  return {
    id: nextCharId++,
    name: opts?.name ?? pick(namePool),
    classId,
    gender: def.gender,
    level,
    exp: 0,
    cha: opts?.cha ?? 40 + Math.floor(rng() * 30),
    ali: opts?.ali ?? 30 + Math.floor(rng() * 40),
    stats,
    hp: stats.hp,
    kills: 0,
  };
}

export function statsAt(classId: string, level: number): Stats {
  const def = classOf(classId);
  const lv = level - 1;
  return {
    hp: Math.floor(def.base.hp + def.growth.hp * lv),
    str: Math.floor(def.base.str + def.growth.str * lv),
    vit: Math.floor(def.base.vit + def.growth.vit * lv),
    int: Math.floor(def.base.int + def.growth.int * lv),
    men: Math.floor(def.base.men + def.growth.men * lv),
    agi: Math.floor(def.base.agi + def.growth.agi * lv),
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
    const hpRatio = c.stats.hp > 0 ? c.hp / c.stats.hp : 1;
    c.stats = statsAt(c.classId, c.level);
    c.hp = Math.max(1, Math.floor(c.stats.hp * hpRatio));
  }
  return ups;
}

export function meetsReq(c: Character, req: PromotionReq): boolean {
  if (c.level < req.level) return false;
  if (req.cha !== undefined && c.cha < req.cha) return false;
  if (req.aliMin !== undefined && c.ali < req.aliMin) return false;
  if (req.aliMax !== undefined && c.ali > req.aliMax) return false;
  return true;
}

export function availablePromotions(c: Character): PromotionReq[] {
  return classOf(c.classId).promotesTo.filter((req) => meetsReq(c, req));
}

export function allPromotions(c: Character): PromotionReq[] {
  return classOf(c.classId).promotesTo;
}

/** Class change: stats re-derive from the new class at the current level. */
export function promote(c: Character, classId: string): void {
  const req = classOf(c.classId).promotesTo.find((r) => r.classId === classId);
  if (!req || !meetsReq(c, req)) throw new Error(`${c.name} cannot become ${classId}`);
  c.classId = classId;
  c.stats = statsAt(classId, c.level);
  c.hp = c.stats.hp;
}

/** OB64-style alignment drift: felling stronger foes is honorable. */
export function shiftAlignment(c: Character, victimLevel: number): void {
  const diff = victimLevel - c.level;
  const delta = diff >= 2 ? 2 : diff >= 0 ? 1 : diff >= -2 ? -1 : -2;
  c.ali = Math.max(0, Math.min(100, c.ali + delta));
}
