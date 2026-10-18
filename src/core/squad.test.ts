import { describe, expect, it } from 'vitest';
import {
  autoPlace, cellsOf, footprint, makeSquad, marchOf, memberRow, moveSpeed, placeAt, placesUsed, SQUAD_PLACES, squadMemberIds, squadType,
} from './squad';
import { simulateBattle } from './battle';
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

describe('large units', () => {
  const fresh = () => makeSquad('player', [], makeCharacter('fighter', 1), 0, 0, 0, 'large');

  it('stand in two cells side by side and count as two of five places', () => {
    const sq = fresh();
    const golem = makeCharacter('golem', 5);
    expect(autoPlace(sq, golem)).toBe(true);
    const cells = cellsOf(sq, golem.id);
    expect(cells).toHaveLength(2);
    expect(Math.floor(cells[0] / 3)).toBe(Math.floor(cells[1] / 3)); // same grid row
    expect(Math.abs(cells[0] - cells[1])).toBe(1);
    expect(placesUsed(sq)).toBe(2);
    expect(squadMemberIds(sq)).toEqual([golem.id]); // once, though in two cells
  });

  it('fill a squad by places, not heads', () => {
    const sq = fresh();
    expect(autoPlace(sq, makeCharacter('golem', 5))).toBe(true);
    expect(autoPlace(sq, makeCharacter('golem', 5))).toBe(true);
    expect(autoPlace(sq, makeCharacter('fighter', 5))).toBe(true);
    expect(placesUsed(sq)).toBe(SQUAD_PLACES);
    expect(autoPlace(sq, makeCharacter('fighter', 5))).toBe(false);
    const sq2 = fresh();
    for (let i = 0; i < 4; i++) autoPlace(sq2, makeCharacter('fighter', 5));
    expect(autoPlace(sq2, makeCharacter('golem', 5))).toBe(false); // one place left, needs two
    const free = sq2.grid.indexOf(null);
    expect(placeAt(sq2, makeCharacter('fighter', 5), free)).toBe(true); // the fifth place
    const next = sq2.grid.indexOf(null);
    expect(placeAt(sq2, makeCharacter('fighter', 5), next)).toBe(false); // an empty cell, but no sixth place
  });

  it('fight from their foremost cell', () => {
    const sq = fresh();
    const golem = makeCharacter('golem', 5);
    expect(placeAt(sq, golem, 4)).toBe(true); // mid and front of the middle row
    expect(cellsOf(sq, golem.id)).toEqual([4, 5]);
    expect(memberRow(sq, golem.id)).toBe('front');
    expect(placeAt(sq, golem, 3)).toBe(true); // moved back a column
    expect(cellsOf(sq, golem.id)).toEqual([3, 4]);
    expect(memberRow(sq, golem.id)).toBe('mid');
  });

  it('cannot be set down over someone else', () => {
    const sq = fresh();
    const f = makeCharacter('fighter', 5);
    placeAt(sq, f, 5);
    expect(placeAt(sq, makeCharacter('golem', 5), 4)).toBe(false);
    expect(footprint(2, 2)).toEqual([1, 2]); // on the front edge it reaches back
  });

  it('act once a round in battle, though they stand in two cells', () => {
    const chars = new Map<number, Character>();
    const golem = makeCharacter('golem', 9);
    const lead = makeCharacter('fighter', 9);
    for (const c of [golem, lead]) chars.set(c.id, c);
    const ours = makeSquad('player', [], lead, 0, 0, 0, 'ours');
    autoPlace(ours, lead);
    autoPlace(ours, golem);
    const foe = makeCharacter('knight', 30);
    chars.set(foe.id, foe);
    const theirs = makeSquad('enemy', [{ char: foe, cell: 5 }], foe, 0, 0, 0, 'theirs');
    const result = simulateBattle({ squad: ours, chars }, { squad: theirs, chars });
    const turns = result.events.filter((e) => (e.kind === 'act' || e.kind === 'skip') && e.actorId === golem.id);
    expect(turns).toHaveLength(1);
  });
});
