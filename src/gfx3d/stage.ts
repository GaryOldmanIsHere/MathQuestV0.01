import * as THREE from 'three';
import type { Element } from '../core/types';
import type { Terrain } from '../core/terrain';
import type { Anim, SpriteFrame, SpriteSet } from './sprites';
import { chooseView, frameAt } from './sprites';
import type { Placement, Shot } from './layout';
import { cameraPosition, FOV, lerpShot, WIDE } from './layout';
import { outlineNormals } from '../art/normals';

// The 3D battlefield. Ogre Battle 64 stands its 2D sprites on polygon
// ground under a moving camera; so does this. The stage owns a Three.js
// scene and its camera, which the engine draws; the battle screen lays its
// interface over them.
//
// Everything here is presentation. The battle itself has already been
// decided by simulateBattle; the stage only acts out its event log.

export type FieldTheme = Terrain;

interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done?: () => void;
}

interface Actor {
  id: number;
  set: SpriteSet;
  place: Placement;
  root: THREE.Group;
  body: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  shadow: THREE.Mesh;
  anim: Anim;
  animT: number;
  onAnimDone?: () => void;
  height: number;
  offset: THREE.Vector3; // lunges and recoils, on top of the placement
  fallen: boolean;
}

const ELEMENT_COLOUR: Record<Element | 'physical', number> = {
  physical: 0xf0e8d0, wind: 0x9ae0ff, flame: 0xff8a3a, earth: 0xc8a060, water: 0x5aa0ff,
  virtue: 0xfff2a0, bane: 0xb070ff, drakonite: 0xffd040,
};

