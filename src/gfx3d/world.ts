import * as THREE from 'three';
import type { MapNode } from '../core/types';
import type { Terrain } from '../core/terrain';
import { COLS, MAP_H, MAP_W, ROWS, TILE, terrainAtTile } from '../core/terrain';
import type { SpriteImage } from './sprites';
import type { BuildingColour } from './models';
import { bakedModel, hasWorldModels, worldModel } from './models';
import { grassField, groundMaterial, waterMaterial, windSwayed } from './landscape';
import type { Weather } from './atmosphere';
import { Atmosphere } from './atmosphere';
import { outlineNormals } from '../art/normals';
import type { MapView } from './worldMap';
import {
  clampView, figureScale, heightAt, heightField, lerpView, MARGIN, mirror, OVERVIEW, screenOctant, SUB, VERTS_X, VERTS_Z, viewCamera,
  WATER_LEVEL, WORLD_D, WORLD_W, zoomView,
} from './worldMap';

// The campaign map in 3D, as Ogre Battle 64 shows its world: rolling
// polygon ground under a tilted camera, hills and lakes and woods,
// strongholds as small buildings flying their owner's colours, and each
// squad its leader's figure walking the land.
//
// Like the battle stage this is presentation only. Squads move on the
// terrain grid in map pixels (src/core/movement.ts); the world is grown
// from that grid and told each frame where the squads now stand.

/** A squad's figure on the map, as its art provides it. */
export interface MapFigure {
  /**
   * The drawing for a squad heading in a screen octant (0 right, counting
   * clockwise in eighths: 2 toward the camera, 4 left, 6 away) `ms` into its
   * walk, or standing. `mirror` flips it.
   */
  frame(screenOctant: number, ms: number, moving: boolean): { image: SpriteImage; normal?: SpriteImage; anchorX: number; anchorY: number; mirror: boolean };
  /** How many of the drawing's pixels make one world unit. */
  pixelsPerUnit: number;
}

export type Owner = MapNode['owner'];

export interface BuildOptions {
  seed?: number;
  /** Tufts of grass to a tile of open meadow. */
  grass?: number;
  /** The sun's shadows' sharpness, texels a side (0: none). */
  shadows?: number;
  /** The most raindrops or snowflakes falling at once. */
  particles?: number;
  /** Plain diffuse lighting and simpler water, for modest machines. */
  simple?: boolean;
}

const OWNER_COLOUR: Record<Owner, number> = { player: 0x3a64e0, enemy: 0xd0402e, neutral: 0xd8d0b8 };
const SIDE_COLOUR = { player: 0x4a6ae0, enemy: 0xd04838 };
/** How far about a stronghold's centre (in tiles) no tree grows. */
const CLEARING = 1.7;

/** Which of the models' colours each owner's buildings wear. */
const BUILDING_COLOUR: Record<Owner, BuildingColour> = { player: 'blue', enemy: 'red', neutral: 'yellow' };

/** A building of a stronghold: which model (less its colour), and where it stands in the stronghold. */
interface Building {
  model: string;
  x: number;
  z: number;
  turn: number;
  scale: number;
  object: THREE.Object3D;
}

interface SquadMesh {
  root: THREE.Group;
  body: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  base: THREE.Mesh;
  figure: MapFigure;
  x: number;
  y: number;
  heading: [number, number];
  side: 'player' | 'enemy';
  moving: boolean;
  t: number;
  height: number;
}

