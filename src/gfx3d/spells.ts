import * as THREE from 'three';
import type { Element } from '../core/types';
import { arcTexture, glowMaterial, glyphTexture, scatter } from './vfx';
import type { Particles } from './vfx';

// What blows and spells look like as they land: a sword's arc and sparks,
// arrows in flight, a magic circle under a caster and light gathering in
// their hands, and for each element its own spell: fire bursting, water
// rising in a column, a whirlwind, stone spikes breaking the ground, a
// pillar of holy light, darkness drawing in, a dragon's golden breath. Each
// lights the field about it as it lands. Presentation only.

export type Hue = Element | 'physical';

/** The colour of each element's light. */
export const ELEMENT_COLOUR: Record<Hue, number> = {
  physical: 0xf0e8d0, wind: 0x9ae8ff, flame: 0xff7a2a, earth: 0xd8a860, water: 0x4aa8ff,
  virtue: 0xfff0a0, bane: 0xb060ff, drakonite: 0xffc838,
};

/** A unit's place on the field, as an effect needs it. */
export interface Spot {
  feet: THREE.Vector3;
  chest: THREE.Vector3;
  height: number;
}

/** What the stage lends the effects. */
export interface FxHost {
  scene: THREE.Scene;
  camera: THREE.Camera;
  particles: Particles;
  spot(id: number): Spot | null;
  tween(ms: number, step: (k: number) => void, done?: () => void): void;
  /** A flash of light at a point, lighting the figures and the ground about it. */
  light(at: THREE.Vector3, colour: number, peak: number, ms: number): void;
  quake(strength: number): void;
}

const colourOf = (h: Hue) => new THREE.Color(ELEMENT_COLOUR[h]);

export class Spells {
  /** Effects' own shapes still on the field (for the leak check). */
  private shapes = new Set<THREE.Mesh>();

  constructor(private host: FxHost) {}

  get count(): number {
    return this.shapes.size + this.host.particles.count;
  }

  // ------------------------------------------------------------- blows --

  /** A blow lands: the weapon's arc across the target, sparks, and a flash. */
  slash(targetId: number, hue: Hue, facing: 1 | -1, heavy = false): void {
    const s = this.host.spot(targetId);
    if (!s) return;
    const mat = glowMaterial(hue === 'physical' ? 0xfff6e0 : ELEMENT_COLOUR[hue], arcTexture());
    // Drawn over the figure it cuts across.
    mat.depthTest = false;
    const arc = this.shape(new THREE.PlaneGeometry(2.1, 2.1), mat);
    arc.renderOrder = 8;
    arc.position.copy(s.chest).add(this.host.camera.position.clone().sub(s.chest).normalize().multiplyScalar(0.5));
    arc.scale.x = -facing;
    const spin = (Math.random() - 0.5) * 0.8;
    this.host.tween(260, (k) => {
      arc.quaternion.copy(this.host.camera.quaternion);
      arc.rotateZ(spin - k * 1.2 * facing);
      arc.scale.setScalar(0.8 + k * 0.5).multiply(new THREE.Vector3(-facing, 1, 1));
      (arc.material as THREE.MeshBasicMaterial).opacity = 1 - k;
    }, () => this.drop(arc));
    this.sparks(s.chest, hue, heavy ? 22 : 12, heavy ? 3.4 : 2.6);
    this.host.light(s.chest, hue === 'physical' ? 0xffe8c0 : ELEMENT_COLOUR[hue], heavy ? 9 : 5, 200);
  }

  /** Sparks flying from a point. */
  sparks(at: THREE.Vector3, hue: Hue, n: number, speed: number): void {
    const c = colourOf(hue).lerp(new THREE.Color(0xffffff), 0.35);
    for (let k = 0; k < n; k++) {
      this.host.particles.emit({
        pos: at, vel: scatter(speed, speed * 0.4), life: 260 + Math.random() * 260, size: 0.16 + Math.random() * 0.14, grow: 0.4,
        colour: c, gravity: 6, drag: 0.15,
      });
    }
  }

