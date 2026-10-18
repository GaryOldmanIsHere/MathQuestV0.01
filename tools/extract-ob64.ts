// Extract Ogre Battle 64's data tables from your own ROM into public/ob64/.
//
//   npm run extract:ob64 -- path/to/ogre-battle-64.z64
//
// The output is generated from the ROM on your machine and is git-ignored:
// it is copyrighted game data and must never be committed. Without it the
// game runs on its original built-in data.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeAll, OB64_SHA1 } from '../src/ob64/decode';
import { BUNDLE_LIST_ID, buildClips, decodeSpriteTable, ownSprites, readBundle, readIdList, recolour, TICK_MS } from '../src/ob64/sprites';
import type { SpriteRef } from '../src/ob64/sprites';
import { packBundle } from '../src/ob64/spritePack';
import { writePng } from './png';

function toBigEndian(rom: Uint8Array): Uint8Array {
  const magic = (rom[0] << 24 | rom[1] << 16 | rom[2] << 8 | rom[3]) >>> 0;
  if (magic === 0x80371240) return rom; // .z64, already big-endian
  const out = new Uint8Array(rom.length);
  if (magic === 0x37804012) {
    // .v64: byte-swapped halfwords
    for (let i = 0; i < rom.length; i += 2) { out[i] = rom[i + 1]; out[i + 1] = rom[i]; }
    return out;
  }
  if (magic === 0x40123780) {
    // .n64: little-endian words
    for (let i = 0; i < rom.length; i += 4) {
      out[i] = rom[i + 3]; out[i + 1] = rom[i + 2]; out[i + 2] = rom[i + 1]; out[i + 3] = rom[i];
    }
    return out;
  }
  throw new Error(`Not an N64 ROM (header 0x${magic.toString(16)}).`);
}

const romPath = process.argv[2];
if (!romPath) {
  console.error('usage: npm run extract:ob64 -- <ogre-battle-64.z64|.n64|.v64>');
  process.exit(1);
}

const rom = toBigEndian(new Uint8Array(readFileSync(resolve(romPath))));
const sha1 = createHash('sha1').update(rom).digest('hex');
if (sha1 !== OB64_SHA1) {
  console.error(`This is not the supported dump.\n  got      ${sha1}\n  expected ${OB64_SHA1}  (Ogre Battle 64, USA Rev A)`);
  process.exit(1);
}

const data = decodeAll(rom, sha1);
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'ob64');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'data.json'), JSON.stringify(data));

console.log(`Extracted from ${data.source.title} (${sha1.slice(0, 8)}…):`);
console.log(`  ${data.classes.length} classes, ${data.attacks.length} attacks, ${data.elements.length} elements`);
console.log(`  ${data.items?.length ?? 0} pieces of equipment, ${data.consumables?.length ?? 0} consumables and key items`);
console.log(`  -> ${join('public', 'ob64', 'data.json')} (git-ignored)`);

// ---- Unit sprites ---------------------------------------------------------
// Each class's bundles (seen from behind and from the front) are copied out
// as stored, for the browser to unpack when a battle needs them, and every
// class's standing front pose is drawn into one portrait atlas for menus.

const spriteDir = join(outDir, 'sprites');
mkdirSync(spriteDir, { recursive: true });
const list = readIdList(rom, BUNDLE_LIST_ID);
const table = decodeSpriteTable(rom, data.classes.length);
const usable = (r: SpriteRef) => r.bundle > 0 && r.bundle <= list.length;
const bundles = new Set<number>();
const classes: Record<number, (SpriteRef | null)[]> = {};
table.forEach((row, classId) => {
  if (classId === 0 || !row.every(usable)) return;
  const r = ownSprites(row, classId);
  if (r.every((x) => !x)) return;
  classes[classId] = r;
  r.forEach((x) => x && bundles.add(x.bundle));
});
let written = 0;
let bytes = 0;
for (const n of bundles) {
  try {
    const packed = packBundle(rom, list[n - 1]);
    writeFileSync(join(spriteDir, `b${n}.bin`), packed);
    written++;
    bytes += packed.length;
  } catch {
    // An empty slot in the master list: entries pointing at it are left out.
    for (const [id, r] of Object.entries(classes)) {
      const kept = r.map((x) => (x?.bundle === n ? null : x));
      if (kept.every((x) => !x)) delete classes[Number(id)];
      else classes[Number(id)] = kept;
    }
  }
}

// Portraits: the first standing frame from the front (or, without one, from
// behind), in the player's colours.
interface Rect { x: number; y: number; w: number; h: number; anchorX: number; anchorY: number }
const portraits: Record<number, Rect> = {};
const shots: { id: number; w: number; h: number; px: Uint8ClampedArray; anchorX: number; anchorY: number }[] = [];
const bundleCache = new Map<number, ReturnType<typeof readBundle>>();
for (const [id, r] of Object.entries(classes)) {
  const front = r[1] ?? r[0] ?? recolour((r[3] ?? r[2])!, 0);
  let b = bundleCache.get(front.bundle);
  if (!b) {
    b = readBundle(rom, list[front.bundle - 1]);
    bundleCache.set(front.bundle, b);
  }
  const { clips, cells } = buildClips(b, front.variant);
  const cell = cells.get(clips.idle.frames[0].cell);
  if (cell) shots.push({ id: Number(id), w: cell.width, h: cell.height, px: cell.px, anchorX: cell.anchorX, anchorY: cell.anchorY });
}
const ATLAS_W = 1024;
let x = 0;
let y = 0;
let rowH = 0;
for (const s of shots.sort((a, b) => b.h - a.h)) {
  if (x + s.w > ATLAS_W) {
    x = 0;
    y += rowH + 1;
    rowH = 0;
  }
  portraits[s.id] = { x, y, w: s.w, h: s.h, anchorX: s.anchorX, anchorY: s.anchorY };
  x += s.w + 1;
  rowH = Math.max(rowH, s.h);
}
const atlasH = y + rowH;
const atlas = new Uint8ClampedArray(ATLAS_W * atlasH * 4);
for (const s of shots) {
  const p = portraits[s.id];
  for (let row = 0; row < s.h; row++) atlas.set(s.px.subarray(row * s.w * 4, (row + 1) * s.w * 4), ((p.y + row) * ATLAS_W + p.x) * 4);
}
writePng(join(spriteDir, 'portraits.png'), ATLAS_W, atlasH, atlas);
writeFileSync(join(spriteDir, 'manifest.json'), JSON.stringify({ version: 3, tickMs: TICK_MS, classes, portraits }));
console.log(`  ${Object.keys(classes).length} classes' sprites in ${written} bundles (${(bytes / 1e6).toFixed(1)} MB), ${shots.length} portraits`);
console.log(`  -> ${join('public', 'ob64', 'sprites')} (git-ignored)`);
