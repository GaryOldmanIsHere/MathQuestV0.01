import { describe, expect, it } from 'vitest';
import { decodeAttacks, decodeClasses, decodeConsumables, decodeElements, decodeItems } from './decode';

// A synthetic cartridge laid out the way Ogre Battle 64's is: overlay B's
// data at ROM 0x40E80 standing for RAM 0x8016AF80, with the element-name,
// class and attack tables at their real addresses. No game data involved.

const OVL_ROM = 0x40e80;
const OVL_VRAM = 0x8016af80;
const rom = (v: number) => v - OVL_VRAM + OVL_ROM;

class FakeRom {
  bytes = new Uint8Array(0x70000);
  private strings = rom(0x80190000); // free space inside the overlay for names

  u8(o: number, v: number) { this.bytes[o] = v; }
  u16(o: number, v: number) { this.bytes[o] = v >> 8; this.bytes[o + 1] = v & 0xff; }
  u32(o: number, v: number) { this.u16(o, v >>> 16); this.u16(o + 2, v & 0xffff); }

  /** Store a NUL-terminated string and return its RAM pointer. */
  str(s: string | number[]): number {
    const at = this.strings;
    const codes = typeof s === 'string' ? [...s].map((c) => c.charCodeAt(0)) : s;
    codes.forEach((c, i) => this.u8(at + i, c));
    this.u8(at + codes.length, 0);
    this.strings += codes.length + 1;
    return at - OVL_ROM + OVL_VRAM;
  }
}

function classRecord(r: FakeRom, id: number, name: string | number[], fill: (base: number) => void) {
  const base = rom(0x80187c34) + id * 0x48;
  r.u32(base, r.str(name));
  fill(base);
}

function build(): FakeRom {
  const r = new FakeRom();
  ['Physical', 'Wind', 'Flame'].forEach((n, i) => r.u32(rom(0x80187bf4) + 4 * i, r.str(n)));

  classRecord(r, 0, 'None', () => {});
  classRecord(r, 1, 'Fighter', (b) => {
    r.u8(b + 0x04, 1); // normal size
    r.u8(b + 0x05, 0); // male
    [70, 50, 50, 40, 46, 42, 45].forEach((v, i) => r.u16(b + 0x08 + 4 * i, v));
    [4, 3, 2, 2, 2, 1, 2].forEach((v, i) => r.u8(b + 0x0a + 4 * i, v));
    r.u8(b + 0x23, 50); // luck
    r.u8(b + 0x24, 52); // alignment
    [45, 50, 50, 50, 50, 50, 50].forEach((v, i) => r.u8(b + 0x25 + i, v));
    r.u8(b + 0x2c, 2);
    r.u16(b + 0x2e, 1); // a short sword
    [[4, 2], [4, 1], [4, 1]].forEach(([a, n], i) => { r.u8(b + 0x37 + 2 * i, a); r.u8(b + 0x38 + 2 * i, n); });
    r.u8(b + 0x46, 0xff); // element rolled at creation
  });
  classRecord(r, 2, 'Knight', (b) => {
    r.u8(b + 0x04, 1);
    r.u8(b + 0x41, 1); r.u8(b + 0x42, 6); r.u8(b + 0x43, 0); r.u8(b + 0x44, 0);
  });
  // A two-line name, broken with the game's 0x10 'c' control code.
  classRecord(r, 3, [...'Thunder'].map((c) => c.charCodeAt(0)).concat([0x10, 0x63], [...'Dragon'].map((c) => c.charCodeAt(0)), [0x0f]), (b) => {
    r.u8(b + 0x04, 2); // large
    r.u8(b + 0x2c, 1); // flies
    r.u8(b + 0x45, 0);
    r.u8(b + 0x46, 1); // wind
  });

  const atk = (id: number, name: string, bytes: number[]) => {
    const base = rom(0x8018aa9c) + id * 0x10;
    r.u32(base, name ? r.str(name) : rom(0x80190fff) - OVL_ROM + OVL_VRAM); // empty name still points in
    bytes.forEach((v, i) => r.u8(base + 4 + i, v));
  };
  atk(0, '|', [0xff]);
  atk(1, 'Slash', [0, 0x0f, 1, 1, 1, 1]);
  atk(2, 'Lightning', [3, 1, 1, 1, 1, 7]);

  // Equipment: 32-byte records from 0x8018C42C, record 0 empty.
  const item = (id: number, name: string, bytes: Record<number, number>) => {
    const base = rom(0x8018c42c) + id * 0x20;
    r.u32(base, r.str(name));
    for (const [off, v] of Object.entries(bytes)) r.u8(base + Number(off), v);
  };
  item(0, 'None', { 4: 0xff, 5: 0xff });
  item(1, 'Short Sword', { 4: 1, 6: 1, 8: 0, 9: 20, 0x0a: 3 });
  // A wind shield: DEF +8, wind -3, earth +8, sold nowhere, and a dragon ward.
  item(2, 'Electric Shield', { 4: 14, 5: 1, 6: 3, 8: 0, 9: 150, 0x11: 8, 0x12: 0xfd, 0x14: 8, 0x1a: 0x80, 0x1b: 0x01 });
  item(3, 'None', { 4: 0xff, 5: 0xff }); // closes the table
  // Consumables: 12-byte records straight after, record 0 empty.
  const use = (id: number, name: string, bytes: number[]) => {
    const base = rom(0x8018e6ec) + id * 0x0c;
    r.u32(base, r.str(name));
    bytes.forEach((v, i) => r.u8(base + 4 + i, v));
  };
  use(1, 'Heal Leaf', [0, 0, 0, 10, 1, 7]);
  use(2, 'Sword Emblem', [1, 0, 0x09, 0xf6, 1, 7]);
  return r;
}

