import type { Character, ClassDef, Element, Resistances, Stats } from './types';
import { RESIST_KEYS } from './types';
import { allItems, classOf, hasItemDef, itemOf } from '../data/registry';
import { rng } from '../data/names';

// Equipment, supplies and key items, after Ogre Battle 64.
//
// Every unit has four places for gear, as the game's class records do: a
// weapon, body armour, an off hand (a shield or a book, or an accessory) and
// a head (a helm or hat, or an accessory). Gear adds to a unit's stats and
// resistances; a weapon's element rides on its wielder's blows. Supplies heal
// and revive, relics raise a stat for good, and key items open the class
// changes that call for them.

export const WEAPON_TYPES = [
  'sword', 'greatsword', 'rapier', 'axe', 'hammer', 'spear', 'whip', 'claw', 'bow', 'mace', 'staff', 'doll', 'fan',
] as const;
export const OFFHAND_TYPES = ['shield', 'greatshield', 'book'] as const;
export const BODY_TYPES = ['light', 'medium', 'heavy', 'robe', 'clothing'] as const;
export const HEAD_TYPES = ['helm', 'hat'] as const;

export type WeaponType = (typeof WEAPON_TYPES)[number];
export type ItemType =
  | WeaponType
  | (typeof OFFHAND_TYPES)[number]
  | (typeof BODY_TYPES)[number]
  | (typeof HEAD_TYPES)[number]
  | 'accessory';

export type Slot = 'weapon' | 'body' | 'offhand' | 'head';
export const SLOTS: Slot[] = ['weapon', 'body', 'offhand', 'head'];

/** Where each type of gear goes. An accessory fits either the off hand or the head. */
export function slotsFor(type: ItemType): Slot[] {
  if ((WEAPON_TYPES as readonly string[]).includes(type)) return ['weapon'];
  if ((OFFHAND_TYPES as readonly string[]).includes(type)) return ['offhand'];
  if ((BODY_TYPES as readonly string[]).includes(type)) return ['body'];
  if ((HEAD_TYPES as readonly string[]).includes(type)) return ['head'];
  return ['offhand', 'head'];
}

/** Weapons that take both hands: no shield beside them. */
export const TWO_HANDED: ReadonlySet<ItemType> = new Set<ItemType>(['greatsword', 'hammer', 'bow']);

export type BonusKey = 'str' | 'vit' | 'int' | 'men' | 'agi' | 'dex' | 'luk';
export const BONUS_KEYS: BonusKey[] = ['str', 'vit', 'int', 'men', 'agi', 'dex', 'luk'];

/** Creatures some weapons are made to kill. */
export type Family = 'dragon' | 'undead';

export interface ItemEffect {
  /** Fraction of maximum HP restored to the living. */
  heal?: number;
  /** A fallen unit rises with this fraction of its maximum HP. */
  revive?: number;
  /** Permanent stat gains. */
  stats?: Partial<Stats>;
  /** Permanent Luck gain. */
  luk?: number;
  /** Alignment shift (positive is lawful). */
  ali?: number;
  /** Levels gained. */
  level?: number;
  /** Each squad member's alignment moves this far toward the leader's. */
  unify?: number;
  /** The squad is carried home to its headquarters. */
  rally?: boolean;
}

export interface ItemDef {
  id: string;
  name: string;
  /** gear is worn; supplies and relics are used up; key items are kept or spent on a class change. */
  kind: 'gear' | 'supply' | 'relic' | 'key';
  price: number;
  /** How far into the campaign it turns up: shops stock what their rank allows. */
  rank: number;
  forSale: boolean;
  desc?: string;
  // gear
  type?: ItemType;
  element?: Element;
  bonus?: Partial<Record<BonusKey, number>>;
  resist?: Partial<Resistances>;
  slays?: Family[];
  // supplies and relics
  effect?: ItemEffect;
  target?: 'unit' | 'squad';
  source: 'ob64' | 'builtin' | 'expansion';
}

/** Which types of gear a class can use in each place. */
export type EquipRules = Record<Slot, ItemType[]>;
export type Gear = Record<Slot, string | null>;
export type Inventory = Record<string, number>;

export const NO_GEAR: Gear = { weapon: null, body: null, offhand: null, head: null };

// ------------------------------------------------------------- equip rules --

const CASTER_TEXT = /magic|spell|fire|frost|ice|thunder|lightning|bolt|heal|mend|banish|jihad|curse|nightmare|meteor|stun|charm|kiss/;

