import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { E2_FAKE_LABEL, E2_GATE_REASONS, E2_JULIUS_LABEL, e2Gate, recordGitDiff, recordVerifierReexec, spawnVerifierRunner, type VerifierRunner } from './e2-evidence-gate';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const NODE = process.execPath;

/* 43b93a4e N-3: the runner refuses `node -e`; inline verifier code is written to a script file (argv shifted to match -e). */
const JS_DIR = realpathSync(mkdtempSync(join(tmpdir(), 'e2js-'))); // R3-2: also the cwd, so the scripts are in the workspace
const js = (code: string): string => {
  const f = join(JS_DIR, `${createHash('sha256').update(code).digest('hex').slice(0, 16)}.cjs`);
  writeFileSync(f, `process.argv.splice(1, 1);\n${code}\n`);
  return f;
};
const clock = (): (() => number) => { let t = Date.parse('2026-10-30T18:00:00.000Z'); return () => (t += 1000); };


describe('E2 part B: Julius re-runs the verifier commands', () => {
  it('records argv, exit code, output hashes and times; only the spawn runner is julius_observed', async () => {
    const runner = spawnVerifierRunner();
    const ev = await recordVerifierReexec({ commands: [[NODE, js('process.stdout.write("ok")')], [NODE, js('process.stderr.write("e");process.exit(3)')]], cwd: JS_DIR, runner, now: clock() });
    expect(ev).toEqual({
      label: E2_JULIUS_LABEL, cwd: JS_DIR, spec: null, refusal: null,
      commands: [
        { argv: [NODE, js('process.stdout.write("ok")')], exitCode: 0, stdoutSha256: sha('ok'), stderrSha256: sha(''), stdoutBytes: 2, stderrBytes: 0, startedAt: '2026-10-30T18:00:01.000Z', endedAt: '2026-10-30T18:00:02.000Z', testSummary: null, fileLevelPoints: [], testPoints: 0, tapComplete: true },
        { argv: [NODE, js('process.stderr.write("e");process.exit(3)')], exitCode: 3, stdoutSha256: sha(''), stderrSha256: sha('e'), stdoutBytes: 0, stderrBytes: 1, startedAt: '2026-10-30T18:00:03.000Z', endedAt: '2026-10-30T18:00:04.000Z', testSummary: null, fileLevelPoints: [], testPoints: 0, tapComplete: true },
      ],
    });
    expect(Object.isFrozen(ev)).toBe(true);
    const fake: VerifierRunner = async () => ({ exitCode: 0, stdout: 'ok', stderr: '' });
    expect((await recordVerifierReexec({ commands: [[NODE, js('0')]], cwd: JS_DIR, runner: fake }))?.label).toBe(E2_FAKE_LABEL);
  });
  it('no shell: metacharacters are plain arguments; a missing binary, a kill or a throwing runner is exit unknown', async () => {
    const runner = spawnVerifierRunner({ timeoutMs: 300 });
    const ev = await recordVerifierReexec({ commands: [[NODE, js('process.stdout.write(process.argv[1])'), '$(echo hi);x']], cwd: JS_DIR, runner });
    expect(ev?.commands[0]?.stdoutSha256).toBe(sha('$(echo hi);x'));
    /* 43b93a4e N-3: a program outside the allowlist is refused before running; the runner itself reports exit null. */
    expect(await recordVerifierReexec({ commands: [['/nonexistent/verifier-binary']], cwd: JS_DIR, runner })).toBeNull();
    expect((await runner(['/nonexistent/verifier-binary'], JS_DIR)).exitCode).toBeNull();
    const slow = await recordVerifierReexec({ commands: [[NODE, js('setTimeout(()=>{},5000)')]], cwd: JS_DIR, runner });
    expect(slow?.commands[0]?.exitCode).toBe('unknown');
    const thrower: VerifierRunner = async () => { throw new Error('x'); };
    expect((await recordVerifierReexec({ commands: [[NODE, js('0')]], cwd: JS_DIR, runner: thrower }))?.commands[0]?.exitCode).toBe('unknown');
    const fractional: VerifierRunner = async () => ({ exitCode: 1.5, stdout: '', stderr: '' });
    expect((await recordVerifierReexec({ commands: [[NODE, js('0')]], cwd: JS_DIR, runner: fractional }))?.commands[0]?.exitCode).toBe('unknown');
  });
  it('refuses an empty list, an empty argv, an empty program or a NUL before running anything', async () => {
    let ran = 0;
    const runner: VerifierRunner = async () => { ran += 1; return { exitCode: 0, stdout: '', stderr: '' }; };
    for (const commands of [[], [[]], [['']], [['a', 'b\u0000c']], [['ok'], []]] as (readonly string[])[][]) {
      expect(await recordVerifierReexec({ commands, cwd: JS_DIR, runner })).toBeNull();
    }
    expect(ran).toBe(0);
  });
});

