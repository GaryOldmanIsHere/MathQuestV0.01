import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { convertDataset } from './convert';
import type { Ob64Data } from './decode';

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
