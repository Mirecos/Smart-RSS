import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:8080';

export default defineConfig(({ command }) => ({
  // Relative asset URLs in the build: resolved against the <base href> the server injects, so the
  // same build works at the domain root or under any BASE_PATH (e.g. /smart-rss).
  base: command === 'build' ? './' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@smart-rss/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': API_TARGET, '/feeds': API_TARGET },
  },
}));
