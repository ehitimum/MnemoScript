import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const tauriPlatform = process.env.TAURI_PLATFORM;
const buildTarget =
  tauriPlatform === 'windows' || tauriPlatform === 'linux'
    ? 'chrome105'
    : tauriPlatform === 'darwin'
      ? 'safari13'
      : 'es2020';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
  },
  // to make use of `TAURI_DEBUG` and other env variables
  // https://tauri.app/v1/api/config#buildconfig.beforedevcommand
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Use Tauri-specific targets when TAURI_PLATFORM is set, otherwise use a modern web fallback.
    target: buildTarget,
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});