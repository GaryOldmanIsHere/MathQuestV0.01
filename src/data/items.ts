import type { BonusKey, Family, ItemDef, ItemEffect, ItemType } from '../core/items';
import type { Element, Resistances } from '../core/types';

// Palatinus's own items: what the game runs on without an Ogre Battle 64 ROM.
// Original names, built to the same shape as the extracted items, on the
// built-in classes' smaller stat scale. Ranks run 1..8 on the same ladder the
// extracted items use, so shops open the same way on either.

const RANKS = [1, 2, 4, 6, 8];
const STEP = [1, 2, 3, 4.5, 6]; // bonus multiplier by rank step
const PRICE = [30, 90, 300, 900, 2000];

const OPPOSITE: Record<Exclude<Element, 'drakonite'>, Exclude<Element, 'drakonite'>> = {
  flame: 'water', water: 'flame', wind: 'earth', earth: 'wind', virtue: 'bane', bane: 'virtue',
};

const items: ItemDef[] = [];

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function scaled(per: Partial<Record<BonusKey, number>>, m: number): Partial<Record<BonusKey, number>> {
  const out: Partial<Record<BonusKey, number>> = {};
  for (const [k, v] of Object.entries(per) as [BonusKey, number][]) {
    const n = Math.round(v * m);
    out[k] = n === 0 ? Math.sign(v) : n;
  }
  return out;
}

/** An element's ward: its own column raised, its opposite's lowered. */
function ward(element: Exclude<Element, 'drakonite'>, up: number, down: number): Partial<Resistances> {
  return { [element]: up, [OPPOSITE[element]]: -down };
}

function gear(
  name: string, type: ItemType, rank: number, price: number,
  bonus: Partial<Record<BonusKey, number>>, extra: Partial<ItemDef> = {},
): void {
  items.push({ id: slug(name), name, kind: 'gear', type, rank, price, forSale: true, bonus, source: 'builtin', ...extra });
}

// --- weapons: five steps of each, plain metal to rune-cut -------------------
const WEAPONS: [ItemType, string[], Partial<Record<BonusKey, number>>, number][] = [
  ['sword', ['Bronze Sword', 'Iron Sword', 'Steel Sword', 'Mithril Sword', 'Runed Sword'], { str: 2 }, 1],
  ['greatsword', ['Bronze Greatsword', 'Iron Greatsword', 'Steel Greatsword', 'Mithril Greatsword', 'Runed Greatsword'], { str: 2.8 }, 1.3],
  ['rapier', ['Bronze Rapier', 'Iron Rapier', 'Steel Rapier', 'Mithril Rapier', 'Runed Rapier'], { str: 1.5, agi: 1, dex: 0.5 }, 1.1],
  ['axe', ['Bronze Axe', 'Iron Axe', 'Steel Axe', 'Mithril Axe', 'Runed Axe'], { str: 2.4 }, 1.1],
  ['hammer', ['Bronze Maul', 'Iron Maul', 'Steel Maul', 'Mithril Maul', 'Runed Maul'], { str: 3, agi: -0.5 }, 1.2],
  ['spear', ['Bronze Spear', 'Iron Spear', 'Steel Spear', 'Mithril Spear', 'Runed Spear'], { str: 2.2 }, 1.1],
  ['whip', ['Hide Whip', 'Braided Whip', 'Chain Whip', 'Barbed Whip', 'Serpent Whip'], { str: 1.6, dex: 0.6 }, 1],
  ['claw', ['Bronze Claw', 'Iron Claw', 'Steel Claw', 'Mithril Claw', 'Runed Claw'], { str: 1.7, agi: 0.8 }, 1.1],
  ['bow', ['Short Bow', 'Hunting Bow', 'Longbow', 'Horn Bow', 'Runed Bow'], { str: 1.6, dex: 1.2 }, 1.1],
  ['mace', ['Cudgel', 'Iron Mace', 'Steel Mace', 'Mithril Mace', 'Runed Mace'], { str: 1.3, men: 0.8 }, 1],
  ['staff', ['Ash Staff', 'Oak Staff', 'Silver Staff', 'Moon Staff', 'Star Staff'], { int: 2, str: 0.4 }, 1],
  ['doll', ['Rag Doll', 'Wooden Doll', 'Porcelain Doll', 'Ivory Doll', 'Spirit Doll'], { int: 1.2, str: 1 }, 1],
  ['fan', ['Paper Fan', 'Lacquer Fan', 'Silk Fan', 'Jade Fan', 'Phoenix Fan'], { int: 1.2, agi: 0.8 }, 1],
];
for (const [type, names, per, cost] of WEAPONS) {
  names.forEach((name, i) => gear(name, type, RANKS[i], Math.round(PRICE[i] * cost), scaled(per, STEP[i])));
}

