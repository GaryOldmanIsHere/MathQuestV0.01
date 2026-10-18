import { afterEach, describe, expect, it } from 'vitest';
import { expandDataset, gatesFor, normName, referenceProfiles } from './translate';
import { withExpansion } from '.';
import type { SnesClass, SowClass } from './sources';
import snesData from '../data/expansion/snes.json';
import sowData from '../data/expansion/sow.json';
import { allClasses, classOf, installDataset, ORIGINALS, resetDataset } from '../data/registry';
import { allPromotions, makeCharacter, meetsReq } from '../core/character';
import { simulateBattle } from '../core/battle';
import { autoPlace, makeSquad } from '../core/squad';
import type { Character } from '../core/types';
import { genderCompatible } from '../core/types';
import type { ClassDef } from '../core/types';

const SNES = snesData as unknown as SnesClass[];
const SOW = sowData as unknown as SowClass[];

afterEach(() => resetDataset());

const byName = (classes: Record<string, ClassDef>, name: string, origin?: ClassDef['origin']) =>
  Object.values(classes).find((c) => c.name === name && (!origin || c.origin === origin));

describe('the expanded class tree', () => {
  const classes = Object.fromEntries(allClasses().map((c) => [c.id, c]));

  it('adds classes from both games', () => {
    expect(allClasses().filter((c) => c.origin === 'snes').length).toBeGreaterThan(30);
    expect(allClasses().filter((c) => c.origin === 'sow').length).toBeGreaterThan(30);
  });

  it('leaves out every gunpowder class', () => {
    const guns = ['Gunner', 'Siege Cannon', 'Field Cannon', 'Dragoon'];
    expect(allClasses().filter((c) => c.origin === 'sow' && guns.includes(c.name))).toEqual([]);
  });

  it('points every route at a class that exists, never a tier down', () => {
    for (const c of allClasses()) {
      for (const p of c.promotesTo) {
        expect(classes[p.classId], `${c.name} -> ${p.classId}`).toBeDefined();
        expect(classes[p.classId].tier, `${c.name} -> ${p.classId}`).toBeGreaterThanOrEqual(c.tier);
      }
    }
  });

  it('only routes between genders that can hold both classes', () => {
    for (const c of allClasses()) {
      for (const p of c.promotesTo) {
        expect(genderCompatible(c.gender, classes[p.classId].gender), `${c.name} -> ${p.classId}`).toBe(true);
      }
    }
  });

  it('has no loops', () => {
    const state = new Map<string, 'open' | 'done'>();
    const visit = (id: string): void => {
      if (state.get(id) === 'done') return;
      expect(state.get(id), `loop through ${id}`).not.toBe('open');
      state.set(id, 'open');
      for (const p of classes[id].promotesTo) visit(p.classId);
      state.set(id, 'done');
    };
    for (const c of allClasses()) visit(c.id);
  });

  it('lets the player reach every playable translated class from a tier-1 class', () => {
    const reached = new Set<string>();
    const stack = allClasses().filter((c) => c.tier === 1 && c.playable).map((c) => c.id);
    while (stack.length) {
      const id = stack.pop()!;
      if (reached.has(id)) continue;
      reached.add(id);
      for (const p of classes[id].promotesTo) stack.push(p.classId);
    }
    const stranded = allClasses().filter((c) => c.origin && c.playable && !reached.has(c.id)).map((c) => c.name);
    expect(stranded).toEqual([]);
  });

  it('keeps enemy-only what is enemy-only: the risen and the SNES undead', () => {
    for (const c of allClasses().filter((c) => /^Risen|^Wraith$|^Phantom$|^Coffin$/.test(c.name))) {
      expect(c.playable, c.name).toBe(false);
    }
  });

  it('gives no class a name twice for the same gender', () => {
    const seen = new Map<string, string>();
    for (const c of allClasses()) {
      const key = `${normName(c.name)}:${c.gender}`;
      expect(seen.has(key), `${c.name} twice`).toBe(false);
      seen.set(key, c.id);
    }
  });
});

