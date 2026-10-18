import type {
  ClassDef, Element, Gender, GateStat, March, PromotionReq, Resistances, Row, RowAttack, Stats,
} from '../core/types';
import { genderCompatible } from '../core/types';
import type { Dataset } from '../data/registry';
import type { ItemDef } from '../core/items';
import type { SnesClass, SowClass } from './sources';
import { LOOKS } from './looks';

// Translates the classes of two other games into Ogre Battle 64's model and
// grafts them onto whichever dataset is active, as extra classes and extra
// routes between classes.
//
//   * Ogre Battle: March of the Black Queen (SNES) gives numbers: HP, STR,
//     AGI and INT as a base and a growth, six elemental affinities, starting
//     alignment and luck, two row attacks with hit counts, and each class's
//     route: from which class, at what level, in what alignment window, or by
//     which item.
//   * Symphony of War gives ratings (Low / Med / High) for each stat's base
//     and growth, a unit type (heavy or light infantry, cavalry, flier,
//     caster, healer), the stat a promotion demands, and which classes each
//     class upgrades into.
//
// Neither game uses Ogre Battle 64's seven stats or its scale, so stats are
// translated relatively: a class's standing against the other classes of its
// own tier in its own game is carried over to the same standing against the
// active dataset's classes of that tier. A SNES Knight with 20% more STR than
// the average SNES tier-2 class gets 20% more STR than the average tier-2
// class here, whichever dataset that is. VIT, MEN and DEX, which neither game
// has, are read from the nearest things each does have (HP and physical
// affinity, INT and elemental affinity, AGI and STR; armour, magic and skill).
//
// When a class already exists here (an OB64 Knight, a builtin Wizard), the
// existing class wins and the other game only adds its routes into it, so a
// SNES Beast Man can still become Ogre Battle 64's own Beast Master.

const STATS: (keyof Stats)[] = ['hp', 'str', 'vit', 'int', 'men', 'agi', 'dex'];
type Tier = 1 | 2 | 3 | 4;

export function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Spellings and names that differ between the games for the same class. */
const ALIASES: Record<string, string[]> = {
  gryphon: ['griffin'],
  cockatris: ['cockatrice'],
  pumpkin: ['pumpkinhead'],
  vampyre: ['vampire'],
  beastman: ['beasttamer'],
  dragoner: ['dragontamer'],
  dragon: ['youngdragon'],
  rockgolem: ['stonegolem'],
  bluedragon: ['thunderdragon'],
};

/** Symphony of War's one generic recruit is both of Ogre Battle 64's: Fighter and Amazon. */
const SOW_ROOT_TWINS: Record<string, string[]> = { fighter: ['amazon'] };

const SOW_FEMALE = new Set(['priestess', 'siren', 'sorceress', 'valkyrie']);
const SOW_MONSTER = /drake|dragon|war cat|behemoth|^risen/i;
const SOW_SKIP_TYPES = /firearm/i; // no gunpowder in this phase

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// ------------------------------------------------------------ calibration --

interface Profile { base: Stats; growth: Stats }

function averageOf(defs: ClassDef[]): Profile {
  const base = {} as Stats;
  const growth = {} as Stats;
  for (const k of STATS) {
    base[k] = mean(defs.map((d) => d.base[k]));
    growth[k] = mean(defs.map((d) => d.growth[k]));
  }
  return { base, growth };
}

function scaled(p: Profile, base: number, growth: number): Profile {
  const b = {} as Stats;
  const g = {} as Stats;
  for (const k of STATS) {
    b[k] = p.base[k] * base;
    g[k] = p.growth[k] * growth;
  }
  return { base: b, growth: g };
}

/**
 * The average class of each tier in the active dataset, for humans and for
 * monsters, which is what translated classes are measured against. Thin
 * groups borrow from the humans of the same tier, then the tier below; tier
 * 4, which Ogre Battle 64 lacks, sits a step above tier 3.
 */
