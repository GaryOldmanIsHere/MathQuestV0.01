import { DETAIL, Raster } from './raster';

// A person, painted: a skeleton posed by a few angles, and over it a body,
// armour or robes, a head with hair, helm, hood or hat, a weapon and maybe a
// shield, each part a solid shape on the pixel grid (see raster.ts). The
// figure is seen three-quarters on, as the tactics games of the 1990s drew
// their units: from the front facing left, or from behind facing right. It
// is built tall and broad in the shoulder (about four and a half heads),
// and stands ready to fight rather than at ease.

export const HUMAN_W = 112;
export const HUMAN_H = 72;
/** Where the feet stand. */
export const FOOT_X = 56;
export const FOOT_Y = 69;

export type WeaponKind = 'sword' | 'greatsword' | 'rapier' | 'axe' | 'hammer' | 'spear' | 'whip' | 'claw' | 'bow' | 'mace' | 'staff' | 'doll' | 'fan' | 'none';

/** How a person looks: their build, what they wear and what they carry. */
export interface HumanLook {
  /** 0.9 slight to 1.25 broad. */
  bulk: number;
  armour: 'plate' | 'mail' | 'leather' | 'tunic' | 'robe' | 'dress' | 'bones' | 'stone';
  head: 'hair' | 'helm' | 'greathelm' | 'hood' | 'hat' | 'mask' | 'stone';
  longHair: boolean;
  weapon: WeaponKind;
  shield: 'none' | 'round' | 'kite' | 'tower';
  cape: boolean;
  /** A crest of feathers on a helm. */
  plume?: boolean;
  /** A long beard, as an old wizard wears. */
  beard?: boolean;
}

/** The colour slots a person is painted in (index into the palette). */
export const SLOT = {
  skin: 1, eye: 2, hair: 3, armour: 4, trim: 5, metal: 6, wood: 7, shield: 8, dark: 9, cloth: 10, glow: 11, pale: 12,
} as const;

/**
 * A pose: a few angles (radians) and offsets. Limb angles are measured from
 * straight down, positive swinging forward (the way the figure faces); an
 * elbow's or knee's bend is added to its upper limb's angle (elbows bend
 * forward, knees back).
 */
export interface Pose {
  /** A seated figure lowered in the saddle, pixels (one on its feet stands as its legs put it). */
  bob: number;
  /** The torso tipped forward. */
  lean: number;
  /** The head tipped forward. */
  nod: number;
  nearArm: [number, number];
  farArm: [number, number];
  nearLeg: [number, number];
  farLeg: [number, number];
  /** The weapon's angle from the forearm's line. */
  grip: number;
  /** A spell's light in the hands, 0 to 1. */
  glow: number;
}

/** Standing at ease: how those who fight with spells and staves wait their turn. */
export const REST: Pose = {
  bob: 0.15, lean: 0.03, nod: 0, nearArm: [0.45, 0.85], farArm: [-0.1, 0.45], nearLeg: [0.14, 0.06], farLeg: [-0.16, 0.06], grip: -0.6, glow: 0,
};

/** On guard: feet apart and knees bent, the weapon raised and the off hand (or shield) forward. */
export const GUARD: Pose = {
  bob: 1.05, lean: 0.1, nod: 0.04, nearArm: [0.75, 1.35], farArm: [0.6, 0.75], nearLeg: [0.46, 0.4], farLeg: [-0.36, 0.22], grip: 0.72, glow: 0,
};

/** The stance a weapon is carried in. */
export function stanceOf(weapon: WeaponKind): Pose {
  switch (weapon) {
    case 'staff': case 'doll': case 'fan': case 'none':
      return REST;
    case 'bow':
      // The bow held out before the body, the string hand by it.
      return { ...GUARD, lean: 0.04, farArm: [1.0, 0.25], nearArm: [0.55, 1.25], grip: 0 };
    case 'spear':
      // Levelled low in both hands.
      return { ...GUARD, nearArm: [0.5, 0.9], farArm: [0.75, 0.55], grip: 0.2 };
    case 'greatsword': case 'hammer': case 'axe':
      // Held high, off hand to the haft.
      return { ...GUARD, nearArm: [0.85, 1.45], farArm: [0.95, 1.1], grip: 0.62 };
    default:
      return GUARD;
  }
}

/** A pose between two, `t` of the way. */
export function blend(a: Pose, b: Pose, t: number): Pose {
  const n = (x: number, y: number) => x + (y - x) * t;
  const p = (x: [number, number], y: [number, number]): [number, number] => [n(x[0], y[0]), n(x[1], y[1])];
  return {
    bob: n(a.bob, b.bob), lean: n(a.lean, b.lean), nod: n(a.nod, b.nod),
    nearArm: p(a.nearArm, b.nearArm), farArm: p(a.farArm, b.farArm),
    nearLeg: p(a.nearLeg, b.nearLeg), farLeg: p(a.farLeg, b.farLeg),
    grip: n(a.grip, b.grip), glow: n(a.glow, b.glow),
  };
}

/** A direction at `angle` from straight down, positive toward the way the figure faces (`dir` -1 left, 1 right). */
function along(angle: number, dir: number): [number, number] {
  return [Math.sin(angle) * dir, Math.cos(angle)];
}

