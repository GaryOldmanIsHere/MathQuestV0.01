import type {
  ClassDef, Element, Gender, GateStat, Lineage, PromotionReq, Row, RowAttack, SpellKind, Stats,
} from '../core/types';
import type { Dataset, SpellBook } from '../data/registry';
import type { Ob64Attack, Ob64Class, Ob64Consumable, Ob64Data, Ob64Item } from './decode';
import type { EquipRules, Gear, ItemDef, ItemEffect, ItemType, Slot } from '../core/items';
import { deriveEquipRules, slotsFor } from '../core/items';

// Turns the tables decoded from the ROM into Palatinus class definitions.
//
// Provenance, so it is clear what is the game's and what is ours:
//   * stats, growths, resistances, size, element, starting alignment and
//     luck, row attacks and hit counts, promotion lineage and level gates
//     -- read directly from the ROM.
//   * which spell an element-dependent slot casts -- derived from the
//     structure of the ROM's attack table (each element's block).
//   * which stats a class change demands, and its alignment window -- a rule
//     fitted to the documented requirements of Knight, Berserker, Wizard and
//     Paladin (all four reproduce). The minimum values themselves are the
//     target class's base stats from the ROM, plus two.

/** The game's element table index -> ours. 0 is Physical, 8 "Variable". */
const ELEMENT_AT: Record<number, Element> = {
  1: 'wind', 2: 'flame', 3: 'earth', 4: 'water', 5: 'virtue', 6: 'bane', 7: 'drakonite',
  // Combination elements resist as their leading element.
  9: 'wind', 10: 'flame', 11: 'earth', 12: 'water', 13: 'wind', 14: 'flame',
};

const GATE_STATS: GateStat[] = ['str', 'vit', 'int', 'men', 'agi', 'dex'];

/**
 * Attack ids that are spell *slots* rather than spells: the game fills them
 * from the caster's element. Which kind each slot is follows from the
 * classes that use it (Wizard 0x2D, Archmage and Siren 0x2E, Witch 0x2F).
 */
const SLOTS: Record<number, { spell: SpellKind; element?: Element } | { heal: 1 | 2 }> = {
  0x2d: { spell: 'basic' },
  0x2e: { spell: 'advanced' },
  0x2f: { spell: 'status' },
  0x30: { spell: 'basic' },
  0x31: { spell: 'summon' }, // "Evocation"
  0x32: { spell: 'basic' }, // "Ninja Art"
  0x33: { spell: 'basic', element: 'wind' }, // the Valkyrie's lightning
  0x34: { heal: 1 }, // Cleric
  0x35: { heal: 2 }, // Priest
  0x36: { spell: 'basic', element: 'bane' },
};

