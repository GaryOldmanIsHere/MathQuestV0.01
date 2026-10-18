import { describe, expect, it } from 'vitest';
import { rallyHome, REST_HEAL, restSquads } from './camp';
import { newCampaign } from './state';
import { squadMemberIds } from './squad';
import { freshName, resetNames } from '../data/names';

describe('rest', () => {
  it('heals a halted squad on its own stronghold, and only there', () => {
    const st = newCampaign();
    const [home, away] = st.squads.filter((s) => s.side === 'player');
    away.x = 330;
    away.y = 300; // open country
    const hurt = (id: number) => st.chars.get(id)!;
    const a = hurt(squadMemberIds(home)[0]);
    const b = hurt(squadMemberIds(away)[0]);
    a.hp = 1;
    b.hp = 1;
    restSquads(st);
    expect(a.hp).toBe(1 + Math.max(1, Math.round(a.stats.hp * REST_HEAL)));
    expect(b.hp).toBe(1);
  });

  it('gives no rest on a stronghold held by the enemy', () => {
    const st = newCampaign();
    const sq = st.squads.find((s) => s.side === 'player')!;
    const fort = st.nodes.find((n) => n.owner === 'enemy' && n.kind === 'fort')!;
    sq.x = fort.x;
    sq.y = fort.y;
    const c = st.chars.get(squadMemberIds(sq)[0])!;
    c.hp = 1;
    restSquads(st);
    expect(c.hp).toBe(1);
  });

  it('raises the fallen at headquarters, and not at any other stronghold', () => {
    const st = newCampaign();
    const sq = st.squads.find((s) => s.side === 'player')!;
    const town = st.nodes.find((n) => n.kind === 'town')!;
    town.owner = 'player';
    sq.x = town.x;
    sq.y = town.y;
    const [first, second] = squadMemberIds(sq).map((id) => st.chars.get(id)!);
    first.hp = 0;
    second.hp = 1;
    restSquads(st);
    expect(first.hp).toBe(0);
    expect(second.hp).toBeGreaterThan(1); // the living still mend
  });

  it('raises the fallen only at their own headquarters', () => {
    const st = newCampaign();
    const sq = st.squads.find((s) => s.side === 'player')!;
    const c = st.chars.get(squadMemberIds(sq)[1])!;
    c.hp = 0;
    sq.moving = true;
    restSquads(st);
    expect(c.hp).toBe(0); // marching squads do not rest
    sq.moving = false;
    restSquads(st);
    expect(c.hp).toBeGreaterThan(0);
  });

  it('carries a squad home', () => {
    const st = newCampaign();
    const sq = st.squads.find((s) => s.side === 'player')!;
    sq.x = 500;
    sq.y = 300;
    sq.moving = true;
    rallyHome(st, sq);
    const hq = st.nodes.find((n) => n.kind === 'hq-player')!;
    expect([sq.x, sq.y, sq.moving]).toEqual([hq.x, hq.y, false]);
  });
});

describe('names', () => {
  it('never gives two soldiers of a campaign the same name', () => {
    const st = newCampaign();
    const names = [...st.chars.values()].map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('uses every name in a pool before repeating any', () => {
    resetNames();
    const pool = ['Ash', 'Bree', 'Cole', 'Dara'];
    expect(new Set(Array.from({ length: 4 }, () => freshName(pool)))).toEqual(new Set(pool));
  });

  it('goes on to numerals once a pool is spent', () => {
    resetNames();
    const pool = ['Ash', 'Bree'];
    const got = Array.from({ length: 6 }, () => freshName(pool));
    expect(new Set(got).size).toBe(6);
    expect(got.filter((n) => / [IVX]+$/.test(n))).toHaveLength(4);
  });

  it('starts the army with supplies', () => {
    expect(Object.keys(newCampaign().inventory).length).toBeGreaterThan(0);
  });
});
