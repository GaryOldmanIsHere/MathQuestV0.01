import { lzAsset, rawAsset } from './lz';

// Ogre Battle 64's unit sprites.
//
// A unit's art is a bundle: a raw asset listing other asset ids. The first
// few are tables (the poses' placement and sequencing and what each pose
// is), then the palettes (each 512 bytes of RGBA5551), then one "UT"
// container per pose.
//
// A UT container ("55 54"), as the game's decoder reads it (func_8019A1B4,
// func_8019ABC4 in overlay C of the recomp project's disassembly):
//
//   +0 'UT'  +2 frame count  +3 flags  +4 u16 width  +6 u16 height
//   flags: 0x4 colour is CI8, 0x2 colour is RGBA32 (else RGBA16);
//          0x1 the mask is I4 (else I8)
//   then per frame an 8-byte header (+2 reference frame, +3 frame flags,
//   +4 a byte the game passes on) and its blocks:
//     frame flags: 1 colour block, 2 mask block, 4 an own 0x200-byte
//     palette, 8 stored whole rather than as a difference.
//   A frame whose reference is another frame stores its difference from it:
//   bytewise (reference - stored) for CI8 and I8, per nibble for I4.
//
// Rows are padded to 8 bytes: a CI8 row of w texels takes w rounded up to 8
// bytes, an I4 mask row ceil(w/2) rounded up to 8. (Measured: every
// container's blocks then sum to its length exactly.)

export interface UtFrame {
  /** Palette indices (CI8) or RGBA16 / RGBA32 texels, row-padded. */
  colour: Uint8Array | null;
  /** Mask: I4 nibbles or I8 bytes, row-padded. */
  mask: Uint8Array | null;
  /** The frame's own palette, when it carries one. */
  palette: Uint8Array | null;
  ref: number;
  flags: number;
  extra: number;
}

export interface UtContainer {
  width: number;
  height: number;
  format: 'ci8' | 'rgba16' | 'rgba32';
  maskI4: boolean;
  colourStride: number;
  maskStride: number;
  frames: UtFrame[];
}

const roundUp = (n: number, m: number) => Math.ceil(n / m) * m;

export function isUt(d: Uint8Array): boolean {
  return d.length >= 8 && d[0] === 0x55 && d[1] === 0x54;
}

export function parseUt(d: Uint8Array): UtContainer {
  if (!isUt(d)) throw new Error('not a UT container');
  const count = d[2];
  const flags = d[3];
  const width = (d[4] << 8) | d[5];
  const height = (d[6] << 8) | d[7];
  const format = flags & 4 ? 'ci8' : flags & 2 ? 'rgba32' : 'rgba16';
  const maskI4 = (flags & 1) !== 0;
  const colourStride = format === 'ci8' ? roundUp(width, 8) : format === 'rgba16' ? roundUp(width, 4) * 2 : roundUp(width, 2) * 4;
  const maskStride = maskI4 ? roundUp(Math.ceil(width / 2), 8) : roundUp(width, 8);
  const frames: UtFrame[] = [];
  let p = 8;
  for (let k = 0; k < count; k++) {
    const ref = d[p + 2];
    const fflags = d[p + 3];
    const extra = d[p + 4];
    p += 8;
    let colour: Uint8Array | null = null;
    let mask: Uint8Array | null = null;
    let palette: Uint8Array | null = null;
    if (fflags & 1) {
      colour = d.slice(p, p + colourStride * height);
      p += colourStride * height;
    }
    if (fflags & 2) {
      mask = d.slice(p, p + maskStride * height);
      p += maskStride * height;
    }
    if (fflags & 4) {
      palette = d.slice(p, p + 0x200);
      p += 0x200;
    }
    frames.push({ colour, mask, palette, ref, flags: fflags, extra });
  }
  if (p > d.length) throw new Error('UT container shorter than its frames');
  // Rebuild difference frames from their reference.
  frames.forEach((f, k) => {
    if (f.ref === k || f.flags & 8 || f.ref >= frames.length) return;
    const r = frames[f.ref];
    if (f.colour && r.colour) {
      for (let i = 0; i < f.colour.length; i++) {
        f.colour[i] = format === 'rgba32' ? r.colour[i] ^ f.colour[i] : (r.colour[i] - f.colour[i]) & 0xff;
      }
    }
    if (f.mask && r.mask) {
      for (let i = 0; i < f.mask.length; i++) {
        if (maskI4) {
          const hi = ((r.mask[i] >> 4) - (f.mask[i] >> 4)) & 15;
          const lo = ((r.mask[i] & 15) - (f.mask[i] & 15)) & 15;
          f.mask[i] = (hi << 4) | lo;
        } else {
          f.mask[i] = (r.mask[i] - f.mask[i]) & 0xff;
        }
      }
    }
  });
  return { width, height, format, maskI4, colourStride, maskStride, frames };
}

