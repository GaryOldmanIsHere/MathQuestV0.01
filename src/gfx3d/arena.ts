import * as THREE from 'three';
import { MeshLambertNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { clamp, color, float, mix, normalize, positionWorld, smoothstep, texture, time, transformNormalToView, vec2, vec3 } from 'three/tsl';
import type { Terrain } from '../core/terrain';
import { Atmosphere } from './atmosphere';
import type { Weather } from './sky';
import { grassTufts, noiseTexture, paintedGround, wetness, windSwayed } from './landscape';
import { bakedModel } from './models';

// The ground a battle is fought on, made in the campaign map's manner: the
// same painted ground, the same pines and boulders, grass in the wind, and
// the sky, hour and weather the squads met under. Its look is taken from
// where they met: a meadow, a road running across the field, a forest
// clearing, a mountain pass or a shore.
//
// The squads stand on flat ground about the middle (x within about 8 of it,
// z within about 3); the camera looks on from +z, so the far side (-z) is
// the backdrop, and nothing tall stands between the camera and the field.

export interface ArenaOptions {
  /** Scenery's seed, so a rematch on the same ground looks the same. */
  seed: number;
  /** Tufts of grass to a square unit of meadow (0 for none). */
  grass: number;
  /** Sun shadows, texels a side (0 for none). */
  shadows: number;
  /** The most raindrops or snowflakes at once. */
  particles: number;
  /** Plain diffuse lighting, for modest machines. */
  simple: boolean;
  /** The hour (0 midnight, 0.5 noon) and the weather the squads met under. */
  hour: number;
  weather: Weather;
}

/** The ground's size, x and z; the water's level on a shore. */
const SIZE_X = 150;
const SIZE_Z = 110;
const WATER_Y = -0.38;
/** Where a shore's water begins (z), and where a road runs across (z). */
const SHORE_Z = -7.5;
const ROAD_Z = 0.4;

/** A small seeded generator for scenery, kept apart from the game's own. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** How many pines and boulders each kind of ground has, and how big the boulders run. */
const SCENERY: Record<Terrain, { trees: number; rocks: number; rockSize: number }> = {
  plain: { trees: 26, rocks: 8, rockSize: 1 },
  road: { trees: 22, rocks: 8, rockSize: 1 },
  forest: { trees: 110, rocks: 6, rockSize: 1 },
  mountain: { trees: 12, rocks: 46, rockSize: 2.2 },
  water: { trees: 16, rocks: 10, rockSize: 1 },
};

export class Arena {
  readonly atmosphere: Atmosphere;
  private objects: THREE.Object3D[] = [];
  private ownMaterials: THREE.Material[] = [];
  private seed: number;

  constructor(private scene: THREE.Scene, readonly theme: Terrain, o: ArenaOptions) {
    this.seed = o.seed;
    const rand = seeded(o.seed);
    // No clouds' shadows: on a field this small, one would darken half a squad.
    this.atmosphere = new Atmosphere(scene, { shadows: o.shadows, particles: o.particles, clouds: false });
    this.atmosphere.setHour(o.hour);
    this.atmosphere.setWeather(o.weather, true);

    this.add(this.ground(o.simple));
    if (theme === 'water') this.add(this.water(o.simple));
    this.plantTrees(rand, o.simple);
    this.scatterRocks(rand);
    if (o.grass > 0) {
      const tufts = this.grass(o.grass, rand);
      if (tufts) this.add(tufts);
    }
  }

  /** How high the ground stands at a point. */
  heightAt(x: number, z: number): number {
    const s = this.seed % 97;
    // Flat where the squads stand, rolling further out.
    // (On a shore the land rises only to the sides and behind the camera: the water lies beyond.)
    const across = this.theme === 'water' && z < 0 ? 0 : (Math.abs(z) - 6.5) * 1.3;
    const edge = Math.max(0, Math.max(Math.abs(x) - 12 + Math.min(0, z + 8) * 0.6, across)) / 10;
    const roll = Math.sin(x * 0.31 + s) * Math.cos(z * 0.27) + Math.sin(x * 0.11 - z * 0.17) * 1.5;
    let h = edge * edge * (1.4 + roll) * (this.theme === 'mountain' ? 2.6 : 1);
    // A gentle swell underfoot, so the field is not a table.
    h += Math.sin(x * 0.7 + s) * Math.cos(z * 0.9) * 0.05;
    // Far hills (the mountains' ridge for a pass) close the view.
    const far = Math.max(0, -z - 16) * 0.32;
    const ridge = { plain: 0.8, road: 0.8, forest: 0.6, mountain: 2.2, water: 0 }[this.theme];
    h += Math.pow(far, 1.5) * ridge * (0.7 + 0.3 * Math.sin(x * 0.13 + s));
    // A shore falls away under the water.
    if (this.theme === 'water') h -= THREE.MathUtils.smoothstep(-z, -SHORE_Z - 0.5, -SHORE_Z + 1.5) * 1.2 + Math.max(0, -z + SHORE_Z - 1.5) * 0.06;
    return h;
  }

  update(dtMs: number, camera: THREE.Camera, focus: THREE.Vector3, distance: number): void {
    this.atmosphere.update(dtMs, camera, focus, distance);
  }

  dispose(): void {
    this.atmosphere.dispose();
    for (const o of this.objects) {
      this.scene.remove(o);
      // Shapes and materials shared with the campaign map's models are kept.
      if (o.userData.shared) {
        (o as THREE.InstancedMesh).dispose?.();
        continue;
      }
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
    for (const m of this.ownMaterials) m.dispose();
  }

  // ------------------------------------------------------------ internals --

  private add(o: THREE.Object3D): void {
    this.scene.add(o);
    this.objects.push(o);
  }

  /** The ground: a wide sheet of low polygons, painted by what kind of ground it is. */
  private ground(simple: boolean): THREE.Mesh {
    const geo = new THREE.PlaneGeometry(SIZE_X, SIZE_Z, 120, 88);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) pos.setY(i, this.heightAt(pos.getX(i), pos.getZ(i)));
    geo.computeVertexNormals();
    const theme = this.theme;
    const z = positionWorld.z;
    const x = positionWorld.x;
    // Trodden earth where the squads stand, and the kinds of ground about them.
    const trodden = smoothstep(1, 0, vec2(x.div(9), z.div(4)).length()).mul(0.32);
    const material = paintedGround(({ broad, patch, grain }, y, slope) => ({
      woodland: theme === 'forest' ? clamp(smoothstep(0.2, 0.6, patch).mul(0.6).add(smoothstep(5, 11, vec2(x.div(1.6), z).length())), 0, 1) : float(0),
      rock: clamp(smoothstep(0.25, 0.5, slope).add(theme === 'mountain' ? smoothstep(0.35, 0.75, broad.add(slope)).mul(0.85) : float(0)), 0, 1),
      road: clamp(theme === 'road'
        ? smoothstep(1.9, 1.2, z.sub(ROAD_Z).abs().add(grain.sub(0.5).mul(0.7))).add(trodden)
        : trodden.mul(smoothstep(0.35, 0.7, grain.add(patch.mul(0.4)))), 0, 1),
      sand: theme === 'water' ? smoothstep(SHORE_Z + 1.6, SHORE_Z + 0.4, z.add(grain.mul(0.8))).mul(smoothstep(0.5, 0.1, y)) : float(0),
      snow: theme === 'mountain' ? smoothstep(7, 9, y.add(broad.mul(2))).mul(smoothstep(0.7, 0.35, slope)) : float(0),
    }), simple, 3);
    this.ownMaterials.push(material);
    const ground = new THREE.Mesh(geo, material);
    ground.receiveShadow = true;
    return ground;
  }

  /** A shore's water: green in the shallows, deep blue further out, small waves catching the light. */
  private water(simple: boolean): THREE.Mesh {
    const noise = texture(noiseTexture());
    const p = positionWorld.xz;
    const depth = smoothstep(SHORE_Z, SHORE_Z - 14, positionWorld.z);
    const tint = mix(color(0x4f9a8a), color(0x1d4f86), depth);
    const material = simple ? new MeshLambertNodeMaterial({ transparent: true }) : new MeshStandardNodeMaterial({ transparent: true, metalness: 0 });
    material.colorNode = tint;
    material.opacityNode = mix(float(0.55), float(0.92), depth);
    if (!simple) {
      const std = material as MeshStandardNodeMaterial;
      // Two layers of waves drifting against each other.
      const a = noise.sample(p.mul(0.05).add(vec2(time.mul(0.012), time.mul(0.007)))).r;
      const b = noise.sample(p.mul(0.09).sub(vec2(time.mul(0.009), time.mul(-0.011)))).r;
      const ax = noise.sample(p.mul(0.05).add(vec2(time.mul(0.012).add(0.02), time.mul(0.007)))).r;
      const bz = noise.sample(p.mul(0.09).sub(vec2(time.mul(0.009), time.mul(-0.011).sub(0.02)))).r;
      std.normalNode = transformNormalToView(normalize(vec3(a.sub(ax).mul(9), 1, b.sub(bz).mul(9))));
      std.roughnessNode = float(0.18).add(wetness.mul(0.2));
    }
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(SIZE_X, 60, 1, 1), material);
    sea.rotateX(-Math.PI / 2);
    sea.position.set(0, WATER_Y, SHORE_Z - 28);
    sea.receiveShadow = true;
    return sea;
  }

  /**
   * A spot off the battle line for a tree or boulder: behind the field, or
   * out to its sides, most of them close enough to be seen (a forest's
   * crowd close about its clearing).
   */
  private spotAway(rand: () => number): [number, number] {
    const near = this.theme === 'forest' ? 0.85 : 0.6;
    for (;;) {
      const close = rand() < near;
      const x = (rand() - 0.5) * (close ? 56 : 100);
      const z = close ? -24 + rand() * 30 : -40 + rand() * 54;
      if (Math.abs(x) < 13 && Math.abs(z) < 8) continue;
      // Nothing between the camera and the field.
      if (z > 6 && Math.abs(x) < 16) continue;
      if (this.theme === 'water' && z < SHORE_Z + 1) continue;
      if (this.theme === 'road' && Math.abs(z - ROAD_Z) < 2.4) continue;
      return [x, z];
    }
  }

  /** Pines about the field (a forest's crowd round its clearing), swaying in the wind. */
  private plantTrees(rand: () => number, simple: boolean): void {
    const n = SCENERY[this.theme].trees;
    const kinds = [bakedModel('tree_single_A'), bakedModel('tree_single_B')];
    const spots = Array.from({ length: n }, () => this.spotAway(rand));
    if (kinds.some((k) => !k)) {
      // Without the models: plain cones.
      for (const [x, z] of spots) this.add(this.coneTree(x, z, rand));
      return;
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    const groups: [number, number][][] = [[], []];
    for (const s of spots) groups[rand() < 0.55 ? 0 : 1].push(s);
    groups.forEach((list, i) => {
      if (!list.length) return;
      const { geometry, material } = kinds[i]!;
      const swaying = windSwayed(material, simple);
      this.ownMaterials.push(swaying);
      const trees = new THREE.InstancedMesh(geometry, swaying, list.length);
      list.forEach(([x, z], k) => {
        // Further off, taller: the near ones frame the field, the far ones close it in.
        const size = 1.5 + rand() * 0.9 + Math.min(1.2, Math.max(0, -z - 10) * 0.05);
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        m.compose(new THREE.Vector3(x, this.heightAt(x, z) - 0.05, z), q, new THREE.Vector3(size, size * (0.9 + rand() * 0.3), size));
        trees.setMatrixAt(k, m);
        trees.setColorAt(k, tint.setHSL(0.18 + rand() * 0.1, 0.25, 0.78 + rand() * 0.22));
      });
      trees.castShadow = true;
      trees.receiveShadow = true;
      trees.userData.shared = true;
      this.add(trees);
    });
  }

  private coneTree(x: number, z: number, rand: () => number): THREE.Group {
    const g = new THREE.Group();
    const h = 2 + rand() * 1.6;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, h * 0.4, 5), new THREE.MeshLambertMaterial({ color: 0x6a4a2a, flatShading: true }));
    trunk.position.y = h * 0.2;
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.55 + rand() * 0.4, h, 6), new THREE.MeshLambertMaterial({ color: 0x2e5a2a, flatShading: true }));
    crown.position.y = h * 0.9;
    g.add(trunk, crown);
    g.position.set(x, this.heightAt(x, z), z);
    return g;
  }

  /** Boulders: a few about any field, a mountain pass strewn with great ones. */
  private scatterRocks(rand: () => number): void {
    const { rocks: n, rockSize } = SCENERY[this.theme];
    const kinds = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D'].map(bakedModel);
    if (kinds.some((k) => !k)) return;
    const spots: [number, number][][] = kinds.map(() => []);
    for (let k = 0; k < n; k++) spots[Math.floor(rand() * kinds.length)].push(this.spotAway(rand));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    kinds.forEach((kind, i) => {
      if (!spots[i].length) return;
      const rocks = new THREE.InstancedMesh(kind!.geometry, kind!.material, spots[i].length);
      spots[i].forEach(([x, z], k) => {
        const s = (2 + rand() * 2.5) * rockSize;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        m.compose(new THREE.Vector3(x, this.heightAt(x, z) - 0.08 * s, z), q, new THREE.Vector3(s, s * (0.7 + rand() * 0.5), s));
        rocks.setMatrixAt(k, m);
      });
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      rocks.userData.shared = true;
      this.add(rocks);
    });
  }

  /** Grass over the meadow about the field (not a road, the sand or a pass's rock). */
  private grass(perUnit: number, rand: () => number): THREE.InstancedMesh | null {
    if (this.theme === 'mountain') return null;
    const spots: [number, number, number][] = [];
    const count = Math.round(perUnit * 0.6 * 50 * 30);
    for (let k = 0; k < count; k++) {
      const x = (rand() - 0.5) * 50;
      const z = -20 + rand() * 30;
      if (this.theme === 'road' && Math.abs(z - ROAD_Z) < 2) continue;
      if (this.theme === 'water' && z < SHORE_Z + 1.8) continue;
      // Thinner where the squads have trodden.
      if (Math.hypot(x / 9, z / 4) < 1 && rand() < 0.7) continue;
      spots.push([x, this.heightAt(x, z) - 0.01, z]);
    }
    // A shade darker than the map's, seen this close; darker still in a forest's shade.
    return spots.length ? grassTufts(spots, rand, this.theme === 'forest' ? 0.62 : 0.78) : null;
  }
}