describe('E2 part C: the diff', () => {
  it('runs git diff without ext-diff or textconv on full SHAs and hashes it; bad SHAs are refused', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2diff-')));
    try {
      const git = (...a: string[]): string => execFileSync('git', a, { cwd: dir, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t.invalid' } }).toString().trim();
      git('init', '-q');
      writeFileSync(join(dir, 'a.txt'), 'one\n');
      git('add', '.'); git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'a');
      const base = git('rev-parse', 'HEAD');
      writeFileSync(join(dir, 'a.txt'), 'two\n');
      git('-c', 'commit.gpgsign=false', 'commit', '-qam', 'b');
      const head = git('rev-parse', 'HEAD');
      /* 43b93a4e M-8: more pins and explicit flags; the bytes are re-derived from the recorded argv itself. */
      const argv = ['git', '--no-replace-objects', '-c', 'diff.noprefix=false', '-c', 'diff.renames=false', '-c', 'core.quotepath=false', '-c', 'diff.mnemonicPrefix=false',
        '-c', 'color.ui=never', '-c', 'diff.relative=false', '-c', 'diff.suppressBlankEmpty=false', '-c', 'core.autocrlf=false',
        '-c', 'diff.context=3', '-c', 'diff.interHunkContext=0', '-c', 'diff.orderFile=/dev/null', '-c', 'diff.srcPrefix=a/', '-c', 'diff.dstPrefix=b/',
        '-c', 'diff.algorithm=myers', '-c', 'diff.indentHeuristic=true', '-c', 'core.attributesFile=/dev/null', '-c', 'diff.wsErrorHighlight=none',
        '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.sshCommand=/bin/false', '-c', 'protocol.allow=never',
        '-c', 'core.pager=cat', '-c', 'diff.external=',
        /* Round 8 R7-2/R7-4. */ '-c', 'core.useReplaceRefs=false', '--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904', '-c', `safe.directory=${realpathSync(dir)}`,
        'diff', '--no-ext-diff', '--no-textconv', '--binary', '--no-renames', '--no-color', '--full-index',
        '-U3', '--inter-hunk-context=0', '-O/dev/null', '--src-prefix=a/', '--dst-prefix=b/', '--diff-algorithm=myers', '--indent-heuristic', `${base}..${head}`];
      const expected = execFileSync(argv[0] as string, argv.slice(1), { cwd: dir, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_ATTR_NOSYSTEM: '1' } });
      const runner = spawnVerifierRunner();
      const d = await recordGitDiff({ base, head, cwd: dir, runner });
      expect(d).toEqual({ label: E2_JULIUS_LABEL, base, head, cwd: dir, argv, exitCode: 0, sha256: createHash('sha256').update(expected).digest('hex'), bytes: expected.byteLength, ancestry: true, paths: ['a.txt'], isolated: true, isolationFindings: [], attributeFiles: [], objectDirRefusal: null });
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

/* PILOT H-3/H-4 (changed): the gate now grades the evidence FILE against an external anchor and a binding; its cases,
 * with a live-labelled capture, are in e2-evidence-gate-pilot.test.ts. Here: the published reasons. */
describe('E2 gate', () => {
  it('publishes every reason once', () => {
    expect(new Set(E2_GATE_REASONS).size).toBe(E2_GATE_REASONS.length);
    expect(E2_GATE_REASONS.length).toBe(48); /* Round 10: + e2_diff_objdir_invalid */
  });
  it('refuses when everything is absent, with every reason, never the diff alone', () => {
    const r = e2Gate({ streamLines: null, anchor: null, reexec: null, verifierSpec: null, diff: null, modelId: null, binding: null });
    expect(r).toEqual({ ok: false, reasons: ['e2_stream_absent', 'e2_reexec_absent', 'e2_diff_absent', 'e2_binding_absent', 'e2_model_absent'] });
  });
});
