import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createCursorCloudAgentsTransport, type CursorFetch } from './cursor-cloud-agents-transport';
import { captureCursorRunStream, createFileEvidenceSink, readEvidenceLines, verifyEvidenceChain } from './cursor-run-stream-evidence';
import { E2_FAKE_LABEL, e2Gate, externalAnchor, pinVerifierSpec, type E2VerifierSpec, recordGitDiff, recordVerifierReexec, spawnVerifierRunner, type E2DiffEvidence, type E2ReexecEvidence } from './e2-evidence-gate';

/*
 * PILOT review of 0774db05, gate findings (H-3, H-4, M-7, M-8, L-4), written failing-first. The live-labelled capture uses
 * the documented M-5 residual: a global fetch replaced BEFORE the transport module is imported is indistinguishable from
 * the real one in-process, so the test can drive a live-labelled capture with no network.
 */

const sha = (b: string | Uint8Array): string => createHash('sha256').update(b).digest('hex');
const NODE = process.execPath;

/* 43b93a4e N-3: the runner refuses `node -e`; inline verifier code is written to a script file (argv shifted to match -e). */
/* R3-2: a verifier script must live in the workspace, so the scripts are written under the repo (untracked). */
const js = (code: string): string => {
  mkdirSync(join(repo, '.e2js'), { recursive: true });
  const f = join(repo, '.e2js', `${createHash('sha256').update(code).digest('hex').slice(0, 16)}.cjs`);
  writeFileSync(f, `process.argv.splice(1, 1);\n${code}\n`);
  return f;
};
const KEY = 'SENTINEL-KEY-0123456789-never-print';
const REF = { agentId: 'bc-00000000-0000-4000-8000-000000000001', runId: 'run-00000000-0000-0000-0000-000000000001' };
const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const SSE = [
  ev('status', { runId: REF.runId, status: 'RUNNING' }),
  ev('tool_call', { callId: 'c1', name: 'edit_file', status: 'completed', args: { path: 'a.txt' } }, '1713033002000-0'),
  ev('result', { runId: REF.runId, status: 'FINISHED', durationMs: 10 }, '1713033010000-0'),
  ev('done', {}, '1713033010000-0'),
].join('');

let root = '';
let repo = '';
let base = '';
let head = '';
const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }).toString().trim();
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2pilot-')));
  repo = join(root, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  writeFileSync(join(repo, 'ok.cjs'), 'process.exit(0)\n'); // R3-2: the verifier script is pinned at base
  writeFileSync(join(repo, 'old name.txt'), 'line\n'.repeat(20));
  git(repo, 'add', '.'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'a');
  base = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  git(repo, 'mv', 'old name.txt', 'n\u00e9w name.txt');
  git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qam', 'b');
  head = git(repo, 'rev-parse', 'HEAD');
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

async function liveCapture(name: string) {
  const orig = globalThis.fetch;
  try {
    /* 43b93a4e M-2: the transport must create the run itself (POST) for the gate to accept the start. */
    globalThis.fetch = (async (_u: unknown, init?: { method?: string }) => (init?.method === 'POST'
      ? new Response(JSON.stringify({ agent: { id: REF.agentId }, run: { id: REF.runId } }), { status: 201, headers: { 'content-type': 'application/json' } })
      : new Response(SSE, { status: 200, headers: { 'content-type': 'text/event-stream' } }))) as typeof fetch;
    vi.resetModules();
    const T = await import('./cursor-cloud-agents-transport');
    const E = await import('./cursor-run-stream-evidence');
    const transport = T.createCursorCloudAgentsTransport({ fetch: T.cursorGlobalFetch, getApiKey: () => KEY });
    const c = await transport.createRun({ idempotencyKey: 'k', agentId: REF.agentId, name: 'n', promptText: 'p', modelId: 'grok-code-fast-1', repoUrl: 'https://github.com/o/r', startingRef: 'a'.repeat(40) });
    if (c.kind !== 'created') throw new Error(c.kind);
    const path = join(root, name);
    const evidence = await E.captureCursorRunStream({ transport, ref: c.ref, sink: E.createFileEvidenceSink(path), deadlineAtMs: Date.now() + 60_000 });
    return { path, evidence };
  } finally { globalThis.fetch = orig; vi.resetModules(); }
}
async function fakeCapture(name: string) {
  const f: CursorFetch = async () => ({ ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, body: new Response(SSE).body, text: async () => '' });
  const path = join(root, name);
  const evidence = await captureCursorRunStream({ transport: createCursorCloudAgentsTransport({ fetch: f, getApiKey: () => KEY }), ref: REF, sink: createFileEvidenceSink(path), deadlineAtMs: Date.now() + 60_000 });
  return { path, evidence };
}
/** Rewrites one record and recomputes every hash and the final fileSha256: a chain that verifies but is not the capture. */
function rechain(lines: readonly string[], edit: (r: Record<string, unknown>, i: number) => void): string[] {
  const out: string[] = [];
  let prev = '0'.repeat(64);
  const file = createHash('sha256');
  lines.forEach((line, i) => {
    const { hash: _h, ...rest } = JSON.parse(line) as Record<string, unknown>;
    edit(rest, i);
    rest.prev = prev;
    if (rest.kind === 'final') rest.fileSha256 = file.copy().digest('hex');
    const hash = sha(JSON.stringify(rest));
    const l = JSON.stringify({ ...rest, hash });
    out.push(l);
    file.update(`${l}\n`);
    prev = hash;
  });
  return out;
}
async function parts() {
  const runner = spawnVerifierRunner({ timeoutMs: 30_000 });
  const verifierSpec = pinVerifierSpec({ testCommand: 'node ok.cjs', workspace: repo, base }) as E2VerifierSpec;
  const reexec = await recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner });
  const diff = await recordGitDiff({ base, head, cwd: repo, runner });
  return { runner, verifierSpec, reexec, diff, binding: { runId: REF.runId, base, head, workspace: repo }, modelId: 'grok-code-fast-1' };
}
const reasons = (r: ReturnType<typeof e2Gate>): readonly string[] => (r.ok ? [] : r.reasons);

