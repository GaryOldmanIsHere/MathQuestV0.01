// A page for looking over the painted figures while working on them
// (npm run dev, then /tools/art-preview.html; ?classes=knight,witch picks
// some, ?anim=attack shows one animation, ?normals shows normal maps).
// Not part of the game's build.

import { allClasses, installDataset } from '../src/data/registry';
import { paintedSet } from '../src/art/sheet';
import { figureKindOf } from '../src/art/looks';
import { ANIMS } from '../src/gfx3d/sprites';
import type { SpriteImage } from '../src/gfx3d/sprites';

const q = new URLSearchParams(location.search);
const scale = Number(q.get('scale') ?? 3);
const want = q.get('classes')?.split(',');
// ?kind=rider shows one class of each kind asked for (the first few).
const kinds = q.get('kind')?.split(',');
const perKind = new Map<string, number>();
const anims = q.get('anim') ? [q.get('anim')!] : ANIMS;
const normals = q.has('normals');
void installDataset;

const out = document.getElementById('out')!;
const show = (img: SpriteImage, parent: HTMLElement) => {
  const c = document.createElement('canvas');
  const w = (img as HTMLCanvasElement).width;
  const h = (img as HTMLCanvasElement).height;
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img as CanvasImageSource, 0, 0, c.width, c.height);
  parent.append(c);
};
let shown = 0;
for (const def of allClasses()) {
  if (kinds) {
    const k = figureKindOf(def);
    if (!kinds.includes(k) || (perKind.get(k) ?? 0) >= Number(q.get('per') ?? 2)) continue;
    perKind.set(k, (perKind.get(k) ?? 0) + 1);
  } else if (want ? !want.includes(def.id) : !def.playable) continue;
  const set = paintedSet(def);
  if (!set) continue;
  const h = document.createElement('h2');
  h.textContent = `${def.name} (${def.id})`;
  out.append(h);
  for (const view of set.views) {
    for (const a of anims) {
      const row = document.createElement('div');
      row.className = 'row';
      for (const f of view.anims[a as keyof typeof view.anims].frames) show(normals && f.normal ? f.normal : f.image, row);
      out.append(row);
    }
  }
  shown++;
}
(window as unknown as { __done: number }).__done = shown;
