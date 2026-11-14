import { describe, expect, it } from 'vitest';
import { play, SOUNDS } from './sound';

describe('the sounds', () => {
  it('are all short, audible and within what a speaker can take', () => {
    for (const [name, voices] of Object.entries(SOUNDS)) {
      expect(voices.length, name).toBeGreaterThan(0);
      const length = Math.max(...voices.map((v) => v.at + v.for));
      expect(length, name).toBeLessThanOrEqual(2);
      for (const v of voices) {
        expect(v.at, name).toBeGreaterThanOrEqual(0);
        expect(v.for, name).toBeGreaterThan(0);
        expect(v.gain, name).toBeGreaterThan(0);
        expect(v.gain, name).toBeLessThanOrEqual(0.5);
        if (v.pitch !== 'noise') {
          expect(v.pitch, name).toBeGreaterThanOrEqual(40);
          expect(v.pitch, name).toBeLessThanOrEqual(6000);
          // A slide runs exponentially: it cannot reach zero.
          if (v.to !== undefined) expect(v.to, name).toBeGreaterThan(0);
        }
      }
    }
  });

  it('stay silent, without error, where there is no audio', () => {
    expect(() => play('hit')).not.toThrow();
  });
});
