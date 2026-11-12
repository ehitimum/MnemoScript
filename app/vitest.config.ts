import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Vitest runs the frontend unit + regression suites in jsdom. It is a separate
 * config from vite.config.ts so the Tailwind plugin, Tauri build targets and the
 * strict dev-server port never get in the way of a test run.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    unstubGlobals: true,
    // TipTap / React Flow mount real DOM trees; give slow CI boxes some headroom.
    testTimeout: 15000,
  },
});