describe('PILOT 0774db05 H-3: the gate verifies the evidence FILE against an anchor from outside the writer', () => {
  it('(a) file-only: an untouched live-labelled capture read back from disk passes with its anchored final hash', async () => {
    const { path, evidence } = await liveCapture('a.jsonl');
    expect(evidence.cause).toBeNull();
    expect(evidence.mode).toBe('live');
    const streamLines = await readEvidenceLines(path);
    const p = await parts();
    expect(e2Gate({ streamLines, anchor: externalAnchor('workflow_output', evidence.finalHash), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding })).toEqual({ ok: true });
    /* The same file from a fake transport is refused only for being fake: chain and anchor still verify. */
    const f = await fakeCapture('a-fake.jsonl');
    expect(reasons(e2Gate({ streamLines: await readEvidenceLines(f.path), anchor: externalAnchor('workflow_output', f.evidence.finalHash), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding }))).toEqual(['e2_stream_not_live', 'e2_stream_mid_run_start', 'e2_model_unbound']); // 43b93a4e: the fake capture used a literal ref
  });
  it('(b) one record edited with every hash recomputed verifies as a chain but is refused: anchor mismatch', async () => {
    const { path, evidence } = await liveCapture('b.jsonl');
    const lines = await readEvidenceLines(path);
    const forged = rechain(lines, (r) => { if (r.kind === 'event' && r.event === 'tool_call') r.data = JSON.stringify({ callId: 'c1', name: 'read_file', status: 'completed' }); });
    expect(verifyEvidenceChain(forged).ok).toBe(true);
    const p = await parts();
    expect(reasons(e2Gate({ streamLines: forged, anchor: externalAnchor('workflow_output', evidence.finalHash), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding }))).toEqual(['e2_anchor_mismatch', 'e2_no_edit_calls']); // 43b93a4e N3: the forgery leaves only a read call
    /* An edit without recomputing breaks the chain. */
    const broken = [...lines]; const at = broken.findIndex((l) => l.includes('edit_file')); broken[at] = (broken[at] as string).replace('edit_file', 'read_file');
    expect(reasons(e2Gate({ streamLines: broken, anchor: externalAnchor('workflow_output', evidence.finalHash), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding }))).toContain('e2_stream_chain_invalid');
  });
  it('(c) no anchor, or an empty one, is refused', async () => {
    const { path } = await liveCapture('c.jsonl');
    const streamLines = await readEvidenceLines(path);
    const p = await parts();
    for (const anchor of [undefined, null, externalAnchor('workflow_output', '')]) {
      expect(reasons(e2Gate({ streamLines, anchor, reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding } as Parameters<typeof e2Gate>[0]))).toEqual(['e2_anchor_absent']);
    }
    expect(reasons(e2Gate({ streamLines: [], anchor: externalAnchor('workflow_output', 'a'.repeat(64)), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding }))).toContain('e2_stream_chain_invalid');
  });
  it('hand-made or copied re-exec and diff objects are refused (module-private registry, no setter)', async () => {
    const { path, evidence } = await liveCapture('d.jsonl');
    const streamLines = await readEvidenceLines(path);
    const p = await parts();
    const handReexec = { label: 'julius_observed', cwd: repo, commands: [{ argv: ['x'], exitCode: 0, stdoutSha256: '', stderrSha256: '', stdoutBytes: 0, stderrBytes: 0, startedAt: '', endedAt: '' }] } as unknown as E2ReexecEvidence;
    const handDiff = { ...p.diff } as E2DiffEvidence;
    const g = { streamLines, anchor: externalAnchor('workflow_output', evidence.finalHash), modelId: p.modelId, binding: p.binding, verifierSpec: p.verifierSpec };
    expect(reasons(e2Gate({ ...g, reexec: handReexec, diff: p.diff }))).toEqual(['e2_reexec_forged']);
    expect(reasons(e2Gate({ ...g, reexec: { ...p.reexec! }, diff: p.diff }))).toEqual(['e2_reexec_forged']);
    expect(reasons(e2Gate({ ...g, reexec: p.reexec, verifierSpec: p.verifierSpec, diff: handDiff }))).toEqual(['e2_diff_forged']);
  });
  it('a failed, unfinished or non-FINISHED capture in the file is refused even with the right anchor', async () => {
    const { path, evidence } = await liveCapture('e.jsonl');
    const lines = await readEvidenceLines(path);
    const p = await parts();
    const g = { reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding };
    const forged = rechain(lines, (r) => { if (r.kind === 'final') r.cause = 'e2_stream_gap'; });
    const anchor = externalAnchor('ledger_hash', (verifyEvidenceChain(forged) as { finalHash: string }).finalHash);
    expect(reasons(e2Gate({ ...g, streamLines: forged, anchor }))).toEqual(['e2_stream_failed']);
    /* Mutation R7/R8: the gate reads unfinishedCalls and toolCallCount from the final record itself; since 43b93a4e N-1 it
       also recounts them from the events, so a final record that disagrees is e2_final_record_mismatch as well. */
    for (const [edit, want] of [[(r: Record<string, unknown>) => { r.unfinishedCalls = 1; }, 'e2_stream_call_unfinished'], [(r: Record<string, unknown>) => { r.toolCallCount = 0; }, 'e2_no_tool_calls']] as const) {
      const f = rechain(lines, (r) => { if (r.kind === 'final') edit(r); });
      expect(reasons(e2Gate({ ...g, streamLines: f, anchor: externalAnchor('ledger_hash', (verifyEvidenceChain(f) as { finalHash: string }).finalHash) }))).toEqual([want, 'e2_final_record_mismatch']);
    }
    expect(evidence.cause).toBeNull();
  });
});