describe('ROM table decoding', () => {
  const r = build();

  it('reads the element names through their pointer table', () => {
    expect(decodeElements(r.bytes)).toEqual(['Physical', 'Wind', 'Flame']);
  });

  it('stops each table at the first record whose name pointer leaves the overlay', () => {
    expect(decodeClasses(r.bytes)).toHaveLength(4);
    expect(decodeAttacks(r.bytes)).toHaveLength(3);
  });

  it('decodes stats as a u16 base and a u8 growth per stat', () => {
    const fighter = decodeClasses(r.bytes)[1];
    expect(fighter.name).toBe('Fighter');
    expect(fighter.stats.hp).toEqual({ base: 70, growth: 4 });
    expect(fighter.stats.dex).toEqual({ base: 45, growth: 2 });
  });

  it('decodes luck, alignment and the seven resistances in table order', () => {
    const fighter = decodeClasses(r.bytes)[1];
    expect(fighter.luck).toBe(50);
    expect(fighter.alignment).toBe(52);
    expect(fighter.resist).toEqual({ physical: 45, wind: 50, flame: 50, earth: 50, water: 50, virtue: 50, bane: 50 });
  });

  it('decodes each row as an attack id and a hit count', () => {
    expect(decodeClasses(r.bytes)[1].rows).toEqual([
      { attack: 4, hits: 2 }, { attack: 4, hits: 1 }, { attack: 4, hits: 1 },
    ]);
  });

  it('decodes the promotion lineage bytes', () => {
    expect(decodeClasses(r.bytes)[2].lineage).toEqual({ tier1: 1, tier2Level: 6, tier2: 0, tier3Level: 0 });
  });

  it('decodes size, movement type, element and the rolled-element marker', () => {
    const [, fighter, , dragon] = decodeClasses(r.bytes);
    expect(fighter.element).toBe(0xff);
    expect(dragon.size).toBe(2);
    expect(dragon.moveType).toBe(1);
    expect(dragon.element).toBe(1);
  });

  it('turns the 0x10 line-break control code into a space and drops 0x0F', () => {
    expect(decodeClasses(r.bytes)[3].name).toBe('Thunder Dragon');
  });

  it('decodes an attack\'s category, element, target and effect', () => {
    const lightning = decodeAttacks(r.bytes)[2];
    expect(lightning).toMatchObject({ name: 'Lightning', category: 3, element: 1, target: 1, effect: 1 });
  });
});

describe('item table decoding', () => {
  const r = build();

  it('reads equipment until the closing record, skipping the empty slot', () => {
    expect(decodeItems(r.bytes).map((i) => i.name)).toEqual(['Short Sword', 'Electric Shield']);
  });

  it('decodes type, rank, price and signed bonuses', () => {
    expect(decodeItems(r.bytes)[0]).toMatchObject({ id: 1, type: 1, rank: 1, price: 20, bonus: { str: 3, int: 0 } });
  });

  it('decodes the seven resistance columns as signed bytes, and the flags', () => {
    const shield = decodeItems(r.bytes)[1];
    expect(shield.resist).toEqual({ physical: 8, wind: -3, flame: 0, earth: 8, water: 0, virtue: 0, bane: 0 });
    expect(shield.element).toBe(1);
    expect(shield.flags[2]).toBe(0x80);
    expect(shield.flags[3]).toBe(0x01);
  });

  it('reads consumables: category, price and target', () => {
    expect(decodeConsumables(r.bytes)).toEqual([
      { id: 1, name: 'Heal Leaf', category: 0, flag: 0, price: 10, target: 1, usage: 7 },
      { id: 2, name: 'Sword Emblem', category: 1, flag: 0, price: 2550, target: 1, usage: 7 },
    ]);
  });
});
