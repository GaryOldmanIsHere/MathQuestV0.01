import { normalize3, Raster } from './raster';
import { SLOT } from './humanoid';

// The beasts, painted as the people are (see humanoid.ts): on four legs, a
// hound, a dragon or a horse; or floating, a ghost; or reaching up from the
// water, a creature of the sea. Seen three-quarters on: from the front
// facing left, or from behind facing right.

/** Which colour slot each part of a creature takes. */
type SlotMap = Record<keyof typeof SLOT, number>;

export interface QuadSpec {
  w: number;
  h: number;
  /** Body length and the height of the back above the ground. */
  len: number;
  back: number;
  /** The body's depth, top to belly. */
  girth: number;
  legUp: number;
  legLow: number;
  neck: number;
  head: number;
  snout: number;
  tail: number;
  wings?: boolean;
  horns?: boolean;
  ears?: boolean;
  mane?: boolean;
  hooves?: boolean;
  /** How much higher than a hound's the neck is carried at rest (a horse's stands up). */
  neckLift?: number;
  /** Colour slots of its own, in place of the class's (a horse's coat under its rider). */
  slots?: Partial<SlotMap>;
}

export const HOUND: QuadSpec = { w: 64, h: 50, len: 26, back: 20, girth: 6.5, legUp: 7, legLow: 6.5, neck: 8, head: 5.5, snout: 6, tail: 13, ears: true };
export const DRAGON: QuadSpec = { w: 120, h: 100, len: 44, back: 34, girth: 12, legUp: 12, legLow: 11, neck: 20, head: 8.5, snout: 10, tail: 26, wings: true, horns: true };
/** A horse's coat, mane, belly and hooves are its own colours (see HORSE_SLOT). */
export const HORSE_SLOT = { coat: 12, blaze: 13, mane: 14, hoof: 15 } as const;
export const HORSE: QuadSpec = {
  w: 72, h: 80, len: 32, back: 26, girth: 8, legUp: 9.5, legLow: 9.5, neck: 14, head: 5, snout: 9.5, tail: 14, mane: true, ears: true, hooves: true,
  neckLift: 0.45,
  slots: { armour: HORSE_SLOT.coat, trim: HORSE_SLOT.blaze, hair: HORSE_SLOT.mane, dark: HORSE_SLOT.hoof, eye: HORSE_SLOT.hoof },
};

export interface QuadPose {
  bob: number;
  /** The body tipped nose-down (radians). */
  pitch: number;
  /** Moved forward, pixels. */
  shift: number;
  /** The neck's rise from level, radians. */
  neck: number;
  /** The mouth open, 0 to 1. */
  jaw: number;
  /** Near front, far front, near hind, far hind: [hip angle, knee bend]. */
  legs: [number, number][];
  tail: number;
  /** Wings: 0 folded high, 1 swept down. */
  flap: number;
  glow: number;
}

export const QUAD_REST: QuadPose = {
  bob: 0, pitch: 0, shift: 0, neck: 0.55, jaw: 0, legs: [[0.05, 0], [-0.05, 0], [0.05, 0], [-0.05, 0]], tail: 0, flap: 0.3, glow: 0,
};

export function quadBlend(a: QuadPose, b: QuadPose, t: number): QuadPose {
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    bob: n(a.bob, b.bob), pitch: n(a.pitch, b.pitch), shift: n(a.shift, b.shift), neck: n(a.neck, b.neck), jaw: n(a.jaw, b.jaw),
    legs: a.legs.map((l, i) => [n(l[0], b.legs[i][0]), n(l[1], b.legs[i][1])] as [number, number]),
    tail: n(a.tail, b.tail), flap: n(a.flap, b.flap), glow: n(a.glow, b.glow),
  };
}

/** Where a four-legged body's saddle lies in a pose, for a rider (facing `dir`). */
export function saddleOf(spec: QuadSpec, pose: QuadPose, dir: number): [number, number] {
  const ground = spec.h - 3;
  const cx = spec.w / 2 + dir * pose.shift;
  const by = ground - spec.back + spec.girth * 0.55 + pose.bob;
  return [cx - dir * 2, by - spec.girth * 0.9];
}

