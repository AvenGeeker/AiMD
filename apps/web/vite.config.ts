import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The web bundle is served two ways:
 *  - by the Fastify server in production (`WEB_DIST_DIR`), same origin as the API
 *  - by the Electron shell, loaded from `file://` and pointed at a remote server
 *
 * `base: './'` makes every asset path relative so the same `dist/` works under both.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    /**
     * Sourcemaps are opt-in (`VITE_SOURCEMAPS=1`).
     *
     * They are ~32MB of the 46MB bundle — mostly mermaid and shiki — so shipping them by default
     * inflates every installer and hands out readable source. Turn them on when debugging a
     * production report.
     */
    sourcemap: process.env.VITE_SOURCEMAPS === '1',
    // mermaid and shiki are large; split the heavy vendors so the initial paint does not wait
    // on them. Vite 8's rollup types only accept the function form of `manualChunks`.
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('mermaid')) return 'mermaid';
          if (id.includes('shiki') || id.includes('@shikijs')) return 'shiki';
          if (id.includes('katex')) return 'katex';
          if (id.includes('@codemirror') || id.includes('/codemirror/') || id.includes('@lezer')) {
            return 'codemirror';
          }
          if (id.includes('react')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: {
    /**
     * Bind IPv4 explicitly.
     *
     * The default `localhost` resolves to `::1` on macOS, so the dev server listens on IPv6 only
     * and `http://127.0.0.1:5173` refuses connections — which also makes the desktop shell's
     * dev-server probe silently fall back to a stale staged bundle instead of hot reloading.
     */
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // Dev convenience: the Vite server forwards API calls to the local Fastify app.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/collab': { target: 'ws://127.0.0.1:1234', ws: true },
    },
  },
});
