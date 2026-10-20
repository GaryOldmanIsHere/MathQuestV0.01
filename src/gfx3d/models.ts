import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// The 3D models the campaign map is built from: buildings in each side's
// colours, trees, rocks, clouds and flags, from the KayKit Medieval Hexagon
// Pack (CC0), packed into one file by tools/pack-models.ts. Loaded once at
// start; without it (a test, a failed download) the map falls back to its
// own simple shapes.

/** The colours a building comes in: ours, theirs, and the land's own. */
export type BuildingColour = 'blue' | 'red' | 'yellow';

const URL = 'models/world.glb';

let library: THREE.Object3D | null = null;
const bakedCache = new Map<string, { geometry: THREE.BufferGeometry; material: THREE.Material }>();

/** Load the models (once). False if they could not be had. */
export async function loadWorldModels(): Promise<boolean> {
  if (library) return true;
  try {
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(URL);
    library = gltf.scene;
    library.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (mat.map) mat.map.anisotropy = 4;
      // The pack's colours are flat and bright; a little sheen reads as painted wood and stone.
      mat.roughness = 0.82;
      mat.metalness = 0;
    });
    return true;
  } catch (e) {
    console.warn('The 3D models could not be loaded; the map uses simple shapes.', e);
    return false;
  }
}

export function hasWorldModels(): boolean {
  return library !== null;
}

/** A copy of a model to place in a scene (sharing the library's geometry and material). */
export function worldModel(key: string): THREE.Object3D | null {
  const source = library?.getObjectByName(key);
  return source ? source.clone(true) : null;
}

/**
 * A single-mesh model's geometry with its own placement baked in, and its
 * material: for drawing many at once (woods, rocks).
 */
export function bakedModel(key: string): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
  const cached = bakedCache.get(key);
  if (cached) return cached;
  const source = library?.getObjectByName(key);
  if (!source) return null;
  source.updateMatrixWorld(true);
  const rootInverse = source.matrixWorld.clone().invert();
  let found: { geometry: THREE.BufferGeometry; material: THREE.Material } | null = null;
  source.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (found || !mesh.isMesh) return;
    const geometry = floatCopy(mesh.geometry);
    geometry.applyMatrix4(rootInverse.clone().multiply(mesh.matrixWorld));
    found = { geometry, material: mesh.material as THREE.Material };
  });
  if (found) bakedCache.set(key, found);
  return found;
}

/**
 * A copy of a geometry with every attribute in plain floats. The packed
 * models keep their vertices as compressed integers, scaled back by their
 * node's placement; a placement baked into the vertices themselves needs the
 * full range of a float.
 */
function floatCopy(source: THREE.BufferGeometry): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(source.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) out[i * a.itemSize + c] = a.getComponent(i, c);
    geometry.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  if (source.index) geometry.setIndex(source.index.clone());
  return geometry;
}
