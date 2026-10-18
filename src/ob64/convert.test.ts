import { describe, expect, it } from 'vitest';
import type { Ob64Attack, Ob64Class, Ob64Data } from './decode';
import {
  buildSpellBook, convertDataset, inferAlignmentWindow, inferStatGates, isRosterClass, toRowAttack,
} from './convert';

// Synthetic Ogre Battle 64 tables, shaped like the decoder's output. The few
// stat values used match the class records they stand for so the inferred
// requirements can be checked against the documented ones.

const NEUTRAL = { physical: 50, wind: 50, flame: 50, earth: 50, water: 50, virtue: 50, bane: 50 };

function cls(id: number, name: string, over: Partial<Ob64Class> = {}): Ob64Class {
  const stat = (base: number, growth: number) => ({ base, growth });
  return {
    id, name, size: 1, gender: 0, flag06: 0,
    stats: { hp: stat(70, 4), str: stat(50, 3), vit: stat(50, 2), int: stat(40, 2), men: stat(46, 2), agi: stat(42, 1), dex: stat(45, 2) },
    luck: 50, alignment: 50, resist: { ...NEUTRAL }, moveType: 2, equipment: [0, 0, 0, 0], flag36: 0,
    rows: [{ attack: 1, hits: 2 }, { attack: 1, hits: 1 }, { attack: 1, hits: 1 }],
    battle3D: [0, 0, 0, 0],
    lineage: { tier1: 0, tier2Level: 0, tier2: 0, tier3Level: 0 },
    variantOf: 0, element: 0xff, flag47: 2,
    ...over,
  };
}

/** Override the bases and growths of a class (order: hp str vit int men agi dex). */
function withStats(c: Ob64Class, base: number[], growth: number[]): Ob64Class {
  const keys = ['hp', 'str', 'vit', 'int', 'men', 'agi', 'dex'] as const;
  keys.forEach((k, i) => { c.stats[k] = { base: base[i], growth: growth[i] }; });
  return c;
}

function atk(id: number, name: string, category: number, element: number, target: number, effect: number): Ob64Attack {
  return { id, name, category, element, target, effect, raw: [category, element, target, effect] };
}

const ATTACKS: Ob64Attack[] = [
  atk(0, '', 0xff, 0xff, 0xff, 0xff),
  atk(1, 'Slash', 0, 0, 1, 1),
  atk(2, 'Shoot', 1, 0, 1, 1),
  atk(3, 'Lightning', 3, 1, 1, 1),
  atk(4, 'Thunder Flare', 3, 1, 3, 1),
  atk(5, 'Shock Bolt', 3, 1, 1, 8),
  atk(6, 'Thunderbird', 3, 1, 5, 1),
  atk(7, 'Fireball', 3, 2, 1, 1),
  atk(8, 'Healing', 3, 5, 1, 2),
  atk(9, 'Healing Plus', 3, 5, 3, 2),
  atk(10, 'Throw a Kiss', 4, 0, 9, 2), // shares the heal effect byte, is no heal
];

// A small table with the real shape: player tree, a demi-human family,
// a large monster, then story classes after the last monster.
const FIGHTER = withStats(cls(2, 'Fighter'), [70, 50, 50, 40, 46, 42, 45], [4, 3, 2, 2, 2, 1, 2]);
const AMAZON = cls(4, 'Amazon', { gender: 1 });
const KNIGHT = withStats(
  cls(5, 'Knight', { alignment: 58, lineage: { tier1: 2, tier2Level: 6, tier2: 0, tier3Level: 0 } }),
  [95, 70, 65, 55, 61, 52, 60], [4, 4, 3, 2, 3, 3, 2],
);
const BERSERKER = withStats(
  cls(6, 'Berserker', { alignment: 40, lineage: { tier1: 2, tier2Level: 6, tier2: 0, tier3Level: 0 } }),
  [95, 70, 65, 55, 61, 52, 60], [4, 4, 4, 2, 3, 3, 2],
);
const WIZARD = withStats(
  cls(12, 'Wizard', { alignment: 30, flag47: 1, rows: [{ attack: 0x2d, hits: 1 }, { attack: 0x2d, hits: 1 }, { attack: 0x2d, hits: 2 }],
    lineage: { tier1: 2, tier2Level: 6, tier2: 0, tier3Level: 0 } }),
  [95, 70, 65, 55, 61, 52, 60], [2, 2, 2, 5, 3, 2, 2],
);
const CLERIC = cls(18, 'Cleric', { gender: 1, flag47: 1, alignment: 65,
  rows: [{ attack: 0x34, hits: 1 }, { attack: 0x34, hits: 1 }, { attack: 0x34, hits: 2 }],
  lineage: { tier1: 4, tier2Level: 5, tier2: 0, tier3Level: 0 } });
