// Decoder for the static data tables of Ogre Battle 64: Person of Lordly
// Caliber (USA, Rev A). Pure TypeScript over a byte array: no Node or browser
// APIs, so the same code runs in the extractor CLI, in tests against a
// synthetic buffer, and could run in the browser.
//
// Every table and field here was located in the ROM and its layout confirmed
// against the game's own code (load widths and the routines that consume
// each field, in the recomp project's disassembly of overlay 0x40E80).
// Fields whose *meaning* is inferred rather than read off code are marked.

export const OB64_SHA1 = 'd26b14bee422a09581ce438d45ba9fec9783fbb8';

// Overlay B is DMA'd verbatim from ROM 0x40E80 to RAM 0x8016AF80, so its
// absolute pointers map back to ROM by a fixed offset.
const OVL_ROM = 0x40e80;
const OVL_VRAM = 0x8016af80;
const OVL_END_ROM = 0x66e30;

const CLASS_TABLE_VRAM = 0x80187c34; // 72-byte records, id = index
const CLASS_STRIDE = 0x48;
const ATTACK_TABLE_VRAM = 0x8018aa9c; // 16-byte records, id = index
const ATTACK_STRIDE = 0x10;
const ELEMENT_NAMES_VRAM = 0x80187bf4; // u32 string pointers
const ITEM_TABLE_VRAM = 0x8018c42c; // 32-byte equipment records, id = index (0 = none)
const ITEM_STRIDE = 0x20;
// The consumables follow straight on: the equipment table's closing "None"
// record is the consumable table's first.
const CONSUMABLE_TABLE_VRAM = 0x8018e6ec; // 12-byte records, id = index (0 = none)
const CONSUMABLE_STRIDE = 0x0c;

export const STAT_KEYS = ['hp', 'str', 'vit', 'int', 'men', 'agi', 'dex'] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** Resistance order, as the ROM's element table names it (indices 0..6). */
export const RESIST_KEYS = ['physical', 'wind', 'flame', 'earth', 'water', 'virtue', 'bane'] as const;
export type ResistKey = (typeof RESIST_KEYS)[number];

export interface Ob64Class {
  id: number;
  name: string;
  /** +0x04: 0 none, 1 normal, 2 large (Ogre, dragons, beasts, golems). */
  size: number;
  /** +0x05: 0 male, 1 female, 2 monster, 3 forced male, 4 random. */
  gender: number;
  /** +0x06: raw flag (0 base, 1 most advanced classes, 2 a few specials). */
  flag06: number;
  /** +0x08..+0x22: per stat, starting value and per-level growth. */
  stats: Record<StatKey, { base: number; growth: number }>;
  /** +0x23: starting Luck. Copied into the unit by the creation routine. */
  luck: number;
  /** +0x24: starting alignment (0 chaotic .. 100 lawful). */
  alignment: number;
  /** +0x25..+0x2B: resistance per element, 50 = neutral. */
  resist: Record<ResistKey, number>;
  /** +0x2C: terrain movement type (1 air, 2 plains, 3 forest, 4 mountain, 5, 6 water, 7 none). */
  moveType: number;
  /** +0x2E..+0x34: four default equipment item ids (0 = empty). */
  equipment: [number, number, number, number];
  /** +0x36: raw special flag. */
  flag36: number;
  /** +0x37..+0x3C: (attack id, hit count) for the front, middle, back rows. */
  rows: { attack: number; hits: number }[];
  /** +0x3D..+0x40: four raw bytes, consumed by battle code (meaning unconfirmed). */
  battle3D: [number, number, number, number];
  /**
   * +0x41..+0x44: promotion lineage. Below level `tier2Level` a unit of this
   * class is its `tier1` ancestor; below `tier3Level` it is its `tier2`
   * ancestor (func_8016EA54). 0 / 0xFF = no such step.
   */
  lineage: { tier1: number; tier2Level: number; tier2: number; tier3Level: number };
  /** +0x45: base class this record is a story/boss variant of (0 = none). */
  variantOf: number;
  /** +0x46: element (1..6, 7 Drakonite); 0xFF = rolled 1..4 at creation. */
  element: number;
  /** +0x47: raw byte, 1 for casters and 2 for fighters (inferred: row preference). */
  flag47: number;
}

export interface Ob64Attack {
  id: number;
  name: string;
  /** 0 melee, 1 ranged, 3 magic, 4 special, 5 breath. */
  category: number;
  /** Index into the element table; 8 = the caster's own element. */
  element: number;
  /** Target pattern: 1 single, 3 row, 5 summon, 6 all, others special. */
  target: number;
  /** Effect: 1 damage, 2 heal, 4 sleep, 8 paralyze, 10 poison. */
  effect: number;
  raw: number[];
}