describe('Skywalker 0774db05 F8: tampering with the FINAL record is refused by the file-only verifier', () => {
  it('editing the final record breaks the chain; recomputing its hash breaks the anchor', async () => {
    const { path, evidence } = await liveCapture('final.jsonl');
    const lines = await readEvidenceLines(path);
    const p = await parts();
    const g = { anchor: externalAnchor('workflow_output', evidence.finalHash), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding };
    for (const [from, to] of [['"unfinishedCalls":0', '"unfinishedCalls":1'], ['"toolCallCount":1', '"toolCallCount":2'], ['"cause":null', '"cause":"x"']] as const) {
      const t = [...lines];
      t[t.length - 1] = (t[t.length - 1] as string).replace(from, to);
      expect(t[t.length - 1]).not.toBe(lines[lines.length - 1]);
      expect(verifyEvidenceChain(t).ok, from).toBe(false);
      expect(reasons(e2Gate({ ...g, streamLines: t })), from).toEqual(['e2_stream_chain_invalid']);
    }
    const recomputed = rechain(lines, (r) => { if (r.kind === 'final') r.endedAt = '2000-01-01T00:00:00.000Z'; });
    expect(reasons(e2Gate({ ...g, streamLines: recomputed }))).toEqual(['e2_anchor_mismatch']);
    expect(reasons(e2Gate({ ...g, streamLines: lines.slice(0, -1) }))).toEqual(['e2_stream_chain_invalid']);
  });
});

