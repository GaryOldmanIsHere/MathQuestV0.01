import type { ClassDef } from '../core/types';
import type { Anim, AnimClip, SpriteFrame, SpriteSet, SpriteView } from '../gfx3d/sprites';
import { ANIMS } from '../gfx3d/sprites';
import { Raster } from './raster';
import { FOOT_X, FOOT_Y, HIP_Y, paintHuman, SLOT } from './humanoid';
import type { HumanLook, Pose } from './humanoid';
import { DRAGON, GHOST_H, GHOST_W, HORSE, HORSE_SLOT, HOUND, paintGhost, paintQuad, paintSea, saddleOf, SEA_H, SEA_W } from './creatures';
import type { QuadSpec } from './creatures';
import { floatBlend, FLOAT_REST, QUAD_REST, quadBlend } from './creatures';
import { floatKeys, framesOf, humanBlend, humanKeys, humanStart, quadKeys } from './motion';
import type { FigureKind } from './looks';
import { figureKindOf, humanLookOf, paletteOf, slotColours } from './looks';
import { hasUnitImage, setUnitImage } from '../gfx/unitImages';

// A class's sprite set, painted: every animation from the front (facing
// left) and from behind (facing right), each frame a picture and a normal
// map. Made the first time a class is drawn, then kept.

/** How tall a figure stands, in world units (as the stage and the map expect). */
const STANDS = 1.55;
/** How many pixels tall a person stands, crown to sole. */
const PERSON_PX = 53;
const PIXELS_PER_UNIT = PERSON_PX / STANDS;

type Colours = [number, number, number][];

function canvasFrom(w: number, h: number, data: Uint8ClampedArray): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return c;
}

/** A picture and its normal map from a painted raster. */
export function imagesOf(r: Raster, colours: Colours, lit = false): { image: HTMLCanvasElement; normal: HTMLCanvasElement } {
  return { image: canvasFrom(r.w, r.h, r.rgba(colours, lit)), normal: canvasFrom(r.w, r.h, r.normals()) };
}

/** The coats a horse may have: bay, chestnut, black, grey, white (coat, blaze, mane, hoof). */
const COATS: [number, number, number][][] = [
  [[118, 72, 40], [196, 170, 140], [40, 28, 24], [44, 36, 34]],
  [[152, 82, 42], [214, 178, 140], [104, 52, 28], [52, 40, 34]],
  [[52, 46, 48], [120, 112, 112], [26, 24, 26], [36, 32, 34]],
  [[168, 164, 160], [222, 218, 212], [92, 88, 88], [60, 56, 56]],
  [[222, 216, 204], [244, 240, 232], [190, 182, 170], [80, 74, 70]],
];