const PALADIN = withStats(
  cls(19, 'Paladin', { alignment: 70, lineage: { tier1: 2, tier2Level: 6, tier2: 5, tier3Level: 15 } }),
  [140, 115, 101, 82, 97, 88, 87], [5, 5, 4, 3, 4, 3, 3],
);
const HAWKMAN = cls(39, 'Hawkman', { moveType: 1 });
const VULTAN = cls(40, 'Vultan', { moveType: 1, lineage: { tier1: 39, tier2Level: 12, tier2: 0, tier3Level: 0 } });
const DRAGON = cls(56, 'Young Dragon', { gender: 2, size: 2, element: 7 });
const RUNE_KNIGHT = cls(87, 'Rune Knight', { gender: 1, lineage: { tier1: 4, tier2Level: 6, tier2: 0, tier3Level: 0 } });
const PRIEST_BOSS = cls(91, 'Priest', { gender: 1, variantOf: 18 });
const NPC = cls(130, 'Barkeep', { moveType: 7 });

const DATA: Ob64Data = {
  source: { sha1: 'd26b14be0000', title: 'OgreBattle64' },
  elements: ['Physical', 'Wind', 'Flame', 'Earth', 'Water', 'Virtue', 'Bane', 'Drakonite'],
  classes: [cls(0, 'None', { size: 0 }), FIGHTER, AMAZON, KNIGHT, BERSERKER, WIZARD, CLERIC, PALADIN,
    HAWKMAN, VULTAN, DRAGON, RUNE_KNIGHT, PRIEST_BOSS, NPC],
  attacks: ATTACKS,
};

describe('roster selection', () => {
  it('keeps real combat classes and drops placeholders, NPCs and story variants', () => {
    expect(isRosterClass(FIGHTER)).toBe(true);
    expect(isRosterClass(DRAGON)).toBe(true);
    expect(isRosterClass(DATA.classes[0])).toBe(false); // None
    expect(isRosterClass(NPC)).toBe(false); // movement type 7
    expect(isRosterClass(PRIEST_BOSS)).toBe(false); // a variant of the Priest class
  });
});

describe('promotions from lineage', () => {
  const ds = convertDataset(DATA);
  const targets = (id: string) => ds.classes[id].promotesTo.map((p) => p.classId);

  it('promotes a class into every class whose lineage names it, at the lineage level', () => {
    expect(targets('fighter').sort()).toEqual(['berserker', 'knight', 'wizard']);
    expect(ds.classes.fighter.promotesTo.find((p) => p.classId === 'knight')?.level).toBe(6);
  });

  it('chains the elite tier off its tier-2 ancestor', () => {
    expect(targets('knight')).toEqual(['paladin']);
    expect(ds.classes.knight.promotesTo[0].level).toBe(15);
    expect(ds.classes.paladin.tier).toBe(3);
  });

  it('keeps story classes out of the player tree even when they share lineage', () => {
    // Rune Knight's lineage runs through Amazon, but it comes after the monsters.
    expect(targets('amazon')).toEqual(['cleric']);
    expect(ds.classes['rune-knight'].playable).toBe(false);
  });

  it('lets demi-humans promote within their own family', () => {
    expect(targets('hawkman')).toEqual(['vultan']);
    expect(ds.classes.hawkman.playable).toBe(true);
  });

  it('records the lineage so a high class can be fielded as its ancestor', () => {
    expect(ds.classes.paladin.lineage).toEqual({ tier1: 'fighter', tier2Level: 6, tier2: 'knight', tier3Level: 15 });
  });
});

