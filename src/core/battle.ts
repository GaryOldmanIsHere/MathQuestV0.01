import type { Character, ResistKey, Row, RowAttack, Squad } from './types';
import { classOf, resolveSpell } from '../data/registry';
import { grantExp, shiftAlignment } from './character';
import { memberRow, squadMemberIds } from './squad';
import { rng } from '../data/names';
import { effectiveLuck, effectiveResist, effectiveStats, familyOf, weaponOf } from './items';

// One Ogre Battle engagement, fought in rounds: in each, everyone with a
// strike left makes one, the quick before the slow; their row on the 3x3
// grid sets the attack and how many strikes it gives. Blows can miss and can
// tell. The side that lost the smaller share of its strength wins the clash;
// the loser is pushed back on the map.

export interface Combatant {
  char: Character;
  squad: Squad;
  row: Row;
  cell: number; // 0..8 in own grid
}

export type BattleEvent =
  /** One strike (or one casting), at one target or several: for each, what it took and whether the strike missed or told. */
  | { kind: 'act'; actorId: number; attack: RowAttack; targetIds: number[]; amounts: number[]; kos: number[]; results: StrikeResult[] }
  | { kind: 'skip'; actorId: number } // dead or no valid target
  | { kind: 'round'; round: number }
  | { kind: 'end'; winner: 'attacker' | 'defender' | 'draw'; attackerDamage: number; defenderDamage: number };

export type StrikeResult = 'hit' | 'miss' | 'crit';

export interface BattleResult {
  events: BattleEvent[];
  winner: 'attacker' | 'defender' | 'draw';
  attackerWiped: boolean;
  defenderWiped: boolean;
  expGained: Map<number, number>;
  levelUps: Map<number, number>;
}

/** 50 resistance is neutral; each point below makes a hit 2% stronger, each point above 2% weaker. */
function resistMultiplier(resist: number): number {
  return Math.max(0.25, Math.min(2, 1 + (50 - resist) / 50));
}

/**
 * How hard an attack lands given the target's resistance to its element
 * (physical for unelemented blows), the target's class resistances with its
 * gear's added. So the undead's low Virtue resistance turns holy magic into a
 * scourge, and a Flame Shield blunts a Fireball. The resistances are the
 * game's; this scaling is provisional until the battle formula is decoded.
 *
 * A blow struck with an elemental weapon is half steel, half element: it
 * lands by the average of the two resistances. A weapon made to slay what
 * the target is (dragons, the undead) strikes half again as hard.
 */
export function elementBonus(att: RowAttack, target: Character, actor?: Character): number {
  const resist = effectiveResist(target);
  // Drakonite (the dragons' own element) has no resistance column; it lands as physical.
  const key: ResistKey = att.element && att.element !== 'drakonite' ? att.element : 'physical';
  let mult = resistMultiplier(resist[key]);
  const blow = att.type === 'melee' || att.type === 'ranged';
  // A blow that carries an element (a dark blade, a flaming fang) is still a
  // blow: armour blunts its half, the element's resistance the other.
  if (blow && key !== 'physical') mult = (mult + resistMultiplier(resist.physical)) / 2;
  const weapon = actor && blow ? weaponOf(actor) : null;
  if (weapon?.element && weapon.element !== 'drakonite' && !att.element) {
    mult = (mult + resistMultiplier(resist[weapon.element])) / 2;
  }
  const family = familyOf(classOf(target.classId));
  if (weapon?.slays && family && weapon.slays.includes(family)) mult *= 1.5;
  return mult;
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
  const a = effectiveStats(actor);
  const t = effectiveStats(target);
  const offense = att.type === 'magic' || att.type === 'heal' ? a.int : a.str;
  const defense = att.type === 'magic' ? t.men : t.vit;
  const raw = offense * att.power - defense * 0.55;
  const spread = 0.85 + rng() * 0.3;
  return Math.max(1, Math.floor(raw * spread * elementBonus(att, target, actor)));
}

function healOf(att: RowAttack, actor: Character): number {
  return Math.max(2, Math.floor(effectiveStats(actor).int * att.power * (0.9 + rng() * 0.2)));
}

/**
 * The chance, 0 to 1, that a blow or a shot lands: sure-handed against
 * slow-footed is near certain, clumsy against quick may miss one in three.
 * Spells always find their mark.
 */