// --- elemental and slaying weapons ------------------------------------------
const SPECIAL: [string, ItemType, Exclude<Element, 'drakonite'>, number, Partial<Record<BonusKey, number>>, Family[]?][] = [
  ['Emberbrand', 'sword', 'flame', 4, { str: 7 }],
  ['Rimeblade', 'sword', 'water', 4, { str: 7 }],
  ['Galeblade', 'sword', 'wind', 4, { str: 7 }],
  ['Cinder Axe', 'axe', 'flame', 4, { str: 8 }],
  ['Granite Maul', 'hammer', 'earth', 4, { str: 9, agi: -1 }],
  ['Tidecaller Spear', 'spear', 'water', 4, { str: 7 }],
  ['Rootspear', 'spear', 'earth', 4, { str: 7 }],
  ['Stormbow', 'bow', 'wind', 4, { str: 5, dex: 4 }],
  ['Ashwood Staff', 'staff', 'flame', 4, { int: 7 }],
  ['Frost Staff', 'staff', 'water', 4, { int: 7 }],
  ['Gale Staff', 'staff', 'wind', 4, { int: 7 }],
  ['Loam Staff', 'staff', 'earth', 4, { int: 7 }],
  ['Dawnblade', 'sword', 'virtue', 6, { str: 9, men: 2 }, ['undead']],
  ['Sunlit Mace', 'mace', 'virtue', 6, { str: 6, men: 5 }, ['undead']],
  ['Duskfang', 'claw', 'bane', 6, { str: 8, agi: 3 }],
  ['Gloom Staff', 'staff', 'bane', 6, { int: 10 }],
  ['Wyrmsbane', 'greatsword', 'flame', 8, { str: 16 }, ['dragon']],
];
for (const [name, type, element, rank, bonus, slays] of SPECIAL) {
  gear(name, type, rank, rank * 260, bonus, { element, resist: ward(element, 4, 2), slays });
}

// --- armour -------------------------------------------------------------------
const ARMOUR: [ItemType, string[], number[], Partial<Record<BonusKey, number>>][] = [
  ['light', ['Padded Jerkin', 'Leather Cuirass', 'Studded Leather', 'Scaled Jerkin', 'Shadowhide'], [2, 4, 6, 8, 10], {}],
  ['medium', ['Ring Shirt', 'Chain Shirt', 'Brigandine', 'Mail Hauberk', 'Mithril Mail'], [4, 6, 9, 12, 15], {}],
  ['heavy', ['Iron Plate', 'Banded Plate', 'Steel Plate', 'Knight Plate', 'Runed Plate'], [6, 9, 13, 17, 21], { agi: -0.5 }],
  ['robe', ['Linen Robe', 'Wool Robe', 'Sage Robe', 'Silk Robe', 'Starweave Robe'], [1, 2, 3, 4, 5], { int: 0.8, men: 1 }],
  ['clothing', ["Traveler's Garb", "Hunter's Garb", 'Ranger Cloak', 'Silken Garb', 'Moonlit Garb'], [1, 2, 2, 3, 4], { agi: 0.6, luk: 1 }],
];
for (const [type, names, phys, per] of ARMOUR) {
  names.forEach((name, i) => gear(name, type, RANKS[i], Math.round(PRICE[i] * 0.9), scaled(per, STEP[i]), {
    resist: { physical: phys[i] },
  }));
}
const WARDS: [string, ItemType, Exclude<Element, 'drakonite'>, number][] = [
  ['Emberward Mail', 'medium', 'flame', 9], ['Frostward Mail', 'medium', 'water', 9],
  ['Galeward Mail', 'medium', 'wind', 9], ['Earthward Mail', 'medium', 'earth', 9],
  ['Dawnward Robe', 'robe', 'virtue', 3], ['Duskward Robe', 'robe', 'bane', 3],
];
for (const [name, type, element, phys] of WARDS) {
  gear(name, type, 5, 1100, type === 'robe' ? { int: 3, men: 4 } : {}, {
    element, resist: { physical: phys, ...ward(element, 10, 4) },
  });
}

// --- off hand -----------------------------------------------------------------
['Wooden Buckler', 'Iron Buckler', 'Steel Targe', 'Mithril Targe'].forEach((name, i) =>
  gear(name, 'shield', RANKS[i], Math.round(PRICE[i] * 0.6), {}, { resist: { physical: [2, 4, 6, 8][i] } }));
['Oak Pavise', 'Iron Pavise', 'Steel Tower', 'Runed Bulwark'].forEach((name, i) =>
  gear(name, 'greatshield', RANKS[i + 1], Math.round(PRICE[i + 1] * 0.7), { agi: -1 }, { resist: { physical: [4, 7, 10, 13][i] } }));
gear('Apprentice Primer', 'book', 1, 60, { int: 1 });
gear("Scholar's Codex", 'book', 4, 700, { int: 4, men: 2 });
const TOMES: [string, Exclude<Element, 'drakonite'>][] = [
  ['Tome of Embers', 'flame'], ['Tome of Tides', 'water'], ['Tome of Gales', 'wind'], ['Tome of Stone', 'earth'],
  ['Dawn Psalter', 'virtue'], ['Dusk Codex', 'bane'],
];
for (const [name, element] of TOMES) gear(name, 'book', 3, 420, { int: 3 }, { element, resist: ward(element, 6, 2) });