/** The weapon a class fights with, read from its own attacks and name. */
export function weaponTypeFor(def: ClassDef): WeaponType {
  const physical = (['front', 'mid', 'back'] as const)
    .map((r) => def.attacks[r])
    .filter((a) => a && (a.type === 'melee' || a.type === 'ranged'))
    .map((a) => a!.name.toLowerCase());
  const text = `${def.name.toLowerCase()} ${physical.join(' ')}`;
  if (def.attacks.back?.type === 'ranged' && /arrow|bow|bolt|shot/.test(text)) return 'bow';
  if (/archer|bowman|crossbow|arbalest|warbow|horsebow|raider|hussar|diana/.test(text)) return 'bow';
  if (/spear|lance|pike|trident|javelin|thrust|phalanx|centurion|sentinel|valkyrie|dragoon/.test(text)) return 'spear';
  if (/greatsword|zweihander|claymore|champion|sword master/.test(text)) return 'greatsword';
  if (/whip|beast/.test(text)) return 'whip';
  if (/rapier|fencer|estoc|tamer/.test(text)) return 'rapier';
  if (/doll|puppet/.test(text)) return 'doll';
  if (/claw|shuriken|ninja|assassin/.test(text)) return 'claw';
  if (/axe|chop|cleave|berserk|wild/.test(text)) return 'axe';
  if (/hammer|club|maul|smash|black knight/.test(text)) return 'hammer';
  if (/fan|stardust|princess/.test(text)) return 'fan';
  if (/mace|ankh|cleric|priest|shaman|monk|medic|hospital/.test(text)) return 'mace';
  if (/blade|sword|slash|brand|knight/.test(text)) return 'sword';
  const back = def.attacks.back;
  if (back?.type === 'heal') return 'mace';
  if (def.preferredRow === 'back' && back?.type === 'magic') return 'staff';
  if (physical.length === 0 && [...Object.values(def.attacks)].some((a) => a && CASTER_TEXT.test(a.name.toLowerCase()))) {
    return 'staff';
  }
  return 'sword';
}

/**
 * What a class may wear, for classes the source data says nothing about: by
 * the weapon it fights with and the place it fights from. Monsters wear
 * accessories only.
 */
export function deriveEquipRules(def: ClassDef): EquipRules {
  if (def.gender === 'X') return { weapon: [], body: [], offhand: ['accessory'], head: ['accessory'] };
  const weapon = weaponTypeFor(def);
  const back = def.attacks.back;
  const caster = def.preferredRow === 'back' && (back?.type === 'magic' || back?.type === 'heal');
  const twoHanded = TWO_HANDED.has(weapon);
  if (caster) {
    return { weapon: [weapon], body: ['robe', 'clothing'], offhand: ['book', 'accessory'], head: ['hat', 'accessory'] };
  }
  const march = def.march ?? (def.moveType === 'fast' ? 'light' : 'heavy');
  const light = march === 'light' || march === 'lightCav' || weapon === 'bow' || weapon === 'claw' || weapon === 'whip';
  if (light) {
    return {
      weapon: [weapon],
      body: ['light', 'clothing'],
      offhand: twoHanded || weapon === 'claw' || weapon === 'whip' ? ['accessory'] : ['shield', 'accessory'],
      head: ['hat', 'accessory'],
    };
  }
  return {
    weapon: [weapon],
    body: ['heavy', 'medium', 'light'],
    offhand: twoHanded ? ['accessory'] : ['greatshield', 'shield', 'accessory'],
    head: ['helm', 'hat', 'accessory'],
  };
}

export function equipRulesOf(def: ClassDef): EquipRules {
  return def.equip ?? deriveEquipRules(def);
}

/** The best gear a fresh unit of a class carries: the finest item it may use that a tier's recruit would own. */
export function defaultGearFor(def: ClassDef): Gear {
  const gear: Gear = { ...NO_GEAR };
  if (def.defaultGear) {
    for (const slot of SLOTS) {
      const id = def.defaultGear[slot];
      if (id && hasItemDef(id)) gear[slot] = id;
    }
    return gear;
  }
  const rules = equipRulesOf(def);
  const cap = [0, 1, 3, 5, 7][def.tier];
  // The best plain item: no element first (a recruit is not issued a Flame
  // Shield), then highest rank, then the class's own first choice of type
  // (plate before leather for a knight, a robe before clothing), then price.
  const best = (slot: Slot, types: ItemType[]) => allItems()
    .filter((i) => i.kind === 'gear' && i.forSale && i.type && types.includes(i.type) && i.rank <= cap)
    .sort((a, b) => Number(!!a.element) - Number(!!b.element) || b.rank - a.rank ||
      types.indexOf(a.type!) - types.indexOf(b.type!) || a.price - b.price || a.id.localeCompare(b.id))[0]?.id ?? null;
  gear.weapon = best('weapon', rules.weapon);
  gear.body = best('body', rules.body);
  const weapon = gear.weapon ? itemOf(gear.weapon) : null;
  const shields = rules.offhand.filter((t) => t !== 'accessory' && !(weapon?.type && TWO_HANDED.has(weapon.type) && t !== 'book'));
  gear.offhand = best('offhand', shields);
  gear.head = best('head', rules.head.filter((t) => t !== 'accessory'));
  return gear;
}

