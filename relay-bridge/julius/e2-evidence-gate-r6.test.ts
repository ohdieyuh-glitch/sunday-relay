import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { readEvidenceLines } from './cursor-run-stream-evidence';
import { e2Gate, pinVerifierSpec, type E2VerifierSpec, recordGitDiff, recordVerifierReexec, spawnVerifierRunner } from './e2-evidence-gate';
import { anchorOf } from './e2-test-kit';

/* PILOT 43b93a4e M-8 (git diff isolation) and Skywalker 43b93a4e N3 rule (b) (edit paths vs diff paths), failing-first. */
const KEY = 'SENTINEL-KEY-0123456789-never-print';
const AGENT = 'bc-00000000-0000-4000-8000-000000000001';
const RUN = 'run-00000000-0000-0000-0000-000000000001';
const MODEL = 'grok-code-fast-1';
const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const stream = (...calls: Record<string, unknown>[]): string => ev('status', { runId: RUN, status: 'RUNNING' })
  + calls.map((c, i) => ev('tool_call', { callId: `c${i}`, status: 'completed', ...c }, `171303300${i}000-0`)).join('')
  + ev('result', { runId: RUN, status: 'FINISHED', durationMs: 1 }, '1713033010000-0') + ev('done', {}, '1713033010000-0');

let root = '';
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' };
const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, env: gitEnv }).toString().trim();
function makeRepo(name: string): { repo: string; base: string; head: string } {
  const repo = join(root, name); mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.txt'), Array.from({ length: 40 }, (_, i) => `line ${i}\n`).join(''));
  writeFileSync(join(repo, 'b.txt'), 'b\n');
  writeFileSync(join(repo, 'ok.cjs'), "require('node:test')('ok', () => {});\n"); // R3-2: the verifier script is pinned at base
  git(repo, 'add', '.'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'a');
  const base = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'a.txt'), Array.from({ length: 40 }, (_, i) => (i === 5 || i === 20 ? `changed ${i}\n` : `line ${i}\n`)).join(''));
  writeFileSync(join(repo, 'b.txt'), 'bb\n');
  git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qam', 'b');
  return { repo, base, head: git(repo, 'rev-parse', 'HEAD') };
}
const spec = (r: { repo: string; base: string }): E2VerifierSpec => pinVerifierSpec({ testCommand: 'node ok.cjs', minTests: 1, workspace: r.repo, base: r.base }) as E2VerifierSpec;
beforeAll(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r6-'))); writeFileSync(join(root, 'ok.cjs'), "require('node:test')('ok', () => {});\n"); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe('PILOT 43b93a4e M-8: the diff bytes do not depend on repository config or attributes', () => {
  it('local diff.context, interHunkContext, orderFile, src/dstPrefix and algorithm do not change the recorded diff', async () => {
    const runner = spawnVerifierRunner();
    const clean = makeRepo('clean');
    const d0 = await recordGitDiff({ ...clean, cwd: clean.repo, runner });
    const dirty = makeRepo('dirty');
    writeFileSync(join(dirty.repo, 'order'), 'b.txt\na.txt\n');
    for (const [k, v] of [['diff.context', '10'], ['diff.interHunkContext', '20'], ['diff.orderFile', join(dirty.repo, 'order')], ['diff.srcPrefix', 'SRC/'], ['diff.dstPrefix', 'DST/'], ['diff.algorithm', 'patience'], ['diff.indentHeuristic', 'false']]) git(dirty.repo, 'config', k as string, v as string);
    const d1 = await recordGitDiff({ ...dirty, cwd: dirty.repo, runner });
    expect(d0?.exitCode).toBe(0);
    expect(d1?.exitCode).toBe(0);
    expect(d1?.sha256).toBe(d0?.sha256);
    expect(d1?.argv).toContain('--src-prefix=a/');
    expect(d1?.argv).toContain('-U3');
  });
  it('a non-empty info/attributes is refused as e2_diff_not_isolated (it could mark files binary or -diff)', async () => {
    const runner = spawnVerifierRunner();
    const r = makeRepo('attrs');
    writeFileSync(join(r.repo, '.git', 'info', 'attributes'), 'a.txt -diff\n');
    const d = await recordGitDiff({ ...r, cwd: r.repo, runner });
    expect(d?.isolated).toBe(false);
    const s = await liveCapture('attrs.jsonl', stream({ name: 'edit_file', args: { path: 'a.txt' } }, { name: 'edit_file', args: { path: 'b.txt' } }));
    const verifierSpec = spec(r);
    const reexec = await recordVerifierReexec({ spec: verifierSpec, cwd: r.repo, runner });
    expect(e2Gate({ streamLines: s.lines, anchor: s.anchor, reexec, verifierSpec, diff: d, binding: { runId: RUN, base: r.base, head: r.head, workspace: r.repo }, modelId: MODEL })).toEqual({ ok: false, reasons: ['e2_diff_not_isolated'] });
    const clean = makeRepo('attrs-clean');
    expect((await recordGitDiff({ ...clean, cwd: clean.repo, runner }))?.isolated).toBe(true);
  });
});

