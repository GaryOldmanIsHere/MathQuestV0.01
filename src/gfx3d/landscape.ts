import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import type { Node } from 'three/webgpu';
import {
  clamp, color, float, mix, mx_fractal_noise_float, mx_noise_float, mx_worley_noise_float, normalize, normalWorld,
  positionGeometry, positionLocal, positionWorld, sin, cos, smoothstep, texture, time, transformNormalToView, uniform, vec2, vec3,
  vertexColor,
} from 'three/tsl';
import type { MapNode } from '../core/types';
import type { Terrain } from '../core/terrain';
import { COLS, ROAD_WIDTH, ROWS, TILE, terrainAtTile } from '../core/terrain';
import { VERTS_X, VERTS_Z, WATER_LEVEL, WORLD_D, WORLD_W } from './worldMap';

// The campaign map's living surfaces, painted in the GPU: ground that
// blends meadow, woodland floor, worn earth, rock, sand and snow by what the
// terrain grid says lies there and how the land lies; water that ripples,
// deepens in colour away from the shore and froths along it; and the wind,
// which stirs the woods and the grass. Written in three.js's node language,
// so the same materials run on WebGPU and WebGL2.

/** How hard the wind blows: 0 still, 1 a fresh breeze. */
export const wind = uniform(0.6);

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

/**
 * The ground's material. Its colour is worked out at every point: a meadow
 * of two greens with yellower patches, under woods a darker floor, worn
 * earth along the roads, rock where the land is steep or mountainous, sand
 * at the water's edge and snow on the peaks, each broken up by dabs of
 * colour as a painter would lay it. The ground's vertex colours dim the land
 * beyond the campaign.
 */
