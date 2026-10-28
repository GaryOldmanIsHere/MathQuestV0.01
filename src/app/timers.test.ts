import { describe, expect, it } from 'vitest';
import { Timers } from './timers';

describe('timers on a screen\'s clock', () => {
  it('do things once their time has passed, not before', () => {
    const t = new Timers();
    const done: string[] = [];
    t.after(100, () => done.push('a'));
    t.update(99);
    expect(done).toEqual([]);
    t.update(1);
    expect(done).toEqual(['a']);
    t.update(1000);
    expect(done).toEqual(['a']);
  });

  it('keep order when several fall due at once, and run what a timer schedules', () => {
    const t = new Timers();
    const done: string[] = [];
    t.after(30, () => done.push('late'));
    t.after(10, () => {
      done.push('early');
      t.after(5, () => done.push('chained'));
    });
    t.update(50);
    expect(done).toEqual(['early', 'chained', 'late']);
  });

  it('forget everything when cleared', () => {
    const t = new Timers();
    let ran = false;
    t.after(1, () => { ran = true; });
    t.clear();
    t.update(10);
    expect(ran).toBe(false);
  });
});
