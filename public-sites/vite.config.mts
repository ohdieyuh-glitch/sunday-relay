import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * PUBLIC SITES — one config, two independent static sites.
 *
 * `PUBLIC_SITE=iwonder` or `PUBLIC_SITE=wonderland` selects the root. Each
 * site builds to its own directory with relative asset URLs, so the output is
 * portable to any static host (or a sub-path of one) without a rebuild.
 *
 * This is deliberately NOT an input of the product's `vite.config.mts`: the
 * product build, its boundary scanners and its bundle checks are unchanged by
 * anything in this directory.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const SITES = {
  iwonder: { port: 4311 },
  wonderland: { port: 4312 },
} as const;

type SiteId = keyof typeof SITES;

function siteId(): SiteId {
  const raw = process.env.PUBLIC_SITE ?? 'iwonder';
  if (raw !== 'iwonder' && raw !== 'wonderland') {
    throw new Error(`PUBLIC_SITE must be "iwonder" or "wonderland", got "${raw}"`);
  }
  return raw;
}

const withSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`);

/**
 * Cross-site URLs are build inputs, never hard-coded twice. A review build can
 * point both sites at their local previews; a production build takes the
 * defaults. Every placeholder must resolve — an unreplaced `%…%` in shipped
 * HTML is a broken link, so the transform fails the build instead.
 */
function siteUrls(): Plugin {
  const values: Record<string, string> = {
    IWONDER_URL: withSlash(process.env.PUBLIC_SITE_IWONDER_URL ?? 'https://aquala-technologies.ohdieyuh.chatgpt.site/'),
    WONDERLAND_URL: withSlash(process.env.PUBLIC_SITE_WONDERLAND_URL ?? 'https://relayaquala.tech/'),
    APP_URL: withSlash(process.env.PUBLIC_SITE_APP_URL ?? 'https://sunday-relay.vercel.app/'),
  };
  return {
    name: 'public-site-urls',
    transformIndexHtml(html) {
      const out = html.replace(/%(IWONDER_URL|WONDERLAND_URL|APP_URL)%/g, (_, key: string) => values[key]);
      const leftover = out.match(/%[A-Z_]+_URL%/);
      if (leftover) throw new Error(`Unresolved URL placeholder ${leftover[0]}`);
      return out;
    },
  };
}

export default defineConfig(() => {
  const site = siteId();
  const { port } = SITES[site];
  /**
   * ARTIFACT MODE (`PUBLIC_SITE_ARTIFACT=1`) — one JS file and one CSS file
   * with every font inlined, for review hosts that serve a single sandboxed
   * page. A real deployment never uses it: it defeats caching and lazy loading.
   */
  const artifact = process.env.PUBLIC_SITE_ARTIFACT === '1';
  return {
    root: resolve(here, site),
    publicDir: resolve(here, site, 'public'),
    base: './',
    plugins: [siteUrls()],
    build: artifact
      ? {
          outDir: resolve(here, 'dist', `artifact-${site}`),
          emptyOutDir: true,
          target: 'es2020',
          assetsInlineLimit: 100_000_000,
          modulePreload: false,
          cssCodeSplit: false,
          rollupOptions: { output: { inlineDynamicImports: true } },
        }
      : {
          outDir: resolve(here, 'dist', site),
          emptyOutDir: true,
          target: 'es2020',
          // Fonts and images stay files: inlining a 130KB font into CSS defeats
          // the preload and the browser cache.
          assetsInlineLimit: 0,
          rollupOptions: {
            output: { manualChunks: { three: ['three'] } },
          },
        },
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      // The canonical Relay Dog modules live under src/; they are imported,
      // not copied, so the dev server must be allowed to read them.
      fs: { allow: [repoRoot] },
    },
    preview: { host: '127.0.0.1', port, strictPort: true },
  };
});
