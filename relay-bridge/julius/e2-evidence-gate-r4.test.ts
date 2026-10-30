import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { readEvidenceLines, verifyEvidenceChain } from './cursor-run-stream-evidence';
import { e2Gate, pinVerifierSpec, type E2VerifierSpec, recordGitDiff, recordVerifierReexec, spawnVerifierRunner } from './e2-evidence-gate';
import { anchorOf } from './e2-test-kit';

/*
 * PILOT 43b93a4e N-1, N-5, N-6, M-2, mutant M2 and Skywalker 43b93a4e N2/N3/L3, failing-first. The live-labelled capture
 * uses the documented M-5 residual (a global fetch replaced before the transport module is imported).
 */
const KEY = 'SENTINEL-KEY-0123456789-never-print';
const AGENT = 'bc-00000000-0000-4000-8000-000000000001';
const RUN = 'run-00000000-0000-0000-0000-000000000001';
const MODEL = 'grok-code-fast-1';
const ev = (event: string, data: unknown, id?: string): string => `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
const call = (id: string, name: string, path = 'a.txt'): string => ev('tool_call', { callId: id, name, status: 'completed', args: { path } }, `17130330020${id.slice(1)}0-0`);
const tail = (status = 'FINISHED'): string => ev('result', { runId: RUN, status, durationMs: 10 }, '1713033010000-0') + ev('done', {}, '1713033010000-0');
const START = ev('status', { runId: RUN, status: 'RUNNING' });
const GOOD = START + call('c1', 'edit_file') + tail();

let root = ''; let repo = ''; let base = ''; let head = '';
const git = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }).toString().trim();
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r4-')));
  repo = join(root, 'repo'); mkdirSync(repo);
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  writeFileSync(join(repo, 'ok.mjs'), "import test from 'node:test'; test('ok', () => {});\n"); // R3-2: the verifier script is pinned at base
  git(repo, 'add', '.'); git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'a');
  base = git(repo, 'rev-parse', 'HEAD');
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qam', 'b');
  head = git(repo, 'rev-parse', 'HEAD');
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

/** created=true: the transport creates the run (POST) before streaming; false: a literal ref, as a mid-run attach would. */
async function liveCapture(name: string, sse: string, opts: { created?: boolean; modelId?: string } = {}) {
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
    const path = join(root, name);
    const evidence = await E.captureCursorRunStream({ transport, ref, sink: E.createFileEvidenceSink(path), deadlineAtMs: Date.now() + 60_000 });
    return { lines: await readEvidenceLines(path), evidence };
  } finally { globalThis.fetch = orig; vi.resetModules(); }
}
function rechain(lines: readonly string[], edit: (r: Record<string, unknown>) => boolean | void): string[] {
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
const chainAnchor = (l: readonly string[]) => anchorOf('ledger_hash', (verifyEvidenceChain(l) as { finalHash: string }).finalHash); // R3-1: simulates a writer who also controls the anchor source (recount tests)
async function parts() {
  const runner = spawnVerifierRunner({ timeoutMs: 30_000 });
  const verifierSpec = pinVerifierSpec({ testCommand: 'node ok.mjs', minTests: 1, workspace: repo, base }) as E2VerifierSpec;
  return {
    verifierSpec, reexec: await recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }),
    diff: await recordGitDiff({ base, head, cwd: repo, runner }),
    binding: { runId: RUN, base, head, workspace: repo }, runner,
  };
}
const reasons = (r: ReturnType<typeof e2Gate>): readonly string[] => (r.ok ? [] : r.reasons);

describe('PILOT 43b93a4e N-1 / mutant M2: the gate recounts the final record from the events', () => {
  it('the baseline created-run capture passes', async () => {
    const { lines, evidence } = await liveCapture('ok.jsonl', GOOD);
    const p = await parts();
    expect(reasons(e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...p, modelId: MODEL }))).toEqual([]);
  });
  it('an ERROR result re-chained under a FINISHED final record is refused (M2)', async () => {
    const { lines } = await liveCapture('m2.jsonl', GOOD);
    const forged = rechain(lines, (r) => { if (r.kind === 'event' && r.event === 'result') r.data = JSON.stringify({ runId: RUN, status: 'ERROR', durationMs: 10 }); });
    const p = await parts();
    expect(reasons(e2Gate({ streamLines: forged, anchor: chainAnchor(forged), ...p, modelId: MODEL }))).toContain('e2_final_record_mismatch');
  });
  it('mutant M2: an ERROR run re-chained consistently (event and final both ERROR) is refused as not finished', async () => {
    const { lines } = await liveCapture('m2b.jsonl', GOOD);
    const forged = rechain(lines, (r) => {
      if (r.kind === 'event' && r.event === 'result') r.data = JSON.stringify({ runId: RUN, status: 'ERROR', durationMs: 10 });
      if (r.kind === 'final') r.terminal = { ...(r.terminal as object), status: 'ERROR' };
    });
    const p = await parts();
    expect(reasons(e2Gate({ streamLines: forged, anchor: chainAnchor(forged), ...p, modelId: MODEL }))).toEqual(['e2_stream_terminal_not_finished']);
  });
  it('a tool_call event removed (final still counts it), or an unfinished call hidden, is refused', async () => {
    const { lines } = await liveCapture('n1.jsonl', GOOD);
    const p = await parts();
    const dropped = rechain(lines, (r) => !(r.kind === 'event' && r.event === 'tool_call'));
    expect(reasons(e2Gate({ streamLines: dropped, anchor: chainAnchor(dropped), ...p, modelId: MODEL }))).toContain('e2_final_record_mismatch');
    const pending = rechain(lines, (r) => { if (r.kind === 'event' && r.event === 'tool_call') r.data = JSON.stringify({ callId: 'c1', name: 'edit_file', status: 'running', args: { path: 'a.txt' } }); });
    expect(reasons(e2Gate({ streamLines: pending, anchor: chainAnchor(pending), ...p, modelId: MODEL }))).toContain('e2_final_record_mismatch');
    const nodone = rechain(lines, (r) => !(r.kind === 'event' && r.event === 'done'));
    expect(reasons(e2Gate({ streamLines: nodone, anchor: chainAnchor(nodone), ...p, modelId: MODEL }))).toContain('e2_final_record_mismatch');
  });
});

describe('Skywalker 43b93a4e N3: real work', () => {
  it('a stream with only read-type tool calls is refused', async () => {
    const { lines, evidence } = await liveCapture('reads.jsonl', START + call('c1', 'read_file') + call('c2', 'grep') + tail());
    const p = await parts();
    expect(reasons(e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...p, modelId: MODEL }))).toEqual(['e2_no_edit_calls']);
  });
  it('PILOT N-5: an empty diff or base == head is refused', async () => {
    const { lines, evidence } = await liveCapture('empty.jsonl', GOOD);
    const p = await parts();
    const same = await recordGitDiff({ base: head, head, cwd: repo, runner: p.runner });
    expect(same?.bytes).toBe(0);
    expect(reasons(e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...p, diff: same, binding: { ...p.binding, base: head }, modelId: MODEL }))).toEqual(['e2_diff_empty', 'e2_verifier_not_from_spec', 'e2_edit_path_not_in_diff']); // R3-2: spec pinned at the real base; r6 rule (b): the edit is not in an empty diff
  });
});

describe('PILOT 43b93a4e M-2: a stream not opened on a run this transport created is refused', () => {
  it('a literal ref (mid-run attach is indistinguishable) is e2_stream_mid_run_start', async () => {
    const { lines, evidence } = await liveCapture('mid.jsonl', GOOD, { created: false });
    const p = await parts();
    expect(reasons(e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...p, modelId: MODEL }))).toEqual(['e2_stream_mid_run_start', 'e2_model_unbound']);
  });
});

describe('Skywalker N2 / PILOT N-6: the model is bound to the evidence file and drawn from a closed allowlist', () => {
  it('a caller model that differs from the requested model in the header is refused', async () => {
    const { lines, evidence } = await liveCapture('bind.jsonl', GOOD, { modelId: 'composer-1' });
    const p = await parts();
    const g = { streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...p };
    expect(reasons(e2Gate({ ...g, modelId: 'composer-1' }))).toEqual([]);
    expect(reasons(e2Gate({ ...g, modelId: MODEL }))).toEqual(['e2_model_unbound']);
  });
  it('ids outside the closed list are refused, including lookalikes, NUL and newlines', async () => {
    for (const m of ['hermes-composer', 'groq-composer', 'grok-4', 'gpt-5', 'not-a-gpt-thing', 'my composer', 'composer-1\u0000', 'composer-1\n', 'Composer-1']) {
      const { lines, evidence } = await liveCapture(`al-${createHash('sha256').update(m).digest('hex').slice(0, 8)}.jsonl`, GOOD, { modelId: m });
      const p = await parts();
      const r = reasons(e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...p, modelId: m }));
      expect(r.length, JSON.stringify(m)).toBeGreaterThan(0);
      expect(r.every((x) => x.startsWith('e2_model_')), `${JSON.stringify(m)} ${r.join()}`).toBe(true);
    }
  });
});
