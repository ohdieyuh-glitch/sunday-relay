#!/usr/bin/env node
/**
 * Bundle and run the HUD preview entry.
 *
 * esbuild rather than a runtime loader because the entry is TSX importing the
 * real component: the same bundler the rest of this repository already uses for
 * the CLI and the Bridge, pointed at one file. The output is gitignored —
 * `generated/` is derived, and the generator is what is committed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(ROOT, 'generated');
mkdirSync(outDir, { recursive: true });
const bundle = join(outDir, 'wonderland-hud-preview.cjs');

execFileSync(
  join(ROOT, 'node_modules/.bin/esbuild'),
  [
    join(ROOT, 'scripts/wonderland-hud-preview.tsx'),
    '--bundle', '--platform=node', '--format=cjs',
    `--outfile=${bundle}`, '--log-level=warning',
  ],
  { stdio: 'inherit' },
);
try {
  execFileSync(process.execPath, [bundle], {
    stdio: 'inherit',
    env: { ...process.env, WONDERLAND_HUD_PREVIEW_ROOT: ROOT },
  });
} finally {
  rmSync(bundle, { force: true });
}