export function groundMaterial(grid: Terrain[], nodes: MapNode[]): THREE.Material {
  const mixMap = new THREE.CanvasTexture(groundMix(grid, nodes));
  mixMap.wrapS = THREE.MirroredRepeatWrapping;
  mixMap.wrapT = THREE.MirroredRepeatWrapping;
  mixMap.colorSpace = THREE.NoColorSpace;
  const m = texture(mixMap);
  const p = positionWorld.xz;
  const y = positionWorld.y;
  const slope = float(1).sub(normalWorld.y);

  // Noise at three scales: the lie of the land, patches, and brush dabs.
  const broad = mx_fractal_noise_float(p.mul(0.07), 3).mul(0.5).add(0.5);
  const patch = mx_noise_float(p.mul(0.32)).mul(0.5).add(0.5);
  const dab = mx_worley_noise_float(p.mul(2.4));
  const grain = mx_noise_float(p.mul(9)).mul(0.5).add(0.5);
  const lift = dab.mul(0.16).add(grain.mul(0.08)).add(0.88);

  let meadow: Node<'vec3'> = mix(color(0x3f7a26), color(0x6c9e33), broad);
  meadow = mix(meadow, color(0x9aa846), smoothstep(0.62, 0.85, patch).mul(0.55));
  const woodland = mix(color(0x2a4a1c), color(0x3d4d22), patch);
  const earth = mix(color(0x8a6b40), color(0xa88a58), grain.mul(0.6).add(patch.mul(0.4)));
  // Rock in faint strata, mossy where it is low and gentle.
  let rock: Node<'vec3'> = mix(color(0x77705f), color(0x9a9282), broad.mul(0.6).add(sin(y.mul(5).add(patch.mul(4))).mul(0.12).add(0.2)));
  rock = mix(rock, color(0x5d6e3a), smoothstep(0.45, 0.15, slope).mul(smoothstep(2.6, 1.2, y)).mul(0.6));
  const sand = mix(color(0xb8a576), color(0xd1c193), grain);
  const snow = mix(color(0xd9e2ea), color(0xf4f7fa), grain);

  const rockAmount = clamp(m.b.mul(smoothstep(0.02, 0.22, slope.add(broad.mul(0.12)))).add(smoothstep(0.3, 0.55, slope)), 0, 1);
  const roadAmount = smoothstep(0.32, 0.62, m.g.add(grain.sub(0.5).mul(0.25)));
  const sandAmount = smoothstep(WATER_LEVEL + 0.2, WATER_LEVEL + 0.04, y).mul(0.9);
  const snowAmount = smoothstep(4.9, 5.5, y.add(broad.sub(0.5).mul(1.2))).mul(smoothstep(0.7, 0.35, slope));

  let ground: Node<'vec3'> = mix(meadow, woodland, smoothstep(0.15, 0.75, m.r));
  ground = mix(ground, rock, rockAmount);
  ground = mix(ground, earth, roadAmount);
  ground = mix(ground, sand, sandAmount);
  ground = mix(ground, snow, snowAmount);

  const material = new MeshStandardNodeMaterial({ roughness: 0.94, metalness: 0 });
  material.colorNode = ground.mul(lift).mul(vertexColor());
  return material;
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
export function waterMaterial(field: Float32Array): THREE.Material {
  const heights = texture(heightTexture(field));
  const p = positionWorld.xz;
  // The ground under this point of water (the field's vertices span the map exactly).
  const at = vec2(p.x.div(WORLD_W).mul(VERTS_X - 1).add(0.5).div(VERTS_X), p.y.div(WORLD_D).mul(VERTS_Z - 1).add(0.5).div(VERTS_Z));
  const depth = float(WATER_LEVEL).sub(heights.sample(at).r).max(0);

  // Waves: two sets of noise drifting against each other; their slope tilts the surface.
  const t = time;
  const wave = (q: Node<'vec2'>) =>
    mx_noise_float(vec3(q.mul(1.1), t.mul(0.45))).mul(0.6).add(mx_noise_float(vec3(q.mul(2.9).add(vec2(t.mul(0.21), t.mul(-0.17))), t.mul(0.8))).mul(0.4));
  const e = 0.06;
  const h0 = wave(p);
  const hx = wave(p.add(vec2(e, 0)));
  const hz = wave(p.add(vec2(0, e)));
  const tilt = float(0.32).mul(wind.mul(0.6).add(0.4));
  const surface = normalize(vec3(h0.sub(hx).div(e).mul(tilt), 1, h0.sub(hz).div(e).mul(tilt)));

  const shallow = color(0x3e9a9a);
  const deep = color(0x143a72);
  const body = mix(shallow, deep, smoothstep(0.02, 0.6, depth));
  // Froth: a thin band along the shore, broken and breathing.
  const froth = smoothstep(0.07, 0.0, depth).mul(smoothstep(0.35, 0.75, mx_noise_float(vec3(p.mul(3.2), t.mul(0.6))).mul(0.5).add(0.5).add(sin(t.mul(1.3).add(depth.mul(40))).mul(0.15))));

  const material = new MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0, transparent: true });
  material.colorNode = mix(body, color(0xf2f6f4), froth);
  material.normalNode = transformNormalToView(surface);
  material.opacityNode = clamp(smoothstep(0.0, 0.5, depth).mul(0.35).add(0.6).add(froth.mul(0.3)), 0, 0.97);
  material.roughnessNode = mix(float(0.1), float(0.6), froth);
  material.depthWrite = false;
  return material;
}

// ------------------------------------------------------------------- wind --

/**
 * A copy of a model's material that sways in the wind: the higher a vertex
 * stands above its model's foot, the further it moves, each tree in its own
 * time.
 */
export function windSwayed(base: THREE.Material, reach = 0.09): THREE.Material {
  const source = base as THREE.MeshStandardMaterial;
  const material = new MeshStandardNodeMaterial({ map: source.map, color: source.color, roughness: 0.85, metalness: 0 });
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
  if (!spots.length) return null;
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
  spots.forEach(([x, y, h], k) => {
    const s = 0.6 + rand() * 0.5;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    m.compose(new THREE.Vector3(x / TILE, h - 0.01, y / TILE), q, new THREE.Vector3(s, s * (0.8 + rand() * 0.5), s));
    tufts.setMatrixAt(k, m);
    // Mostly greens; now and then the yellow of a dry tuft.
    tufts.setColorAt(k, rand() < 0.1 ? tint.setRGB(1.3, 1.15, 0.55) : tint.setRGB(0.85 + rand() * 0.3, 0.9 + rand() * 0.2, 0.8 + rand() * 0.25));
  });
  tufts.receiveShadow = true;
  return tufts;
}
