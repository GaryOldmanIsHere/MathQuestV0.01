import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      // The 3D engine in a chunk of its own, cached apart from the game.
      output: { manualChunks: { three: ['three', 'three/webgpu', 'three/tsl'] } },
    },
  },
});
