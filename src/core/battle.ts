import type { Character, ResistKey, Row, RowAttack, Squad } from './types';
import { classOf, resolveSpell } from '../data/registry';
import { grantExp, shiftAlignment } from './character';
import { memberRow, squadMemberIds } from './squad';
import { rng } from '../data/names';

// One Ogre Battle engagement: every combatant acts once in agility order,
// attack shape determined by their row on the 3x3 grid. The side that dealt
// more total damage wins the clash; the loser is pushed back on the map.

export interface Combatant {
  char: Character;
  squad: Squad;
  row: Row;
  cell: number; // 0..8 in own grid
}

export type BattleEvent =
  | { kind: 'act'; actorId: number; attack: RowAttack; targetIds: number[]; amounts: number[]; kos: number[] }
  | { kind: 'skip'; actorId: number } // dead or no valid target
  | { kind: 'end'; winner: 'attacker' | 'defender' | 'draw'; attackerDamage: number; defenderDamage: number };

export interface BattleResult {
  events: BattleEvent[];
  winner: 'attacker' | 'defender' | 'draw';
  attackerWiped: boolean;
  defenderWiped: boolean;
  expGained: Map<number, number>;
  levelUps: Map<number, number>;
}

/**
 * How hard an attack lands given the target's class resistance to its element
 * (physical for unelemented blows). 50 is neutral; each point below makes the
 * hit 2% stronger and each point above 2% weaker, so the undead's low Virtue
 * resistance turns holy magic into a scourge. The resistances are the game's;
 * this scaling is provisional until the battle formula itself is decoded.
 */
export function elementBonus(att: RowAttack, target: Character): number {
  // Drakonite (the dragons' own element) has no resistance column; it lands as physical.
  const key: ResistKey = att.element && att.element !== 'drakonite' ? att.element : 'physical';
  const resist = classOf(target.classId).resist[key] ?? 50;
  return Math.max(0.25, Math.min(2, 1 + (50 - resist) / 50));
}

/**
 * The attack a combatant actually makes. Spell slots (a Wizard's magic, a
 * Witch's hex) become the spell of that kind for the caster's own element.
 */
export function resolveAttack(attack: RowAttack, caster: Character): RowAttack {
  if (!attack.spell) return attack;
  const spell = resolveSpell(attack.spell, caster.element);
  return spell
    ? { ...spell, count: attack.count }
    : { ...attack, element: caster.element, spell: undefined };
}

function damageOf(att: RowAttack, actor: Character, target: Character): number {
  const offense = att.type === 'magic' || att.type === 'heal' ? actor.stats.int : actor.stats.str;
  const defense = att.type === 'magic' ? target.stats.men : target.stats.vit;
  const raw = offense * att.power - defense * 0.55;
  const spread = 0.85 + rng() * 0.3;
  return Math.max(1, Math.floor(raw * spread * elementBonus(att, target)));
}

function healOf(att: RowAttack, actor: Character): number {
  return Math.max(2, Math.floor(actor.stats.int * att.power * (0.9 + rng() * 0.2)));
}

/** Live enemies, nearest column first (enemies' front rank is hit first). */
function targetPool(enemies: Combatant[]): Combatant[] {
  const alive = enemies.filter((c) => c.char.hp > 0);
  const rank = (r: Row) => (r === 'front' ? 0 : r === 'mid' ? 1 : 2);
  return alive.sort((a, b) => rank(a.row) - rank(b.row));
}

