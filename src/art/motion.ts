import type { Anim } from '../gfx3d/sprites';
import type { Pose, WeaponKind } from './humanoid';
import { blend, REST, stanceOf } from './humanoid';
import type { FloatPose, QuadPose, QuadSpec } from './creatures';
import { FLOAT_REST, QUAD_REST } from './creatures';

// How a person moves: each animation a few key poses, eased from one to
// the next, each frame held a while. Angles are from straight down (0) to
// straight up (pi), positive forward; see humanoid.ts.

export interface Key {
  pose: Pose;
  /** How long to take getting here from the last key, and hold it, ms. */
  ms: number;
  /** Frames to draw on the way here (1: just the key). */
  steps?: number;
  /** The blow lands at this key. */
  hit?: boolean;
}

type Make = (over: Partial<Pose>) => Pose;

/** Standing ready, breathing: the chest and the weapon rise and settle, the feet planted. */
function idle(P: Make, base: Pose): Key[] {
  const arm = (a: [number, number], d: number): [number, number] => [a[0] + d, a[1] + d * 1.5];
  return [
    { pose: P({}), ms: 260 },
    { pose: P({ lean: base.lean + 0.015, nod: base.nod + 0.02, nearArm: arm(base.nearArm, 0.025), farArm: arm(base.farArm, 0.025) }), ms: 260 },
    { pose: P({ lean: base.lean + 0.03, nod: base.nod + 0.04, nearArm: arm(base.nearArm, 0.05), farArm: arm(base.farArm, 0.05) }), ms: 260 },
    { pose: P({ lean: base.lean + 0.015, nod: base.nod + 0.02, nearArm: arm(base.nearArm, 0.025), farArm: arm(base.farArm, 0.025) }), ms: 260 },
  ];
}

/** A marching step: the legs swinging against each other, the body rising on each stride, the weapon carried as it is held. */
function walk(P: Make, base: Pose): Key[] {
  const keys: Key[] = [];
  const n = 8;
  for (let k = 0; k < n; k++) {
    const phase = (k / n) * Math.PI * 2;
    const s = Math.sin(phase);
    const c = Math.cos(phase);
    keys.push({
      pose: P({
        // The body sinks as the legs spread, so the foot on the ground stays there.
        bob: (1 - Math.cos(0.52 * s)) * 12,
        lean: 0.1,
        nearLeg: [0.52 * s, Math.max(0, -c) * 0.75 + 0.06],
        farLeg: [-0.52 * s, Math.max(0, c) * 0.75 + 0.06],
        nearArm: [base.nearArm[0] - 0.22 * s, base.nearArm[1]],
        farArm: [base.farArm[0] + 0.22 * s, base.farArm[1]],
      }),
      ms: 105,
    });
  }
  return keys;
}

/** A blow with a weapon, by its kind: an overhead swing, a thrust, or a shot from a bow. */
function attack(P: Make, weapon: WeaponKind): Key[] {
  if (weapon === 'bow') {
    return [
      { pose: P({ farArm: [1.45, 0.05], nearArm: [1.25, 1.5], lean: 0.05 }), ms: 140, steps: 2 },
      { pose: P({ farArm: [1.5, 0], nearArm: [1.0, 2.3], lean: -0.05 }), ms: 220, steps: 2 },
      { pose: P({ farArm: [1.5, 0], nearArm: [0.9, 0.6], lean: 0.02 }), ms: 140, hit: true },
      { pose: P({}), ms: 180, steps: 2 },
    ];
  }
  if (weapon === 'spear' || weapon === 'rapier') {
    return [
      { pose: P({ nearArm: [0.8, -0.3], grip: 1.3, lean: -0.05, bob: 1, nearLeg: [0.2, 0.2], farLeg: [-0.3, 0.2] }), ms: 160, steps: 2 },
      { pose: P({ nearArm: [1.45, 0.05], grip: 0.05, lean: 0.3, bob: 2.4, nearLeg: [0.75, 0.55], farLeg: [-0.5, 0.15] }), ms: 120, hit: true },
      { pose: P({ nearArm: [1.2, 0.2], grip: 0.3, lean: 0.15, bob: 1.6 }), ms: 140 },
      { pose: P({}), ms: 180, steps: 2 },
    ];
  }
  return [
    { pose: P({ nearArm: [1.4, 1.2], grip: 0.3, lean: 0.02 }), ms: 90 },
    { pose: P({ nearArm: [3.3, 0.5], farArm: [0.4, 0.6], grip: -0.5, lean: -0.12, nod: -0.1, bob: 0.6 }), ms: 170, steps: 2 },
    { pose: P({ nearArm: [1.3, 0.25], farArm: [-0.3, 0.4], grip: 0.25, lean: 0.3, bob: 2.4, nearLeg: [0.72, 0.5], farLeg: [-0.5, 0.2] }), ms: 110, hit: true },
    { pose: P({ nearArm: [0.45, 0.25], grip: 0.7, lean: 0.22, bob: 2 }), ms: 140 },
    { pose: P({}), ms: 200, steps: 2 },
  ];
}