describe('PILOT 0774db05 H-4: run, base, head and workspace are bound across stream, re-exec and diff', () => {
  it('refuses another run, swapped base/head, a head not descended from base, and another cwd', async () => {
    const { path, evidence } = await liveCapture('h4.jsonl');
    const streamLines = await readEvidenceLines(path);
    const p = await parts();
    const g = { streamLines, anchor: externalAnchor('workflow_output', evidence.finalHash), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, modelId: p.modelId, binding: p.binding };
    expect(reasons(e2Gate({ ...g, binding: undefined } as unknown as Parameters<typeof e2Gate>[0]))).toEqual(['e2_binding_absent']);
    expect(reasons(e2Gate({ ...g, binding: { ...p.binding, runId: 'run-other' } }))).toEqual(['e2_binding_run_mismatch']);
    const swapped = await recordGitDiff({ base: head, head: base, cwd: repo, runner: p.runner });
    expect(swapped?.ancestry).toBe(false);
    expect(reasons(e2Gate({ ...g, diff: swapped }))).toEqual(['e2_binding_diff_mismatch', 'e2_diff_not_descendant']);
    expect(reasons(e2Gate({ ...g, diff: swapped, binding: { ...p.binding, base: head, head: base } }))).toEqual(['e2_diff_not_descendant', 'e2_verifier_not_from_spec']); // R3-2: the spec was pinned at the real base
    /* R3-2: a spec re-exec in another cwd runs nothing; the legacy argv form in another cwd is refused twice over. */
    const elsewhere = await recordVerifierReexec({ spec: p.verifierSpec, cwd: root, runner: p.runner });
    expect(elsewhere?.refusal).toBe('cwd_not_spec_workspace');
    expect(reasons(e2Gate({ ...g, reexec: elsewhere }))).toEqual(['e2_reexec_absent', 'e2_binding_cwd_mismatch']);
    const rootReexec = await recordVerifierReexec({ commands: [[NODE, js('0')]], cwd: root, runner: p.runner });
    expect(reasons(e2Gate({ ...g, reexec: rootReexec }))).toEqual(['e2_verifier_not_from_spec', 'e2_binding_cwd_mismatch']);
    expect(await recordVerifierReexec({ commands: [[NODE, js('0')]], cwd: '.', runner: p.runner })).toBeNull();
  });
});

describe('PILOT 0774db05 M-7: the verifier runner', () => {
  it('passes only an allowlisted environment: a parent variable does not leak', async () => {
    process.env.E2_PILOT_LEAK = 'leaked';
    try {
      const r = await recordVerifierReexec({ commands: [[NODE, js('process.stdout.write(process.env.E2_PILOT_LEAK ?? "none")')]], cwd: repo, runner: spawnVerifierRunner() });
      expect(r?.commands[0]?.stdoutSha256).toBe(sha('none'));
    } finally { delete process.env.E2_PILOT_LEAK; }
  });
  it('a shell program is refused before anything runs, never julius_observed', async () => {
    const runner = spawnVerifierRunner();
    for (const argv of [['sh', '-c', 'true'], ['/bin/bash', '-c', 'true'], ['dash', '-c', 'true'], ['/usr/bin/env', 'node', '-e', '0'], ['busybox', 'sh']]) {
      expect(await recordVerifierReexec({ commands: [argv], cwd: repo, runner }), argv.join(' ')).toBeNull();
      expect((await runner(argv, repo)).exitCode, argv.join(' ')).toBeNull();
    }
  });
  it('the timeout kills the whole process group: a grandchild holding the pipes dies too', async () => {
    const runner = spawnVerifierRunner({ timeoutMs: 300 });
    const t0 = Date.now();
    const r = await recordVerifierReexec({ commands: [[NODE, js("require('child_process').spawn('sleep',['3'],{stdio:'inherit'})")]], cwd: repo, runner });
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(r?.commands[0]?.exitCode).toBe('unknown');
  });
  it('cwd must be an absolute, existing, canonical directory', async () => {
    const runner = spawnVerifierRunner();
    const link = join(root, 'link');
    symlinkSync(repo, link);
    for (const cwd of ['.', 'repo', join(root, 'missing'), link, join(repo, 'a.txt')]) expect((await runner([NODE, js('0')], cwd)).exitCode, cwd).toBeNull();
    expect((await runner([NODE, js('0')], repo)).exitCode).toBe(0);
  });
  it('output is hashed while streaming with byte counts, and an output cap makes the exit unknown', async () => {
    const big = [NODE, js('process.stdout.write("x".repeat(3000000))')];
    const r = await recordVerifierReexec({ commands: [big], cwd: repo, runner: spawnVerifierRunner() });
    expect(r?.commands[0]).toMatchObject({ exitCode: 0, stdoutSha256: sha('x'.repeat(3_000_000)), stdoutBytes: 3_000_000, stderrBytes: 0 });
    const capped = await recordVerifierReexec({ commands: [big], cwd: repo, runner: spawnVerifierRunner({ maxOutputBytes: 1_000 }) });
    expect(capped?.commands[0]?.exitCode).toBe('unknown');
  });
});