export function simulateBattle(
  attacker: { squad: Squad; chars: Map<number, Character> },
  defender: { squad: Squad; chars: Map<number, Character> },
): BattleResult {
  const make = (side: { squad: Squad; chars: Map<number, Character> }): Combatant[] =>
    squadMemberIds(side.squad)
      .map((id) => {
        const char = side.chars.get(id)!;
        return {
          char,
          squad: side.squad,
          row: memberRow(side.squad, id),
          cell: side.squad.grid.indexOf(id),
        };
      })
      .filter((c) => c.char.hp > 0);

  const atk = make(attacker);
  const def = make(defender);
  const events: BattleEvent[] = [];
  const damageBy = { attacker: 0, defender: 0 };
  const expGained = new Map<number, number>();
  const levelUps = new Map<number, number>();

  const order = [...atk, ...def].sort((a, b) => b.char.stats.agi - a.char.stats.agi);

  for (const actor of order) {
    if (actor.char.hp <= 0) {
      events.push({ kind: 'skip', actorId: actor.char.id });
      continue;
    }
    const isAttacker = actor.squad.id === attacker.squad.id;
    const allies = isAttacker ? atk : def;
    const enemies = isAttacker ? def : atk;
    const slot = classOf(actor.char.classId).attacks[actor.row];
    if (!slot) {
      events.push({ kind: 'skip', actorId: actor.char.id });
      continue;
    }
    const attack = resolveAttack(slot, actor.char);

    if (attack.type === 'heal') {
      const hurt = allies
        .filter((c) => c.char.hp > 0 && c.char.hp < c.char.stats.hp)
        .sort((a, b) => a.char.hp / a.char.stats.hp - b.char.hp / b.char.stats.hp);
      if (hurt.length === 0) {
        events.push({ kind: 'skip', actorId: actor.char.id });
        continue;
      }
      const targets = attack.target === 'allies' ? hurt.slice(0, 3) : hurt.slice(0, 1);
      const ids: number[] = [];
      const amounts: number[] = [];
      for (const t of targets) {
        const amt = Math.min(healOf(attack, actor.char), t.char.stats.hp - t.char.hp);
        t.char.hp += amt;
        ids.push(t.char.id);
        amounts.push(amt);
      }
      events.push({ kind: 'act', actorId: actor.char.id, attack, targetIds: ids, amounts, kos: [] });
      continue;
    }

    const pool = targetPool(enemies);
    if (pool.length === 0) {
      events.push({ kind: 'skip', actorId: actor.char.id });
      continue;
    }

    let targets: Combatant[];
    if (attack.target === 'all') {
      targets = pool;
    } else if (attack.target === 'row') {
      const row = pool[0].row;
      targets = pool.filter((c) => c.row === row);
    } else {
      targets = [pool[0]];
    }

    const ids: number[] = [];
    const amounts: number[] = [];
    const kos: number[] = [];
    for (let strike = 0; strike < attack.count; strike++) {
      for (const t of targets) {
        if (t.char.hp <= 0) continue;
        const dmg = damageOf(attack, actor.char, t.char);
        t.char.hp = Math.max(0, t.char.hp - dmg);
        damageBy[isAttacker ? 'attacker' : 'defender'] += dmg;
        ids.push(t.char.id);
        amounts.push(dmg);
        const exp = 8 + Math.max(0, t.char.level - actor.char.level) * 3;
        expGained.set(actor.char.id, (expGained.get(actor.char.id) ?? 0) + exp);
        if (t.char.hp === 0) {
          kos.push(t.char.id);
          actor.char.kills++;
          shiftAlignment(actor.char, t.char.level);
          expGained.set(actor.char.id, (expGained.get(actor.char.id) ?? 0) + 20 + t.char.level * 2);
        }
      }
      // re-acquire if single-target victim fell mid-flurry
      if (attack.target === 'one' && targets[0].char.hp <= 0) {
        const next = targetPool(enemies);
        if (next.length === 0) break;
        targets = [next[0]];
      }
    }
    events.push({ kind: 'act', actorId: actor.char.id, attack, targetIds: ids, amounts, kos });
  }

  const attackerWiped = atk.every((c) => c.char.hp <= 0);
  const defenderWiped = def.every((c) => c.char.hp <= 0);
  let winner: 'attacker' | 'defender' | 'draw';
  if (defenderWiped && !attackerWiped) winner = 'attacker';
  else if (attackerWiped && !defenderWiped) winner = 'defender';
  else if (damageBy.attacker > damageBy.defender * 1.1) winner = 'attacker';
  else if (damageBy.defender > damageBy.attacker * 1.1) winner = 'defender';
  else winner = 'draw';

  for (const [id, exp] of expGained) {
    const char = attacker.chars.get(id) ?? defender.chars.get(id);
    if (char && char.hp > 0) {
      const ups = grantExp(char, exp);
      if (ups > 0) levelUps.set(id, ups);
    }
  }

  events.push({ kind: 'end', winner, attackerDamage: damageBy.attacker, defenderDamage: damageBy.defender });
  return { events, winner, attackerWiped, defenderWiped, expGained, levelUps };
}
