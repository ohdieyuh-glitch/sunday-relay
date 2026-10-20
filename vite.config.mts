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
  test: {
    /**
     * THE MISSION SEEDS ARE NOT THIS REPOSITORY'S TESTS.
     *
     * Each bounded live mission seeds a throwaway workspace containing a
     * DELIBERATELY FAILING stub test — that is the point: a stub that passed
     * would let a paid mission satisfy its TEST evidence having implemented
     * nothing. Those files became real files on disk when missions moved out of
     * the provisioning script's heredocs, and vitest's default discovery
     * promptly adopted them and failed the suite.
     *
     * They are executed deliberately, by `julius-first-live-mission.test.ts`,
     * which asserts they FAIL. Nothing else should run them.
     */
    exclude: ['**/node_modules/**', '**/dist/**', '.github/julius-missions/**'],
  },
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
