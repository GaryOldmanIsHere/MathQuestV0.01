// A page for setting the painted figures beside Ogre Battle 64's own, where
// those were extracted (npm run extract:ob64), while working on the painted
// style: npm run dev, then /tools/style-compare.html. ?classes=Knight,Witch
// picks classes by name, ?anim=attack an animation, ?only=ours or ?only=theirs
// one side, ?seen=back the back view. Not part of the game's build.

import { allClasses, installDataset } from '../src/data/registry';
import { withExpansion } from '../src/expansion';
import { convertDataset } from '../src/ob64/convert';
import type { Ob64Data } from '../src/ob64/decode';
import { loadOb64Sprites, ob64SpriteSet, prepareSprites } from '../src/gfx3d/ob64Sprites';
import { paintedSet } from '../src/art/sheet';
import type { Anim, SpriteFrame, SpriteSet } from '../src/gfx3d/sprites';

const q = new URLSearchParams(location.search);
const names = (q.get('classes') ?? 'Fighter,Knight,Archer,Wizard,Cleric,Hellhound').split(',');
const anim = (q.get('anim') ?? 'idle') as Anim;
const only = q.get('only');
const seen = q.get('seen') ?? 'front';
/** Screen pixels per world unit: both sets are drawn to the same height. */
const ppu = Number(q.get('ppu') ?? 110);
const at = Number(q.get('frame') ?? 0);

const out = document.getElementById('out')!;

function draw(set: SpriteSet, parent: HTMLElement, smooth: boolean): void {
  const view = set.views.find((v) => v.seen === seen) ?? set.views[0];
  const frames = view.anims[anim].frames;
  const f: SpriteFrame = frames[Math.min(at, frames.length - 1)];
  const img = f.image as HTMLCanvasElement;
  const k = ppu / set.pixelsPerUnit;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  parent.append(c);
}

async function main(): Promise<void> {
  const res = await fetch('/ob64/data.json');
  const theirs = res.ok && res.headers.get('content-type')?.includes('json');
  if (theirs) installDataset(withExpansion(convertDataset((await res.json()) as Ob64Data)));
  await loadOb64Sprites();
  const defs = names.flatMap((n) => {
    const d = allClasses().find((c) => c.name.toLowerCase() === n.toLowerCase() || c.id === n.toLowerCase());
    return d ? [d] : [];
  });
  await prepareSprites(defs.map((def) => ({ def, side: 'player' as const })));
  out.style.setProperty('--cols', String(Number(q.get('cols') ?? defs.length)));
  for (const def of defs) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const pair = document.createElement('div');
    pair.className = 'pair';
    const ob = ob64SpriteSet(def, 'player');
    if (ob && only !== 'ours') draw(ob, pair, false);
    if (only !== 'theirs') draw(paintedSet(def), pair, true);
    const label = document.createElement('small');
    label.textContent = def.name;
    cell.append(pair, label);
    out.append(cell);
  }
  (window as unknown as { __done: number }).__done = defs.length;
}

void main();
