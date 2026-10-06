import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseJuliusCarrySources,
  parseJuliusDumpTable,
  verifyJuliusCarryChain,
  type JuliusCarryChainVerdict,
} from '../src/relay/mission/julius/julius-carry-verify';

/**
 * julius-carry-verify <arm-WITHOUT bundle dir> <arm-WITH bundle dir>
 *
 * THE FOUR-POINT CHAIN, CHECKED OFF-HOST (Decision C, C-7). A reviewer downloads
 * the two arms' evidence bundles and runs this. It reads arm WITHOUT's
 * `carry-sources.json`, holds its bytes to the sha256 WITHOUT's own job recorded
 * in its manifest (`carry_sources_sha256`), and reads arm WITH's
 * `knowledge-carry.tsv`, `carry-copies.tsv` and `tasks.tsv`. The pure verifier
 * then decides (`julius-carry-verify.ts`).
 *
 * ONE JSON VERDICT ON STDOUT. Exit 0 PASS, 1 FAIL (a check failed; the verdict
 * names it), 2 REFUSED (a bundle that cannot be read as what it claims to be).
 */

export type JuliusCarryVerifyResult =
  | { readonly code: 0 | 1; readonly output: JuliusCarryChainVerdict }
  | { readonly code: 2; readonly output: { readonly verdict: 'REFUSED'; readonly problem: string } };

const refused = (problem: string): JuliusCarryVerifyResult => ({ code: 2, output: { verdict: 'REFUSED', problem } });

/** `bundle-manifest.txt`: one `key=value` per line, as the dump writes it. */
function manifestOf(text: string): Readonly<Record<string, string>> {
  const entries = text.split('\n').map((line) => line.replace(/\r$/u, '')).filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)] as const);
  return Object.fromEntries(entries);
}

export function runJuliusCarryVerify(input: { readonly withoutDir: string; readonly withDir: string; readonly limit: number }): JuliusCarryVerifyResult {
  const bytes = (dir: string, file: string): Buffer | null => {
    const path = join(dir, file);
    return existsSync(path) ? readFileSync(path) : null;
  };
  const withoutManifestBytes = bytes(input.withoutDir, 'bundle-manifest.txt');
  const withManifestBytes = bytes(input.withDir, 'bundle-manifest.txt');
  if (withoutManifestBytes === null) return refused('without_manifest_missing');
  if (withManifestBytes === null) return refused('with_manifest_missing');
  const withoutManifest = manifestOf(withoutManifestBytes.toString('utf8'));
  const withManifest = manifestOf(withManifestBytes.toString('utf8'));

  // (1) WHAT ARM WITHOUT WROTE: the export, the bytes its own job recorded, naming the run its manifest names.
  const sourcesBytes = bytes(input.withoutDir, 'carry-sources.json');
  if (sourcesBytes === null) return refused('without_sources_missing');
  const recorded = withoutManifest.carry_sources_sha256;
  if (recorded === undefined || recorded === '') return refused('without_sources_digest_unrecorded');
  if (createHash('sha256').update(sourcesBytes).digest('hex') !== recorded) return refused('without_sources_digest_mismatch');
  const sources = parseJuliusCarrySources(sourcesBytes.toString('utf8'));
  if (!sources.ok) return refused(`without_${sources.problem}`);
  if (sources.value.runId !== withoutManifest.julius_run_id) return refused('without_sources_run_mismatch: the export names another run than its manifest');

  // (2)-(4) WHAT ARM WITH CARRIED, HOLDS AND WAS HANDED: its own run, its record, its copies, its tasks.
  const withRunId = withManifest.julius_run_id;
  if (withRunId === undefined || withRunId === '' || withRunId === 'none') return refused('with_run_unnamed');
  const tables: Record<string, readonly Readonly<Record<string, string>>[]> = {};
  for (const file of ['knowledge-carry.tsv', 'carry-copies.tsv', 'tasks.tsv']) {
    const text = bytes(input.withDir, file);
    if (text === null) return refused(`with_table_missing: ${file}`);
    const table = parseJuliusDumpTable(text.toString('utf8'));
    if (!table.ok) return refused(`with_${file}: ${table.problem}`);
    tables[file] = table.value;
  }
  const verdict = verifyJuliusCarryChain({
    sources: sources.value, withRunId,
    knowledge: tables['knowledge-carry.tsv']!, copies: tables['carry-copies.tsv']!, tasks: tables['tasks.tsv']!,
    limit: input.limit,
    sha256: (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
  });
  return { code: verdict.verdict === 'PASS' ? 0 : 1, output: verdict };
}