/** RGBA5551 big-endian, as the N64 stores colour. */
export function rgba5551(v: number): [number, number, number, number] {
  const c5 = (x: number) => (x << 3) | (x >> 2);
  return [c5((v >> 11) & 31), c5((v >> 6) & 31), c5((v >> 1) & 31), v & 1 ? 255 : 0];
}

export function decodePalette(b: Uint8Array): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < b.length; i += 2) out.push(rgba5551((b[i] << 8) | b[i + 1]));
  return out;
}

/** One frame as straight RGBA (width * height * 4), alpha from the mask. */
export function frameRgba(ut: UtContainer, f: UtFrame, palette: [number, number, number, number][]): Uint8ClampedArray {
  const { width: w, height: h } = ut;
  const px = new Uint8ClampedArray(w * h * 4);
  const pal = f.palette ? decodePalette(f.palette) : palette;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 255;
      if (f.colour) {
        if (ut.format === 'ci8') {
          [r, g, b] = pal[f.colour[y * ut.colourStride + x]] ?? [255, 0, 255, 255];
        } else if (ut.format === 'rgba16') {
          const o = y * ut.colourStride + x * 2;
          [r, g, b, a] = rgba5551((f.colour[o] << 8) | f.colour[o + 1]);
        } else {
          const o = y * ut.colourStride + x * 4;
          [r, g, b, a] = [f.colour[o], f.colour[o + 1], f.colour[o + 2], f.colour[o + 3]];
        }
      }
      if (f.mask) {
        if (ut.maskI4) {
          const m = f.mask[y * ut.maskStride + (x >> 1)];
          a = ((x & 1) === 0 ? m >> 4 : m & 15) * 17;
        } else {
          a = f.mask[y * ut.maskStride + x];
        }
      }
      const o = (y * w + x) * 4;
      px[o] = r;
      px[o + 1] = g;
      px[o + 2] = b;
      px[o + 3] = a;
    }
  }
  return px;
}

/** A bundle: the asset ids it lists, split into tables, palettes and poses. */
export interface SpriteBundle {
  id: number;
  tables: Uint8Array[];
  /** One or more 256-colour palettes: one bundle can dress several classes. */
  palettes: [number, number, number, number][][];
  poses: UtContainer[];
  poseIds: number[];
  /** Which of the palettes each pose is drawn in. */
  posePalettes: number[];
  /** What each pose is: 0 the body, 1 the weapon (one frame per weapon), 2 an extra. */
  poseKinds: number[];
}

function idsIn(list: Uint8Array): number[] {
  const out: number[] = [];
  for (let i = 0; i + 3 < list.length; i += 4) {
    out.push(((list[i] << 24) | (list[i + 1] << 16) | (list[i + 2] << 8) | list[i + 3]) >>> 0);
  }
  return out;
}

/** The master list of unit bundles: a raw asset of bundle ids. */
export function readIdList(rom: Uint8Array, id: number): number[] {
  return idsIn(rawAsset(rom, id));
}

export function readBundle(rom: Uint8Array, id: number): SpriteBundle {
  return bundleFromParts(id, idsIn(rawAsset(rom, id)).map((sub) => lzAsset(rom, sub)));
}

