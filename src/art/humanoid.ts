import { Raster } from './raster';

// A person, painted: a skeleton posed by a few angles, and over it a body,
// armour or robes, a head with hair, helm, hood or hat, a weapon and maybe a
// shield, each part a solid shape on the pixel grid (see raster.ts). The
// figure is seen three-quarters on, as Ogre Battle 64 shows its units: from
// the front facing left, or from behind facing right.

export const HUMAN_W = 48;
export const HUMAN_H = 64;
/** Where the feet stand. */
export const FOOT_X = 24;
export const FOOT_Y = 61;

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
}

/** The colour slots a person is painted in (index into the palette). */
export const SLOT = {
  skin: 1, eye: 2, hair: 3, armour: 4, trim: 5, metal: 6, wood: 7, shield: 8, dark: 9, cloth: 10, glow: 11,
} as const;

/**
 * A pose: a few angles (radians) and offsets. Limb angles are measured from
 * straight down, positive swinging forward (the way the figure faces); an
 * elbow's or knee's bend is added to its upper limb's angle (elbows bend
 * forward, knees back).
 */
export interface Pose {
  /** The whole body lowered, pixels (a crouch, a breath). */
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

export const REST: Pose = {
  bob: 0, lean: 0, nod: 0, nearArm: [0.25, 0.5], farArm: [-0.15, 0.35], nearLeg: [0.08, 0], farLeg: [-0.1, 0], grip: -0.6, glow: 0,
};

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

/** Where every joint lies in a pose, for a figure facing `dir` (-1 left, 1 right). */
export function joints(pose: Pose, look: HumanLook, dir: number): Joints {
  const add = (p: [number, number], v: [number, number], len: number): [number, number] => [p[0] + v[0] * len, p[1] + v[1] * len];
  const thigh = 9;
  const shin = 8.5;
  // The hips stand where the legs reach, lowered by the pose.
  const hip: [number, number] = [FOOT_X - dir * pose.lean * 3, FOOT_Y - thigh - shin + 1 + pose.bob];
  const spine = along(Math.PI - pose.lean, dir);
  const chest = add(hip, spine, 8.5);
  const neck = add(hip, spine, 16);
  const head = add(neck, along(Math.PI - pose.lean - pose.nod, dir), 8.2);
  const span = 4.2 * look.bulk;
  // Three-quarters on, the near shoulder stands forward of the chest and the far one behind it.
  const nearShoulder: [number, number] = [neck[0] + dir * span * 0.55, neck[1] + 2];
  const farShoulder: [number, number] = [neck[0] - dir * span * 0.85, neck[1] + 1.5];
  const upper = 8.2;
  const fore = 7.5;
  const nearElbow = add(nearShoulder, along(pose.nearArm[0], dir), upper);
  const nearForearm = pose.nearArm[0] + pose.nearArm[1];
  const nearHand = add(nearElbow, along(nearForearm, dir), fore);
  const farElbow = add(farShoulder, along(pose.farArm[0], dir), upper);
  const farForearm = pose.farArm[0] + pose.farArm[1];
  const farHand = add(farElbow, along(farForearm, dir), fore);
  const nearHip: [number, number] = [hip[0] + dir * 2, hip[1]];
  const farHip: [number, number] = [hip[0] - dir * 2.5, hip[1] - 0.5];
  const nearKnee = add(nearHip, along(pose.nearLeg[0], dir), thigh);
  const nearFoot = add(nearKnee, along(pose.nearLeg[0] - pose.nearLeg[1], dir), shin);
  const farKnee = add(farHip, along(pose.farLeg[0], dir), thigh);
  const farFoot = add(farKnee, along(pose.farLeg[0] - pose.farLeg[1], dir), shin);
  return {
    head, neck, chest, hip, nearShoulder, farShoulder, nearElbow, nearHand, farElbow, farHand,
    nearHip, farHip, nearKnee, nearFoot, farKnee, farFoot, nearForearm, farForearm,
  };
}

/** Where the hips stand above the feet in a pose at rest (for seating a rider). */
export const HIP_Y = FOOT_Y - 17.5 + 1;

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
  const r = o.into ?? new Raster(HUMAN_W, HUMAN_H);
  const dir = seen === 'front' ? -1 : 1;
  if (o.seated) pose = { ...pose, nearLeg: [1.25, 1.55], farLeg: [1.15, 1.45] };
  const j = joints(pose, look, dir);
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
  const limb = bones ? SLOT.skin : look.armour === 'plate' ? SLOT.metal : SLOT.armour;
  const metalShine = { shine: true };

