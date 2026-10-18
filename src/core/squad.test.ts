import { describe, expect, it } from 'vitest';
import { autoPlace, makeSquad, marchOf, memberRow, moveSpeed, squadMemberIds, squadType } from './squad';
import { classOf } from '../data/registry';
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

describe('squad type', () => {
  const of = (...classIds: string[]): Character[] => classIds.map((c) => makeCharacter(c, 5));

  it('reads each class\'s own march', () => {
    expect(marchOf(classOf('knight'))).toBe('heavy');
    expect(marchOf(classOf('wizard'))).toBe('slow');
    expect(marchOf(classOf('cleric'))).toBe('slow');
    expect(marchOf(classOf('ninja'))).toBe('light');
    expect(marchOf(classOf('ghost'))).toBe('fly');
    expect(marchOf(classOf('cavalier'))).toBe('heavyCav');
    expect(marchOf(classOf('scout'))).toBe('lightCav');
  });

  it('is heavy infantry by default', () => {
    expect(squadType(of('knight', 'fighter', 'fighter'))).toBe('heavy');
    expect(squadType([])).toBe('heavy');
  });

  it('is slow when at least half the squad casts or heals', () => {
    expect(squadType(of('wizard', 'cleric', 'knight', 'fighter'))).toBe('slow');
    expect(squadType(of('wizard', 'knight', 'fighter'))).toBe('heavy');
  });

  it('is light only when light troops outnumber the rest by one', () => {
    expect(squadType(of('ninja', 'bowman', 'knight'))).toBe('light');
    expect(squadType(of('ninja', 'knight'))).toBe('heavy');
  });

  it('rides when horses outnumber the infantry', () => {
    expect(squadType(of('cavalier', 'cavalier', 'knight'))).toBe('heavyCav');
    expect(squadType(of('scout', 'horsebow', 'knight'))).toBe('lightCav');
    expect(squadType(of('cavalier', 'knight'))).toBe('heavy');
  });

  it('flies when fliers are at least as many, with no horse or grounded giant', () => {
    expect(squadType(of('ghost', 'ghost', 'knight'))).toBe('fly');
    expect(squadType(of('ghost', 'knight', 'fighter'))).not.toBe('fly');
    expect(squadType(of('ghost', 'ghost', 'cavalier'))).not.toBe('fly');
    expect(squadType(of('wyvern', 'golem'))).not.toBe('fly'); // a golem cannot be carried
  });

  it('orders the paces: riders and fliers, then infantry, then the slow', () => {
    expect(moveSpeed('fly')).toBe(moveSpeed('heavyCav'));
    expect(moveSpeed('lightCav')).toBeGreaterThan(moveSpeed('heavy'));
    expect(moveSpeed('light')).toBe(moveSpeed('heavy'));
    expect(moveSpeed('heavy')).toBeGreaterThan(moveSpeed('slow'));
  });
});
