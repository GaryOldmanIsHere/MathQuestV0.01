import { describe, expect, it } from 'vitest';
import {
  availablePromotions,
  expToNext,
  grantExp,
  makeCharacter,
  meetsReq,
  promote,
  shiftAlignment,
  statsAt,
} from './character';
import { CLASSES, classOf } from '../data/classes';

describe('promotion gating', () => {
  it('opens Knight to a lawful Fighter but never to a chaotic one', () => {
    const lawful = makeCharacter('fighter', 8, { ali: 80, cha: 70 });
    const chaotic = makeCharacter('fighter', 8, { ali: 10, cha: 70 });

    const lawfulIds = availablePromotions(lawful).map((p) => p.classId);
    const chaoticIds = availablePromotions(chaotic).map((p) => p.classId);

    expect(lawfulIds).toContain('knight');
    expect(chaoticIds).not.toContain('knight');
    // the chaotic path is open instead
    expect(chaoticIds).toContain('berserker');
    expect(chaoticIds).toContain('ninja');
    expect(lawfulIds).not.toContain('berserker');
  });

  it('blocks on level even when alignment and charisma qualify', () => {
    const c = makeCharacter('fighter', 1, { ali: 80, cha: 90 });
    expect(availablePromotions(c).map((p) => p.classId)).not.toContain('knight');
    c.level = 5;
    expect(availablePromotions(c).map((p) => p.classId)).toContain('knight');
  });

  it('blocks on charisma even when level and alignment qualify', () => {
    const c = makeCharacter('fighter', 9, { ali: 80, cha: 20 });
    expect(availablePromotions(c).map((p) => p.classId)).not.toContain('knight');
    c.cha = 60;
    expect(availablePromotions(c).map((p) => p.classId)).toContain('knight');
  });

  it('honours both ends of a bounded alignment window', () => {
    // Beast Tamer requires ALI 25-65
    const req = classOf('fighter').promotesTo.find((p) => p.classId === 'beast-tamer')!;
    const c = makeCharacter('fighter', 9, { ali: 45, cha: 80 });
    expect(meetsReq(c, req)).toBe(true);
    c.ali = 20;
    expect(meetsReq(c, req)).toBe(false); // too chaotic
    c.ali = 90;
    expect(meetsReq(c, req)).toBe(false); // too lawful
  });

  it('refuses a promotion the character has not earned', () => {
    const c = makeCharacter('fighter', 2, { ali: 80, cha: 90 });
    expect(() => promote(c, 'knight')).toThrow();
  });

  it('refuses a promotion that is not on this class\'s tree', () => {
    const c = makeCharacter('fighter', 30, { ali: 80, cha: 90 });
    expect(() => promote(c, 'freya')).toThrow();
  });

  it('re-derives stats from the new class on a successful promotion', () => {
    const c = makeCharacter('fighter', 8, { ali: 80, cha: 70 });
    promote(c, 'knight');
    expect(c.classId).toBe('knight');
    expect(c.level).toBe(8); // level is preserved
    expect(c.stats).toEqual(statsAt('knight', 8));
    expect(c.hp).toBe(c.stats.hp);
  });
});

describe('alignment drift', () => {
  it('rises when felling someone stronger and falls when preying on the weak', () => {
    const c = makeCharacter('fighter', 10, { ali: 50 });
    shiftAlignment(c, 15); // much stronger victim
    expect(c.ali).toBeGreaterThan(50);

    const d = makeCharacter('fighter', 10, { ali: 50 });
    shiftAlignment(d, 2); // much weaker victim
    expect(d.ali).toBeLessThan(50);
  });

  it('stays inside 0..100', () => {
    const low = makeCharacter('fighter', 10, { ali: 0 });
    for (let i = 0; i < 20; i++) shiftAlignment(low, 1);
    expect(low.ali).toBeGreaterThanOrEqual(0);

    const high = makeCharacter('fighter', 10, { ali: 100 });
    for (let i = 0; i < 20; i++) shiftAlignment(high, 20);
    expect(high.ali).toBeLessThanOrEqual(100);
  });
});

describe('levelling', () => {
  it('carries leftover exp into the next level', () => {
    const c = makeCharacter('fighter', 1);
    const need = expToNext(1);
    grantExp(c, need + 5);
    expect(c.level).toBe(2);
    expect(c.exp).toBe(5);
  });

  it('can gain several levels from one large award', () => {
    const c = makeCharacter('fighter', 1);
    const ups = grantExp(c, 5000);
    expect(ups).toBeGreaterThan(1);
    expect(c.level).toBe(1 + ups);
  });

  it('raises stats and preserves the wounded fraction', () => {
    const c = makeCharacter('fighter', 1);
    const before = c.stats.str;
    c.hp = Math.floor(c.stats.hp / 2); // half health going in
    grantExp(c, expToNext(1));
    expect(c.stats.str).toBeGreaterThan(before);
    expect(c.hp).toBeGreaterThan(0);
    expect(c.hp).toBeLessThan(c.stats.hp); // still wounded after levelling
  });
});

describe('class tree integrity', () => {
  it('only points at classes that exist', () => {
    for (const def of Object.values(CLASSES)) {
      for (const req of def.promotesTo) {
        expect(CLASSES[req.classId], `${def.id} -> ${req.classId}`).toBeDefined();
      }
    }
  });

  it('keeps promotions within the same gender line', () => {
    for (const def of Object.values(CLASSES)) {
      for (const req of def.promotesTo) {
        expect(CLASSES[req.classId].gender, `${def.id} -> ${req.classId}`).toBe(def.gender);
      }
    }
  });

  it('gives every class an attack for every row', () => {
    for (const def of Object.values(CLASSES)) {
      for (const row of ['front', 'mid', 'back'] as const) {
        expect(def.attacks[row], `${def.id} has no ${row} attack`).toBeDefined();
      }
    }
  });

  it('never promotes into a lower tier', () => {
    for (const def of Object.values(CLASSES)) {
      for (const req of def.promotesTo) {
        expect(CLASSES[req.classId].tier, `${def.id} -> ${req.classId}`).toBeGreaterThanOrEqual(def.tier);
      }
    }
  });

  it('has no cycles in the promotion graph', () => {
    const seen = new Set<string>();
    const stack = new Set<string>();
    const walk = (id: string): void => {
      if (stack.has(id)) throw new Error(`cycle through ${id}`);
      if (seen.has(id)) return;
      seen.add(id);
      stack.add(id);
      for (const req of CLASSES[id].promotesTo) walk(req.classId);
      stack.delete(id);
    };
    expect(() => Object.keys(CLASSES).forEach(walk)).not.toThrow();
  });

  it('reaches every elite class from a tier-1 root', () => {
    const reachable = new Set<string>();
    const walk = (id: string): void => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const req of CLASSES[id].promotesTo) walk(req.classId);
    };
    walk('fighter');
    walk('amazon');
    const orphans = Object.values(CLASSES)
      .filter((c) => c.gender !== 'X' && !reachable.has(c.id))
      .map((c) => c.id);
    expect(orphans).toEqual([]);
  });
});