/** A spell: arms raised, light gathering in the hands, then thrown forward. */
function cast(P: Make, base: Pose): Key[] {
  return [
    { pose: P({ nearArm: [2.1, 0.35], farArm: [1.9, 0.35], grip: -1.0, glow: 0.3 }), ms: 160, steps: 2 },
    { pose: P({ nearArm: [2.7, 0.2], farArm: [2.5, 0.2], grip: -1.2, glow: 1, bob: base.bob - 0.3, nod: -0.15 }), ms: 240, steps: 2 },
    { pose: P({ nearArm: [1.5, 0.1], farArm: [1.35, 0.15], grip: -0.2, glow: 0.7, lean: 0.2, bob: base.bob + 0.6 }), ms: 150, hit: true },
    { pose: P({}), ms: 200, steps: 2 },
  ];
}

/** Struck: thrown back a moment. */
function hit(P: Make, base: Pose): Key[] {
  return [
    { pose: P({ lean: -0.32, nod: -0.35, bob: base.bob + 0.4, nearArm: [-0.35, 0.9], farArm: [-0.6, 0.6], nearLeg: [0.25, 0.25], farLeg: [-0.4, 0.2] }), ms: 130 },
    { pose: P({ lean: -0.12, nod: -0.1 }), ms: 120 },
  ];
}

/** Brought down: to the knees (the stage then lays the figure on the ground). */
function fall(P: Make): Key[] {
  return [
    { pose: P({ lean: -0.2, nod: -0.3, bob: 1.8, nearArm: [-0.2, 0.4], farArm: [-0.4, 0.4] }), ms: 160 },
    { pose: P({ lean: 0.35, nod: 0.25, bob: 6.5, nearArm: [0.15, 0.2], farArm: [-0.05, 0.2], nearLeg: [1.0, 1.9], farLeg: [-0.1, 1.6], grip: 0.9 }), ms: 900 },
  ];
}

export function humanKeys(anim: Anim, weapon: WeaponKind): { keys: Key[]; loop: boolean } {
  const base = stanceOf(weapon);
  const P: Make = (over) => ({ ...base, ...over });
  switch (anim) {
    case 'idle': return { keys: upright(idle(P, base), weapon), loop: true };
    case 'walk': return { keys: upright(walk(P, base), weapon), loop: true };
    case 'attack': return { keys: attack(P, weapon), loop: false };
    case 'cast': return { keys: cast(P, base), loop: false };
    case 'hit': return { keys: upright(hit(P, base), weapon), loop: false };
    case 'fall': return { keys: fall(P), loop: false };
  }
}

/** A staff is carried upright at rest, not trailed along the ground. */
function upright(keys: Key[], weapon: WeaponKind): Key[] {
  if (weapon !== 'staff') return keys;
  return keys.map((k) => ({ ...k, pose: { ...k.pose, grip: Math.PI - 0.12 - (k.pose.nearArm[0] + k.pose.nearArm[1]) } }));
}