describe('PILOT 0774db05 M-8: the diff hash does not depend on local git config', () => {
  it('diff.noprefix, diff.renames, core.quotepath and color in the repo config do not change the hash; ancestry is recorded', async () => {
    const runner = spawnVerifierRunner();
    const plain = await recordGitDiff({ base, head, cwd: repo, runner });
    git(repo, 'config', 'diff.noprefix', 'true');
    git(repo, 'config', 'diff.renames', 'true');
    git(repo, 'config', 'core.quotepath', 'true');
    git(repo, 'config', 'diff.mnemonicPrefix', 'true');
    git(repo, 'config', 'color.ui', 'always');
    try {
      const configured = await recordGitDiff({ base, head, cwd: repo, runner });
      expect(configured?.sha256).toBe(plain?.sha256);
      /* Mutation R25: a global config handed to the runner's env is not read either. */
      const gc = join(root, 'global.gitconfig');
      writeFileSync(gc, '[diff]\n\tnoprefix = true\n\trenames = true\n');
      const viaGlobal = await recordGitDiff({ base, head, cwd: repo, runner: spawnVerifierRunner({ env: { GIT_CONFIG_GLOBAL: gc, GIT_CONFIG_SYSTEM: gc } }) });
      expect(viaGlobal?.sha256).toBe(plain?.sha256);
      expect(plain).toMatchObject({ exitCode: 0, ancestry: true, cwd: repo });
      expect(plain?.argv).toEqual(expect.arrayContaining(['diff.noprefix=false', 'diff.renames=false', 'core.quotepath=false', '--no-renames']));
    } finally {
      for (const k of ['diff.noprefix', 'diff.renames', 'core.quotepath', 'diff.mnemonicPrefix', 'color.ui']) git(repo, 'config', '--unset', k);
    }
  });
});

describe('PILOT 0774db05 L-4: a model the reviewed table cannot place is refused', () => {
  /* 43b93a4e Skywalker N2: these ids differ from the requested model in the header, so e2_model_unbound is also reported;
     these tests are about the id itself, so it is filtered here and asserted in e2-evidence-gate-r4.test.ts. */
  const idReasons = (r: ReturnType<typeof e2Gate>): readonly string[] => reasons(r).filter((x) => x !== 'e2_model_unbound');
  it('fake-model is unrecognised', async () => {
    const { path, evidence } = await liveCapture('l4.jsonl');
    const p = await parts();
    const g = { streamLines: await readEvidenceLines(path), anchor: externalAnchor('workflow_output', evidence.finalHash), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, binding: p.binding };
    expect(idReasons(e2Gate({ ...g, modelId: 'fake-model' }))).toEqual(['e2_model_unrecognised']);
    expect(idReasons(e2Gate({ ...g, modelId: 'auto' }))).toEqual(['e2_model_router']);
  });
  it('Skywalker F5b: router lookalikes (trailing space, Cyrillic, full-width, zero-width) are routers; Claude and unknown ids are refused', async () => {
    const { path, evidence } = await liveCapture('f5.jsonl');
    const p = await parts();
    const g = { streamLines: await readEvidenceLines(path), anchor: externalAnchor('workflow_output', evidence.finalHash), reexec: p.reexec, verifierSpec: p.verifierSpec, diff: p.diff, binding: p.binding };
    for (const m of ['AUTO ', ' auto', '\u0410uto', '\u0410UTO ', '\uff41\uff55\uff54\uff4f', 'au\u200bto', 'Auto\t']) expect(idReasons(e2Gate({ ...g, modelId: m })), JSON.stringify(m)).toEqual(['e2_model_router']);
    for (const m of ['claude-opus-5', 'claude-sonnet-4-5', 'anthropic/claude-3']) expect(idReasons(e2Gate({ ...g, modelId: m })), m).toEqual(['e2_model_claude']);
    for (const m of ['claude-opus-5', 'fake-model', 'my-model-1', 'x']) expect(idReasons(e2Gate({ ...g, modelId: m })).length, m).toBeGreaterThan(0);
    expect(reasons(e2Gate({ ...g, modelId: 'grok-code-fast-1' }))).toEqual([]);
    /* 43b93a4e N-6: the list is closed; gpt-5 is no longer accepted, composer-1 is listed but not the run's requested model. */
    expect(reasons(e2Gate({ ...g, modelId: 'gpt-5' }))).toEqual(['e2_model_unbound', 'e2_model_unrecognised']);
    expect(reasons(e2Gate({ ...g, modelId: 'composer-1' }))).toEqual(['e2_model_unbound']);
    expect(E2_FAKE_LABEL).toBe('fake');
  });
});
