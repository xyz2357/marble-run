import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the deploy workflow sets BASE_PATH.
  base: process.env.BASE_PATH ?? '/',
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    // Rapier ships its WASM as base64 inside the JS, so it dwarfs everything else. Splitting it
    // and three out lets the browser fetch them in parallel and, more usefully, keeps them cached
    // across app changes: editing a piece no longer invalidates 3.5 MB.
    rollupOptions: {
      output: {
        // rolldown wants the function form here, not the object one.
        manualChunks(id: string) {
          if (id.includes('rapier3d')) return 'rapier';
          if (/node_modules[\/]three[\/]/.test(id)) return 'three';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 2000,
  },
});