interface Joints {
  head: [number, number];
  neck: [number, number];
  chest: [number, number];
  hip: [number, number];
  nearShoulder: [number, number];
  farShoulder: [number, number];
  nearElbow: [number, number];
  nearHand: [number, number];
  farElbow: [number, number];
  farHand: [number, number];
  nearHip: [number, number];
  farHip: [number, number];
  nearKnee: [number, number];
  nearFoot: [number, number];
  farKnee: [number, number];
  farFoot: [number, number];
  /** The angle the near forearm points. */
  nearForearm: number;
  farForearm: number;
}

// The figure's measures, in the painters' units.
const THIGH = 10;
const SHIN = 9.5;
const SPINE = 15;
/** The head's half-width and half-height. */
const HEAD_RX = 4.9;
const HEAD_RY = 5.3;

/** Where every joint lies in a pose, for a figure facing `dir` (-1 left, 1 right). */
export function joints(pose: Pose, look: HumanLook, dir: number, planted = true): Joints {
  const add = (p: [number, number], v: [number, number], len: number): [number, number] => [p[0] + v[0] * len, p[1] + v[1] * len];
  // The hips stand where the legs reach: as high as keeps the lower foot (or
  // a knee, kneeling) on the ground, however the legs are bent. A figure not
  // standing on its own feet (a rider) sits where the pose puts it.
  const reach = (leg: [number, number]) => Math.max(Math.cos(leg[0]) * THIGH + Math.cos(leg[0] - leg[1]) * SHIN, Math.cos(leg[0]) * THIGH - 1);
  const drop = planted ? Math.max(reach(pose.nearLeg), reach(pose.farLeg) + 0.5) : THIGH + SHIN - pose.bob;
  const hip: [number, number] = [FOOT_X - dir * pose.lean * 3, FOOT_Y + 1 - drop];
  const spine = along(Math.PI - pose.lean, dir);
  const chest = add(hip, spine, SPINE * 0.55);
  const neck = add(hip, spine, SPINE);
  const head = add(neck, along(Math.PI - pose.lean - pose.nod, dir), HEAD_RY + 0.4);
  const span = 5.3 * look.bulk;
  // Three-quarters on, the near shoulder stands forward of the chest and the far one behind it.
  const nearShoulder: [number, number] = [neck[0] + dir * span * 0.62, neck[1] + 2.4];
  const farShoulder: [number, number] = [neck[0] - dir * span * 0.9, neck[1] + 1.8];
  const upper = 8;
  const fore = 7.4;
  const nearElbow = add(nearShoulder, along(pose.nearArm[0], dir), upper);
  const nearForearm = pose.nearArm[0] + pose.nearArm[1];
  const nearHand = add(nearElbow, along(nearForearm, dir), fore);
  const farElbow = add(farShoulder, along(pose.farArm[0], dir), upper);
  const farForearm = pose.farArm[0] + pose.farArm[1];
  const farHand = add(farElbow, along(farForearm, dir), fore);
  const nearHip: [number, number] = [hip[0] + dir * 2.4, hip[1]];
  const farHip: [number, number] = [hip[0] - dir * 2.8, hip[1] - 0.5];
  const nearKnee = add(nearHip, along(pose.nearLeg[0], dir), THIGH);
  const nearFoot = add(nearKnee, along(pose.nearLeg[0] - pose.nearLeg[1], dir), SHIN);
  const farKnee = add(farHip, along(pose.farLeg[0], dir), THIGH);
  const farFoot = add(farKnee, along(pose.farLeg[0] - pose.farLeg[1], dir), SHIN);
  return {
    head, neck, chest, hip, nearShoulder, farShoulder, nearElbow, nearHand, farElbow, farHand,
    nearHip, farHip, nearKnee, nearFoot, farKnee, farFoot, nearForearm, farForearm,
  };
}

/** Where the hips stand above the feet in a pose at rest (for seating a rider). */
export const HIP_Y = FOOT_Y - THIGH - SHIN + 1;

export interface PaintOptions {
  /** Paint into this raster (left un-outlined, for the caller to finish). */
  into?: Raster;
  /** Move the whole figure, pixels. */
  dx?: number;
  dy?: number;
  /** Seated astride: thighs forward, shins down. */
  seated?: boolean;
}

/**
 * Paint a person in a pose: from the front facing left, or from behind
 * facing right.
 */