describe('merging', () => {
  it('lets the existing class win and only adds routes into it', () => {
    const { dataset } = expandDataset(ORIGINALS, SNES, SOW);
    expect(dataset.classes.knight.base).toEqual(ORIGINALS.classes.knight.base);
    expect(dataset.classes.knight.attacks).toEqual(ORIGINALS.classes.knight.attacks);
    // Symphony of War's Soldier and Cavalier both become Knights.
    const soldier = byName(dataset.classes, 'Soldier')!;
    const cavalier = byName(dataset.classes, 'Cavalier')!;
    expect(soldier.promotesTo.map((p) => p.classId)).toContain('knight');
    expect(cavalier.promotesTo.map((p) => p.classId)).toContain('knight');
  });

  it('does not touch the dataset it was given', () => {
    const before = JSON.stringify(ORIGINALS.classes);
    expandDataset(ORIGINALS, SNES, SOW);
    expect(JSON.stringify(ORIGINALS.classes)).toBe(before);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(withExpansion(ORIGINALS))).toBe(JSON.stringify(withExpansion(ORIGINALS)));
  });

  it('opens the generic Symphony of War recruit tree to Amazons as well as Fighters', () => {
    const { dataset } = expandDataset(ORIGINALS, SNES, SOW);
    const soldier = byName(dataset.classes, 'Soldier')!.id;
    expect(dataset.classes.fighter.promotesTo.map((p) => p.classId)).toContain(soldier);
    expect(dataset.classes.amazon.promotesTo.map((p) => p.classId)).toContain(soldier);
  });

  it('carries the SNES level and alignment window over as given', () => {
    const { dataset } = expandDataset(ORIGINALS, SNES, SOW);
    const wild = byName(dataset.classes, 'Wild Man')!;
    const req = dataset.classes.fighter.promotesTo.find((p) => p.classId === wild.id)!;
    expect(req).toMatchObject({ level: 6, aliMin: 0, aliMax: 49 });
  });

  it('places Symphony of War classes by the tier of their section', () => {
    const { dataset } = expandDataset(ORIGINALS, SNES, SOW);
    expect(byName(dataset.classes, 'Crossbowman')!.tier).toBe(2);
    expect(byName(dataset.classes, 'Silver Dragon Rider')!.tier).toBe(4);
  });
});

describe('guards', () => {
  const sowClass = (name: string, into: string[]): SowClass => ({
    name, group: '2', tier: 2, type: 'Heavy Infantry', movement: 'Heavy Infantry', leader: true, reqs: {},
    into, ancestors: {}, ratings: {}, levels: {}, battleOrder: '', area: null, traits: [], attacks: [], categories: [],
  });

  it('refuses a route that would close a loop', () => {
    const { dataset } = expandDataset(ORIGINALS, [], [sowClass('Left', ['Right']), sowClass('Right', ['Left'])]);
    const left = byName(dataset.classes, 'Left')!;
    const right = byName(dataset.classes, 'Right')!;
    const there = left.promotesTo.some((p) => p.classId === right.id);
    const back = right.promotesTo.some((p) => p.classId === left.id);
    expect(there !== back).toBe(true); // one way, never both
  });

  it('opens either-gender classes to men and women, never to monsters', () => {
    expect(genderCompatible('M', 'A')).toBe(true);
    expect(genderCompatible('F', 'A')).toBe(true);
    expect(genderCompatible('X', 'A')).toBe(false);
    expect(genderCompatible('A', 'X')).toBe(false);
    expect(genderCompatible('M', 'F')).toBe(false);
  });
});