/** A small seeded generator for scenery, kept apart from the game's own. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const THEMES: Record<FieldTheme, { ground: number[]; sky: number; fog: number; decor: 'trees' | 'forest' | 'rocks' | 'shore' | 'road' }> = {
  plain: { ground: [0x5a8c3c, 0x4e7e34, 0x669a44, 0x5a8434], sky: 0x9cc4e8, fog: 0xb8d0e0, decor: 'trees' },
  road: { ground: [0x5a8c3c, 0x4e7e34, 0x669a44, 0x5a8434], sky: 0x9cc4e8, fog: 0xb8d0e0, decor: 'road' },
  forest: { ground: [0x3e6a2e, 0x355e28, 0x4a7836, 0x2e5424], sky: 0x8ab0c8, fog: 0x7a9a88, decor: 'forest' },
  mountain: { ground: [0x7a7060, 0x6a6254, 0x86806e, 0x5e7046], sky: 0xa8bcd0, fog: 0xc0c8d0, decor: 'rocks' },
  water: { ground: [0x7a9a50, 0x6a8c44, 0xb8a878, 0x5e8a40], sky: 0xa0c8e8, fog: 0xc0d8e8, decor: 'shore' },
};

export class BattleStage {
  /** What the engine draws: the field, and the camera over it. */
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** The view's size on screen, in CSS pixels (project() works in these). */
  private width = 1;
  private height = 1;
  private actors = new Map<number, Actor>();
  private textures = new Map<SpriteFrame['image'], THREE.Texture>();
  /**
   * The shapes the passing effects (bolts, sparks) are cut from, shared for
   * the whole battle: an effect gone from the scene is gone from the graphics
   * card too, so a long war does not pile them up.
   */
  private effectShapes = {
    spark: new THREE.PlaneGeometry(0.12, 0.12),
    blow: new THREE.SphereGeometry(0.09, 8, 6),
    bolt: new THREE.SphereGeometry(0.2, 8, 6),
  };
  private tweens: Tween[] = [];
  private shot: Shot = WIDE;
  private shake = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
    this.scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x506040, 1.3));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.6);
    sun.position.set(-6, 12, 8);
    this.scene.add(sun);
    this.applyShot();
  }

  /** Fit the camera to the view's size on screen. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  /** The view's width over its height, for framing shots. */
  get aspect(): number {
    return this.width / this.height;
  }

  // ------------------------------------------------------------ the field --

  setField(theme: FieldTheme, seed = 7): void {
    const t = THEMES[theme];
    const rand = seeded(seed);
    this.scene.background = new THREE.Color(t.sky);
    this.scene.fog = new THREE.Fog(t.fog, 26, 70);

    // Ground: a wide low-poly sheet, flat where the squads stand and rolling
    // beyond, flat-shaded and vertex-coloured the way N64 fields are.
    const geo = new THREE.PlaneGeometry(90, 70, 60, 46);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colours: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const edge = Math.max(0, Math.max(Math.abs(x) - 11, (Math.abs(z) - 6) * 1.4)) / 10;
      const roll = Math.sin(x * 0.31 + seed) * Math.cos(z * 0.27) + Math.sin(x * 0.11 - z * 0.17) * 1.5;
      const ridge = theme === 'mountain' ? Math.max(0, -z - 9) * 0.9 : 0;
      pos.setY(i, edge * edge * (1.2 + roll) * (theme === 'mountain' ? 2.4 : 1) + ridge * (0.6 + rand() * 0.5));
      c.setHex(t.ground[Math.floor(rand() * t.ground.length)]);
      if (theme === 'road' && Math.abs(z - 0.5) < 1.6) c.setHex(rand() < 0.5 ? 0xa08a60 : 0x948058);
      if (theme === 'water' && z < -9) c.setHex(0xb8a878);
      colours.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo.toNonIndexed(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    ground.geometry.computeVertexNormals();
    this.scene.add(ground);

    if (t.decor === 'shore') {
      const sea = new THREE.Mesh(
        new THREE.PlaneGeometry(120, 40),
        new THREE.MeshLambertMaterial({ color: 0x3a78b8, transparent: true, opacity: 0.88 }),
      );
      sea.rotateX(-Math.PI / 2);
      sea.position.set(0, 0.35, -32);
      this.scene.add(sea);
    }

    const away = () => {
      // somewhere off the battle line
      for (;;) {
        const x = (rand() - 0.5) * 80;
        const z = -6 - rand() * 28 + (rand() < 0.25 ? 26 + rand() * 6 : 0);
        if (Math.abs(x) > 12 || Math.abs(z) > 7.5) return [x, z] as const;
      }
    };
    const trees = { trees: 22, road: 18, forest: 70, rocks: 6, shore: 10 }[t.decor];
    for (let i = 0; i < trees; i++) {
      const [x, z] = away();
      this.scene.add(this.tree(x, z, rand, t.decor === 'forest'));
    }
    const rocks = { trees: 6, road: 6, forest: 4, rocks: 40, shore: 8 }[t.decor];
    for (let i = 0; i < rocks; i++) {
      const [x, z] = away();
      const r = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.4 + rand() * (t.decor === 'rocks' ? 1.6 : 0.6), 0),
        new THREE.MeshLambertMaterial({ color: rand() < 0.5 ? 0x8a8478 : 0x6e695e, flatShading: true }),
      );
      r.position.set(x, 0.2, z);
      r.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      this.scene.add(r);
    }
    // Distant hills ring the field.
    for (let i = 0; i < 9; i++) {
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(8 + rand() * 8, (theme === 'mountain' ? 14 : 5) + rand() * 6, 6),
        new THREE.MeshLambertMaterial({ color: theme === 'mountain' ? 0x7a7a84 : 0x4a6e48, flatShading: true }),
      );
      hill.position.set(-50 + i * 12.5 + rand() * 4, 0, -46 - rand() * 8);
      this.scene.add(hill);
    }
  }

  private tree(x: number, z: number, rand: () => number, dense: boolean): THREE.Group {
    const g = new THREE.Group();
    const h = 1.6 + rand() * (dense ? 2.4 : 1.4);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, h * 0.4, 5), new THREE.MeshLambertMaterial({ color: 0x6a4a2a, flatShading: true }));
    trunk.position.y = h * 0.2;
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(0.5 + rand() * 0.4, h, 6),
      new THREE.MeshLambertMaterial({ color: rand() < 0.5 ? 0x2e5a2a : 0x386a30, flatShading: true }),
    );
    crown.position.y = h * 0.4 + h * 0.5;
    g.add(trunk, crown);
    g.position.set(x, 0, z);
    return g;
  }

  // ------------------------------------------------------------ the units --

  addUnit(id: number, set: SpriteSet, place: Placement): void {
    // Lit by the field's lights and shaded by the sprite's normal map.
    const mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    const body = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(place.large ? 1.1 : 0.42, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }),
    );
    shadow.rotateX(-Math.PI / 2);
    shadow.position.y = 0.02;
    const root = new THREE.Group();
    root.add(body, shadow);
    root.position.set(place.x, 0, place.z);
    this.scene.add(root);
    const actor: Actor = {
      id, set, place, root, body, mat, shadow, anim: 'idle', animT: Math.random() * 2000, height: place.large ? 2.4 : 1.55,
      offset: new THREE.Vector3(), fallen: false,
    };
    this.actors.set(id, actor);
    this.drawActor(actor);
  }

  has(id: number): boolean {
    return this.actors.has(id);
  }

  /** How long a unit's animation runs, and when in it the blow lands (the script's mark, else halfway). */
  timing(id: number, anim: Anim): { total: number; hit: number } {
    const a = this.actors.get(id);
    if (!a) return { total: 400, hit: 200 };
    const clip = chooseView(a.set, this.screenFacing(a)).view.anims[anim];
    let t = 0;
    let hit = -1;
    for (const f of clip.frames) {
      if (f.hit && hit < 0) hit = t;
      t += f.ms;
    }
    return { total: t, hit: hit >= 0 ? hit : t / 2 };
  }

  /** Play an animation; non-looping ones return to idle, then call `done`. */
  play(id: number, anim: Anim, done?: () => void): void {
    const a = this.actors.get(id);
    if (!a || a.fallen) {
      done?.();
      return;
    }
    a.anim = anim;
    a.animT = 0;
    a.onAnimDone = done;
  }

  /** Step toward a point and back: a melee blow lands at the turn. */
  lunge(id: number, toward: [number, number], ms: number, atTurn?: () => void): void {
    const a = this.actors.get(id);
    if (!a) return;
    const dx = toward[0] - a.place.x;
    const dz = toward[1] - a.place.z;
    const len = Math.hypot(dx, dz) || 1;
    const reach = Math.max(0, len - (a.place.large ? 2.2 : 1.4));
    let turned = false;
    this.tween(ms, (k) => {
      const out = k < 0.5 ? k * 2 : (1 - k) * 2;
      const ease = Math.sin((out * Math.PI) / 2);
      a.offset.set((dx / len) * reach * ease, 0, (dz / len) * reach * ease);
      if (!turned && k >= 0.5) {
        turned = true;
        atTurn?.();
      }
    }, () => a.offset.set(0, 0, 0));
  }

  /** A struck unit flinches back. */
  recoil(id: number): void {
    const a = this.actors.get(id);
    if (!a || a.fallen) return;
    const dir = -a.place.facing;
    this.tween(220, (k) => a.offset.set(dir * Math.sin(k * Math.PI) * 0.25, 0, 0), () => a.offset.set(0, 0, 0));
  }

  /**
   * Knocked out: the unit plays its fall and stays down, fading. Art drawn
   * with its own fall (Ogre Battle 64's) lies down by itself; a one-pose
   * drawing is tipped over.
   */
  fall(id: number): void {
    const a = this.actors.get(id);
    if (!a || a.fallen) return;
    a.fallen = true;
    a.anim = 'fall';
    a.animT = 0;
    const tip = !a.set.ownFall;
    this.tween(tip ? 480 : 900, (k) => {
      if (tip) a.body.rotation.z = a.place.facing * k * (Math.PI / 2.2);
      a.mat.opacity = 1 - k * (tip ? 0.85 : 0.55);
      a.mat.alphaTest = 0.05;
      (a.shadow.material as THREE.MeshBasicMaterial).opacity = 0.32 * (1 - k);
    });
  }

  /** A bolt of light from one unit to another; `hit` when it lands. */
  projectile(from: number, to: number, element: Element | 'physical', ms: number, hit: () => void, arc = 0.8): void {
    const a = this.actors.get(from);
    const b = this.actors.get(to);
    if (!a || !b) {
      hit();
      return;
    }
    const orb = new THREE.Mesh(
      element === 'physical' ? this.effectShapes.blow : this.effectShapes.bolt,
      new THREE.MeshBasicMaterial({ color: ELEMENT_COLOUR[element] }),
    );
    this.scene.add(orb);
    const p0 = new THREE.Vector3(a.place.x, a.height * 0.6, a.place.z);
    const p1 = new THREE.Vector3(b.place.x, b.height * 0.5, b.place.z);
    this.tween(ms, (k) => {
      orb.position.lerpVectors(p0, p1, k);
      orb.position.y += Math.sin(k * Math.PI) * arc;
    }, () => {
      this.discard(orb);
      hit();
    });
  }

  /** A burst on a unit: blows spark, spells bloom in their element's colour, heals rise. */
  burst(id: number, element: Element | 'physical', kind: 'hit' | 'spell' | 'heal'): void {
    const a = this.actors.get(id);
    if (!a) return;
    const colour = kind === 'heal' ? 0x90ffa0 : ELEMENT_COLOUR[element];
    const n = kind === 'hit' ? 6 : 14;
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(this.effectShapes.spark, new THREE.MeshBasicMaterial({ color: colour, transparent: true, side: THREE.DoubleSide }));
      const ang = (i / n) * Math.PI * 2;
      const spread = kind === 'hit' ? 0.7 : 1.1;
      const start = new THREE.Vector3(a.place.x, a.height * 0.55, a.place.z);
      p.position.copy(start);
      this.scene.add(p);
      this.tween(kind === 'heal' ? 700 : 420, (k) => {
        if (kind === 'heal') p.position.set(start.x + Math.cos(ang) * 0.4, start.y - 0.5 + k * 1.6, start.z + Math.sin(ang) * 0.3);
        else p.position.set(start.x + Math.cos(ang) * spread * k, start.y + Math.sin(ang) * spread * k * 0.8, start.z + Math.sin(ang * 1.7) * 0.3 * k);
        p.lookAt(this.camera.position);
        (p.material as THREE.MeshBasicMaterial).opacity = 1 - k;
      }, () => this.discard(p));
    }
  }

  /** Wash a unit in a colour for a moment. */
  flash(id: number, colour = 0xff6a5a): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.mat.color.setHex(colour);
    this.tween(160, () => {}, () => a.mat.color.setHex(0xffffff));
  }

  // ------------------------------------------------------------ the camera --

  /** Move the camera to a shot over `ms`. */
  cut(to: Shot, ms: number): void {
    const from = this.shot;
    if (ms <= 0) {
      this.shot = to;
      return;
    }
    this.tween(ms, (k) => {
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      this.shot = lerpShot(from, to, e);
    });
  }

  quake(strength = 0.18): void {
    this.shake = Math.max(this.shake, strength);
  }

  /** A unit's head and feet on screen, in canvas pixels. */
  project(id: number): { x: number; y: number; headY: number } | null {
    const a = this.actors.get(id);
    if (!a) return null;
    const feet = new THREE.Vector3(a.place.x + a.offset.x, 0, a.place.z + a.offset.z).project(this.camera);
    const head = new THREE.Vector3(a.place.x + a.offset.x, a.height, a.place.z + a.offset.z).project(this.camera);
    const w = this.width;
    const h = this.height;
    return { x: (feet.x * 0.5 + 0.5) * w, y: (-feet.y * 0.5 + 0.5) * h, headY: (-head.y * 0.5 + 0.5) * h };
  }

  position(id: number): [number, number] | null {
    const a = this.actors.get(id);
    return a ? [a.place.x, a.place.z] : null;
  }

  // ------------------------------------------------------------ the frame --

  update(dtMs: number): void {
    for (const tw of [...this.tweens]) {
      tw.t += dtMs;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.done?.();
      }
    }
    for (const a of this.actors.values()) {
      a.animT += dtMs;
      if (!a.fallen) {
        const clip = chooseView(a.set, this.screenFacing(a)).view.anims[a.anim];
        if (frameAt(clip, a.animT).done) {
          const done = a.onAnimDone;
          a.anim = 'idle';
          a.animT = 0;
          a.onAnimDone = undefined;
          done?.();
        }
      }
      a.root.position.set(a.place.x + a.offset.x, 0, a.place.z + a.offset.z);
      this.drawActor(a);
    }
    this.applyShot();
    this.shake *= 0.86;
  }

  /** The canvas the last update drew into; copy it out before anything else renders. */
  /** Take a passing effect off the field, letting go of its material (its shape is shared). */
  private discard(effect: THREE.Mesh): void {
    this.scene.remove(effect);
    (effect.material as THREE.Material).dispose();
  }

  /** How many passing effects are on the field now (for tests). */
  get effectCount(): number {
    const shapes = new Set<THREE.BufferGeometry>(Object.values(this.effectShapes));
    let n = 0;
    this.scene.traverse((o) => {
      if (shapes.has((o as THREE.Mesh).geometry)) n++;
    });
    return n;
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    // Effects still in flight are in the scene and go below; their shared shapes once, here.
    for (const g of Object.values(this.effectShapes)) g.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
  }

  // ------------------------------------------------------------- internals --

  private tween(dur: number, step: (k: number) => void, done?: () => void): void {
    this.tweens.push({ t: 0, dur: Math.max(1, dur), step, done });
  }

  private applyShot(): void {
    const [x, y, z] = cameraPosition(this.shot);
    const j = this.shake;
    this.camera.position.set(x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, z);
    this.camera.lookAt(this.shot.target[0], this.shot.target[1], this.shot.target[2]);
  }

  private textureOf(image: SpriteFrame['image'], normals = false): THREE.Texture {
    let tex = this.textures.get(image);
    if (!tex) {
      tex = new THREE.Texture(image as HTMLCanvasElement);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = normals ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      this.textures.set(image, tex);
    }
    return tex;
  }

  /** Which way a unit faces as the camera sees it. */
  private screenFacing(a: Actor): 'left' | 'right' {
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    return right.x * a.place.facing >= 0 ? 'right' : 'left';
  }

  /** Choose the frame for the unit's animation and the way it faces on screen, and turn it to the camera. */
  private drawActor(a: Actor): void {
    const { view, mirror } = chooseView(a.set, this.screenFacing(a));
    const frame = frameAt(view.anims[a.anim], a.animT).frame;
    const tex = this.textureOf(frame.image);
    const normal = this.textureOf(frame.normal ?? outlineNormals(frame.image), true);
    if (a.mat.map !== tex || a.mat.normalMap !== normal) {
      const fresh = !a.mat.map || !a.mat.normalMap;
      a.mat.map = tex;
      a.mat.normalMap = normal;
      if (fresh) a.mat.needsUpdate = true;
    }
    const img = frame.image as { width: number; height: number };
    const scale = (a.place.large ? a.set.largeScale : 1) / a.set.pixelsPerUnit;
    const w = img.width * scale;
    const h = img.height * scale;
    const flip = mirror ? -1 : 1;
    a.body.scale.set(flip * w, h, 1);
    // Stand the frame's anchor (the feet) on the unit's spot, and carry out
    // the animation's own movement (a hop, a lunge) in drawing pixels.
    a.body.position.set(
      ((img.width / 2 - frame.anchorX) + (frame.dx ?? 0)) * scale * flip,
      h / 2 - (img.height - frame.anchorY) * scale - (frame.dz ?? 0) * scale,
      0,
    );
    // Cylindrical billboard: the whole unit turns square to the camera, upright.
    a.root.rotation.y = Math.atan2(this.camera.position.x - a.root.position.x, this.camera.position.z - a.root.position.z);
    a.height = Math.max(0.8, frame.anchorY * scale);
  }
}
