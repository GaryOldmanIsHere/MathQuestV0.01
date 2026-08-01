import { describe, expect, it } from 'vitest';
import { elementBonus, simulateBattle } from './battle';
import { makeCharacter } from './character';
import { makeSquad } from './squad';
import type { Character, Squad } from './types';
import { classOf } from '../data/classes';

// Builds a squad with members pinned to exact cells so row behaviour is
// deterministic. Cell layout: col 0 = back, 1 = mid, 2 = front.
function squadOf(
  side: 'player' | 'enemy',
  placements: { classId: string; level: number; cell: number }[],
  chars: Map<number, Character>,
): Squad {
  const made = placements.map((p) => {
    const c = makeCharacter(p.classId, p.level);
    chars.set(c.id, c);
    return { char: c, cell: p.cell };
  });
  return makeSquad(side, made, made[0].char, 0, 0, 0, `${side}-squad`);
}

describe('row determines the attack used', () => {
  it('gives an archer more shots from the back than the front', () => {
    const archer = classOf('archer');
    expect(archer.attacks.back!.count).toBeGreaterThan(archer.attacks.mid!.count);
    expect(archer.attacks.front!.type).toBe('melee');
    expect(archer.attacks.back!.type).toBe('ranged');
  });

  it('drives the simulation from the cell a member occupies', () => {
    const chars = new Map<number, Character>();
    // same class, two different columns: front (cell 2) and back (cell 0)
    const front = squadOf('player', [{ classId: 'archer', level: 5, cell: 2 }], chars);
    const back = squadOf('player', [{ classId: 'archer', level: 5, cell: 0 }], chars);
    const target = () => squadOf('enemy', [{ classId: 'golem', level: 9, cell: 2 }], chars);

    const fromFront = simulateBattle({ squad: front, chars }, { squad: target(), chars });
    const fromBack = simulateBattle({ squad: back, chars }, { squad: target(), chars });

    const nameOf = (r: typeof fromFront) => {
      const act = r.events.find((e) => e.kind === 'act');
      return act && act.kind === 'act' ? act.attack.name : null;
    };
    expect(nameOf(fromFront)).toBe('Dagger');
    expect(nameOf(fromBack)).toBe('Long Bow');
  });
});

describe('engagement resolution', () => {
  it('lets a far stronger squad win and wipe a weaker one', () => {
    const chars = new Map<number, Character>();
    const strong = squadOf('player', [
      { classId: 'paladin', level: 30, cell: 2 },
      { classId: 'paladin', level: 30, cell: 5 },
      { classId: 'priest', level: 30, cell: 0 },
    ], chars);
    const weak = squadOf('enemy', [
      { classId: 'fighter', level: 1, cell: 2 },
      { classId: 'fighter', level: 1, cell: 5 },
    ], chars);

    const result = simulateBattle({ squad: strong, chars }, { squad: weak, chars });
    expect(result.winner).toBe('attacker');
    expect(result.defenderWiped).toBe(true);
    expect(result.attackerWiped).toBe(false);
  });

  it('always terminates with exactly one end event', () => {
    const chars = new Map<number, Character>();
    const a = squadOf('player', [{ classId: 'knight', level: 8, cell: 2 }], chars);
    const b = squadOf('enemy', [{ classId: 'berserker', level: 8, cell: 2 }], chars);
    const result = simulateBattle({ squad: a, chars }, { squad: b, chars });
    const ends = result.events.filter((e) => e.kind === 'end');
    expect(ends).toHaveLength(1);
    expect(result.events[result.events.length - 1].kind).toBe('end');
  });

  it('never drives hp below zero', () => {
    const chars = new Map<number, Character>();
    const a = squadOf('player', [{ classId: 'sorcerer', level: 40, cell: 0 }], chars);
    const b = squadOf('enemy', [
      { classId: 'amazon', level: 1, cell: 2 },
      { classId: 'amazon', level: 1, cell: 5 },
      { classId: 'amazon', level: 1, cell: 8 },
    ], chars);
    simulateBattle({ squad: a, chars }, { squad: b, chars });
    for (const c of chars.values()) expect(c.hp).toBeGreaterThanOrEqual(0);
  });
});