describe('inferred class-change requirements', () => {
  it('reproduces the documented Knight gate: STR 72, VIT 67, ALI 40-100', () => {
    expect(inferStatGates(KNIGHT)).toEqual({ str: 72, vit: 67 });
    expect(inferAlignmentWindow(KNIGHT, 2)).toEqual([40, 100]);
  });

  it('reproduces the documented Berserker gate: STR 72, VIT 67, ALI 0-60', () => {
    expect(inferStatGates(BERSERKER)).toEqual({ str: 72, vit: 67 });
    expect(inferAlignmentWindow(BERSERKER, 2)).toEqual([0, 60]);
  });

  it('reproduces the documented Wizard gate: INT 57, MEN 63, ALI 0-60', () => {
    expect(inferStatGates(WIZARD)).toEqual({ int: 57, men: 63 });
    expect(inferAlignmentWindow(WIZARD, 2)).toEqual([0, 60]);
  });

  it('reproduces the documented Paladin alignment window: 60-100', () => {
    expect(inferAlignmentWindow(PALADIN, 3)).toEqual([60, 100]);
  });
});

describe('attacks and spells', () => {
  const book = buildSpellBook(ATTACKS);

  it('reads each element\'s spell family off the attack table\'s shape', () => {
    expect(book.basic.wind?.name).toBe('Lightning');
    expect(book.advanced.wind?.name).toBe('Thunder Flare');
    expect(book.status.wind?.name).toBe('Shock Bolt');
    expect(book.summon.wind?.name).toBe('Thunderbird');
    expect(book.basic.flame?.name).toBe('Fireball');
  });

  it('makes a Wizard\'s magic a slot that resolves by element', () => {
    const ds = convertDataset(DATA);
    expect(ds.classes.wizard.attacks.back).toMatchObject({ spell: 'basic', count: 2 });
  });

  it('heals with Virtue magic, never with an attack that merely shares the effect byte', () => {
    const ds = convertDataset(DATA);
    expect(ds.classes.cleric.attacks.back).toMatchObject({ name: 'Healing', type: 'heal', target: 'allies' });
    expect(toRowAttack(ATTACKS[10], 1).type).not.toBe('heal');
  });

  it('maps melee, ranged and area magic to the right shapes', () => {
    expect(toRowAttack(ATTACKS[1], 2)).toMatchObject({ type: 'melee', count: 2, target: 'one' });
    expect(toRowAttack(ATTACKS[2], 1)).toMatchObject({ type: 'ranged' });
    expect(toRowAttack(ATTACKS[4], 1)).toMatchObject({ type: 'magic', target: 'row', element: 'wind' });
  });
});

describe('class definitions', () => {
  const ds = convertDataset(DATA);

  it('carries size, flight and fixed elements through', () => {
    expect(ds.classes['young-dragon']).toMatchObject({ size: 2, element: 'drakonite', gender: 'X' });
    expect(ds.classes.hawkman.moveType).toBe('fly');
    expect(ds.classes.fighter.element).toBeUndefined(); // rolled per recruit
  });

  it('sends casters to the back row', () => {
    expect(ds.classes.wizard.preferredRow).toBe('back');
    expect(ds.classes.knight.preferredRow).toBe('front');
  });

  it('marks every class as coming from the ROM', () => {
    expect(Object.values(ds.classes).every((c) => c.source === 'ob64')).toBe(true);
  });
});
