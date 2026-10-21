import { describe, expect, it } from 'vitest';
import { getState, resetState } from '../core/state';
import { hourName, orders, strengthOf } from './mapHud';
import { ICONS, iconPath } from '../ui/icons';
import { squadMemberIds } from '../core/squad';

describe('the map instruments', () => {
  it('name the hours of the day', () => {
    expect(hourName(0.1)[0]).toBe('Night');
    expect(hourName(0.26)[0]).toBe('Dawn');
    expect(hourName(0.4)[0]).toBe('Morning');
    expect(hourName(0.5)[0]).toBe('Midday');
    expect(hourName(0.65)[0]).toBe('Afternoon');
    expect(hourName(0.76)[0]).toBe('Dusk');
    expect(hourName(0.95)[0]).toBe('Night');
    // Hours past midnight come round again.
    expect(hourName(1.4)).toEqual(hourName(0.4));
    expect(hourName(0.1)[1]).toBe('moon');
  });

  it("tell a squad's orders: fighting, regrouping, marching on a stronghold, or holding one", () => {
    resetState();
    const st = getState();
    const sq = st.squads.find((q) => q.side === 'player')!;
    const none = { fighting: new Set<number>(), regrouping: new Set<number>() };
    const home = st.nodes.find((n) => n.kind === 'hq-player')!;
    expect(orders(sq, st.nodes, none).text).toBe(`Holding ${home.name}`);
    expect(orders(sq, st.nodes, { ...none, fighting: new Set([sq.id]) }).text).toBe('In battle');
    expect(orders(sq, st.nodes, { ...none, regrouping: new Set([sq.id]) }).text).toBe('Regrouping');
    const town = st.nodes.find((n) => n.kind === 'town')!;
    sq.moving = true;
    sq.targetX = town.x;
    sq.targetY = town.y;
    expect(orders(sq, st.nodes, none).text).toBe(`Marching on ${town.name}`);
    sq.targetX = town.x + 200;
    sq.targetY = 20;
    expect(orders(sq, st.nodes, none).text).toBe('Marching');
  });

  it("measure a squad's strength as the share of its members' health left", () => {
    resetState();
    const st = getState();
    const sq = st.squads.find((q) => q.side === 'player')!;
    expect(strengthOf(sq)).toBeCloseTo(1);
    const members = squadMemberIds(sq).map((id) => st.chars.get(id)!);
    const total = members.reduce((s, c) => s + c.stats.hp, 0);
    members[0].hp = 0;
    expect(strengthOf(sq)).toBeCloseTo(1 - members[0].stats.hp / total);
    for (const c of members) c.hp = -5;
    expect(strengthOf(sq)).toBe(0);
  });
});

describe('the icon set', () => {
  it('draws every icon as a path within its square, every element among them', () => {
    for (const name of ICONS) {
      const d = iconPath(name);
      expect(d, name).toMatch(/^M/);
      for (const n of d.match(/-?\d+(\.\d+)?/g) ?? []) {
        expect(Math.abs(Number(n)), `${name}: ${n}`).toBeLessThanOrEqual(24);
      }
    }
    for (const e of ['flame', 'water', 'wind', 'earth', 'virtue', 'bane', 'drakonite', 'physical']) expect(ICONS).toContain(e);
  });
});
