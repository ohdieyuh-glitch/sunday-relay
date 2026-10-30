/* Shared fixtures for the round-4 E2 tests (no provider calls: the global fetch is replaced, the documented M-5 residual). */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { vi } from 'vitest';

import { readEvidenceLines } from './cursor-run-stream-evidence';

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
