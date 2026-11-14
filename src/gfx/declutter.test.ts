import { describe, expect, it } from 'vitest';
import { declutter } from './declutter';

describe('label decluttering', () => {
  it('leaves labels that do not touch where they are', () => {
    expect(declutter([{ x: 0, y: 100, w: 40, h: 18 }, { x: 200, y: 100, w: 40, h: 18 }])).toEqual([100, 100]);
  });

  it('moves the farther of two touching labels up, clear of the nearer', () => {
    const [near, far] = declutter([{ x: 0, y: 110, w: 40, h: 18 }, { x: 10, y: 100, w: 40, h: 18 }]);
    expect(near).toBe(110);
    expect(far).toBeLessThanOrEqual(110 - 18 - 1);
  });

  it('clears a whole stack', () => {
    const boxes = [0, 1, 2, 3].map((k) => ({ x: k * 3, y: 100 + k, w: 40, h: 18 }));
    const ys = declutter(boxes);
    for (let a = 0; a < ys.length; a++) {
      for (let b = a + 1; b < ys.length; b++) expect(Math.abs(ys[a] - ys[b])).toBeGreaterThanOrEqual(18);
    }
    expect(ys[3]).toBe(103); // the lowest stays put
  });

  it('keeps fixed labels in place and moves the others clear of them', () => {
    const ys = declutter([{ x: 0, y: 100, w: 40, h: 18 }, { x: 0, y: 105, w: 60, h: 14 }], 1, 6, 1);
    expect(ys[1]).toBe(105);
    expect(ys[0]).toBeLessThanOrEqual(105 - 18 - 1);
  });
});
