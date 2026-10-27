import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Review-Oberfläche; läuft unter /review/ auf dem Review-Server (src/review/server.ts).
export default defineConfig({
  root: resolve(__dirname, 'src/review/ui'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist/review'),
    emptyOutDir: true,
    assetsDir: '_app',
  },
});