export function hitChance(att: RowAttack, actor: Character, target: Character): number {
  if (att.type !== 'melee' && att.type !== 'ranged') return 1;
  const edge = effectiveStats(actor).dex - effectiveStats(target).agi;
  return Math.max(0.65, Math.min(1, 0.9 + edge * 0.015));
}

/** The chance, 0 to 1, of a telling blow (half again as hard): one in twenty between equals in luck, more for the luckier. */
export function critChance(actor: Character, target: Character): number {
  return Math.max(0.01, Math.min(0.25, 0.05 + (effectiveLuck(actor) - effectiveLuck(target)) / 500));
}

/** How much harder a telling blow lands. */
export const CRIT_BONUS = 1.5;

const rank = (r: Row) => (r === 'front' ? 0 : r === 'mid' ? 1 : 2);
/** The lane a combatant stands in: its line of the grid, top to bottom. */
const lane = (c: Combatant) => Math.floor(c.cell / 3);

/**
 * Whom a combatant strikes at. Blades reach only the enemy's foremost rank
 * still standing; arrows and spells reach anyone. Of those in reach it goes
 * by its squad's orders: the nearest (the foremost rank, and in it whoever
 * stands across from it), the weakest, the strongest, or the leader.
 */
export function chooseTarget(actor: Combatant, attack: RowAttack, enemies: Combatant[]): Combatant | null {
  const alive = enemies.filter((c) => c.char.hp > 0);
  if (!alive.length) return null;
  const foremost = Math.min(...alive.map((c) => rank(c.row)));
  const reach = attack.type === 'melee' ? alive.filter((c) => rank(c.row) === foremost) : alive;
  const nearest = () => [...reach].sort((a, b) =>
    rank(a.row) - rank(b.row) || Math.abs(lane(a) - lane(actor)) - Math.abs(lane(b) - lane(actor)) || a.cell - b.cell)[0];
  switch (actor.squad.tactic ?? 'nearest') {
    case 'weakest': return [...reach].sort((a, b) => a.char.hp - b.char.hp || a.cell - b.cell)[0];
    case 'strongest': return [...reach].sort((a, b) => b.char.hp - a.char.hp || a.cell - b.cell)[0];
    case 'leader': return reach.find((c) => c.char.id === c.squad.leaderId) ?? nearest();
    default: return nearest();
  }
}

/**
 * Who wins a clash neither side was wiped out in, from the share of its
 * strength each side lost: the one that lost clearly less (by a tenth) wins,
 * else both withdraw. Shares, not raw damage: a lone champion who fells two
 * of five foes but is himself cut nearly to the ground has lost the clash,
 * however hard his blows landed.
 */