  // Depths: the far side behind the body, the near side before it. Seen
  // from behind, a cape covers the back.
  const Z_FAR = 0;
  const Z_BODY = 10;
  const Z_NEAR = 20;
  const Z_HEAD = 26;

  // A cape hangs behind (in front, as seen from behind).
  if (look.cape) {
    r.beginPart();
    const top = j.neck;
    const swing = pose.lean * 4;
    r.polygon([
      [top[0] - 6 * b, top[1] + 1], [top[0] + 6 * b, top[1] + 1],
      [top[0] + 8 * b - dir * swing, FOOT_Y - 6], [top[0] - 8 * b - dir * swing, FOOT_Y - 5],
    ], front ? Z_FAR - 2 : Z_HEAD + 2, SLOT.trim, { normal: [0, -0.15, 1], bevel: 2 });
  }

  // The far leg and arm.
  r.beginPart();
  leg(r, j.farHip, j.farKnee, j.farFoot, Z_FAR + 1, look, dir);
  r.beginPart();
  arm(r, j.farShoulder, j.farElbow, j.farHand, front ? Z_FAR + 2 : Z_NEAR - 2, limb, look);
  if (look.shield !== 'none') {
    r.beginPart();
    shield(r, j.farHand, look, dir, front ? Z_BODY + 4 : Z_FAR);
  }
  if (look.weapon === 'bow') {
    r.beginPart();
    bow(r, j.farHand, j.farForearm, dir, front ? Z_BODY + 5 : Z_FAR + 3);
  }

  // The near leg.
  r.beginPart();
  leg(r, j.nearHip, j.nearKnee, j.nearFoot, Z_BODY - 2, look, dir);