// --------------------------------------------------------- what gear does --

function worn(c: Character): ItemDef[] {
  return SLOTS.map((s) => c.gear[s]).filter((id): id is string => !!id && hasItemDef(id)).map(itemOf);
}

export function gearBonus(c: Character): Record<BonusKey, number> {
  const out = { str: 0, vit: 0, int: 0, men: 0, agi: 0, dex: 0, luk: 0 };
  for (const item of worn(c)) for (const k of BONUS_KEYS) out[k] += item.bonus?.[k] ?? 0;
  return out;
}

/** A unit's stats with its gear on: what it fights with. */
export function effectiveStats(c: Character): Stats {
  const b = gearBonus(c);
  return {
    hp: c.stats.hp,
    str: Math.max(0, c.stats.str + b.str),
    vit: Math.max(0, c.stats.vit + b.vit),
    int: Math.max(0, c.stats.int + b.int),
    men: Math.max(0, c.stats.men + b.men),
    agi: Math.max(0, c.stats.agi + b.agi),
    dex: Math.max(0, c.stats.dex + b.dex),
  };
}

export function effectiveLuck(c: Character): number {
  return Math.max(0, Math.min(100, c.luk + gearBonus(c).luk));
}

/** The class's resistances with the unit's gear added, each held within 0..100. */
export function effectiveResist(c: Character): Resistances {
  const out = { ...classOf(c.classId).resist };
  for (const item of worn(c)) {
    for (const k of RESIST_KEYS) out[k] += item.resist?.[k] ?? 0;
  }
  for (const k of RESIST_KEYS) out[k] = Math.max(0, Math.min(100, out[k]));
  return out;
}

export function weaponOf(c: Character): ItemDef | null {
  return c.gear.weapon && hasItemDef(c.gear.weapon) ? itemOf(c.gear.weapon) : null;
}

/** What a creature is, for the weapons made to kill it. */
export function familyOf(def: ClassDef): Family | null {
  if (def.sprite === 'dragon' || /dragon|drake|wyrm|wyvern|tiamat|hydra|bahamut|salamand/i.test(def.name)) return 'dragon';
  if (/skeleton|ghost|zombie|lich|vampire|vampyre|wraith|phantom|risen|coffin|undead/i.test(def.name)) return 'undead';
  return null;
}

// ---------------------------------------------------------------- equipping --

export function canEquip(c: Character, item: ItemDef, slot: Slot): boolean {
  if (item.kind !== 'gear' || !item.type) return false;
  if (!slotsFor(item.type).includes(slot)) return false;
  if (!equipRulesOf(classOf(c.classId))[slot].includes(item.type)) return false;
  if (slot === 'offhand' && item.type !== 'accessory' && item.type !== 'book') {
    const weapon = weaponOf(c);
    if (weapon?.type && TWO_HANDED.has(weapon.type)) return false;
  }
  return true;
}

function give(inv: Inventory, id: string, n = 1): void {
  inv[id] = (inv[id] ?? 0) + n;
}

function take(inv: Inventory, id: string): boolean {
  if (!inv[id]) return false;
  inv[id]--;
  if (inv[id] <= 0) delete inv[id];
  return true;
}

/** Take a piece of gear off into the inventory. */
export function unequip(c: Character, slot: Slot, inv: Inventory): void {
  const id = c.gear[slot];
  if (!id) return;
  give(inv, id);
  c.gear[slot] = null;
}

/**
 * Put on a piece of gear from the inventory, returning what it replaces to
 * the inventory. Taking up a two-handed weapon sets down the shield.
 */
export function equip(c: Character, itemId: string, slot: Slot, inv: Inventory): boolean {
  const item = itemOf(itemId);
  if (!canEquip(c, item, slot) || !inv[itemId]) return false;
  take(inv, itemId);
  unequip(c, slot, inv);
  c.gear[slot] = itemId;
  if (slot === 'weapon' && item.type && TWO_HANDED.has(item.type)) {
    const off = c.gear.offhand ? itemOf(c.gear.offhand) : null;
    if (off && off.type !== 'accessory' && off.type !== 'book') unequip(c, 'offhand', inv);
  }
  return true;
}

