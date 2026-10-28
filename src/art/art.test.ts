import { describe, expect, it } from 'vitest';
import { Raster } from './raster';
import { FOOT_X, FOOT_Y, paintHuman, REST, SLOT } from './humanoid';
import type { HumanLook } from './humanoid';
import { DRAGON, FLOAT_REST, floatBlend, HORSE, HOUND, paintGhost, paintQuad, paintSea, QUAD_REST, quadBlend } from './creatures';
import { floatKeys, framesOf, humanBlend, humanKeys, humanStart, quadKeys } from './motion';
import { figureKindOf, humanLookOf, paletteOf, slotColours } from './looks';
import { ANIMS } from '../gfx3d/sprites';
import { allClasses } from '../data/registry';

const at = (r: Raster, x: number, y: number) => y * r.w + x;

/** What is painted on the raster's top row or side columns (a figure cut off; the feet stand on the bottom). */
function cutOff(r: Raster): string {
  const out: string[] = [];
  for (let x = 0; x < r.w; x++) if (r.filled(x, 0)) out.push(`top ${x}`);
  for (let y = 0; y < r.h; y++) {
    if (r.filled(0, y)) out.push(`left ${y}`);
    if (r.filled(r.w - 1, y)) out.push(`right ${y}`);
  }
  return out.join(', ');
}

/** The lowest painted row. */
function lowest(r: Raster): number {
  for (let y = r.h - 1; y >= 0; y--) for (let x = 0; x < r.w; x++) if (r.filled(x, y)) return y;
  return -1;
}

describe('raster', () => {
  it('paints an ellipse as a dome: facing the viewer in the middle, outward at the rim', () => {
    const r = new Raster(32, 32);
    r.ellipse(16, 16, 8, 8, 0, 1);
    const mid = at(r, 16, 16);
    expect(r.nz[mid]).toBeGreaterThan(0.95);
    expect(r.nx[at(r, 9, 16)]).toBeLessThan(-0.5);
    expect(r.nx[at(r, 23, 16)]).toBeGreaterThan(0.5);
    expect(r.ny[at(r, 16, 9)]).toBeLessThan(-0.5);
    expect(r.filled(2, 2)).toBe(false);
  });

  it('keeps the nearer of two shapes, whichever is drawn first', () => {
    const r = new Raster(32, 32);
    r.ellipse(16, 16, 6, 6, 5, 2);
    r.ellipse(16, 16, 6, 6, 0, 3);
    expect(r.slot[at(r, 16, 16)]).toBe(2);
  });

  it('outlines the silhouette and draws lines where one part stands before another', () => {
    const r = new Raster(40, 40);
    r.ellipse(20, 20, 10, 10, 0, 1, { round: 0 });
    r.beginPart();
    r.ellipse(20, 20, 4, 4, 8, 2, { round: 0 });
    r.outline();
    // Just outside the big disc: an outline pixel in its colour.
    const rim = at(r, 30, 20);
    expect(r.line[rim]).toBe(1);
    expect(r.slot[rim]).toBe(1);
    // Just outside the small disc, on the big one behind it: a line between parts.
    expect(r.line[at(r, 24, 20)]).toBe(2);
    expect(r.line[at(r, 20, 20)]).toBe(0);
  });

  it('makes a picture with a shaded body and darker outline, and a normal map', () => {
    const r = new Raster(24, 24);
    r.ellipse(12, 12, 6, 6, 0, 1);
    r.outline();
    const rgba = r.rgba([[0, 0, 0], [200, 100, 50]]);
    const px = (x: number, y: number) => Array.from(rgba.subarray(at(r, x, y) * 4, at(r, x, y) * 4 + 4));
    expect(px(0, 0)[3]).toBe(0);
    expect(px(12, 12)[3]).toBe(255);
    expect(px(19, 12)[0]).toBeLessThan(px(12, 12)[0] * 0.5);
    // Lit from the upper left: that side is brighter than the lower right.
    expect(px(9, 9)[0]).toBeGreaterThan(px(15, 15)[0]);

    const n = r.normals();
    const nm = (x: number, y: number) => Array.from(n.subarray(at(r, x, y) * 4, at(r, x, y) * 4 + 4));
    expect(nm(0, 0)).toEqual([128, 128, 255, 0]);
    expect(nm(12, 12)[2]).toBeGreaterThan(240);
    // Green runs up: the top of the dome is greener than the bottom.
    expect(nm(12, 7)[1]).toBeGreaterThan(160);
    expect(nm(12, 17)[1]).toBeLessThan(96);
  });
});

