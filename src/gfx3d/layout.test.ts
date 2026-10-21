import { describe, expect, it } from 'vitest';
import { ASPECT, CELL_X, CELL_Z, cameraPosition, focusOn, FOV, frameAction, GAP, placements, ROW_SHEAR, WIDE } from './layout';
import type { Placement, Shot } from './layout';
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
    // halfway between two columns: not on a column line of its row
    const shear = (p.z / CELL_Z) * ROW_SHEAR;
    const cols = [0, 1, 2].map((c) => -(GAP + (2 - c) * CELL_X) + shear);
    expect(cols.some((x) => Math.abs(x - p.x) < 1e-9)).toBe(false);
  });

  it('sets each row on the diagonal, so no unit stands straight behind another', () => {
    const lead = makeCharacter('knight', 5);
    const sq = makeSquad('player', [], lead, 0, 0, 0, 's');
    const others = [0, 1, 2].map(() => makeCharacter('fighter', 3));
    // One unit in each row of the front column.
    sq.grid = new Array(9).fill(null);
    [lead, ...others].slice(0, 3).forEach((c, row) => {
      sq.grid[row * 3 + 2] = c.id;
    });
    for (const side of ['left', 'right'] as const) {
      const ps = [...placements(sq, side).values()].sort((a, b) => a.z - b.z);
      expect(ps).toHaveLength(3);
      expect(ps[1].x - ps[0].x).toBeCloseTo(ROW_SHEAR, 9);
      expect(ps[2].x - ps[1].x).toBeCloseTo(ROW_SHEAR, 9);
    }
  });
});

/** Every point within the camera's frame, with a margin to spare. */
function inFrame(shot: Shot, pts: Placement[]): boolean {
  const cam = cameraPosition(shot);
  const fwd = shot.target.map((t, i) => t - cam[i]);
  const len = Math.hypot(...fwd);
  const f = fwd.map((v) => v / len);
  const right = [f[2] * -1, 0, f[0]].map((v) => v / Math.hypot(f[0], f[2]));
  const halfH = Math.tan((FOV / 2) * (Math.PI / 180)) * ASPECT;
  return pts.every((p) => {
    const d = [p.x - cam[0], 0.8 - cam[1], p.z - cam[2]];
    const depth = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    const across = d[0] * right[0] + d[2] * right[2];
    return depth > 0 && Math.abs(across / depth) < halfH * 0.95;
  });
}

describe('cameras', () => {
  it('places the wide shot in front of and above the field, a little to the attackers\' side', () => {
    const [x, y, z] = cameraPosition(WIDE);
    expect(x).toBeLessThan(0);
    expect(x).toBeGreaterThan(-z / 2);
    expect(y).toBeGreaterThan(2);
    expect(z).toBeGreaterThan(10);
  });

  it('frames an actor with everyone it acts on, however far apart', () => {
    const at = (x: number, z: number, large = false): Placement => ({ x, z, facing: 1, large });
    const actor = at(-5.3, -2.4);
    const cases = [[at(1.9, 0)], [at(1.9, 2.4), at(5.3, -2.4), at(3.6, 0, true)], [at(7, 2.4)]];
    for (const targets of cases) {
      const shot = frameAction(actor, targets);
      expect(inFrame(shot, [actor, ...targets])).toBe(true);
    }
    // A lone actor is closer than one acting across the field.
    expect(frameAction(actor, []).distance).toBeLessThan(frameAction(actor, [at(7, 2.4)]).distance);
  });

  it('closes in on an actor from the same diagonal, whichever side it is on', () => {
    for (const facing of [1, -1] as const) {
      const shot = focusOn({ x: facing * -4, z: 0, facing, large: false });
      expect(shot.distance).toBeLessThan(WIDE.distance);
      expect(shot.azimuth).toBe(WIDE.azimuth);
    }
  });

  it('shows each nearer row further right on screen, from every shot', () => {
    const lead = makeCharacter('knight', 5);
    const sq = makeSquad('player', [], lead, 0, 0, 0, 's');
    const others = [0, 1].map(() => makeCharacter('fighter', 3));
    sq.grid = new Array(9).fill(null);
    [lead, ...others].forEach((c, row) => {
      sq.grid[row * 3] = c.id;
    });
    const ps = [...placements(sq, 'left').values()].sort((a, b) => a.z - b.z);
    for (const shot of [WIDE, focusOn(ps[0]), frameAction(ps[0], [{ x: 4, z: 2.4, facing: -1, large: false }])]) {
      const cam = cameraPosition(shot);
      const fwd = [shot.target[0] - cam[0], shot.target[2] - cam[2]];
      const right = [-fwd[1], fwd[0]];
      const onScreen = ps.map((p) => p.x * right[0] + p.z * right[1]);
      expect(onScreen[1] - onScreen[0]).toBeGreaterThan(1);
      expect(onScreen[2] - onScreen[1]).toBeGreaterThan(1);
    }
  });
});
