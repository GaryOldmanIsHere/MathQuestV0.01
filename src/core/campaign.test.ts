import { describe, expect, it } from 'vitest';
import { newCampaign } from './state';
import type { GameState } from './state';
import {
  AI_REST_BELOW, enemyOrder, ENEMY_SQUADS_MAX, FOUND_SQUAD_COST, foundSquad, PLAYER_SQUADS_MAX, recruitCost, recruitLevel,
  reinforce, reinforcementLevel, REINFORCE_EVERY, strengthShare, transferMember,
} from './campaign';
import { squadMemberIds } from './squad';
import { restSquads } from './camp';
import { classOf } from '../data/registry';

const squad = (st: GameState, name: string) => st.squads.find((s) => s.name === name)!;
const node = (st: GameState, name: string) => st.nodes.find((n) => n.name === name)!;
const hurt = (st: GameState, name: string, share: number) => {
  for (const id of squadMemberIds(squad(st, name))) st.chars.get(id)!.hp = Math.round(st.chars.get(id)!.stats.hp * share);
};

describe('what the enemy sets out to do', () => {
  it('keeps a garrison at its post, and brings it back if driven off', () => {
    const st = newCampaign();
    const watch = squad(st, 'Stonegate Watch');
    expect(enemyOrder(st, watch)).toEqual({ kind: 'hold' });
    watch.x -= 80;
    const back = enemyOrder(st, watch);
    expect(back).toMatchObject({ kind: 'march', why: 'home', to: { x: node(st, 'Stonegate').x, y: node(st, 'Stonegate').y } });
    // Its post lost, it fights on as a roaming squad.
    node(st, 'Stonegate').owner = 'player';
    expect(enemyOrder(st, watch)).toMatchObject({ kind: 'march', why: 'strike' });
  });

  it('strikes at the player\'s holdings in reach while fit, and falls back to rest when hurt', () => {
    const st = newCampaign();
    node(st, 'Elm Vale').owner = 'player';
    const patrol = squad(st, 'Border Patrol');
    expect(enemyOrder(st, patrol)).toMatchObject({ kind: 'march', why: 'strike', to: { x: node(st, 'Elm Vale').x } });
    hurt(st, 'Border Patrol', AI_REST_BELOW - 0.1);
    // On its own town already: it stays and rests.
    expect(enemyOrder(st, patrol)).toEqual({ kind: 'hold' });
    patrol.x -= 60;
    expect(enemyOrder(st, patrol)).toMatchObject({ kind: 'march', why: 'rest' });
  });

  it('rests until fit again, not merely until it could attack', () => {
    const st = newCampaign();
    node(st, 'Elm Vale').owner = 'player';
    hurt(st, 'Border Patrol', 0.6);
    expect(enemyOrder(st, squad(st, 'Border Patrol'))).toEqual({ kind: 'hold' });
    hurt(st, 'Border Patrol', 0.9);
    expect(enemyOrder(st, squad(st, 'Border Patrol')).kind).toBe('march');
  });

  it('moves a squad with nothing in reach up toward the front, so none idles in the rear', () => {
    const st = newCampaign();
    const raiders = squad(st, 'Ash Raiders');
    const order = enemyOrder(st, raiders);
    expect(order).toMatchObject({ kind: 'march', why: 'advance' });
    const keep = st.nodes.find((n) => n.kind === 'hq-player')!;
    if (order.kind === 'march') {
      expect(Math.hypot(order.to.x - keep.x, order.to.y - keep.y)).toBeLessThan(Math.hypot(raiders.x - keep.x, raiders.y - keep.y));
    }
  });

  it('does not raise its fallen at the castle, as the player\'s keep does', () => {
    const st = newCampaign();
    const guard = squad(st, 'Verlaine Guard');
    const fallen = st.chars.get(squadMemberIds(guard)[1])!;
    fallen.hp = 0;
    const mine = st.chars.get(squadMemberIds(squad(st, 'Azure Wing'))[1])!;
    mine.hp = 0;
    restSquads(st);
    expect(fallen.hp).toBe(0);
    expect(mine.hp).toBeGreaterThan(0);
  });
});

