/** Dango Tower is a standalone game. The company site lives in drecry-site. */
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Served from https://drecry.com/dango-tower/
  base: '/dango-tower/',
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    outDir: 'dist/dango-tower',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