/** Paint a four-legged creature, into `into` if given (a horse under its rider). */
export function paintQuad(spec: QuadSpec, pose: QuadPose, seen: 'front' | 'back', into?: Raster): Raster {
  const r = into ?? new Raster(spec.w, spec.h);
  const S: SlotMap = { ...SLOT, ...spec.slots };
  const dir = seen === 'front' ? -1 : 1;
  const ground = spec.h - 3;
  const cx = spec.w / 2 + dir * pose.shift;
  const by = ground - spec.back + spec.girth * 0.55 + pose.bob;
  const half = spec.len / 2;
  const tip = (x: number, y: number): [number, number] => {
    // The body pitched about its middle.
    const s = Math.sin(pose.pitch);
    const c = Math.cos(pose.pitch);
    const ox = x - cx;
    const oy = y - by;
    return [cx + ox * c - oy * s * dir, by + oy * c + ox * s * dir];
  };
  const front = tip(cx + dir * half * 0.62, by);
  const rear = tip(cx - dir * half * 0.62, by);
  const Z_FAR = 0;
  const Z_BODY = 10;
  const Z_NEAR = 18;

  const legAt = (hip: [number, number], [a, bend]: [number, number], z: number, w: number) => {
    const knee: [number, number] = [hip[0] + Math.sin(a) * dir * spec.legUp, hip[1] + Math.cos(a) * spec.legUp];
    const la = a - bend;
    const foot: [number, number] = [knee[0] + Math.sin(la) * dir * spec.legLow, knee[1] + Math.cos(la) * spec.legLow];
    r.capsule(hip[0], hip[1], knee[0], knee[1], w * 1.25, w, z, S.armour);
    r.capsule(knee[0], knee[1], foot[0], Math.min(ground, foot[1]), w, w * 0.8, z + 0.5, S.armour);
    if (spec.hooves) r.ellipse(foot[0] + dir * 0.6, Math.min(ground, foot[1]) - 0.5, w * 1.05, w * 0.75, z + 1, S.dark);
    else r.ellipse(foot[0] + dir * 1.2, Math.min(ground, foot[1]) - 0.8, w * 1.3, w * 0.8, z + 1, S.armour);
  };
  const legW = spec.girth * 0.3;

  // The far wing, behind everything.
  if (spec.wings) {
    r.beginPart();
    wing(r, S, spec, front, dir, pose.flap, Z_FAR - 3, -1);
  }
  // The far legs.
  r.beginPart();
  legAt([front[0] - dir * 3, front[1] + spec.girth * 0.3], pose.legs[1], Z_FAR, legW * 0.95);
  r.beginPart();
  legAt([rear[0] - dir * 3, rear[1] + spec.girth * 0.25], pose.legs[3], Z_FAR, legW * 1.05);

  // The tail, swinging.
  r.beginPart();
  let prev: [number, number] = tip(cx - dir * half * 0.9, by - spec.girth * 0.3);
  const segs = 6;
  for (let k = 1; k <= segs; k++) {
    const t = k / segs;
    const sway = Math.sin(t * 2.4 + pose.tail * 3) * pose.tail * spec.tail * 0.35;
    const p: [number, number] = [prev[0] - dir * spec.tail / segs * (1 - t * 0.2), prev[1] + (spec.wings ? 1.2 : -0.6) * (spec.tail / segs) * (t < 0.5 ? 0.6 : 1) + sway];
    const w0 = spec.girth * (0.42 - t * 0.32);
    r.capsule(prev[0], prev[1], p[0], p[1], Math.max(0.8, w0 + 0.3), Math.max(0.6, w0), Z_BODY - 2 + t * 0.5, spec.mane ? S.hair : S.armour);
    prev = p;
  }
  if (spec.wings) r.polygon([[prev[0], prev[1] - 3], [prev[0] - dir * 5, prev[1]], [prev[0], prev[1] + 3]], Z_BODY - 1, S.hair, { bevel: 1 });

  // The body: haunch, barrel, chest; a paler belly.
  r.beginPart();
  r.ellipse(cx, by, half, spec.girth, Z_BODY, S.armour);
  r.ellipse(rear[0], rear[1] - 0.5, spec.girth * 1.05, spec.girth * 1.05, Z_BODY + 1, S.armour);
  r.ellipse(front[0], front[1] - 1, spec.girth * 1.1, spec.girth * 1.15, Z_BODY + 1.5, S.armour);
  r.ellipse(cx + dir * 2, by + spec.girth * 0.55, half * 0.75, spec.girth * 0.4, Z_BODY + 1.6, S.trim, { round: 0.6 });
  if (spec.wings) {
    // Spines down the back.
    for (let k = 0; k < 6; k++) {
      const p = tip(cx + dir * (half * 0.6 - k * spec.len * 0.17), by - spec.girth * 0.95);
      r.polygon([[p[0] - 2.2, p[1] + 1], [p[0] + 2.2, p[1] + 1], [p[0] + dir * 1.2, p[1] - 4]], Z_BODY + 2, S.hair, { bevel: 0.8 });
    }
  }

  // The near legs.
  r.beginPart();
  legAt([rear[0] + dir * 1, rear[1] + spec.girth * 0.3], pose.legs[2], Z_NEAR, legW * 1.1);
  r.beginPart();
  legAt([front[0] + dir * 1, front[1] + spec.girth * 0.35], pose.legs[0], Z_NEAR, legW);

  // The neck and head, rising from the chest.
  r.beginPart();
  const neckBase = tip(front[0] + dir * spec.girth * 0.4, front[1] - spec.girth * 0.55);
  const rise = pose.neck + (spec.neckLift ?? 0) - pose.pitch;
  const neckTop: [number, number] = [neckBase[0] + dir * Math.cos(rise) * spec.neck, neckBase[1] - Math.sin(rise) * spec.neck];
  r.capsule(neckBase[0], neckBase[1], neckTop[0], neckTop[1], spec.girth * 0.62, spec.head * 0.62, Z_BODY + 4, S.armour);
  if (spec.mane) {
    r.beginPart();
    r.capsule(neckBase[0] - dir * 1.5, neckBase[1] - spec.girth * 0.4, neckTop[0] - dir * 1.5, neckTop[1] - spec.head * 0.6, 2.4, 2, Z_BODY + 4.5, S.hair);
  }
  r.beginPart();
  head(r, S, spec, neckTop, rise, pose, dir, seen, Z_BODY + 7);

  // The near wing, over the body.
  if (spec.wings) {
    r.beginPart();
    wing(r, S, spec, front, dir, pose.flap, Z_NEAR + 4, 1);
  }
  if (!into) r.outline();
  return r;
}