describe('the castle\'s reinforcements', () => {
  it('march out every fifth day while the castle stands, stronger as the days pass', () => {
    const st = newCampaign();
    const before = st.squads.length;
    st.day = REINFORCE_EVERY - 1;
    expect(reinforce(st)).toBeNull();
    st.day = REINFORCE_EVERY;
    const first = reinforce(st)!;
    expect(first.side).toBe('enemy');
    expect(first.home).toBeUndefined(); // it roams
    expect(st.squads.length).toBe(before + 1);
    expect(strengthShare(st, first)).toBe(1);
    expect(reinforcementLevel(40)).toBeGreaterThan(reinforcementLevel(5));
    // The field is full again until a squad is lost.
    st.day = REINFORCE_EVERY * 2;
    expect(reinforce(st)).toBeNull();
    st.squads.splice(st.squads.findIndex((q) => q.name === 'Border Patrol'), 1);
    expect(reinforce(st)!.name).not.toBe(first.name);
  });

  it('stop at the enemy\'s limit, and once the castle has fallen', () => {
    const st = newCampaign();
    st.day = REINFORCE_EVERY;
    st.squads = st.squads.filter((q) => q.side === 'player' || q.home !== undefined);
    while (st.squads.filter((s) => s.side === 'enemy').length < ENEMY_SQUADS_MAX) expect(reinforce(st)).not.toBeNull();
    expect(reinforce(st)).toBeNull();
    const other = newCampaign();
    other.day = REINFORCE_EVERY;
    other.nodes.find((n) => n.kind === 'hq-enemy')!.owner = 'player';
    expect(reinforce(other)).toBeNull();
  });
});

describe('growing the army', () => {
  it('brings recruits in a level under the army\'s average, at a price that grows with it', () => {
    const st = newCampaign();
    const level = recruitLevel(st);
    expect(level).toBeGreaterThanOrEqual(3);
    for (const c of st.chars.values()) c.level += 4;
    expect(recruitLevel(st)).toBe(level + 4);
    const fighter = classOf('fighter');
    expect(recruitCost(fighter, level + 4)).toBeGreaterThan(recruitCost(fighter, level));
    expect(recruitCost(fighter)).toBe(90);
  });

  it('founds a squad at the keep for its fee and its leader\'s hire, up to the army\'s limit', () => {
    const st = newCampaign();
    st.goth = 10;
    expect(foundSquad(st, 'fighter', classOf('fighter'))).toBeNull();
    st.goth = 5000;
    const cost = FOUND_SQUAD_COST + recruitCost(classOf('fighter'), recruitLevel(st));
    const sq = foundSquad(st, 'fighter', classOf('fighter'))!;
    expect(st.goth).toBe(5000 - cost);
    expect(squadMemberIds(sq)).toEqual([sq.leaderId]);
    expect(st.chars.has(sq.leaderId)).toBe(true);
    const keep = st.nodes.find((n) => n.kind === 'hq-player')!;
    expect(Math.hypot(sq.x - keep.x, sq.y - keep.y)).toBeLessThan(28);
    while (st.squads.filter((s) => s.side === 'player').length < PLAYER_SQUADS_MAX) expect(foundSquad(st, 'fighter', classOf('fighter'))).not.toBeNull();
    expect(foundSquad(st, 'fighter', classOf('fighter'))).toBeNull();
    expect(new Set(st.squads.map((s) => s.name)).size).toBe(st.squads.length);
  });

  it('moves a soldier between squads standing together, but never a leader, nor into a full squad', () => {
    const st = newCampaign();
    st.goth = 5000;
    const azure = squad(st, 'Azure Wing');
    const fresh = foundSquad(st, 'fighter', classOf('fighter'))!;
    const soldier = squadMemberIds(azure).find((id) => id !== azure.leaderId)!;
    expect(transferMember(st, azure, fresh, azure.leaderId)).toMatch(/leader/);
    expect(transferMember(st, azure, squad(st, 'Silver Talon'), soldier)).toMatch(/no room/);
    fresh.x += 300;
    expect(transferMember(st, azure, fresh, soldier)).toMatch(/too far/);
    fresh.x -= 300;
    expect(transferMember(st, azure, fresh, soldier)).toBeNull();
    expect(azure.grid).not.toContain(soldier);
    expect(fresh.grid).toContain(soldier);
  });
});
