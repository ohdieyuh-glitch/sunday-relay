/* Round 4: tests written to kill named mutants that survived the round-4 spot-check (mut/mutants8-before.log). */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCursorCloudAgentsTransport, type CursorFetch } from './cursor-cloud-agents-transport';
import { captureCursorRunStream, createMemoryEvidenceSink } from './cursor-run-stream-evidence';
import * as G from './e2-evidence-gate';
import { MODEL, RUN, START, call, ev, git, liveCapture, makeRepo, tail, anchorOf } from './e2-test-kit';

let root = ''; let repo = ''; let base = ''; let head = ''; let emptyHead = '';
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r9k-')));
  repo = join(root, 'repo'); mkdirSync(repo);
  ({ base, head } = makeRepo(repo, { 'a.txt': 'one\n', 'ok.mjs': 'process.exit(0)\n' }, { 'a.txt': 'two\n' }, (p, c) => writeFileSync(p, c)));
  git(repo, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'empty', '--allow-empty');
  emptyHead = git(repo, 'rev-parse', 'HEAD');
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
async function parts(h = head) {
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const verifierSpec = G.pinVerifierSpec({ testCommand: 'node ok.mjs', workspace: repo, base }) as G.E2VerifierSpec;
  return {
    verifierSpec, reexec: await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }),
    diff: await G.recordGitDiff({ base: h === emptyHead ? head : base, head: h, cwd: repo, runner }), modelId: MODEL,
    binding: { runId: RUN, base: h === emptyHead ? head : base, head: h, workspace: repo },
  };
}
let k = 0;
async function gate(sse: string, h = head): Promise<readonly string[]> {
  k += 1;
  const { lines, evidence } = await liveCapture(root, `k${k}.jsonl`, sse);
  const r = G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...await parts(h) } as Parameters<typeof G.e2Gate>[0]);
  return r.ok ? [] : r.reasons;
}

describe('mutant kills', () => {
  it('K1: an unparsable tool_call record makes the recount fail closed (e2_final_record_mismatch)', async () => {
    expect(await gate(START + call('c1', 'edit_file') + 'id: 1713033004000-0\nevent: tool_call\ndata: not json\n\n' + tail())).toContain('e2_final_record_mismatch');
  });
  /* K2 (duplicate skip) and K3b (base==head half) are EQUIVALENT mutants: a duplicate is an exact replay (same id, event,
     data) that overwrites the same callId entry and already fails the capture (e2_stream_duplicate_event / resumed); and
     base == head always yields a zero-byte diff, so the bytes half covers it. No test can tell them apart. */
  it('K3a: a diff of zero bytes between two different commits is e2_diff_empty', async () => {
    expect(await gate(START + call('c1', 'edit_file') + tail(), emptyHead)).toContain('e2_diff_empty');
  });
  it('K4: the runner refuses git -C and git -c even though module git exists', async () => {
    const runner = G.spawnVerifierRunner({ timeoutMs: 10_000 });
    for (const argv of [['git', '-C', '/', 'status'], ['git', '-c', 'diff.external=/bin/true', 'diff'], ['git', '-c', 'core.pager=cat', 'log', '-1']]) {
      const r = await runner(argv, repo);
      expect('cause' in r ? r.cause : null, argv.join(' ')).toBe('refused');
    }
  });
  it('K6b: idleTimeoutMs 0 or negative keeps the 100 ms floor (a 40 ms gap is not idle)', async () => {
    const REF = { agentId: 'bc-00000000-0000-4000-8000-000000000001', runId: RUN };
    for (const idle of [0, -5]) {
      const body = (): ReadableStream<Uint8Array> => new ReadableStream({ async start(c) {
        const e = new TextEncoder();
        c.enqueue(e.encode(ev('status', { runId: RUN, status: 'RUNNING' })));
        await new Promise((r) => setTimeout(r, 40));
        c.enqueue(e.encode(ev('result', { runId: RUN, status: 'FINISHED' }, '2') + ev('done', {}, '3')));
        c.close();
      } });
      const fetch: CursorFetch = async () => ({ ok: true, status: 200, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? 'text/event-stream' : null) }, body: body(), text: async () => '' });
      const transport = createCursorCloudAgentsTransport({ fetch, getApiKey: () => 'SENTINEL-KEY-0123456789-never-print' });
      const r = await captureCursorRunStream({ transport, ref: REF, sink: createMemoryEvidenceSink(), deadlineAtMs: Date.now() + 10_000, idleTimeoutMs: idle });
      expect(r.cause, String(idle)).toBeNull();
    }
  });
  it('L2: a refs/replace mapping cannot hide the diff', async () => {
    const r2 = join(root, 'replace'); mkdirSync(r2);
    const c = makeRepo(r2, { 'a.txt': 'one\n' }, { 'a.txt': 'two\n' }, (p, t) => writeFileSync(p, t));
    git(r2, 'replace', c.head, c.base);
    const d = await G.recordGitDiff({ ...c, cwd: r2, runner: G.spawnVerifierRunner() });
    expect(d?.exitCode).toBe(0);
    expect(d?.paths).toEqual(['a.txt']);
    expect(d?.bytes).toBeGreaterThan(0);
  });
});
