import { describe, expect, it } from 'vitest';
import { newCampaign } from './state';
import { buryCaches, CACHE_CLEAR, CACHE_COUNT, cacheInSight, cacheUnder, DIG_HALTED, DIG_PASSING, GLINT_REACH, LINES, lineFor, openCache } from './events';
import { MAP_H, MAP_W } from './terrain';

describe('buried caches', () => {
  it('lie out in the country, clear of strongholds, the edge and each other', () => {
    const st = newCampaign();
    const caches = buryCaches(st.nodes);
    expect(caches).toHaveLength(CACHE_COUNT);
    for (const c of caches) {
      expect(c.found).toBe(false);
      expect(c.x).toBeGreaterThanOrEqual(CACHE_CLEAR - 1);
      expect(c.x).toBeLessThanOrEqual(MAP_W - CACHE_CLEAR + 1);
      expect(c.y).toBeGreaterThanOrEqual(CACHE_CLEAR - 1);
      expect(c.y).toBeLessThanOrEqual(MAP_H - CACHE_CLEAR + 1);
      for (const n of st.nodes) expect(Math.hypot(n.x - c.x, n.y - c.y)).toBeGreaterThanOrEqual(CACHE_CLEAR - 1);
      for (const o of caches) if (o !== c) expect(Math.hypot(o.x - c.x, o.y - c.y)).toBeGreaterThanOrEqual(69);
    }
    expect(st.caches).toHaveLength(CACHE_COUNT);
  });

  it('are turned up by a squad of ours marching over one, or halting near it, and glint from further off', () => {
    const st = newCampaign();
    const cache = { x: 400, y: 300, found: false };
    st.caches = [cache];
    const sq = st.squads.find((q) => q.side === 'player')!;
    const foe = st.squads.find((q) => q.side === 'enemy')!;
    Object.assign(sq, { x: 400 + DIG_PASSING + 4, y: 300, moving: true });
    expect(cacheUnder(st, sq)).toBeNull();
    expect(cacheInSight(st, sq)).toBe(cache);
    sq.moving = false;
    expect(cacheUnder(st, sq)).toBe(cache);
    Object.assign(sq, { x: 400 + DIG_HALTED + 2 });
    expect(cacheUnder(st, sq)).toBeNull();
    Object.assign(sq, { x: 400 + GLINT_REACH + 2 });
    expect(cacheInSight(st, sq)).toBeNull();
    // The enemy digs nothing up.
    Object.assign(foe, { x: 400, y: 300, moving: false });
    expect(cacheUnder(st, foe)).toBeNull();
  });

  it('give Goth and an item once, into the army\'s stores', () => {
    const st = newCampaign();
    const cache = { x: 400, y: 300, found: false };
    st.caches = [cache];
    const goth = st.goth;
    const held = Object.values(st.inventory).reduce((s, n) => s + n, 0);
    const loot = openCache(st, cache);
    expect(cache.found).toBe(true);
    expect(loot.goth).toBeGreaterThan(0);
    expect(st.goth).toBe(goth + loot.goth);
    expect(Object.values(st.inventory).reduce((s, n) => s + n, 0)).toBe(held + loot.items.length);
    const sq = st.squads.find((q) => q.side === 'player')!;
    Object.assign(sq, { x: 400, y: 300, moving: false });
    expect(cacheUnder(st, sq)).toBeNull();
  });
});

describe('what leaders say', () => {
  it('has a line for every occasion', () => {
    for (const [event, lines] of Object.entries(LINES)) {
      expect(lines.length, event).toBeGreaterThan(0);
      expect(lines).toContain(lineFor(event as keyof typeof LINES));
    }
    expect(lineFor('win', () => 0.999)).toBe(LINES.win.at(-1));
  });
});
