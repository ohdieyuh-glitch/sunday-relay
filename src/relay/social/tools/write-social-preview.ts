/**
 * Writes wonderland/UiArt/Social/social-preview.json and social-preview-party.json (the viewer in a party) from the real
 * social domain (see social-preview.ts).
 *
 *   node_modules/.bin/esbuild src/relay/social/tools/write-social-preview.ts --bundle --platform=node --format=esm \
 *     --outfile=<scratch>/write-social-preview.mjs && node <scratch>/write-social-preview.mjs <repo root>
 *
 * Deterministic: the same domain gives the same bytes; social-preview.test.ts holds the committed file to that.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSocialPartyPreview, buildSocialPreview, serializeSocialPreview } from '../social-preview';

const root = process.argv[2];
if (!root) throw new Error('usage: write-social-preview.mjs <repo root>');
for (const [file, snapshot] of [['social-preview.json', buildSocialPreview()], ['social-preview-party.json', buildSocialPartyPreview()]] as const) {
  const target = join(root, 'wonderland', 'UiArt', 'Social', file);
  mkdirSync(dirname(target), { recursive: true });
  const text = serializeSocialPreview(snapshot);
  writeFileSync(target, text, 'utf8');
  console.log(`wrote ${target} (${text.length} bytes)`);
}