export function paintHuman(look: HumanLook, pose: Pose, seen: 'front' | 'back', o: PaintOptions = {}): Raster {
  const r = o.into ?? new Raster(HUMAN_W, HUMAN_H, DETAIL);
  const dir = seen === 'front' ? -1 : 1;
  if (o.seated) pose = { ...pose, bob: 0, nearLeg: [1.25, 1.55], farLeg: [1.15, 1.45] };
  const j = joints(pose, look, dir, !o.seated);
  if (o.dx || o.dy) {
    for (const v of Object.values(j)) {
      if (Array.isArray(v)) {
        v[0] += o.dx ?? 0;
        v[1] += o.dy ?? 0;
      }
    }
  }
  const front = seen === 'front';
  const b = look.bulk;
  const robe = look.armour === 'robe' || look.armour === 'dress';
  const bones = look.armour === 'bones';
  const stone = look.armour === 'stone';
  const plate = look.armour === 'plate';
  const mail = look.armour === 'mail';
  const limb = bones ? SLOT.skin : plate ? SLOT.metal : SLOT.armour;
  const metalShine = { shine: true };
  const ground = (o.dy ?? 0) + FOOT_Y;

  // Depths: the far side behind the body, the near side before it. Seen
  // from behind, a cape covers the back.
  const Z_FAR = 0;
  const Z_BODY = 10;
  const Z_NEAR = 20;
  const Z_HEAD = 26;

  // A cape hangs behind (in front, as seen from behind), caught a little by the wind.
  if (look.cape) {
    r.beginPart();
    const top = j.neck;
    const swing = pose.lean * 5 + 2;
    // Two halves, folded down the middle, so the cloth catches the light as cloth does.
    const zc = front ? Z_FAR - 2 : Z_HEAD + 2;
    const mid: [number, number] = [top[0] - dir * (swing + 2), ground - 4];
    r.polygon([[top[0] - 6.5 * b, top[1] + 1.5], [top[0], top[1] + 1.5], mid, [top[0] - 9 * b - dir * swing, ground - 6]], zc, SLOT.trim, { normal: [-0.35, -0.1, 1], bevel: 2 });
    r.polygon([[top[0], top[1] + 1.5], [top[0] + 6.5 * b, top[1] + 1.5], [top[0] + 8.5 * b - dir * swing, ground - 7], mid], zc, SLOT.trim, { normal: [0.35, -0.1, 1], bevel: 2 });
  }

  // The far leg and arm.
  r.beginPart();
  leg(r, j.farHip, j.farKnee, j.farFoot, Z_FAR + 1, look, dir);
  r.beginPart();
  arm(r, j.farShoulder, j.farElbow, j.farHand, front ? Z_FAR + 2 : Z_NEAR - 2, limb, look);
  if (look.shield !== 'none') {
    r.beginPart();
    shield(r, j.farHand, look, dir, front ? Z_BODY + 4 : Z_FAR, front, ground);
  }
  if (look.weapon === 'bow') {
    r.beginPart();
    bow(r, j.farHand, j.farForearm, dir, front ? Z_BODY + 5 : Z_FAR + 3);
  }

  // The near leg.
  r.beginPart();
  leg(r, j.nearHip, j.nearKnee, j.nearFoot, Z_BODY - 2, look, dir);

  // The body: broad at the shoulder, narrow at the waist; robes and dresses down to the feet.
  r.beginPart();
  // Plate: an enamelled breastplate in the class's colour, steel at the limbs and shoulders.
  const chestColour = bones ? SLOT.skin : look.armour === 'tunic' ? SLOT.cloth : SLOT.armour;
  const shoulderY = (j.nearShoulder[1] + j.farShoulder[1]) / 2 + 0.6;
  if (bones) {
    // Ribs over a spine.
    r.capsule(j.hip[0], j.hip[1], j.neck[0], j.neck[1], 1.4, 1.4, Z_BODY, SLOT.skin);
    for (let k = 0; k < 4; k++) {
      const y = j.neck[1] + 3 + k * 2.5;
      r.capsule(j.chest[0] - 5, y, j.chest[0] + 5, y + 0.5, 0.9, 0.9, Z_BODY + 1, SLOT.skin);
    }
    r.ellipse(j.hip[0], j.hip[1] - 0.5, 4.6, 2.3, Z_BODY, SLOT.skin);
  } else {
    // Shoulders, a deep chest, a waist.
    r.capsule(j.farShoulder[0] + dir * 1, shoulderY, j.nearShoulder[0] - dir * 1, shoulderY, 3.3, 3.5, Z_BODY, chestColour, plate ? metalShine : {});
    r.ellipse(j.chest[0], j.chest[1] - 1.5, 5.9 * b, 6.4, Z_BODY + 0.3, chestColour, plate ? metalShine : {});
    r.ellipse(j.hip[0], j.hip[1] - 2.2, 4.7 * b, 4.6, Z_BODY - 0.5, plate ? SLOT.metal : chestColour, plate ? metalShine : {});
  }
  if (stone) {
    // Slabs of rock: a great chest and a block of a belly.
    r.polygon([
      [j.chest[0] - 8 * b, j.chest[1] - 7], [j.chest[0] + 8 * b, j.chest[1] - 8],
      [j.chest[0] + 7 * b, j.chest[1] + 5], [j.chest[0] - 7 * b, j.chest[1] + 6],
    ], Z_BODY + 1, SLOT.armour, { normal: [0, -0.1, 1], bevel: 3 });
    r.beginPart();
    r.polygon([[j.chest[0] - 3, j.chest[1] - 3], [j.chest[0] + 3, j.chest[1] - 3], [j.chest[0] + 2, j.chest[1] + 2], [j.chest[0] - 2, j.chest[1] + 2]], Z_BODY + 2, SLOT.trim, { bevel: 1 });
  } else if (robe) {
    const hem = ground - (look.armour === 'dress' ? 1 : 2);
    const flare = look.armour === 'dress' ? 9.5 : 7.5;
    const sway = pose.nearLeg[0] - pose.farLeg[0];
    const sx = sway * 3 * dir;
    r.polygon([
      [j.hip[0] - 4.8 * b, j.hip[1] - 4], [j.hip[0] + 4.8 * b, j.hip[1] - 4],
      [j.hip[0] + flare * b + sx, hem], [j.hip[0] - flare * b + sx, hem + 0.5],
    ], Z_BODY + 1, SLOT.armour, { normal: [0, 0.1, 1], bevel: 3 });
    // A band of trim at the hem and down the front, and a second colour beneath the skirts.
    r.beginPart();
    r.polygon([
      [j.hip[0] - flare * b + sx + 0.4, hem - 3], [j.hip[0] + flare * b + sx - 0.4, hem - 3],
      [j.hip[0] + flare * b + sx, hem], [j.hip[0] - flare * b + sx, hem + 0.5],
    ], Z_BODY + 1.5, SLOT.trim, { bevel: 1 });
    if (front) {
      r.polygon([[j.hip[0] + dir * 0.5 - 1.6, j.hip[1] - 4], [j.hip[0] + dir * 0.5 + 1.6, j.hip[1] - 4], [j.hip[0] + dir * 1 + 2.4 + sx * 0.6, hem - 3], [j.hip[0] + dir * 1 - 2.4 + sx * 0.6, hem - 3]], Z_BODY + 1.6, SLOT.trim, { bevel: 0.5 });
      // The stole: a long band from the collar.
      r.capsule(j.neck[0] + dir * 1.5, j.neck[1] + 2.5, j.chest[0] + dir * 2, j.chest[1] + 5, 1.2, 1.2, Z_BODY + 2, SLOT.trim);
    }
  } else if (!bones && (mail || plate || look.armour === 'tunic' || look.armour === 'leather')) {
    // A tabard or skirt to the thigh, a band of trim at its hem.
    r.beginPart();
    const len = look.armour === 'leather' ? 4.5 : 6.5;
    const skirt = look.armour === 'tunic' || look.armour === 'leather' ? SLOT.armour : SLOT.trim;
    r.polygon([
      [j.hip[0] - 4.6 * b, j.hip[1] - 3], [j.hip[0] + 4.6 * b, j.hip[1] - 3],
      [j.hip[0] + 5.6 * b, j.hip[1] + len], [j.hip[0] - 5.6 * b, j.hip[1] + len],
    ], Z_BODY + 1, skirt, { normal: [0, 0.1, 1], bevel: 2 });
    r.beginPart();
    r.polygon([
      [j.hip[0] - 5.5 * b, j.hip[1] + len - 1.6], [j.hip[0] + 5.5 * b, j.hip[1] + len - 1.6],
      [j.hip[0] + 5.6 * b, j.hip[1] + len], [j.hip[0] - 5.6 * b, j.hip[1] + len],
    ], Z_BODY + 1.4, skirt === SLOT.trim ? SLOT.armour : SLOT.trim, { bevel: 0.6 });
  }
  if (plate && front) {
    // A surcoat down the breastplate, in the class's trim.
    r.beginPart();
    r.polygon([[j.neck[0] + dir * 0.5 - 2.6, j.neck[1] + 3], [j.neck[0] + dir * 0.5 + 2.6, j.neck[1] + 3], [j.hip[0] + dir * 1 + 3, j.hip[1] - 4.5], [j.hip[0] + dir * 1 - 3, j.hip[1] - 4.5]], Z_BODY + 1.2, SLOT.trim, { normal: [dir * 0.2, 0, 1], bevel: 1.2 });
  }
  if (!bones && !stone) {
    // The belt, and its buckle.
    r.beginPart();
    r.capsule(j.hip[0] - 4.6 * b, j.hip[1] - 4.3, j.hip[0] + 4.6 * b, j.hip[1] - 4.3, 1.25, 1.25, Z_BODY + 2, SLOT.dark);
    r.ellipse(j.hip[0] + dir * 1.5, j.hip[1] - 4.3, 1.5, 1.3, Z_BODY + 3, SLOT.metal, metalShine);
    if (!robe && !plate && front) {
      // A strap across the chest.
      r.capsule(j.farShoulder[0] + dir * 2.5, j.farShoulder[1] + 1, j.hip[0] + dir * 3.5 * b, j.hip[1] - 5, 0.8, 0.8, Z_BODY + 2, SLOT.dark);
    }
  }
  if (plate || mail) {
    // Pauldrons, rimmed in the class's trim.
    r.beginPart();
    const big = plate ? 1.15 : 0.95;
    r.ellipse(j.farShoulder[0], j.farShoulder[1] - 0.3, 3.9 * b * big, 3.3 * big, Z_BODY + 3, SLOT.metal, metalShine);
    r.ellipse(j.nearShoulder[0], j.nearShoulder[1] - 0.3, 4.2 * b * big, 3.6 * big, Z_NEAR + 1, SLOT.metal, metalShine);
    r.beginPart();
    r.capsule(j.nearShoulder[0] - 3.6 * b * big, j.nearShoulder[1] + 2.6 * big, j.nearShoulder[0] + 3.6 * b * big, j.nearShoulder[1] + 2.6 * big, 0.8, 0.8, Z_NEAR + 1.5, SLOT.trim);
  } else if (!bones && !stone && !robe) {
    // A cloth shoulder, so the arm has somewhere to hang from.
    r.ellipse(j.nearShoulder[0], j.nearShoulder[1], 3 * b, 2.8, Z_NEAR + 0.5, chestColour);
  }
  if (robe) {
    // A wide collar over the shoulders.
    r.beginPart();
    r.capsule(j.farShoulder[0] + dir * 1.5, shoulderY - 1.2, j.nearShoulder[0], shoulderY - 1, 2.6, 2.8, Z_BODY + 3, SLOT.trim);
  }

  // The head.
  r.beginPart();
  head(r, j.head, look, dir, front, Z_HEAD);

  // The near arm, and what it carries.
  r.beginPart();
  arm(r, j.nearShoulder, j.nearElbow, j.nearHand, Z_NEAR, limb, look);
  if (look.weapon !== 'bow' && look.weapon !== 'none') {
    r.beginPart();
    weapon(r, look.weapon, j.nearHand, j.nearForearm + pose.grip, dir, Z_NEAR + 2);
  }
  if (pose.glow > 0.05) {
    r.beginPart();
    const at = j.nearHand;
    r.ellipse(at[0] + dir * 1.5, at[1] - 1.5, 2 + pose.glow * 2.5, 2 + pose.glow * 2.5, Z_NEAR + 6, SLOT.glow, { round: 0.3 });
  }

  if (!o.into) r.outline();
  return r;
}