export function judgeClash(attackerLost: number, defenderLost: number): 'attacker' | 'defender' | 'draw' {
  if (defenderLost > attackerLost * 1.1) return 'attacker';
  if (attackerLost > defenderLost * 1.1) return 'defender';
  return 'draw';
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
          cell: side.squad.grid.indexOf(id), // a large unit's rear cell
        };
      })
      .filter((c) => c.char.hp > 0);

  const atk = make(attacker);
  const def = make(defender);
  // Each side's strength going in, to judge its losses against.
  const strength = (side: Combatant[]) => side.reduce((sum, c) => sum + c.char.stats.hp, 0);
  const atkStrength = Math.max(1, strength(atk));
  const defStrength = Math.max(1, strength(def));
  // And the health each went in with: what it has lost by the end is the
  // difference, so a blow past a unit's last breath counts for no more than
  // that breath, and what a healer mends is not counted as lost.
  const health = (side: Combatant[]) => side.reduce((sum, c) => sum + Math.max(0, c.char.hp), 0);
  const atkHealth = health(atk);
  const defHealth = health(def);
  const events: BattleEvent[] = [];
  const damageBy = { attacker: 0, defender: 0 };
  const expGained = new Map<number, number>();
  const levelUps = new Map<number, number>();

  // The battle goes by rounds. In each, everyone still standing who has a
  // strike left makes one, the quick before the slow (give or take: no two
  // rounds fall out quite alike). A fighter whose row gives two strikes
  // makes them in the first two rounds, so who falls early matters.
  const all = [...atk, ...def];
  const attackOf = (c: Combatant) => {
    const slot = classOf(c.char.classId).attacks[c.row];
    return slot ? resolveAttack(slot, c.char) : null;
  };
  const rounds = Math.max(0, ...all.map((c) => attackOf(c)?.count ?? 0));
  const earn = (c: Combatant, exp: number) => expGained.set(c.char.id, (expGained.get(c.char.id) ?? 0) + exp);

  for (let round = 1; round <= rounds; round++) {
    if (atk.every((c) => c.char.hp <= 0) || def.every((c) => c.char.hp <= 0)) break;
    if (round > 1) events.push({ kind: 'round', round });
    const speed = new Map(all.map((c) => [c, effectiveStats(c.char).agi * (0.9 + rng() * 0.2)]));
    const order = [...all].sort((a, b) => speed.get(b)! - speed.get(a)!);

    for (const actor of order) {
      if (actor.char.hp <= 0) {
        if (round === 1) events.push({ kind: 'skip', actorId: actor.char.id });
        continue;
      }
      const isAttacker = actor.squad.id === attacker.squad.id;
      const allies = isAttacker ? atk : def;
      const enemies = isAttacker ? def : atk;
      const attack = attackOf(actor);
      if (!attack || attack.count < round) {
        if (round === 1) events.push({ kind: 'skip', actorId: actor.char.id });
        continue;
      }

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
          // Mending teaches as striking does.
          earn(actor, 8);
        }
        events.push({ kind: 'act', actorId: actor.char.id, attack, targetIds: ids, amounts, kos: [], results: ids.map(() => 'hit') });
        continue;
      }

      const first = chooseTarget(actor, attack, enemies);
      if (!first) {
        events.push({ kind: 'skip', actorId: actor.char.id });
        continue;
      }
      const alive = enemies.filter((c) => c.char.hp > 0);
      const targets = attack.target === 'all' ? alive : attack.target === 'row' ? alive.filter((c) => c.row === first.row) : [first];

      const ids: number[] = [];
      const amounts: number[] = [];
      const kos: number[] = [];
      const results: StrikeResult[] = [];
      for (const t of targets) {
        ids.push(t.char.id);
        if (rng() >= hitChance(attack, actor.char, t.char)) {
          amounts.push(0);
          results.push('miss');
          continue;
        }
        const crit = rng() < critChance(actor.char, t.char);
        const dmg = Math.floor(damageOf(attack, actor.char, t.char) * (crit ? CRIT_BONUS : 1));
        t.char.hp = Math.max(0, t.char.hp - dmg);
        damageBy[isAttacker ? 'attacker' : 'defender'] += dmg;
        amounts.push(dmg);
        results.push(crit ? 'crit' : 'hit');
        earn(actor, 8 + Math.max(0, t.char.level - actor.char.level) * 3);
        if (t.char.hp === 0) {
          kos.push(t.char.id);
          actor.char.kills++;
          shiftAlignment(actor.char, t.char.level);
          earn(actor, 20 + t.char.level * 2);
        }
      }
      events.push({ kind: 'act', actorId: actor.char.id, attack, targetIds: ids, amounts, kos, results });
    }
  }

  const attackerWiped = atk.every((c) => c.char.hp <= 0);
  const defenderWiped = def.every((c) => c.char.hp <= 0);
  let winner: 'attacker' | 'defender' | 'draw';
  if (defenderWiped && !attackerWiped) winner = 'attacker';
  else if (attackerWiped && !defenderWiped) winner = 'defender';
  else winner = judgeClash((atkHealth - health(atk)) / atkStrength, (defHealth - health(def)) / defStrength);

  // Only the player's army learns from battle. The enemy's squads keep the
  // levels the campaign gives them, as Ogre Battle's do: a garrison that
  // grew with every attack it beat off would soon be out of reach.
  // What one learns, the squad learns: each of the player's soldiers still
  // standing keeps half of what they earned and takes an even share of the
  // other half of the whole squad's, so healers and those who never got
  // their blow in grow alongside the rest.
  for (const side of [atk, def]) {
    if (side[0]?.squad.side !== 'player') continue;
    const standing = side.filter((c) => c.char.hp > 0);
    if (!standing.length) continue;
    const pool = side.reduce((sum, c) => sum + (expGained.get(c.char.id) ?? 0), 0);
    for (const c of standing) {
      const exp = Math.round((expGained.get(c.char.id) ?? 0) / 2 + pool / 2 / standing.length);
      const ups = exp > 0 ? grantExp(c.char, exp) : 0;
      if (ups > 0) levelUps.set(c.char.id, ups);
    }
  }

  events.push({ kind: 'end', winner, attackerDamage: damageBy.attacker, defenderDamage: damageBy.defender });
  return { events, winner, attackerWiped, defenderWiped, expGained, levelUps };
}
