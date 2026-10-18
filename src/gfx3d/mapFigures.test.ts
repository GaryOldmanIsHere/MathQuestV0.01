import { describe, expect, it } from 'vitest';
import { FIGURE_HEIGHT, setFigure, sideOf, stillFigure } from './mapFigures';
import type { AnimClip, SpriteImage, SpriteSet, SpriteView } from './sprites';

// Drawings stand in as plain objects: only which one is chosen matters here.
const img = (name: string) => ({ name, width: 20, height: 40 }) as unknown as SpriteImage;
const clip = (...names: string[]): AnimClip => ({
  loop: true,
  frames: names.map((n) => ({ image: img(n), anchorX: 10, anchorY: 38, ms: 100 })),
});
const view = (seen: 'front' | 'back', faces: 'left' | 'right', tag: string): SpriteView => ({
  seen,
  faces,
  anims: {
    idle: clip(`${tag}-idle`), walk: clip(`${tag}-walk1`, `${tag}-walk2`),
    attack: clip('x'), cast: clip('x'), hit: clip('x'), fall: clip('x'),
  },
});
const SET: SpriteSet = {
  views: [view('front', 'left', 'front'), view('back', 'right', 'back')],
  pixelsPerUnit: 26,
  largeScale: 1.5,
  ownFall: true,
};
const name = (f: { image: SpriteImage }) => (f.image as unknown as { name: string }).name;

describe('which way a figure faces', () => {
  it('reads left and right off the screen heading, and neither straight on', () => {
    expect([0, 1, 7].map(sideOf)).toEqual(['right', 'right', 'right']);
    expect([3, 4, 5].map(sideOf)).toEqual(['left', 'left', 'left']);
    expect([2, 6].map(sideOf)).toEqual([null, null]);
  });
});

describe('a figure from one drawing', () => {
  it('turns to face where it marches, and keeps facing that way head-on', () => {
    const f = stillFigure(img('still'), 16, 16, 'right');
    expect(f.frame(0, 0, false).mirror).toBe(false);
    expect(f.frame(4, 0, false).mirror).toBe(true);
    expect(f.frame(2, 0, false).mirror).toBe(true);
    expect(f.frame(1, 0, false).mirror).toBe(false);
  });

  it('bobs in step only while marching, and stands its height', () => {
    const f = stillFigure(img('still'), 16, 32, 'left');
    expect(f.pixelsPerUnit).toBeCloseTo(32 / FIGURE_HEIGHT);
    expect(f.frame(0, 200, false).anchorY).toBe(32);
    expect(f.frame(0, 200, true).anchorY).toBe(31);
    expect(f.frame(0, 0, true).anchorY).toBe(32);
  });
});

describe('a figure from Ogre Battle 64\'s sprites', () => {
  it('shows its front coming toward the camera and its back going away', () => {
    const f = setFigure(SET);
    expect(name(f.frame(2, 0, false))).toBe('front-idle');
    expect(name(f.frame(6, 0, false))).toBe('back-idle');
    // Straight across, it keeps the view it had.
    expect(name(f.frame(0, 0, false))).toBe('back-idle');
    expect(name(f.frame(3, 0, false))).toBe('front-idle');
  });

  it('turns each view to the side it heads for', () => {
    const f = setFigure(SET);
    expect(f.frame(3, 0, false).mirror).toBe(false); // the front view faces left as drawn
    expect(f.frame(1, 0, false).mirror).toBe(true);
    expect(f.frame(7, 0, false).mirror).toBe(false); // the back view faces right as drawn
    expect(f.frame(5, 0, false).mirror).toBe(true);
  });

  it('walks while marching and stands at ease when halted', () => {
    const f = setFigure(SET);
    expect(name(f.frame(2, 0, true))).toBe('front-walk1');
    expect(name(f.frame(2, 150, true))).toBe('front-walk2');
    expect(name(f.frame(2, 150, false))).toBe('front-idle');
  });

  it('stands a man\'s height on the map, and a great beast larger', () => {
    const man = setFigure(SET);
    const beast = setFigure(SET, 1.5);
    expect(41 / man.pixelsPerUnit).toBeCloseTo((41 / 26) * (FIGURE_HEIGHT / 1.55), 5);
    expect(man.pixelsPerUnit / beast.pixelsPerUnit).toBeCloseTo(1.5, 5);
  });
});
