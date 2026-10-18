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
