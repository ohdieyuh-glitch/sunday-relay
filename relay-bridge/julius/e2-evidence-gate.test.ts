import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2_STREAM_LABEL_FAKE, E2_STREAM_LABEL_LIVE, type E2StreamEvidence } from './cursor-run-stream-evidence';
import { E2_FAKE_LABEL, E2_GATE_REASONS, E2_JULIUS_LABEL, type E2DiffEvidence, e2Gate, recordGitDiff, recordVerifierReexec, spawnVerifierRunner, type VerifierRunner } from './e2-evidence-gate';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const NODE = process.execPath;
const clock = (): (() => number) => { let t = Date.parse('2026-10-30T18:00:00.000Z'); return () => (t += 1000); };

const STREAM: E2StreamEvidence = Object.freeze({
  label: E2_STREAM_LABEL_LIVE, mode: 'live', independentOfCursor: false, agentId: 'bc-1', runId: 'run-1', cause: null, records: 9,
  finalHash: 'a'.repeat(64), fileSha256: 'b'.repeat(64), retentionSeconds: 'not_provided', connections: 1, duplicatesDropped: 0, partialDiscarded: 0,
  terminal: { status: 'FINISHED', durationMs: 1 },
  toolCalls: [{ callId: 'c', name: 'edit_file', status: 'completed', keyCall: true, truncatedArgs: false, truncatedResult: false, argsSha256: null, resultSha256: null }],
  perEventTimestamps: 'not_provided', exitCodes: 'not_provided',
}) as E2StreamEvidence;

describe('E2 part B: Julius re-runs the verifier commands', () => {
  it('records argv, exit code, output hashes and times; only the spawn runner is julius_observed', async () => {
    const runner = spawnVerifierRunner();
    const ev = await recordVerifierReexec({ commands: [[NODE, '-e', 'process.stdout.write("ok")'], [NODE, '-e', 'process.stderr.write("e");process.exit(3)']], cwd: process.cwd(), runner, now: clock() });
    expect(ev).toEqual({
      label: E2_JULIUS_LABEL, cwd: process.cwd(),
      commands: [
        { argv: [NODE, '-e', 'process.stdout.write("ok")'], exitCode: 0, stdoutSha256: sha('ok'), stderrSha256: sha(''), startedAt: '2026-10-30T18:00:01.000Z', endedAt: '2026-10-30T18:00:02.000Z' },
        { argv: [NODE, '-e', 'process.stderr.write("e");process.exit(3)'], exitCode: 3, stdoutSha256: sha(''), stderrSha256: sha('e'), startedAt: '2026-10-30T18:00:03.000Z', endedAt: '2026-10-30T18:00:04.000Z' },
      ],
    });
    expect(Object.isFrozen(ev)).toBe(true);
    const fake: VerifierRunner = async () => ({ exitCode: 0, stdout: 'ok', stderr: '' });
    expect((await recordVerifierReexec({ commands: [['npm', 'test']], cwd: '.', runner: fake }))?.label).toBe(E2_FAKE_LABEL);
  });
  it('no shell: metacharacters are plain arguments; a missing binary, a kill or a throwing runner is exit unknown', async () => {
    const runner = spawnVerifierRunner({ timeoutMs: 300 });
    const ev = await recordVerifierReexec({ commands: [[NODE, '-e', 'process.stdout.write(process.argv[1])', '$(echo hi);x']], cwd: process.cwd(), runner });
    expect(ev?.commands[0]?.stdoutSha256).toBe(sha('$(echo hi);x'));
    const missing = await recordVerifierReexec({ commands: [['/nonexistent/verifier-binary']], cwd: process.cwd(), runner });
    expect(missing?.commands[0]?.exitCode).toBe('unknown');
    const slow = await recordVerifierReexec({ commands: [[NODE, '-e', 'setTimeout(()=>{},5000)']], cwd: process.cwd(), runner });
    expect(slow?.commands[0]?.exitCode).toBe('unknown');
    const thrower: VerifierRunner = async () => { throw new Error('x'); };
    expect((await recordVerifierReexec({ commands: [['a']], cwd: '.', runner: thrower }))?.commands[0]?.exitCode).toBe('unknown');
    const fractional: VerifierRunner = async () => ({ exitCode: 1.5, stdout: '', stderr: '' });
    expect((await recordVerifierReexec({ commands: [['a']], cwd: '.', runner: fractional }))?.commands[0]?.exitCode).toBe('unknown');
  });
  it('refuses an empty list, an empty argv, an empty program or a NUL before running anything', async () => {
    let ran = 0;
    const runner: VerifierRunner = async () => { ran += 1; return { exitCode: 0, stdout: '', stderr: '' }; };
    for (const commands of [[], [[]], [['']], [['a', 'b\u0000c']], [['ok'], []]] as (readonly string[])[][]) {
      expect(await recordVerifierReexec({ commands, cwd: '.', runner })).toBeNull();
    }
    expect(ran).toBe(0);
  });
});