interface Pulse {
  mesh: THREE.Mesh;
  t: number;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** What a quality preset asks of the map. */
export function worldDetail(s: { grass: number; shadows: number; particles: number; simpleShading: boolean }): BuildOptions {
  return { grass: s.grass, shadows: s.shadows, particles: s.particles, simple: s.simpleShading };
}

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

export class WorldStage {
  /** What the engine draws: the world, and the camera over it. */
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /**
   * The miniature look: how far the engine softens the land above and below
   * the middle of the view. Strongest close in; gentle over the whole map,
   * where every squad must still read.
   */
  tiltShift = 0.9;
  private ground: THREE.Mesh | null = null;
  private field: Float32Array = new Float32Array(VERTS_X * VERTS_Z);
  private water: THREE.Mesh | null = null;
  private flags = new Map<number, THREE.MeshLambertMaterial>();
  private flagCloths: THREE.Mesh[] = [];
  /** Each stronghold's buildings, re-dressed in the new owner's colours when it changes hands. */
  private buildings = new Map<number, { group: THREE.Group; parts: Building[] }>();
  /** Windmill sails, turning. */
  private sails: THREE.Object3D[] = [];
  /** Materials made for this map over shared model geometry (disposed with it). */
  private ownMaterials: THREE.Material[] = [];
  /** The sky, the light of the hour, and the weather. */
  private atmosphere: Atmosphere | null = null;
  /** Whether the map is drawn with the simpler materials. */
  private simple = false;
  private squads = new Map<number, SquadMesh>();
  private textures = new Map<SpriteImage, THREE.Texture>();
  private selection: THREE.Mesh;
  private selectedId: number | null = null;
  private route: THREE.Line | null = null;
  private pulses: Pulse[] = [];
  private clock = 0;
  /** Where the camera is headed, and where it is. */
  private wanted: MapView = OVERVIEW;
  private shown: MapView = OVERVIEW;
  private raycaster = new THREE.Raycaster();

  /** The view's size on screen, in CSS pixels (project() and pick() work in these). */
  private width = 1;
  private height = 1;

  constructor() {
    this.camera = new THREE.PerspectiveCamera(36, 1, 0.5, 260);
    this.selection = new THREE.Mesh(
      new THREE.RingGeometry(0.62, 0.8, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf0e090, transparent: true, opacity: 0.9, depthWrite: false }),
    );
    this.selection.visible = false;
    this.scene.add(this.selection);
    this.applyView();
  }

  /** Fit the camera to the view's size on screen. */
  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  // --------------------------------------------------------------- the land --