function head(r: Raster, S: SlotMap, spec: QuadSpec, at: [number, number], rise: number, pose: QuadPose, dir: number, seen: 'front' | 'back', z: number): void {
  const [x, y] = at;
  const down = Math.max(-0.4, 0.35 - rise * 0.5);
  const muzzle: [number, number] = [x + dir * Math.cos(down) * spec.snout, y + Math.sin(down) * spec.snout];
  r.ellipse(x, y, spec.head, spec.head * 0.92, z, S.armour);
  r.capsule(x + dir * 1, y + 0.5, muzzle[0], muzzle[1], spec.head * 0.62, spec.head * 0.42, z + 1, S.armour);
  // The lower jaw drops as the mouth opens.
  const jawA = down + pose.jaw * 0.7;
  const jawTip: [number, number] = [x + dir * Math.cos(jawA) * spec.snout * 0.9, y + spec.head * 0.35 + Math.sin(jawA) * spec.snout * 0.9];
  r.capsule(x + dir * 1, y + spec.head * 0.35, jawTip[0], jawTip[1], spec.head * 0.4, spec.head * 0.28, z + 0.8, S.armour);
  if (pose.jaw > 0.3) {
    r.beginPart();
    r.ellipse((muzzle[0] + jawTip[0]) / 2, (muzzle[1] + jawTip[1]) / 2 + 0.5, spec.head * 0.35, spec.head * 0.3 * pose.jaw, z + 0.5, S.dark, { round: 0.3 });
  }
  if (pose.glow > 0.05) {
    r.beginPart();
    r.ellipse(muzzle[0] + dir * 2, muzzle[1] + 1, 2 + pose.glow * spec.head * 0.6, 2 + pose.glow * spec.head * 0.6, z + 6, S.glow, { round: 0.3 });
  }
  if (spec.ears) {
    r.beginPart();
    const ex = x - dir * spec.head * 0.25;
    r.polygon([[ex - 2, y - spec.head * 0.6], [ex + 2, y - spec.head * 0.7], [ex - dir * 1.5, y - spec.head * 1.6]], z - 0.5, S.hair, { bevel: 0.8 });
  }
  if (spec.horns) {
    r.beginPart();
    for (const o of [-1.5, 1.5]) {
      r.capsule(x - dir * 2 + o, y - spec.head * 0.6, x - dir * (spec.head * 1.3) + o, y - spec.head * 1.5, 1.6, 0.5, z + 1.5 + o, S.skin);
    }
  }
  if (seen === 'front') {
    r.beginPart();
    r.ellipse(x + dir * spec.head * 0.35, y - spec.head * 0.25, 1.1, 1, z + spec.head + 2, S.eye, { round: 0.2 });
  }
}