/** A class's colours by slot, with a horse's coat for a rider, chosen by the class. */
function coloursOf(def: ClassDef, kind: FigureKind): Colours {
  const c = slotColours(paletteOf(def));
  if (kind === 'rider') {
    let h = 7;
    for (const ch of def.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const coat = COATS[h % COATS.length];
    c[HORSE_SLOT.coat] = coat[0];
    c[HORSE_SLOT.blaze] = coat[1];
    c[HORSE_SLOT.mane] = coat[2];
    c[HORSE_SLOT.hoof] = coat[3];
  }
  return c;
}

/** Painters for each kind: the frames of an animation, seen from one side. */
interface Painter {
  /** Where the feet stand in a frame. */
  anchor: [number, number];
  frames(anim: Anim, seen: 'front' | 'back'): { raster: Raster; ms: number; hit: boolean }[];
  /** The pose a portrait shows. */
  portrait(): Raster;
  /** How much bigger the stage draws it when it fills two places. */
  largeScale: number;
}

function humanPainter(look: HumanLook): Painter {
  return {
    anchor: [FOOT_X, FOOT_Y + 1],
    largeScale: 1.45,
    frames(anim, seen) {
      const { keys, loop } = humanKeys(anim, look.weapon);
      return framesOf(keys, loop, humanStart, humanBlend).map((f) => ({ raster: paintHuman(look, f.pose, seen), ms: f.ms, hit: f.hit }));
    },
    portrait: () => paintHuman(look, humanStart, 'front'),
  };
}

function quadPainter(spec: QuadSpec, largeScale: number): Painter {
  return {
    anchor: [spec.w / 2, spec.h - 2],
    largeScale,
    frames(anim, seen) {
      const { keys, loop } = quadKeys(anim, spec);
      return framesOf(keys, loop, QUAD_REST, quadBlend).map((f) => ({ raster: paintQuad(spec, f.pose, seen), ms: f.ms, hit: f.hit }));
    },
    portrait: () => paintQuad(spec, QUAD_REST, 'front'),
  };
}

/** A rider on a horse: the horse's paces under the rider's own motions, in step. */
function riderPainter(look: HumanLook): Painter {
  const paint = (horse: typeof QUAD_REST, man: Pose, seen: 'front' | 'back') => {
    const r = new Raster(HORSE.w, HORSE.h);
    const dir = seen === 'front' ? -1 : 1;
    const [sx, sy] = saddleOf(HORSE, horse, dir);
    // The rider's far leg behind the horse, the rest of the rider over it.
    paintQuad(HORSE, horse, seen, r);
    // A saddle cloth in the rider's colours.
    r.beginPart();
    r.polygon([[sx - 7, sy - 1], [sx + 7, sy - 1], [sx + 8, sy + 7], [sx - 8, sy + 7]], 14, SLOT.trim, { normal: [0, -0.3, 1], bevel: 1.5 });
    r.beginPart();
    paintHuman(look, man, seen, { into: r, dx: sx - FOOT_X, dy: sy - HIP_Y + 1, seated: true });
    r.outline();
    return r;
  };
  return {
    anchor: [HORSE.w / 2, HORSE.h - 2],
    largeScale: 1,
    frames(anim, seen) {
      const h = quadKeys(anim, HORSE);
      const m = humanKeys(anim === 'walk' ? 'idle' : anim, look.weapon);
      const horse = framesOf(h.keys, h.loop, QUAD_REST, quadBlend);
      const man = framesOf(m.keys, m.loop, humanStart, humanBlend);
      // The longer run leads; the other is sampled to match it.
      const lead = man.length > horse.length && anim !== 'walk' ? man : horse;
      return lead.map((f, i) => {
        const hp = horse[Math.floor((i * horse.length) / lead.length)].pose;
        const mp = man[Math.floor((i * man.length) / lead.length)].pose;
        return { raster: paint(hp, mp, seen), ms: f.ms, hit: f.hit };
      });
    },
    portrait: () => paint(QUAD_REST, humanStart, 'front'),
  };
}

function floatPainter(kind: 'ghost' | 'sea'): Painter {
  const paint = kind === 'ghost' ? paintGhost : paintSea;
  const [w, h] = kind === 'ghost' ? [GHOST_W, GHOST_H] : [SEA_W, SEA_H];
  return {
    anchor: [w / 2, h - 2],
    largeScale: 1.3,
    frames(anim, seen) {
      const { keys, loop } = floatKeys(anim);
      return framesOf(keys, loop, FLOAT_REST, floatBlend).map((f) => ({ raster: paint(f.pose, seen), ms: f.ms, hit: f.hit }));
    },
    portrait: () => paint(FLOAT_REST, 'front'),
  };
}

function painterFor(def: ClassDef, kind: FigureKind): Painter {
  switch (kind) {
    case 'beast': return quadPainter(HOUND, 1.35);
    case 'dragon': return quadPainter(DRAGON, 1);
    case 'rider': return riderPainter(humanLookOf(def));
    case 'ghost': return floatPainter('ghost');
    case 'sea': return floatPainter('sea');
    case 'golem': return humanPainter({ bulk: 1.5, armour: 'stone', head: 'stone', longHair: false, weapon: 'none', shield: 'none', cape: false });
    default: return humanPainter(humanLookOf(def));
  }
}

function viewOf(p: Painter, colours: Colours, seen: 'front' | 'back'): SpriteView {
  const anims = {} as Record<Anim, AnimClip>;
  for (const anim of ANIMS) {
    const frames: SpriteFrame[] = p.frames(anim, seen).map((f) => {
      const { image, normal } = imagesOf(f.raster, colours);
      return { image, normal, anchorX: p.anchor[0], anchorY: p.anchor[1], ms: f.ms, hit: f.hit };
    });
    anims[anim] = { frames, loop: anim === 'idle' || anim === 'walk' };
  }
  return { faces: seen === 'front' ? 'left' : 'right', seen, anims };
}

const cache = new Map<string, SpriteSet>();

/** A class's painted sprite set (made the first time it is asked for). */
export function paintedSet(def: ClassDef): SpriteSet {
  const key = `${def.id}|${def.palette}`;
  let set = cache.get(key);
  if (!set) {
    const kind = figureKindOf(def);
    const p = painterFor(def, kind);
    const colours = coloursOf(def, kind);
    set = {
      views: [viewOf(p, colours, 'front'), viewOf(p, colours, 'back')],
      pixelsPerUnit: PIXELS_PER_UNIT,
      largeScale: p.largeScale,
      ownFall: false,
    };
    cache.set(key, set);
  }
  return set;
}

/** A class's portrait for menus: standing, from the front, lit as on a bright day, cropped to the figure. */
export function paintedPortrait(def: ClassDef): HTMLCanvasElement {
  const kind = figureKindOf(def);
  const r = painterFor(def, kind).portrait();
  const { image } = imagesOf(r, coloursOf(def, kind), true);
  return cropped(image, r);
}

/** A picture trimmed to what is painted, a pixel to spare. */
function cropped(image: HTMLCanvasElement, r: Raster): HTMLCanvasElement {
  let x0 = r.w;
  let y0 = r.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (!r.filled(x, y)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return image;
  const c = document.createElement('canvas');
  c.width = x1 - x0 + 3;
  c.height = y1 - y0 + 3;
  c.getContext('2d')!.drawImage(image, x0 - 1, y0 - 1, c.width, c.height, 0, 0, c.width, c.height);
  return c;
}

/**
 * Give every class still without a picture its painted portrait, for the
 * menus (classes with Ogre Battle 64's own portraits keep them).
 */
export function paintPortraits(classes: ClassDef[]): void {
  for (const def of classes) {
    if (!hasUnitImage(def.palette)) setUnitImage(def.palette, paintedPortrait(def));
  }
}
