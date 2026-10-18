// What the 3D battle stage needs from a unit's art: drawings for each
// animation, from each stored view, anchored at the unit's feet.
//
// Two kinds of set fill this in: Ogre Battle 64's own sprites, extracted
// from the player's ROM (a view from the front and one from behind, every
// animation the game plays), and, without them, sets built here from
// Palatinus's one-pose pixel art, whose animations are made by shifting and
// tinting that one drawing.

export type Anim = 'idle' | 'walk' | 'attack' | 'cast' | 'hit' | 'fall';
export const ANIMS: Anim[] = ['idle', 'walk', 'attack', 'cast', 'hit', 'fall'];

export type SpriteImage = HTMLCanvasElement | HTMLImageElement | ImageBitmap;

export interface SpriteFrame {
  image: SpriteImage;
  /** The unit's feet, in pixels from the image's left and top. */
  anchorX: number;
  anchorY: number;
  /** How long the frame is held. */
  ms: number;
  /** The script's own movement at this frame, in pixels (dz up is negative). */
  dx?: number;
  dz?: number;
  /** The blow lands on this frame. */
  hit?: boolean;
}

export interface AnimClip {
  frames: SpriteFrame[];
  loop: boolean;
}

export interface SpriteView {
  /** Which way the unit faces in the drawing. */
  faces: 'left' | 'right';
  /** Whether the drawing shows the unit's front, its back, or its side. */
  seen: 'front' | 'back' | 'side';
  anims: Record<Anim, AnimClip>;
}

export interface SpriteSet {
  views: SpriteView[];
  /** How many pixels make one world unit of height. */
  pixelsPerUnit: number;
  /** How much bigger the stage draws a large unit (a dragon, a giant) than its art. */
  largeScale: number;
  /** Whether the fall animation lays the unit down itself; else the stage tips the drawing over. */
  ownFall: boolean;
}

function canvasOf(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

/** One drawing, redrawn with an offset and an optional colour wash over its pixels. */
function variant(src: SpriteImage, w: number, h: number, dx: number, dy: number, wash?: string, washAlpha = 0.5): HTMLCanvasElement {
  const pad = 2;
  const [c, ctx] = canvasOf(w + pad * 2, h + pad * 2);
  ctx.drawImage(src, pad + dx, pad + dy);
  if (wash) {
    ctx.globalCompositeOperation = 'source-atop';
    ctx.globalAlpha = washAlpha;
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

/**
 * A full set from a single side-on drawing facing right: idle breathes,
 * walk bobs, attack draws back and lunges, cast glows, hit flashes red, fall
 * is the pose itself (the stage tips it over).
 */
export function setFromStill(src: SpriteImage, width: number, height: number): SpriteSet {
  const pad = 2;
  const clip = (imgs: HTMLCanvasElement[], ms: number, loop: boolean, hitAt = -1): AnimClip => ({
    frames: imgs.map((image, i) => ({ image, anchorX: pad + width / 2, anchorY: pad + height, ms, hit: i === hitAt })),
    loop,
  });
  const base = variant(src, width, height, 0, 0);
  return {
    pixelsPerUnit: height / 1.55,
    largeScale: 1.45,
    ownFall: false,
    views: [{
      faces: 'right',
      seen: 'side',
      anims: {
        idle: clip([base, variant(src, width, height, 0, 1)], 500, true),
        walk: clip([variant(src, width, height, 0, -1), base], 160, true),
        attack: clip([variant(src, width, height, -1, 0), variant(src, width, height, 2, 0), base], 100, false, 1),
        cast: clip([variant(src, width, height, 0, 0, '#fff4c0', 0.35), variant(src, width, height, 0, -1, '#fff4c0', 0.6), base], 120, false, 1),
        hit: clip([variant(src, width, height, -1, 0, '#ff5040', 0.55), base], 120, false),
        fall: clip([base], 1000, false),
      },
    }],
  };
}

/**
 * Which drawing to show for a unit facing left or right on screen, and
 * whether to flip it. Ogre Battle 64 shows the army facing left from the
 * front and the army facing right from behind, as its diagonal battle
 * camera sees them; a set without those views is flipped to suit.
 */
export function chooseView(set: SpriteSet, screenFacing: 'left' | 'right'): { view: SpriteView; mirror: boolean } {
  const wanted = screenFacing === 'left' ? 'front' : 'back';
  const exact = set.views.find((v) => v.faces === screenFacing && v.seen === wanted);
  if (exact) return { view: exact, mirror: false };
  const same = set.views.find((v) => v.faces === screenFacing);
  if (same) return { view: same, mirror: false };
  const flipped = set.views.find((v) => v.seen === wanted) ?? set.views[0];
  return { view: flipped, mirror: true };
}

/** The frame showing `ms` into a clip, and whether the clip has run out. */
export function frameAt(clip: AnimClip, ms: number): { frame: SpriteFrame; index: number; done: boolean } {
  const total = clip.frames.reduce((n, f) => n + f.ms, 0);
  let t = clip.loop && total > 0 ? ms % total : ms;
  for (let i = 0; i < clip.frames.length; i++) {
    if (t < clip.frames[i].ms) return { frame: clip.frames[i], index: i, done: false };
    t -= clip.frames[i].ms;
  }
  const last = clip.frames.length - 1;
  return { frame: clip.frames[last], index: last, done: !clip.loop };
}
