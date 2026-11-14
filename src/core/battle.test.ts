import { describe, expect, it } from 'vitest';
import { chooseTarget, critChance, elementBonus, hitChance, judgeClash, simulateBattle } from './battle';
import type { Combatant } from './battle';
import { memberRow } from './squad';
import { makeCharacter } from './character';
import { makeSquad } from './squad';
import type { Character, Squad } from './types';
import { classOf } from '../data/registry';

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

describe('judging a clash', () => {
  it('goes to the side that lost the smaller share of its strength', () => {
    expect(judgeClash(0.2, 0.5)).toBe('attacker');
    expect(judgeClash(0.5, 0.2)).toBe('defender');
    expect(judgeClash(0.5, 0.52)).toBe('draw');
  });

  it('judges every battle no one was wiped out of by those shares', () => {
    let judged = 0;
    for (let k = 0; k < 40; k++) {
      const chars = new Map<number, Character>();
      const five = squadOf('player', [
        { classId: 'fighter', level: 5, cell: 2 }, { classId: 'fighter', level: 5, cell: 5 },
        { classId: 'cleric', level: 5, cell: 8 }, { classId: 'archer', level: 5, cell: 0 },
        { classId: 'archer', level: 5, cell: 3 },
      ], chars);
      const champion = squadOf('enemy', [{ classId: 'black-knight', level: 4 + (k % 6), cell: 2 }], chars);
      const members = (sq: Squad) => sq.grid.filter((id) => id !== null).map((id) => chars.get(id!)!);
      const strength = (sq: Squad) => members(sq).reduce((a, c) => a + c.stats.hp, 0);
      const health = (sq: Squad) => members(sq).reduce((a, c) => a + c.hp, 0);
      const [mine, theirs] = [strength(five), strength(champion)];
      const [mineBefore, theirsBefore] = [health(five), health(champion)];
      const result = simulateBattle({ squad: five, chars }, { squad: champion, chars });
      if (result.attackerWiped || result.defenderWiped) continue;
      // By the health each side has truly lost: what was mended is not counted, nor a blow's excess.
      expect(result.winner).toBe(judgeClash((mineBefore - health(five)) / mine, (theirsBefore - health(champion)) / theirs));
      judged++;
    }
    expect(judged).toBeGreaterThan(0);
  });
});

describe('what a clash is judged on', () => {
  it('counts a blow for no more than the health it took, and not what a healer mended', () => {
    // One frail soldier felled by a blow many times his health: by the blow's
    // size the champion's side "lost" far more than its whole strength.
    for (let k = 0; k < 20; k++) {
      const chars = new Map<number, Character>();
      const mine = squadOf('player', [{ classId: 'knight', level: 9, cell: 2 }, { classId: 'knight', level: 9, cell: 5 }], chars);
      const theirs = squadOf('enemy', [
        { classId: 'fighter', level: 3, cell: 2 }, { classId: 'knight', level: 9, cell: 5 }, { classId: 'knight', level: 9, cell: 8 },
      ], chars);
      chars.get(theirs.grid[2]!)!.hp = 1;
      const members = (sq: Squad) => sq.grid.filter((id) => id !== null).map((id) => chars.get(id!)!);
      const lost = (sq: Squad, before: number) => (before - members(sq).reduce((a, c) => a + c.hp, 0)) / members(sq).reduce((a, c) => a + c.stats.hp, 0);
      const before = [mine, theirs].map((sq) => members(sq).reduce((a, c) => a + c.hp, 0));
      const result = simulateBattle({ squad: mine, chars }, { squad: theirs, chars });
      if (result.attackerWiped || result.defenderWiped) continue;
      expect(result.winner).toBe(judgeClash(lost(mine, before[0]), lost(theirs, before[1])));
    }
  });

  it('lets a healer mend as many times as her row gives', () => {
    const chars = new Map<number, Character>();
    const mine = squadOf('player', [{ classId: 'cleric', level: 5, cell: 0 }, { classId: 'knight', level: 5, cell: 2 }], chars);
    const theirs = squadOf('enemy', [{ classId: 'fighter', level: 1, cell: 2 }], chars);
    const knight = chars.get(mine.grid[2]!)!;
    knight.stats.hp = 10000;
    knight.hp = 100;
    const result = simulateBattle({ squad: mine, chars }, { squad: theirs, chars });
    const heal = result.events.find((e) => e.kind === 'act' && e.attack.type === 'heal') as { attack: { count: number }; amounts: number[] };
    expect(heal.amounts.length).toBe(heal.attack.count);
  });
});