/**
 * The frames of a run of keys: the in-between poses eased (slow in, slow
 * out) and each held its share of the key's time. A looping run eases from
 * its last key back to its first.
 */
export function framesOf<T>(keys: { pose: T; ms: number; steps?: number; hit?: boolean }[], loop: boolean, start: T, mix: (a: T, b: T, t: number) => T): { pose: T; ms: number; hit: boolean }[] {
  const out: { pose: T; ms: number; hit: boolean }[] = [];
  let prev = loop ? keys[keys.length - 1].pose : start;
  for (const k of keys) {
    const steps = Math.max(1, k.steps ?? 1);
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const eased = t * t * (3 - 2 * t);
      out.push({ pose: s === steps ? k.pose : mix(prev, k.pose, eased), ms: k.ms / steps, hit: !!k.hit && s === steps });
    }
    prev = k.pose;
  }
  return out;
}

export const humanStart = REST;
export const humanBlend = blend;

// ------------------------------------------------------------- creatures --

const Q = (over: Partial<QuadPose>): QuadPose => ({ ...QUAD_REST, ...over });
const legs = (nf: number, ff: number, nb: number, fb: number, bend = 0): [number, number][] =>
  [[nf, bend], [ff, bend], [nb, bend], [fb, bend]];

/** How a four-legged creature moves: it breathes, trots, lunges and bites, breathes fire, flinches, falls. */
export function quadKeys(anim: Anim, spec: QuadSpec): { keys: { pose: QuadPose; ms: number; steps?: number; hit?: boolean }[]; loop: boolean } {
  const winged = !!spec.wings;
  switch (anim) {
    case 'idle':
      return {
        loop: true,
        keys: [0, 1, 2, 3].map((k) => ({
          pose: Q({ bob: [0, 0.6, 1, 0.6][k], tail: Math.sin((k / 4) * Math.PI * 2) * 0.35, flap: winged ? 0.3 + [0, 0.05, 0.1, 0.05][k] : 0.3, neck: 0.55 + [0, 0.03, 0.05, 0.03][k] }),
          ms: 280,
        })),
      };
    case 'walk': {
      const n = 8;
      return {
        loop: true,
        keys: Array.from({ length: n }, (_, k) => {
          const ph = (k / n) * Math.PI * 2;
          const s = Math.sin(ph) * 0.5;
          const c = Math.cos(ph);
          return {
            pose: Q({
              bob: Math.abs(c) < 0.5 ? 0 : 1,
              legs: [[s, Math.max(0, -c) * 0.8], [-s, Math.max(0, c) * 0.8], [-s, Math.max(0, c) * 0.6], [s, Math.max(0, -c) * 0.6]],
              tail: Math.sin(ph) * 0.4,
              flap: winged ? 0.3 + Math.sin(ph) * 0.15 : 0.3,
            }),
            ms: 100,
          };
        }),
      };
    }
    case 'attack':
      return {
        loop: false,
        keys: [
          { pose: Q({ bob: 2, shift: -2.5, neck: 0.25, pitch: 0.05, legs: legs(0.2, 0.25, -0.3, -0.25, 0.4), tail: 0.4, flap: winged ? 0 : 0.3 }), ms: 180, steps: 2 },
          { pose: Q({ bob: 0, shift: 6, neck: 0.05, pitch: 0.12, jaw: 1, legs: legs(0.85, 0.7, -0.5, -0.45, 0.1), tail: -0.3, flap: winged ? 0.9 : 0.3 }), ms: 130, hit: true },
          { pose: Q({ shift: 3, neck: 0.3, jaw: 0.4, legs: legs(0.4, 0.35, -0.2, -0.15, 0.2), flap: winged ? 0.6 : 0.3 }), ms: 150 },
          { pose: Q({}), ms: 200, steps: 2 },
        ],
      };
    case 'cast':
      return {
        loop: false,
        keys: [
          { pose: Q({ neck: 1.1, pitch: -0.12, jaw: 0.3, glow: 0.4, legs: legs(0.25, 0.2, -0.1, -0.1, 0.3), flap: winged ? 0 : 0.3 }), ms: 220, steps: 2 },
          { pose: Q({ neck: 0.15, pitch: 0.08, shift: 2, jaw: 1, glow: 1, flap: winged ? 0.8 : 0.3 }), ms: 200, hit: true },
          { pose: Q({ neck: 0.3, jaw: 0.5, glow: 0.4 }), ms: 160 },
          { pose: Q({}), ms: 200, steps: 2 },
        ],
      };
    case 'hit':
      return {
        loop: false,
        keys: [
          { pose: Q({ shift: -3, pitch: -0.15, neck: 0.95, jaw: 0.6, legs: legs(-0.3, -0.2, 0.1, 0.15, 0.2), tail: 0.5 }), ms: 140 },
          { pose: Q({ shift: -1, neck: 0.65 }), ms: 120 },
        ],
      };
    case 'fall':
      return {
        loop: false,
        keys: [
          { pose: Q({ shift: -2, pitch: -0.1, neck: 0.9, jaw: 0.5 }), ms: 160 },
          { pose: Q({ bob: spec.legUp * 0.9, pitch: 0.1, neck: -0.1, legs: legs(1.2, 1.1, -1.0, -0.9, 1.8), tail: 0, flap: winged ? 1 : 0.3 }), ms: 900 },
        ],
      };
  }
}