/** A bundle from its listed assets, already decompressed, in list order. */
export function bundleFromParts(id: number, parts: Uint8Array[]): SpriteBundle {
  const tables: Uint8Array[] = [];
  const poses: UtContainer[] = [];
  const poseIds: number[] = [];
  parts.forEach((d, i) => {
    if (isUt(d)) {
      poses.push(parseUt(d));
      poseIds.push(i);
    } else {
      tables.push(d);
    }
  });
  // The palettes are the last table before the poses: a whole number of
  // 0x200-byte, 256-colour palettes.
  const palettes: [number, number, number, number][][] = [];
  const last = tables[tables.length - 1];
  if (last && last.length % 0x200 === 0) {
    tables.pop();
    for (let o = 0; o < last.length; o += 0x200) palettes.push(decodePalette(last.subarray(o, o + 0x200)));
  }
  const info = poseInfo(tables[2], poses.length);
  return { id, tables, palettes, poses, poseIds, posePalettes: info.palettes, poseKinds: info.kinds };
}

/**
 * The bundle's third table describes its poses: +0 u32 pose count, then at
 * +0x20 a byte per pose saying what it is (0 body, 1 weapon, 2 extra), and
 * at the offset in +0x1c a byte per pose giving its palette (each part of a
 * figure, weapon, body, cloak, has colours of its own). Without the table,
 * every pose is body drawn in the first palette.
 */
export function poseInfo(t: Uint8Array | undefined, count: number): { kinds: number[]; palettes: number[] } {
  const kinds = new Array<number>(count).fill(0);
  const palettes = new Array<number>(count).fill(0);
  if (!t || t.length < 0x20) return { kinds, palettes };
  const u32 = (o: number) => ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0;
  const n = u32(0);
  const at = u32(0x1c);
  if (n !== count || at < 0x20 + n || at + n > t.length) return { kinds, palettes };
  for (let i = 0; i < n; i++) {
    kinds[i] = t[0x20 + i];
    palettes[i] = t[at + i];
  }
  return { kinds, palettes };
}
/** The asset ids a bundle lists, for copying its stored bytes out. */
export function bundlePartIds(rom: Uint8Array, id: number): number[] {
  return idsIn(rawAsset(rom, id));
}

// --------------------------------------------------------------- cells --
//
// The bundle's first table places pose images into "cells", one drawing of
// the unit: a list of offsets, then per cell a u16 part count and per part
// 16 bytes: u16 pose, s16 x, s16 y (the image's top-left from the unit's
// feet), u16 width, u16 height, u16 flags (1 = mirrored), u16 x scale,
// u16 y scale (0x400 = 1).
//
// The second holds the animation scripts, one per animation slot, each a
// count of instructions:
//   01 cell ticks     show a cell for so many ticks
//   0C dx dy dz       move the unit (signed bytes)
//   0B                the blow lands here
//   04 n              go on to animation n
//   12 a b, 14 a b    two-byte cues (sound and effects; not acted on here)

export interface CellPart {
  pose: number;
  x: number;
  y: number;
  width: number;
  height: number;
  mirrored: boolean;
  scaleX: number;
  scaleY: number;
}

export type AnimStep =
  | { op: 'show'; cell: number; ticks: number }
  | { op: 'move'; dx: number; dy: number; dz: number }
  | { op: 'hit' }
  | { op: 'next'; anim: number }
  | { op: 'cue'; code: number; a: number; b: number };

function be16(t: Uint8Array, o: number): number {
  return (t[o] << 8) | t[o + 1];
}

function s16(t: Uint8Array, o: number): number {
  const v = be16(t, o);
  return v >= 0x8000 ? v - 0x10000 : v;
}

const s8 = (v: number) => (v >= 0x80 ? v - 0x100 : v);