/** After a class change: gear the new class cannot use comes off into the inventory. */
export function shedForbiddenGear(c: Character, inv: Inventory): void {
  for (const slot of SLOTS) {
    const id = c.gear[slot];
    if (id && (!hasItemDef(id) || !canEquip(c, itemOf(id), slot))) unequip(c, slot, inv);
  }
}

// ----------------------------------------------------------------- using --

/**
 * Use a supply or relic on a unit (and, for squad items, everyone with it).
 * Returns a line saying what happened, or null if it would do nothing, in
 * which case nothing is spent.
 */
export function useItem(itemId: string, target: Character, squad: Character[], inv: Inventory): string | null {
  const item = itemOf(itemId);
  const e = item.effect;
  if (!e || !inv[itemId]) return null;
  const who = item.target === 'squad' ? squad : [target];
  const done: string[] = [];
  if (e.heal !== undefined) {
    const hurt = who.filter((c) => c.hp > 0 && c.hp < c.stats.hp);
    for (const c of hurt) c.hp = Math.min(c.stats.hp, c.hp + Math.max(1, Math.round(c.stats.hp * e.heal)));
    if (hurt.length) done.push(`healed ${hurt.map((c) => c.name).join(', ')}`);
  }
  if (e.revive !== undefined) {
    const fallen = who.filter((c) => c.hp <= 0);
    for (const c of fallen) c.hp = Math.max(1, Math.round(c.stats.hp * e.revive));
    if (fallen.length) done.push(`revived ${fallen.map((c) => c.name).join(', ')}`);
  }
  if (e.stats || e.luk || e.ali || e.level) {
    for (const c of who) {
      for (const [k, v] of Object.entries(e.stats ?? {}) as [keyof Stats, number][]) {
        c.stats[k] += v;
        if (k === 'hp') c.hp += v;
      }
      if (e.luk) c.luk = Math.min(100, c.luk + e.luk);
      if (e.ali) c.ali = Math.max(0, Math.min(100, c.ali + e.ali));
      if (e.level) c.level += e.level;
    }
    done.push(`strengthened ${who.map((c) => c.name).join(', ')}`);
  }
  if (e.unify) {
    const leader = squad[0];
    for (const c of squad) {
      if (c === leader) continue;
      const d = leader.ali - c.ali;
      c.ali += Math.sign(d) * Math.min(Math.abs(d), e.unify);
    }
    done.push('drew the squad together');
  }
  if (e.rally) done.push('carried the squad home');
  if (!done.length) return null;
  take(inv, itemId);
  return `${item.name}: ${done.join('; ')}.`;
}

// ----------------------------------------------------------- shop and loot --

/** The shop rank the army has earned: one, plus one for each stronghold it holds beyond its keep. */
export function shopRank(ownedStrongholds: number): number {
  return Math.max(1, ownedStrongholds);
}

export function shopStock(rank: number): ItemDef[] {
  const order = { supply: 0, gear: 1, relic: 2, key: 3 };
  return allItems()
    .filter((i) => i.forSale && i.rank <= rank)
    .sort((a, b) => order[a.kind] - order[b.kind] ||
      (a.type ?? '').localeCompare(b.type ?? '') || a.rank - b.rank || a.price - b.price);
}

export function buy(itemId: string, inv: Inventory, treasury: { goth: number }): boolean {
  const item = itemOf(itemId);
  if (treasury.goth < item.price) return false;
  treasury.goth -= item.price;
  give(inv, itemId);
  return true;
}

/** Shops buy back at half price. */
export function sellPrice(item: ItemDef): number {
  return Math.floor(item.price / 2);
}

export function sell(itemId: string, inv: Inventory, treasury: { goth: number }): boolean {
  if (!take(inv, itemId)) return false;
  treasury.goth += sellPrice(itemOf(itemId));
  return true;
}

export interface Loot {
  goth: number;
  items: string[];
}

/**
 * Spoils of a squad destroyed: Goth by the fallen's levels, and now and then
 * a supply, or a piece of gear or a relic of about their standing.
 */
