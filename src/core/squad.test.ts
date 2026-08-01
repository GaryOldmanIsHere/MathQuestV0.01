import { describe, expect, it } from 'vitest';
import { autoPlace, makeSquad, memberRow, moveSpeed, squadMemberIds, squadMoveType } from './squad';
import { makeCharacter } from './character';
import type { Character } from './types';
import { CELL_ROW } from './types';

function emptySquad() {
  const leader = makeCharacter('fighter', 1);
  const sq = makeSquad('player', [], leader, 0, 0, 0, 'test');
  return { sq, leader };
}

describe('formation grid', () => {
  it('maps each column to a battle row', () => {
    expect(CELL_ROW[0]).toBe('back');
    expect(CELL_ROW[1]).toBe('mid');
    expect(CELL_ROW[2]).toBe('front');
    // same pattern repeats down the three grid rows
    expect(CELL_ROW.slice(3, 6)).toEqual(['back', 'mid', 'front']);
    expect(CELL_ROW.slice(6, 9)).toEqual(['back', 'mid', 'front']);
  });

  it('reports a member\'s row from the cell they occupy', () => {
    const { sq } = emptySquad();
    const c = makeCharacter('archer', 5);
    sq.grid[0] = c.id;
    expect(memberRow(sq, c.id)).toBe('back');
    sq.grid[0] = null;
    sq.grid[8] = c.id;
    expect(memberRow(sq, c.id)).toBe('front');
  });
});

describe('auto-placement', () => {
  it('puts melee classes in the front column and casters in the back', () => {
    const { sq } = emptySquad();
    const knight = makeCharacter('knight', 5);
    const wizard = makeCharacter('wizard', 5);
    autoPlace(sq, knight);
    autoPlace(sq, wizard);
    expect(memberRow(sq, knight.id)).toBe('front');
    expect(memberRow(sq, wizard.id)).toBe('back');
  });

  it('caps a squad at five members', () => {
    const { sq } = emptySquad();
    const placed = [];
    for (let i = 0; i < 8; i++) placed.push(autoPlace(sq, makeCharacter('fighter', 1)));
    expect(squadMemberIds(sq)).toHaveLength(5);
    expect(placed.filter(Boolean)).toHaveLength(5);
  });

  it('never puts two members in the same cell', () => {
    const { sq } = emptySquad();
    for (let i = 0; i < 5; i++) autoPlace(sq, makeCharacter('fighter', 1));
    const occupied = sq.grid.filter((c) => c !== null);
    expect(new Set(occupied).size).toBe(occupied.length);
  });
});

describe('march speed', () => {
  const of = (...classIds: string[]): Character[] => classIds.map((c) => makeCharacter(c, 5));

  it('moves at foot pace when any member walks', () => {
    expect(squadMoveType(of('ghost', 'knight'))).toBe('foot');
  });

  it('moves fast only when no member is on foot', () => {
    expect(squadMoveType(of('ninja', 'ghost'))).toBe('fast');
  });

  it('flies only when every member flies', () => {
    expect(squadMoveType(of('ghost', 'wyvern'))).toBe('fly');
    expect(squadMoveType(of('ghost', 'ninja'))).not.toBe('fly');
  });

  it('is limited by the slowest member, not the fastest', () => {
    const mixed = squadMoveType(of('wyvern', 'golem')); // flier + heavy walker
    expect(mixed).toBe('foot');
    expect(moveSpeed(mixed)).toBeLessThan(moveSpeed('fly'));
  });

  it('orders the three paces correctly', () => {
    expect(moveSpeed('fly')).toBeGreaterThan(moveSpeed('fast'));
    expect(moveSpeed('fast')).toBeGreaterThan(moveSpeed('foot'));
  });
});