/**
 * One piece of equipment. Class records name their default gear by these
 * ids (+0x2E..+0x34), which is how the layout was confirmed: a Fighter starts
 * with item 1, a Short Sword, a Wizard with a staff, a robe, a Spellbook and
 * an Amulet. The stat and resistance columns read the way their values only
 * make sense: weapons raise STR, staves INT, armour the physical column,
 * elemental gear one element's column against its opposite's.
 */
export interface Ob64Item {
  id: number;
  name: string;
  /**
   * +0x04: equipment type. 1 sword, 2 two-handed sword, 3 rapier, 4 axe,
   * 5 hammer, 7 spear, 8 whip, 9 claw, 10 bow, 11 mace, 12 staff, 13 doll,
   * 24 fan; 14 small and 15 large shield; 16 light, 17 medium and 18 heavy
   * armour, 19 robe, 20 clothing; 21 helm, 22 hat; 23 book; 25 accessory.
   */
  type: number;
  /** +0x05: element, as the element table (0 none; 7 a spell tome; 8 none, for the plain Spellbook). */
  element: number;
  /** +0x06: rank (inferred: how far into the game the item is found). */
  rank: number;
  /** +0x08: price in Goth. */
  price: number;
  /** +0x0A..+0x10: STR, INT, AGI, DEX, VIT, MEN, LUK bonuses (signed). */
  bonus: { str: number; int: number; agi: number; dex: number; vit: number; men: number; luk: number };
  /** +0x11..+0x17: resistance bonuses in the class table's order (signed). */
  resist: Record<ResistKey, number>;
  /** +0x18..+0x1C: raw flag bytes; +0x1A bit 7 marks items no shop sells. */
  flags: [number, number, number, number, number];
}

/** One consumable or key item: Heal Leaf, Revive Stone, the stat relics, story items. */
export interface Ob64Consumable {
  id: number;
  name: string;
  /** +0x04: 0 supplies, 1 stat relics, 2 map items, 3 tactics items, 4 key items. */
  category: number;
  /** +0x05: raw byte. */
  flag: number;
  /** +0x06: price in Goth. */
  price: number;
  /** +0x08: 1 one unit, 2 a whole squad, 3 the army (inferred from which items use it). */
  target: number;
  /** +0x09: raw byte (inferred: where the item can be used). */
  usage: number;
}

export interface Ob64Data {
  source: { sha1: string; title: string };
  elements: string[];
  classes: Ob64Class[];
  attacks: Ob64Attack[];
  items?: Ob64Item[];
  consumables?: Ob64Consumable[];
}

function u16(b: Uint8Array, o: number): number {
  return (b[o] << 8) | b[o + 1];
}

