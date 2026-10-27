import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Das Template wird als statische Seite gebaut; /assets, /markets und /job
// liefert der lokale Server (src/server/static.ts) aus.
export default defineConfig({
  root: resolve(__dirname, 'src/template'),
  base: '/',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/template'),
    emptyOutDir: true,
    assetsDir: '_app',
  },
});
