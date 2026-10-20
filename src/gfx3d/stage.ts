import * as THREE from 'three';
import type { Terrain } from '../core/terrain';
import type { Anim, SpriteFrame, SpriteSet } from './sprites';
import { chooseView, frameAt } from './sprites';
import type { Placement, Shot } from './layout';
import { cameraPosition, FOV, lerpShot, WIDE } from './layout';
import { outlineNormals } from '../art/normals';
import { Arena } from './arena';
import type { ArenaOptions } from './arena';
import { Particles, glowMaterial } from './vfx';
import { Spells } from './spells';
import type { FxHost, Spot } from './spells';

// The 3D battlefield. Ogre Battle 64 stands its 2D sprites on polygon
// ground under a moving camera; so does this. The stage owns a Three.js
// scene and its camera, which the engine draws; the battle screen lays its
// interface over them and directs what happens on it: who marches, runs in,
// strikes, casts, flinches and falls, and where the camera looks.
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
  offset: THREE.Vector3; // marches, runs, hops and recoils, on top of the placement
  fallen: boolean;
}

/** How much of the hour's light a figure gives off by itself (the rest is the scene's lighting). */
const FIGURE_GLOW = 0.32;
/** How dark the soft patch under a figure's feet is. */
const BLOB = 0.24;
/** How near a unit runs in to strike: a body's length short of its target (more for great beasts). */
const REACH = 1.3;
const REACH_LARGE = 2.1;
/** Flashes of light at once (each a light the figures and ground are lit by). */
const FLASHES = 2;

