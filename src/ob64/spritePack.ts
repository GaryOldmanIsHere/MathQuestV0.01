import { decompress, rawAsset } from './lz';
import { bundleFromParts, bundlePartIds } from './sprites';
import type { SpriteBundle } from './sprites';

// A sprite bundle's assets copied out of the ROM as stored (still
// compressed), so the browser can fetch one bundle when a battle needs it
// and decompress it with the same code the extractor uses.
//
//   'OBSB'  u16 version 1  u16 part count
//   per part: u32 asset id, u32 length, then the stored payload
//            ([u32 decompressed size][LZ tokens]), padded to 4 bytes.

const MAGIC = 0x4f425342; // 'OBSB'

export function packBundle(rom: Uint8Array, listId: number): Uint8Array {
  const ids = bundlePartIds(rom, listId);
  const payloads = ids.map((id) => rawAsset(rom, id));
  const size = 8 + payloads.reduce((n, p) => n + 8 + Math.ceil(p.length / 4) * 4, 0);
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC);
  view.setUint16(4, 1);
  view.setUint16(6, ids.length);
  let o = 8;
  ids.forEach((id, i) => {
    view.setUint32(o, id);
    view.setUint32(o + 4, payloads[i].length);
    out.set(payloads[i], o + 8);
    o += 8 + Math.ceil(payloads[i].length / 4) * 4;
  });
  return out;
}

export function unpackBundle(bytes: Uint8Array, id = 0): SpriteBundle {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0) !== MAGIC) throw new Error('not a sprite bundle');
  const count = view.getUint16(6);
  const parts: Uint8Array[] = [];
  let o = 8;
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(o + 4);
    parts.push(decompress(bytes, o + 8));
    o += 8 + Math.ceil(len / 4) * 4;
  }
  return bundleFromParts(id, parts);
}
