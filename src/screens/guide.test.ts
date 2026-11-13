import { describe, expect, it } from 'vitest';
import { GUIDE, guideAfter } from './guide';

describe('the first campaign\'s guide', () => {
  it('moves on only when the player does what a step waits for', () => {
    expect(guideAfter(0, 'order')).toBe(0);
    expect(guideAfter(0, 'select')).toBe(1);
    expect(guideAfter(2, 'battle')).toBe(3);
    expect(guideAfter(2, 'capture')).toBe(3);
    expect(guideAfter(GUIDE.length, 'select')).toBe(GUIDE.length);
  });

  it('can be walked from first step to last, and the last waits to be dismissed', () => {
    let step = 0;
    for (const s of GUIDE.slice(0, -1)) {
      expect(s.until.length).toBeGreaterThan(0);
      step = guideAfter(step, s.until[0]);
    }
    expect(step).toBe(GUIDE.length - 1);
    expect(GUIDE[step].until).toEqual([]);
  });
});
