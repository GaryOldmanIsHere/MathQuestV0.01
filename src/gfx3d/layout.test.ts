import { describe, expect, it } from 'vitest';
import { cameraPosition, focusOn, placements, WIDE } from './layout';
import { autoPlace, makeSquad } from '../core/squad';
import { makeCharacter } from '../core/character';

describe('battlefield placement', () => {
  const squad = () => {
    const lead = makeCharacter('knight', 5);
    const sq = makeSquad('player', [], lead, 0, 0, 0, 's');
    autoPlace(sq, lead); // front
    const wiz = makeCharacter('wizard', 5);
    autoPlace(sq, wiz); // back
    const golem = makeCharacter('golem', 5);
    autoPlace(sq, golem); // two cells
    return { sq, lead, wiz, golem };
  };

  it('puts the front rank nearest the centre line, on each side', () => {
    const { sq, lead, wiz } = squad();
    const left = placements(sq, 'left');
    const right = placements(sq, 'right');
    expect(Math.abs(left.get(lead.id)!.x)).toBeLessThan(Math.abs(left.get(wiz.id)!.x));
    expect(left.get(lead.id)!.x).toBeLessThan(0);
    expect(right.get(lead.id)!.x).toBeGreaterThan(0);
    expect(left.get(lead.id)!.facing).toBe(1);
    expect(right.get(lead.id)!.facing).toBe(-1);
  });

  it('stands a large unit between its two cells', () => {
    const { sq, golem } = squad();
    const p = placements(sq, 'left').get(golem.id)!;
    expect(p.large).toBe(true);
    // halfway between two columns: not on a column line
    const cols = [0, 1, 2].map((c) => -(1.9 + (2 - c) * 1.7));
    expect(cols.some((x) => Math.abs(x - p.x) < 1e-9)).toBe(false);
  });
});

describe('cameras', () => {
  it('places the wide shot in front of and above the field', () => {
    const [x, y, z] = cameraPosition(WIDE);
    expect(Math.abs(x)).toBeLessThan(1e-9);
    expect(y).toBeGreaterThan(2);
    expect(z).toBeGreaterThan(10);
  });

  it('closes in on an actor, swung toward its side', () => {
    const shot = focusOn({ x: -4, z: 0, facing: 1, large: false });
    expect(shot.distance).toBeLessThan(WIDE.distance);
    expect(cameraPosition(shot)[0]).toBeLessThan(0);
  });
});