describe('E2 part C: the diff', () => {
  it('runs git diff without ext-diff or textconv on full SHAs and hashes it; bad SHAs are refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'e2diff-'));
    try {
      const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }).toString().trim();
      git('init', '-q');
      writeFileSync(join(dir, 'a.txt'), 'one\n');
      git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'a');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(dir, 'a.txt'), 'two\n');
      git('-c', 'commit.gpgsign=false', 'commit', '-qam', 'b');
      const head = git('rev-parse', 'HEAD');
      const expected = execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv', '--binary', `${base}..${head}`], { cwd: dir });
      const runner = spawnVerifierRunner();
      const d = await recordGitDiff({ base, head, cwd: dir, runner });
      expect(d).toEqual({ label: E2_JULIUS_LABEL, base, head, argv: ['git', 'diff', '--no-ext-diff', '--no-textconv', '--binary', `${base}..${head}`], exitCode: 0, sha256: createHash('sha256').update(expected).digest('hex'), bytes: expected.byteLength });
      expect(d?.bytes).toBeGreaterThan(0);
      for (const bad of [base.slice(0, 39), base.toUpperCase(), 'HEAD', `${base}\n`, `--output=${base}`]) {
        expect(await recordGitDiff({ base: bad, head, cwd: dir, runner })).toBeNull();
        expect(await recordGitDiff({ base, head: bad, cwd: dir, runner })).toBeNull();
      }
      const missing = await recordGitDiff({ base, head: 'f'.repeat(40), cwd: dir, runner });
      expect(missing?.exitCode).not.toBe(0);
      const fake: VerifierRunner = async () => ({ exitCode: 0, stdout: new Uint8Array([1, 2]), stderr: '' });
      expect(await recordGitDiff({ base, head, cwd: dir, runner: fake })).toMatchObject({ label: E2_FAKE_LABEL, bytes: 2 });
      const thrower: VerifierRunner = async () => { throw new Error('x'); };
      expect((await recordGitDiff({ base, head, cwd: dir, runner: thrower }))?.exitCode).toBe('unknown');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('E2 gate', () => {
  const runner = spawnVerifierRunner();
  const good = async () => ({
    stream: STREAM,
    reexec: await recordVerifierReexec({ commands: [[NODE, '-e', '0']], cwd: process.cwd(), runner }),
    diff: Object.freeze({ label: E2_JULIUS_LABEL, base: 'a'.repeat(40), head: 'b'.repeat(40), argv: [], exitCode: 0, sha256: '', bytes: 1 }) as E2DiffEvidence,
    modelId: 'grok-code-fast-1',
  });
  it('admits all three parts, live and Julius-observed, with a pinned model', async () => {
    expect(e2Gate(await good())).toEqual({ ok: true });
  });
  it('refuses with every reason: fakes, failures, unknown exits, absences, router models; never the diff alone', async () => {
    const g = await good();
    const fakeRunner: VerifierRunner = async () => ({ exitCode: 0, stdout: '', stderr: '' });
    const reasons = (x: Record<string, unknown>): readonly string[] => { const r = e2Gate({ ...g, ...x } as Parameters<typeof e2Gate>[0]); return r.ok ? [] : r.reasons; };
    expect(reasons({ stream: null })).toEqual(['e2_stream_absent']);
    expect(reasons({ stream: { ...STREAM, label: E2_STREAM_LABEL_FAKE, mode: 'fake' } })).toEqual(['e2_stream_not_live']);
    expect(reasons({ stream: { ...STREAM, mode: 'fake' } })).toEqual(['e2_stream_not_live']);
    expect(reasons({ stream: { ...STREAM, label: E2_STREAM_LABEL_FAKE } })).toEqual(['e2_stream_not_live']);
    expect(reasons({ stream: { ...STREAM, cause: 'e2_stream_gap' } })).toEqual(['e2_stream_failed']);
    expect(reasons({ stream: { ...STREAM, terminal: null } })).toEqual(['e2_stream_no_terminal']);
    expect(reasons({ stream: { ...STREAM, toolCalls: [] } })).toEqual(['e2_no_tool_calls']);
    expect(reasons({ reexec: null })).toEqual(['e2_reexec_absent']);
    expect(reasons({ reexec: { ...g.reexec!, commands: [] } })).toEqual(['e2_reexec_absent']);
    expect(reasons({ reexec: await recordVerifierReexec({ commands: [['x']], cwd: '.', runner: fakeRunner }) })).toEqual(['e2_reexec_fake']);
    expect(reasons({ reexec: await recordVerifierReexec({ commands: [[NODE, '-e', '0'], [NODE, '-e', 'process.exit(1)']], cwd: process.cwd(), runner }) })).toEqual(['e2_reexec_failed']);
    expect(reasons({ reexec: await recordVerifierReexec({ commands: [['/nonexistent/x']], cwd: process.cwd(), runner }) })).toEqual(['e2_reexec_exit_unknown']);
    expect(reasons({ diff: null })).toEqual(['e2_diff_absent']);
    expect(reasons({ diff: { ...g.diff, label: E2_FAKE_LABEL } })).toEqual(['e2_diff_fake']);
    expect(reasons({ diff: { ...g.diff, exitCode: 128 } })).toEqual(['e2_diff_failed']);
    expect(reasons({ diff: { ...g.diff, exitCode: 'unknown' } })).toEqual(['e2_diff_failed']);
    expect(reasons({ modelId: '' })).toEqual(['e2_model_absent']);
    expect(reasons({ modelId: null })).toEqual(['e2_model_absent']);
    for (const m of ['auto', 'Auto', 'cursor-auto', 'default', 'router', 'balance', 'intelligence']) expect(reasons({ modelId: m })).toEqual(['e2_model_router']);
    expect(reasons({ stream: null, reexec: null, modelId: 'auto' })).toEqual(['e2_stream_absent', 'e2_reexec_absent', 'e2_model_router']);
    const all = new Set(E2_GATE_REASONS);
    expect(all.size).toBe(14);
  });
});
