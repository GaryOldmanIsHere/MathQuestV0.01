import { describe, expect, it } from 'vitest';
import { CHIP_HOLD, StrengthBar } from './strengthBar';

describe('strength bar', () => {
  it('drops at once on a blow and drains its chip after a moment', () => {
    const b = new StrengthBar(1);
    b.set(0.6);
    expect(b.fill).toBe(0.6);
    expect(b.chip).toBe(1);
    expect(b.chipKind).toBe('loss');
    b.step(CHIP_HOLD - 10);
    expect(b.chip).toBe(1);
    for (let k = 0; k < 100; k++) b.step(50);
    expect(b.chip).toBeCloseTo(0.6);
  });

  it('keeps the whole loss in the chip when blows fall in quick succession', () => {
    const b = new StrengthBar(1);
    b.set(0.7);
    b.step(100);
    b.set(0.4);
    expect(b.fill).toBe(0.4);
    expect(b.chip).toBe(1);
  });

  it('shows a gain at once and rises to meet it', () => {
    const b = new StrengthBar(0.3);
    b.set(0.8);
    expect(b.chip).toBe(0.8);
    expect(b.chipKind).toBe('gain');
    expect(b.fill).toBe(0.3);
    b.step(200);
    expect(b.fill).toBeGreaterThan(0.3);
    expect(b.fill).toBeLessThan(0.8);
    for (let k = 0; k < 40; k++) b.step(50);
    expect(b.fill).toBeCloseTo(0.8);
  });

  it('stays within the bar', () => {
    const b = new StrengthBar(2);
    expect(b.fill).toBe(1);
    b.set(-0.5);
    expect(b.fill).toBe(0);
  });
});
