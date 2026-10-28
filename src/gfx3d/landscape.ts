import * as THREE from 'three';
import { MeshLambertNodeMaterial, MeshPhongNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  clamp, color, float, mix, normalize, normalWorld,
  positionGeometry, positionLocal, positionWorld, sin, cos, smoothstep, texture, time, transformNormalToView, uniform, vec2, vec3,
  vertexColor,
} from 'three/tsl';
import type { MapNode } from '../core/types';
import type { Terrain } from '../core/terrain';
import { COLS, ROAD_WIDTH, ROWS, TILE, terrainAtTile } from '../core/terrain';
import { VERTS_X, VERTS_Z, WATER_LEVEL, WORLD_D, WORLD_W } from './worldMap';

// Each material has a simpler form for modest machines (`simple`): plain
// diffuse lighting in place of the physically based kind, one layer of waves.
//
// The campaign map's living surfaces, painted in the GPU: ground that
// blends meadow, woodland floor, worn earth, rock, sand and snow by what the
// terrain grid says lies there and how the land lies; water that ripples,
// deepens in colour away from the shore and froths along it; and the wind,
// which stirs the woods and the grass. Written in three.js's node language,
// so the same materials run on WebGPU and WebGL2.

/** How hard the wind blows: 0 still, 1 a fresh breeze. */
export const wind = uniform(0.6);
/** How wet the land is after rain: 0 dry, 1 soaked (darker, glossier ground, rougher water). */
export const wetness = uniform(0);
/** How much snow lies on the land: 0 none, 1 a white blanket. */
export const snowCover = uniform(0);

// ------------------------------------------------------------------- noise --

/** Texels a side of the noise texture. */
const NOISE = 256;
let noiseTex: THREE.DataTexture | null = null;

/**
 * Noise worked out once and kept in a texture that tiles seamlessly: red
 * the lie of the land (several octaves), green patches, blue fine grain,
 * alpha cells like a painter's dabs. Sampling it costs a GPU far less than
 * working noise out at every point, which matters on modest machines.
 */
export function noiseTexture(): THREE.DataTexture {
  if (noiseTex) return noiseTex;
  let seed = 7;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // Value noise on a lattice of `cells` a side that wraps, smoothly interpolated.
  const lattice = (cells: number) => {
    const v = new Float32Array(cells * cells);
    for (let k = 0; k < v.length; k++) v[k] = rand();
    return (x: number, y: number) => {
      const fx = (x / NOISE) * cells;
      const fy = (y / NOISE) * cells;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const u = fx - i;
      const w = fy - j;
      const su = u * u * (3 - 2 * u);
      const sw = w * w * (3 - 2 * w);
      const at = (a: number, b: number) => v[((b + cells) % cells) * cells + ((a + cells) % cells)];
      return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sw) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sw;
    };
  };
  const octaves = [lattice(4), lattice(8), lattice(16), lattice(32)];
  const patch = lattice(16);
  const grain = lattice(64);
  // Cells: the distance to the nearest of one scattered point per cell, wrapping.
  const CELLS = 32;
  const points = Array.from({ length: CELLS * CELLS }, () => [rand(), rand()]);
  const cellular = (x: number, y: number) => {
    const fx = (x / NOISE) * CELLS;
    const fy = (y / NOISE) * CELLS;
    const i = Math.floor(fx);
    const j = Math.floor(fy);
    let best = 9;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const pt = points[((j + dj + CELLS) % CELLS) * CELLS + ((i + di + CELLS) % CELLS)];
        best = Math.min(best, Math.hypot(i + di + pt[0] - fx, j + dj + pt[1] - fy));
      }
    }
    return Math.min(1, best);
  };
  const data = new Uint8Array(NOISE * NOISE * 4);
  for (let y = 0; y < NOISE; y++) {
    for (let x = 0; x < NOISE; x++) {
      const o = (y * NOISE + x) * 4;
      const broad = (octaves[0](x, y) * 0.5 + octaves[1](x, y) * 0.27 + octaves[2](x, y) * 0.15 + octaves[3](x, y) * 0.08);
      data[o] = Math.round(broad * 255);
      data[o + 1] = Math.round(patch(x, y) * 255);
      data[o + 2] = Math.round(grain(x, y) * 255);
      data[o + 3] = Math.round(cellular(x, y) * 255);
    }
  }
  noiseTex = new THREE.DataTexture(data, NOISE, NOISE, THREE.RGBAFormat);
  noiseTex.wrapS = THREE.RepeatWrapping;
  noiseTex.wrapT = THREE.RepeatWrapping;
  noiseTex.magFilter = THREE.LinearFilter;
  noiseTex.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTex.generateMipmaps = true;
  noiseTex.needsUpdate = true;
  return noiseTex;
}

