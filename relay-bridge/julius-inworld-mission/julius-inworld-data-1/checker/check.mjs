// HIDDEN DETERMINISTIC CHECKER for julius-inworld-data-1. Input: the coder's final message (the artifact) as a string.
// It recomputes the expected document from the seed files with oracle.mjs and compares by deep equality, section by section.
// Pure: no network, no clock, no randomness, no process spawn. Output text names failed SECTIONS only (never the artifact's values).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from './oracle.mjs';

export const MAX_ARTIFACT_CHARS = 8000;
const here = dirname(fileURLToPath(import.meta.url));
const seedData = join(here, '..', 'seed', 'data');

const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};

export function expectedDocument(dataDir = seedData) {
  return normalize(readFileSync(join(dataDir, 'legacy_ledger.csv'), 'utf8'), JSON.parse(readFileSync(join(dataDir, 'posts.json'), 'utf8')));
}

export function checkArtifact(artifactText, dataDir = seedData) {
  const failed = [];
  if (typeof artifactText !== 'string' || artifactText.length === 0) return { pass: false, output: 'artifact_missing', failed: ['artifact'] };
  if (artifactText.length > MAX_ARTIFACT_CHARS) failed.push('artifact_too_long');
  if (artifactText !== artifactText.trim() || artifactText.includes('\n')) failed.push('not_a_single_compact_line');
  let doc;
  try { doc = JSON.parse(artifactText); } catch { return { pass: false, output: 'not_json', failed: ['not_json'] }; }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return { pass: false, output: 'not_an_object', failed: ['not_an_object'] };
  const want = expectedDocument(dataDir);
  const wantKeys = Object.keys(want).sort().join(',');
  if (Object.keys(doc).sort().join(',') !== wantKeys) failed.push('top_level_keys');
  for (const section of ['schema', 'records', 'rejects', 'totals', 'counts']) {
    if (stable(doc[section]) !== stable(want[section])) failed.push(section);
  }
  /* Order matters for records and rejects (the rules sort them), and stable() preserves array order. */
  const pass = failed.length === 0;
  return { pass, output: pass ? 'pass' : `fail:${failed.join(',')}`, failed };
}
