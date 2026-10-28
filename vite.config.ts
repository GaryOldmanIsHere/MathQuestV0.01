import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Vite copies public/ into every build, and public/ob64/ holds the data and
 * sprites extracted from the player's own Ogre Battle 64 cartridge: copyrighted,
 * never to be published. A build leaves them out unless asked for a private
 * one (PALATINUS_INCLUDE_OB64=1 npm run build, to play a local build on them).
 */
function keepRomDataOut(): Plugin {
  let outDir = 'dist';
  return {
    name: 'palatinus-keep-rom-data-out',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      if (process.env.PALATINUS_INCLUDE_OB64 === '1') return;
      rmSync(resolve(outDir, 'ob64'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  plugins: [keepRomDataOut()],
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // The 3D engine in a chunk of its own, cached apart from the game.
      output: { manualChunks: { three: ['three', 'three/webgpu', 'three/tsl'] } },
    },
  },
});
