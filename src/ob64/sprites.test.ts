import { describe, expect, it } from 'vitest';
import { ASSET_BASE, decompress } from './lz';
import {
  ANIM_SLOTS, SPRITE_TABLE_ROM, buildClips, bundleFromParts, cellBounds, composeCell, decodeSpriteTable,
  frameRgba, ownSprites, parseAnims, parseCells, parseUt, playScript, poseFrame, poseInfo, readBundle, recolour, rgba5551,
} from './sprites';
import { packBundle, unpackBundle } from './spritePack';

// Everything here is built by hand to the formats the decoder documents; no
// ROM is needed.

const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const u16 = (v: number) => [(v >> 8) & 255, v & 255];

/** A payload the decompressor reads back as `bytes`, written as literal runs. */
function stored(bytes: number[]): number[] {
  const out = u32(bytes.length);
  for (let i = 0; i < bytes.length; i += 64) {
    const run = bytes.slice(i, i + 64);
    out.push(0x40 | (run.length - 1), ...run);
  }
  return out;
}

/** A CI8 container with an I4 mask: frames given as rows of colour indices and mask nibbles. */
function ut(width: number, height: number, frames: { ref: number; whole?: boolean; ci: number[][]; mask: number[][] }[]): number[] {
  const cs = Math.ceil(width / 8) * 8;
  const ms = Math.ceil(Math.ceil(width / 2) / 8) * 8;
  const out = [0x55, 0x54, frames.length, 0x04 | 0x01, ...u16(width), ...u16(height)];
  for (const f of frames) {
    out.push(0, 0, f.ref, 1 | 2 | (f.whole ? 8 : 0), 0, 0, 0, 0);
    for (let y = 0; y < height; y++) for (let x = 0; x < cs; x++) out.push(f.ci[y][x] ?? 0);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < ms; x++) out.push(((f.mask[y][x * 2] ?? 0) << 4) | (f.mask[y][x * 2 + 1] ?? 0));
    }
  }
  return out;
}

/** A 256-colour palette whose index i is the given colour (else black). */
function palette(colours: Record<number, number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < 256; i++) out.push(...u16(colours[i] ?? 0));
  return out;
}

const RED = 0xf801; // 31,0,0 opaque
const GREEN = 0x07c1;
const BLUE = 0x003f;

describe('the LZ decompressor', () => {
  it('reads literals, zero runs, 0xFF runs and overlapping back-references', () => {
    const src = new Uint8Array([
      ...u32(12),
      0x41, 7, 8, // literal 7 8
      0x80 | (1 << 3), 1, // back-ref length 4 from two back: 7 8 7 8
      0x20 | 1, // three zeros
      0x01, 0, // three 0xFF
    ]);
    expect([...decompress(src, 0)]).toEqual([7, 8, 7, 8, 7, 8, 0, 0, 0, 0xff, 0xff, 0xff]);
  });

  it('refuses an empty or absurd size', () => {
    expect(() => decompress(new Uint8Array(u32(0)), 0)).toThrow();
    expect(() => decompress(new Uint8Array(u32(0x7fffffff)), 0)).toThrow();
  });
});

describe('UT containers', () => {
  const bytes = new Uint8Array(ut(3, 2, [
    { ref: 0, ci: [[1, 2, 3], [4, 5, 6]], mask: [[15, 0, 15], [15, 15, 8]] },
    // Stored as the difference from frame 0: reference - stored.
    { ref: 0, ci: [[0, 1, 0], [0, 0, 0]], mask: [[0, 0, 15], [0, 7, 0]] },
  ]));

  it('reads the header and rows padded to 8 bytes', () => {
    const c = parseUt(bytes);
    expect([c.width, c.height, c.format, c.maskI4, c.colourStride, c.maskStride]).toEqual([3, 2, 'ci8', true, 8, 8]);
    expect(c.frames).toHaveLength(2);
  });

  it('rebuilds a difference frame from its reference', () => {
    const [f0, f1] = parseUt(bytes).frames;
    expect([...f0.colour!.slice(0, 3)]).toEqual([1, 2, 3]);
    expect([...f1.colour!.slice(0, 3)]).toEqual([1, 1, 3]);
    // Per nibble: the third texel's mask 15 - 15 = 0; the first stays 15.
    expect(f1.mask![0] >> 4).toBe(15);
    expect(f1.mask![1] >> 4).toBe(0);
    // Low nibbles too: the second row's second texel, 15 - 7.
    expect(f1.mask![8] & 15).toBe(8);
  });

  it('draws a frame through a palette, alpha from the mask', () => {
    const c = parseUt(bytes);
    const pal = Array.from({ length: 256 }, () => [0, 0, 0, 255] as [number, number, number, number]);
    pal[1] = rgba5551(RED);
    pal[3] = rgba5551(BLUE);
    const px = frameRgba(c, c.frames[0], pal);
    expect([...px.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect(px[7]).toBe(0); // second texel masked out
    expect([...px.slice(8, 12)]).toEqual([0, 0, 255, 255]);
    expect(px[(1 * 3 + 2) * 4 + 3]).toBe(8 * 17);
  });

  it('rejects data that is not one', () => {
    expect(() => parseUt(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]))).toThrow();
  });
});

