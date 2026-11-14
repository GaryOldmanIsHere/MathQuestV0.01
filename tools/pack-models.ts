// Packs the 3D models the campaign map uses into one file,
// src/assets/models/world.glb, from a copy of the KayKit Medieval Hexagon Pack
// (by Kay Lousberg, CC0: https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0).
//
//   git clone --depth 1 https://github.com/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0 kaykit
//   npm run pack:models -- kaykit
//
// Every model in the pack shares one small texture, so the packed file holds
// it once. Each model becomes a top-level node named for its key below (a
// building's key ends in its colour); vertices are quantized and compressed
// with meshopt, which three.js decodes.

import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, join, meshopt, mergeDocuments, prune, unpartition, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { mkdirSync, statSync } from 'node:fs';
import { join as joinPath } from 'node:path';

const pack = process.argv[2];
if (!pack) {
  console.error('Usage: npm run pack:models -- path/to/KayKit-Medieval-Hexagon-Pack');
  process.exit(1);
}
const root = joinPath(pack, 'addons/kaykit_medieval_hexagon_pack/Assets/gltf');

/** The colours a building comes in here: ours, theirs, and the land's own. */
const COLOURS = ['blue', 'red', 'yellow'] as const;
const BUILDINGS: Record<string, readonly string[]> = {
  castle: ['blue', 'red'],
  tower_A: COLOURS,
  home_A: COLOURS,
  home_B: COLOURS,
  church: COLOURS,
  windmill: COLOURS,
  well: COLOURS,
};
const NATURE = ['tree_single_A', 'tree_single_B', 'rock_single_A', 'rock_single_B', 'rock_single_C', 'rock_single_D', 'cloud_big', 'cloud_small'];
const PROPS = ['flag_blue', 'flag_red', 'flag_yellow'];

const sources: [key: string, file: string][] = [
  ...Object.entries(BUILDINGS).flatMap(([name, colours]) =>
    colours.map((c): [string, string] => [`${name}_${c}`, `buildings/${c}/building_${name}_${c}.gltf`])),
  ...NATURE.map((n): [string, string] => [n, `decoration/nature/${n}.gltf`]),
  ...PROPS.map((n): [string, string] => [n, `decoration/props/${n}.gltf`]),
];

const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
await MeshoptEncoder.ready;

const doc = new Document();
for (const [key, file] of sources) {
  const part = await io.read(joinPath(root, file));
  // Every model's nodes under one parent named for its key.
  const scene = part.getRoot().getDefaultScene() ?? part.getRoot().listScenes()[0];
  const holder = part.createNode(key);
  for (const child of scene.listChildren()) {
    scene.removeChild(child);
    holder.addChild(child);
  }
  scene.addChild(holder);
  mergeDocuments(doc, part);
}
// One scene holding every model.
const scenes = doc.getRoot().listScenes();
const main = scenes[0];
for (const s of scenes.slice(1)) {
  for (const child of s.listChildren()) main.addChild(child);
  s.dispose();
}
doc.getRoot().setDefaultScene(main);

await doc.transform(
  unpartition(),
  dedup(),
  join({ keepNamed: true }),
  weld(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

mkdirSync('src/assets/models', { recursive: true });
const out = 'src/assets/models/world.glb';
await io.write(out, doc);
console.log(`${sources.length} models → ${out} (${(statSync(out).size / 1024).toFixed(0)} KB)`);