/** A table that starts with a list of u32 offsets into itself: the first offset ends the list. */
export function offsetList(t: Uint8Array): number[] {
  if (t.length < 4) return [];
  const read = (o: number) => ((t[o] << 24) | (t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]) >>> 0;
  const first = read(0);
  if (first % 4 || first > t.length) return [];
  const out: number[] = [];
  for (let o = 0; o < first; o += 4) out.push(read(o));
  return out;
}

export function parseCells(t: Uint8Array): CellPart[][] {
  return offsetList(t).map((o) => {
    const count = be16(t, o);
    const parts: CellPart[] = [];
    for (let k = 0; k < count && o + 2 + k * 16 + 16 <= t.length; k++) {
      const p = o + 2 + k * 16;
      parts.push({
        pose: be16(t, p), x: s16(t, p + 2), y: s16(t, p + 4), width: be16(t, p + 6), height: be16(t, p + 8),
        mirrored: (be16(t, p + 10) & 1) === 1, scaleX: be16(t, p + 12) / 0x400, scaleY: be16(t, p + 14) / 0x400,
      });
    }
    return parts;
  });
}

const OP_SIZE: Record<number, number> = { 0x01: 3, 0x0c: 4, 0x0b: 1, 0x04: 2, 0x12: 3, 0x14: 3 };

export function parseAnims(t: Uint8Array): AnimStep[][] {
  const offs = offsetList(t);
  return offs.map((o, i) => {
    const end = offs[i + 1] ?? t.length;
    const count = t[o];
    const steps: AnimStep[] = [];
    let p = o + 1;
    for (let k = 0; k < count && p < end; k++) {
      const op = t[p];
      const size = OP_SIZE[op];
      if (!size) break; // an instruction not yet understood: stop reading this script
      if (op === 0x01) steps.push({ op: 'show', cell: t[p + 1], ticks: t[p + 2] });
      else if (op === 0x0c) steps.push({ op: 'move', dx: s8(t[p + 1]), dy: s8(t[p + 2]), dz: s8(t[p + 3]) });
      else if (op === 0x0b) steps.push({ op: 'hit' });
      else if (op === 0x04) steps.push({ op: 'next', anim: t[p + 1] });
      else steps.push({ op: 'cue', code: op, a: t[p + 1], b: t[p + 2] });
      p += size;
    }
    return steps;
  });
}

/** The pixel box a cell covers, relative to the unit's feet. */
export function cellBounds(cell: CellPart[]): { left: number; top: number; right: number; bottom: number } {
  if (!cell.length) return { left: 0, top: 0, right: 1, bottom: 1 };
  return {
    left: Math.min(...cell.map((p) => p.x)),
    top: Math.min(...cell.map((p) => p.y)),
    right: Math.max(...cell.map((p) => p.x + Math.round(p.width * p.scaleX))),
    bottom: Math.max(...cell.map((p) => p.y + Math.round(p.height * p.scaleY))),
  };
}

/**
 * Which frame of a pose dresses a figure. A bundle draws several classes:
 * its body poses hold a frame per class and side (the class table's
 * variant: 0 and 1 the first class in player and enemy colours, 2 and 3
 * the next, and so on), its weapon poses a frame per weapon look. Which
 * look goes with which weapon item is not known, so a figure carries the
 * one its class's player variant shows.
 */
export function poseFrame(bundle: SpriteBundle, pose: number, variant: number): number {
  const n = bundle.poses[pose]?.frames.length ?? 1;
  const want = bundle.poseKinds[pose] === 1 ? variant & ~1 : variant;
  return Math.min(want, n - 1);
}

/**
 * Draw a cell: its parts, in order, into one RGBA image, each in its own
 * palette and in the variant's frame. Returns the image and where the
 * unit's feet fall in it.
 */