  // The body: chest, belly, belt; robes and dresses down to the feet.
  r.beginPart();
  // Plate: an enamelled breastplate in the class's colour, steel at the limbs and shoulders.
  const chestColour = bones ? SLOT.skin : look.armour === 'tunic' ? SLOT.cloth : SLOT.armour;
  if (bones) {
    // Ribs over a spine.
    r.capsule(j.hip[0], j.hip[1], j.neck[0], j.neck[1], 1.6, 1.6, Z_BODY, SLOT.skin);
    for (let k = 0; k < 4; k++) {
      const y = j.neck[1] + 3 + k * 2.6;
      r.capsule(j.chest[0] - 5, y, j.chest[0] + 5, y + 0.5, 1, 1, Z_BODY + 1, SLOT.skin);
    }
    r.ellipse(j.hip[0], j.hip[1] - 0.5, 5, 2.5, Z_BODY, SLOT.skin);
  } else {
    r.ellipse(j.chest[0], j.chest[1] - 1, 7 * b, 8.2, Z_BODY, chestColour, look.armour === 'plate' ? metalShine : {});
    r.ellipse(j.hip[0], j.hip[1] - 2.5, 5.8 * b, 5, Z_BODY - 0.5, look.armour === 'plate' ? SLOT.metal : chestColour, look.armour === 'plate' ? metalShine : {});
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
    const hem = FOOT_Y - (look.armour === 'dress' ? 1 : 2);
    const flare = look.armour === 'dress' ? 10 : 8;
    const sway = pose.nearLeg[0] - pose.farLeg[0];
    r.polygon([
      [j.hip[0] - 5.5 * b, j.hip[1] - 4], [j.hip[0] + 5.5 * b, j.hip[1] - 4],
      [j.hip[0] + flare * b + sway * 3 * dir, hem], [j.hip[0] - flare * b + sway * 3 * dir, hem + 0.5],
    ], Z_BODY + 1, SLOT.armour, { normal: [0, 0.1, 1], bevel: 3 });
    // A band of trim at the hem and down the front.
    r.beginPart();
    r.polygon([
      [j.hip[0] - flare * b + sway * 3 * dir, hem - 2.5], [j.hip[0] + flare * b + sway * 3 * dir, hem - 2.5],
      [j.hip[0] + flare * b + sway * 3 * dir, hem], [j.hip[0] - flare * b + sway * 3 * dir, hem + 0.5],
    ], Z_BODY + 1.5, SLOT.trim, { bevel: 1 });
    if (front) r.polygon([[j.hip[0] - 1.5, j.hip[1] - 4], [j.hip[0] + 1.5, j.hip[1] - 4], [j.hip[0] + 2, hem - 2], [j.hip[0] - 2, hem - 2]], Z_BODY + 1.6, SLOT.trim, { bevel: 0.5 });
  } else if (!bones && (look.armour === 'mail' || look.armour === 'plate' || look.armour === 'tunic')) {
    // A tabard or skirt of mail to the knee.
    r.beginPart();
    r.polygon([
      [j.hip[0] - 5 * b, j.hip[1] - 3], [j.hip[0] + 5 * b, j.hip[1] - 3],
      [j.hip[0] + 5.5 * b, j.hip[1] + 6], [j.hip[0] - 5.5 * b, j.hip[1] + 6],
    ], Z_BODY + 1, look.armour === 'tunic' ? SLOT.armour : SLOT.trim, { normal: [0, 0.1, 1], bevel: 2 });
  }
  if (!bones && !stone) {
    // The belt.
    r.beginPart();
    r.capsule(j.hip[0] - 5.2 * b, j.hip[1] - 4.5, j.hip[0] + 5.2 * b, j.hip[1] - 4.5, 1.3, 1.3, Z_BODY + 2, SLOT.dark);
    r.ellipse(j.hip[0] + dir * 1.5, j.hip[1] - 4.5, 1.4, 1.2, Z_BODY + 3, SLOT.metal, metalShine);
  }
  if (look.armour === 'plate' || (look.armour === 'mail' && b > 1.05)) {
    // Pauldrons.
    r.beginPart();
    r.ellipse(j.farShoulder[0], j.farShoulder[1], 3.6 * b, 3, Z_BODY + 3, SLOT.metal, metalShine);
    r.ellipse(j.nearShoulder[0], j.nearShoulder[1], 3.8 * b, 3.2, Z_NEAR + 1, SLOT.metal, metalShine);
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
    const at = look.weapon === 'staff' ? j.nearHand : j.nearHand;
    r.ellipse(at[0] + dir * 1.5, at[1] - 1.5, 2 + pose.glow * 2.5, 2 + pose.glow * 2.5, Z_NEAR + 6, SLOT.glow, { round: 0.3 });
  }

  if (!o.into) r.outline();
  return r;
}

function leg(r: Raster, hip: [number, number], knee: [number, number], foot: [number, number], z: number, look: HumanLook, dir: number): void {
  const bones = look.armour === 'bones';
  const slot = bones ? SLOT.skin : look.armour === 'stone' ? SLOT.armour : look.armour === 'plate' ? SLOT.metal : look.armour === 'leather' || look.armour === 'mail' ? SLOT.cloth : SLOT.dark;
  const w = bones ? 1.2 : 2.6 * Math.min(look.armour === 'stone' ? 1.6 : 1.15, look.bulk);
  r.capsule(hip[0], hip[1], knee[0], knee[1], w + 0.4, w, z, slot, look.armour === 'plate' ? { shine: true } : {});
  r.capsule(knee[0], knee[1], foot[0], foot[1] - 1.5, w, w * 0.85, z + 0.5, slot, look.armour === 'plate' ? { shine: true } : {});
  if (look.armour === 'stone') {
    r.ellipse(foot[0] + dir * 1.5, foot[1] - 2, w * 1.2, w * 0.8, z + 1, SLOT.armour);
  } else if (!bones) {
    // A boot, toe forward.
    r.capsule(foot[0] - dir * 0.5, foot[1] - 2.5, foot[0] + dir * 2.5, foot[1] - 0.8, 2.4, 1.7, z + 1, SLOT.dark);
  }
}