function leg(r: Raster, hip: [number, number], knee: [number, number], foot: [number, number], z: number, look: HumanLook, dir: number): void {
  const bones = look.armour === 'bones';
  const plate = look.armour === 'plate';
  const slot = bones ? SLOT.skin : look.armour === 'stone' ? SLOT.armour : plate ? SLOT.metal : look.armour === 'leather' || look.armour === 'mail' ? SLOT.cloth : SLOT.dark;
  const w = bones ? 1.1 : 2.9 * Math.min(look.armour === 'stone' ? 1.6 : 1.15, look.bulk);
  const shine = plate ? { shine: true } : {};
  r.capsule(hip[0], hip[1], knee[0], knee[1], w + 0.3, w * 0.86, z, slot, shine);
  // (The ankle ends above the sole, however thick the leg.)
  r.capsule(knee[0], knee[1], foot[0], foot[1] - 0.9 - w * 0.68, w * 0.84, w * 0.68, z + 0.5, slot, shine);
  if (look.armour === 'stone') {
    r.ellipse(foot[0] + dir * 1.5, foot[1] - 2, w * 1.2, w * 0.8, z + 1, SLOT.armour);
    return;
  }
  if (bones) return;
  if (plate) {
    // A knee-cop, and a steel shoe.
    r.ellipse(knee[0] + dir * 0.6, knee[1], w * 0.95, w * 0.95, z + 1, SLOT.metal, { shine: true });
    r.capsule(foot[0] - dir * 0.6, foot[1] - 2.8, foot[0] + dir * 3, foot[1] - 1.5, 2.3, 1.6, z + 1, SLOT.metal, { shine: true });
    return;
  }
  // A tall boot, turned over at the top, toe forward.
  const mid: [number, number] = [knee[0] + (foot[0] - knee[0]) * 0.42, knee[1] + (foot[1] - knee[1]) * 0.42];
  r.capsule(mid[0], mid[1], foot[0], foot[1] - 0.9 - w * 0.76, w * 0.86, w * 0.76, z + 0.8, SLOT.dark);
  r.capsule(mid[0] - w * 0.8, mid[1], mid[0] + w * 0.8, mid[1], 0.9, 0.9, z + 1.2, SLOT.trim);
  r.capsule(foot[0] - dir * 0.6, foot[1] - 2.8, foot[0] + dir * 3, foot[1] - 1.5, 2.3, 1.6, z + 1, SLOT.dark);
}

