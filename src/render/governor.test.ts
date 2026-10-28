import { describe, expect, it } from 'vitest';
import { MIN_SCALE, ResolutionGovernor } from './governor';

/** Feed the governor `n` windows at `ms` a frame; how many times it changed the scale. */
function feed(g: ResolutionGovernor, ms: number, n: number): number {
  let changes = 0;
  for (let i = 0; i < n; i++) if (g.observe(ms)) changes++;
  return changes;
}

describe('adaptive resolution', () => {
  it('draws fewer pixels while frames are slow, down to its floor', () => {
    const g = new ResolutionGovernor();
    expect(feed(g, 30, 1)).toBe(0); // one slow window is a hitch, not a trend
    expect(feed(g, 30, 1)).toBe(1);
    expect(g.scale).toBeCloseTo(0.9);
    feed(g, 60, 40);
    expect(g.scale).toBe(MIN_SCALE);
  });

  it('draws more again when frames come easily, but not back to a share already found too slow', () => {
    const g = new ResolutionGovernor();
    feed(g, 30, 4); // 1 → 0.9 → 0.8
    expect(g.scale).toBeCloseTo(0.8);
    feed(g, 16.7, 60);
    // 0.9 was too slow once: it stays at 0.8 rather than see-saw.
    expect(g.scale).toBeCloseTo(0.8);
    g.reset();
    expect(g.scale).toBe(1);
  });

  it('climbs back while a lower share is the only one found too slow', () => {
    const g = new ResolutionGovernor();
    g.scale = 0.6;
    feed(g, 16, 6);
    expect(g.scale).toBeCloseTo(0.7);
    feed(g, 16, 30);
    expect(g.scale).toBe(1);
  });

  it('leaves the scale be at a steady 60 frames a second, and when switched off', () => {
    const g = new ResolutionGovernor();
    expect(feed(g, 16.7, 100)).toBe(0);
    const off = new ResolutionGovernor(false);
    expect(feed(off, 100, 100)).toBe(0);
    expect(off.scale).toBe(1);
  });
});
