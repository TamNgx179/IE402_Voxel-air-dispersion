/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The NestJS API runs on :3000 in development (see app/README.md). The production
// build is served by NestJS at "/" from frontend/dist, so assets use absolute paths.
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Maps are generated for local debugging but not referenced from the bundles;
    // the Dockerfile deletes them so they are never served from the image.
    sourcemap: 'hidden',
    chunkSizeWarningLimit: 2500,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