export class BattleStage implements FxHost {
  /** What the engine draws: the field, and the camera over it. */
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly particles: Particles;
  readonly spells: Spells;
  /** The miniature look while the battle plays (see engine.ts). */
  tiltShift = 0.45;
  /** The view's size on screen, in CSS pixels (project() works in these). */
  private width = 1;
  private height = 1;
  private actors = new Map<number, Actor>();
  private textures = new Map<SpriteFrame['image'], THREE.Texture>();
  private tweens: Tween[] = [];
  private shot: Shot = WIDE;
  private shake = 0;
  /** The camera's push in on a blow, 0 to 1, easing out. */
  private push = 0;
  /** A blow's moment held still (hit-stop), ms left. */
  private still = 0;
  private arena: Arena | null = null;
  private flashes: { light: THREE.PointLight; until: number }[] = [];
  private flashClock = 0;
  private ring: THREE.Mesh;
  private ringOn: Actor | null = null;
  private ringT = 0;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 260);
    this.particles = new Particles(this.scene);
    this.spells = new Spells(this);
    // The flashes' lights are always there, dark until wanted, so that a
    // flash never changes what the scene's materials are drawn with.
    for (let k = 0; k < FLASHES; k++) {
      const light = new THREE.PointLight(0xffffff, 0, 7, 2);
      this.scene.add(light);
      this.flashes.push({ light, until: 0 });
    }
    // A ring of light under whoever acts.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.56, 40), glowMaterial(0xffe6a0));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);
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

  /** Lay out the ground the battle is fought on, under the sky the squads met under (see arena.ts). */
  setField(theme: FieldTheme, o: ArenaOptions): void {
    this.arena = new Arena(this.scene, theme, o);
  }

  /** How high the ground stands under a point. */
  private groundAt(x: number, z: number): number {
    return this.arena?.heightAt(x, z) ?? 0;
  }

  // ------------------------------------------------------------ the units --

  addUnit(id: number, set: SpriteSet, place: Placement): void {
    // Lit by the field's lights and shaded by the sprite's normal map.
    const mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    const body = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    // The figure casts its own shadow in the sun; a soft dark patch underfoot grounds it in any light.
    body.castShadow = true;
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(place.large ? 1.1 : 0.42, 14),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: BLOB, depthWrite: false }),
    );
    shadow.rotateX(-Math.PI / 2);
    shadow.position.y = 0.03;
    const root = new THREE.Group();
    root.add(body, shadow);
    root.position.set(place.x, this.groundAt(place.x, place.z), place.z);
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

  /** March onto the field from `dx` to the side of its place, as the battle opens. */
  marchIn(id: number, dx: number, ms: number): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.offset.set(dx, 0, 0);
    a.anim = 'walk';
    this.tween(ms, (k) => a.offset.setX(dx * (1 - k) * (1 - k * 0.15)), () => {
      a.offset.set(0, 0, 0);
      if (a.anim === 'walk') a.anim = 'idle';
    });
  }

  /** Run in to within striking reach of a point; `done` on arrival. */
  advance(id: number, toward: [number, number], ms: number, done: () => void): void {
    const a = this.actors.get(id);
    if (!a) {
      done();
      return;
    }
    const dx = toward[0] - a.place.x;
    const dz = toward[1] - a.place.z;
    const len = Math.hypot(dx, dz) || 1;
    const reach = Math.max(0, len - (a.place.large ? REACH_LARGE : REACH));
    const to = new THREE.Vector3((dx / len) * reach, 0, (dz / len) * reach);
    a.anim = 'walk';
    a.animT = 0;
    this.tween(ms, (k) => a.offset.copy(to).multiplyScalar(k * k * (3 - 2 * k)), () => {
      a.anim = 'idle';
      done();
    });
  }

  /** Back to its place after a blow, stepping backward. */
  withdraw(id: number, ms: number): void {
    const a = this.actors.get(id);
    if (!a || a.fallen) return;
    const from = a.offset.clone();
    this.tween(ms, (k) => {
      a.offset.copy(from).multiplyScalar(1 - k * k * (3 - 2 * k));
      // A little hop on the way.
      a.offset.y = Math.sin(k * Math.PI) * 0.18;
    }, () => a.offset.set(0, 0, 0));
  }

  /** A hop, for joy. */
  hop(id: number, ms: number, height = 0.45): void {
    const a = this.actors.get(id);
    if (!a || a.fallen) return;
    this.tween(ms, (k) => a.offset.setY(Math.sin(k * Math.PI) * height), () => a.offset.setY(0));
  }

  /** A struck unit flinches back. */
  recoil(id: number, strength = 1): void {
    const a = this.actors.get(id);
    if (!a || a.fallen) return;
    const dir = -a.place.facing;
    const base = a.offset.x;
    this.tween(240, (k) => a.offset.setX(base + dir * Math.sin(k * Math.PI) * 0.28 * strength), () => a.offset.setX(base));
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
    if (this.ringOn === a) this.highlight(null);
    this.tween(tip ? 480 : 900, (k) => {
      if (tip) a.body.rotation.z = a.place.facing * k * (Math.PI / 2.2);
      a.mat.opacity = 1 - k * (tip ? 0.85 : 0.55);
      a.mat.alphaTest = 0.05;
      (a.shadow.material as THREE.MeshBasicMaterial).opacity = BLOB * (1 - k);
    });
    a.body.castShadow = false;
  }

  /** Wash a unit in a colour for a moment. */
  flash(id: number, colour = 0xff6a5a): void {
    const a = this.actors.get(id);
    if (!a) return;
    a.mat.color.setHex(colour);
    this.tween(160, () => {}, () => a.mat.color.setHex(0xffffff));
  }

  /** Ring the unit about to act (null: no one). */
  highlight(id: number | null): void {
    this.ringOn = id === null ? null : this.actors.get(id) ?? null;
    this.ring.visible = !!this.ringOn;
    this.ringT = 0;
  }

  // ------------------------------------------------------------ effects --

  /** Where a unit stands, for the effects (see spells.ts). */
  spot(id: number): Spot | null {
    const a = this.actors.get(id);
    if (!a) return null;
    const feet = a.root.position.clone();
    return { feet, chest: feet.clone().add(new THREE.Vector3(0, a.height * 0.55, 0)), height: a.height };
  }

  /** A flash of light at a point, for `ms`, lighting the figures and the ground about it. */
  light(at: THREE.Vector3, colour: number, peak: number, ms: number): void {
    // The flash that ends soonest gives way.
    const f = this.flashes.reduce((x, y) => (y.until < x.until ? y : x));
    f.until = this.flashClock + ms;
    f.light.color.setHex(colour);
    f.light.position.copy(at).add(new THREE.Vector3(0, 0.3, 0.6));
    const light = f.light;
    const until = f.until;
    this.tween(ms, (k) => {
      if (f.until === until) light.intensity = peak * (k < 0.15 ? k / 0.15 : (1 - k) / 0.85);
    }, () => {
      if (f.until === until) light.intensity = 0;
    });
  }

  /** Hold the moment still for `ms` (a blow's weight). */
  hitStop(ms: number): void {
    this.still = Math.max(this.still, ms);
  }

  /** Push the camera in a little, easing back out (a heavy blow). */
  punch(amount = 1): void {
    this.push = Math.max(this.push, amount);
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
    const x = a.place.x + a.offset.x;
    const z = a.place.z + a.offset.z;
    const y = this.groundAt(x, z) + a.offset.y;
    const feet = new THREE.Vector3(x, y, z).project(this.camera);
    const head = new THREE.Vector3(x, y + a.height, z).project(this.camera);
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
    this.flashClock += dtMs;
    // A held moment: nothing moves but the camera's shake.
    if (this.still > 0) {
      this.still -= dtMs;
      this.applyShot();
      this.shake *= 0.86;
      return;
    }
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
      const x = a.place.x + a.offset.x;
      const z = a.place.z + a.offset.z;
      a.root.position.set(x, this.groundAt(x, z) + a.offset.y, z);
      // The patch underfoot stays on the ground when the figure leaves it.
      a.shadow.position.y = 0.03 - a.offset.y;
      this.drawActor(a);
    }
    if (this.ringOn) {
      this.ringT += dtMs;
      const p = this.ringOn.root.position;
      this.ring.position.set(p.x, p.y - this.ringOn.offset.y + 0.05, p.z);
      const pulse = 1 + Math.sin(this.ringT / 120) * 0.06;
      this.ring.scale.setScalar((this.ringOn.place.large ? 1.55 : 1) * pulse);
    }
    this.push *= Math.pow(0.02, dtMs / 1000);
    this.applyShot();
    this.shake *= 0.86;
    this.particles.update(dtMs, this.camera);
    this.arena?.update(dtMs, this.camera, new THREE.Vector3(...this.shot.target), this.shot.distance);
  }

  /** How many passing effects are on the field now (for tests). */
  get effectCount(): number {
    return this.spells.count;
  }

  dispose(): void {
    // The arena takes away its own (some of its shapes are the campaign map's too).
    this.arena?.dispose();
    this.particles.dispose();
    for (const t of this.textures.values()) t.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const f of this.flashes) f.light.dispose();
  }

  // ------------------------------------------------------------- internals --

  /** Run `step` over `ms` (k from 0 to 1), then `done`. */
  tween(ms: number, step: (k: number) => void, done?: () => void): void {
    this.tweens.push({ t: 0, dur: Math.max(1, ms), step, done });
  }

  private applyShot(): void {
    const shot = this.push > 0.001 ? { ...this.shot, distance: this.shot.distance * (1 - this.push * 0.07) } : this.shot;
    const [x, y, z] = cameraPosition(shot);
    const j = this.shake;
    this.camera.position.set(x + (Math.random() - 0.5) * j, y + (Math.random() - 0.5) * j, z);
    this.camera.lookAt(shot.target[0], shot.target[1], shot.target[2]);
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
      a.mat.emissiveMap = tex;
      a.mat.normalMap = normal;
      if (fresh) a.mat.needsUpdate = true;
    }
    // A glow of the hour's light of its own, so a figure reads even with the sun behind it.
    if (this.arena) a.mat.emissive.copy(this.arena.atmosphere.flatLight).multiplyScalar(FIGURE_GLOW);
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
