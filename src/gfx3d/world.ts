import * as THREE from 'three';
import type { MapNode } from '../core/types';
import type { Terrain } from '../core/terrain';
import { COLS, MAP_H, MAP_W, ROAD_WIDTH, ROWS, TILE, terrainAtTile } from '../core/terrain';
import type { SpriteImage } from './sprites';
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
  frame(screenOctant: number, ms: number, moving: boolean): { image: SpriteImage; anchorX: number; anchorY: number; mirror: boolean };
  /** How many of the drawing's pixels make one world unit. */
  pixelsPerUnit: number;
}

export type Owner = MapNode['owner'];

const OWNER_COLOUR: Record<Owner, number> = { player: 0x3a64e0, enemy: 0xd0402e, neutral: 0xd8d0b8 };
const SIDE_COLOUR = { player: 0x4a6ae0, enemy: 0xd04838 };

interface SquadMesh {
  root: THREE.Group;
  body: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  base: THREE.Mesh;
  figure: MapFigure;
  x: number;
  y: number;
  heading: [number, number];
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

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });

export class WorldStage {
  /** What the engine draws: the world, and the camera over it. */
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private ground: THREE.Mesh | null = null;
  private field: Float32Array = new Float32Array(VERTS_X * VERTS_Z);
  private water: THREE.Mesh | null = null;
  private flags = new Map<number, THREE.MeshLambertMaterial>();
  private flagCloths: THREE.Mesh[] = [];
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
    this.scene.background = new THREE.Color(0x9cc0e0);
    this.scene.fog = new THREE.Fog(0x9cc0e0, 90, 190);
    this.scene.add(new THREE.HemisphereLight(0xf0f4ff, 0x4a5a3a, 1.25));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.7);
    sun.position.set(-30, 40, 18);
    this.scene.add(sun);
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

  /** Raise the map from the terrain grid: ground, roads, water, woods and strongholds. */
  build(grid: Terrain[], nodes: MapNode[], seed = 1): void {
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
      // High ground pales to bare rock and snow; the land beyond the campaign darkens.
      const pale = Math.max(0, Math.min(1, (h - 1.6) / 1.6));
      const out = Math.max(0, -wx, wx - WORLD_W, -wz, wz - WORLD_D);
      const dim = 1 - Math.min(1, out / 1.5) * 0.35;
      const c = new THREE.Color(1, 1, 1).lerp(new THREE.Color(1.25, 1.25, 1.3), pale).multiplyScalar(dim);
      colours.set([c.r, c.g, c.b], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
    geo.computeVertexNormals();
    const map = new THREE.CanvasTexture(groundTexture(grid, nodes, seed));
    map.colorSpace = THREE.SRGBColorSpace;
    map.wrapS = THREE.MirroredRepeatWrapping;
    map.wrapT = THREE.MirroredRepeatWrapping;
    map.anisotropy = 4;
    this.ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map, vertexColors: true }));
    this.scene.add(this.ground);

    // Water: one sheet at the waterline, showing wherever the ground dips under it.
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(wide, deep).rotateX(-Math.PI / 2).translate(WORLD_W / 2, WATER_LEVEL, WORLD_D / 2),
      new THREE.MeshPhongMaterial({ color: 0x2e6eb8, transparent: true, opacity: 0.78, shininess: 80, specular: 0x88aacc }),
    );
    this.scene.add(this.water);

    this.plantTrees(grid, rand);
    for (const n of nodes) this.raiseStronghold(n, rand);
  }

  /** Woods on forest ground, and the odd tree in the open. */
  private plantTrees(grid: Terrain[], rand: () => number): void {
    const spots: [number, number, number][] = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const t = terrainAtTile(grid, col, row);
        const n = t === 'forest' ? 3 : t === 'plain' && rand() < 0.025 ? 1 : 0;
        for (let k = 0; k < n; k++) {
          const x = (col + 0.15 + rand() * 0.7) * TILE;
          const y = (row + 0.15 + rand() * 0.7) * TILE;
          spots.push([x, y, 0.5 + rand() * 0.3]);
        }
      }
    }
    if (!spots.length) return;
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

  /** A stronghold as a small building on its ground: a castle, a fort or a town, flying its owner's flag. */
  private raiseStronghold(n: MapNode, rand: () => number): void {
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

  /** Re-colour a stronghold's flag for its new owner. */
  setOwner(nodeId: number, owner: Owner): void {
    this.flags.get(nodeId)?.color.setHex(OWNER_COLOUR[owner]);
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
      const mat = new THREE.MeshBasicMaterial({ transparent: true, alphaTest: 0.4, side: THREE.DoubleSide });
      const body = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
      root.add(body);
      const base = new THREE.Mesh(
        new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: SIDE_COLOUR[side], transparent: true, opacity: 0.45, depthWrite: false }),
      );
      this.scene.add(root, base);
      s = { root, body, mat, base, figure, x, y, heading: [side === 'player' ? 1 : -1, 0], moving, t: Math.random() * 1000, height: 1.4 };
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

    // Flags stir in the wind.
    this.flagCloths.forEach((f, k) => {
      f.rotation.y = Math.sin(this.clock / 420 + k) * 0.35;
    });

    const yaw = this.shown.yaw;
    const grow = figureScale(this.shown.distance);
    for (const s of this.squads.values()) {
      s.t += dtMs;
      const h = this.groundAt(s.x, s.y);
      const wx = s.x / TILE;
      const wz = s.y / TILE;
      // The way the squad marches, as the camera sees it.
      const f = s.figure.frame(screenOctant(s.heading[0], s.heading[1], yaw), s.t, s.moving);
      const tex = this.textureOf(f.image);
      if (s.mat.map !== tex) {
        s.mat.map = tex;
        s.mat.needsUpdate = true;
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

    if (this.water) {
      const m = this.water.material as THREE.MeshPhongMaterial;
      m.opacity = 0.76 + Math.sin(this.clock / 900) * 0.04;
    }
  }

  private textureOf(image: SpriteImage): THREE.Texture {
    let tex = this.textures.get(image);
    if (!tex) {
      tex = new THREE.Texture(image as HTMLCanvasElement);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      this.textures.set(image, tex);
    }
    return tex;
  }

  dispose(): void {
    for (const t of this.textures.values()) t.dispose();
    this.scene.traverse((o) => {
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

// ------------------------------------------------------------ ground paint --

const PAINT: Record<Exclude<Terrain, 'road'>, [number, number, number][]> = {
  plain: [[86, 140, 58], [74, 126, 50], [98, 150, 66], [80, 132, 46]],
  forest: [[46, 92, 38], [38, 80, 32], [54, 100, 42], [42, 86, 30]],
  mountain: [[122, 110, 92], [104, 96, 82], [138, 128, 108], [96, 108, 70]],
  water: [[110, 104, 76], [96, 92, 70], [124, 116, 84], [100, 98, 72]],
};

/** Pixels of ground texture per tile. */
const PAINT_PX = 32;

/**
 * The ground's colours: each tile's terrain, its edges frayed so country
 * blends into country, then the roads laid along the links between
 * strongholds as the grid lays them.
 */
function groundTexture(grid: Terrain[], nodes: MapNode[], seed: number): HTMLCanvasElement {
  const W = COLS * PAINT_PX;
  const H = ROWS * PAINT_PX;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const rand = seeded(seed * 31 + 5);
  const jitter = new Float32Array(1024);
  for (let k = 0; k < jitter.length; k++) jitter[k] = rand() - 0.5;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      // Sample a little off the pixel, so borders between tiles wander.
      const j1 = jitter[(px * 7 + py * 13) & 1023];
      const j2 = jitter[(px * 11 + py * 5 + 333) & 1023];
      const tx = (px + j1 * PAINT_PX * 0.7) / PAINT_PX;
      const ty = (py + j2 * PAINT_PX * 0.7) / PAINT_PX;
      let t = terrainAtTile(grid, Math.floor(tx), Math.floor(ty));
      if (t === 'road') t = 'plain';
      const shades = PAINT[t];
      const pick = shades[Math.floor((jitter[(px * 3 + py * 17 + 71) & 1023] + 0.5) * shades.length) % shades.length];
      const o = (py * W + px) * 4;
      const grain = jitter[(px * 29 + py * 23) & 1023] * 10;
      img.data[o] = pick[0] + grain;
      img.data[o + 1] = pick[1] + grain;
      img.data[o + 2] = pick[2] + grain;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // Roads: packed earth with a darker verge, as wide as the grid's road corridor.
  const k = PAINT_PX / TILE;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  ctx.lineCap = 'round';
  for (const pass of [{ colour: '#7a6440', width: ROAD_WIDTH * 2 * k }, { colour: '#b09a6a', width: ROAD_WIDTH * 1.5 * k }]) {
    seen.clear();
    ctx.strokeStyle = pass.colour;
    ctx.lineWidth = pass.width;
    for (const n of nodes) {
      for (const l of n.links) {
        const o = byId.get(l);
        const key = `${Math.min(n.id, l)}-${Math.max(n.id, l)}`;
        if (!o || seen.has(key)) continue;
        seen.add(key);
        ctx.beginPath();
        ctx.moveTo(n.x * k, n.y * k);
        ctx.lineTo(o.x * k, o.y * k);
        ctx.stroke();
      }
    }
  }
  return canvas;
}