function arm(r: Raster, shoulder: [number, number], elbow: [number, number], hand: [number, number], z: number, slot: number, look: HumanLook): void {
  const bones = look.armour === 'bones';
  const stone = look.armour === 'stone';
  const w = bones ? 1 : 2.35 * Math.min(stone ? 1.7 : 1.15, look.bulk);
  const shine = slot === SLOT.metal ? { shine: true } : {};
  r.capsule(shoulder[0], shoulder[1], elbow[0], elbow[1], w + 0.3, w * 0.88, z, slot, shine);
  // The forearm: a steel vambrace over mail, a bare arm under a tunic, a wide sleeve on a robe.
  const robe = look.armour === 'robe' || look.armour === 'dress';
  const fore = look.armour === 'mail' ? SLOT.metal : look.armour === 'tunic' ? SLOT.skin : slot;
  r.capsule(elbow[0], elbow[1], hand[0], hand[1], robe ? w * 0.95 : w * 0.86, robe ? w * 1.25 : w * 0.74, z + 0.5, fore, fore === SLOT.metal ? { shine: true } : {});
  if (stone) {
    r.ellipse(hand[0], hand[1], 3.2, 3, z + 1, SLOT.armour);
    return;
  }
  // A glove (a gauntlet, in armour); casters and the dead go bare-handed.
  const glove = look.armour === 'plate' || look.armour === 'mail' ? SLOT.metal : bones || robe || look.armour === 'tunic' ? SLOT.skin : SLOT.dark;
  r.ellipse(hand[0], hand[1], 2, 2, z + 1, glove, glove === SLOT.metal ? { shine: true } : {});
}