// ------------------------------------------------------------------ ground --

/** Texels of the ground's mix map per tile. */
const MIX_PX = 8;

/**
 * Where each kind of ground lies, as a soft-edged map over the campaign:
 * red woodland floor, green worn earth (the roads), blue rock. (Sand needs
 * no map: it lies wherever the land meets the water.)
 */
function groundMix(grid: Terrain[], nodes: MapNode[]): HTMLCanvasElement {
  const W = COLS * MIX_PX;
  const H = ROWS * MIX_PX;
  const sharp = document.createElement('canvas');
  sharp.width = W;
  sharp.height = H;
  const ctx = sharp.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const t = terrainAtTile(grid, col, row);
      const r = t === 'forest' ? 255 : 0;
      const b = t === 'mountain' ? 255 : 0;
      for (let y = 0; y < MIX_PX; y++) {
        for (let x = 0; x < MIX_PX; x++) {
          const o = ((row * MIX_PX + y) * W + col * MIX_PX + x) * 4;
          img.data[o] = r;
          img.data[o + 1] = 0;
          img.data[o + 2] = b;
          // Opaque: a canvas forgets the colour of a clear pixel.
          img.data[o + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  // Roads, in the green channel only, as wide as the grid's road corridor.
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(0, 255, 0, 1)';
  ctx.lineCap = 'round';
  ctx.lineWidth = ROAD_WIDTH * 1.6 * (MIX_PX / TILE);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    for (const l of n.links) {
      const o = byId.get(l);
      if (!o || l < n.id) continue;
      ctx.beginPath();
      ctx.moveTo((n.x / TILE) * MIX_PX, (n.y / TILE) * MIX_PX);
      ctx.lineTo((o.x / TILE) * MIX_PX, (o.y / TILE) * MIX_PX);
      ctx.stroke();
    }
  }
  // A worn square of earth at each stronghold.
  ctx.fillStyle = 'rgba(0, 255, 0, 1)';
  for (const n of nodes) {
    ctx.beginPath();
    ctx.arc((n.x / TILE) * MIX_PX, (n.y / TILE) * MIX_PX, 1.3 * MIX_PX, 0, Math.PI * 2);
    ctx.fill();
  }
  // Soften every edge, so country blends into country.
  const soft = document.createElement('canvas');
  soft.width = W;
  soft.height = H;
  const sctx = soft.getContext('2d')!;
  sctx.filter = `blur(${MIX_PX * 0.45}px)`;
  sctx.drawImage(sharp, 0, 0);
  return soft;
}

/** The noise a stretch of ground is painted with, at four scales. */
export interface GroundNoise {
  /** The lie of the land. */
  broad: Node<'float'>;
  /** Patches of a different shade. */
  patch: Node<'float'>;
  /** Fine grain. */
  grain: Node<'float'>;
  /** A painter's dabs. */
  dab: Node<'float'>;
}

/** How much of each kind of ground lies at a point, 0 to 1, over a meadow. */
export interface GroundAmounts {
  woodland: Node<'float'>;
  rock: Node<'float'>;
  road: Node<'float'>;
  sand: Node<'float'>;
  snow: Node<'float'>;
}

/**
 * Ground painted at every point: a meadow of two greens with yellower
 * patches, a darker woodland floor, worn earth, rock in faint strata (mossy
 * where low and gentle), sand and snow, mixed as `amounts` says, each broken
 * up by dabs of colour as a painter would lay it. Snow settles and rain
 * darkens as the weather has it. `scale` sets how fine the noise runs (the
 * battlefield, seen closer, is painted finer); `tint` multiplies the colour.
 */
export function paintedGround(
  amounts: (n: GroundNoise, y: Node<'float'>, slope: Node<'float'>) => GroundAmounts,
  simple: boolean,
  scale = 1,
  tint?: Node<'vec3'>,
): THREE.Material {
  const p = positionWorld.xz.mul(scale);
  const y = positionWorld.y;
  const slope = float(1).sub(normalWorld.y);

  const noise = texture(noiseTexture());
  const n: GroundNoise = {
    broad: noise.sample(p.mul(0.0175)).r,
    patch: noise.sample(p.mul(0.02)).g,
    grain: noise.sample(p.mul(0.14)).b,
    dab: noise.sample(p.mul(0.075)).a,
  };
  const { broad, patch, grain, dab } = n;
  const lift = dab.mul(0.16).add(grain.mul(0.08)).add(0.88);

  let meadow: Node<'vec3'> = mix(color(0x3f7a26), color(0x6c9e33), broad);
  meadow = mix(meadow, color(0x9aa846), smoothstep(0.62, 0.85, patch).mul(0.55));
  const woodland = mix(color(0x2a4a1c), color(0x3d4d22), patch);
  const earth = mix(color(0x8a6b40), color(0xa88a58), grain.mul(0.6).add(patch.mul(0.4)));
  let rock: Node<'vec3'> = mix(color(0x77705f), color(0x9a9282), broad.mul(0.6).add(sin(y.mul(5).add(patch.mul(4))).mul(0.12).add(0.2)));
  rock = mix(rock, color(0x5d6e3a), smoothstep(0.45, 0.15, slope).mul(smoothstep(2.6, 1.2, y)).mul(0.6));
  const sand = mix(color(0xb8a576), color(0xd1c193), grain);
  const snow = mix(color(0xd9e2ea), color(0xf4f7fa), grain);

  const a = amounts(n, y, slope);
  let ground: Node<'vec3'> = mix(meadow, woodland, a.woodland);
  ground = mix(ground, rock, a.rock);
  ground = mix(ground, earth, a.road);
  ground = mix(ground, sand, a.sand);
  ground = mix(ground, snow, a.snow);
  // Fallen snow settles on whatever lies flat enough, thinnest on the roads.
  const settled = snowCover.mul(smoothstep(0.55, 0.2, slope)).mul(smoothstep(0.25, 0.65, patch.add(snowCover.mul(0.6)))).mul(float(1).sub(a.road.mul(0.5)));
  ground = mix(ground, snow, clamp(settled, 0, 1));
  // Rain darkens the earth.
  ground = ground.mul(float(1).sub(wetness.mul(0.28)));
  let painted: Node<'vec3'> = ground.mul(lift);
  if (tint) painted = painted.mul(tint);

  if (simple) {
    const material = new MeshLambertNodeMaterial();
    material.colorNode = painted;
    return material;
  }
  const material = new MeshStandardNodeMaterial({ metalness: 0 });
  material.colorNode = painted;
  material.roughnessNode = float(0.94).sub(wetness.mul(0.42));
  return material;
}

/**
 * The campaign map's ground: woodland floor under the woods, worn earth
 * along the roads and about the strongholds, rock where the land is steep or
 * mountainous, sand at the water's edge and snow on the peaks, as the
 * terrain grid lays them out. The ground's vertex colours dim the land
 * beyond the campaign.
 */
export function groundMaterial(grid: Terrain[], nodes: MapNode[], simple = false): THREE.Material {
  const mixMap = new THREE.CanvasTexture(groundMix(grid, nodes));
  mixMap.wrapS = THREE.MirroredRepeatWrapping;
  mixMap.wrapT = THREE.MirroredRepeatWrapping;
  mixMap.colorSpace = THREE.NoColorSpace;
  const m = texture(mixMap);
  return paintedGround(({ broad, grain }, y, slope) => ({
    woodland: smoothstep(0.15, 0.75, m.r),
    rock: clamp(m.b.mul(smoothstep(0.02, 0.22, slope.add(broad.mul(0.12)))).add(smoothstep(0.3, 0.55, slope)), 0, 1),
    road: smoothstep(0.32, 0.62, m.g.add(grain.sub(0.5).mul(0.25))),
    sand: smoothstep(WATER_LEVEL + 0.2, WATER_LEVEL + 0.04, y).mul(0.9),
    snow: smoothstep(4.9, 5.5, y.add(broad.sub(0.5).mul(1.2))).mul(smoothstep(0.7, 0.35, slope)),
  }), simple, 1, vertexColor().xyz);
}

// ------------------------------------------------------------------ water --

/** The ground's heights as a texture, so the water knows how deep it lies. */
function heightTexture(field: Float32Array): THREE.DataTexture {
  const data = new Uint16Array(field.length);
  for (let k = 0; k < field.length; k++) data[k] = THREE.DataUtils.toHalfFloat(field[k]);
  const tex = new THREE.DataTexture(data, VERTS_X, VERTS_Z, THREE.RedFormat, THREE.HalfFloatType);
  tex.wrapS = THREE.MirroredRepeatWrapping;
  tex.wrapT = THREE.MirroredRepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * The water's material: clear and pale green in the shallows, deep blue
 * further out, with small waves running over it that catch the sun and a
 * line of froth that comes and goes along every shore.
 */
export function waterMaterial(field: Float32Array, simple = false): THREE.Material {
  const heights = texture(heightTexture(field));
  const p = positionWorld.xz;
  // The ground under this point of water (the field's vertices span the map exactly).
  const at = vec2(p.x.div(WORLD_W).mul(VERTS_X - 1).add(0.5).div(VERTS_X), p.y.div(WORLD_D).mul(VERTS_Z - 1).add(0.5).div(VERTS_Z));
  const depth = float(WATER_LEVEL).sub(heights.sample(at).r).max(0);

  // Waves: two sets of noise drifting against each other; their slope tilts the surface.
  const t = time;
  const noise = texture(noiseTexture());
  const wave = (q: Node<'vec2'>) =>
    noise.sample(q.mul(0.045).add(vec2(t.mul(0.011), t.mul(0.007)))).g.mul(0.6)
      .add(noise.sample(q.mul(0.12).add(vec2(t.mul(-0.013), t.mul(0.017)))).b.mul(0.4)).mul(2);
  const tilt = float(0.32).mul(wind.mul(0.6).add(0.4)).add(wetness.mul(0.25));
  let surface: Node<'vec3'>;
  if (simple) {
    // One drifting sample, its two channels read as the surface's slope.
    const s = noise.sample(p.mul(0.08).add(vec2(t.mul(0.012), t.mul(0.009))));
    surface = normalize(vec3(s.g.sub(0.5).mul(tilt).mul(3), 1, s.b.sub(0.5).mul(tilt).mul(3)));
  } else {
    // The slope across a span of several of the noise's texels, so it runs smoothly from texel to texel.
    const e = 0.35;
    const h0 = wave(p);
    const hx = wave(p.add(vec2(e, 0)));
    const hz = wave(p.add(vec2(0, e)));
    surface = normalize(vec3(h0.sub(hx).div(e).mul(tilt).mul(1.6), 1, h0.sub(hz).div(e).mul(tilt).mul(1.6)));
  }

  const shallow = color(0x3e9a9a);
  const deep = color(0x143a72);
  const body = mix(shallow, deep, smoothstep(0.02, 0.6, depth));
  // Froth: a thin band along the shore, broken and breathing.
  const froth = smoothstep(0.07, 0.0, depth).mul(smoothstep(0.35, 0.75, noise.sample(p.mul(0.2).add(vec2(t.mul(0.02), 0))).b.add(sin(t.mul(1.3).add(depth.mul(40))).mul(0.15))));

  const opacity = clamp(smoothstep(0.0, 0.5, depth).mul(0.35).add(0.6).add(froth.mul(0.3)), 0, 0.97);
  if (simple) {
    const material = new MeshPhongNodeMaterial({ shininess: 90, specular: 0x8899aa, transparent: true, depthWrite: false });
    material.colorNode = mix(body, color(0xf2f6f4), froth);
    material.normalNode = transformNormalToView(surface);
    material.opacityNode = opacity;
    return material;
  }
  const material = new MeshStandardNodeMaterial({ roughness: 0.2, metalness: 0, transparent: true });
  material.colorNode = mix(body, color(0xf2f6f4), froth);
  material.normalNode = transformNormalToView(surface);
  material.opacityNode = opacity;
  material.roughnessNode = mix(float(0.2), float(0.6), froth);
  material.depthWrite = false;
  return material;
}

// ------------------------------------------------------------------- wind --

/**
 * A copy of a model's material that sways in the wind: the higher a vertex
 * stands above its model's foot, the further it moves, each tree in its own
 * time.
 */
export function windSwayed(base: THREE.Material, simple = false, reach = 0.09): THREE.Material {
  const source = base as THREE.MeshStandardMaterial;
  const material = simple
    ? new MeshLambertNodeMaterial({ map: source.map, color: source.color })
    : new MeshStandardNodeMaterial({ map: source.map, color: source.color, roughness: 0.85, metalness: 0 });
  material.positionNode = swayed(reach);
  return material;
}

/** The sway of a vertex `positionGeometry.y` above its foot, in the wind. */
function swayed(reach: number): Node<'vec3'> {
  const height = positionGeometry.y.max(0);
  // Its place in the world sets its timing, so neighbours sway out of step.
  const phase = positionLocal.x.mul(0.61).add(positionLocal.z.mul(0.83));
  const gust = sin(time.mul(0.37).add(phase.mul(0.07))).mul(0.4).add(0.6);
  const bend = height.mul(height).mul(reach).mul(wind).mul(gust);
  return positionLocal.add(vec3(sin(time.mul(1.7).add(phase)).mul(bend), 0, cos(time.mul(1.31).add(phase.mul(1.13))).mul(bend.mul(0.6))));
}

// ------------------------------------------------------------------ grass --

/** A tuft: blades fanned out from a point, as one geometry. */
function tuftGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const blades = 7;
  for (let k = 0; k < blades; k++) {
    const a = (k / blades) * Math.PI * 2 + (k % 2) * 0.4;
    const lean = 0.05 + (k % 3) * 0.025;
    const h = 0.16 + ((k * 37) % 7) * 0.018;
    const w = 0.022;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    // Two triangles per blade: root, mid, tip, bent outward.
    const root: [number, number, number][] = [[-w * cz, 0, w * cx], [w * cz, 0, -w * cx]];
    const tip: [number, number, number] = [cx * lean, h, cz * lean];
    positions.push(...root[0], ...root[1], ...tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Lit as the ground is, from above, so blades never show a dark side.
  const normals = new Float32Array(positions.length);
  for (let k = 0; k < normals.length; k += 3) normals[k + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return g;
}

/**
 * Tufts of grass over the open meadow (not the roads, woods, rock or water,
 * nor about the strongholds), `perTile` to a tile, swaying in the wind.
 * Null where there is no room or none is wanted.
 */
export function grassField(
  grid: Terrain[], nodes: MapNode[], groundAt: (x: number, y: number) => number, perTile: number, rand: () => number,
): THREE.InstancedMesh | null {
  if (perTile <= 0) return null;
  const spots: [number, number, number][] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (terrainAtTile(grid, col, row) !== 'plain') continue;
      for (let k = 0; k < perTile; k++) {
        const x = (col + rand()) * TILE;
        const y = (row + rand()) * TILE;
        if (nodes.some((n) => Math.hypot(n.x - x, n.y - y) < 1.9 * TILE)) continue;
        const h = groundAt(x, y);
        // Meadow only: not the banks, nor the foothills' rock.
        if (h < WATER_LEVEL + 0.12 || h > 0.75) continue;
        spots.push([x, y, h]);
      }
    }
  }
  return spots.length ? grassTufts(spots.map(([x, y, h]) => [x / TILE, h - 0.01, y / TILE]), rand) : null;
}

/** Tufts of grass standing at `spots` (x, y, z in the world), swaying in the wind; `shade` darkens them. */
export function grassTufts(spots: [number, number, number][], rand: () => number, shade = 1): THREE.InstancedMesh {
  const material = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0, side: THREE.DoubleSide });
  // The meadow's green at the root, brighter at the tip; lit from above on both faces.
  material.colorNode = mix(color(0x4a7c28), color(0xa6d05c), smoothstep(0, 0.26, positionGeometry.y));
  material.normalNode = transformNormalToView(vec3(0, 1, 0));
  material.positionNode = swayed(1.6);
  const tufts = new THREE.InstancedMesh(tuftGeometry(), material, spots.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  spots.forEach(([x, y, z], k) => {
    const s = 0.6 + rand() * 0.5;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s, s * (0.8 + rand() * 0.5), s));
    tufts.setMatrixAt(k, m);
    // Mostly greens; now and then the yellow of a dry tuft.
    tufts.setColorAt(k, (rand() < 0.1 ? tint.setRGB(1.3, 1.15, 0.55) : tint.setRGB(0.85 + rand() * 0.3, 0.9 + rand() * 0.2, 0.8 + rand() * 0.25)).multiplyScalar(shade));
  });
  tufts.receiveShadow = true;
  return tufts;
}