// A two-pose bundle: pose 0 a body (frames: variant 0, 1, 2), pose 1 a
// weapon (frames: four looks), each in its own palette.
function poseTable(kinds: number[], pals: number[]): number[] {
  const n = kinds.length;
  const at = 0x20 + Math.ceil(n / 4) * 4;
  const out = [...u32(n), ...new Array(0x18).fill(0), ...u32(at), ...kinds];
  while (out.length < at) out.push(0);
  return [...out, ...pals];
}

function cellTable(cells: { pose: number; x: number; y: number; w: number; h: number; mirror?: boolean }[][]): number[] {
  const head = cells.length * 4;
  const bodies = cells.map((c) => [
    ...u16(c.length),
    ...c.flatMap((p) => [...u16(p.pose), ...u16(p.x & 0xffff), ...u16(p.y & 0xffff), ...u16(p.w), ...u16(p.h), ...u16(p.mirror ? 1 : 0), ...u16(0x400), ...u16(0x400)]),
  ]);
  const offs: number[] = [];
  let o = head;
  for (const b of bodies) {
    offs.push(o);
    o += b.length;
  }
  return [...offs.flatMap(u32), ...bodies.flat()];
}

function animTable(scripts: number[][]): number[] {
  const head = scripts.length * 4;
  const offs: number[] = [];
  let o = head;
  for (const s of scripts) {
    offs.push(o);
    o += s.length;
  }
  return [...offs.flatMap(u32), ...scripts.flat()];
}

const solid = (v: number) => [[v, v], [v, v]];
const full = [[15, 15], [15, 15]];
const BODY = ut(2, 2, [
  // One faint texel (alpha 4/15), which a cell leaves out.
  { ref: 0, ci: solid(1), mask: [[15, 15], [15, 4]] },
  { ref: 1, whole: true, ci: solid(2), mask: full },
  { ref: 2, whole: true, ci: solid(3), mask: full },
]);
const WEAPON = ut(2, 2, [0, 1, 2, 3].map((k) => ({ ref: k, whole: true, ci: solid(10 + k), mask: full })));
const CELLS = cellTable([
  [{ pose: 0, x: -2, y: -2, w: 2, h: 2 }, { pose: 1, x: 0, y: -4, w: 2, h: 2 }],
  [{ pose: 0, x: -1, y: -2, w: 2, h: 2, mirror: true }],
]);
// Slot 0 shows cell 0 and goes on to slot 1, which shows cell 1 twice
// after a step forward; slot 40 is an attack that lands on its second cell.
const scripts: number[][] = Array.from({ length: 41 }, () => [0]);
scripts[0] = [2, 0x01, 0, 4, 0x04, 1];
scripts[1] = [3, 0x0c, 2, 0, 0xfe, 0x01, 1, 3, 0x01, 1, 3];
scripts[40] = [5, 0x01, 0, 2, 0x12, 9, 9, 0x0b, 0x01, 1, 5, 0x01, 0, 3];
const ANIMS = animTable(scripts);
const BODY_COLOURS = { 1: RED, 2: GREEN, 3: BLUE };
const WEAPON_COLOURS = { 10: GREEN, 11: BLUE, 12: RED, 13: GREEN };
const PALETTES = [...palette(WEAPON_COLOURS), ...palette(BODY_COLOURS)];
// The weapon's palette is 0, the body's 1.
const POSES = poseTable([0, 1], [1, 0]);
const PARTS = [CELLS, ANIMS, POSES, PALETTES, BODY, WEAPON];