export function rollLoot(fallen: Character[]): Loot {
  const levels = fallen.reduce((s, c) => s + c.level, 0);
  const loot: Loot = { goth: 20 + levels * 6, items: [] };
  const top = Math.max(1, Math.ceil(Math.max(...fallen.map((c) => c.level), 1) / 3));
  const pool = (kind: ItemDef['kind']) => allItems().filter((i) => i.kind === kind && i.rank <= top && i.rank > 0);
  const roll = (chance: number, kind: ItemDef['kind']) => {
    const p = pool(kind);
    if (p.length && rng() < chance) loot.items.push(p[Math.floor(rng() * p.length)].id);
  };
  roll(0.6, 'supply');
  roll(0.3, 'gear');
  roll(0.08, 'relic');
  roll(0.05, 'key');
  return loot;
}

export function addLoot(loot: Loot, inv: Inventory, treasury: { goth: number }): void {
  treasury.goth += loot.goth;
  for (const id of loot.items) give(inv, id);
}

export function inventoryCount(inv: Inventory, id: string): number {
  return inv[id] ?? 0;
}

export { give as addItem, take as removeItem };

/** What the army sets out with: the cheapest unit heal by the handful, a squad heal and a revive. */
export function starterInventory(): Inventory {
  const supplies = allItems()
    .filter((i) => i.kind === 'supply' && i.forSale && i.effect)
    .sort((a, b) => a.price - b.price);
  const inv: Inventory = {};
  const first = (ok: (i: ItemDef) => boolean, n: number) => {
    const found = supplies.find(ok);
    if (found) give(inv, found.id, n);
  };
  first((i) => i.target === 'unit' && i.effect!.heal !== undefined, 4);
  first((i) => i.target === 'squad' && i.effect!.heal !== undefined, 1);
  first((i) => i.effect!.revive !== undefined, 1);
  return inv;
}

// -------------------------------------------------------------- describing --

const TYPE_LABEL: Record<ItemType, string> = {
  sword: 'Sword', greatsword: 'Greatsword', rapier: 'Rapier', axe: 'Axe', hammer: 'Hammer', spear: 'Spear',
  whip: 'Whip', claw: 'Claw', bow: 'Bow', mace: 'Mace', staff: 'Staff', doll: 'Doll', fan: 'Fan',
  shield: 'Shield', greatshield: 'Large shield', book: 'Book',
  light: 'Light armour', medium: 'Mail', heavy: 'Heavy armour', robe: 'Robe', clothing: 'Clothing',
  helm: 'Helm', hat: 'Hat', accessory: 'Accessory',
};

export function typeLabel(type: ItemType): string {
  return TYPE_LABEL[type];
}

const RESIST_SHORT: Record<string, string> = {
  physical: 'DEF', wind: 'Wind', flame: 'Flame', earth: 'Earth', water: 'Water', virtue: 'Virtue', bane: 'Bane',
};

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

/** What an effect does, in a few words. */
export function effectText(e: ItemEffect, target: 'unit' | 'squad' = 'unit'): string {
  const who = target === 'squad' ? 'a squad' : 'one unit';
  const parts: string[] = [];
  if (e.heal !== undefined) parts.push(e.heal >= 1 ? `heals ${who} fully` : `heals ${who} ${Math.round(e.heal * 100)}%`);
  if (e.revive !== undefined) parts.push(`revives ${who === 'one unit' ? 'a fallen unit' : 'a squad\'s fallen'} at ${Math.round(e.revive * 100)}%`);
  for (const [k, v] of Object.entries(e.stats ?? {})) parts.push(`${k.toUpperCase()} ${signed(v)} for good`);
  if (e.luk) parts.push(`LUK ${signed(e.luk)} for good`);
  if (e.ali) parts.push(e.ali > 0 ? `ALI ${signed(e.ali)} (Lawful)` : `ALI ${e.ali} (Chaotic)`);
  if (e.level) parts.push(`${signed(e.level)} level`);
  if (e.unify) parts.push('draws a squad together');
  if (e.rally) parts.push('carries a squad home');
  return parts.join(', ');
}

/** A one-line summary of an item, for lists. */
export function itemSummary(item: ItemDef): string {
  if (item.kind !== 'gear') return item.desc ?? (item.effect ? effectText(item.effect, item.target) : '');
  const parts: string[] = [];
  for (const k of BONUS_KEYS) {
    const v = item.bonus?.[k];
    if (v) parts.push(`${k.toUpperCase()}${signed(v)}`);
  }
  for (const [k, v] of Object.entries(item.resist ?? {})) if (v) parts.push(`${RESIST_SHORT[k]}${signed(v)}`);
  if (item.slays?.length) parts.push(`slays ${item.slays.join('/')}`);
  return parts.join(' ');
}
