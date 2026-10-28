import { describe, expect, it } from 'vitest';
import { DAYS_PER_CYCLE, hourLight, hourOf, HOURS, weatherOn } from './sky';

describe('the hour over the map', () => {
  it('opens the campaign in the morning', () => {
    expect(hourOf(0)).toBeCloseTo(0.3);
  });

  it('turns through a whole day and night every cycle of campaign days', () => {
    expect(hourOf(DAYS_PER_CYCLE)).toBeCloseTo(hourOf(0));
    const hours = Array.from({ length: 60 }, (_, k) => hourOf((k / 60) * DAYS_PER_CYCLE));
    expect(hours.some((h) => h > 0.45 && h < 0.55)).toBe(true);
    expect(hours.some((h) => h < 0.1 || h > 0.9)).toBe(true);
    for (const h of hours) expect(h >= 0 && h < 1).toBe(true);
  });
});

describe('the light of the hour', () => {
  it('is brightest at noon and dimmest at midnight', () => {
    const noon = hourLight(0.5).sunPower;
    const midnight = hourLight(0).sunPower;
    for (let h = 0; h < 1; h += 0.05) {
      expect(hourLight(h).sunPower).toBeLessThanOrEqual(noon + 1e-9);
      expect(hourLight(h).sunPower).toBeGreaterThanOrEqual(Math.min(midnight, 0.5) - 1e-9);
    }
  });

  it('matches the hours set down, and changes smoothly between them', () => {
    for (const h of HOURS.slice(0, -1)) expect(hourLight(h.at).sunPower).toBeCloseTo(h.sunPower);
    let last = hourLight(0).sunPower;
    for (let h = 0.001; h < 1; h += 0.001) {
      const now = hourLight(h).sunPower;
      expect(Math.abs(now - last)).toBeLessThan(0.05);
      last = now;
    }
  });

  it('keeps the sun above the horizon', () => {
    for (let h = 0; h < 1; h += 0.01) expect(hourLight(h).elevation).toBeGreaterThan(0.05);
  });
});

describe('the weather', () => {
  it('is clear for the campaign\'s first days', () => {
    for (let d = 1; d <= 3; d++) expect(weatherOn(d)).toBe('clear');
  });

  it('holds for three days at a time', () => {
    for (let d = 4; d < 300; d += 3) {
      expect(weatherOn(d + 1)).toBe(weatherOn(d));
      expect(weatherOn(d + 2)).toBe(weatherOn(d));
    }
  });

  it('is mostly fair, but every kind comes', () => {
    const seen = Array.from({ length: 900 }, (_, k) => weatherOn(k + 1));
    const share = (w: string) => seen.filter((x) => x === w).length / seen.length;
    expect(share('clear')).toBeGreaterThan(0.3);
    for (const w of ['cloudy', 'rain', 'mist', 'snow']) expect(share(w)).toBeGreaterThan(0);
  });
});