const bundle = () => bundleFromParts(1, PARTS.map((p) => new Uint8Array(p)));

describe('bundles', () => {
  it('splits the listed assets into tables, palettes and poses', () => {
    const b = bundle();
    expect(b.tables).toHaveLength(3);
    expect(b.palettes).toHaveLength(2);
    expect(b.poses).toHaveLength(2);
    expect(b.poseIds).toEqual([4, 5]);
  });

  it('reads each pose\'s kind and palette from the third table', () => {
    expect(poseInfo(new Uint8Array(POSES), 2)).toEqual({ kinds: [0, 1], palettes: [1, 0] });
    // A table for a different number of poses, or none, leaves the defaults.
    expect(poseInfo(new Uint8Array(POSES), 3)).toEqual({ kinds: [0, 0, 0], palettes: [0, 0, 0] });
    expect(poseInfo(undefined, 2)).toEqual({ kinds: [0, 0], palettes: [0, 0] });
  });

  it('dresses the body by variant and gives the weapon its player look', () => {
    const b = bundle();
    expect([0, 1, 2, 5].map((v) => poseFrame(b, 0, v))).toEqual([0, 1, 2, 2]);
    expect([0, 1, 2, 3].map((v) => poseFrame(b, 1, v))).toEqual([0, 0, 2, 2]);
  });
});

describe('cells', () => {
  it('reads parts with signed offsets, mirroring and scale', () => {
    const cells = parseCells(new Uint8Array(CELLS));
    expect(cells).toHaveLength(2);
    expect(cells[0][1]).toEqual({ pose: 1, x: 0, y: -4, width: 2, height: 2, mirrored: false, scaleX: 1, scaleY: 1 });
    expect(cells[1][0].mirrored).toBe(true);
    expect(cellBounds(cells[0])).toEqual({ left: -2, top: -4, right: 2, bottom: 0 });
  });

  it('draws each part in its own palette and the variant\'s frame', () => {
    const b = bundle();
    const cell = parseCells(new Uint8Array(CELLS))[0];
    const at = (c: ReturnType<typeof composeCell>, x: number, y: number) => [...c.px.slice((y * c.width + x) * 4, (y * c.width + x) * 4 + 3)];
    const v0 = composeCell(b, cell, 0);
    expect([v0.width, v0.height, v0.anchorX, v0.anchorY]).toEqual([4, 4, 2, 4]);
    expect(at(v0, 0, 3)).toEqual([255, 0, 0]); // body, variant 0: index 1 in the body palette
    expect(at(v0, 2, 0)).toEqual([0, 255, 0]); // weapon look 0: index 10 in the weapon palette
    const v1 = composeCell(b, cell, 1);
    expect(at(v1, 0, 3)).toEqual([0, 255, 0]); // enemy colours
    expect(at(v1, 2, 0)).toEqual([0, 255, 0]); // same weapon look
    const v2 = composeCell(b, cell, 2);
    expect(at(v2, 0, 3)).toEqual([0, 0, 255]);
    expect(at(v2, 2, 0)).toEqual([255, 0, 0]);
    expect(v0.px[(0 * 4 + 0) * 4 + 3]).toBe(0); // nothing drawn at the top left
    expect(v0.px[(3 * 4 + 1) * 4 + 3]).toBe(0); // the faint texel
    expect(v0.px[(3 * 4 + 0) * 4 + 3]).toBe(255);
  });
});

