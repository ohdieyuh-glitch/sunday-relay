import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  parseJuliusCarrySources,
  parseJuliusDumpTable,
  previewJuliusCarry,
  verifyJuliusCarryChain,
  type JuliusCarryChainVerdict,
  type JuliusCarryPreview,
  type JuliusCarrySources,
} from '../src/relay/mission/julius/julius-carry-verify';

/**
 * julius-carry-verify <arm-WITHOUT bundle dir> <arm-WITH bundle dir>
 * julius-carry-verify --preview <arm-WITHOUT bundle dir> <arm-WITH run id>
 *
 * THE FOUR-POINT CHAIN, CHECKED OFF-HOST (Decision C, C-7). A reviewer downloads
 * the two arms' evidence bundles and runs this. It reads arm WITHOUT's
 * `carry-sources.json`, holds its bytes to the sha256 WITHOUT's own job recorded
 * in its manifest (`carry_sources_sha256`), and reads arm WITH's
 * `knowledge-carry.tsv`, `carry-copies.tsv` and `tasks.tsv`. The pure verifier
 * then decides (`julius-carry-verify.ts`).
 *
 * THE PREVIEW, BEFORE ARM WITH IS DISPATCHED (SECOND's procedure gate): the same
 * read of arm WITHOUT's bundle, and the WITH run id the registration fixes, give
 * the verified repair findings WITH will carry, each copy's entry id and the
 * digest of its exact text. EMPTY = the pair is INVALID; WITH is not dispatched.
 *
 * ONE JSON VERDICT ON STDOUT. The chain: exit 0 PASS, 1 FAIL (a check failed;
 * the verdict names it). The preview: exit 0 CARRIES, 1 EMPTY. Both: exit 2
 * REFUSED (a bundle or an argument that cannot be read as what it claims to be).
 */

type Refusal = { readonly code: 2; readonly output: { readonly verdict: 'REFUSED'; readonly problem: string } };

export type JuliusCarryVerifyResult = { readonly code: 0 | 1; readonly output: JuliusCarryChainVerdict } | Refusal;
export type JuliusCarryPreviewResult = { readonly code: 0 | 1; readonly output: JuliusCarryPreview } | Refusal;

const refused = (problem: string): Refusal => ({ code: 2, output: { verdict: 'REFUSED', problem } });

/** A Julius run id, as the bootstrap derives it (`run:` + 24 hex): a mistyped one would preview another run's carry. */
const RUN_ID_SHAPE = /^run:[0-9a-f]{24}$/u;

/** WITH's plan task, the scope of every copy: the bootstrap's own `planTaskId` (relay-bridge/julius/bootstrap.ts:74). */
export const juliusCarryScopeTaskId = (withRunId: string): string => `${withRunId}:plan`;

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** `bundle-manifest.txt`: one `key=value` per line, as the dump writes it. */
function manifestOf(text: string): Readonly<Record<string, string>> {
  const entries = text.split('\n').map((line) => line.replace(/\r$/u, '')).filter((line) => line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)] as const);
  return Object.fromEntries(entries);
}

const bytesOf = (dir: string, file: string): Buffer | null => {
  const path = join(dir, file);
  return existsSync(path) ? readFileSync(path) : null;
};

/** (1) WHAT ARM WITHOUT WROTE: the export, the bytes its own job recorded, naming the run its manifest names. */
function readWithout(withoutDir: string): { readonly sources: JuliusCarrySources } | Refusal {
  const manifestBytes = bytesOf(withoutDir, 'bundle-manifest.txt');
  if (manifestBytes === null) return refused('without_manifest_missing');
  const manifest = manifestOf(manifestBytes.toString('utf8'));
  const sourcesBytes = bytesOf(withoutDir, 'carry-sources.json');
  if (sourcesBytes === null) return refused('without_sources_missing');
  const recorded = manifest.carry_sources_sha256;
  if (recorded === undefined || recorded === '') return refused('without_sources_digest_unrecorded');
  if (createHash('sha256').update(sourcesBytes).digest('hex') !== recorded) return refused('without_sources_digest_mismatch');
  const sources = parseJuliusCarrySources(sourcesBytes.toString('utf8'));
  if (!sources.ok) return refused(`without_${sources.problem}`);
  if (sources.value.runId !== manifest.julius_run_id) return refused('without_sources_run_mismatch: the export names another run than its manifest');
  return { sources: sources.value };
}

export function runJuliusCarryVerify(input: { readonly withoutDir: string; readonly withDir: string; readonly limit: number }): JuliusCarryVerifyResult {
  if (bytesOf(input.withoutDir, 'bundle-manifest.txt') === null) return refused('without_manifest_missing');
  const withManifestBytes = bytesOf(input.withDir, 'bundle-manifest.txt');
  if (withManifestBytes === null) return refused('with_manifest_missing');
  const without = readWithout(input.withoutDir);
  if ('code' in without) return without;
  const withManifest = manifestOf(withManifestBytes.toString('utf8'));

  // (2)-(4) WHAT ARM WITH CARRIED, HOLDS AND WAS HANDED: its own run, its record, its copies, its tasks.
  const withRunId = withManifest.julius_run_id;
  if (withRunId === undefined || withRunId === '' || withRunId === 'none') return refused('with_run_unnamed');
  const tables: Record<string, readonly Readonly<Record<string, string>>[]> = {};
  for (const file of ['knowledge-carry.tsv', 'carry-copies.tsv', 'tasks.tsv']) {
    const text = bytesOf(input.withDir, file);
    if (text === null) return refused(`with_table_missing: ${file}`);
    const table = parseJuliusDumpTable(text.toString('utf8'));
    if (!table.ok) return refused(`with_${file}: ${table.problem}`);
    tables[file] = table.value;
  }
  const verdict = verifyJuliusCarryChain({
    sources: without.sources, withRunId,
    knowledge: tables['knowledge-carry.tsv']!, copies: tables['carry-copies.tsv']!, tasks: tables['tasks.tsv']!,
    limit: input.limit, sha256,
  });
  return { code: verdict.verdict === 'PASS' ? 0 : 1, output: verdict };
}

export type JuliusCarryVerifyCommand =
  | { readonly mode: 'chain'; readonly withoutDir: string; readonly withDir: string }
  | { readonly mode: 'preview'; readonly withoutDir: string; readonly withRunId: string };

/** Exactly these arguments, or none: an extra, a missing or an unknown flag is a usage refusal, never a guess. */
export function juliusCarryVerifyCommandOf(args: readonly string[]): JuliusCarryVerifyCommand | null {
  if (args.length === 3 && args[0] === '--preview') return { mode: 'preview', withoutDir: args[1]!, withRunId: args[2]! };
  if (args.length === 2 && !args.some((arg) => arg.startsWith('-'))) return { mode: 'chain', withoutDir: args[0]!, withDir: args[1]! };
  return null;
}

export function runJuliusCarryPreview(input: { readonly withoutDir: string; readonly withRunId: string; readonly limit: number }): JuliusCarryPreviewResult {
  if (!RUN_ID_SHAPE.test(input.withRunId)) return refused(`with_run_invalid: '${input.withRunId}' is not a Julius run id`);
  const without = readWithout(input.withoutDir);
  if ('code' in without) return without;
  if (without.sources.runId === input.withRunId) return refused('with_run_is_without: an arm cannot inherit from itself');
  const preview = previewJuliusCarry({
    sources: without.sources, withRunId: input.withRunId, scopeTaskId: juliusCarryScopeTaskId(input.withRunId),
    limit: input.limit, sha256,
  });
  return { code: preview.verdict === 'CARRIES' ? 0 : 1, output: preview };
}