function wing(r: Raster, S: SlotMap, spec: QuadSpec, shoulder: [number, number], dir: number, flap: number, z: number, side: number): void {
  // A bat's wing: a bony arm up and back from the shoulder, three long
  // fingers fanning from its wrist, and the membrane stretched between
  // them, scalloped at its trailing edge, down to the flank.
  const base: [number, number] = [shoulder[0] - dir * 2, shoulder[1] - spec.girth * 0.75];
  const lift = 1.15 - flap * 1.0;
  const span = spec.len * (side > 0 ? 1.05 : 0.85);
  const wrist: [number, number] = [base[0] - dir * span * 0.28, base[1] - Math.sin(lift) * span * 0.55 - 2];
  const fingers: [number, number][] = [0, 1, 2].map((k) => {
    const a = lift - 0.25 - k * 0.42;
    return [wrist[0] - dir * Math.cos(a) * span * (0.62 - k * 0.08), wrist[1] - Math.sin(a) * span * (0.5 - k * 0.1) + k * 2];
  });
  const flank: [number, number] = [base[0] - dir * span * 0.45, base[1] + spec.girth * 0.5];
  // The membrane, panel by panel, each sagging between its bones.
  const panels: [number, number][][] = [
    [base, wrist, fingers[0], [(fingers[0][0] + fingers[1][0]) / 2 + dir * 2, (fingers[0][1] + fingers[1][1]) / 2 + 3]],
    [wrist, fingers[1], [(fingers[1][0] + fingers[2][0]) / 2 + dir * 2, (fingers[1][1] + fingers[2][1]) / 2 + 3], fingers[0]],
    [wrist, fingers[2], [(fingers[2][0] + flank[0]) / 2 + dir * 1, (fingers[2][1] + flank[1]) / 2 + 3], fingers[1]],
    [base, wrist, fingers[2], flank],
  ];
  for (const panel of panels) r.polygon(panel, z, S.trim, { normal: [-dir * 0.15, -0.25 + flap * 0.5, 1], bevel: 1.2 });
  r.capsule(base[0], base[1], wrist[0], wrist[1], 2, 1.5, z + 1, S.armour);
  for (const f of fingers) r.capsule(wrist[0], wrist[1], f[0], f[1], 1.2, 0.5, z + 1, S.armour);
  r.polygon([[wrist[0] - 1.5, wrist[1]], [wrist[0] + 1.5, wrist[1]], [wrist[0] + dir * 1, wrist[1] - 4]], z + 1.5, S.skin, { bevel: 0.5 });
}

// ------------------------------------------------------------------ ghost --

export const GHOST_W = 48;
export const GHOST_H = 64;

export interface FloatPose {
  /** Lifted off the ground, pixels. */
  rise: number;
  lean: number;
  /** Arms (or tentacles) reaching forward, 0 to 1. */
  reach: number;
  /** The ripple of the hem (or tentacles), a phase. */
  wave: number;
  glow: number;
}

export const FLOAT_REST: FloatPose = { rise: 4, lean: 0, reach: 0.15, wave: 0, glow: 0 };

export function floatBlend(a: FloatPose, b: FloatPose, t: number): FloatPose {
  const n = (x: number, y: number) => x + (y - x) * t;
  return { rise: n(a.rise, b.rise), lean: n(a.lean, b.lean), reach: n(a.reach, b.reach), wave: n(a.wave, b.wave), glow: n(a.glow, b.glow) };
}

