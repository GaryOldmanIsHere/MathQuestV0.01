import * as THREE from 'three';

// One WebGL renderer for every 3D view. The map and a battle are never drawn
// at once (the map waits while a battle plays), and each scene copies what
// it rendered into its own Phaser texture straight away, so they can take
// turns with one canvas and one GPU context rather than holding two.

let shared: THREE.WebGLRenderer | null = null;

export function sharedRenderer(width: number, height: number): THREE.WebGLRenderer {
  if (!shared) {
    shared = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
    shared.setPixelRatio(1);
  }
  const size = shared.getSize(new THREE.Vector2());
  if (size.x !== width || size.y !== height) shared.setSize(width, height, false);
  return shared;
}
