/* Shared fixtures for the round-4 E2 tests (no provider calls: the global fetch is replaced, the documented M-5 residual). */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { vi } from 'vitest';

import { readEvidenceLines } from './cursor-run-stream-evidence';
import * as KG from './e2-evidence-gate';
import { buildTrustedSeedStore } from './e2-safe-git';
import { externalAnchor, type E2ExternalAnchorSource, type ExternalAnchor } from './e2-external-anchor';

export const KEY = 'SENTINEL-KEY-0123456789-never-print';
export const AGENT = 'bc-00000000-0000-4000-8000-000000000001';
export const RUN = 'run-00000000-0000-0000-0000-000000000001';
export const MODEL = 'grok-code-fast-1';
export const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
let n = 0;
export const call = (id: string, name: string, args: unknown = { path: 'a.txt' }): string => { n += 1; return ev('tool_call', { callId: id, name, status: 'completed', args }, `17130330020${String(n).padStart(2, '0')}-0`); };
export const tail = (status = 'FINISHED'): string => ev('result', { runId: RUN, status, durationMs: 10 }, '1713033010000-0') + ev('done', {}, '1713033010000-0');
export const START = ev('status', { runId: RUN, status: 'RUNNING' });
export const GOOD = (): string => START + call('c1', 'edit_file') + tail();

export const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }).toString().trim();
/** A repo whose base commit holds `baseFiles` and whose head commit applies `headFiles` on top. */
export function makeRepo(repo: string, baseFiles: Record<string, string>, headFiles: Record<string, string>, write: (p: string, c: string) => void): { base: string; head: string } {
  git(repo, 'init', '-q');
  for (const [p, c] of Object.entries(baseFiles)) write(join(repo, p), c);
  git(repo, 'add', '-A'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  for (const [p, c] of Object.entries(headFiles)) write(join(repo, p), c);
  git(repo, 'add', '-A'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'head', '--allow-empty');
  return { base, head: git(repo, 'rev-parse', 'HEAD') };
}

/** created=true: the transport creates the run (POST) before streaming. */
export async function liveCapture(dir: string, name: string, sse: string, opts: { created?: boolean; modelId?: string } = {}) {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = (async (_u: unknown, init?: { method?: string }) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ agent: { id: AGENT }, run: { id: RUN } }), { status: 201, headers: { 'content-type': 'application/json' } });
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }) as typeof fetch;
    vi.resetModules();
    const T = await import('./cursor-cloud-agents-transport');
    const E = await import('./cursor-run-stream-evidence');
    const transport = T.createCursorCloudAgentsTransport({ fetch: T.cursorGlobalFetch, getApiKey: () => KEY });
    let ref = { agentId: AGENT, runId: RUN };
    if (opts.created !== false) {
      const c = await transport.createRun({ idempotencyKey: 'k', agentId: AGENT, name: 'n', promptText: 'p', modelId: opts.modelId ?? MODEL, repoUrl: 'https://github.com/o/r', startingRef: 'a'.repeat(40) });
      if (c.kind !== 'created') throw new Error(`createRun: ${c.kind}`);
      ref = c.ref;
    }
    const path = join(dir, name);
    const evidence = await E.captureCursorRunStream({ transport, ref, sink: E.createFileEvidenceSink(path), deadlineAtMs: Date.now() + 60_000 });
    return { lines: await readEvidenceLines(path), evidence };
  } finally { globalThis.fetch = orig; vi.resetModules(); }
}
/** Rewrites records and recomputes every hash, seq, prev, fileSha256 and record count (a full re-chain). */
export function rechain(lines: readonly string[], edit: (r: Record<string, unknown>) => boolean | void): string[] {
  const out: string[] = []; let prev = '0'.repeat(64); const file = createHash('sha256');
  const kept = lines.map((l) => { const { hash: _h, ...rest } = JSON.parse(l) as Record<string, unknown>; return rest; }).filter((r) => edit(r) !== false);
  for (const [i, rest] of kept.entries()) {
    rest.seq = i; rest.prev = prev;
    if (rest.kind === 'final') { rest.fileSha256 = file.copy().digest('hex'); rest.records = kept.length; }
    const hash = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    const l = JSON.stringify({ ...rest, hash }); out.push(l); file.update(`${l}\n`); prev = hash;
  }
  return out;
}

/** Round 5 R4-2: tests build anchors through the injected-source constructor. */
export const anchorOf = (source: E2ExternalAnchorSource, hash: string): ExternalAnchor => externalAnchor(() => ({ source, hash }));

/**
 * Round 10 (trusted seed store): test helpers for the many fixtures that commit base and head with plain git. storeFor
 * builds (once per repo+base) the trusted store from the repo; headObjectDir copies the head ^base objects into a fresh
 * 0700 loose-object dir, so the fixture's head SHA is unchanged and the diff reads only store + that dir. A fixture whose
 * base or head is unreadable gets no store/dir (the call then behaves as before and the gate refuses).
 */
const STORES = new Map<string, string | undefined>();
export function storeFor(repo: string, base: string): string | undefined {
  const k = `${repo}\0${base}`;
  if (!STORES.has(k)) { const s = buildTrustedSeedStore({ seed: repo, base }); STORES.set(k, 'refused' in s ? undefined : s.objects); }
  return STORES.get(k);
}
export function headObjectDir(repo: string, base: string, head: string): string | undefined {
  try {
    const ids = execFileSync('git', ['rev-list', '--objects', '--no-object-names', head, `^${base}`], { cwd: repo }).toString().split('\n').filter((x) => x !== '');
    const dir = realpathSync(mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'e2-kit-objdir-'))); chmodSync(dir, 0o700);
    const out = execFileSync('git', ['cat-file', '--batch'], { cwd: repo, input: ids.join('\n') + '\n', maxBuffer: 1 << 30 });
    let at = 0;
    while (at < out.length) {
      const nl = out.indexOf(10, at); const [oid, type, size] = out.subarray(at, nl).toString().split(' ');
      const n = Number(size); const data = out.subarray(nl + 1, nl + 1 + n); at = nl + 2 + n;
      mkdirSync(join(dir, (oid as string).slice(0, 2)), { recursive: true });
      writeFileSync(join(dir, (oid as string).slice(0, 2), (oid as string).slice(2)), deflateSync(Buffer.concat([Buffer.from(`${type} ${n}\0`), data])));
    }
    return dir;
  } catch { return undefined; }
}
/** recordGitDiff through the trusted path (store from the repo at base + head objects in a throwaway dir). */
export function recordGitDiffT(input: Parameters<typeof KG.recordGitDiff>[0]): ReturnType<typeof KG.recordGitDiff> {
  const tr = storeFor(input.cwd, input.base); const od = tr === undefined ? undefined : headObjectDir(input.cwd, input.base, input.head);
  return KG.recordGitDiff({ ...input, ...(tr !== undefined && od !== undefined ? { trustedObjects: tr, objectDir: od } : {}) });
}
/** pinVerifierSpecWithBaseRun / pinVerifierSpec with the trusted store of the workspace at base. */
export function pinT(input: KG.E2MissionVerifierInput, runner: KG.VerifierRunner): ReturnType<typeof KG.pinVerifierSpecWithBaseRun> {
  const tr = typeof input?.workspace === 'string' && typeof input.base === 'string' && /^[0-9a-f]{40}$/u.test(input.base) ? storeFor(input.workspace, input.base) : undefined;
  return KG.pinVerifierSpecWithBaseRun({ ...input, ...(tr === undefined ? {} : { trustedObjects: tr }) }, runner);
}