// --- head -----------------------------------------------------------------------
['Iron Cap', 'Sallet', 'Barbute', 'Great Helm'].forEach((name, i) =>
  gear(name, 'helm', RANKS[i], Math.round(PRICE[i] * 0.5), {}, { resist: { physical: [2, 3, 5, 7][i] } }));
['Felt Cap', 'Feathered Hat', 'Circlet', 'Silver Circlet'].forEach((name, i) =>
  gear(name, 'hat', RANKS[i], Math.round(PRICE[i] * 0.45), { men: [0, 1, 2, 3][i], luk: 1 }, { resist: { physical: [1, 2, 2, 3][i] } }));

// --- accessories ----------------------------------------------------------------
const TRINKETS: [string, number, number, Partial<Record<BonusKey, number>>, Partial<Resistances>?][] = [
  ['Copper Charm', 1, 40, { luk: 3 }],
  ['Bone Talisman', 2, 120, { men: 2 }],
  ['Iron Torc', 3, 260, { str: 2 }],
  ["Sage's Pendant", 3, 260, { int: 3 }],
  ['Swiftfeather', 4, 480, { agi: 3 }],
  ['Hawkeye Ring', 4, 480, { dex: 3 }],
  ['Warding Cloak', 6, 1500, {}, { wind: 5, flame: 5, earth: 5, water: 5, virtue: 5, bane: 5 }],
  ['Dragonbone Charm', 6, 1500, { vit: 2 }, { flame: 8, physical: 3 }],
];
for (const [name, rank, price, bonus, resist] of TRINKETS) gear(name, 'accessory', rank, price, bonus, { resist });

// --- supplies and relics ----------------------------------------------------------
function usable(name: string, kind: 'supply' | 'relic', rank: number, price: number, target: 'unit' | 'squad', effect: ItemEffect, desc: string): void {
  items.push({ id: slug(name), name, kind, rank, price, forSale: kind === 'supply', target, effect, desc, source: 'builtin' });
}
usable('Mending Herb', 'supply', 1, 15, 'unit', { heal: 0.35 }, 'Restores a third of one unit\'s HP.');
usable('Mending Draught', 'supply', 2, 45, 'unit', { heal: 0.75 }, 'Restores most of one unit\'s HP.');
usable('Field Kit', 'supply', 2, 90, 'squad', { heal: 0.4 }, 'Restores some HP to a whole squad.');
usable('Camp Feast', 'supply', 5, 220, 'squad', { heal: 1 }, 'Restores a whole squad to full HP.');
usable('Ember of Return', 'supply', 3, 400, 'unit', { revive: 0.5 }, 'Raises a fallen unit with half its HP.');
usable('Rite Candle', 'supply', 6, 1200, 'squad', { revive: 1 }, 'Raises every fallen member of a squad, whole.');
usable('Homeward Feather', 'supply', 2, 120, 'squad', { rally: true }, 'Carries a squad home to the keep.');
usable('Torc of Might', 'relic', 3, 1500, 'unit', { stats: { str: 2 } }, 'STR +2 for good.');
usable('Bastion Seal', 'relic', 3, 1500, 'unit', { stats: { vit: 2 } }, 'VIT +2 for good.');
usable("Sage's Lamp", 'relic', 3, 1500, 'unit', { stats: { int: 2 } }, 'INT +2 for good.');
usable('Still Mirror', 'relic', 3, 1500, 'unit', { stats: { men: 2 } }, 'MEN +2 for good.');
usable('Quickstep Anklet', 'relic', 3, 1500, 'unit', { stats: { agi: 2 } }, 'AGI +2 for good.');
usable('Falcon Lens', 'relic', 3, 1500, 'unit', { stats: { dex: 2 } }, 'DEX +2 for good.');
usable('Vessel of Vigor', 'relic', 3, 1500, 'unit', { stats: { hp: 8 } }, 'Max HP +8 for good.');
usable('Laurel of Valor', 'relic', 5, 2500, 'unit', { level: 1 }, 'One level, at once.');
usable("Lawgiver's Scroll", 'relic', 2, 800, 'unit', { ali: 10 }, 'Alignment 10 toward Lawful.');
usable('Chaos Shard', 'relic', 2, 800, 'unit', { ali: -10 }, 'Alignment 10 toward Chaotic.');
usable('Four-leaf Token', 'relic', 2, 800, 'unit', { luk: 5 }, 'Luck +5 for good.');
usable('Banner of Accord', 'relic', 4, 1200, 'squad', { unify: 10 }, 'Draws a squad\'s alignment toward its leader.');

export const ITEMS: Record<string, ItemDef> = Object.fromEntries(items.map((i) => [i.id, i]));