describe('experience', () => {
  it('raises the player\'s soldiers but leaves the enemy at its campaign levels', () => {
    for (const playerAttacks of [true, false]) {
      const chars = new Map<number, Character>();
      const mine = squadOf('player', [{ classId: 'knight', level: 3, cell: 2 }, { classId: 'knight', level: 3, cell: 5 }], chars);
      const theirs = squadOf('enemy', [{ classId: 'knight', level: 3, cell: 2 }, { classId: 'knight', level: 3, cell: 5 }], chars);
      for (const c of chars.values()) c.stats.hp = c.hp = 10000; // everyone lives to learn
      const [a, d] = playerAttacks ? [mine, theirs] : [theirs, mine];
      const result = simulateBattle({ squad: a, chars }, { squad: d, chars });
      const side = (id: number) => (mine.grid.includes(id) ? 'player' : 'enemy');
      const learned = [...result.expGained.keys()];
      expect(learned.some((id) => side(id) === 'enemy')).toBe(true); // the enemy earned some...
      for (const c of chars.values()) {
        if (side(c.id) === 'player') expect(c.level * 1000 + c.exp).toBeGreaterThan(3000);
        else expect([c.level, c.exp]).toEqual([3, 0]); // ...but keeps none of it
      }
    }
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
    // A holy blade is half blade: against the living it lands no harder than a plain one.
    expect(elementBonus(holy, living)).toBeCloseTo((1 + elementBonus(plain, living)) / 2);
    expect(elementBonus(holy, living)).toBeLessThanOrEqual(1);
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

describe('whom a combatant strikes at', () => {
  const field = (tactic?: Squad['tactic']) => {
    const chars = new Map<number, Character>();
    const mine = squadOf('player', [{ classId: 'knight', level: 5, cell: 8 }, { classId: 'archer', level: 5, cell: 0 }], chars);
    mine.tactic = tactic;
    // Front rank: cells 2 (top lane) and 8 (bottom lane); the leader, an archer, at the back.
    const theirs = squadOf('enemy', [
      { classId: 'archer', level: 5, cell: 3 }, { classId: 'knight', level: 5, cell: 2 }, { classId: 'knight', level: 5, cell: 8 },
    ], chars);
    const of = (sq: Squad): Combatant[] => sq.grid.flatMap((id, cell) => (id === null ? [] : [{ char: chars.get(id)!, squad: sq, row: memberRow(sq, id), cell }]));
    const [knight, archer] = [of(mine).find((c) => c.cell === 8)!, of(mine).find((c) => c.cell === 0)!];
    return { knight, archer, foes: of(theirs), blade: classOf('knight').attacks.front!, bow: classOf('archer').attacks.back! };
  };

  it('goes for whoever stands across from it in the front rank, not always the same soldier', () => {
    const { knight, archer, foes, blade, bow } = field();
    expect(chooseTarget(knight, blade, foes)!.cell).toBe(8); // its own lane
    expect(chooseTarget(archer, bow, foes)!.cell).toBe(2); // and the archer's
  });

  it('lets arrows reach the back rank on orders, but never blades', () => {
    const { knight, archer, foes, blade, bow } = field('leader');
    expect(chooseTarget(archer, bow, foes)!.cell).toBe(3); // the leader, behind the front rank
    expect(chooseTarget(knight, blade, foes)!.row).toBe('front');
  });

  it('picks the weakest or the strongest of those in reach', () => {
    const weak = field('weakest');
    weak.foes.find((c) => c.cell === 2)!.char.hp = 5;
    expect(chooseTarget(weak.knight, weak.blade, weak.foes)!.cell).toBe(2);
    const strong = field('strongest');
    strong.foes.find((c) => c.cell === 2)!.char.hp = 5;
    expect(chooseTarget(strong.knight, strong.blade, strong.foes)!.cell).toBe(8);
  });

  it('moves on to the next rank once the front has fallen', () => {
    const { knight, foes, blade } = field();
    for (const c of foes) if (c.row === 'front') c.char.hp = 0;
    expect(chooseTarget(knight, blade, foes)!.cell).toBe(3);
  });
});

describe('hits, misses and telling blows', () => {
  const pair = () => [makeCharacter('knight', 5), makeCharacter('knight', 5)] as const;
  const blade = classOf('knight').attacks.front!;

  it('lands more surely for the deft, less surely on the quick, within bounds', () => {
    const [a, t] = pair();
    const even = hitChance(blade, a, t);
    a.stats.dex += 6;
    expect(hitChance(blade, a, t)).toBeGreaterThan(even);
    a.stats.dex -= 6;
    t.stats.agi += 6;
    expect(hitChance(blade, a, t)).toBeLessThan(even);
    t.stats.agi += 500;
    expect(hitChance(blade, a, t)).toBe(0.65);
    a.stats.dex += 5000;
    expect(hitChance(blade, a, t)).toBe(1);
  });

  it('never lets a spell miss', () => {
    const [a, t] = pair();
    t.stats.agi += 500;
    expect(hitChance({ ...blade, type: 'magic' }, a, t)).toBe(1);
  });

  it('tells more often for the lucky', () => {
    const [a, t] = pair();
    a.luk = t.luk = 50;
    expect(critChance(a, t)).toBeCloseTo(0.05);
    a.luk = 100;
    expect(critChance(a, t)).toBeGreaterThan(0.05);
    a.luk = 0;
    expect(critChance(a, t)).toBeLessThan(0.05);
  });

  it('records a miss as no harm done, and sees both misses and telling blows over many battles', () => {
    const seen = new Set<string>();
    for (let k = 0; k < 60; k++) {
      const chars = new Map<number, Character>();
      const mine = squadOf('player', [{ classId: 'knight', level: 5, cell: 2 }, { classId: 'knight', level: 5, cell: 5 }], chars);
      const theirs = squadOf('enemy', [{ classId: 'ninja', level: 5, cell: 2 }, { classId: 'ninja', level: 5, cell: 5 }], chars);
      for (const c of chars.values()) c.stats.hp = c.hp = 10000;
      for (const e of simulateBattle({ squad: mine, chars }, { squad: theirs, chars }).events) {
        if (e.kind !== 'act') continue;
        e.results.forEach((r, i) => {
          seen.add(r);
          if (r === 'miss') expect(e.amounts[i]).toBe(0);
          else expect(e.amounts[i]).toBeGreaterThan(0);
        });
      }
    }
    expect(seen).toEqual(new Set(['hit', 'miss', 'crit']));
  });
});

describe('rounds', () => {
  it('gives each fighter one strike a round, as many rounds as its row gives strikes', () => {
    const chars = new Map<number, Character>();
    const mine = squadOf('player', [{ classId: 'knight', level: 5, cell: 2 }], chars);
    const theirs = squadOf('enemy', [{ classId: 'knight', level: 5, cell: 2 }], chars);
    for (const c of chars.values()) c.stats.hp = c.hp = 10000;
    const { events } = simulateBattle({ squad: mine, chars }, { squad: theirs, chars });
    const count = classOf('knight').attacks.front!.count;
    const acts = events.filter((e) => e.kind === 'act');
    expect(acts).toHaveLength(count * 2);
    for (const e of acts) if (e.kind === 'act') expect(e.targetIds).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'round')).toHaveLength(count - 1);
  });

  it('gives the fallen no later strikes', () => {
    const chars = new Map<number, Character>();
    const mine = squadOf('player', [{ classId: 'knight', level: 9, cell: 2 }], chars);
    const theirs = squadOf('enemy', [{ classId: 'knight', level: 5, cell: 2 }, { classId: 'knight', level: 5, cell: 5 }], chars);
    const victim = chars.get(theirs.grid[2]!)!;
    victim.hp = 1;
    victim.stats.agi = 0; // struck before it can act
    chars.get(mine.grid[2]!)!.stats.dex = 9999;
    const { events } = simulateBattle({ squad: mine, chars }, { squad: theirs, chars });
    expect(events.some((e) => e.kind === 'act' && e.actorId === victim.id)).toBe(false);
  });
});

describe('what a squad learns', () => {
  it('is shared: a healer and a soldier who never struck grow with the rest', () => {
    const chars = new Map<number, Character>();
    const mine = squadOf('player', [
      { classId: 'knight', level: 5, cell: 2 }, { classId: 'cleric', level: 5, cell: 0 }, { classId: 'cleric', level: 5, cell: 3 },
    ], chars);
    const theirs = squadOf('enemy', [{ classId: 'fighter', level: 5, cell: 2 }], chars);
    for (const c of chars.values()) c.stats.hp = c.hp = 10000;
    simulateBattle({ squad: mine, chars }, { squad: theirs, chars });
    for (const id of mine.grid) if (id !== null) expect(chars.get(id)!.exp + chars.get(id)!.level * 1000, chars.get(id)!.name).toBeGreaterThan(5000);
  });
});