describe('animation scripts', () => {
  const anims = parseAnims(new Uint8Array(ANIMS));

  it('reads shows, moves, hits, links and cues', () => {
    expect(anims[0]).toEqual([{ op: 'show', cell: 0, ticks: 4 }, { op: 'next', anim: 1 }]);
    expect(anims[1][0]).toEqual({ op: 'move', dx: 2, dy: 0, dz: -2 });
    expect(anims[40]).toEqual([
      { op: 'show', cell: 0, ticks: 2 }, { op: 'cue', code: 0x12, a: 9, b: 9 }, { op: 'hit' }, { op: 'show', cell: 1, ticks: 5 },
      { op: 'show', cell: 0, ticks: 3 },
    ]);
  });

  it('plays a script on into the one it links to, carrying its moves', () => {
    expect(playScript(anims, 0)).toEqual([
      { cell: 0, ticks: 4, dx: 0, dz: 0, hit: false },
      { cell: 1, ticks: 3, dx: 2, dz: -2, hit: false },
      { cell: 1, ticks: 3, dx: 2, dz: -2, hit: false },
    ]);
  });

  it('marks the frame a blow lands on', () => {
    expect(playScript(anims, 40).map((f) => f.hit)).toEqual([false, true, false]);
  });

  it('builds clips, standing still for animations the bundle lacks', () => {
    const { clips, cells } = buildClips(bundle(), 0);
    expect(ANIM_SLOTS.idle).toContain(0);
    expect(clips.attack.frames.map((f) => f.hit)).toEqual([false, true, false]);
    expect(clips.idle.loop).toBe(true);
    expect(clips.fall.frames).toHaveLength(1);
    expect(clips.fall.loop).toBe(false);
    expect([...cells.keys()].sort()).toEqual([0, 1]);
  });
});

describe('the class sprite table', () => {
  it('splits each entry into a bundle and a variant', () => {
    const rom = new Uint8Array(SPRITE_TABLE_ROM + 16);
    rom.set([...u16(0x1009), ...u16(0x000a), ...u16(0x3009), ...u16(0x200a)], SPRITE_TABLE_ROM + 8);
    expect(decodeSpriteTable(rom, 2)[1]).toEqual([
      { bundle: 9, variant: 1 }, { bundle: 10, variant: 0 }, { bundle: 9, variant: 3 }, { bundle: 10, variant: 2 },
    ]);
  });
});

describe('the Soldier\'s stand-ins', () => {
  const ref = (bundle: number, variant: number) => ({ bundle, variant });

  it('recolours an entry for the other side', () => {
    expect(recolour(ref(9, 3), 0)).toEqual(ref(9, 2));
    expect(recolour(ref(9, 2), 1)).toEqual(ref(9, 3));
  });

  it('borrows the other side\'s art where one side has only the Soldier\'s', () => {
    // Drawn only in the enemy's entries...
    expect(ownSprites([ref(1, 0), ref(2, 0), ref(41, 3), ref(42, 3)], 99))
      .toEqual([ref(41, 2), ref(42, 2), ref(41, 3), ref(42, 3)]);
    // ...or only in the player's.
    expect(ownSprites([ref(155, 0), ref(156, 0), ref(1, 0), ref(2, 0)], 81))
      .toEqual([ref(155, 0), ref(156, 0), ref(155, 1), ref(156, 1)]);
  });

  it('leaves out a view neither side has', () => {
    expect(ownSprites([ref(2, 0), ref(89, 0), ref(1, 1), ref(2, 1)], 77)).toEqual([null, ref(89, 0), null, ref(89, 1)]);
    expect(ownSprites([ref(1, 0), ref(2, 0), ref(1, 0), ref(2, 0)], 130).every((x) => x === null)).toBe(true);
  });

  it('keeps the Soldier\'s own entries', () => {
    const row = [ref(1, 0), ref(2, 0), ref(1, 1), ref(2, 1)];
    expect(ownSprites(row, 1)).toEqual(row);
  });
});

describe('packed bundles', () => {
  it('unpack to the same bundle the ROM holds', () => {
    // A small asset store: the bundle's id list, raw, then each part, compressed.
    const ids = PARTS.map((_, i) => 0x100 + i * 0x2000);
    const listId = 0x40;
    const rom = new Uint8Array(ASSET_BASE + 0x100 + PARTS.length * 0x2000);
    const put = (id: number, payload: number[]) => rom.set([...u32(payload.length), ...payload], ASSET_BASE + id);
    put(listId, ids.flatMap(u32));
    PARTS.forEach((p, i) => put(ids[i], stored(p)));
    const direct = readBundle(rom, listId);
    const packed = unpackBundle(packBundle(rom, listId), 7);
    expect(packed.id).toBe(7);
    expect(packed.tables).toEqual(direct.tables);
    expect(packed.palettes).toEqual(direct.palettes);
    expect(packed.posePalettes).toEqual([1, 0]);
    expect(packed.poses.map((p) => p.frames.length)).toEqual([3, 4]);
  });

  it('refuses a file that is not one', () => {
    expect(() => unpackBundle(new Uint8Array(16))).toThrow();
  });
});