export function composeCell(
  bundle: SpriteBundle, cell: CellPart[], variant = 0,
): { width: number; height: number; px: Uint8ClampedArray; anchorX: number; anchorY: number } {
  const box = cellBounds(cell);
  const width = Math.max(1, box.right - box.left);
  const height = Math.max(1, box.bottom - box.top);
  const px = new Uint8ClampedArray(width * height * 4);
  for (const part of cell) {
    const ut = bundle.poses[part.pose];
    if (!ut) continue;
    const f = ut.frames[poseFrame(bundle, part.pose, variant)];
    const palette = bundle.palettes[bundle.posePalettes[part.pose]] ?? bundle.palettes[0] ?? [];
    const src = frameRgba(ut, f, palette);
    const dw = Math.round(part.width * part.scaleX);
    const dh = Math.round(part.height * part.scaleY);
    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(ut.width - 1, Math.floor(((part.mirrored ? dw - 1 - x : x) * ut.width) / dw));
        const sy = Math.min(ut.height - 1, Math.floor((y * ut.height) / dh));
        const s = (sy * ut.width + sx) * 4;
        if (src[s + 3] < 128) continue;
        const dx = part.x - box.left + x;
        const dy = part.y - box.top + y;
        if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
        const d = (dy * width + dx) * 4;
        px[d] = src[s];
        px[d + 1] = src[s + 1];
        px[d + 2] = src[s + 2];
        px[d + 3] = 255;
      }
    }
  }
  return { width, height, px, anchorX: -box.left, anchorY: -box.top };
}

// ------------------------------------------------------- class -> sprites --

/** The master list of sprite bundles (a raw asset; bundles are numbered from 1). */
export const BUNDLE_LIST_ID = 0x3b6cd0;

/**
 * Which bundles each class is drawn with: four u16 per class (class * 4 +
 * side * 2 + view), low 12 bits the bundle number, high 4 the variant (the
 * body frame: see poseFrame). side 0 is the player's colours, 1 the
 * enemy's; view 0 is the unit
 * seen from behind, 1 from the front. Read by the routine at ROM 0x6FE80
 * (it indexes `class * 72` into the class table, then this table at
 * `class * 4 + a * 2 + b`, masking 0x0FFF), and located in the ROM by its
 * contents.
 */
export const SPRITE_TABLE_ROM = 0x8a99ae;

export interface SpriteRef {
  bundle: number;
  variant: number;
}

/** A sprite entry in the other side's colours (the variants come in pairs: player even, enemy odd). */
export function recolour(r: SpriteRef, side: number): SpriteRef {
  return { bundle: r.bundle, variant: side === 0 ? r.variant & ~1 : r.variant | 1 };
}

/**
 * A class's entries with the Soldier's stand-ins taken out. Where a class
 * has no art of its own for a side or a view, the table holds the Soldier's
 * bundles (1 and 2) instead: story classes are drawn only in the enemy's
 * entries, or only in the player's; the Giant only from the front. Such an
 * entry takes the other side's, recoloured; one neither side has is null.
 */
export function ownSprites(row: SpriteRef[], classId: number): (SpriteRef | null)[] {
  const standIn = (r: SpriteRef) => classId !== 1 && r.bundle <= 2;
  return row.map((r, i) => {
    if (!standIn(r)) return r;
    const other = row[i ^ 2];
    return standIn(other) ? null : recolour(other, i >> 1);
  });
}

export function decodeSpriteTable(rom: Uint8Array, classes: number): SpriteRef[][] {
  const out: SpriteRef[][] = [];
  for (let c = 0; c < classes; c++) {
    const row: SpriteRef[] = [];
    for (let i = 0; i < 4; i++) {
      const v = be16(rom, SPRITE_TABLE_ROM + c * 8 + i * 2);
      row.push({ bundle: v & 0x0fff, variant: v >> 12 });
    }
    out.push(row);
  }
  return out;
}

/**
 * The game's animation slots that Palatinus's six animations come from,
 * in order of preference (a slot some bundles leave empty falls through to
 * the next). Read off the scripts: 0..4 stand and breathe, 5 walks, 29..30
 * fall and lie, 32..36 flinch, 40..43 the two melee attacks (each marks
 * the moment the blow lands), 46 the raised-weapon special.
 */