function isUsableLevel(v: number): boolean {
  return v > 0 && v < 0xff;
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** A real combat class, as opposed to placeholders, NPCs and story variants of another class. */
export function isRosterClass(c: Ob64Class): boolean {
  if (c.id === 0 || !c.name || c.name === 'Special Class') return false;
  if (c.size !== 1 && c.size !== 2) return false;
  if (c.variantOf !== 0) return false;
  if (c.moveType === 7) return false;
  return c.rows.every((r) => r.hits > 0 && r.hits < 10);
}

function genderOf(c: Ob64Class): Gender {
  if (c.gender === 0 || c.gender === 3) return 'M';
  if (c.gender === 1) return 'F';
  return 'X';
}

function statsOf(c: Ob64Class, key: 'base' | 'growth'): Stats {
  const s = c.stats;
  return {
    hp: s.hp[key], str: s.str[key], vit: s.vit[key], int: s.int[key],
    men: s.men[key], agi: s.agi[key], dex: s.dex[key],
  };
}

/**
 * Healing is Virtue magic with the restore effect. The effect byte alone is not
 * enough: the Faerie's "Throw a Kiss" shares it but is no heal.
 */
function isHealing(a: Ob64Attack): boolean {
  return a.category === 3 && a.element === 5 && a.effect === 2;
}

function targetOf(a: Ob64Attack): RowAttack['target'] {
  if (a.target === 3) return 'row';
  if (a.target === 2 || a.target === 5 || a.target === 6) return 'all';
  return 'one';
}

/** A concrete attack from the ROM table, as a Palatinus row attack. */
export function toRowAttack(a: Ob64Attack, hits: number): RowAttack {
  const element = ELEMENT_AT[a.element];
  if (a.category === 0) return { name: a.name, type: 'melee', count: hits, power: 1, target: 'one', element };
  if (a.category === 1) return { name: a.name, type: 'ranged', count: hits, power: 0.9, target: 'one', element };
  if (isHealing(a)) return { name: a.name, type: 'heal', count: hits, power: 1.1, target: 'allies', element };
  const target = targetOf(a);
  // Sleep, paralysis and poison land as a weaker hit until status effects exist.
  const status = a.effect !== 1;
  const power = status ? 0.5 : target === 'one' ? 1 : target === 'row' ? 0.85 : 0.7;
  return { name: a.name, type: 'magic', count: hits, power, target, element };
}

/**
 * The element-dependent spells, read off the shape of the attack table: each
 * element has a block of magic in which the single-target damage spell, the
 * row spell, the status spell and the summon can be told apart by their
 * target and effect bytes.
 */
export function buildSpellBook(attacks: Ob64Attack[]): SpellBook {
  const book: SpellBook = { basic: {}, advanced: {}, status: {}, summon: {} };
  for (const [idx, element] of Object.entries(ELEMENT_AT)) {
    const e = Number(idx);
    if (e > 6) continue;
    const magic = attacks.filter((a) => a.category === 3 && a.element === e && a.name);
    const special = attacks.filter((a) => a.category === 4 && a.element === e && a.name && a.effect === 1);
    const basic = magic.find((a) => a.effect === 1 && a.target === 1) ?? special.find((a) => a.target === 1);
    const advanced = magic.find((a) => a.effect === 1 && a.target === 3 && a.name !== basic?.name)
      ?? special.find((a) => a.target !== 1);
    const status = magic.find((a) => a.effect !== 1 && a.effect !== 2);
    const summon = magic.find((a) => a.target === 5);
    if (basic) book.basic[element] = toRowAttack(basic, 1);
    if (advanced) book.advanced[element] = toRowAttack(advanced, 1);
    if (status) book.status[element] = toRowAttack(status, 1);
    if (summon) book.summon[element] = toRowAttack(summon, 1);
  }
  return book;
}

function healSpell(attacks: Ob64Attack[], rank: 1 | 2, hits: number): RowAttack {
  const names = [...new Set(attacks.filter((a) => isHealing(a) && a.name).map((a) => a.name))];
  const name = names[rank - 1] ?? names[0] ?? 'Healing';
  return { name, type: 'heal', count: hits, power: rank === 2 ? 1.5 : 1.1, target: 'allies', element: 'virtue' };
}

function rowAttack(id: number, hits: number, attacks: Ob64Attack[], book: SpellBook): RowAttack {
  const slot = SLOTS[id];
  if (slot && 'heal' in slot) return healSpell(attacks, slot.heal, hits);
  if (slot) {
    if (slot.element) {
      const fixed = book[slot.spell][slot.element];
      if (fixed) return { ...fixed, count: hits };
    }
    return {
      name: 'Elemental Magic', type: 'magic', count: hits,
      power: slot.spell === 'status' ? 0.5 : slot.spell === 'basic' ? 1 : 0.85,
      target: slot.spell === 'basic' ? 'one' : 'row',
      spell: slot.spell,
    };
  }
  const a = attacks[id];
  if (!a || !a.name) return { name: 'Strike', type: 'melee', count: hits, power: 1, target: 'one' };
  return toRowAttack(a, hits);
}

/**
 * Which stats a class change demands, and how much: the two stats the target
 * class grows fastest in (ties in the game's stat order), each at the
 * target's base value plus two. Reproduces the documented Knight (STR 72 /
 * VIT 67), Berserker (STR 72 / VIT 67) and Wizard (INT 57 / MEN 63) gates.
 */
export function inferStatGates(target: Ob64Class): Partial<Record<GateStat, number>> {
  const ranked = [...GATE_STATS].sort((a, b) => target.stats[b].growth - target.stats[a].growth);
  const gates: Partial<Record<GateStat, number>> = {};
  for (const k of ranked.slice(0, 2)) gates[k] = target.stats[k].base + 2;
  return gates;
}

/**
 * The alignment window a class change requires, from the class's own starting
 * alignment: lawful-leaning classes want a lawful unit, chaotic ones a chaotic
 * one, and the elite tier is stricter. Reproduces Knight 40-100, Berserker and
 * Wizard 0-60, Paladin 60-100.
 */
export function inferAlignmentWindow(target: Ob64Class, tier: 2 | 3): [number, number] {
  const lean = target.alignment;
  if (tier === 2) return lean >= 55 ? [40, 100] : lean <= 45 ? [0, 60] : [20, 80];
  return lean >= 55 ? [60, 100] : lean <= 45 ? [0, 40] : [30, 70];
}

function spriteFamily(c: Ob64Class): string {
  const n = c.name.toLowerCase();
  if (/dragon|wyrm|wyvern|hydra|tiamat|bahamut|quetzal|flarebrass|dahaka/.test(n)) return 'dragon';
  if (/golem|ogre|giant/.test(n)) return 'golem';
  if (/hound|cerberus|griffin|opinincus|cockatrice|sphinx|werewolf/.test(n)) return 'beast';
  if (/ghost/.test(n)) return 'ghost';
  return 'humanoid';
}

function describe(c: Ob64Class, tier: number, element: Element | undefined): string {
  const who = c.gender === 1 ? 'female' : c.gender === 0 || c.gender === 3 ? 'male' : 'monster';
  const parts = [`Tier ${tier} ${who} class from Ogre Battle 64.`];
  parts.push(element ? `Element: ${element}.` : 'Element: the recruit\'s own.');
  if (c.size === 2) parts.push('Large: fills two places in a squad.');
  if (c.moveType === 1) parts.push('Flies.');
  return parts.join(' ');
}

/** The game's equipment type numbers. */
const ITEM_TYPE: Record<number, ItemType> = {
  1: 'sword', 2: 'greatsword', 3: 'rapier', 4: 'axe', 5: 'hammer', 7: 'spear', 8: 'whip', 9: 'claw',
  10: 'bow', 11: 'mace', 12: 'staff', 13: 'doll', 24: 'fan',
  14: 'shield', 15: 'greatshield', 23: 'book',
  16: 'light', 17: 'medium', 18: 'heavy', 19: 'robe', 20: 'clothing',
  21: 'helm', 22: 'hat', 25: 'accessory',
};

function uniqueIds<T extends { id: number; name: string }>(list: T[]): Map<number, string> {
  const out = new Map<number, string>();
  const taken = new Set<string>();
  for (const x of list) {
    let id = slugify(x.name);
    if (taken.has(id)) id = `${id}-${x.id}`;
    taken.add(id);
    out.set(x.id, id);
  }
  return out;
}

/**
 * The ROM's equipment as Palatinus items. Bonuses, resistances, element,
 * rank and price are the game's. Which flag bits mean "no shop sells this"
 * (+0x1A bit 7) and "slays dragons" / "slays the undead" (+0x1B bits 0 and
 * 4) is inferred from the items that carry them: every Fafnir, Balmung,
 * Sword of Tiamat and Gram has the first, every Virtue weapon the second.
 */
export function convertItems(items: Ob64Item[]): { defs: ItemDef[]; ids: Map<number, string> } {
  const ids = uniqueIds(items);
  const defs: ItemDef[] = [];
  for (const it of items) {
    const type = ITEM_TYPE[it.type];
    if (!type) continue;
    const bonus = Object.fromEntries(Object.entries(it.bonus).filter(([, v]) => v !== 0));
    const resist = Object.fromEntries(Object.entries(it.resist).filter(([, v]) => v !== 0));
    const slays: ('dragon' | 'undead')[] = [];
    if (it.flags[3] & 0x01) slays.push('dragon');
    if (it.flags[3] & 0x10) slays.push('undead');
    defs.push({
      id: ids.get(it.id)!,
      name: it.name,
      kind: 'gear',
      type,
      element: ELEMENT_AT[it.element] && it.element <= 6 ? ELEMENT_AT[it.element] : undefined,
      rank: it.rank,
      price: it.price,
      // Element 7 marks the four great spell tomes (Tempest, Annihilation...), never sold.
      forSale: it.rank > 0 && !(it.flags[2] & 0x80) && it.element !== 7,
      bonus,
      resist,
      slays: slays.length ? slays : undefined,
      source: 'ob64',
    });
  }
  return { defs, ids };
}

/**
 * What each supply and relic does. The game's own effect code has not been
 * located, so these are Palatinus's readings of the names, at magnitudes of
 * its own choosing; the target (one unit or a squad) is the ROM's.
 */
const CONSUMABLE_EFFECT: Record<string, ItemEffect> = {
  'Heal Leaf': { heal: 0.35 }, 'Heal Seed': { heal: 0.75 }, 'Heal Pack': { heal: 0.5 },
  'Power Fruit': { heal: 0.25 }, 'Angel Fruit': { heal: 1 },
  'Revive Stone': { revive: 0.5 }, 'Altar of Resurrection': { revive: 1 },
  'Quit Gate': { rally: true },
  'Champion Statuette': { level: 1 }, 'Cup of Life': { stats: { hp: 10 } },
  'Sword Emblem': { stats: { str: 4 } }, 'Bracer of Protection': { stats: { vit: 4 } },
  'Crown of Intellect': { stats: { int: 4 } }, 'Mirror of Soul': { stats: { men: 4 } },
  'Stone of Quickness': { stats: { agi: 4 } }, 'Crystal of Precision': { stats: { dex: 4 } },
  'Scroll of Discipline': { ali: 10 }, 'Urn of Chaos': { ali: -10 },
  'Goblet of Destiny': { luk: 5 }, 'Flag of Unity': { unify: 10 },
};

export function convertConsumables(list: Ob64Consumable[]): ItemDef[] {
  const ids = uniqueIds(list);
  const out: ItemDef[] = [];
  for (const c of list) {
    const effect = CONSUMABLE_EFFECT[c.name];
    if (!effect) continue; // tactics and story items: not yet part of the game
    const relic = c.category === 1;
    out.push({
      id: `use-${ids.get(c.id)!}`,
      name: c.name,
      kind: relic ? 'relic' : 'supply',
      price: c.price,
      rank: relic ? 3 : c.price < 60 ? 1 : c.price < 150 ? 2 : c.price < 600 ? 3 : 5,
      forSale: !relic,
      target: c.target === 1 ? 'unit' : 'squad',
      effect,
      source: 'ob64',
    });
  }
  return out;
}

/**
 * What a class may wear, inferred from what the game dresses it in: the
 * code that decides it is in an overlay not yet decompressed. A class keeps
 * to its starting weapon's type; heavier armour admits the lighter; a large
 * shield admits the small; a helm admits a hat; anyone may wear accessories.
 */
export function inferEquipRules(defaults: (ItemType | undefined)[], monster: boolean): EquipRules | undefined {
  const [weapon, body, off, head] = defaults;
  if (!weapon && !body && !off && !head) return undefined;
  const bodies: Record<string, ItemType[]> = {
    heavy: ['heavy', 'medium', 'light'], medium: ['medium', 'light'], light: ['light', 'clothing'],
    robe: ['robe', 'clothing'], clothing: off === 'book' ? ['robe', 'clothing'] : ['clothing'],
  };
  const offhands: Record<string, ItemType[]> = {
    greatshield: ['greatshield', 'shield', 'accessory'], shield: ['shield', 'accessory'], book: ['book', 'accessory'],
  };
  const heads: Record<string, ItemType[]> = { helm: ['helm', 'hat', 'accessory'], hat: ['hat', 'accessory'] };
  return {
    weapon: weapon && ITEM_WEAPONS.has(weapon) ? [weapon] : [],
    body: body ? bodies[body] ?? [body] : [],
    offhand: off ? offhands[off] ?? ['accessory'] : ['accessory'],
    head: head ? heads[head] ?? (monster ? ['accessory'] : ['hat', 'accessory']) : monster ? ['accessory'] : ['hat', 'accessory'],
  };
}

const ITEM_WEAPONS = new Set<ItemType>(['sword', 'greatsword', 'rapier', 'axe', 'hammer', 'spear', 'whip', 'claw', 'bow', 'mace', 'staff', 'doll', 'fan']);

export function convertDataset(data: Ob64Data): Dataset {
  const gear = convertItems(data.items ?? []);
  const typeOfItem = new Map((data.items ?? []).map((i) => [i.id, ITEM_TYPE[i.type]]));
  const roster = data.classes.filter(isRosterClass);
  const inRoster = new Set(roster.map((c) => c.id));
  const book = buildSpellBook(data.attacks);

  // Unique, readable ids. Same-named classes differ by gender or are repeats.
  const slugs = new Map<number, string>();
  const taken = new Set<string>();
  for (const c of roster) {
    let slug = slugify(c.name);
    if (taken.has(slug)) slug = c.gender === 1 ? `${slug}-f` : `${slug}-${c.id}`;
    taken.add(slug);
    slugs.set(c.id, slug);
  }
  const slugOf = (id: number) => (inRoster.has(id) ? slugs.get(id) : undefined);

  const tierOf = (c: Ob64Class): 1 | 2 | 3 => {
    const l = c.lineage;
    if (l.tier2 && inRoster.has(l.tier2) && isUsableLevel(l.tier3Level)) return 3;
    if (l.tier1 && inRoster.has(l.tier1) && isUsableLevel(l.tier2Level)) return 2;
    return 1;
  };

  // The class table runs: the player's tree, then specials and demi-humans,
  // then monsters, then story and boss classes. Story classes share lineage
  // records too (the game uses them to field a "Rune Knight" as a Valkyrie at
  // low level), so everything after the last monster is enemy-only. Records
  // flagged at +0x36, or +0x06 == 2, are one-off specials.
  const special = (c: Ob64Class) => c.flag36 !== 0 || c.flag06 === 2;
  const monsters = roster.filter((c) => c.size === 2 && !special(c)).map((c) => c.id);
  const storyStart = monsters.length ? 1 + Math.max(...monsters) : Infinity;
  const recruitable = (c: Ob64Class) => c.id < storyStart && !special(c);

  // Promotions: a class promotes into every class whose lineage names it as
  // the immediate ancestor, at the level the lineage gives.
  const promotions = new Map<number, PromotionReq[]>();
  for (const t of roster) {
    const tier = tierOf(t);
    if (tier === 1 || !recruitable(t)) continue;
    const l = t.lineage;
    const parent = tier === 3 ? l.tier2 : l.tier1;
    const level = tier === 3 ? l.tier3Level : l.tier2Level;
    const [aliMin, aliMax] = inferAlignmentWindow(t, tier);
    const req: PromotionReq = { classId: slugs.get(t.id)!, level, stats: inferStatGates(t), aliMin, aliMax };
    promotions.set(parent, [...(promotions.get(parent) ?? []), req]);
  }

  const classes: Record<string, ClassDef> = {};
  for (const c of roster) {
    const id = slugs.get(c.id)!;
    const tier = tierOf(c);
    const element = c.element === 0xff ? undefined : ELEMENT_AT[c.element];
    const rows = (['front', 'mid', 'back'] as Row[]);
    const attacks: Partial<Record<Row, RowAttack>> = {};
    rows.forEach((row, i) => {
      attacks[row] = rowAttack(c.rows[i].attack, c.rows[i].hits, data.attacks, book);
    });
    const lineage: Lineage = {};
    if (tier >= 2) {
      lineage.tier1 = slugOf(c.lineage.tier1);
      lineage.tier2Level = c.lineage.tier2Level;
    }
    if (tier === 3) {
      lineage.tier2 = slugOf(c.lineage.tier2);
      lineage.tier3Level = c.lineage.tier3Level;
    }
    const gender = genderOf(c);
    const backHeavy = c.rows[2].hits > c.rows[0].hits;
    classes[id] = {
      id,
      name: c.name,
      gender,
      tier,
      desc: describe(c, tier, element),
      base: statsOf(c, 'base'),
      growth: statsOf(c, 'growth'),
      attacks,
      promotesTo: promotions.get(c.id) ?? [],
      // The game's own terrain classes: 1 flies, 3 and 4 cross forest and
      // mountain freely (Amazons, Ninjas, beasts); the rest walk the plain.
      moveType: c.moveType === 1 ? 'fly' : c.moveType === 3 || c.moveType === 4 ? 'fast' : 'foot',
      preferredRow: c.flag47 === 1 || backHeavy ? 'back' : 'front',
      sprite: spriteFamily(c),
      palette: id,
      resist: { ...c.resist },
      size: c.size === 2 ? 2 : 1,
      element,
      lineage: tier >= 2 ? lineage : undefined,
      startAlignment: c.alignment,
      startLuck: c.luck,
      playable: recruitable(c),
      source: 'ob64',
    };
    // The record's four items go where their type says; an accessory in the
    // third place is worn in the off hand, in the fourth on the head. (A few
    // story classes keep armour in the third place.)
    const worn: Partial<Gear> = {};
    const types: Partial<Record<Slot, ItemType>> = {};
    c.equipment.forEach((n, pos) => {
      const type = n > 0 && n < 0xffff ? typeOfItem.get(n) : undefined;
      if (!type) return;
      const fits = slotsFor(type);
      const slot = fits.length === 1 ? fits[0] : pos === 2 ? 'offhand' : 'head';
      if (worn[slot]) return;
      worn[slot] = gear.ids.get(n);
      types[slot] = type;
    });
    const rules = inferEquipRules([types.weapon, types.body, types.offhand, types.head], gender === 'X');
    classes[id].equip = rules ?? deriveEquipRules(classes[id]);
    if (Object.keys(worn).length) classes[id].defaultGear = worn;
  }

  const items: Record<string, ItemDef> = {};
  for (const i of [...gear.defs, ...convertConsumables(data.consumables ?? [])]) items[i.id] = i;

  return {
    classes,
    items,
    spells: book,
    source: 'ob64',
    label: `Ogre Battle 64 (${data.source.sha1.slice(0, 8)})`,
  };
}
