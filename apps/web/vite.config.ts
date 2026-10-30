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
    sourcemap: true,
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
    port: 5173,
    proxy: {
      // Dev convenience: the Vite server forwards API calls to the local Fastify app.
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/collab': { target: 'ws://127.0.0.1:1234', ws: true },
    },
  },
});
