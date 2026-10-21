import { describe, expect, it } from 'vitest';
import { chooseView, frameAt } from './sprites';
import type { AnimClip, SpriteSet, SpriteView } from './sprites';

const clip = (ms: number[], loop: boolean): AnimClip => ({
  frames: ms.map((m) => ({ image: {} as HTMLCanvasElement, anchorX: 0, anchorY: 0, ms: m })),
  loop,
});
const view = (faces: 'left' | 'right', seen: SpriteView['seen']): SpriteView => ({
  faces, seen,
  anims: { idle: clip([1], true), walk: clip([1], true), attack: clip([1], false), cast: clip([1], false), hit: clip([1], false), fall: clip([1], false) },
});

describe('choosing a view', () => {
  it('shows the Ogre Battle 64 way: the left-facing army from the front, the right-facing one from behind', () => {
    const front = view('left', 'front');
    const back = view('right', 'back');
    const set: SpriteSet = { views: [front, back], pixelsPerUnit: 30, largeScale: 1.5, ownFall: true };
    expect(chooseView(set, 'left')).toEqual({ view: front, mirror: false });
    expect(chooseView(set, 'right')).toEqual({ view: back, mirror: false });
  });

  it('flips a one-sided drawing for the other side', () => {
    const side = view('right', 'side');
    const set: SpriteSet = { views: [side], pixelsPerUnit: 10, largeScale: 1.45, ownFall: false };
    expect(chooseView(set, 'right')).toEqual({ view: side, mirror: false });
    expect(chooseView(set, 'left')).toEqual({ view: side, mirror: true });
  });
});

describe('playing a clip', () => {
  it('holds each frame for its own time', () => {
    const c = clip([100, 50, 200], false);
    expect(frameAt(c, 0).index).toBe(0);
    expect(frameAt(c, 120).index).toBe(1);
    expect(frameAt(c, 151).index).toBe(2);
    expect(frameAt(c, 349).done).toBe(false);
    expect(frameAt(c, 350).done).toBe(true);
  });

  it('wraps a looping clip', () => {
    const c = clip([100, 100], true);
    expect(frameAt(c, 250).index).toBe(0);
    expect(frameAt(c, 10_000).done).toBe(false);
  });
});
