import * as THREE from 'three';

// The battle's passing effects: sparks, embers, motes of light, drops and
// dust, all drawn as glowing dots that face the camera, from one pool, so a
// spell costs no new shapes or materials however many are cast. They add
// their light to what is behind them (and the finishing pass's bloom makes
// them glow). Beside them, the few textures the spells are drawn with: a
// soft dot, a magic circle, a sword's arc.

/** A particle as it is launched. */
export interface Mote {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  /** How long it lives, ms. */
  life: number;
  /** Its size at birth, and how many times that it grows to by its death. */
  size: number;
  grow?: number;
  colour: THREE.Color;
  /** Pull downward (negative rises), units a second squared. */
  gravity?: number;
  /** How much of its speed it keeps each second (1 none lost). */
  drag?: number;
  /** Sent toward this point instead of flying free (spells gathering in). */
  toward?: THREE.Vector3;
}

interface Live extends Required<Omit<Mote, 'toward'>> {
  age: number;
  toward?: THREE.Vector3;
  from?: THREE.Vector3;
}

let dotTex: THREE.Texture | null = null;

/** A soft round dot, bright in the middle. */
export function dotTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const n = 64;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.8)');
  grad.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
  dotTex = new THREE.CanvasTexture(c);
  dotTex.colorSpace = THREE.SRGBColorSpace;
  return dotTex;
}

let glyphTex: THREE.Texture | null = null;

/** A magic circle: two rings with runes between them and a star within. */
export function glyphTexture(): THREE.Texture {
  if (glyphTex) return glyphTex;
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  g.translate(n / 2, n / 2);
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = 4;
  for (const r of [120, 98]) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  // Runes: little strokes and dots in a band.
  g.lineWidth = 3;
  for (let k = 0; k < 24; k++) {
    g.save();
    g.rotate((k / 24) * Math.PI * 2);
    g.translate(0, -109);
    const kind = k % 4;
    g.beginPath();
    if (kind === 0) {
      g.moveTo(-4, -5);
      g.lineTo(4, 5);
      g.moveTo(4, -5);
      g.lineTo(-4, 5);
    } else if (kind === 1) {
      g.moveTo(0, -6);
      g.lineTo(0, 6);
      g.moveTo(-4, 0);
      g.lineTo(4, 0);
    } else if (kind === 2) {
      g.arc(0, 0, 4, 0, Math.PI * 2);
    } else {
      g.moveTo(-4, 5);
      g.lineTo(0, -6);
      g.lineTo(4, 5);
    }
    g.stroke();
    g.restore();
  }
  // A six-pointed star of two triangles.
  g.lineWidth = 3;
  for (const turn of [0, Math.PI / 3]) {
    g.beginPath();
    for (let k = 0; k <= 3; k++) {
      const a = turn + (k / 3) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * 90;
      const y = Math.sin(a) * 90;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.beginPath();
  g.arc(0, 0, 30, 0, Math.PI * 2);
  g.stroke();
  glyphTex = new THREE.CanvasTexture(c);
  glyphTex.colorSpace = THREE.SRGBColorSpace;
  return glyphTex;
}

let arcTex: THREE.Texture | null = null;

/** A sword's arc: a crescent, bright at its leading edge, fading behind. */
export function arcTexture(): THREE.Texture {
  if (arcTex) return arcTex;
  const n = 128;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  for (let k = 0; k < 40; k++) {
    const t = k / 40;
    g.strokeStyle = `rgba(255,255,255,${(t * t * 0.9).toFixed(3)})`;
    g.lineWidth = 2 + t * 9;
    g.beginPath();
    g.arc(n / 2, n / 2, n * 0.38, Math.PI * (0.9 + t * 0.7), Math.PI * (0.92 + t * 0.7));
    g.stroke();
  }
  arcTex = new THREE.CanvasTexture(c);
  arcTex.colorSpace = THREE.SRGBColorSpace;
  return arcTex;
}

/** A glowing material for a passing effect's own shape (a ring, a pillar, a beam). */
export function glowMaterial(colour: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: colour, map: map ?? null, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  });
}

/** The pool of glowing particles. */
export class Particles {
  readonly mesh: THREE.InstancedMesh;
  private live: Live[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor(scene: THREE.Scene, private max = 900) {
    const material = new THREE.MeshBasicMaterial({
      map: dotTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  /** How many are alive (for tests). */
  get count(): number {
    return this.live.length;
  }

  emit(p: Mote): void {
    if (this.live.length >= this.max) this.live.shift();
    this.live.push({
      pos: p.pos.clone(), vel: p.vel.clone(), life: p.life, size: p.size, grow: p.grow ?? 1, colour: p.colour.clone(),
      gravity: p.gravity ?? 0, drag: p.drag ?? 1, age: 0, toward: p.toward?.clone(), from: p.toward ? p.pos.clone() : undefined,
    });
  }

  update(ms: number, camera: THREE.Camera): void {
    const dt = ms / 1000;
    this.q.copy(camera.quaternion);
    let n = 0;
    const keep: Live[] = [];
    for (const p of this.live) {
      p.age += ms;
      if (p.age >= p.life) continue;
      const k = p.age / p.life;
      if (p.toward && p.from) {
        // Drawn in along a curve toward the point, quickening.
        const e = k * k;
        p.pos.lerpVectors(p.from, p.toward, e).addScaledVector(p.vel, Math.sin(k * Math.PI) * 0.35);
      } else {
        p.vel.y -= p.gravity * dt;
        p.vel.multiplyScalar(Math.pow(p.drag, dt));
        p.pos.addScaledVector(p.vel, dt);
      }
      keep.push(p);
      const size = p.size * (1 + (p.grow - 1) * k);
      this.s.setScalar(size);
      this.m.compose(p.pos, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      // Fading is darkening, since they add their light: bright at first, gone at the end.
      const fade = k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85;
      this.mesh.setColorAt(n, this.c.copy(p.colour).multiplyScalar(Math.max(0, fade)));
      n++;
    }
    this.live = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

/** A small random direction, for scattering. */
export function scatter(spread: number, up = 0): THREE.Vector3 {
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * spread;
  return new THREE.Vector3(Math.cos(a) * r, up + (Math.random() - 0.5) * spread * 0.6, Math.sin(a) * r);
}