  /** An arrow loosed from one unit at another, on a rising arc; `land` as it strikes. */
  arrow(fromId: number, toId: number, ms: number, land: () => void, hue: Hue = 'physical'): void {
    const a = this.host.spot(fromId);
    const b = this.host.spot(toId);
    if (!a || !b) {
      land();
      return;
    }
    const shaft = this.shape(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 4), new THREE.MeshBasicMaterial({ color: 0xe8dcc0 }));
    const p0 = a.chest.clone();
    const p1 = b.chest.clone();
    const rise = 0.6 + p0.distanceTo(p1) * 0.06;
    const prev = p0.clone();
    const tail = hue === 'physical' ? new THREE.Color(0xfff2d0).multiplyScalar(0.5) : colourOf(hue);
    this.host.tween(ms, (k) => {
      prev.copy(shaft.position);
      shaft.position.lerpVectors(p0, p1, k);
      shaft.position.y += Math.sin(k * Math.PI) * rise;
      // Point along its flight.
      const dir = shaft.position.clone().sub(prev);
      if (dir.lengthSq() > 1e-6) shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      this.host.particles.emit({ pos: shaft.position, vel: new THREE.Vector3(), life: 180, size: hue === 'physical' ? 0.08 : 0.2, grow: 0.3, colour: tail });
    }, () => {
      this.drop(shaft);
      land();
    });
  }

  // ------------------------------------------------------------ casting --

  /** A magic circle turning on the ground under a caster while they cast. */
  glyph(id: number, hue: Hue, ms: number): void {
    const s = this.host.spot(id);
    if (!s) return;
    const ring = this.shape(new THREE.PlaneGeometry(2.4, 2.4), glowMaterial(ELEMENT_COLOUR[hue], glyphTexture()));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(s.feet).add(new THREE.Vector3(0, 0.04, 0));
    const mat = ring.material as THREE.MeshBasicMaterial;
    this.host.tween(ms, (k) => {
      ring.rotation.z = k * 2.2;
      const grow = Math.min(1, k * 4);
      ring.scale.setScalar(0.3 + grow * 0.7);
      mat.opacity = k < 0.8 ? Math.min(1, k * 5) : (1 - k) * 5;
    }, () => this.drop(ring));
    // Motes rise from the circle.
    const c = colourOf(hue);
    const motes = Math.round(ms / 40);
    for (let k = 0; k < motes; k++) {
      const a = Math.random() * Math.PI * 2;
      this.host.particles.emit({
        pos: s.feet.clone().add(new THREE.Vector3(Math.cos(a) * 1.0, 0.05, Math.sin(a) * 1.0)),
        vel: new THREE.Vector3(0, 0.9 + Math.random() * 0.8, 0), life: 600 + Math.random() * 500, size: 0.1, grow: 0.5, colour: c,
      });
    }
    this.host.light(s.feet.clone().add(new THREE.Vector3(0, 0.5, 0)), ELEMENT_COLOUR[hue], 3, ms);
  }

  /** Light gathering into a caster's hands. */
  gather(id: number, hue: Hue, ms: number): void {
    const s = this.host.spot(id);
    if (!s) return;
    const hands = s.chest.clone().add(new THREE.Vector3(0, s.height * 0.15, 0));
    const c = colourOf(hue);
    for (let k = 0; k < 26; k++) {
      this.host.particles.emit({
        pos: hands.clone().add(scatter(1.6, 0.3)), vel: scatter(0.6), life: ms * (0.6 + Math.random() * 0.4), size: 0.14, grow: 0.5,
        colour: c, toward: hands,
      });
    }
  }

  // ------------------------------------------------------------- spells --

  /**
   * A spell cast at a unit, in its element's manner; `land` when it strikes
   * (the amounts and the flinch go then). Returns about how long it takes to land, ms.
   */
  spell(fromId: number, toId: number, hue: Hue, land: () => void): number {
    switch (hue) {
      case 'flame': return this.fireball(fromId, toId, land);
      case 'water': return this.column(toId, land);
      case 'wind': return this.whirlwind(toId, land);
      case 'earth': return this.spikes(toId, land);
      case 'virtue': return this.pillar(toId, land, 0xfff0a0);
      case 'bane': return this.darkness(toId, land);
      case 'drakonite': return this.breath(fromId, toId, land);
      default: return this.bolt(fromId, toId, hue, land);
    }
  }

  /** A healing light: a soft pillar and motes rising about the unit. */
  heal(toId: number): void {
    const s = this.host.spot(toId);
    if (!s) return;
    this.pillar(toId, () => {}, 0x9affb0, 0.55);
    const c = new THREE.Color(0x9affb0);
    for (let k = 0; k < 24; k++) {
      const a = Math.random() * Math.PI * 2;
      this.host.particles.emit({
        pos: s.feet.clone().add(new THREE.Vector3(Math.cos(a) * 0.5, Math.random() * 0.4, Math.sin(a) * 0.4)),
        vel: new THREE.Vector3(0, 1.2 + Math.random() * 0.9, 0), life: 700 + Math.random() * 400, size: 0.14, grow: 0.4, colour: c,
      });
    }
  }

  /** An orb of the element's light thrown at the unit, bursting. */
  private bolt(fromId: number, toId: number, hue: Hue, land: () => void): number {
    const ms = 420;
    this.orb(fromId, toId, hue, ms, 0.5, 0.2, () => {
      this.burst(toId, hue, 18);
      land();
    });
    return ms;
  }

  private fireball(fromId: number, toId: number, land: () => void): number {
    const ms = 480;
    this.orb(fromId, toId, 'flame', ms, 0.9, 0.3, () => {
      const s = this.host.spot(toId);
      if (s) {
        // Fire bursts upward and out, embers falling.
        const hot = new THREE.Color(0xffd070);
        const deep = new THREE.Color(0xff5a1a);
        for (let k = 0; k < 40; k++) {
          this.host.particles.emit({
            pos: s.chest, vel: scatter(3.2, 1.6), life: 380 + Math.random() * 420, size: 0.3 + Math.random() * 0.3, grow: 1.8,
            colour: k % 3 ? deep : hot, gravity: -1.5, drag: 0.08,
          });
        }
        this.host.light(s.chest, 0xff7a2a, 14, 420);
        this.host.quake(0.25);
      }
      land();
    });
    return ms;
  }

  /** Water rising in a column under the unit, then crashing down. */
  private column(toId: number, land: () => void): number {
    const s = this.host.spot(toId);
    if (!s) {
      land();
      return 0;
    }
    const ms = 520;
    const geo = new THREE.CylinderGeometry(0.55, 0.75, 1, 14, 1, true);
    geo.translate(0, 0.5, 0);
    const col = this.shape(geo, glowMaterial(0x3a8ee8));
    col.position.copy(s.feet);
    const mat = col.material as THREE.MeshBasicMaterial;
    const blue = new THREE.Color(0x6ab8ff);
    let landed = false;
    this.host.tween(ms, (k) => {
      col.scale.set(1 - k * 0.3, Math.sin(Math.min(1, k * 1.6) * Math.PI / 2) * 3.2 * (1 - Math.max(0, k - 0.7) * 2), 1 - k * 0.3);
      mat.opacity = 0.75 * (1 - Math.max(0, k - 0.6) / 0.4);
      if (k > 0.35 && !landed) {
        landed = true;
        land();
      }
      if (Math.random() < 0.7) {
        this.host.particles.emit({
          pos: s.feet.clone().add(scatter(0.5)), vel: new THREE.Vector3(0, 4 + Math.random() * 2, 0).add(scatter(1.2)),
          life: 500, size: 0.14, grow: 0.6, colour: blue, gravity: 9,
        });
      }
    }, () => this.drop(col));
    this.host.light(s.chest, 0x4aa8ff, 7, ms);
    return ms * 0.35;
  }

  /** A whirlwind spinning up about the unit. */
  private whirlwind(toId: number, land: () => void): number {
    const s = this.host.spot(toId);
    if (!s) {
      land();
      return 0;
    }
    const ms = 600;
    const c = colourOf('wind');
    let landed = false;
    let turn = 0;
    this.host.tween(ms, (k) => {
      turn += 0.9;
      for (let j = 0; j < 6; j++) {
        const h = Math.random() * 2.4;
        const r = 0.25 + h * 0.35;
        const a = turn + j * 2.1 + h * 3;
        this.host.particles.emit({
          pos: s.feet.clone().add(new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r)),
          vel: new THREE.Vector3(-Math.sin(a) * 3, 1.2, Math.cos(a) * 3), life: 320, size: 0.2, grow: 0.4, colour: c,
        });
      }
      if (k > 0.45 && !landed) {
        landed = true;
        land();
      }
    });
    this.host.light(s.chest, 0x9ae8ff, 5, ms);
    return ms * 0.45;
  }

  /** Stone spikes breaking up through the ground about the unit. */
  private spikes(toId: number, land: () => void): number {
    const s = this.host.spot(toId);
    if (!s) {
      land();
      return 0;
    }
    const ms = 700;
    const stone = new THREE.MeshLambertMaterial({ color: 0x8a7a5a, flatShading: true });
    const geo = new THREE.ConeGeometry(0.22, 1, 5);
    geo.translate(0, 0.5, 0);
    const spikes: THREE.Mesh[] = [];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.random() * 0.5;
      const r = 0.35 + Math.random() * 0.4;
      const m = new THREE.Mesh(geo, stone);
      m.position.copy(s.feet).add(new THREE.Vector3(Math.cos(a) * r, -0.05, Math.sin(a) * r));
      m.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * 3, (Math.random() - 0.5) * 0.7);
      m.userData.h = 0.9 + Math.random() * 0.9;
      this.host.scene.add(m);
      spikes.push(m);
    }
    this.track(spikes[0]);
    const dust = new THREE.Color(0xc8a878).multiplyScalar(0.6);
    let landed = false;
    this.host.tween(ms, (k) => {
      const up = k < 0.2 ? k / 0.2 : k > 0.75 ? (1 - k) / 0.25 : 1;
      for (const m of spikes) m.scale.set(1, Math.max(0.01, up * m.userData.h), 1);
      if (k > 0.15 && !landed) {
        landed = true;
        for (let j = 0; j < 20; j++) {
          this.host.particles.emit({ pos: s.feet, vel: scatter(2.4, 0.8), life: 600, size: 0.35, grow: 2, colour: dust, gravity: 1, drag: 0.1 });
        }
        this.host.quake(0.3);
        land();
      }
    }, () => {
      for (const m of spikes) this.host.scene.remove(m);
      this.shapes.delete(spikes[0]);
      geo.dispose();
      stone.dispose();
    });
    this.host.light(s.chest, 0xd8a860, 4, ms);
    return ms * 0.15;
  }

  /** A pillar of light falling from the sky on the unit. */
  private pillar(toId: number, land: () => void, colour: number, strength = 1): number {
    const s = this.host.spot(toId);
    if (!s) {
      land();
      return 0;
    }
    const ms = 640;
    const geo = new THREE.CylinderGeometry(0.6, 0.6, 1, 16, 1, true);
    geo.translate(0, 0.5, 0);
    const beam = this.shape(geo, glowMaterial(colour));
    beam.position.copy(s.feet);
    const mat = beam.material as THREE.MeshBasicMaterial;
    const c = new THREE.Color(colour);
    let landed = false;
    this.host.tween(ms, (k) => {
      const fall = Math.min(1, k * 4);
      beam.scale.set(0.4 + (1 - fall) * 0.5, 9 * fall, 0.4 + (1 - fall) * 0.5);
      beam.position.y = s.feet.y + 9 * (1 - fall);
      mat.opacity = strength * (k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75) * 0.8;
      if (k > 0.25 && !landed) {
        landed = true;
        for (let j = 0; j < 16; j++) {
          this.host.particles.emit({ pos: s.feet.clone().add(scatter(0.4, 0.1)), vel: scatter(2.2, 0.6), life: 500, size: 0.16, grow: 0.4, colour: c, drag: 0.1 });
        }
        land();
      }
    }, () => this.drop(beam));
    this.host.light(s.chest, colour, 10 * strength, ms);
    return ms * 0.25;
  }

  /** Darkness drawing in about the unit, then breaking. */
  private darkness(toId: number, land: () => void): number {
    const s = this.host.spot(toId);
    if (!s) {
      land();
      return 0;
    }
    const ms = 560;
    const c = colourOf('bane');
    for (let k = 0; k < 40; k++) {
      this.host.particles.emit({
        pos: s.chest.clone().add(scatter(2.2, 0.2)), vel: scatter(0.8), life: ms * 0.7, size: 0.34, grow: 0.3, colour: c, toward: s.chest,
      });
    }
    this.host.tween(ms * 0.7, () => {}, () => {
      for (let k = 0; k < 30; k++) {
        this.host.particles.emit({ pos: s.chest, vel: scatter(3.6, 0.4), life: 460, size: 0.38, grow: 1.6, colour: c, drag: 0.05 });
      }
      this.host.light(s.chest, 0xb060ff, 9, 300);
      land();
    });
    return ms * 0.7;
  }

  /** A dragon's breath: a stream of golden fire from the caster to the unit. */
  private breath(fromId: number, toId: number, land: () => void): number {
    const a = this.host.spot(fromId);
    const b = this.host.spot(toId);
    if (!a || !b) {
      land();
      return 0;
    }
    const ms = 620;
    const c = colourOf('drakonite');
    const hot = new THREE.Color(0xfff0b0);
    const dir = b.chest.clone().sub(a.chest);
    let landed = false;
    this.host.tween(ms, (k) => {
      if (k < 0.75) {
        for (let j = 0; j < 6; j++) {
          this.host.particles.emit({
            pos: a.chest, vel: dir.clone().multiplyScalar(2.4).add(scatter(0.9)), life: 440, size: 0.3, grow: 2.6, colour: j % 2 ? c : hot, drag: 0.5,
          });
        }
      }
      if (k > 0.3 && !landed) {
        landed = true;
        land();
      }
    });
    this.host.light(b.chest, 0xffc838, 12, ms);
    this.host.light(a.chest, 0xffc838, 6, ms * 0.7);
    return ms * 0.3;
  }

  /** A glowing orb thrown from one unit to another, trailing light. */
  private orb(fromId: number, toId: number, hue: Hue, ms: number, arc: number, size: number, done: () => void): void {
    const a = this.host.spot(fromId);
    const b = this.host.spot(toId);
    if (!a || !b) {
      done();
      return;
    }
    const core = this.shape(new THREE.SphereGeometry(size, 10, 8), glowMaterial(colourOf(hue).lerp(new THREE.Color(0xffffff), 0.4)));
    const p0 = a.chest.clone();
    const p1 = b.chest.clone();
    const c = colourOf(hue);
    this.host.tween(ms, (k) => {
      core.position.lerpVectors(p0, p1, k);
      core.position.y += Math.sin(k * Math.PI) * arc;
      for (let j = 0; j < 2; j++) {
        this.host.particles.emit({ pos: core.position, vel: scatter(0.5), life: 300, size: size * 1.6, grow: 0.2, colour: c });
      }
    }, () => {
      this.drop(core);
      done();
    });
    this.host.light(p0, ELEMENT_COLOUR[hue], 4, ms);
  }

  /** A burst of the element's light at a unit. */
  burst(toId: number, hue: Hue, n: number): void {
    const s = this.host.spot(toId);
    if (!s) return;
    const c = colourOf(hue);
    for (let k = 0; k < n; k++) {
      this.host.particles.emit({ pos: s.chest, vel: scatter(2.6, 0.5), life: 420, size: 0.2, grow: 1.2, colour: c, drag: 0.1 });
    }
    this.host.light(s.chest, ELEMENT_COLOUR[hue], 8, 300);
  }

  // ---------------------------------------------------------- internals --

  private shape(geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = 4;
    this.host.scene.add(m);
    this.shapes.add(m);
    return m;
  }

  private track(m: THREE.Mesh): void {
    this.shapes.add(m);
  }

  /** Take an effect's shape off the field and let go of it. */
  private drop(m: THREE.Mesh): void {
    this.host.scene.remove(m);
    this.shapes.delete(m);
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
}
