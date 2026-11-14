// Ogre Battle 64's asset store and its LZ compression.
//
// An asset id names a ROM offset: (id & 0x0FFFFFFF) + 0x594250 holds a u32
// payload size, and the payload follows (func_8009DAF4, func_8009DBB8). A
// compressed payload starts with its decompressed size, then tokens, each
// introduced by a flag byte (func_8007A110; the recomp project's
// tools/ogrelz.py documents the same format):
//
//   b & 0x80  back-reference, length ((b >> 3) & 0xF) + 3, offset ((b & 7) << 8) | next
//   b & 0x40  literal run of (b & 0x3F) + 1 bytes
//   b & 0x20  zero run of (b & 0x1F) + 2
//   b & 0x10  long back-reference: two bytes hi, lo follow;
//             length 4 + (b & 0xF) + ((hi >> 2) & 0x30), offset ((hi & 0x3F) << 8) | lo
//   b == 0    far back-reference: n, hi, lo follow; length n + 5, offset (hi << 8) | lo
//   b == 1    0xFF run of next + 3
//   b == 2    zero run of next + 3
//
// Back-references copy from (output position - offset - 1), byte by byte, so
// overlapping copies repeat.

export const ASSET_BASE = 0x594250;

export function assetRom(id: number): number {
  return (id & 0x0fffffff) + ASSET_BASE;
}

function u32(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** An asset's payload as stored: raw tables are read this way. */
export function rawAsset(rom: Uint8Array, id: number): Uint8Array {
  const at = assetRom(id);
  const size = u32(rom, at);
  if (at + 4 + size > rom.length) throw new Error(`asset 0x${id.toString(16)} runs past the ROM`);
  return rom.subarray(at + 4, at + 4 + size);
}

export function decompress(src: Uint8Array, pos: number, limit = 0x400000): Uint8Array {
  const size = u32(src, pos);
  if (size === 0 || size > limit) throw new Error(`implausible size 0x${size.toString(16)}`);
  const out = new Uint8Array(size);
  let o = 0;
  let p = pos + 4;
  const copy = (off: number, len: number) => {
    let s = o - off - 1;
    if (s < 0) throw new Error('back-reference before the start');
    for (let i = 0; i < len && o < size; i++) out[o++] = out[s++];
  };
  while (o < size) {
    if (p >= src.length) throw new Error('ran off the end');
    const b = src[p++];
    if (b & 0x80) {
      copy(((b & 7) << 8) | src[p++], ((b >> 3) & 0xf) + 3);
    } else if (b & 0x40) {
      const n = (b & 0x3f) + 1;
      for (let i = 0; i < n && o < size; i++) out[o++] = src[p++];
    } else if (b & 0x20) {
      o = Math.min(size, o + (b & 0x1f) + 2); // zeros: the buffer starts zeroed
    } else if (b & 0x10) {
      const hi = src[p++];
      const lo = src[p++];
      copy(((hi & 0x3f) << 8) | lo, 4 + (b & 0xf) + ((hi >> 2) & 0x30));
    } else if (b === 0) {
      const n = src[p++];
      const hi = src[p++];
      const lo = src[p++];
      copy((hi << 8) | lo, n + 5);
    } else if (b === 1) {
      const n = src[p++] + 3;
      for (let i = 0; i < n && o < size; i++) out[o++] = 0xff;
    } else if (b === 2) {
      o = Math.min(size, o + src[p++] + 3);
    } else {
      throw new Error(`unknown token 0x${b.toString(16)}`);
    }
  }
  return out;
}

/** A compressed asset, decompressed. */
export function lzAsset(rom: Uint8Array, id: number): Uint8Array {
  return decompress(rom, assetRom(id) + 4);
}