async function liveCapture(name: string, sse: string) {
  const orig = globalThis.fetch;
  try {
    globalThis.fetch = (async (_u: unknown, init?: { method?: string }) => (init?.method === 'POST'
      ? new Response(JSON.stringify({ agent: { id: AGENT }, run: { id: RUN } }), { status: 201, headers: { 'content-type': 'application/json' } })
      : new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }))) as typeof fetch;
    vi.resetModules();
    const T = await import('./cursor-cloud-agents-transport');
    const E = await import('./cursor-run-stream-evidence');
    const transport = T.createCursorCloudAgentsTransport({ fetch: T.cursorGlobalFetch, getApiKey: () => KEY });
    const c = await transport.createRun({ idempotencyKey: 'k', agentId: AGENT, name: 'n', promptText: 'p', modelId: MODEL, repoUrl: 'https://github.com/o/r', startingRef: 'a'.repeat(40) });
    if (c.kind !== 'created') throw new Error(c.kind);
    const path = join(root, name);
    const evidence = await E.captureCursorRunStream({ transport, ref: c.ref, sink: E.createFileEvidenceSink(path), deadlineAtMs: Date.now() + 60_000 });
    return { lines: await readEvidenceLines(path), anchor: anchorOf('workflow_output', evidence.finalHash) };
  } finally { globalThis.fetch = orig; vi.resetModules(); }
}

describe('Skywalker N3 rule (b): every edit-call path is in the diff', () => {
  it('passes when the edited paths are in the diff (relative, ./ or absolute under the workspace)', async () => {
    const r = makeRepo('rb-ok');
    const runner = spawnVerifierRunner();
    const verifierSpec = spec(r);
    const p = { verifierSpec, reexec: await recordVerifierReexec({ spec: verifierSpec, cwd: r.repo, runner }), diff: await recordGitDiff({ ...r, cwd: r.repo, runner }), binding: { runId: RUN, base: r.base, head: r.head, workspace: r.repo }, modelId: MODEL };
    expect(p.diff?.paths).toEqual(['a.txt', 'b.txt']);
    const s = await liveCapture('rb-ok.jsonl', stream({ name: 'edit_file', args: { path: 'a.txt' } }, { name: 'write', args: { file_path: './b.txt' } }, { name: 'apply_patch', args: { target_file: join(r.repo, 'a.txt') } }));
    expect(e2Gate({ streamLines: s.lines, anchor: s.anchor, ...p })).toEqual({ ok: true });
  });
  it('an edit to a path the diff does not contain, or an edit call with no recognisable path, is refused', async () => {
    const r = makeRepo('rb-bad');
    const runner = spawnVerifierRunner();
    const verifierSpec = spec(r);
    const p = { verifierSpec, reexec: await recordVerifierReexec({ spec: verifierSpec, cwd: r.repo, runner }), diff: await recordGitDiff({ ...r, cwd: r.repo, runner }), binding: { runId: RUN, base: r.base, head: r.head, workspace: r.repo }, modelId: MODEL };
    const out = await liveCapture('rb-out.jsonl', stream({ name: 'edit_file', args: { path: 'a.txt' } }, { name: 'edit_file', args: { path: 'elsewhere.txt' } }));
    expect(e2Gate({ streamLines: out.lines, anchor: out.anchor, ...p })).toEqual({ ok: false, reasons: ['e2_edit_path_not_in_diff'] });
    const unknown = await liveCapture('rb-unk.jsonl', stream({ name: 'edit_file', args: { path: 'a.txt' } }, { name: 'edit_file', args: { files: ['b.txt'] } }));
    expect(e2Gate({ streamLines: unknown.lines, anchor: unknown.anchor, ...p })).toEqual({ ok: false, reasons: ['e2_edit_path_unknown'] });
    const escape = await liveCapture('rb-esc.jsonl', stream({ name: 'edit_file', args: { path: '../a.txt' } }));
    expect(e2Gate({ streamLines: escape.lines, anchor: escape.anchor, ...p })).toEqual({ ok: false, reasons: ['e2_edit_path_outside_workspace'] }); // round 4 M3: named
    expect(createHash('sha256').update('x').digest('hex')).toHaveLength(64);
  });
});