describe('motion', () => {
  it('eases between keys, keeping each key its time and its blow', () => {
    const keys = [{ pose: 0, ms: 100, steps: 4 }, { pose: 10, ms: 60, steps: 2, hit: true }];
    const f = framesOf(keys, false, 0, (a, b, t) => a + (b - a) * t);
    expect(f).toHaveLength(6);
    expect(f.reduce((s, x) => s + x.ms, 0)).toBeCloseTo(160);
    expect(f[5].pose).toBe(10);
    expect(f.filter((x) => x.hit)).toEqual([f[5]]);
    // A looping run eases in from its last key.
    const loop = framesOf([{ pose: 0, ms: 10, steps: 2 }, { pose: 8, ms: 10 }], true, 99, (a, b, t) => a + (b - a) * t);
    expect(loop[0].pose).toBe(4);
  });

  it('gives every animation keys, a blow to attacks and casts, and loops only idle and walk', () => {
    for (const anim of ANIMS) {
      for (const weapon of ['sword', 'bow', 'staff', 'spear', 'none'] as const) {
        const { keys, loop } = humanKeys(anim, weapon);
        expect(keys.length).toBeGreaterThan(0);
        expect(loop).toBe(anim === 'idle' || anim === 'walk');
        if (anim === 'attack' || anim === 'cast') expect(keys.some((k) => k.hit)).toBe(true);
      }
      expect(quadKeys(anim, HOUND).keys.length).toBeGreaterThan(0);
      expect(floatKeys(anim).keys.length).toBeGreaterThan(0);
    }
  });
});

describe('figures', () => {
  const humans = allClasses().filter((c) => figureKindOf(c) === 'human' || figureKindOf(c) === 'rider');

  it('dresses every class sensibly', () => {
    for (const def of humans) {
      const look: HumanLook = humanLookOf(def);
      const twoHanded = ['greatsword', 'spear', 'bow', 'staff', 'hammer'].includes(look.weapon);
      if (twoHanded) expect(look.shield, def.id).toBe('none');
      if (look.armour === 'robe' || look.armour === 'dress') expect(look.shield, def.id).toBe('none');
      expect(look.bulk).toBeGreaterThan(0.8);
      expect(look.bulk).toBeLessThan(1.6);
    }
  });

  it('gives every colour slot a colour', () => {
    for (const def of allClasses()) {
      const c = slotColours(paletteOf(def));
      for (const s of Object.values(SLOT)) expect(c[s], `${def.id} slot ${s}`).toHaveLength(3);
    }
  });

  it('paints people standing on their feet, whole, in every frame', () => {
    // Every distinct look among the classes (many share one).
    const looks = new Map(humans.map((def) => [JSON.stringify(humanLookOf(def)), def]));
    for (const def of looks.values()) {
      const look = humanLookOf(def);
      for (const anim of ANIMS) {
        const { keys, loop } = humanKeys(anim, look.weapon);
        for (const f of framesOf(keys, loop, humanStart, humanBlend)) {
          for (const seen of ['front', 'back'] as const) {
            const r = paintHuman(look, f.pose, seen);
            expect(cutOff(r), `${def.id} ${anim} ${seen}`).toBe('');
            if (anim !== 'fall') expect(Math.abs(lowest(r) - FOOT_Y), `${def.id} ${anim}`).toBeLessThanOrEqual(2);
          }
        }
      }
    }
    const r = paintHuman(humanLookOf(humans[0]), REST, 'front');
    expect(r.filled(FOOT_X, FOOT_Y - 30)).toBe(true);
  }, 30000);

  it('paints beasts and spirits whole in every frame', () => {
    for (const spec of [HOUND, DRAGON, HORSE]) {
      for (const anim of ANIMS) {
        const { keys, loop } = quadKeys(anim, spec);
        for (const f of framesOf(keys, loop, QUAD_REST, quadBlend)) {
          for (const seen of ['front', 'back'] as const) {
            const r = paintQuad(spec, f.pose, seen);
            expect(cutOff(r), `${spec.w}x${spec.h} ${anim} ${seen}`).toBe('');
            if (anim !== 'fall') expect(lowest(r), `${spec.w}x${spec.h} ${anim}`).toBeGreaterThanOrEqual(spec.h - 4);
          }
        }
      }
    }
    for (const paint of [paintGhost, paintSea]) {
      for (const anim of ANIMS) {
        const { keys, loop } = floatKeys(anim);
        for (const f of framesOf(keys, loop, FLOAT_REST, floatBlend)) {
          expect(cutOff(paint(f.pose, 'front')), `${paint.name} ${anim}`).toBe('');
        }
      }
    }
  });
});
