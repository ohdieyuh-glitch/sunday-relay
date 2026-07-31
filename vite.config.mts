import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Sunday Relay — independent product build.
 *
 * Relay's canonical document is `index.html`, Vite's normal root entry, so the
 * deployed application loads from `/` with no host-specific rewrite. This
 * repository contains no Sunday Alcatraz application, so there is no second
 * entry and no shared alias into another product's source tree.
 *
 * `relay.html` is also an input, but it is a COMPATIBILITY REDIRECT to `/`,
 * not a second application document — `/relay.html` was the entry before this
 * and must not 404. It carries no markup and no module script, so the two can
 * never drift apart.
 */
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'RELAY_PUBLIC_'],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        relay: fileURLToPath(new URL('./relay.html', import.meta.url)),
      },
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  // The Relay bridge (Prompt Architect + Claude Code coding agent + reviewer)
  // runs as a separate LOCAL server; proxy /relay-api to it so the dev- and
  // preview-served page reaches it same-origin. URL only — no secret here.
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/relay-api': {
        target: `http://localhost:${process.env.RELAY_BRIDGE_PORT ?? 8790}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    proxy: {
      '/relay-api': {
        target: `http://localhost:${process.env.RELAY_BRIDGE_PORT ?? 8790}`,
        changeOrigin: true,
      },
    },
  },
});