export const ANIM_SLOTS = {
  idle: [1, 0, 2, 3, 4],
  walk: [5, 11],
  attack: [40, 42, 41, 43],
  cast: [46, 42, 40],
  hit: [32, 34, 36, 33],
  fall: [30, 29],
} as const;

/** One step of a played-out animation: a cell held for a time, offset by the script's moves. */
export interface AnimFrame {
  cell: number;
  ticks: number;
  dx: number;
  dz: number;
  hit: boolean;
}

/**
 * Play an animation script into frames, following "go on to" links into
 * other scripts until it loops back or ends (at most a few hops).
 */
export function playScript(anims: AnimStep[][], slot: number, maxHops = 3): AnimFrame[] {
  const out: AnimFrame[] = [];
  let dx = 0;
  let dz = 0;
  let hit = false;
  const seen = new Set<number>();
  let cur = slot;
  for (let hop = 0; hop <= maxHops && anims[cur] && !seen.has(cur); hop++) {
    seen.add(cur);
    let next: number | null = null;
    for (const s of anims[cur]) {
      if (s.op === 'move') {
        dx += s.dx;
        dz += s.dz;
      } else if (s.op === 'hit') {
        hit = true;
      } else if (s.op === 'show') {
        if (s.ticks > 0) out.push({ cell: s.cell, ticks: s.ticks, dx, dz, hit });
        hit = false;
      } else if (s.op === 'next') {
        next = s.anim;
      }
    }
    // An idle script hands on to its looping partner; attacks end where they end.
    if (next === null || hop > 0) break;
    cur = next;
  }
  return out;
}

/**
 * How long a script tick lasts. The game runs at 30 frames a second and
 * counts its scripts in frames; Palatinus plays them half again as fast,
 * which keeps an auto-battle of fifteen actions brisk.
 */
export const TICK_MS = 1000 / 45;

export type ClipName = keyof typeof ANIM_SLOTS;

export interface ComposedCell {
  width: number;
  height: number;
  px: Uint8ClampedArray;
  anchorX: number;
  anchorY: number;
}

export interface ClipData {
  frames: { cell: number; ms: number; dx: number; dz: number; hit: boolean }[];
  loop: boolean;
}

/**
 * Everything one view of a unit needs: the six animations as frame lists,
 * and the cells they use, drawn as one variant.
 */
export function buildClips(bundle: SpriteBundle, variant: number): { clips: Record<ClipName, ClipData>; cells: Map<number, ComposedCell> } {
  const cellList = parseCells(bundle.tables[0] ?? new Uint8Array());
  const anims = parseAnims(bundle.tables[1] ?? new Uint8Array());
  const cells = new Map<number, ComposedCell>();
  const clips = {} as Record<ClipName, ClipData>;
  let fallback: ClipData | null = null;
  for (const name of Object.keys(ANIM_SLOTS) as ClipName[]) {
    let frames: AnimFrame[] = [];
    for (const slot of ANIM_SLOTS[name]) {
      frames = playScript(anims, slot).filter((f) => cellList[f.cell]?.length);
      if (frames.length) break;
    }
    if (frames.length) {
      clips[name] = {
        frames: frames.map((f) => ({ cell: f.cell, ms: f.ticks * TICK_MS, dx: f.dx, dz: f.dz, hit: f.hit })),
        loop: name === 'idle' || name === 'walk',
      };
      fallback ??= clips[name];
    }
  }
  // A bundle missing an animation stands still for it.
  for (const name of Object.keys(ANIM_SLOTS) as ClipName[]) {
    if (!clips[name]) {
      const still = (clips.idle ?? fallback)?.frames[0] ?? { cell: 0, ms: 300, dx: 0, dz: 0, hit: false };
      clips[name] = { frames: [{ ...still, ms: 300, hit: name === 'attack' || name === 'cast' }], loop: false };
    }
  }
  for (const clip of Object.values(clips)) {
    for (const f of clip.frames) {
      if (!cells.has(f.cell) && cellList[f.cell]) cells.set(f.cell, composeCell(bundle, cellList[f.cell], variant));
    }
  }
  return { clips, cells };
}
