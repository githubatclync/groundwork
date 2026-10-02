// Vite config: React plugin plus a small plugin that copies CesiumJS static assets
// (Workers, Assets, Widgets, ThirdParty) into the dev server and the production build.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const CESIUM_DIRS = ['Workers', 'Assets', 'Widgets', 'ThirdParty'];
const cesiumBuild = resolve('node_modules/cesium/Build/Cesium');

function copyCesium(): Plugin {
  const copyTo = (dest: string) => {
    mkdirSync(dest, { recursive: true });
    for (const dir of CESIUM_DIRS) {
      const src = resolve(cesiumBuild, dir);
      if (existsSync(src)) cpSync(src, resolve(dest, dir), { recursive: true });
    }
  };
  return {
    name: 'copy-cesium-assets',
    // Dev: copy into public/ (git-ignored) so the dev server serves /cesium/*.
    buildStart() {
      copyTo(resolve('public/cesium'));
    },
  };
}

export default defineConfig({
  plugins: [react(), copyCesium()],
  define: { CESIUM_BASE_URL: JSON.stringify('/cesium') },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**'] } },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