const F = (over: Partial<FloatPose>): FloatPose => ({ ...FLOAT_REST, ...over });

/** How a floating thing moves: it drifts, reaches, gathers a spell, flinches, sinks. */
export function floatKeys(anim: Anim): { keys: { pose: FloatPose; ms: number; steps?: number; hit?: boolean }[]; loop: boolean } {
  switch (anim) {
    case 'idle':
    case 'walk': {
      const n = anim === 'walk' ? 6 : 4;
      return {
        loop: true,
        keys: Array.from({ length: n }, (_, k) => ({
          pose: F({ rise: 4 + Math.sin((k / n) * Math.PI * 2) * 1.5, wave: (k / n) * Math.PI * 2, lean: anim === 'walk' ? 0.25 : 0 }),
          ms: anim === 'walk' ? 120 : 260,
        })),
      };
    }
    case 'attack':
      return {
        loop: false,
        keys: [
          { pose: F({ lean: -0.3, reach: 0, wave: 1 }), ms: 180, steps: 2 },
          { pose: F({ lean: 0.6, reach: 1, wave: 2.5, rise: 3 }), ms: 130, hit: true },
          { pose: F({ lean: 0.3, reach: 0.5, wave: 3.5 }), ms: 150 },
          { pose: F({ wave: 4.5 }), ms: 200, steps: 2 },
        ],
      };
    case 'cast':
      return {
        loop: false,
        keys: [
          { pose: F({ rise: 7, reach: 0.6, glow: 0.5, wave: 1 }), ms: 220, steps: 2 },
          { pose: F({ rise: 6, lean: 0.3, reach: 1, glow: 1, wave: 2 }), ms: 180, hit: true },
          { pose: F({ reach: 0.4, glow: 0.3, wave: 3 }), ms: 160 },
          { pose: F({ wave: 4 }), ms: 200, steps: 2 },
        ],
      };
    case 'hit':
      return {
        loop: false,
        keys: [
          { pose: F({ lean: -0.5, rise: 5, wave: 1 }), ms: 140 },
          { pose: F({ lean: -0.2, wave: 2 }), ms: 120 },
        ],
      };
    case 'fall':
      return {
        loop: false,
        keys: [
          { pose: F({ lean: -0.4, rise: 6, wave: 1 }), ms: 160 },
          { pose: F({ lean: 0.2, rise: 0, reach: 0, wave: 2 }), ms: 900 },
        ],
      };
  }
}