function arm(r: Raster, shoulder: [number, number], elbow: [number, number], hand: [number, number], z: number, slot: number, look: HumanLook): void {
  const bones = look.armour === 'bones';
  const w = bones ? 1.1 : 2.2 * Math.min(look.armour === 'stone' ? 1.7 : 1.15, look.bulk);
  r.capsule(shoulder[0], shoulder[1], elbow[0], elbow[1], w + 0.3, w, z, slot, slot === SLOT.metal ? { shine: true } : {});
  r.capsule(elbow[0], elbow[1], hand[0], hand[1], w, w * 0.85, z + 0.5, slot, slot === SLOT.metal ? { shine: true } : {});
  r.ellipse(hand[0], hand[1], look.armour === 'stone' ? 3.2 : 1.9, look.armour === 'stone' ? 3 : 1.9, z + 1, look.armour === 'plate' ? SLOT.metal : look.armour === 'stone' ? SLOT.armour : SLOT.skin);
}

function head(r: Raster, at: [number, number], look: HumanLook, dir: number, front: boolean, z: number): void {
  const [x, y] = at;
  const bones = look.armour === 'bones';
  // Long hair falls behind the head.
  if (look.head === 'stone') {
    // A boulder of a head, sunk between the shoulders, eyes glowing.
    r.ellipse(x, y + 3, 6.5, 5.5, z, SLOT.armour);
    if (front) {
      r.beginPart();
      r.capsule(x + dir * 1.5, y + 2.5, x + dir * 5, y + 2.5, 0.9, 0.9, z + 8, SLOT.glow);
    }
    return;
  }
  if (look.longHair && look.head !== 'greathelm') {
    r.capsule(x - dir * 2.5, y - 2, x - dir * 4, y + 9, 5.2, 3.6, z - 6, SLOT.hair);
  }
  r.ellipse(x, y, 7.6, 7.8, z, SLOT.skin);
  // The face: eyes looking the way the figure faces.
  if (front && look.head !== 'greathelm' && look.head !== 'mask') {
    r.beginPart();
    const ex = x + dir * 2.6;
    r.capsule(ex, y + 0.5, ex, y + 2, 0.7, 0.7, z + 9, bones ? SLOT.dark : SLOT.eye);
    r.capsule(ex + dir * 4, y + 0.5, ex + dir * 4, y + 2, 0.6, 0.6, z + 8, bones ? SLOT.dark : SLOT.eye);
  }
  r.beginPart();
  switch (look.head) {
    case 'hair':
      if (!bones) {
        // Hair over the crown and the back of the head; seen from behind, all of it.
        r.ellipse(x - dir * 1.2, y - 2.8, 8, 5.6, z + 1, SLOT.hair);
        if (!front) r.ellipse(x, y + 0.5, 7.8, 7.4, z + 2, SLOT.hair);
        else r.ellipse(x - dir * 4.8, y + 1.5, 3.6, 5.4, z + 1.5, SLOT.hair);
      }
      break;
    case 'helm':
      if (!front) r.ellipse(x, y + 1, 7.8, 7.4, z + 1.5, SLOT.hair);
      r.ellipse(x - dir * 0.5, y - 3, 8.2, 5.6, z + 2, SLOT.metal, { shine: true });
      r.capsule(x - 8, y - 0.6, x + 8, y - 0.6, 1.2, 1.2, z + 3, SLOT.trim);
      if (front) r.capsule(x + dir * 3.4, y - 1, x + dir * 3.4, y + 3, 0.8, 0.8, z + 9, SLOT.metal, { shine: true });
      break;
    case 'greathelm':
      r.ellipse(x, y, 7.8, 7.8, z + 2, SLOT.metal, { shine: true });
      r.capsule(x - 2, y - 7.5, x - dir * 1, y - 10, 1.6, 0.8, z + 1, SLOT.trim);
      if (front) r.capsule(x + dir * 1, y + 0.6, x + dir * 7, y + 0.6, 0.7, 0.7, z + 10, SLOT.dark);
      break;
    case 'hood':
      r.ellipse(x - dir * 1, y - 0.8, 8.8, 8.8, z - 1, SLOT.armour);
      if (!front) r.ellipse(x, y, 8.2, 8.2, z + 2, SLOT.armour);
      else r.ellipse(x + dir * 2.4, y + 1.2, 4.6, 5.2, z + 0.5, SLOT.skin);
      r.capsule(x - dir * 5, y + 6, x - dir * 2, y + 8.5, 3, 2, z - 1, SLOT.armour);
      break;
    case 'hat':
      r.ellipse(x - dir * 1.2, y - 2.5, 7.8, 5.2, z + 1, SLOT.hair);
      if (!front) r.ellipse(x, y + 0.5, 7.6, 7.2, z + 1.5, SLOT.hair);
      r.ellipse(x, y - 4.5, 11, 2.4, z + 3, SLOT.armour, { round: 0.6 });
      r.polygon([[x - 5.5, y - 5.5], [x + 5.5, y - 5.5], [x - dir * 4, y - 17], [x - dir * 5.5, y - 16]], z + 2, SLOT.armour, { normal: [dir * -0.3, -0.2, 1], bevel: 2 });
      r.capsule(x - 5.4, y - 6.4, x + 5.4, y - 6.4, 1, 1, z + 3.5, SLOT.trim);
      break;
    case 'mask':
      r.ellipse(x - dir * 1, y - 2.5, 7.8, 5.6, z + 1, SLOT.armour);
      if (!front) r.ellipse(x, y + 0.5, 7.8, 7.4, z + 1.5, SLOT.armour);
      r.capsule(x - 7, y + 3, x + 7, y + 3, 2.6, 2.6, z + 2, SLOT.armour);
      if (front) r.capsule(x + dir * 2, y + 0.4, x + dir * 6.5, y + 0.4, 0.6, 0.6, z + 9, SLOT.eye);
      break;
  }
}