export function referenceProfiles(classes: ClassDef[]): (tier: Tier, monster: boolean) => Profile {
  const cache = new Map<string, Profile>();
  const group = (tier: number, monster: boolean) =>
    classes.filter((c) => c.tier === tier && (c.gender === 'X') === monster);
  const get = (tier: Tier, monster: boolean): Profile => {
    const key = `${tier}${monster}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let p: Profile;
    if (tier === 4) p = scaled(get(3, monster), 1.12, 1.08);
    else if (group(tier, monster).length >= 2) p = averageOf(group(tier, monster));
    else if (monster) p = get(tier, false);
    else if (tier > 1) p = scaled(get((tier - 1) as Tier, false), 1.15, 1.1);
    else p = averageOf(classes.length ? classes : []);
    cache.set(key, p);
    return p;
  };
  return get;
}

/** Round as the dataset stores numbers: Ogre Battle 64 keeps whole growths. */
function rounder(source: Dataset['source']): (p: Profile) => Profile {
  return (p) => {
    const base = {} as Stats;
    const growth = {} as Stats;
    for (const k of STATS) {
      base[k] = Math.max(1, Math.round(p.base[k]));
      growth[k] = source === 'ob64' ? Math.max(0, Math.round(p.growth[k])) : Math.round(p.growth[k] * 10) / 10;
    }
    return { base, growth };
  };
}

const ratio = (v: number, avg: number) => clamp(avg > 0 ? v / avg : 1, 0.4, 2.2);

// ------------------------------------------------------------------- SNES --

const SNES_STATS = ['hp', 'str', 'agi', 'int'] as const;
const AFF_TO_RESIST: Record<'p' | 'f' | 'i' | 'e' | 'b' | 'w', Exclude<keyof Resistances, 'earth'>> = {
  p: 'physical', f: 'flame', i: 'water', e: 'wind', b: 'bane', w: 'virtue',
};

const isSnesMonster = (s: SnesClass) => s.family !== 'fighter' && s.family !== 'amazon';

/** How deep a SNES class sits in its tree: roots are 1, capped at 4. */
function snesTiers(list: SnesClass[]): Map<string, Tier> {
  const byName = new Map(list.map((s) => [s.name, s]));
  const out = new Map<string, Tier>();
  const depth = (s: SnesClass, seen: Set<string>): number => {
    const parent = s.from ?? s.formOf;
    if (!parent || seen.has(s.name) || !byName.has(parent)) return 1;
    seen.add(s.name);
    const d = depth(byName.get(parent)!, seen);
    return s.formOf ? d : d + 1;
  };
  for (const s of list) out.set(s.name, clamp(depth(s, new Set()), 1, 4) as Tier);
  return out;
}

interface SnesNorms {
  stat: (tier: Tier, monster: boolean, k: (typeof SNES_STATS)[number], i: 0 | 1) => number;
  aff: Record<keyof SnesClass['aff'], number>;
}

function snesNorms(list: SnesClass[], tiers: Map<string, Tier>): SnesNorms {
  const pool = (tier: Tier, monster: boolean) => {
    const exact = list.filter((s) => tiers.get(s.name) === tier && isSnesMonster(s) === monster);
    if (exact.length >= 3) return exact;
    const near = list.filter((s) => Math.abs(tiers.get(s.name)! - tier) <= 1 && isSnesMonster(s) === monster);
    return near.length ? near : list;
  };
  const aff = {} as SnesNorms['aff'];
  for (const k of Object.keys(AFF_TO_RESIST) as (keyof SnesClass['aff'])[]) {
    aff[k] = mean(list.map((s) => s.aff[k]).filter((v): v is number => v !== null));
  }
  return { stat: (tier, monster, k, i) => mean(pool(tier, monster).map((s) => s[k][i])), aff };
}

function snesStats(s: SnesClass, tier: Tier, norms: SnesNorms, ref: Profile): Profile {
  const monster = isSnesMonster(s);
  // Undead take no physical harm worth the name in the SNES game ("-").
  const phys = s.aff.p === null ? 1.4 : ratio(s.aff.p, norms.aff.p);
  const elems = (['f', 'i', 'e', 'b'] as const).map((k) => (s.aff[k] === null ? 1.3 : ratio(s.aff[k]!, norms.aff[k])));
  const res = mean(elems);
  const part = (i: 0 | 1, out: Stats, from: Stats) => {
    const r = (k: (typeof SNES_STATS)[number]) => ratio(s[k][i], norms.stat(tier, monster, k, i));
    out.hp = from.hp * r('hp');
    out.str = from.str * r('str');
    out.vit = from.vit * mean([r('str'), r('hp'), phys]);
    out.int = from.int * r('int');
    out.men = from.men * mean([r('int'), res]);
    out.agi = from.agi * r('agi');
    out.dex = from.dex * mean([r('agi'), r('agi'), r('str')]);
  };
  const base = {} as Stats;
  const growth = {} as Stats;
  part(0, base, ref.base);
  part(1, growth, ref.growth);
  return { base, growth };
}

function snesResist(s: SnesClass, norms: SnesNorms): Resistances {
  const out = { earth: 50 } as Resistances;
  const deltas: number[] = [];
  for (const [k, key] of Object.entries(AFF_TO_RESIST) as [keyof SnesClass['aff'], Exclude<keyof Resistances, 'earth'>][]) {
    const v = s.aff[k];
    // "-" is immunity in the SNES game, short of holy power.
    out[key] = v === null ? 90 : Math.round(clamp(50 + (v - norms.aff[k]) * 0.6, 10, 95));
    if (key !== 'physical') deltas.push(out[key] - 50);
  }
  out.earth = Math.round(clamp(50 + mean(deltas) * 0.5, 10, 95));
  return out;
}

/** What each SNES attack is, by name: its kind, element, reach and weight. */
const SNES_ATTACKS: Record<string, Partial<RowAttack> & { type: RowAttack['type'] }> = {
  Slash: { type: 'melee' }, Slice: { type: 'melee', power: 1.1 }, Smash: { type: 'melee', power: 1.1 },
  Chop: { type: 'melee' }, Whip: { type: 'melee', power: 0.9 }, Club: { type: 'melee', power: 1.15 },
  Punch: { type: 'melee', power: 0.8 }, Bite: { type: 'melee', power: 1.1 }, Tail: { type: 'melee', power: 1.1 },
  Tentacle: { type: 'melee', power: 0.8 }, Charge: { type: 'melee', power: 1.15 }, Stab: { type: 'melee' },
  Trident: { type: 'melee', power: 1.1 }, Ankh: { type: 'melee', power: 0.8 }, Slap: { type: 'melee', power: 0.6 },
  Iainuki: { type: 'melee', power: 1.3, target: 'row' }, Halo: { type: 'magic', element: 'virtue' },
  Lifesuck: { type: 'melee', element: 'bane' },
  Arrow: { type: 'ranged' }, Shuriken: { type: 'ranged', power: 0.9 }, Doll: { type: 'ranged', power: 0.9 },
  Puppet: { type: 'ranged' }, Pumpkin: { type: 'ranged', power: 1.2 },
  Fireball: { type: 'magic', element: 'flame' }, Fire: { type: 'magic', element: 'flame' },
  'Fire Bolt': { type: 'magic', element: 'flame', power: 1.1 }, Inferno: { type: 'magic', element: 'flame', power: 1.2 },
  Nova: { type: 'magic', element: 'flame', target: 'all', power: 0.9 },
  Cold: { type: 'magic', element: 'water' }, 'Ice Bolt': { type: 'magic', element: 'water', power: 1.1 },
  'Cold Eye': { type: 'magic', element: 'water', power: 1.1 }, Blizzard: { type: 'magic', element: 'water', target: 'row', power: 0.85 },
  Icefield: { type: 'magic', element: 'water', target: 'row', power: 0.9 },
  'Ice Cloud': { type: 'magic', element: 'water', target: 'all', power: 0.9 },
  Maelstrom: { type: 'magic', element: 'water', target: 'row', power: 0.95 },
  Bolt: { type: 'magic', element: 'wind' }, Thunder: { type: 'magic', element: 'wind', power: 1.1 },
  Gale: { type: 'magic', element: 'wind', target: 'row', power: 0.85 }, Missile: { type: 'magic', element: 'wind', power: 1.1 },
  Acid: { type: 'magic', element: 'earth' }, Meteor: { type: 'magic', element: 'earth', target: 'all', power: 0.9 },
  Petrify: { type: 'magic', element: 'earth', power: 0.5 }, Stun: { type: 'magic', element: 'wind', power: 0.5 },
  Rot: { type: 'magic', element: 'bane', power: 1.1 }, EvilDead: { type: 'magic', element: 'bane', target: 'all', power: 0.9 },
  Nightmare: { type: 'magic', element: 'bane' }, Curse: { type: 'magic', element: 'bane', power: 0.9 },
  Charm: { type: 'magic', element: 'bane', power: 0.5 }, Sleeping: { type: 'magic', element: 'bane', power: 0.4 },
  Banish: { type: 'magic', element: 'virtue', power: 1.1 }, Jihad: { type: 'magic', element: 'virtue', target: 'all', power: 0.9 },
  StarDust: { type: 'magic', element: 'virtue', target: 'row', power: 0.85 },
  StarLite: { type: 'heal', element: 'virtue', target: 'allies', power: 1.1 },
  Healing: { type: 'heal', element: 'virtue', target: 'allies' },
  'Healing+': { type: 'heal', element: 'virtue', target: 'allies', power: 1.3 },
  Kiss: { type: 'heal', element: 'virtue', target: 'allies', power: 0.8 },
  // The caster's own element decides these, as Ogre Battle 64's spell slots do.
  Magic: { type: 'magic', spell: 'basic' }, Ninjitsu: { type: 'magic', spell: 'basic', power: 0.9 },
};

function snesAttack(name: string, hits: number): RowAttack {
  const known = SNES_ATTACKS[name] ?? { type: 'melee' as const };
  return {
    name: known.spell ? 'Elemental Magic' : name,
    type: known.type,
    count: Math.max(1, hits),
    power: known.power ?? 1,
    target: known.target ?? (known.type === 'heal' ? 'allies' : 'one'),
    ...(known.element ? { element: known.element } : {}),
    ...(known.spell ? { spell: known.spell } : {}),
  };
}

function snesMarch(s: SnesClass, caster: boolean): March {
  if (/sky/i.test(s.terrain)) return 'fly';
  if (caster) return 'slow';
  if (/forest|mountain/i.test(s.terrain)) return 'light';
  return 'heavy';
}

// ---------------------------------------------------------------- SoW ------

const RATING: Record<string, number> = {
  none: 0.5, 'very low': 0.62, low: 0.8, med: 1, medium: 1, high: 1.2, 'very high': 1.4,
};

type SowKind = 'heavy' | 'light' | 'archer' | 'caster' | 'healer' | 'heavyCav' | 'lightCav' | 'archerCav' | 'dragon';

function sowKind(c: SowClass): SowKind {
  const t = c.type.toLowerCase();
  if (/dragon/.test(t)) return 'dragon';
  if (/archery/.test(t) && /cavalry/.test(t)) return 'archerCav';
  if (/archery/.test(t)) return 'archer';
  if (/magician/.test(t)) return 'caster';
  if (/support/.test(t)) return 'healer';
  if (/light cavalry/.test(t)) return 'lightCav';
  if (/heavy cavalry/.test(t)) return 'heavyCav';
  if (/light/.test(t)) return 'light';
  return 'heavy';
}

function sowMarch(c: SowClass, kind: SowKind): March {
  const m = c.movement.toLowerCase();
  if (/flying/.test(m)) return 'fly';
  switch (kind) {
    case 'caster': return 'slow';
    case 'healer': return /cavalry/.test(m) ? 'heavyCav' : 'slow';
    case 'heavyCav': return 'heavyCav';
    case 'lightCav': case 'archerCav': return 'lightCav';
    case 'light': return 'light';
    case 'archer': return /light/.test(m) ? 'light' : 'heavy';
    default: return 'heavy';
  }
}

/** A missing rating takes the most common one among classes of the same kind. */
function sowRatingFill(list: SowClass[]): (c: SowClass, stat: string, part: 'base' | 'growth') => number {
  return (c, stat, part) => {
    const own = c.ratings[stat]?.[part];
    if (own && own.toLowerCase() in RATING) return RATING[own.toLowerCase()];
    const kind = sowKind(c);
    const votes = new Map<string, number>();
    for (const o of list) {
      const r = o.ratings[stat]?.[part]?.toLowerCase();
      if (o !== c && sowKind(o) === kind && r && r in RATING) votes.set(r, (votes.get(r) ?? 0) + 1);
    }
    const top = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? RATING[top[0]] : 1;
  };
}

const SOW_AGILITY: Record<SowKind, number> = {
  heavy: 0.92, light: 1.18, archer: 1.05, caster: 0.95, healer: 0.95,
  heavyCav: 1.02, lightCav: 1.18, archerCav: 1.12, dragon: 0.9,
};

function sowStats(c: SowClass, rate: ReturnType<typeof sowRatingFill>, ref: Profile): Profile {
  const kind = sowKind(c);
  const part = (p: 'base' | 'growth', from: Stats): Stats => {
    const r = (k: string) => rate(c, k, p);
    return {
      hp: from.hp * r('hp'),
      str: from.str * r('str') * (0.9 + 0.1 * r('weapon')),
      vit: from.vit * r('armor'),
      // A class with no magic at all has next to none, not merely little.
      int: from.int * (c.ratings.mag?.[p]?.toLowerCase() === 'none' ? 0.3 : r('mag')),
      men: from.men * (0.7 * r('mag') + 0.3 * r('armor')),
      agi: from.agi * SOW_AGILITY[kind] * (0.6 + 0.4 * r('skl')),
      dex: from.dex * r('skl'),
    };
  };
  return { base: part('base', ref.base), growth: part('growth', ref.growth) };
}

const SOW_ELEMENT: Record<string, Element> = {
  fire: 'flame', ice: 'water', lightning: 'wind', dark: 'bane', light: 'virtue', holy: 'virtue',
};
const OPPOSITE: Partial<Record<Element, Element>> = { flame: 'water', water: 'flame', wind: 'earth', earth: 'wind' };

function sowElement(c: SowClass): Element | undefined {
  for (const a of c.attacks) if (a.element && SOW_ELEMENT[a.element]) return SOW_ELEMENT[a.element];
  const n = c.name.toLowerCase();
  if (/fire/.test(n)) return 'flame';
  if (/ice/.test(n)) return 'water';
  if (/lightning|blue/.test(n)) return 'wind';
  if (/dark|necro|risen/.test(n)) return 'bane';
  return undefined;
}

function sowResist(c: SowClass, kind: SowKind, element: Element | undefined, men: number): Resistances {
  const physical = { heavy: 60, heavyCav: 58, dragon: 66, archer: 47, archerCav: 47, light: 45, lightCav: 47, caster: 40, healer: 42 }[kind];
  const elemental = Math.round(clamp(50 + (men - 1) * 30 + (c.traits.includes('Magic Armor') ? 12 : 0), 20, 85));
  const out: Resistances = { physical, wind: elemental, flame: elemental, earth: elemental, water: elemental, virtue: elemental, bane: elemental };
  if (element && element !== 'drakonite' && kind === 'dragon') {
    out[element] = 80;
    const opp = OPPOSITE[element];
    if (opp && opp !== 'drakonite') out[opp] = 30;
  }
  if (/^risen/i.test(c.name)) Object.assign(out, { virtue: 25, bane: 80 });
  return out;
}

function weaponName(c: SowClass): string {
  const n = c.name.toLowerCase();
  if (/spear|sentinel|centurion|hussar|scout/.test(n)) return 'Spear Thrust';
  if (/cavalier|knight|valkyrie/.test(n)) return 'Lance Charge';
  if (/rogue|assassin|ranger/.test(n)) return 'Dagger';
  if (/zweihander|champion/.test(n)) return 'Greatsword';
  if (/sword|samurai/.test(n)) return 'Blade';
  if (/cat|behemoth/.test(n)) return 'Claw';
  if (/militia/.test(n)) return 'Pike';
  return 'Sword';
}

function sowAttacks(c: SowClass, kind: SowKind, element: Element | undefined): Partial<Record<Row, RowAttack>> {
  const area = c.area ? (c.area === 'area' ? 'all' : 'row') : 'one';
  const melee = (count: number, power = 1): RowAttack => ({ name: weaponName(c), type: 'melee', count, power, target: 'one' });
  const shot = (count: number, power = 1): RowAttack => ({
    name: /crossbow|arbalest/i.test(c.name) ? 'Bolt' : /warbow/i.test(c.name) ? 'Longbow' : 'Arrow',
    type: 'ranged', count, power, target: 'one',
  });
  const spell = (count: number, power = 1): RowAttack => element
    ? { name: SPELL_NAME[element], type: 'magic', count, power: area === 'one' ? power : power * 0.85, target: area, element }
    : { name: 'Elemental Magic', type: 'magic', count, power, target: 'one', spell: 'basic' };
  const heal = (count: number, power = 1): RowAttack => ({ name: 'Mend', type: 'heal', count, power, target: 'allies', element: 'virtue' });
  const polearm = c.traits.includes('Polearm Warrior');
  switch (kind) {
    case 'archer': return { front: shot(1, 0.9), mid: shot(2), back: shot(/warbow|arbalest/i.test(c.name) ? 3 : 2) };
    case 'archerCav': return { front: melee(1, 0.9), mid: shot(2), back: shot(2) };
    case 'caster': return { front: { name: 'Staff', type: 'melee', count: 1, power: 0.6, target: 'one' }, mid: spell(1), back: spell(2) };
    case 'healer': return /templar|oracle/i.test(c.name)
      ? { front: melee(1, 0.8), mid: spell(1), back: heal(2, 1.1) }
      : { front: { name: 'Mace', type: 'melee', count: 1, power: 0.7, target: 'one' }, mid: heal(1), back: heal(2) };
    case 'dragon': {
      const breath: RowAttack = { name: element ? BREATH[element] : 'Breath', type: 'magic', count: 2, power: 1, target: 'row', element: element ?? 'flame' };
      return { front: { name: 'Claw', type: 'melee', count: 2, power: 1.15, target: 'one' }, mid: { ...breath, count: 1 }, back: breath };
    }
    case 'light': case 'lightCav':
      return { front: melee(2), mid: melee(polearm ? 2 : 1, 0.95), back: melee(1, 0.8) };
    default:
      return { front: melee(2, 1.05), mid: melee(polearm ? 2 : 1), back: melee(1, 0.85) };
  }
}

const SPELL_NAME: Record<Element, string> = {
  flame: 'Fire', water: 'Frost', wind: 'Lightning', earth: 'Stone', virtue: 'Holy Light', bane: 'Dark Bolt', drakonite: 'Dragon Fire',
};
const BREATH: Record<Element, string> = {
  flame: 'Fire Breath', water: 'Frost Breath', wind: 'Thunder Breath', earth: 'Sand Breath', virtue: 'Holy Breath', bane: 'Bane Breath', drakonite: 'Dragon Breath',
};

// --------------------------------------------------------------- shared ----

function spriteFor(name: string, rider: boolean): string {
  const n = name.toLowerCase();
  if (/rider/.test(n)) return 'dragon';
  if (/dragon|drake|wyrm|wyvern|tiamat|salamand/.test(n)) return 'dragon';
  if (/golem|giant|titan|behemoth/.test(n)) return 'golem';
  if (/hound|cerberus|gryphon|cockatris|wolf|tiger|cat/.test(n)) return 'beast';
  if (/ghost|wraith|phantom/.test(n)) return 'ghost';
  if (/octopus|kraken|mermaid|nixie/.test(n)) return 'sea';
  if (rider) return 'rider';
  return 'humanoid';
}

/** The fixed element of a monster: what it breathes or casts, else what it is. */
function monsterElement(attacks: Partial<Record<Row, RowAttack>>, march: March): Element {
  for (const row of ['back', 'mid', 'front'] as Row[]) {
    const e = attacks[row]?.element;
    if (e) return e;
  }
  return march === 'fly' ? 'wind' : 'earth';
}

/**
 * Which stats a class change demands, by Ogre Battle 64's rule as Palatinus
 * reads it (see inferStatGates in src/ob64/convert.ts): the two stats the
 * target grows fastest in, each at its base plus two. A stat the source game
 * names for the promotion takes the first place.
 */
export function gatesFor(target: ClassDef, named?: GateStat): Partial<Record<GateStat, number>> {
  const order: GateStat[] = ['str', 'vit', 'int', 'men', 'agi', 'dex'];
  const ranked = [...order].sort((a, b) => target.growth[b] - target.growth[a]);
  const pick = named ? [named, ...ranked.filter((k) => k !== named)] : ranked;
  const gates: Partial<Record<GateStat, number>> = {};
  for (const k of pick.slice(0, 2)) gates[k] = Math.round(target.base[k]) + 2;
  return gates;
}

const SOW_GATE: Record<string, GateStat> = { str: 'str', mag: 'int', skl: 'dex' };

/** The level a class change into each tier usually takes in the dataset. */
function tierLevels(classes: ClassDef[]): Record<Tier, number> {
  const byTier: Record<number, number[]> = { 2: [], 3: [] };
  const tierOf = new Map(classes.map((c) => [c.id, c.tier]));
  for (const c of classes) {
    for (const p of c.promotesTo) {
      const t = tierOf.get(p.classId);
      if (t === 2 || t === 3) byTier[t].push(p.level);
    }
  }
  const median = (xs: number[], fallback: number) => {
    if (!xs.length) return fallback;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  const t2 = median(byTier[2], 5);
  const t3 = Math.max(t2 + 4, median(byTier[3], 15));
  return { 1: 1, 2: t2, 3: t3, 4: t3 + 8 };
}

interface Route {
  parent: string;
  child: string;
  level: number;
  aliMin?: number;
  aliMax?: number;
  item?: string;
  stat?: GateStat;
}

export interface ExpansionReport {
  added: { snes: number; sow: number };
  merged: string[];
  routes: number;
}

/**
 * Graft the SNES and Symphony of War classes onto `base`. Returns a new
 * dataset; `base` is not modified.
 */
export function expandDataset(
  base: Dataset,
  snes: SnesClass[],
  sow: SowClass[],
): { dataset: Dataset; report: ExpansionReport } {
  const classes: Record<string, ClassDef> = {};
  for (const [id, c] of Object.entries(base.classes)) classes[id] = { ...c, promotesTo: [...c.promotesTo] };
  const baseList = Object.values(classes);
  const profile = referenceProfiles(baseList);
  const round = rounder(base.source);
  const levels = tierLevels(baseList);
  const gated = base.source === 'ob64';

  // Name lookup over the base dataset, preferring classes the player can reach.
  const byName = new Map<string, ClassDef[]>();
  for (const c of baseList) byName.set(normName(c.name), [...(byName.get(normName(c.name)) ?? []), c]);
  const findExisting = (name: string, gender?: Gender): ClassDef | undefined => {
    const n = normName(name);
    for (const key of [n, ...(ALIASES[n] ?? [])]) {
      const hits = (byName.get(key) ?? []).sort((a, b) => Number(b.playable) - Number(a.playable));
      const fit = hits.find((c) => !gender || c.gender === gender) ?? hits[0];
      if (fit) return fit;
    }
    return undefined;
  };

  const taken = new Set(Object.keys(classes));
  const newId = (name: string, suffix: string) => {
    let id = normName(name) ? name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : suffix;
    if (taken.has(id)) id = `${id}-${suffix}`;
    taken.add(id);
    return id;
  };

  const ids = new Map<string, string>(); // `${game}:${name}` -> class id
  const merged: string[] = [];
  const routes: Route[] = [];
  const added = { snes: 0, sow: 0 };

  // --- SNES ---------------------------------------------------------------
  const tiers = snesTiers(snes);
  const norms = snesNorms(snes, tiers);
  for (const s of snes) {
    const gender: Gender = s.family === 'fighter' ? 'M' : s.family === 'amazon' ? 'F' : 'X';
    const existing = findExisting(s.name, gender);
    if (existing) {
      ids.set(`snes:${s.name}`, existing.id);
      merged.push(`${s.name} (SNES) = ${existing.name}`);
      continue;
    }
    const tier = tiers.get(s.name)!;
    const monster = gender === 'X';
    const stats = round(snesStats(s, tier, norms, profile(tier, monster)));
    const front = snesAttack(s.front.attack, s.front.hits);
    const back = snesAttack(s.back.attack, s.back.hits);
    const physical = front.type === 'melee' || front.type === 'ranged';
    const casterish = back.type === 'magic' || back.type === 'heal';
    // Casters stand at the back: their front-row blow is a token one (a punch, an ankh, a slap).
    const prefersBack = front.type === 'ranged' || !physical ||
      (casterish && (back.count > front.count || front.power < 0.9 || stats.base.int > stats.base.str));
    const mid = prefersBack && casterish
      ? { ...back, count: Math.max(1, back.count - 1) }
      : { ...front, count: Math.max(1, front.count - 1) };
    const march = snesMarch(s, prefersBack && casterish && !monster);
    const attacks = { front, mid, back };
    const id = newId(s.name, 'snes');
    ids.set(`snes:${s.name}`, id);
    const undead = s.family === 'undead' || /zombie|coffin/i.test(s.name);
    const reachable = !undead && !s.formOf && !(s.item && !s.from);
    classes[id] = {
      id,
      name: s.name,
      gender,
      tier,
      desc: `Tier ${tier} ${monster ? 'monster' : gender === 'F' ? 'female' : 'male'} class from Ogre Battle: March of the Black Queen, translated.` +
        (s.large ? ' Large.' : '') + (march === 'fly' ? ' Flies.' : ''),
      base: stats.base,
      growth: stats.growth,
      attacks,
      promotesTo: [],
      moveType: march === 'fly' ? 'fly' : march === 'light' ? 'fast' : 'foot',
      march,
      preferredRow: prefersBack ? 'back' : 'front',
      sprite: spriteFor(s.name, false),
      palette: `x-${id}`,
      spriteOf: LOOKS[id],
      resist: snesResist(s, norms),
      size: s.large ? 2 : 1,
      element: monster ? monsterElement(attacks, march) : undefined,
      startAlignment: s.ali0,
      startLuck: s.luk0,
      playable: reachable,
      source: base.source,
      origin: 'snes',
    };
    added.snes++;
  }
  for (const s of snes) {
    const parent = s.from && ids.get(`snes:${s.from}`);
    const child = ids.get(`snes:${s.name}`)!;
    if (!parent || s.formOf) continue;
    const tier = Math.max(classes[child].tier, classes[parent].tier + 1, 2) as Tier;
    routes.push({
      parent, child,
      level: s.level ?? levels[clamp(tier, 2, 4) as Tier],
      aliMin: s.aliMin ?? undefined,
      aliMax: s.aliMax ?? undefined,
      item: s.item ?? undefined,
    });
  }

  // --- Symphony of War ------------------------------------------------------
  const sowList = sow.filter((c) => !SOW_SKIP_TYPES.test(c.type));
  const rate = sowRatingFill(sowList);
  const sowNames = new Set(sowList.map((c) => c.name));
  const findAny = (name: string, gender?: Gender): string | undefined => {
    const existing = findExisting(name, gender);
    if (existing) return existing.id;
    const snesMatch = snes.find((s) => normName(s.name) === normName(name));
    return snesMatch ? ids.get(`snes:${snesMatch.name}`) : undefined;
  };
  for (const c of sowList) {
    const n = c.name.toLowerCase();
    const gender: Gender = SOW_MONSTER.test(c.name) ? 'X' : SOW_FEMALE.has(n) ? 'F' : 'A';
    const already = findAny(c.name, gender === 'A' ? undefined : gender);
    if (already) {
      ids.set(`sow:${c.name}`, already);
      merged.push(`${c.name} (SoW) = ${classes[already].name}`);
      continue;
    }
    const kind = sowKind(c);
    // The class table's section is the tier; the infobox occasionally disagrees.
    const tier = clamp(Number(c.group) || c.tier || (c.group === 'dlc' ? 4 : 2), 1, 4) as Tier;
    const monster = gender === 'X';
    const raw = sowStats(c, rate, profile(tier, monster));
    const stats = round(raw);
    const element = sowElement(c);
    const attacks = sowAttacks(c, kind, element);
    const march = sowMarch(c, kind);
    const menRatio = raw.base.men / Math.max(1, profile(tier, monster).base.men);
    const id = newId(c.name, 'sow');
    ids.set(`sow:${c.name}`, id);
    const risen = /^risen/i.test(c.name);
    const backRow = kind === 'archer' || kind === 'caster' || kind === 'healer' || kind === 'archerCav';
    classes[id] = {
      id,
      name: c.name,
      gender,
      tier,
      desc: `Tier ${tier} ${monster ? 'monster' : 'human'} class from Symphony of War, translated.` +
        (c.traits.includes('Colossal') ? ' Large.' : '') + (march === 'fly' ? ' Flies.' : ''),
      base: stats.base,
      growth: stats.growth,
      attacks,
      promotesTo: [],
      moveType: march === 'fly' ? 'fly' : march === 'heavy' || march === 'slow' ? 'foot' : 'fast',
      march,
      preferredRow: backRow ? 'back' : 'front',
      sprite: spriteFor(c.name, march === 'heavyCav' || march === 'lightCav'),
      palette: `x-${id}`,
      spriteOf: LOOKS[id],
      resist: sowResist(c, kind, element, menRatio),
      size: c.traits.includes('Colossal') ? 2 : 1,
      element: monster ? element ?? monsterElement(attacks, march) : undefined,
      playable: !risen,
      source: base.source,
      origin: 'sow',
    };
    added.sow++;
  }
  // Routes: each class's "upgrades into" list, plus its stated ancestors one tier down.
  const sowRoute = (parentName: string, child: SowClass) => {
    if (!sowNames.has(parentName)) return;
    const childId = ids.get(`sow:${child.name}`);
    const parentIds = [ids.get(`sow:${parentName}`)];
    for (const twin of SOW_ROOT_TWINS[normName(parentName)] ?? []) parentIds.push(findExisting(twin)?.id);
    if (!childId) return;
    const stat = Object.keys(child.reqs).map((k) => SOW_GATE[k]).find(Boolean);
    for (const parent of parentIds) {
      if (!parent || parent === childId) continue;
      const tier = clamp(Math.max(classes[childId].tier, classes[parent].tier + 1), 2, 4) as Tier;
      routes.push({ parent, child: childId, level: levels[tier], stat });
    }
  };
  const byNameSow = new Map(sowList.map((c) => [c.name, c]));
  for (const c of sowList) {
    for (const into of c.into) if (byNameSow.has(into)) sowRoute(c.name, byNameSow.get(into)!);
    const ownTier = Number(c.group) || c.tier || 0;
    const tiersBelow = Object.keys(c.ancestors).map(Number).filter((t) => t < ownTier);
    if (tiersBelow.length) {
      for (const p of c.ancestors[String(Math.max(...tiersBelow))]) sowRoute(p, c);
    }
  }

  // --- Wire routes ----------------------------------------------------------
  let addedRoutes = 0;
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const p of classes[id]?.promotesTo ?? []) stack.push(p.classId);
    }
    return false;
  };
  for (const r of routes) {
    const parent = classes[r.parent];
    const child = classes[r.child];
    if (!parent || !child || r.parent === r.child) continue;
    if (parent.promotesTo.some((p) => p.classId === r.child)) continue;
    if (child.tier < parent.tier) continue; // never a step down
    if (reaches(r.child, r.parent)) continue; // never a loop
    if (!genderCompatible(parent.gender, child.gender)) continue;
    const req: PromotionReq = { classId: r.child, level: Math.max(r.level, 2) };
    if (gated) req.stats = gatesFor(child, r.stat);
    if (r.aliMin !== undefined) req.aliMin = r.aliMin;
    if (r.aliMax !== undefined) req.aliMax = r.aliMax;
    if (r.item) req.item = r.item;
    parent.promotesTo.push(req);
    addedRoutes++;
  }

  // The items those class changes spend. Where the dataset already has an
  // item of the name (Ogre Battle 64's Royal Crown), that one serves; the
  // rest become key items, sold by shops of a high enough rank and found
  // among the spoils of battle.
  const items: Record<string, ItemDef> = { ...base.items };
  const known = new Set(Object.values(items).map((i) => normName(i.name)));
  for (const c of Object.values(classes)) {
    for (const p of c.promotesTo) {
      if (!p.item) continue;
      const target = classes[p.classId];
      const id = normName(p.item);
      if (known.has(id)) {
        const own = Object.values(items).find((i) => normName(i.name) === id && i.source === 'expansion');
        if (own && !own.desc?.includes(target.name)) own.desc += ` Or into ${target.name}.`;
        continue;
      }
      known.add(id);
      const slug = p.item.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      items[items[slug] ? `${slug}-key` : slug] = {
        id: items[slug] ? `${slug}-key` : slug,
        name: p.item,
        kind: 'key',
        price: [0, 400, 900, 1800, 2800][target.tier],
        rank: Math.min(8, target.tier * 2),
        forSale: true,
        desc: `Spent on a class change into ${target.name}.`,
        source: 'expansion',
      };
    }
  }

  // A class the player can only reach through enemy-only classes is enemy-only too.
  for (let changed = true; changed;) {
    changed = false;
    for (const c of Object.values(classes)) {
      if (!c.origin || !c.playable || c.tier === 1) continue;
      const reachable = Object.values(classes).some((p) => p.playable && p.promotesTo.some((q) => q.classId === c.id));
      if (!reachable) {
        c.playable = false;
        changed = true;
      }
    }
  }

  return {
    dataset: {
      classes,
      items,
      spells: base.spells,
      source: base.source,
      label: `${base.label} + expansion`,
    },
    report: { added, merged, routes: addedRoutes },
  };
}