function head(r: Raster, at: [number, number], look: HumanLook, dir: number, front: boolean, z: number): void {
  const [x, y] = at;
  const bones = look.armour === 'bones';
  const rx = HEAD_RX;
  const ry = HEAD_RY;
  if (look.head === 'stone') {
    // A boulder of a head, sunk between the shoulders, eyes glowing.
    r.ellipse(x, y + 3, 6.5, 5.5, z, SLOT.armour);
    if (front) {
      r.beginPart();
      r.capsule(x + dir * 1.5, y + 2.5, x + dir * 5, y + 2.5, 0.9, 0.9, z + 8, SLOT.glow);
    }
    return;
  }
  // The neck.
  if (!bones) r.capsule(x - dir * 0.3, y + ry - 1.5, x - dir * 0.6, y + ry + 1.2, 1.9, 2, z - 8, SLOT.skin);
  // Long hair falls behind the head, to the shoulder blades.
  if (look.longHair && look.head !== 'greathelm') {
    r.capsule(x - dir * 2, y - 1, x - dir * 3.4, y + 10, 3.9, 2.6, z - 6, SLOT.hair);
  }
  r.ellipse(x, y, rx, ry, z, SLOT.skin);
  // The face: eyes under a brow, looking the way the figure faces.
  if (front && look.head !== 'greathelm' && look.head !== 'mask') {
    r.beginPart();
    const ex = x + dir * 1.5;
    // (Set just proud of the face, so no line is drawn round them.)
    r.capsule(ex, y + 0.3, ex, y + 1.5, 0.55, 0.55, z + 5.4, bones ? SLOT.dark : SLOT.eye, { round: 0 });
    r.capsule(ex + dir * 2.4, y + 0.3, ex + dir * 2.4, y + 1.4, 0.45, 0.45, z + 5.2, bones ? SLOT.dark : SLOT.eye, { round: 0 });
    if (bones) r.capsule(x + dir * 1, y + 3.6, x + dir * 3.6, y + 3.6, 0.5, 0.5, z + 5, SLOT.dark, { round: 0 });
  }
  if (look.beard && front && !bones) {
    // A long beard to the chest.
    r.beginPart();
    r.polygon([[x + dir * 4.4, y + 1.8], [x - dir * 1.5, y + 2.6], [x - dir * 0.5, y + 8], [x + dir * 2.4, y + 12.5], [x + dir * 4.2, y + 7]], z + 4, SLOT.pale, { normal: [dir * 0.3, 0.1, 1], bevel: 1.6 });
  }
  r.beginPart();
  switch (look.head) {
    case 'hair':
      if (!bones) {
        // Hair over the crown and the back of the head, a fringe over the brow; seen from behind, all of it.
        r.ellipse(x - dir * 0.9, y - 2.1, rx + 0.5, 3.9, z + 1, SLOT.hair);
        if (!front) r.ellipse(x, y + 0.3, rx + 0.3, ry, z + 2, SLOT.hair);
        else {
          r.ellipse(x - dir * 3.2, y + 0.9, 2.5, 4, z + 1.5, SLOT.hair);
          r.capsule(x + dir * 0.5, y - 3.2, x + dir * 3.6, y - 1.6, 1.5, 1, z + 2, SLOT.hair);
        }
      }
      break;
    case 'helm':
      // An open helm: a steel cap with a rim and a nose-guard.
      if (!front) r.ellipse(x, y + 1, rx + 0.2, ry - 0.2, z + 1.5, SLOT.hair);
      r.ellipse(x - dir * 0.3, y - 1.9, rx + 0.7, 4.3, z + 2, SLOT.metal, { shine: true });
      r.capsule(x - rx - 0.6, y - 0.2, x + rx + 0.6, y - 0.2, 0.95, 0.95, z + 3, SLOT.trim);
      if (front) r.capsule(x + dir * 2.6, y - 0.4, x + dir * 2.6, y + 2.6, 0.7, 0.6, z + 9.5, SLOT.metal, { shine: true });
      break;
    case 'greathelm':
      // A closed helm: a dome over a visor with its slit.
      r.ellipse(x, y - 0.3, rx + 0.7, ry + 0.4, z + 2, SLOT.metal, { shine: true });
      if (front) {
        r.polygon([[x + dir * (rx + 1.4), y - 0.8], [x - dir * 1, y - 1.4], [x - dir * 1.4, y + 3.6], [x + dir * (rx + 0.4), y + 4.4]], z + 9, SLOT.metal, { shine: true, normal: [dir * 0.45, 0.1, 1], bevel: 1 });
        r.beginPart();
        r.capsule(x + dir * 0.4, y + 0.3, x + dir * (rx + 0.4), y + 0.5, 0.55, 0.55, z + 10, SLOT.dark);
      }
      break;
    case 'hood':
      r.ellipse(x - dir * 0.7, y - 0.6, rx + 1.2, ry + 1, z - 1, SLOT.armour);
      if (!front) r.ellipse(x, y, rx + 0.8, ry + 0.6, z + 2, SLOT.armour);
      else r.ellipse(x + dir * 1.5, y + 0.9, rx - 1.6, ry - 1.5, z + 0.5, SLOT.skin);
      r.capsule(x - dir * 3.4, y + 4.4, x - dir * 1.2, y + 6.6, 2.4, 1.8, z - 1, SLOT.armour);
      break;
    case 'hat':
      // A wide brim and a tall crown, its point bent back.
      r.ellipse(x - dir * 0.9, y - 1.8, rx + 0.4, 3.6, z + 1, SLOT.hair);
      if (!front) r.ellipse(x, y + 0.4, rx + 0.2, ry - 0.2, z + 1.5, SLOT.hair);
      else r.ellipse(x - dir * 3, y + 1.2, 2.2, 3.6, z + 1.2, SLOT.hair);
      r.ellipse(x, y - 3.3, 9.2, 2.1, z + 3, SLOT.armour, { round: 0.6 });
      r.polygon([[x - 4.6, y - 4], [x + 4.6, y - 4], [x - dir * 1.6, y - 13.5], [x - dir * 5.8, y - 14.5], [x - dir * 4.2, y - 11.5]], z + 2, SLOT.armour, { normal: [dir * -0.3, -0.2, 1], bevel: 2 });
      r.capsule(x - 4.5, y - 4.8, x + 4.5, y - 4.8, 0.9, 0.9, z + 3.5, SLOT.trim);
      break;
    case 'mask':
      r.ellipse(x - dir * 0.6, y - 1.7, rx + 0.4, 4, z + 1, SLOT.armour);
      if (!front) r.ellipse(x, y + 0.4, rx + 0.3, ry, z + 1.5, SLOT.armour);
      r.capsule(x - rx + 0.4, y + 2.4, x + rx - 0.4, y + 2.4, 2, 2, z + 2, SLOT.armour);
      if (front) r.capsule(x + dir * 1.2, y + 0.2, x + dir * 4.2, y + 0.2, 0.5, 0.5, z + 5.6, SLOT.eye, { round: 0 });
      // The knot of the headband, flying behind.
      r.capsule(x - dir * (rx - 0.5), y - 1, x - dir * (rx + 4.5), y + 1.5, 0.9, 0.5, z - 2, SLOT.trim);
      break;
  }
  if (look.plume && (look.head === 'helm' || look.head === 'greathelm')) {
    // A crest of feathers, swept back from the crown.
    r.beginPart();
    const top = y - (look.head === 'helm' ? 5.6 : 5.9);
    r.polygon([[x + dir * 1.4, top + 0.8], [x - dir * 0.6, top - 5.5], [x - dir * 5, top - 5], [x - dir * 7.2, top - 0.5], [x - dir * 3.4, top + 1.6]], z + 1.5, SLOT.trim, { normal: [dir * -0.2, -0.3, 1], bevel: 1.6 });
  }
}

