import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertDataset } from './convert';
import type { Ob64Data } from './decode';
import { withExpansion } from '../expansion';

// Integrity checks on the data extracted from a real ROM. They run only where
// `npm run extract:ob64` has been run: CI has no ROM, and must not.

const PATH = 'public/ob64/data.json';
const present = existsSync(PATH);

describe.skipIf(!present)('extracted Ogre Battle 64 data', () => {
  const data = present ? (JSON.parse(readFileSync(PATH, 'utf8')) as Ob64Data) : null;
  const ds = data ? convertDataset(data) : null;
  const classes = ds ? Object.values(ds.classes) : [];
  const byName = (n: string) => classes.find((c) => c.name === n)!;

  it('is the supported dump', () => {
    expect(data!.source.sha1).toBe('d26b14bee422a09581ce438d45ba9fec9783fbb8');
  });

  it('gives Fighter its eight class changes and Amazon its six', () => {
    const names = (c: string) => byName(c).promotesTo.map((p) => ds!.classes[p.classId].name).sort();
    expect(names('Fighter')).toEqual(
      ['Beast Tamer', 'Berserker', 'Doll Master', 'Fencer', 'Knight', 'Ninja', 'Phalanx', 'Wizard'],
    );
    expect(names('Amazon')).toEqual(['Archer', 'Cleric', 'Dragon Tamer', 'Sorceress', 'Valkyrie', 'Witch']);
  });

  it('points every promotion at a class that exists, of the same gender, a tier up', () => {
    for (const c of classes) {
      for (const p of c.promotesTo) {
        const t = ds!.classes[p.classId];
        expect(t, `${c.name} -> ${p.classId}`).toBeDefined();
        expect(t.gender, `${c.name} -> ${t.name}`).toBe(c.gender);
        expect(t.tier, `${c.name} -> ${t.name}`).toBe(c.tier + 1);
        expect(t.playable, `${c.name} -> ${t.name}`).toBe(true);
      }
    }
  });

  it('gives every class an attack in every row, and the casters a spell for each natural element', () => {
    for (const c of classes) {
      for (const row of ['front', 'mid', 'back'] as const) {
        expect(c.attacks[row], `${c.name} ${row}`).toBeDefined();
      }
    }
    for (const el of ['wind', 'flame', 'earth', 'water'] as const) {
      expect(ds!.spells!.basic[el], el).toBeDefined();
      expect(ds!.spells!.advanced[el], el).toBeDefined();
    }
  });

  it('reads clean names, with no control bytes left in them', () => {
    for (const c of classes) expect(c.name, c.name).toMatch(/^[A-Za-z][A-Za-z ()'.-]*$/);
  });

  it('flags the great monsters as large', () => {
    for (const n of ['Young Dragon', 'Red Dragon', 'Golem', 'Hellhound', 'Cerberus', 'Ogre']) {
      expect(byName(n).size, n).toBe(2);
    }
    expect(byName('Fighter').size).toBe(1);
  });
});

describe.skipIf(!present)('the expansion on extracted Ogre Battle 64 data', () => {
  const ds = present ? withExpansion(convertDataset(JSON.parse(readFileSync(PATH, 'utf8')) as Ob64Data)) : null;
  const classes = ds ? Object.values(ds.classes) : [];

  it('keeps every Ogre Battle 64 class as the game has it, and adds routes into them', () => {
    const plain = convertDataset(JSON.parse(readFileSync(PATH, 'utf8')) as Ob64Data);
    for (const [id, c] of Object.entries(plain.classes)) {
      expect(ds!.classes[id].base, c.name).toEqual(c.base);
      for (const p of c.promotesTo) expect(ds!.classes[id].promotesTo).toContainEqual(p);
    }
    const beastMaster = classes.find((c) => c.name === 'Beast Master')!.id;
    const into = classes.filter((c) => c.promotesTo.some((p) => p.classId === beastMaster)).map((c) => c.name);
    expect(into).toContain('Beast Tamer');
  });

  it('meets the shared classes rather than copying them', () => {
    for (const name of ['Knight', 'Paladin', 'Wizard', 'Valkyrie', 'Red Dragon', 'Griffin']) {
      expect(classes.filter((c) => c.name === name && c.playable).length, name).toBe(1);
    }
    expect(classes.some((c) => c.name === 'Gryphon' || c.name === 'Cockatris')).toBe(false);
  });

  it('follows Ogre Battle 64 rules: translated classes roll growth and are stat-gated', () => {
    const soldier = classes.find((c) => c.name === 'Soldier' && c.origin === 'sow')!;
    expect(soldier.source).toBe('ob64');
    const fighter = classes.find((c) => c.name === 'Fighter')!;
    const req = fighter.promotesTo.find((p) => p.classId === soldier.id)!;
    expect(Object.keys(req.stats ?? {})).toHaveLength(2);
    expect(fighter.promotesTo.length).toBeGreaterThan(15);
  });
});