export function paintGhost(pose: FloatPose, seen: 'front' | 'back'): Raster {
  const r = new Raster(GHOST_W, GHOST_H);
  const dir = seen === 'front' ? -1 : 1;
  const cx = 24 + dir * pose.lean * 4;
  const top = 12 - pose.rise;
  // A shroud, wide at the shoulders, its hem trailing in tatters.
  r.beginPart();
  const hem: [number, number][] = [];
  for (let k = 0; k <= 6; k++) {
    const t = k / 6;
    const x = cx + 11 - t * 22 - dir * 4;
    hem.push([x, 50 - pose.rise + Math.sin(t * 9 + pose.wave) * 3 + (k % 2) * 3]);
  }
  r.polygon([[cx - 9, top + 8], [cx + 9, top + 8], ...hem], 10, SLOT.armour, { normal: [0, 0, 1], bevel: 4 });
  r.ellipse(cx, top + 7, 9, 9, 12, SLOT.armour);
  // Arms reaching out of the shroud.
  r.beginPart();
  const sh: [number, number] = [cx + dir * 5, top + 15];
  const hand: [number, number] = [sh[0] + dir * (6 + pose.reach * 9), sh[1] + 7 - pose.reach * 7];
  r.capsule(sh[0], sh[1], hand[0], hand[1], 2.8, 1.8, 20, SLOT.armour);
  r.ellipse(hand[0], hand[1], 2.2, 2, 21, SLOT.trim);
  if (seen === 'front') {
    r.beginPart();
    r.ellipse(cx + dir * 2.5, top + 6, 1.8, 2.4, 30, SLOT.dark, { round: 0.2 });
    r.ellipse(cx + dir * 6.5, top + 6, 1.4, 2.2, 29, SLOT.dark, { round: 0.2 });
    r.ellipse(cx + dir * 4.5, top + 11, 1.5, 1.4, 29, SLOT.dark, { round: 0.2 });
  }
  if (pose.glow > 0.05) {
    r.beginPart();
    r.ellipse(hand[0] + dir * 2, hand[1], 2 + pose.glow * 3, 2 + pose.glow * 3, 32, SLOT.glow, { round: 0.3 });
  }
  r.outline();
  return r;
}

// -------------------------------------------------------------------- sea --

export const SEA_W = 64;
export const SEA_H = 64;

export function paintSea(pose: FloatPose, seen: 'front' | 'back'): Raster {
  const r = new Raster(SEA_W, SEA_H);
  const dir = seen === 'front' ? -1 : 1;
  const cx = 32 + dir * pose.lean * 3;
  const cy = 30 - pose.rise * 0.5;
  // Tentacles, curling.
  const arms = 6;
  for (let a = 0; a < arms; a++) {
    r.beginPart();
    const near = a % 2 === 0;
    let prev: [number, number] = [cx + (a - arms / 2 + 0.5) * 4, cy + 10];
    const reach = a === 1 ? pose.reach : 0;
    for (let k = 1; k <= 6; k++) {
      const t = k / 6;
      const curl = Math.sin(pose.wave + a * 1.3 + t * 4) * 3.5 * t;
      const p: [number, number] = [prev[0] + (a - arms / 2 + 0.5) * 1.6 + curl + dir * reach * 4, prev[1] + 3.4 - reach * 4.5];
      r.capsule(prev[0], prev[1], p[0], Math.min(SEA_H - 3, p[1]), 3 - t * 2, 2.6 - t * 2, near ? 14 - t : 2 - t, SLOT.armour);
      prev = p;
    }
  }
  // The mantle, and its staring eye.
  r.beginPart();
  r.ellipse(cx - dir * 2, cy - 4, 12, 14, 10, SLOT.armour);
  r.ellipse(cx + dir * 2, cy + 6, 11, 6, 11, SLOT.trim, { round: 0.6 });
  if (seen === 'front') {
    r.beginPart();
    r.ellipse(cx + dir * 5, cy + 1, 3.6, 3.2, 26, SLOT.eye === 2 ? SLOT.glow : SLOT.eye, { round: 0.5 });
    r.ellipse(cx + dir * 5.8, cy + 1.2, 1.4, 2.4, 30, SLOT.dark, { round: 0.2 });
  }
  if (pose.glow > 0.05) {
    r.beginPart();
    r.ellipse(cx + dir * 12, cy + 4, 2 + pose.glow * 3, 2 + pose.glow * 3, 32, SLOT.glow, { round: 0.3 });
  }
  r.outline();
  void normalize3;
  return r;
}