function shield(r: Raster, hand: [number, number], look: HumanLook, dir: number, z: number, front: boolean, ground: number): void {
  // Held at the hand, but never run into the ground.
  const tall = look.shield === 'round' ? 7.6 : look.shield === 'kite' ? 11.6 : 11.4;
  const [x, y] = [hand[0] + dir * 2, Math.min(hand[1] - 1, ground - tall - 0.5)];
  const face: [number, number, number] = [dir * 0.35, 0, 1];
  // Seen from behind, a shield shows its wooden back.
  const colour = front ? SLOT.shield : SLOT.wood;
  if (look.shield === 'round') {
    r.ellipse(x, y, 7, 7.6, z - 0.4, SLOT.metal, { round: 0.3, shine: true });
    r.ellipse(x, y, 5.7, 6.3, z, colour, { round: 0.35 });
    if (front) r.ellipse(x, y, 2, 2.1, z + 2, SLOT.metal, { shine: true });
  } else if (look.shield === 'kite') {
    const kite = (w: number, top: number, tip: number): [number, number][] => [[x - w, y - top], [x + w, y - top], [x + w * 0.92, y + 2.5], [x, y + tip], [x - w * 0.92, y + 2.5]];
    r.polygon(kite(6.6, 8.6, 11.6), z - 0.4, SLOT.metal, { normal: face, bevel: 1, shine: true });
    r.polygon(kite(5.4, 7.4, 9.8), z, colour, { normal: face, bevel: 2 });
    if (front) {
      // A cross in the class's trim.
      r.beginPart();
      r.polygon([[x - 1.1, y - 6.4], [x + 1.1, y - 6.4], [x + 1.1, y + 6.5], [x - 1.1, y + 6.5]], z + 1, SLOT.trim, { normal: face, bevel: 0.5 });
      r.polygon([[x - 4.4, y - 2.6], [x + 4.4, y - 2.6], [x + 4.4, y - 0.6], [x - 4.4, y - 0.6]], z + 1, SLOT.trim, { normal: face, bevel: 0.5 });
    }
  } else {
    const slab = (w: number, h: number): [number, number][] => [[x - w, y - h], [x + w, y - h], [x + w, y + h], [x - w, y + h]];
    r.polygon(slab(7.4, 11.4), z - 0.4, SLOT.metal, { normal: face, bevel: 1, shine: true });
    r.polygon(slab(6.2, 10.2), z, colour, { normal: face, bevel: 2.5 });
    if (front) {
      r.beginPart();
      r.polygon([[x - 6.2, y - 1.5], [x + 6.2, y - 1.5], [x + 6.2, y + 1.5], [x - 6.2, y + 1.5]], z + 1, SLOT.metal, { normal: face, bevel: 0.6, shine: true });
      r.ellipse(x, y, 2.2, 2.2, z + 2, SLOT.trim);
    }
  }
}

function bow(r: Raster, hand: [number, number], forearm: number, dir: number, z: number): void {
  // A curved bow held upright at the far hand, its string drawn back toward the body.
  const [x, y] = hand;
  const pts: [number, number][] = [];
  for (let k = 0; k <= 8; k++) {
    const t = k / 8 - 0.5;
    pts.push([x + dir * (2.5 - t * t * 10), y + t * 22]);
  }
  for (let k = 0; k < pts.length - 1; k++) {
    r.capsule(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], 1.1, 1.1, z, SLOT.wood);
  }
  r.capsule(pts[0][0], pts[0][1], pts[8][0], pts[8][1], 0.35, 0.35, z - 0.5, SLOT.cloth);
  void forearm;
}

/** How far each weapon reaches from the hand, tip and head included. */
const REACH: Partial<Record<WeaponKind, number>> = {
  sword: 16, rapier: 18, greatsword: 23.5, axe: 17, hammer: 18, spear: 27, staff: 23, mace: 14, whip: 15,
};

