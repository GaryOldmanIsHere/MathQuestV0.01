import type Phaser from 'phaser';
import type { ClassDef } from '../core/types';
import { allClasses } from '../data/registry';
import { buildClips } from '../ob64/sprites';
import type { ClipName, SpriteRef } from '../ob64/sprites';
import type { SpriteBundle } from '../ob64/sprites';
import { unpackBundle } from '../ob64/spritePack';
import type { Anim, AnimClip, SpriteSet, SpriteView } from './sprites';

// Ogre Battle 64's own unit sprites, from the files `npm run extract:ob64`
// writes beside the class data (public/ob64/sprites/, git-ignored). At boot
// the portrait atlas becomes every class's menu and map texture; when a
// battle starts, the bundles its units need are fetched, unpacked and drawn
// into animated sprite sets.

interface Manifest {
  version: number;
  /** Per class: the player's view from behind and from the front, then the enemy's; null where the game has none. */
  classes: Record<string, (SpriteRef | null)[]>;
  portraits: Record<string, { x: number; y: number; w: number; h: number; anchorX: number; anchorY: number }>;
}

const MANIFEST_VERSION = 3;
let manifest: Manifest | null = null;
const bundles = new Map<number, Promise<SpriteBundle>>();
const sets = new Map<string, SpriteSet>();

/** How many of the game's pixels make one world unit: a fighter's feet sit about 41 px below the top of the drawing, and the figure stands 1.55 tall. */
const PIXELS_PER_UNIT = 26;
/** The game draws its dragons and giants little bigger than a man; the stage enlarges them to read as the great beasts they are. */
const LARGE_SCALE = 1.5;

export function hasOb64Sprites(): boolean {
  return manifest !== null;
}

/** The Ogre Battle 64 class whose art a class wears, if any. */
export function spriteClassOf(def: ClassDef): number | undefined {
  const id = def.ob64Id ?? def.spriteOf;
  return id !== undefined && manifest?.classes[id] ? id : undefined;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: 'no-store' });
  // The dev server answers a missing file with the app's index page.
  if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
  return (await res.json()) as T;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/**
 * Load the manifest and the portrait atlas, if they were extracted, and make
 * each Ogre Battle 64 class's portrait its `unit-<palette>` texture. Call
 * before the pixel-art textures are painted, which leave existing ones be.
 */
export async function loadOb64Sprites(scene: Phaser.Scene): Promise<void> {
  try {
    manifest = await fetchJson<Manifest>('ob64/sprites/manifest.json');
    // Older manifests are laid out differently; extract again for these.
    if (manifest && manifest.version < MANIFEST_VERSION) {
      console.warn('Ogre Battle 64 sprites are from an older extractor; run `npm run extract:ob64` again.');
      manifest = null;
    }
    if (!manifest) return;
    const atlas = await loadImage('ob64/sprites/portraits.png');
    for (const def of allClasses()) {
      const id = spriteClassOf(def);
      const p = id !== undefined ? manifest.portraits[id] : undefined;
      if (!p) continue;
      const key = `unit-${def.palette}`;
      if (scene.textures.exists(key)) scene.textures.remove(key);
      const tex = scene.textures.createCanvas(key, p.w, p.h);
      if (!tex) continue;
      tex.getContext().drawImage(atlas, p.x, p.y, p.w, p.h, 0, 0, p.w, p.h);
      tex.refresh();
    }
  } catch (err) {
    console.warn('Ogre Battle 64 sprites present but unreadable; using the original art.', err);
    manifest = null;
  }
}

function bundle(n: number): Promise<SpriteBundle> {
  let p = bundles.get(n);
  if (!p) {
    p = fetch(`ob64/sprites/b${n}.bin`)
      .then((r) => {
        if (!r.ok) throw new Error(`bundle ${n}: ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => unpackBundle(new Uint8Array(buf), n));
    bundles.set(n, p);
  }
  return p;
}

function toCanvas(c: { width: number; height: number; px: Uint8ClampedArray }): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = c.width;
  canvas.height = c.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(c.px), c.width, c.height), 0, 0);
  return canvas;
}

function viewOf(b: SpriteBundle, variant: number, seen: 'front' | 'back'): SpriteView {
  const { clips, cells } = buildClips(b, variant);
  const canvases = new Map([...cells].map(([k, c]) => [k, { canvas: toCanvas(c), c }]));
  const anims = {} as Record<Anim, AnimClip>;
  for (const name of Object.keys(clips) as ClipName[]) {
    anims[name] = {
      loop: clips[name].loop,
      frames: clips[name].frames.flatMap((f) => {
        const got = canvases.get(f.cell);
        return got ? [{ image: got.canvas, anchorX: got.c.anchorX, anchorY: got.c.anchorY, ms: f.ms, dx: f.dx, dz: f.dz, hit: f.hit }] : [];
      }),
    };
  }
  // The game draws its units facing left from the front and right from behind.
  return { faces: seen === 'front' ? 'left' : 'right', seen, anims };
}

/**
 * Make sure the sprite sets for these classes are built, fetching and
 * unpacking what is needed. Resolves even if some cannot be had; those
 * units keep the original art.
 */
export async function prepareSprites(wanted: { def: ClassDef; side: 'player' | 'enemy' }[]): Promise<void> {
  if (!manifest) return;
  await Promise.all(wanted.map(async ({ def, side }) => {
    const id = spriteClassOf(def);
    const key = `${def.id}|${side}`;
    if (id === undefined || sets.has(key)) return;
    const row = manifest!.classes[id];
    const refs: [SpriteRef | null, 'front' | 'back'][] = [
      [row[side === 'player' ? 1 : 3], 'front'],
      [row[side === 'player' ? 0 : 2], 'back'],
    ];
    try {
      const views = (await Promise.all(refs.map(async ([ref, seen]) => (ref ? viewOf(await bundle(ref.bundle), ref.variant, seen) : null))))
        .filter((v): v is SpriteView => v !== null && v.anims.idle.frames.length > 0);
      if (views.length) sets.set(key, { views, pixelsPerUnit: PIXELS_PER_UNIT, largeScale: LARGE_SCALE, ownFall: true });
    } catch (err) {
      console.warn(`No Ogre Battle 64 sprites for ${def.name}`, err);
    }
  }));
}

export function ob64SpriteSet(def: ClassDef, side: 'player' | 'enemy'): SpriteSet | undefined {
  return sets.get(`${def.id}|${side}`);
}