function shield(r: Raster, hand: [number, number], look: HumanLook, dir: number, z: number): void {
  const [x, y] = [hand[0] + dir * 2, hand[1] - 2];
  const face: [number, number, number] = [dir * 0.35, 0, 1];
  if (look.shield === 'round') {
    r.ellipse(x, y, 6, 6.5, z, SLOT.shield, { round: 0.35 });
    r.ellipse(x, y, 1.8, 1.8, z + 2, SLOT.metal, { shine: true });
  } else if (look.shield === 'kite') {
    r.polygon([[x - 5.5, y - 7], [x + 5.5, y - 7], [x + 5, y + 2], [x, y + 9], [x - 5, y + 2]], z, SLOT.shield, { normal: face, bevel: 2 });
    r.beginPart();
    r.polygon([[x - 1.2, y - 6], [x + 1.2, y - 6], [x + 1.2, y + 5], [x - 1.2, y + 5]], z + 1, SLOT.trim, { normal: face, bevel: 0.5 });
  } else {
    r.polygon([[x - 6.5, y - 10], [x + 6.5, y - 10], [x + 6.5, y + 10], [x - 6.5, y + 10]], z, SLOT.shield, { normal: face, bevel: 2.5 });
    r.beginPart();
    r.polygon([[x - 6.5, y - 1.5], [x + 6.5, y - 1.5], [x + 6.5, y + 1.5], [x - 6.5, y + 1.5]], z + 1, SLOT.metal, { normal: face, bevel: 0.6, shine: true });
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

/** A weapon in a hand, pointing along `angle` (from straight down, forward positive). */
function weapon(r: Raster, kind: WeaponKind, hand: [number, number], angle: number, dir: number, z: number): void {
  const [hx, hy] = hand;
  const d = along(angle, dir);
  const at = (len: number): [number, number] => [hx + d[0] * len, hy + d[1] * len];
  const back = (len: number): [number, number] => [hx - d[0] * len, hy - d[1] * len];
  const metal = { shine: true };
  switch (kind) {
    case 'sword':
    case 'rapier': {
      const [gx, gy] = at(1.5);
      const [tx, ty] = at(kind === 'rapier' ? 17 : 15);
      r.capsule(gx, gy, tx, ty, kind === 'rapier' ? 0.8 : 1.4, 0.6, z, SLOT.metal, metal);
      const [px, py] = back(2.5);
      r.capsule(hx, hy, px, py, 0.9, 0.9, z - 0.5, SLOT.wood);
      r.capsule(gx - d[1] * 3, gy + d[0] * 3, gx + d[1] * 3, gy - d[0] * 3, 0.9, 0.9, z + 0.5, SLOT.trim, metal);
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
      const [tx, ty] = at(24);
      const [px, py] = back(6);
      r.capsule(px, py, tx, ty, 0.9, 0.9, z, SLOT.wood);
      const [sx, sy] = at(23);
      const [ex, ey] = at(29);
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