function s8(b: Uint8Array, o: number): number {
  return b[o] >= 0x80 ? b[o] - 0x100 : b[o];
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function vramToRom(v: number): number {
  return v - OVL_VRAM + OVL_ROM;
}

/** A NUL-terminated string at a pointer into overlay B, or null if it does not point there. */
function cstringAt(rom: Uint8Array, vram: number): string | null {
  const o = vramToRom(vram);
  if (o < OVL_ROM || o >= OVL_END_ROM) return null;
  let s = '';
  for (let i = o; i < rom.length && rom[i] !== 0; i++) {
    const c = rom[i];
    if (c === 0x10) {
      // Text control code with one argument byte: breaks a long name onto a
      // second line in menus ("Thunder\x10cDragon"). Reads as a space.
      s += ' ';
      i++;
    } else if (c >= 0x20 && c < 0x7f) {
      s += String.fromCharCode(c);
    }
    // Other control bytes (0x0F ends a line) carry no text.
  }
  return s.replace(/\s+/g, ' ');
}

export function decodeElements(rom: Uint8Array): string[] {
  const out: string[] = [];
  const base = vramToRom(ELEMENT_NAMES_VRAM);
  for (let i = 0; i < 32; i++) {
    const s = cstringAt(rom, u32(rom, base + 4 * i));
    if (s === null) break;
    out.push(s);
  }
  return out;
}

export function decodeClasses(rom: Uint8Array): Ob64Class[] {
  const base = vramToRom(CLASS_TABLE_VRAM);
  const out: Ob64Class[] = [];
  for (let id = 0; ; id++) {
    const r = base + id * CLASS_STRIDE;
    if (r + CLASS_STRIDE > rom.length) break;
    const name = cstringAt(rom, u32(rom, r));
    if (name === null) break;
    const stats = {} as Ob64Class['stats'];
    STAT_KEYS.forEach((k, i) => {
      stats[k] = { base: u16(rom, r + 0x08 + 4 * i), growth: rom[r + 0x0a + 4 * i] };
    });
    const resist = {} as Ob64Class['resist'];
    RESIST_KEYS.forEach((k, i) => {
      resist[k] = rom[r + 0x25 + i];
    });
    out.push({
      id,
      name: name.trim(),
      size: rom[r + 0x04],
      gender: rom[r + 0x05],
      flag06: rom[r + 0x06],
      stats,
      luck: rom[r + 0x23],
      alignment: rom[r + 0x24],
      resist,
      moveType: rom[r + 0x2c],
      equipment: [u16(rom, r + 0x2e), u16(rom, r + 0x30), u16(rom, r + 0x32), u16(rom, r + 0x34)],
      flag36: rom[r + 0x36],
      rows: [0, 1, 2].map((i) => ({ attack: rom[r + 0x37 + 2 * i], hits: rom[r + 0x38 + 2 * i] })),
      battle3D: [rom[r + 0x3d], rom[r + 0x3e], rom[r + 0x3f], rom[r + 0x40]],
      lineage: {
        tier1: rom[r + 0x41],
        tier2Level: rom[r + 0x42],
        tier2: rom[r + 0x43],
        tier3Level: rom[r + 0x44],
      },
      variantOf: rom[r + 0x45],
      element: rom[r + 0x46],
      flag47: rom[r + 0x47],
    });
  }
  return out;
}

export function decodeAttacks(rom: Uint8Array): Ob64Attack[] {
  const base = vramToRom(ATTACK_TABLE_VRAM);
  const out: Ob64Attack[] = [];
  for (let id = 0; ; id++) {
    const r = base + id * ATTACK_STRIDE;
    if (r + ATTACK_STRIDE > rom.length) break;
    const name = cstringAt(rom, u32(rom, r));
    if (name === null) break;
    const raw = Array.from(rom.subarray(r + 4, r + ATTACK_STRIDE));
    out.push({
      id,
      name: name.trim(),
      category: raw[0],
      element: raw[1],
      target: raw[2],
      effect: raw[3],
      raw,
    });
  }
  return out;
}

export function decodeItems(rom: Uint8Array): Ob64Item[] {
  const base = vramToRom(ITEM_TABLE_VRAM);
  const out: Ob64Item[] = [];
  // Record 0 is the empty slot; the table ends at the next record typed 0xFF.
  for (let id = 1; ; id++) {
    const r = base + id * ITEM_STRIDE;
    if (r + ITEM_STRIDE > rom.length) break;
    const name = cstringAt(rom, u32(rom, r));
    if (name === null || rom[r + 4] === 0xff) break;
    const resist = {} as Ob64Item['resist'];
    RESIST_KEYS.forEach((k, i) => {
      resist[k] = s8(rom, r + 0x11 + i);
    });
    out.push({
      id,
      name: name.trim(),
      type: rom[r + 4],
      element: rom[r + 5],
      rank: rom[r + 6],
      price: u16(rom, r + 8),
      bonus: {
        str: s8(rom, r + 0x0a), int: s8(rom, r + 0x0b), agi: s8(rom, r + 0x0c), dex: s8(rom, r + 0x0d),
        vit: s8(rom, r + 0x0e), men: s8(rom, r + 0x0f), luk: s8(rom, r + 0x10),
      },
      resist,
      flags: [rom[r + 0x18], rom[r + 0x19], rom[r + 0x1a], rom[r + 0x1b], rom[r + 0x1c]],
    });
  }
  return out;
}

export function decodeConsumables(rom: Uint8Array): Ob64Consumable[] {
  const base = vramToRom(CONSUMABLE_TABLE_VRAM);
  const out: Ob64Consumable[] = [];
  for (let id = 1; ; id++) {
    const r = base + id * CONSUMABLE_STRIDE;
    if (r + CONSUMABLE_STRIDE > rom.length) break;
    const name = cstringAt(rom, u32(rom, r));
    if (name === null) break;
    out.push({
      id,
      name: name.trim(),
      category: rom[r + 4],
      flag: rom[r + 5],
      price: u16(rom, r + 6),
      target: rom[r + 8],
      usage: rom[r + 9],
    });
  }
  return out;
}

/** The internal game title from the cartridge header. */
export function romTitle(rom: Uint8Array): string {
  let s = '';
  for (let i = 0x20; i < 0x34; i++) s += String.fromCharCode(rom[i]);
  return s.trim();
}

export function decodeAll(rom: Uint8Array, sha1: string): Ob64Data {
  return {
    source: { sha1, title: romTitle(rom) },
    elements: decodeElements(rom),
    classes: decodeClasses(rom),
    attacks: decodeAttacks(rom),
    items: decodeItems(rom),
    consumables: decodeConsumables(rom),
  };
}