/** A weapon in a hand, pointing along `angle` (from straight down, forward positive). */
function weapon(r: Raster, kind: WeaponKind, hand: [number, number], angle: number, dir: number, z: number): void {
  const [hx, hy] = hand;
  // A blade held low is lifted toward level rather than run into the ground.
  const ground = r.h / r.k - 4;
  const reach = REACH[kind] ?? 0;
  if (reach > 0 && hy + Math.cos(angle) * reach > ground) {
    const lift = Math.acos(Math.max(-1, Math.min(1, (ground - hy) / reach)));
    angle = angle < 0 ? -lift : lift;
  }
  const d = along(angle, dir);
  const at = (len: number): [number, number] => [hx + d[0] * len, hy + d[1] * len];
  const back = (len: number): [number, number] => [hx - d[0] * len, hy - d[1] * len];
  const metal = { shine: true };
  switch (kind) {
    case 'sword':
    case 'rapier': {
      const [gx, gy] = at(1.5);
      const [tx, ty] = at(kind === 'rapier' ? 17 : 15);
      r.capsule(gx, gy, tx, ty, kind === 'rapier' ? 0.85 : 1.7, 0.6, z, SLOT.metal, metal);
      const [px, py] = back(2.5);
      r.capsule(hx, hy, px, py, 0.9, 0.9, z - 0.5, SLOT.wood);
      r.capsule(gx - d[1] * 3.4, gy + d[0] * 3.4, gx + d[1] * 3.4, gy - d[0] * 3.4, 1, 1, z + 0.5, SLOT.trim, metal);
      r.ellipse(px, py, 1.2, 1.2, z + 0.4, SLOT.trim, metal);
      break;
    }
    case 'greatsword': {
      const [gx, gy] = at(2);
      const [tx, ty] = at(22);
      r.capsule(gx, gy, tx, ty, 2.1, 1, z, SLOT.metal, metal);
      const [px, py] = back(4);
      r.capsule(hx, hy, px, py, 1, 1, z - 0.5, SLOT.wood);
      r.capsule(gx - d[1] * 4, gy + d[0] * 4, gx + d[1] * 4, gy - d[0] * 4, 1.1, 1.1, z + 0.5, SLOT.trim, metal);
      break;
    }
    case 'axe':
    case 'hammer': {
      const [tx, ty] = at(15);
      const [px, py] = back(3);
      r.capsule(px, py, tx, ty, 1, 1, z, SLOT.wood);
      const [ax, ay] = at(12.5);
      const side: [number, number] = [-d[1] * dir, d[0] * dir];
      if (kind === 'axe') {
        r.polygon([
          [ax, ay], [ax + side[0] * -6 + d[0] * -3, ay + side[1] * -6 + d[1] * -3],
          [ax + side[0] * -7 + d[0] * 4, ay + side[1] * -7 + d[1] * 4], [ax + d[0] * 2.5, ay + d[1] * 2.5],
        ], z + 1, SLOT.metal, { shine: true, normal: [0, -0.2, 1], bevel: 1.5 });
      } else {
        r.capsule(ax + side[0] * 4, ay + side[1] * 4, ax - side[0] * 4, ay - side[1] * 4, 3, 3, z + 1, SLOT.metal, metal);
      }
      break;
    }
    case 'spear': {
      const [tx, ty] = at(21);
      const [px, py] = back(5);
      r.capsule(px, py, tx, ty, 0.9, 0.9, z, SLOT.wood);
      const [sx, sy] = at(20);
      const [ex, ey] = at(26);
      r.capsule(sx, sy, ex, ey, 1.8, 0.3, z + 1, SLOT.metal, metal);
      break;
    }
    case 'staff': {
      const [tx, ty] = at(20);
      const [px, py] = back(5);
      r.capsule(px, py, tx, ty, 1.1, 0.9, z, SLOT.wood);
      r.ellipse(tx, ty, 2.6, 2.6, z + 1, SLOT.trim, metal);
      break;
    }
    case 'mace': {
      const [tx, ty] = at(11);
      const [px, py] = back(2);
      r.capsule(px, py, tx, ty, 0.9, 0.9, z, SLOT.wood);
      r.ellipse(tx, ty, 3, 3, z + 1, SLOT.metal, metal);
      break;
    }
    case 'whip': {
      let prev = hand;
      for (let k = 1; k <= 6; k++) {
        const t = k / 6;
        const p: [number, number] = [hx + d[0] * 14 * t + dir * Math.sin(t * 5) * 2, hy + d[1] * 14 * t];
        r.capsule(prev[0], prev[1], p[0], p[1], 0.8, 0.7, z, SLOT.dark);
        prev = p;
      }
      break;
    }
    case 'claw': {
      for (const o of [-1.5, 0, 1.5]) {
        const [tx, ty] = at(6);
        r.capsule(hx + o * 0.6, hy, tx + o, ty, 0.6, 0.3, z, SLOT.metal, metal);
      }
      break;
    }
    case 'doll': {
      const [tx, ty] = at(4);
      r.ellipse(tx, ty - 2, 2.4, 2.4, z, SLOT.trim);
      r.ellipse(tx, ty + 2, 2.4, 3, z, SLOT.armour);
      break;
    }
    case 'fan': {
      const [tx, ty] = at(3);
      r.polygon([[hx, hy], [tx - 5, ty - 4], [tx + 5, ty - 4]], z, SLOT.trim, { normal: [0, -0.2, 1], bevel: 1 });
      break;
    }
    default:
      break;
  }
}