  /**
   * Raise the map from the terrain grid: ground, roads, water, woods,
   * strongholds, (`grass` tufts to a tile of meadow) the grass, and the sky
   * over it (`shadows` their sharpness, 0 for none; `particles` the most
   * raindrops or snowflakes falling at once).
   */
  build(grid: Terrain[], nodes: MapNode[], { seed = 1, grass = 0, shadows = 0, particles = 0, simple = false }: BuildOptions = {}): void {
    this.simple = simple;
    this.atmosphere = new Atmosphere(this.scene, { shadows, particles });
    this.field = heightField(grid, seed);
    const rand = seeded(seed * 9973 + 7);

    // Ground: a sheet over the map, one vertex every half tile, running on
    // past its edges as a mirror of the land within, dimmed so the
    // campaign's bounds read.
    const wide = WORLD_W + MARGIN * 2;
    const deep = WORLD_D + MARGIN * 2;
    const geo = new THREE.PlaneGeometry(wide, deep, wide * SUB, deep * SUB);
    geo.rotateX(-Math.PI / 2);
    geo.translate(WORLD_W / 2, 0, WORLD_D / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    const colours = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const wx = pos.getX(k);
      const wz = pos.getZ(k);
      const h = heightAt(this.field, mirror(wx, WORLD_W) * TILE, mirror(wz, WORLD_D) * TILE);
      pos.setY(k, h);
      uv.setXY(k, wx / WORLD_W, 1 - wz / WORLD_D);
      // The land beyond the campaign darkens.
      const out = Math.max(0, -wx, wx - WORLD_W, -wz, wz - WORLD_D);
      const dim = 1 - Math.min(1, out / 1.5) * 0.35;
      colours.set([dim, dim, dim], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();
    // Painted in the GPU from where each kind of ground lies (src/gfx3d/landscape.ts).
    this.ground = new THREE.Mesh(geo, groundMaterial(grid, nodes, simple));
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Water: one sheet at the waterline, showing wherever the ground dips under it.
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(wide, deep).rotateX(-Math.PI / 2).translate(WORLD_W / 2, WATER_LEVEL, WORLD_D / 2),
      waterMaterial(this.field, simple),
    );
    this.water.receiveShadow = true;
    this.scene.add(this.water);

    this.plantTrees(grid, rand, nodes);
    for (const n of nodes) this.raiseStronghold(n, rand);
    const tufts = grassField(grid, nodes, (x, y) => heightAt(this.field, x, y), grass, rand);
    if (tufts) this.scene.add(tufts);
  }

  /** Woods on forest ground, and the odd tree in the open. */
  private plantTrees(grid: Terrain[], rand: () => number, nodes: MapNode[]): void {
    const spots: [number, number, number][] = [];
    // The ground about each stronghold is kept clear for its buildings.
    const cleared = (x: number, y: number) => nodes.some((n) => Math.hypot(n.x - x, n.y - y) < CLEARING * TILE);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = terrainAtTile(grid, col, row);
        const n = t === 'forest' ? 3 : t === 'plain' && rand() < 0.025 ? 1 : 0;
        for (let k = 0; k < n; k++) {
          const x = (col + 0.15 + rand() * 0.7) * TILE;
          const y = (row + 0.15 + rand() * 0.7) * TILE;
          const size = 0.5 + rand() * 0.3;
          if (!cleared(x, y)) spots.push([x, y, size]);
        }
      }
    }
    if (!spots.length) return;
    if (this.plantModelTrees(spots, rand)) {
      this.scatterRocks(grid, rand);
      return;
    }
    const crown = new THREE.InstancedMesh(new THREE.ConeGeometry(0.42, 1.25, 6), lambert(0xffffff), spots.length);
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 5), lambert(0x6a4a2a), spots.length);
    const m = new THREE.Matrix4();
    const green = new THREE.Color();
    spots.forEach(([x, y, s], k) => {
      const h = heightAt(this.field, x, y);
      m.makeScale(s, s, s).setPosition(x / TILE, h + 0.2 * s, y / TILE);
      trunk.setMatrixAt(k, m);
      m.makeScale(s, s, s).setPosition(x / TILE, h + 0.95 * s, y / TILE);
      crown.setMatrixAt(k, m);
      crown.setColorAt(k, green.setHSL(0.27 + rand() * 0.06, 0.45, 0.22 + rand() * 0.1));
    });
    this.scene.add(trunk, crown);
  }

  /** Woods of the models' pines, two kinds mixed, each turned and sized its own way. False without the models. */
  private plantModelTrees(spots: [number, number, number][], rand: () => number): boolean {
    const kinds = [bakedModel('tree_single_A'), bakedModel('tree_single_B')];
    if (kinds.some((k) => !k)) return false;
    const groups: [number, number, number][][] = [[], []];
    for (const s of spots) groups[rand() < 0.55 ? 0 : 1].push(s);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    groups.forEach((list, i) => {
      if (!list.length) return;
      const { geometry, material } = kinds[i]!;
      const swaying = windSwayed(material, this.simple);
      this.ownMaterials.push(swaying);
      const trees = new THREE.InstancedMesh(geometry, swaying, list.length);
      list.forEach(([x, y, s], k) => {
        const size = 0.62 + s * 0.5;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        m.compose(new THREE.Vector3(x / TILE, heightAt(this.field, x, y) - 0.02, y / TILE), q, new THREE.Vector3(size, size * (0.9 + rand() * 0.25), size));
        trees.setMatrixAt(k, m);
        // Each tree a shade of its own: some darker, some yellower.
        trees.setColorAt(k, tint.setHSL(0.18 + rand() * 0.1, 0.25, 0.78 + rand() * 0.22));
      });
      trees.castShadow = true;
      trees.receiveShadow = true;
      trees.userData.shared = true;
      this.scene.add(trees);
    });
    return true;
  }

  /** Boulders strewn over the high ground. */
  private scatterRocks(grid: Terrain[], rand: () => number): void {
    const kinds = ['rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D'].map(bakedModel);
    if (kinds.some((k) => !k)) return;
    const spots: [number, number][][] = kinds.map(() => []);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = terrainAtTile(grid, col, row);
        const n = t === 'mountain' ? (rand() < 0.45 ? 1 : 0) : t === 'plain' && rand() < 0.012 ? 1 : 0;
        for (let k = 0; k < n; k++) spots[Math.floor(rand() * kinds.length)].push([(col + rand()) * TILE, (row + rand()) * TILE]);
      }
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    kinds.forEach((kind, i) => {
      if (!spots[i].length) return;
      const rocks = new THREE.InstancedMesh(kind!.geometry, kind!.material, spots[i].length);
      spots[i].forEach(([x, y], k) => {
        const s = 1.4 + rand() * 1.6;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        m.compose(new THREE.Vector3(x / TILE, heightAt(this.field, x, y) - 0.03, y / TILE), q, new THREE.Vector3(s, s, s));
        rocks.setMatrixAt(k, m);
      });
      rocks.castShadow = true;
      rocks.receiveShadow = true;
      rocks.userData.shared = true;
      this.scene.add(rocks);
    });
  }

  /**
   * A stronghold of the models' buildings in its owner's colours: a castle
   * for each side's seat, a watchtower for a fort, and for a town a church or
   * windmill among cottages. False without the models.
   */
  private raiseModelStronghold(n: MapNode, rand: () => number): boolean {
    if (!hasWorldModels()) return false;
    const plan: Omit<Building, 'object'>[] = [];
    if (n.kind === 'hq-player' || n.kind === 'hq-enemy') {
      plan.push({ model: 'castle', x: 0, z: 0, turn: 0, scale: 1.0 });
    } else if (n.kind === 'fort') {
      plan.push({ model: 'tower_A', x: 0, z: -0.1, turn: rand() * 0.6 - 0.3, scale: 1.15 });
      plan.push({ model: 'home_A', x: 0.8, z: 0.2, turn: -0.6, scale: 0.8 });
    } else {
      const landmark = n.id % 2 === 0 ? 'church' : 'windmill';
      plan.push({ model: landmark, x: 0, z: -0.2, turn: rand() * 0.5 - 0.25, scale: 1.05 });
      const around: [string, number, number][] = [['home_A', -1.08, 0.15], ['home_B', 1.1, 0.02], ['home_A', 0.32, -1.22], ['well', -0.55, 0.9]];
      for (const [model, x, z] of around) {
        if (model === 'well' && rand() < 0.4) continue;
        plan.push({ model, x: x + (rand() - 0.5) * 0.15, z: z + (rand() - 0.5) * 0.15, turn: rand() * Math.PI * 2, scale: 0.8 + rand() * 0.12 });
      }
    }
    const group = new THREE.Group();
    const parts: Building[] = plan.map((p) => ({ ...p, object: new THREE.Object3D() }));
    this.buildings.set(n.id, { group, parts });
    this.dress(n.id, n.owner);
    if (n.kind !== 'hq-player' && n.kind !== 'hq-enemy') {
      // A pennant over the town in its owner's colour, seen from afar.
      const top = n.kind === 'fort' ? 2.9 : 2.2;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, top, 5), lambert(0x5a4a3a));
      pole.position.set(0.55, top / 2, 0.5);
      pole.castShadow = true;
      const cloth = lambert(OWNER_COLOUR[n.owner]);
      cloth.side = THREE.DoubleSide;
      const pennant = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3, 4, 1).translate(0.25, 0, 0), cloth);
      pennant.position.set(0.57, top - 0.17, 0.5);
      pennant.castShadow = true;
      group.add(pole, pennant);
      this.flags.set(n.id, cloth);
      this.flagCloths.push(pennant);
    }
    group.position.set(n.x / TILE, heightAt(this.field, n.x, n.y) - 0.04, n.y / TILE);
    this.scene.add(group);
    return true;
  }

  /** Put up (or re-dress) a stronghold's buildings in an owner's colours. */
  private dress(nodeId: number, owner: Owner): void {
    const b = this.buildings.get(nodeId);
    if (!b) return;
    const colour = BUILDING_COLOUR[owner];
    for (const part of b.parts) {
      // A castle comes only in the two sides' colours.
      const key = part.model === 'castle' && colour === 'yellow' ? 'castle_blue' : `${part.model}_${colour}`;
      const object = worldModel(key);
      if (!object) continue;
      object.userData.shared = true;
      object.position.set(part.x, 0, part.z);
      object.rotation.y = part.turn;
      object.scale.setScalar(part.scale);
      b.group.remove(part.object);
      this.sails = this.sails.filter((s) => !isWithin(s, part.object));
      object.traverse((o) => {
        if (o.name.includes('_fan')) this.sails.push(o);
      });
      b.group.add(object);
      part.object = object;
    }
  }

  /** A stronghold as a small building on its ground: a castle, a fort or a town, flying its owner's flag. */
  private raiseStronghold(n: MapNode, rand: () => number): void {
    if (this.raiseModelStronghold(n, rand)) return;
    const g = new THREE.Group();
    const stone = lambert(0xb8b0a0);
    const darkStone = lambert(0x8a8478);
    const roofOf = n.kind === 'hq-player' ? 0x3a5aa8 : n.kind === 'hq-enemy' ? 0x8a2a2a : 0x9a4a32;
    const roof = lambert(roofOf);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, ry = 0) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      mesh.rotation.y = ry;
      g.add(mesh);
      return mesh;
    };
    let flagTop = 2;
    if (n.kind === 'hq-player' || n.kind === 'hq-enemy') {
      // Curtain walls with a tower at each corner, and a tall keep within.
      for (const [x, z, w, d] of [[0, -0.9, 1.9, 0.22], [0, 0.9, 1.9, 0.22], [-0.9, 0, 0.22, 1.9], [0.9, 0, 0.22, 1.9]]) {
        add(new THREE.BoxGeometry(w, 0.6, d), darkStone, x, 0.3, z);
      }
      for (const [x, z] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
        add(new THREE.CylinderGeometry(0.22, 0.24, 0.95, 8), stone, x, 0.47, z);
        add(new THREE.ConeGeometry(0.3, 0.45, 8), roof, x, 1.17, z);
      }
      add(new THREE.BoxGeometry(0.85, 1.5, 0.85), stone, 0, 0.75, 0);
      add(new THREE.ConeGeometry(0.66, 0.7, 4), roof, 0, 1.85, 0, Math.PI / 4);
      flagTop = 2.9;
    } else if (n.kind === 'fort') {
      // A watchtower inside a timber stockade.
      const stake = lambert(0x7a5a38);
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        add(new THREE.CylinderGeometry(0.07, 0.08, 0.55, 5), stake, Math.cos(a) * 0.85, 0.27, Math.sin(a) * 0.85);
      }
      add(new THREE.BoxGeometry(0.62, 1.3, 0.62), stone, 0, 0.65, 0);
      add(new THREE.BoxGeometry(0.8, 0.14, 0.8), darkStone, 0, 1.36, 0);
      add(new THREE.ConeGeometry(0.52, 0.5, 4), roof, 0, 1.68, 0, Math.PI / 4);
      flagTop = 2.5;
    } else {
      // A cluster of cottages.
      const wall = lambert(0xe0d4b0);
      for (let k = 0; k < 5; k++) {
        const a = k * 1.3 + rand();
        const r = k === 0 ? 0 : 0.6 + rand() * 0.25;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const s = k === 0 ? 1.15 : 0.8 + rand() * 0.25;
        const ry = rand() * Math.PI;
        add(new THREE.BoxGeometry(0.5 * s, 0.36 * s, 0.4 * s), wall, x, 0.18 * s, z, ry);
        add(new THREE.ConeGeometry(0.42 * s, 0.32 * s, 4), roof, x, 0.52 * s, z, ry + Math.PI / 4);
      }
      flagTop = 1.6;
    }
    // The flag: a pole and a pennant in the owner's colour.
    add(new THREE.CylinderGeometry(0.03, 0.03, flagTop, 5), lambert(0x5a4a3a), 0.35, flagTop / 2, -0.35);
    const cloth = lambert(OWNER_COLOUR[n.owner]);
    cloth.side = THREE.DoubleSide;
    const pennant = add(new THREE.PlaneGeometry(0.6, 0.36, 4, 1).translate(0.3, 0, 0), cloth, 0.38, flagTop - 0.2, -0.35);
    this.flags.set(n.id, cloth);
    this.flagCloths.push(pennant);

    const h = heightAt(this.field, n.x, n.y);
    g.position.set(n.x / TILE, h - 0.05, n.y / TILE);
    this.scene.add(g);
  }

  /** The hour over the map (0 midnight, 0.5 noon). */
  setHour(hour: number): void {
    this.atmosphere?.setHour(hour);
  }

  /** The weather over the map; it comes on over a few seconds, or `now`. */
  setWeather(w: Weather, now = false): void {
    this.atmosphere?.setWeather(w, now);
  }

  /** Re-colour a stronghold's flag for its new owner. */
  setOwner(nodeId: number, owner: Owner): void {
    this.flags.get(nodeId)?.color.setHex(OWNER_COLOUR[owner]);
    this.dress(nodeId, owner);
  }

  /** The ground's height under a map point. */
  groundAt(x: number, y: number): number {
    return Math.max(WATER_LEVEL, heightAt(this.field, x, y));
  }

  // ------------------------------------------------------------- the squads --

  /** Place a squad's figure, or move it: map pixels, which side, which way it marches. */
  setSquad(id: number, x: number, y: number, side: 'player' | 'enemy', figure: MapFigure, moving: boolean): void {
    let s = this.squads.get(id);
    if (!s) {
      const root = new THREE.Group();
      // Lit by the sun and the sky, shaded by the figure's normal map, as an HD-2D sprite is.
      const mat = new THREE.MeshStandardMaterial({ transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
      const body = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      body.castShadow = true;
      root.add(body);
      const base = new THREE.Mesh(
        new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: SIDE_COLOUR[side], transparent: true, opacity: 0.45, depthWrite: false }),
      );
      this.scene.add(root, base);
      s = { root, body, mat, base, figure, x, y, heading: [side === 'player' ? 1 : -1, 0], side, moving, t: Math.random() * 1000, height: 1.4 };
      this.squads.set(id, s);
    }
    const dx = x - s.x;
    const dy = y - s.y;
    if (dx * dx + dy * dy > 0.01) s.heading = [dx, dy];
    s.figure = figure;
    s.x = x;
    s.y = y;
    s.moving = moving;
  }

  removeSquad(id: number): void {
    const s = this.squads.get(id);
    if (!s) return;
    this.scene.remove(s.root, s.base);
    s.body.geometry.dispose();
    s.mat.dispose();
    s.base.geometry.dispose();
    (s.base.material as THREE.Material).dispose();
    this.squads.delete(id);
    if (this.selectedId === id) this.select(null);
  }

  /** Ring the selected squad, and show where it is marching. */
  select(id: number | null, target?: { x: number; y: number } | null): void {
    this.selectedId = id;
    this.selection.visible = id !== null && this.squads.has(id);
    this.setRoute(id !== null ? this.squads.get(id) : undefined, target ?? null);
  }

  private setRoute(s: SquadMesh | undefined, target: { x: number; y: number } | null): void {
    if (this.route) {
      this.scene.remove(this.route);
      this.route.geometry.dispose();
      this.route = null;
    }
    if (!s || !target) return;
    const pts: THREE.Vector3[] = [];
    const len = Math.hypot(target.x - s.x, target.y - s.y) / TILE;
    const n = Math.max(2, Math.ceil(len * 3));
    for (let k = 0; k <= n; k++) {
      const x = s.x + ((target.x - s.x) * k) / n;
      const y = s.y + ((target.y - s.y) * k) / n;
      pts.push(new THREE.Vector3(x / TILE, this.groundAt(x, y) + 0.12, y / TILE));
    }
    this.route = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: 0xf0e090, dashSize: 0.35, gapSize: 0.25 }),
    );
    this.route.computeLineDistances();
    this.scene.add(this.route);
  }

  /** Keep the selected squad's route drawn from where it now stands. */
  refreshRoute(target: { x: number; y: number } | null): void {
    this.setRoute(this.selectedId !== null ? this.squads.get(this.selectedId) : undefined, target);
  }

  /** A ring that spreads on the ground where an order was given. */
  ping(x: number, y: number): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.3, 0.42, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf0e090, transparent: true, depthWrite: false }),
    );
    mesh.position.set(x / TILE, this.groundAt(x, y) + 0.08, y / TILE);
    this.scene.add(mesh);
    this.pulses.push({ mesh, t: 0 });
  }

  // ------------------------------------------------------------- the camera --

  get view(): MapView {
    return this.wanted;
  }

  /** Head the camera for a view; `now` jumps there. */
  setView(v: MapView, now = false): void {
    this.wanted = clampView(v);
    if (now) this.shown = this.wanted;
  }

  /** Drag the map under the pointer from one screen point to another. */
  drag(fromX: number, fromY: number, toX: number, toY: number): void {
    const a = this.onPlane(fromX, fromY);
    const b = this.onPlane(toX, toY);
    if (!a || !b) return;
    this.wanted = clampView({ ...this.wanted, x: this.wanted.x + a.x - b.x, z: this.wanted.z + a.z - b.z });
    this.shown = clampView({ ...this.shown, x: this.shown.x + a.x - b.x, z: this.shown.z + a.z - b.z });
    this.applyView();
  }

  /** Zoom toward (factor below 1) or away from a screen point. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const p = this.onPlane(sx, sy);
    const v = zoomView(this.wanted, factor);
    if (p && factor < 1) {
      const pull = Math.min(1, (1 - factor) * 1.2);
      v.x += (p.x - v.x) * pull;
      v.z += (p.z - v.z) * pull;
    }
    this.wanted = clampView(v);
  }

  /** Turn the camera about the point it looks at. */
  turn(radians: number): void {
    this.wanted = clampView({ ...this.wanted, yaw: this.wanted.yaw + radians });
  }

  /** Centre the view on a map point, closer in. */
  lookAt(x: number, y: number, distance = this.wanted.distance): void {
    this.wanted = clampView({ ...zoomView(this.wanted, distance / this.wanted.distance), x: x / TILE, z: y / TILE });
  }

  /** The map point (pixels) under a screen point, on the ground as it rises and falls. */
  pick(sx: number, sy: number): { x: number; y: number } | null {
    if (!this.ground) return null;
    this.raycaster.setFromCamera(this.ndc(sx, sy), this.camera);
    const hit = this.raycaster.intersectObject(this.ground, false)[0];
    const p = hit?.point ?? this.onPlane(sx, sy);
    if (!p) return null;
    return { x: Math.max(0, Math.min(MAP_W, p.x * TILE)), y: Math.max(0, Math.min(MAP_H, p.z * TILE)) };
  }

  /** Where a map point (pixels), `lift` world units above the ground, falls on the screen. */
  project(x: number, y: number, lift = 0): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x / TILE, this.groundAt(x, y) + lift, y / TILE).project(this.camera);
    return {
      x: (v.x * 0.5 + 0.5) * this.width,
      y: (-v.y * 0.5 + 0.5) * this.height,
      visible: v.z < 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1,
    };
  }

  /** How tall a squad's figure stands, for placing its name above it. */
  squadHeight(id: number): number {
    return this.squads.get(id)?.height ?? 1.4;
  }

  private ndc(sx: number, sy: number): THREE.Vector2 {
    return new THREE.Vector2((sx / this.width) * 2 - 1, -(sy / this.height) * 2 + 1);
  }

  private onPlane(sx: number, sy: number): THREE.Vector3 | null {
    this.raycaster.setFromCamera(this.ndc(sx, sy), this.camera);
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  }

  private applyView(): void {
    const { position, target } = viewCamera(this.shown);
    this.camera.position.set(...position);
    this.camera.lookAt(...target);
    this.camera.updateMatrixWorld();
  }

  // -------------------------------------------------------------- the frame --

  update(dtMs: number): void {
    this.clock += dtMs;
    this.shown = lerpView(this.shown, this.wanted, 1 - Math.exp(-dtMs / 110));
    this.applyView();
    const focusX = this.shown.x * TILE;
    const focusY = this.shown.z * TILE;
    this.atmosphere?.update(dtMs, this.camera, new THREE.Vector3(this.shown.x, this.groundAt(focusX, focusY), this.shown.z), this.shown.distance);
    this.tiltShift = THREE.MathUtils.mapLinear(THREE.MathUtils.clamp(this.shown.distance, 14, 56), 14, 56, 0.9, 0.4);

    // Flags stir in the wind, and the windmills turn.
    this.flagCloths.forEach((f, k) => {
      f.rotation.y = Math.sin(this.clock / 420 + k) * 0.35;
    });
    for (const s of this.sails) s.rotation.z -= dtMs * 0.0012;

    const yaw = this.shown.yaw;
    const grow = figureScale(this.shown.distance);
    const flat = this.atmosphere?.flatLight;
    for (const s of this.squads.values()) {
      s.t += dtMs;
      // Rings take the hour's light (the figures are lit by the scene's lights).
      if (flat) (s.base.material as THREE.MeshBasicMaterial).color.setHex(SIDE_COLOUR[s.side]).multiply(flat);
      const h = this.groundAt(s.x, s.y);
      const wx = s.x / TILE;
      const wz = s.y / TILE;
      // The way the squad marches, as the camera sees it.
      const f = s.figure.frame(screenOctant(s.heading[0], s.heading[1], yaw), s.t, s.moving);
      const tex = this.textureOf(f.image);
      const normal = this.textureOf(f.normal ?? outlineNormals(f.image), true);
      if (s.mat.map !== tex || s.mat.normalMap !== normal) {
        const fresh = !s.mat.map || !s.mat.normalMap;
        s.mat.map = tex;
        s.mat.normalMap = normal;
        if (fresh) s.mat.needsUpdate = true;
      }
      const img = f.image as { width: number; height: number };
      const scale = grow / s.figure.pixelsPerUnit;
      const w = img.width * scale;
      const ht = img.height * scale;
      const flip = f.mirror ? -1 : 1;
      s.body.scale.set(flip * w, ht, 1);
      s.body.position.set((img.width / 2 - f.anchorX) * scale * flip, ht / 2 - (img.height - f.anchorY) * scale, 0);
      s.root.position.set(wx, h, wz);
      s.root.rotation.y = Math.atan2(this.camera.position.x - wx, this.camera.position.z - wz);
      s.base.position.set(wx, h + 0.04, wz);
      s.base.scale.setScalar(grow);
      s.height = f.anchorY * scale;
    }

    const sel = this.selectedId !== null ? this.squads.get(this.selectedId) : undefined;
    if (sel) {
      this.selection.position.set(sel.x / TILE, this.groundAt(sel.x, sel.y) + 0.06, sel.y / TILE);
      const k = (1 + Math.sin(this.clock / 180) * 0.06) * grow;
      this.selection.scale.set(k, 1, k);
    } else {
      this.selection.visible = false;
    }

    for (const p of [...this.pulses]) {
      p.t += dtMs;
      const k = p.t / 500;
      p.mesh.scale.setScalar(1 + k * 2.4);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.pulses.splice(this.pulses.indexOf(p), 1);
      }
    }

  }

  private textureOf(image: SpriteImage, normals = false): THREE.Texture {
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

  dispose(): void {
    this.atmosphere?.dispose();
    for (const t of this.textures.values()) t.dispose();
    for (const m of this.ownMaterials) m.dispose();
    this.scene.traverse((o) => {
      // The models' geometry and materials are shared with the library, which outlives this map.
      if (o.userData.shared || isShared(o)) return;
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const all = Array.isArray(mat) ? mat : mat ? [mat] : [];
      for (const x of all) {
        (x as THREE.MeshLambertMaterial).map?.dispose();
        x.dispose();
      }
    });
  }
}

/** Whether an object is, or lies within, another. */
function isWithin(o: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

/** Whether an object lies within one of the models (whose parts are shared). */
function isShared(o: THREE.Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p.userData.shared) return true;
  return false;
}