describe('translation', () => {
  it('carries a class\'s standing within its tier into the new scale', () => {
    // Two SNES tier-1 classes, one stronger: the strong one lands above the
    // reference average by the same proportion, the other below.
    const avg = (name: string, str: number): SnesClass => ({
      name, family: 'fighter', from: null, level: null, cha: null, aliMin: null, aliMax: null, item: null, formOf: null,
      hp: [80, 5], str: [str, 3], agi: [50, 3], int: [40, 2], cha0: 50, ali0: 50, luk0: 50,
      aff: { p: 50, f: 50, i: 50, e: 50, b: 50, w: 50 }, terrain: 'Plains', bulk: 3, large: false,
      front: { attack: 'Slash', hits: 2 }, back: { attack: 'Slash', hits: 1 },
    });
    const { dataset } = expandDataset(ORIGINALS, [avg('Brute', 60), avg('Weakling', 40), avg('Middling', 50)], []);
    const ref = referenceProfiles(Object.values(ORIGINALS.classes))(1, false).base.str;
    expect(byName(dataset.classes, 'Middling')!.base.str).toBe(Math.round(ref));
    expect(byName(dataset.classes, 'Brute')!.base.str).toBe(Math.round(ref * 1.2));
    expect(byName(dataset.classes, 'Weakling')!.base.str).toBe(Math.round(ref * 0.8));
  });

  it('reads Symphony of War ratings in order: High above Med above Low', () => {
    const { dataset } = expandDataset(ORIGINALS, [], SOW);
    const soldier = byName(dataset.classes, 'Soldier')!; // armour High
    const rogue = byName(dataset.classes, 'Rogue')!; // armour Low
    expect(soldier.base.vit).toBeGreaterThan(rogue.base.vit);
    const apprentice = byName(dataset.classes, 'Apprentice')!;
    expect(apprentice.base.int).toBeGreaterThan(soldier.base.int);
  });

  it('turns SNES affinities into resistances: the undead shrug off all but holy power', () => {
    const { dataset } = expandDataset(ORIGINALS, SNES, []);
    const zombie = byName(dataset.classes, 'Zombie Dragon')!;
    expect(zombie.resist.virtue).toBeLessThan(40);
    expect(zombie.resist.bane).toBeGreaterThan(60);
    const wraith = byName(dataset.classes, 'Wraith')!;
    expect(wraith.resist.physical).toBe(90);
  });

  it('gives Symphony of War dragons their own element and its opposite weakness', () => {
    const { dataset } = expandDataset(ORIGINALS, [], SOW);
    const rider = byName(dataset.classes, 'Red Dragon Rider')!;
    expect(rider.element).toBe('flame');
    expect(rider.resist.flame).toBeGreaterThan(rider.resist.water);
    expect(rider.size).toBe(2);
    expect(rider.march).toBe('fly');
  });

  it('names SNES attacks for what they are', () => {
    const { dataset } = expandDataset(ORIGINALS, SNES, []);
    const samurai = byName(dataset.classes, 'Samurai Master')!;
    expect(samurai.attacks.front).toMatchObject({ name: 'Slice', type: 'melee', count: 3 });
    const seraph = byName(dataset.classes, 'Seraphim')!;
    expect(seraph.attacks.back).toMatchObject({ name: 'Jihad', target: 'all', element: 'virtue' });
    // The originals have their own Mage; take it away to see the SNES one.
    const { mage: _, ...rest } = ORIGINALS.classes;
    const bare = expandDataset({ ...ORIGINALS, classes: rest }, SNES, []).dataset;
    const mage = byName(bare.classes, 'Mage', 'snes')!;
    expect(mage.attacks.back?.spell).toBe('basic'); // cast in the caster's own element
    expect(mage.preferredRow).toBe('back'); // behind a token punch
  });

  it('gates class changes only where the dataset does, naming the stat the source names', () => {
    const plain = expandDataset(ORIGINALS, [], SOW).dataset;
    expect(plain.classes.fighter.promotesTo.every((p) => !p.stats)).toBe(true);
    const gated = expandDataset({ ...ORIGINALS, source: 'ob64' }, [], SOW).dataset;
    const scout = byName(gated.classes, 'Scout')!;
    const req = gated.classes.fighter.promotesTo.find((p) => p.classId === scout.id)!;
    expect(Object.keys(req.stats!)[0]).toBe('dex'); // Symphony of War asks for skill
    expect(req.stats).toEqual(gatesFor(scout, 'dex'));
  });
});

describe('playing the new classes', () => {
  it('rolls a gender for classes open to both', () => {
    const genders = new Set(Array.from({ length: 40 }, () => makeCharacter('soldier', 5).gender));
    expect(genders).toEqual(new Set(['M', 'F']));
    expect(makeCharacter('soldier', 5, { gender: 'F' }).gender).toBe('F');
  });

  it('shows each unit only the class changes their gender can take', () => {
    const he = makeCharacter('bowman', 10, { gender: 'M' });
    const she = makeCharacter('bowman', 10, { gender: 'F' });
    const targets = (c: typeof he) => allPromotions(c).map((p) => p.classId);
    expect(targets(she)).toContain('archer'); // the original Archer is a woman's class
    expect(targets(he)).not.toContain('archer');
    expect(targets(he)).toContain('crossbowman');
  });

  it('keeps routes that consume an item shut until items exist', () => {
    const f = makeCharacter('fighter', 30, { ali: 50 });
    const were = classOf('fighter').promotesTo.find((p) => p.item);
    expect(were).toBeDefined();
    expect(meetsReq(f, were!)).toBe(false);
    expect(meetsReq(f, { ...were!, item: undefined })).toBe(true);
  });

  it('fights: every playable translated class can field a squad and trade blows', () => {
    const translated = allClasses().filter((c) => c.origin && c.playable);
    for (let i = 0; i < translated.length; i += 4) {
      const chars = new Map<number, Character>();
      const side = (s: 'player' | 'enemy', ids: string[]) => {
        const members = ids.map((id) => makeCharacter(id, 12));
        members.forEach((m) => chars.set(m.id, m));
        const sq = makeSquad(s, [], members[0], 0, 0, 0, s);
        members.forEach((m) => autoPlace(sq, m));
        return sq;
      };
      const ours = side('player', translated.slice(i, i + 4).map((c) => c.id));
      const theirs = side('enemy', ['fighter', 'risen-knight', 'risen-archmage']);
      const result = simulateBattle({ squad: ours, chars }, { squad: theirs, chars });
      for (const c of chars.values()) {
        expect(Number.isFinite(c.hp), c.name).toBe(true);
        expect(c.hp).toBeGreaterThanOrEqual(0);
      }
      expect(result).toBeDefined();
    }
  });

  it('installs onto any dataset', () => {
    installDataset(withExpansion(ORIGINALS));
    expect(classOf('swordfighter').origin).toBe('sow');
  });
});
