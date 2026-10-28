import type { ClassDef } from '../core/types';
import { equipRulesOf } from '../core/items';
import type { Palette } from '../gfx/pixels';
import { artFor } from '../gfx/pixels';
import type { HumanLook, WeaponKind } from './humanoid';
import { SLOT } from './humanoid';

// What a class looks like, worked out from what the game knows of it: the
// build and colours its pixel art was given (gfx/pixels.ts), the weapon and
// armour its equipment rules allow, its tier, and a few words of its name.

/** The kinds of figure a class is painted as. */
export type FigureKind = 'human' | 'beast' | 'dragon' | 'golem' | 'ghost' | 'sea' | 'rider';

export function figureKindOf(def: ClassDef): FigureKind {
  const t = artFor(def).template;
  if (t === 'beast' || t === 'dragon' || t === 'golem' || t === 'ghost' || t === 'sea' || t === 'rider') return t;
  return 'human';
}

/** A little stable variety from a class's name, 0 to 1. */
function hashOf(s: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export function humanLookOf(def: ClassDef): HumanLook {
  const { template } = artFor(def);
  const rules = equipRulesOf(def);
  const name = `${def.id} ${def.name}`.toLowerCase();
  const weapon = (rules.weapon[0] ?? (template === 'archer' ? 'bow' : template === 'robe' || template === 'dress' ? 'staff' : 'sword')) as WeaponKind;
  const undead = def.resist.virtue < 45 && def.resist.bane > 55 && /skelet|bone|lich|undead|zombie|ghoul|wight|revenant/.test(name);
  const body = rules.body[0];
  const armour: HumanLook['armour'] = undead ? 'bones'
    : template === 'dress' ? 'dress'
      : template === 'robe' || body === 'robe' ? (def.gender === 'F' ? 'dress' : 'robe')
        : body === 'heavy' ? (template === 'heavy' || def.tier >= 2 ? 'plate' : 'mail')
          : body === 'medium' ? 'mail'
            : body === 'light' ? 'leather'
              : 'tunic';
  const caster = armour === 'robe' || armour === 'dress';
  const twoHanded = weapon === 'greatsword' || weapon === 'spear' || weapon === 'bow' || weapon === 'staff' || weapon === 'hammer';
  const shield: HumanLook['shield'] = twoHanded || caster || !rules.offhand.some((t) => t === 'shield' || t === 'greatshield') ? 'none'
    : rules.offhand.includes('greatshield') && template === 'heavy' ? 'tower'
      : armour === 'plate' || /knight|paladin|guard/.test(name) ? 'kite' : 'round';
  const head: HumanLook['head'] = /ninja|assassin|shinobi/.test(name) ? 'mask'
    : rules.head.includes('helm') && (armour === 'plate' || (armour === 'mail' && def.tier >= 2)) ? (template === 'heavy' || def.tier >= 3 ? 'greathelm' : 'helm')
      : /witch|wizard|mage|sorcer|warlock|magus/.test(name) ? 'hat'
        : caster || /rogue|thief|archer|ranger|hunter|cleric|priest|monk/.test(name) ? (hashOf(def.id, 3) < 0.6 ? 'hood' : 'hair')
          : 'hair';
  const bulk = template === 'heavy' ? 1.22 : armour === 'plate' ? 1.12 : template === 'rogue' || caster ? 0.95 : def.gender === 'F' ? 0.97 : 1.05;
  return {
    bulk,
    armour,
    head,
    longHair: def.gender === 'F' || (head === 'hair' && hashOf(def.id, 7) < 0.25),
    weapon,
    shield,
    cape: def.tier >= 3 || /lord|king|queen|paladin|master/.test(name),
  };
}

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mixRgb = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** A class's colours by slot (see SLOT), from its pixel-art palette. */
export function slotColours(p: Palette): [number, number, number][] {
  const out: [number, number, number][] = [];
  out[SLOT.skin] = rgb(p.s);
  out[SLOT.eye] = rgb(p.e);
  out[SLOT.hair] = rgb(p.h);
  out[SLOT.armour] = rgb(p.a);
  out[SLOT.trim] = rgb(p.b);
  out[SLOT.metal] = rgb(p.w);
  out[SLOT.wood] = rgb(p.x);
  out[SLOT.shield] = rgb(p.d);
  out[SLOT.dark] = mixRgb(rgb(p.a), [34, 26, 30], 0.68);
  out[SLOT.cloth] = mixRgb(rgb(p.a), [226, 216, 196], 0.45);
  out[SLOT.glow] = [255, 244, 190];
  return out;
}

export function paletteOf(def: ClassDef): Palette {
  return artFor(def).palette;
}
