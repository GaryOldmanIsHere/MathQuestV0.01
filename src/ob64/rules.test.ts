import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classAtLevel, generateStats, grantExp, makeCharacter, promote, rollGrowth, expToNext } from '../core/character';
import { elementBonus, resolveAttack } from '../core/battle';
import { classOf, installDataset, resetDataset } from '../data/registry';
import type { ClassDef, Stats } from '../core/types';
import { convertDataset } from './convert';
import type { Ob64Class, Ob64Data } from './decode';

// The game rules that only apply to Ogre Battle 64 classes, run against a
// small synthetic dataset installed in the registry.

const NEUTRAL = { physical: 50, wind: 50, flame: 50, earth: 50, water: 50, virtue: 50, bane: 50 };
function cls(id: number, name: string, growth: number[], over: Partial<Ob64Class> = {}): Ob64Class {
  const keys = ['hp', 'str', 'vit', 'int', 'men', 'agi', 'dex'] as const;
  const stats = {} as Ob64Class['stats'];
  keys.forEach((k, i) => { stats[k] = { base: 100 * (i + 1), growth: growth[i] }; });
  return {
    id, name, size: 1, gender: 0, flag06: 0, stats, luck: 50, alignment: 50, resist: { ...NEUTRAL },
    moveType: 2, equipment: [0, 0, 0, 0], flag36: 0,
    rows: [{ attack: 1, hits: 2 }, { attack: 1, hits: 1 }, { attack: 0x2d, hits: 2 }],
    battle3D: [0, 0, 0, 0], lineage: { tier1: 0, tier2Level: 0, tier2: 0, tier3Level: 0 },
    variantOf: 0, element: 0xff, flag47: 2, ...over,
  };
}

const DATA: Ob64Data = {
  source: { sha1: 'synthetic', title: 'test' },
  elements: [],
  classes: [
    cls(0, 'None', [0, 0, 0, 0, 0, 0, 0], { size: 0 }),
    cls(2, 'Fighter', [1, 1, 1, 1, 1, 1, 1]),
    cls(5, 'Knight', [3, 3, 3, 3, 3, 3, 3], { lineage: { tier1: 2, tier2Level: 6, tier2: 0, tier3Level: 0 } }),
    cls(19, 'Paladin', [7, 7, 7, 7, 7, 7, 7], { lineage: { tier1: 2, tier2Level: 6, tier2: 5, tier3Level: 15 } }),
    cls(48, 'Ghost', [1, 1, 1, 1, 1, 1, 1], { gender: 4, element: 6,
      resist: { ...NEUTRAL, virtue: 30, bane: 70 } }),
  ],
  attacks: [
    { id: 0, name: '', category: 0xff, element: 0, target: 0, effect: 0, raw: [] },
    { id: 1, name: 'Slash', category: 0, element: 0, target: 1, effect: 1, raw: [] },
    { id: 2, name: 'Lightning', category: 3, element: 1, target: 1, effect: 1, raw: [] },
    { id: 3, name: 'Fireball', category: 3, element: 2, target: 1, effect: 1, raw: [] },
    { id: 4, name: 'Banish', category: 4, element: 5, target: 1, effect: 1, raw: [] },
  ],
};

beforeEach(() => installDataset(convertDataset(DATA)));
afterEach(() => resetDataset());

const KEYS: (keyof Stats)[] = ['hp', 'str', 'vit', 'int', 'men', 'agi', 'dex'];

describe('lineage', () => {
  it('fields a Paladin below its level as the ancestor it still is', () => {
    expect(classAtLevel('paladin', 3)).toBe('fighter');
    expect(classAtLevel('paladin', 10)).toBe('knight');
    expect(classAtLevel('paladin', 15)).toBe('paladin');
  });

  it('creates the unit as that ancestor', () => {
    expect(makeCharacter('paladin', 8).classId).toBe('knight');
    expect(makeCharacter('paladin', 20).classId).toBe('paladin');
  });
});

