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
      // The two engines in chunks of their own, cached apart from the game.
      output: { manualChunks: { phaser: ['phaser'], three: ['three'] } },
    },
  },
});
