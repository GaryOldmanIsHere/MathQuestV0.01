import { describe, expect, it } from 'vitest';
import { DEFAULT_COMFORT, parseComfort, reducedMotion } from './comfort';

describe('comfort settings', () => {
  it('read back what was kept, and the defaults for anything missing, unknown or unreadable', () => {
    expect(parseComfort(JSON.stringify({ uiScale: 1.15, motion: 'reduce', battlePace: 2 }))).toEqual({ uiScale: 1.15, motion: 'reduce', battlePace: 2 });
    expect(parseComfort(JSON.stringify({ uiScale: 7, motion: 'wild', battlePace: '2' }))).toEqual(DEFAULT_COMFORT);
    expect(parseComfort(JSON.stringify({ battlePace: 1.5 }))).toEqual({ ...DEFAULT_COMFORT, battlePace: 1.5 });
    expect(parseComfort('{not json')).toEqual(DEFAULT_COMFORT);
    expect(parseComfort(null)).toEqual(DEFAULT_COMFORT);
  });

  it("reduce motion when the player asks, whatever the system's setting", () => {
    expect(reducedMotion({ ...DEFAULT_COMFORT, motion: 'reduce' })).toBe(true);
    expect(reducedMotion({ ...DEFAULT_COMFORT, motion: 'full' })).toBe(false);
    // Following the system where there is none to ask (as here): full motion.
    expect(reducedMotion({ ...DEFAULT_COMFORT, motion: 'system' })).toBe(false);
  });
});