describe('growth', () => {
  it('rolls each stat as growth plus 0 to 2, the way the game does', () => {
    const knight = classOf('knight');
    for (let i = 0; i < 200; i++) {
      const g = rollGrowth(knight);
      for (const k of KEYS) {
        expect(g[k]).toBeGreaterThanOrEqual(knight.growth[k]);
        expect(g[k]).toBeLessThanOrEqual(knight.growth[k] + 2);
      }
    }
  });

  it('actually rolls: over many level-ups both the low and the high gain come up', () => {
    const knight = classOf('knight');
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) seen.add(rollGrowth(knight).str - knight.growth.str);
    expect(seen).toEqual(new Set([0, 1, 2]));
  });

  it('starts from the level-1 ancestor\'s bases and grows as each class held along the way', () => {
    // Fighter bases are 100,200,...; Fighter grows 1, Knight 3, Paladin 7.
    // A level-16 Paladin: 5 Fighter levels (1..5), 9 Knight levels (6..14), 1 Paladin level (15).
    const s = generateStats('paladin', 16);
    for (const [i, k] of KEYS.entries()) {
      const base = 100 * (i + 1);
      const min = base + 5 * 1 + 9 * 3 + 1 * 7;
      expect(s[k]).toBeGreaterThanOrEqual(min);
      expect(s[k]).toBeLessThanOrEqual(min + 2 * 15);
    }
  });

  it('grows a levelled-up unit as its current class, on top of what it has', () => {
    const c = makeCharacter('knight', 6);
    const before = { ...c.stats };
    grantExp(c, expToNext(6));
    for (const k of KEYS) {
      expect(c.stats[k] - before[k]).toBeGreaterThanOrEqual(3);
      expect(c.stats[k] - before[k]).toBeLessThanOrEqual(5);
    }
  });
});

describe('class change', () => {
  it('keeps the unit\'s own stats', () => {
    const c = makeCharacter('fighter', 30, { ali: 80 });
    c.stats = { hp: 999, str: 999, vit: 999, int: 999, men: 999, agi: 999, dex: 999 };
    const before = { ...c.stats };
    promote(c, 'knight');
    expect(c.classId).toBe('knight');
    expect(c.stats).toEqual(before);
  });
});

describe('elements in battle', () => {
  it('rolls a natural element for human recruits and keeps a monster\'s own', () => {
    for (let i = 0; i < 30; i++) {
      expect(['wind', 'flame', 'earth', 'water']).toContain(makeCharacter('fighter', 1).element);
    }
    expect(makeCharacter('ghost', 5).element).toBe('bane');
  });

  it('turns a spell slot into the spell of the caster\'s element', () => {
    const slot = classOf('fighter').attacks.back!;
    expect(slot.spell).toBe('basic');
    const wind = resolveAttack(slot, makeCharacter('fighter', 1, { element: 'wind' }));
    const flame = resolveAttack(slot, makeCharacter('fighter', 1, { element: 'flame' }));
    expect(wind).toMatchObject({ name: 'Lightning', element: 'wind', count: 2 });
    expect(flame).toMatchObject({ name: 'Fireball', element: 'flame', count: 2 });
  });

  it('scales damage by the target class\'s resistance to the element', () => {
    const ghost = makeCharacter('ghost', 5);
    const virtue = { name: 'Banish', type: 'magic', count: 1, power: 1, target: 'one', element: 'virtue' } as const;
    const bane = { ...virtue, element: 'bane' } as const;
    expect(elementBonus(virtue, ghost)).toBeGreaterThan(1); // resists virtue at 30
    expect(elementBonus(bane, ghost)).toBeLessThan(1); // resists bane at 70
  });
});

describe('registry', () => {
  it('reverts to the built-in classes when reset', () => {
    resetDataset();
    expect((classOf('fighter') as ClassDef).source).toBe('builtin');
  });
});