describe('healers', () => {
  it('restores allies rather than damaging enemies', () => {
    const chars = new Map<number, Character>();
    const withCleric = squadOf('player', [
      { classId: 'knight', level: 10, cell: 2 },
      { classId: 'cleric', level: 10, cell: 0 },
    ], chars);
    const knight = [...chars.values()].find((c) => c.classId === 'knight')!;
    knight.hp = 5; // wounded going in

    const foe = squadOf('enemy', [{ classId: 'skeleton', level: 2, cell: 2 }], chars);
    const result = simulateBattle({ squad: withCleric, chars }, { squad: foe, chars });

    const heal = result.events.find((e) => e.kind === 'act' && e.attack.type === 'heal');
    expect(heal).toBeDefined();
    expect(knight.hp).toBeGreaterThan(5);
  });

  it('does not heal past a target\'s maximum hp', () => {
    const chars = new Map<number, Character>();
    const squad = squadOf('player', [
      { classId: 'knight', level: 10, cell: 2 },
      { classId: 'priest', level: 20, cell: 0 },
    ], chars);
    const knight = [...chars.values()].find((c) => c.classId === 'knight')!;
    knight.hp = knight.stats.hp - 1;
    const foe = squadOf('enemy', [{ classId: 'ghost', level: 2, cell: 2 }], chars);
    simulateBattle({ squad, chars }, { squad: foe, chars });
    expect(knight.hp).toBeLessThanOrEqual(knight.stats.hp);
  });
});

describe('holy damage', () => {
  const holy = classOf('paladin').attacks.front!;
  const plain = classOf('knight').attacks.front!;

  it('is amplified against the undead', () => {
    const chars = new Map<number, Character>();
    const skeleton = squadOf('enemy', [{ classId: 'skeleton', level: 5, cell: 2 }], chars);
    const undead = chars.get(skeleton.grid[2]!)!;
    expect(elementBonus(holy, undead)).toBeGreaterThan(1);
  });

  it('is unchanged against the living', () => {
    const chars = new Map<number, Character>();
    const squad = squadOf('enemy', [{ classId: 'fighter', level: 5, cell: 2 }], chars);
    const living = chars.get(squad.grid[2]!)!;
    expect(elementBonus(holy, living)).toBe(1);
  });

  it('gives no bonus to a non-holy attack against the undead', () => {
    const chars = new Map<number, Character>();
    const skeleton = squadOf('enemy', [{ classId: 'ghost', level: 5, cell: 2 }], chars);
    const undead = chars.get(skeleton.grid[2]!)!;
    expect(elementBonus(plain, undead)).toBe(1);
  });
});

describe('target acquisition', () => {
  it('strikes the enemy front rank before the back rank', () => {
    const chars = new Map<number, Character>();
    // one attacker, two defenders in different columns
    const atk = squadOf('player', [{ classId: 'knight', level: 12, cell: 2 }], chars);
    const def = squadOf('enemy', [
      { classId: 'wizard', level: 3, cell: 0 }, // back column
      { classId: 'phalanx', level: 3, cell: 2 }, // front column
    ], chars);
    const backman = chars.get(def.grid[0]!)!;
    const frontman = chars.get(def.grid[2]!)!;

    const result = simulateBattle({ squad: atk, chars }, { squad: def, chars });
    const firstStrike = result.events.find(
      (e) => e.kind === 'act' && e.actorId === atk.grid[2] && e.attack.type !== 'heal',
    );
    expect(firstStrike?.kind).toBe('act');
    if (firstStrike?.kind === 'act') {
      expect(firstStrike.targetIds[0]).toBe(frontman.id);
      expect(firstStrike.targetIds[0]).not.toBe(backman.id);
    }
  });

  it('spills onto the back rank once the front rank has fallen', () => {
    const chars = new Map<number, Character>();
    const atk = squadOf('player', [{ classId: 'paladin', level: 40, cell: 2 }], chars);
    const def = squadOf('enemy', [
      { classId: 'wizard', level: 1, cell: 0 },
      { classId: 'fighter', level: 1, cell: 2 },
    ], chars);
    const backman = chars.get(def.grid[0]!)!;
    const frontman = chars.get(def.grid[2]!)!;

    simulateBattle({ squad: atk, chars }, { squad: def, chars });
    // the front-ranker dies first, so the back-ranker must also have been reached
    expect(frontman.hp).toBe(0);
    expect(backman.hp).toBeLessThan(backman.stats.hp);
  });
});
