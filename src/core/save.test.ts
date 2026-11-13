import { describe, expect, it } from 'vitest';
import { newCampaign } from './state';
import { adopt, deserialize, serialize } from './save';
import { makeCharacter } from './character';
import { makeSquad, squadMemberIds } from './squad';
import { simulateBattle } from './battle';

describe('saving a campaign', () => {
  it('reads back what was written: soldiers, squads, strongholds, treasury, stores, the day', () => {
    const st = newCampaign();
    st.day = 9;
    st.goth = 1234;
    st.nodes[1].owner = 'player';
    st.inventory['mending-herb'] = 3;
    st.squads[0].tactic = 'weakest';
    st.squads[0].x = 222;
    const anyone = [...st.chars.values()][3];
    anyone.hp = 7;
    anyone.boosts = { str: 2 };
    const back = deserialize(serialize(st, 4.5, 1000))!;
    expect(back.dayTimer).toBe(4.5);
    expect(back.summary).toEqual({ day: 9, held: 2, strongholds: st.nodes.length, squads: 4, savedAt: 1000 });
    expect(back.state.chars).toBeInstanceOf(Map);
    expect([...back.state.chars.values()]).toEqual([...st.chars.values()]);
    expect(back.state.squads).toEqual(st.squads);
    expect(back.state.nodes).toEqual(st.nodes);
    expect(back.state.goth).toBe(1234);
    expect(back.state.inventory).toEqual(st.inventory);
  });

  it('can be played on: battles run, and new soldiers and squads do not collide with the old', () => {
    const back = deserialize(serialize(newCampaign()))!.state;
    adopt(back);
    const fresh = makeCharacter('fighter', 3);
    expect(back.chars.has(fresh.id)).toBe(false);
    expect([...back.chars.values()].some((c) => c.name === fresh.name)).toBe(false);
    const sq = makeSquad('player', [], fresh, 0, 0, 0, 'New');
    expect(back.squads.some((q) => q.id === sq.id)).toBe(false);
    const [mine, theirs] = [back.squads.find((q) => q.side === 'player')!, back.squads.find((q) => q.side === 'enemy')!];
    const result = simulateBattle({ squad: mine, chars: back.chars }, { squad: theirs, chars: back.chars });
    expect(result.events.length).toBeGreaterThan(0);
    expect(squadMemberIds(mine).length).toBeGreaterThan(0);
  });

  it('sets aside what it cannot take up', () => {
    const st = newCampaign();
    expect(deserialize(null)).toBeNull();
    expect(deserialize('{not json')).toBeNull();
    expect(deserialize('{}')).toBeNull();
    const tamper = (change: (file: { version: number; dataset: string; state: { phase: string; chars: { classId: string }[]; squads: { leaderId: number }[]; inventory: Record<string, number> } }) => void) => {
      const file = JSON.parse(serialize(st));
      change(file);
      return deserialize(JSON.stringify(file));
    };
    expect(tamper(() => {})).not.toBeNull();
    expect(tamper((f) => { f.version = 99; })).toBeNull();
    expect(tamper((f) => { f.dataset = 'ob64'; })).toBeNull();
    expect(tamper((f) => { f.state.phase = 'victory'; })).toBeNull();
    expect(tamper((f) => { f.state.chars[0].classId = 'no-such-class'; })).toBeNull();
    expect(tamper((f) => { f.state.squads[0].leaderId = 99999; })).toBeNull();
    expect(tamper((f) => { f.state.inventory['no-such-item'] = 1; })).toBeNull();
  });
});
