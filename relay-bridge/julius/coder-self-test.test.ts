import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  JULIUS_CODING_AGENT_CHARTER,
  JULIUS_SELF_TEST_LIMITS,
  juliusCodingAgentCharter,
  readJuliusCodingAgentImplementation,
  readJuliusSelfTest,
  summarizeJuliusSelfTest,
  type JuliusCodingAgentProviderOutcome,
  type JuliusCodingAgentSession,
  type JuliusSelfTestCall,
} from '../../src/relay/mission/julius/julius-coding-agent';
import {
  JULIUS_CONTEXT_COMPILER_VERSION, JuliusDispatchError,
  type JuliusContextSnapshot, type JuliusProviderResult, type JuliusWorker,
} from '../../src/relay/mission/julius';
import { HOSTED_ALLOWED_TOOLS } from '../hosted-coding-agent/hosted-envelope';
import {
  buildSelfTestServer, HOSTED_SELF_TEST_SERVER, HOSTED_SELF_TEST_TOOL_ID, renderSelfTestResult, runHostedCodingAgent,
  type HostedQueryFn, type HostedSdkHelpers, type HostedSelfTestTool,
} from '../hosted-coding-agent/hosted-runner';
import { createClaudeCodeCodingAgentProvider } from './claude-code-coding-provider';
import { createCoderSelfTest, SELF_TEST_TIMEOUT_MS } from './coder-self-test';
import { juliusSelfTestCommand, parseJuliusSelfTest, SELF_TEST_OUTPUT_LIMIT } from './coder-workspace';
import { createFakeExecutorShell, createScriptedCodingAgentProvider } from './coding-agent-fixtures';
import type { ShellEffectInput, ShellEffectPort, ShellEffectResult } from './executor-effects';
import { createInMemoryArtifactExchange, createJuliusCodingAgentAdapter } from './live-workers';

/**
 * THE CODER'S SELF-TEST: DIAGNOSTIC TELEMETRY, RECORDED BY THE HARNESS, NEVER EVIDENCE (founder ruling 2026-10-18).
 *
 * From the kernel's reader up through a real shell, the recorder, the runner's SDK options, the provider and the adapter.
 * Nothing contacts a provider; the sandbox command runs in a real bash against a throwaway git repository.
 */

const TREE_A = 'a'.repeat(40);
const TREE_B = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);
const call = (over: Partial<JuliusSelfTestCall> & { n: number }): JuliusSelfTestCall => ({
  exitCode: 0, passed: true, refused: null, outputBytes: 10, outputDigest: DIGEST, durationMs: 5, treeBefore: TREE_A, ...over,
});

/* ------------------------------------------------------------------- the kernel's reader and summary */

describe('the kernel reads a self-test record from an allowlist and drops what it cannot trust', () => {
  it('round-trips a well-formed record and nothing else survives', () => {
    const record = { calls: [call({ n: 1, exitCode: 1, passed: false }), call({ n: 2, treeBefore: TREE_B })] };
    expect(readJuliusSelfTest({ ...record, smuggled: 'x' })).toEqual(record);
    expect(readJuliusSelfTest({ calls: [{ ...call({ n: 1 }), extra: 'x' }] })).toEqual({ calls: [call({ n: 1 })] });
  });

  it('drops a record that is malformed, over-long, out of order, or whose "passed" the harness data does not support', () => {
    const bad: unknown[] = [
      null, 'x', [], { calls: 'x' }, { calls: [null] },
      { calls: Array.from({ length: JULIUS_SELF_TEST_LIMITS.maxCalls + 1 }, (_, i) => call({ n: i + 1 })) },
      { calls: [call({ n: 2 })] },                                                      // numbering must be 1..n
      { calls: [call({ n: 1, passed: true, exitCode: 1 })] },                            // passed with a non-zero exit
      { calls: [call({ n: 1, passed: false, exitCode: 0 })] },                           // failed with a zero exit
      { calls: [call({ n: 1, passed: true, refused: 'CALL_CAP', exitCode: null })] },    // a refused call cannot have passed
      { calls: [call({ n: 1, refused: 'MADE_UP' as never })] },
      { calls: [call({ n: 1, outputDigest: 'nope' })] },
      { calls: [call({ n: 1, treeBefore: 'short' })] },
      { calls: [call({ n: 1, durationMs: -1 })] },
      { calls: [call({ n: 1, outputBytes: 1.5 })] },
    ];
    for (const value of bad) expect(readJuliusSelfTest(value), JSON.stringify(value).slice(0, 80)).toBeNull();
  });

  it('the implementation reader carries the record through, and null when absent or bad', () => {
    const base = { providerKind: 'generic-scripted', workspace: { captured: true, changes: [], truncated: false }, attempt: {}, attemptOutcome: 'SUCCEEDED' };
    expect(readJuliusCodingAgentImplementation(base)).not.toHaveProperty('selfTest');
    expect(readJuliusCodingAgentImplementation({ ...base, selfTest: { calls: [call({ n: 1 })] } })?.selfTest?.calls).toHaveLength(1);
    expect(readJuliusCodingAgentImplementation({ ...base, selfTest: { calls: [{ n: 9 }] } })).not.toHaveProperty('selfTest');
  });
});

describe('summarizeJuliusSelfTest: "fail then pass" needs an edit between, which only differing trees prove', () => {
  const sum = (calls: JuliusSelfTestCall[]) => summarizeJuliusSelfTest({ calls });
  it('a failing run then a passing run on a DIFFERENT tree is a self-repair', () => {
    expect(sum([call({ n: 1, exitCode: 1, passed: false }), call({ n: 2, treeBefore: TREE_B })])).toEqual({ executed: 2, refused: 0, passes: 1, failThenPass: true });
  });
  it('the same tree, an unknown tree, a pass first, a lone failure and refusals are not', () => {
    expect(sum([call({ n: 1, exitCode: 1, passed: false }), call({ n: 2 })]).failThenPass, 'same tree: a flaky test, not an edit').toBe(false);
    expect(sum([call({ n: 1, exitCode: 1, passed: false, treeBefore: null }), call({ n: 2, treeBefore: TREE_B })]).failThenPass).toBe(false);
    expect(sum([call({ n: 1 }), call({ n: 2, exitCode: 1, passed: false, treeBefore: TREE_B })]).failThenPass).toBe(false);
    expect(sum([call({ n: 1, exitCode: 1, passed: false })]).failThenPass).toBe(false);
    const refused = call({ n: 2, exitCode: null, passed: false, refused: 'CALL_CAP', outputDigest: null, treeBefore: null, outputBytes: 0 });
    expect(sum([call({ n: 1, exitCode: 1, passed: false }), refused])).toEqual({ executed: 1, refused: 1, passes: 0, failThenPass: false });
  });
});

/* ------------------------------------------------------------------- the sandbox command, in a real shell */

describe('juliusSelfTestCommand runs in a COPY, in a real shell, and never writes the live workspace', () => {
  let repo = '';
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'julius-selftest-repo-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-q');
    mkdirSync(join(repo, 'src'));
    writeFileSync(join(repo, 'src', 'a.txt'), 'hello\n');
    git('add', '-A');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed');
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); });

  const run = (testCommand: string): { code: number; stdout: string } => {
    try {
      return { code: 0, stdout: execFileSync('bash', ['-c', juliusSelfTestCommand(testCommand)], { cwd: repo, encoding: 'utf8' }) };
    } catch (error) {
      const failed = error as { status: number; stdout: string };
      return { code: failed.status, stdout: failed.stdout };
    }
  };
  const tree = (): string => {
    const index = join(tmpdir(), `julius-selftest-oracle-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    execFileSync('git', ['add', '-A', '--', '.'], { cwd: repo, env });
    const out = execFileSync('git', ['write-tree'], { cwd: repo, env, encoding: 'utf8' }).trim();
    rmSync(index, { force: true });
    return out;
  };
  const status = (): string => execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' });

  it('a passing test: exit 0, the test is seen in the copy, and the markers parse', () => {
    const result = run('grep -q hello src/a.txt && echo SUITE-GREEN');
    expect(result.code).toBe(0);
    const observed = parseJuliusSelfTest(result.stdout, '');
    expect(observed).toMatchObject({ exitCode: 0, copyFailed: false });
    expect(observed.treeBefore).toMatch(/^[0-9a-f]{40}$/u);
    expect(observed.output).toContain('SUITE-GREEN');
    expect(observed.output).not.toMatch(/SELFTEST_/u);
  });

  it('a failing test: its own exit code is the command\'s exit code and is parsed', () => {
    const result = run('echo FAILING; exit 3');
    expect(result.code).toBe(3);
    expect(parseJuliusSelfTest(result.stdout, '')).toMatchObject({ exitCode: 3 });
  });

  it('WRITES NOTHING TO THE LIVE WORKSPACE: build output made by the test is gone from the directory the diff is read from', () => {
    const before = readdirSync(repo).sort();
    const statusBefore = status();
    const result = run('echo built > artifact.txt; mkdir -p out; echo x > out/y; echo edited >> src/a.txt');
    expect(result.code).toBe(0);
    expect(readdirSync(repo).sort(), 'no file or directory appeared').toEqual(before);
    expect(status(), 'git sees no change at all').toBe(statusBefore);
    expect(readdirSync(join(repo, 'src'))).toEqual(['a.txt']);
  });

  it('the tree it reports is the working tree\'s, it moves when the coder edits, and the real index is untouched', () => {
    const statusBefore = status();
    const first = parseJuliusSelfTest(run('true').stdout, '').treeBefore;
    expect(first).toBe(tree());
    writeFileSync(join(repo, 'src', 'a.txt'), 'edited by the coder\n');
    const second = parseJuliusSelfTest(run('true').stdout, '').treeBefore;
    expect(second).toBe(tree());
    expect(second).not.toBe(first);
    expect(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' }), 'nothing staged').toBe('');
    expect(statusBefore).toContain('');
  });

  it('a test command ending in a comment cannot swallow the closing paren', () => {
    const result = run('true # a trailing comment');
    expect(result.code).toBe(0);
    expect(parseJuliusSelfTest(result.stdout, '').exitCode).toBe(0);
  });

  /* The Codex finding on PR #371: the executor keeps the BEGINNING of what a command prints (about 257 KB) and drops the rest, so a verdict
     printed LAST was lost by a talkative test. The header now comes first, measured inside the sandbox over the whole capture. */
  const EXECUTOR_OUTPUT_CAP = 257_377;
  const cutLikeTheExecutor = (stdout: string): string => stdout.slice(0, EXECUTOR_OUTPUT_CAP);

  it('a test that prints MUCH more than the executor\'s output cap still reports its exit code, size and full-output digest', () => {
    // About 2.4 MB of output, ending in a failure.
    const result = run('yes "a line of test output that is long enough to add up quickly" | head -n 40000; echo THE-LAST-LINE; exit 4');
    expect(result.code).toBe(4);
    const printed = 'a line of test output that is long enough to add up quickly\n'.repeat(40_000) + 'THE-LAST-LINE\n';
    // What the command itself prints is small, far under the cap, so the executor's cut cannot reach the header.
    expect(result.stdout.length).toBeLessThan(40_000);
    const observed = parseJuliusSelfTest(cutLikeTheExecutor(result.stdout), '');
    expect(observed).toMatchObject({ exitCode: 4, outputLimit: false, fullOutputBytes: Buffer.byteLength(printed, 'utf8') });
    expect(observed.fullOutputSha256).toBe(createHash('sha256').update(printed).digest('hex'));
    expect(observed.output, 'the coder is shown the TAIL, which holds the last line').toContain('THE-LAST-LINE');
    expect(Buffer.byteLength(observed.output, 'utf8')).toBeLessThanOrEqual(16_384);
  });

  it('the same for a passing test with a lot of output: a PASS is not read as an absent marker', () => {
    const result = run('yes "pass pass pass pass pass pass pass pass" | head -n 50000');
    expect(result.code).toBe(0);
    expect(parseJuliusSelfTest(cutLikeTheExecutor(result.stdout), '')).toMatchObject({ exitCode: 0, outputLimit: false });
  });

  it('a test that never stops talking is STOPPED at the capture bound and reported as OUTPUT_LIMIT, with no exit code', () => {
    const result = run('yes "never stop" ; true');
    expect(result.code, 'the command exits non-zero rather than inventing the test\'s code').toBe(125);
    const observed = parseJuliusSelfTest(result.stdout, '');
    expect(observed).toMatchObject({ outputLimit: true, exitCode: null, fullOutputBytes: SELF_TEST_OUTPUT_LIMIT });
    expect(observed.fullOutputSha256).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('a test cannot forge its own verdict by printing marker lines: only the header before the output is read', () => {
    const result = run('echo SELFTEST_EXIT 0; echo SELFTEST_OUTPUT_LIMIT; printf "SELFTEST_BYTES 1\\n"; exit 1');
    expect(result.code).toBe(1);
    const observed = parseJuliusSelfTest(result.stdout, '');
    expect(observed).toMatchObject({ exitCode: 1, outputLimit: false });
    expect(observed.fullOutputBytes).not.toBe(1);
    expect(observed.output).toContain('SELFTEST_EXIT 0');
  });

  it('stderr of the test is part of the measured output (merged in the sandbox), not lost', () => {
    const result = run('echo to-stdout; echo to-stderr 1>&2; exit 2');
    expect(result.code).toBe(2);
    const observed = parseJuliusSelfTest(result.stdout, '');
    expect(observed.output).toContain('to-stdout');
    expect(observed.output).toContain('to-stderr');
    expect(observed.fullOutputBytes).toBe('to-stdout\nto-stderr\n'.length);
  });
});

describe('parseJuliusSelfTest on outputs the sandbox may produce', () => {
  const HEADER = (extra: string): string => `SELFTEST_TREE ${TREE_A}\nSELFTEST_BYTES 123\nSELFTEST_SHA256 ${'a'.repeat(64)}\n${extra}SELFTEST_OUTPUT_BEGIN\n`;
  it('reads the header format: exit code, measurements and tail; markers inside the output are not read', () => {
    expect(parseJuliusSelfTest(`${HEADER('SELFTEST_EXIT 3\n')}tail\nSELFTEST_EXIT 0\n`, '')).toMatchObject({
      exitCode: 3, outputLimit: false, copyFailed: false, fullOutputBytes: 123, fullOutputSha256: 'a'.repeat(64), treeBefore: TREE_A, output: 'tail\nSELFTEST_EXIT 0\n',
    });
    expect(parseJuliusSelfTest(`${HEADER('SELFTEST_OUTPUT_LIMIT\n')}x`, '')).toMatchObject({ outputLimit: true, exitCode: null });
    expect(parseJuliusSelfTest(`${HEADER('SELFTEST_EXIT 0\n')}x`, 'executor stderr').output).toBe('x\nexecutor stderr');
  });
  it('a header with no verdict line reads as no exit code (the recorder then uses the executor\'s own status)', () => {
    expect(parseJuliusSelfTest(HEADER('') + 'x', '')).toMatchObject({ exitCode: null, outputLimit: false, fullOutputBytes: 123 });
  });
  it('reads a copy failure, an executor cut-off (no exit marker) and stderr', () => {
    expect(parseJuliusSelfTest(`SELFTEST_TREE ${TREE_A}\nSELFTEST_COPY_FAILED\n`, '')).toMatchObject({ copyFailed: true, exitCode: null, treeBefore: TREE_A });
    expect(parseJuliusSelfTest(`SELFTEST_TREE ${TREE_A}\npartial output`, '')).toMatchObject({ exitCode: null, copyFailed: false, output: 'partial output' });
    expect(parseJuliusSelfTest(`SELFTEST_TREE ${TREE_A}\nout\n\nSELFTEST_EXIT 2\n`, 'oops').output).toBe('out\noops');
  });
});

/* ------------------------------------------------------------------- the recorder */

const SCOPE = { runId: 'run-live', projectId: 'prj-live', taskId: 'build-1', workerId: 'coding-agent' };
const out = (tree: string, text: string, exit: number): ShellEffectResult => ({
  status: exit === 0 ? 'SUCCEEDED' : 'FAILED', exitCode: exit, stdout: `SELFTEST_TREE ${tree}\n${text}\nSELFTEST_EXIT ${exit}\n`, stderr: '', invocationId: `inv-${text}`,
});
function scriptedShell(results: (ShellEffectResult | Error)[]): ShellEffectPort & { inputs: ShellEffectInput[] } {
  const inputs: ShellEffectInput[] = [];
  return {
    inputs,
    async run(input) {
      inputs.push(input);
      const next = results[inputs.length - 1];
      if (next === undefined) throw new Error('unexpected extra executor call');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const SHA_FULL = 'b'.repeat(64);
const measured = (tree: string, verdict: string, bytes: number, tail: string, exitCode: number | null = 0): ShellEffectResult => ({
  status: exitCode === 0 ? 'SUCCEEDED' : 'FAILED', exitCode,
  stdout: `SELFTEST_TREE ${tree}\nSELFTEST_BYTES ${bytes}\nSELFTEST_SHA256 ${SHA_FULL}\n${verdict}SELFTEST_OUTPUT_BEGIN\n${tail}`, stderr: '', invocationId: 'inv-m',
});

describe('createCoderSelfTest on large outputs and cut outputs (Codex finding 2 on PR #371)', () => {
  it('a measured test: exit code and FULL-output size and digest come from the header, whatever the tail is', async () => {
    const test = createCoderSelfTest({ shell: scriptedShell([measured(TREE_A, 'SELFTEST_EXIT 1\n', 2_400_000, 'the tail\n', 1)]), scope: SCOPE, testCommand: 'npm test', maxCalls: 1 });
    expect(await test.port.run()).toMatchObject({ passed: false, exitCode: 1 });
    expect(test.record().calls[0]).toMatchObject({ exitCode: 1, passed: false, outputBytes: 2_400_000, outputDigest: SHA_FULL, outputBasis: 'FULL' });
    expect(readJuliusSelfTest(test.record())).toEqual(test.record());
  });

  it('a PASS whose marker was lost is recorded as a pass from the executor\'s own exit status, and its digest is labelled a PREFIX', async () => {
    // The executor's cap cut the output before any marker; its own status says the command exited 0.
    const cut: ShellEffectResult = { status: 'SUCCEEDED', exitCode: 0, stdout: `SELFTEST_TREE ${TREE_A}\n${'x'.repeat(5_000)}`, stderr: '', invocationId: 'inv-cut' };
    const test = createCoderSelfTest({ shell: scriptedShell([cut]), scope: SCOPE, testCommand: 'npm test', maxCalls: 1 });
    expect(await test.port.run()).toMatchObject({ passed: true, exitCode: 0 });
    const call = test.record().calls[0]!;
    expect(call).toMatchObject({ exitCode: 0, passed: true, outputBasis: 'PREFIX', outputBytes: 5_000 });
    expect(call.outputDigest).toBe(createHash('sha256').update('x'.repeat(5_000)).digest('hex'));
  });

  it('a FAIL whose marker was lost is a failure by the executor\'s status; a cut with no usable status has no exit code', async () => {
    const failCut: ShellEffectResult = { status: 'FAILED', exitCode: 7, stdout: `SELFTEST_TREE ${TREE_A}\nlots of output`, stderr: '', invocationId: 'i1' };
    const unknown: ShellEffectResult = { status: 'FAILED', exitCode: null, stdout: `SELFTEST_TREE ${TREE_A}\nlots of output`, stderr: '', invocationId: 'i2' };
    const test = createCoderSelfTest({ shell: scriptedShell([failCut, unknown]), scope: SCOPE, testCommand: 'npm test', maxCalls: 2 });
    await test.port.run(); await test.port.run();
    expect(test.record().calls[0]).toMatchObject({ exitCode: 7, passed: false, outputBasis: 'PREFIX' });
    expect(test.record().calls[1]).toMatchObject({ exitCode: null, passed: false, outputBasis: 'PREFIX' });
  });

  it('a test stopped at the capture bound has NO exit code and is labelled LIMIT; the executor\'s 125 is not its verdict', async () => {
    const limit = measured(TREE_A, 'SELFTEST_OUTPUT_LIMIT\n', 4_194_304, 'tail\n', 125);
    const test = createCoderSelfTest({ shell: scriptedShell([limit]), scope: SCOPE, testCommand: 'npm test', maxCalls: 1 });
    const shown = await test.port.run();
    expect(shown).toMatchObject({ passed: false, exitCode: null, refused: null });
    expect(shown.outputTail).toContain('no exit code');
    expect(test.record().calls[0]).toMatchObject({ exitCode: null, passed: false, outputBasis: 'LIMIT', outputBytes: 4_194_304, outputDigest: SHA_FULL });
    expect(readJuliusSelfTest(test.record())).toEqual(test.record());
  });

  it('the kernel reader refuses a LIMIT call that claims an exit code, and an unknown basis; an older record without a basis still reads', () => {
    const base = { n: 1, exitCode: null, passed: false, refused: null, outputBytes: 1, outputDigest: SHA_FULL, durationMs: 1, treeBefore: TREE_A };
    expect(readJuliusSelfTest({ calls: [{ ...base, outputBasis: 'LIMIT' }] })).not.toBeNull();
    expect(readJuliusSelfTest({ calls: [{ ...base, exitCode: 0, passed: true, outputBasis: 'LIMIT' }] }), 'LIMIT with an exit code').toBeNull();
    expect(readJuliusSelfTest({ calls: [{ ...base, outputBasis: 'WHOLE' }] }), 'unknown basis').toBeNull();
    expect(readJuliusSelfTest({ calls: [base] })!.calls[0]).not.toHaveProperty('outputBasis');
  });
});

describe('createCoderSelfTest: the harness records, the cap binds, a diagnostic cannot fail the attempt', () => {
  it('records exit code, size, digest of the FULL output, duration and tree, from the executor and not from the coder', async () => {
    const shell = scriptedShell([out(TREE_A, 'FAIL one\n', 1), out(TREE_B, 'PASS all\n', 0)]);
    let clock = 1_000;
    const test = createCoderSelfTest({ shell, scope: SCOPE, testCommand: 'npm test', maxCalls: 3, now: () => (clock += 7) });
    const first = await test.port.run();
    const second = await test.port.run();
    expect(first).toMatchObject({ n: 1, passed: false, exitCode: 1, refused: null });
    expect(second).toMatchObject({ n: 2, passed: true, exitCode: 0, refused: null });
    const record = test.record();
    expect(record.calls[0]).toMatchObject({ n: 1, exitCode: 1, passed: false, outputBytes: 'FAIL one\n'.length, treeBefore: TREE_A, durationMs: 7 });
    expect(record.calls[0]!.outputDigest).toBe(createHash('sha256').update('FAIL one\n').digest('hex'));
    expect(record.calls[1]).toMatchObject({ exitCode: 0, passed: true, treeBefore: TREE_B });
    expect(readJuliusSelfTest(record), 'the recorder\'s output satisfies the kernel\'s reader unchanged').toEqual(record);
    expect(summarizeJuliusSelfTest(record).failThenPass).toBe(true);
  });

  it('uses the self-test command, a unique key per call, the shared scope and a bounded timeout', async () => {
    const shell = scriptedShell([out(TREE_A, 'ok', 0), out(TREE_A, 'ok', 0)]);
    const test = createCoderSelfTest({ shell, scope: SCOPE, testCommand: 'npm test', maxCalls: 2 });
    await test.port.run(); await test.port.run();
    expect(shell.inputs.map((i) => i.invocationKey)).toEqual(['build-1:selftest1', 'build-1:selftest2']);
    expect(shell.inputs[0]).toMatchObject({ ...SCOPE, command: juliusSelfTestCommand('npm test'), timeoutMs: SELF_TEST_TIMEOUT_MS });
    expect(SELF_TEST_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });

  it('a call beyond the cap runs NOTHING and is recorded as refused', async () => {
    const shell = scriptedShell([out(TREE_A, 'ok', 0)]);
    const test = createCoderSelfTest({ shell, scope: SCOPE, testCommand: 'npm test', maxCalls: 1 });
    await test.port.run();
    const over = await test.port.run();
    expect(over).toMatchObject({ n: 2, passed: false, refused: 'CALL_CAP', exitCode: null });
    expect(shell.inputs, 'the executor was not asked a second time').toHaveLength(1);
    expect(test.record().calls[1]).toMatchObject({ refused: 'CALL_CAP', outputDigest: null });
    expect(summarizeJuliusSelfTest(test.record())).toMatchObject({ executed: 1, refused: 1 });
  });

  it('an executor failure, a cancelled signal, a copy failure and an empty test command are refusals, never throws', async () => {
    const failing = createCoderSelfTest({ shell: scriptedShell([new Error('executor down')]), scope: SCOPE, testCommand: 'npm test', maxCalls: 2 });
    expect(await failing.port.run()).toMatchObject({ refused: 'EXECUTOR_REFUSED', passed: false });
    const controller = new AbortController(); controller.abort();
    const shell2 = scriptedShell([]);
    const cancelled = createCoderSelfTest({ shell: shell2, scope: SCOPE, testCommand: 'npm test', maxCalls: 2 });
    expect(await cancelled.port.run(controller.signal)).toMatchObject({ refused: 'CANCELLED' });
    expect(shell2.inputs).toHaveLength(0);
    const copy = createCoderSelfTest({
      shell: scriptedShell([{ status: 'FAILED', exitCode: 90, stdout: `SELFTEST_TREE ${TREE_A}\nSELFTEST_COPY_FAILED\n`, stderr: '', invocationId: 'i' }]),
      scope: SCOPE, testCommand: 'npm test', maxCalls: 2,
    });
    expect(await copy.port.run()).toMatchObject({ refused: 'COPY_FAILED' });
    expect(copy.record().calls[0]).toMatchObject({ refused: 'COPY_FAILED', treeBefore: TREE_A });
    const none = createCoderSelfTest({ shell: scriptedShell([]), scope: SCOPE, testCommand: '   ', maxCalls: 2 });
    expect(await none.port.run()).toMatchObject({ refused: 'NO_TEST_DECLARED' });
  });

  it('shows the coder a bounded tail of a long output, saying that it is a tail, while the digest covers all of it', async () => {
    const long = `${'x'.repeat(10_000)}\nTAIL-MARKER\n`;
    const test = createCoderSelfTest({ shell: scriptedShell([out(TREE_A, long, 1)]), scope: SCOPE, testCommand: 'npm test', maxCalls: 1 });
    const result = await test.port.run();
    expect(result.outputTail.length).toBeLessThan(JULIUS_SELF_TEST_LIMITS.outputTailChars + 200);
    expect(result.outputTail).toContain('TAIL-MARKER');
    expect(result.outputTail).toContain('[output truncated');
    expect(test.record().calls[0]!.outputDigest).toBe(createHash('sha256').update(long).digest('hex'));
  });

  it('refuses a cap the record cannot hold: the record keeps one slot for the refusal after the last allowed call', () => {
    for (const bad of [0, 5, 6, 1.5, Number.NaN]) {
      expect(() => createCoderSelfTest({ shell: scriptedShell([]), scope: SCOPE, testCommand: 'npm test', maxCalls: bad })).toThrow('coder_self_test_max_calls_invalid');
    }
  });
});

/* ------------------------------------------------------------------- the runner's SDK options and the tool */

const WS = '/data/relay-workspaces/prj/run-1';
const clock = () => { let n = 0; return () => new Date(Date.UTC(2026, 9, 18, 12, 0, n++)).toISOString(); };
const messages = [
  { type: 'system', subtype: 'init', model: 'claude-opus-5-5-20260114', claude_code_version: '2.1.220', apiKeySource: 'ANTHROPIC_API_KEY', cwd: WS, tools: ['Read', 'Glob', 'Grep', 'Edit'] },
  { type: 'result', subtype: 'success', is_error: false, result: 'done', num_turns: 2, duration_ms: 1200, total_cost_usd: 0.01, usage: { input_tokens: 500, output_tokens: 60 }, permission_denials: [] },
];
const fakeHelpers = (): HostedSdkHelpers & { tools: unknown[]; servers: unknown[] } => {
  const tools: unknown[] = []; const servers: unknown[] = [];
  return {
    tools, servers,
    tool: (name, description, inputSchema, handler) => { const d = { name, description, inputSchema, handler }; tools.push(d); return d; },
    createSdkMcpServer: (options) => { const s = { type: 'sdk', ...options }; servers.push(s); return s; },
  };
};
const tinyTool = (): HostedSelfTestTool & { calls: number } => {
  const t = { calls: 0, maxCalls: 2, async run() { t.calls += 1; return { n: t.calls, passed: false, exitCode: 1, refused: null, outputTail: 'boom' }; } };
  return t;
};

describe('the runner offers the tool only when told to, and exactly one', () => {
  const optionsFor = async (extra: Record<string, unknown>) => {
    let seen: Record<string, unknown> = {};
    const fn: HostedQueryFn = (params) => { seen = params.options; return (async function* () { for (const m of messages) yield m; })(); };
    await runHostedCodingAgent({ queryFn: fn, prompt: 'p', workspacePath: WS, apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-opus-5-5', now: clock(), ...extra });
    return seen;
  };

  it('absent: no mcpServers key and the allowed tools are exactly the file tools', async () => {
    const options = await optionsFor({});
    expect('mcpServers' in options).toBe(false);
    expect(options.allowedTools).toEqual([...HOSTED_ALLOWED_TOOLS]);
  });

  it('present: one server named julius, one sanctioned tool id added to the allowed list, nothing else changed', async () => {
    const plain = await optionsFor({});
    const helpers = fakeHelpers();
    const options = await optionsFor({ selfTestTool: tinyTool(), sdkHelpers: helpers });
    expect(Object.keys(options.mcpServers as object)).toEqual([HOSTED_SELF_TEST_SERVER]);
    expect(options.allowedTools).toEqual([...HOSTED_ALLOWED_TOOLS, HOSTED_SELF_TEST_TOOL_ID]);
    expect(HOSTED_SELF_TEST_TOOL_ID).toBe('mcp__julius__run_mission_test');
    expect(options.disallowedTools).toEqual(plain.disallowedTools);
    expect(options.disallowedTools).toContain('Bash');
    expect(Object.keys(options).filter((k) => k !== 'mcpServers').sort()).toEqual(Object.keys(plain).sort());
    expect(helpers.tools).toHaveLength(1);
    expect((helpers.tools[0] as { name: string; inputSchema: object }).name).toBe('run_mission_test');
    expect((helpers.tools[0] as { inputSchema: object }).inputSchema, 'the tool takes no arguments').toEqual({});
  });

  it('a self-test tool without the SDK helpers is a programming error, not a silent omission', async () => {
    await expect(optionsFor({ selfTestTool: tinyTool() })).rejects.toThrow('hosted_self_test_needs_sdk_helpers');
  });

  it('the handler calls the harness, hands the coder the result, and says it is not completion; a refusal is an error result', async () => {
    const tool = tinyTool(); const helpers = fakeHelpers();
    const { handler } = buildSelfTestServer(helpers, tool, () => undefined);
    const result = await handler();
    expect(tool.calls).toBe(1);
    expect(result.content[0]!.text).toContain('Self-test 1 of 2: FAILED (exit 1).');
    expect(result.content[0]!.text).toContain('boom');
    expect(result.content[0]!.text).toContain('Julius runs the verification separately and decides completion');
    expect(result.isError).toBe(false);
    const refused = renderSelfTestResult({ n: 3, passed: false, exitCode: null, refused: 'CALL_CAP', outputTail: '' }, 2);
    expect(refused).toContain('NOT RUN (CALL_CAP)');
  });
});

/* ------------------------------------------------------------------- the provider and the charter */

describe('the charter changes only when a self-test is offered', () => {
  it('with none it is the SAME string; with one it names the tool, the cap and what the tool is not', () => {
    expect(juliusCodingAgentCharter()).toBe(JULIUS_CODING_AGENT_CHARTER);
    const offered = juliusCodingAgentCharter(3);
    expect(offered).not.toBe(JULIUS_CODING_AGENT_CHARTER);
    expect(offered).toContain('run_mission_test');
    expect(offered).toContain('at most 3 times');
    expect(offered).toContain('does not complete or verify your work');
    expect(offered).not.toContain('Do not run commands;');
    expect(offered.startsWith('You are the Coding Agent')).toBe(true);
  });
});

const WORKER: JuliusWorker = {
  workerId: 'coding-agent', role: 'CODING_AGENT', adapterId: 'coding-agent-adapter', providerId: 'any',
  capabilities: ['implement'], taskTypes: ['build', 'repair:build'], concurrencyLimit: 1, timeoutMs: 1_000, maxRetries: 1, status: 'AVAILABLE',
};
const CHARGE = Object.freeze({
  stage: 'build' as const,
  binding: { contractId: 'contract:run-live:build-1', taskId: 'build-1', contractRevision: 2, bindingDigest: `sha256:${'b'.repeat(64)}` },
  objective: 'Normalize the mission label.', responsibilityBoundary: 'Only the slug module.',
  inScope: ['src/slug.ts'], outOfScope: ['src/persistence/'], permittedPaths: ['src/slug.ts'],
  prohibitedActions: ['adding a dependency'], blockingCriteria: ['[AC-1] The slug test passes.'], contractReviewCriteria: ['AC-1 holds'],
  requiredEvidence: ['TEST'] as const, requiredChecks: ['npm test'], failureConditions: ['AC-1 fails'], stoppingCondition: 'The suite is green.',
});
const snapshot = (): JuliusContextSnapshot => ({
  contextId: 'ctx-1', runId: 'run-live', taskId: 'build-1', workerId: WORKER.workerId, workerRole: 'CODING_AGENT',
  compilerVersion: JULIUS_CONTEXT_COMPILER_VERSION, missionContractRevision: 1, cardRevision: 'card-1', projectBrainRevision: 3,
  taskContractRevision: 2, taskContractDigest: CHARGE.binding.bindingDigest, sourceEntryIds: ['brain:objective'], dependencyTaskIds: [], evidenceIds: [], findingIds: [],
  acceptanceCriterionIds: ['AC-1'], contentHash: 'sha256:test', characterCount: 40, redactionCount: 0, truncated: false,
  integrityVersion: null, integrityConflicts: null, integrityExcludedEntryIds: null, integrityEvictedEntryIds: null,
  packet: { missionId: 'mission-1', taskId: 'build-1', workerId: WORKER.workerId, sourceEntryIds: ['brain:objective'], blocks: [{ kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize.' }], truncated: false },
});
const DISPATCH = {
  taskId: 'build-1', contextId: 'ctx-1', taskType: 'build', attempt: { leaseGeneration: 1 }, reads: { plan: { taskId: 'plan-1', leaseGeneration: 1 } },
  contract: CHARGE, allocation: { usdMicros: 2_000_000, policyVersion: 'v3', basis: 'CODER_SHARE' },
};

describe('the Claude Code provider hands the tool to the runner and the charter to the prompt, only when a session carries one', () => {
  const seen: { input: Record<string, unknown> }[] = [];
  const provider = (over: Record<string, unknown> = {}) => createClaudeCodeCodingAgentProvider({
    apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-opus-5-5',
    queryLoader: async () => (() => (async function* () { /* never reached */ })()) as never,
    run: (async (input: Record<string, unknown>) => { seen.push({ input }); return { kind: 'refused', safeMessage: 'stop', reason: 'x', observation: null }; }) as never,
    ...over,
  });
  const request = async () => {
    const captured: { r?: unknown } = {};
    const adapter = createJuliusCodingAgentAdapter({
      worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts: (() => { const a = createInMemoryArtifactExchange(); a.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, '{}'); return a; })(),
      projectId: 'prj-live', workspacePath: '/workspace/mission', testCommand: 'npm test', shell: createFakeExecutorShell({}),
      provider: { providerKind: 'capture', async execute(r) { captured.r = r; return { kind: 'failed', failure: 'CANCELLED', runtimeStarted: false, costUsdMicros: null, safeMessage: 'x', providerFailureClass: 'x', diagnostics: {} }; } },
    });
    await adapter.dispatch(DISPATCH as never).then(() => null, () => null);
    return captured.r as never;
  };

  it('no session: the runner gets no tool and no helpers, and the prompt carries the original charter', async () => {
    seen.length = 0;
    await provider().execute(await request());
    expect(seen).toHaveLength(1);
    expect('selfTestTool' in seen[0]!.input).toBe(false);
    expect('sdkHelpers' in seen[0]!.input).toBe(false);
    expect(String(seen[0]!.input.prompt)).toContain(JULIUS_CODING_AGENT_CHARTER);
  });

  it('a session with a self-test: the runner gets the port and the helpers, and the prompt names the tool', async () => {
    seen.length = 0;
    const helpers = fakeHelpers();
    const session: JuliusCodingAgentSession = { selfTest: createCoderSelfTest({ shell: scriptedShell([]), scope: SCOPE, testCommand: 'npm test', maxCalls: 2 }).port };
    await provider({ sdkHelpersLoader: async () => helpers }).execute(await request(), undefined, session);
    expect(seen[0]!.input.selfTestTool).toBe(session.selfTest);
    expect(seen[0]!.input.sdkHelpers).toBe(helpers);
    expect(String(seen[0]!.input.prompt)).toContain('run_mission_test');
    expect(String(seen[0]!.input.prompt)).not.toContain('Do not run commands;');
  });

  it('helpers that cannot be loaded fail the launch with a named class; the session never starts', async () => {
    seen.length = 0;
    const session: JuliusCodingAgentSession = { selfTest: createCoderSelfTest({ shell: scriptedShell([]), scope: SCOPE, testCommand: 'npm test', maxCalls: 2 }).port };
    const outcome = await provider({ sdkHelpersLoader: async () => { throw new Error('no sdk'); } }).execute(await request(), undefined, session) as JuliusCodingAgentProviderOutcome;
    expect(outcome).toMatchObject({ kind: 'failed', failure: 'LAUNCH_FAILED', runtimeStarted: false, providerFailureClass: 'coder_self_test_helpers_unavailable' });
    expect(seen).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------- the adapter, end to end */

/** A shell that answers the self-test steps from a script and everything else like the usual fake executor. */
function shellWithSelfTests(script: ShellEffectResult[], base = createFakeExecutorShell({ testExitCode: 0 })) {
  const selfTests: ShellEffectInput[] = [];
  const port: ShellEffectPort & { selfTests: ShellEffectInput[]; invocations: ShellEffectInput[] } = {
    selfTests,
    get invocations() { return base.invocations; },
    async run(input) {
      if (input.invocationKey.includes(':selftest')) { selfTests.push(input); return script[selfTests.length - 1]!; }
      return base.run(input);
    },
  };
  return port;
}
const PLAN = JSON.stringify({ objectiveSummary: 'Normalize.', steps: ['edit'] });
function adapterFor(provider: Parameters<typeof createJuliusCodingAgentAdapter>[0]['provider'], shell: ShellEffectPort, selfTestCalls?: number) {
  const artifacts = createInMemoryArtifactExchange();
  artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, PLAN);
  return createJuliusCodingAgentAdapter({
    worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
    workspacePath: '/workspace/mission', testCommand: 'npm test', shell, provider,
    ...(selfTestCalls === undefined ? {} : { selfTestCalls }),
  });
}
/** A provider that self-tests `times` times, then completes. */
function selfTestingProvider(times: number) {
  const inner = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
  const sessions: (JuliusCodingAgentSession | undefined)[] = [];
  return {
    sessions,
    provider: {
      providerKind: 'self-testing',
      async execute(request: Parameters<typeof inner.execute>[0], signal?: AbortSignal, session?: JuliusCodingAgentSession) {
        sessions.push(session);
        for (let i = 0; i < times; i += 1) await session?.selfTest?.run(signal);
        return inner.execute(request, signal);
      },
    },
  };
}

describe('the live adapter: the self-test is recorded as telemetry and changes nothing the verification reads', () => {
  const impl = (result: unknown) => (result as JuliusProviderResult & { implementation?: Record<string, unknown> }).implementation;

  it('absent: no session reaches the provider, the record has no selfTest key, and the executor runs no self-test', async () => {
    const shell = shellWithSelfTests([]);
    const { provider, sessions } = selfTestingProvider(2);
    const result = await adapterFor(provider, shell).dispatch(DISPATCH as never);
    expect(sessions).toEqual([undefined]);
    expect('selfTest' in impl(result)!).toBe(false);
    expect(shell.selfTests).toHaveLength(0);
  });

  it('declared: two self-tests are recorded in order, the second after an edit, and the record satisfies the kernel reader', async () => {
    const shell = shellWithSelfTests([out(TREE_A, 'FAIL', 1), out(TREE_B, 'PASS', 0)]);
    const { provider, sessions } = selfTestingProvider(2);
    const result = await adapterFor(provider, shell, 3).dispatch(DISPATCH as never);
    expect(sessions[0]?.selfTest?.maxCalls).toBe(3);
    const record = readJuliusCodingAgentImplementation(impl(result))?.selfTest;
    expect(record?.calls.map((c) => [c.n, c.exitCode, c.passed, c.treeBefore])).toEqual([[1, 1, false, TREE_A], [2, 0, true, TREE_B]]);
    expect(summarizeJuliusSelfTest(record!)).toEqual({ executed: 2, refused: 0, passes: 1, failThenPass: true });
  });

  it('THE VERIFICATION IS UNTOUCHED: the same evidence types, and the post-session test is still run once, by its own step', async () => {
    const withShell = shellWithSelfTests([out(TREE_A, 'FAIL', 1), out(TREE_B, 'PASS', 0)]);
    const withResult = await adapterFor(selfTestingProvider(2).provider, withShell, 3).dispatch(DISPATCH as never);
    const plainShell = shellWithSelfTests([]);
    const plainResult = await adapterFor(selfTestingProvider(0).provider, plainShell).dispatch(DISPATCH as never);
    const types = (r: unknown) => (r as unknown as { evidence: { type: string }[] }).evidence.map((e) => e.type);
    expect(types(withResult)).toEqual(types(plainResult));
    expect(types(withResult).filter((t) => t === 'TEST')).toHaveLength(1);
    const testSteps = (s: { invocations: ShellEffectInput[] }) => s.invocations.filter((i) => i.invocationKey === 'build-1:test').length;
    expect(testSteps(withShell)).toBe(1);
    expect(testSteps(plainShell)).toBe(1);
    expect(withShell.selfTests.every((i) => i.command === juliusSelfTestCommand('npm test'))).toBe(true);
    // the TEST evidence is the post-session run's, not either self-test's
    const testRow = (withResult as unknown as { evidence: { type: string; safeSummary: string }[] }).evidence.find((e) => e.type === 'TEST')!;
    expect(testRow.safeSummary).toContain('under executor invocation');
    expect(testRow.safeSummary).not.toMatch(/selftest/u);
  });

  it('the cap binds through the real adapter: a third call is refused and the executor ran two', async () => {
    const shell = shellWithSelfTests([out(TREE_A, 'FAIL', 1), out(TREE_B, 'FAIL', 1)]);
    const result = await adapterFor(selfTestingProvider(3).provider, shell, 2).dispatch(DISPATCH as never);
    expect(shell.selfTests).toHaveLength(2);
    const record = readJuliusCodingAgentImplementation(impl(result))?.selfTest;
    expect(record?.calls.map((c) => c.refused)).toEqual([null, null, 'CALL_CAP']);
  });

  it('a FAILED attempt still carries what its self-tests recorded', async () => {
    const shell = shellWithSelfTests([out(TREE_A, 'FAIL', 1)]);
    const provider = {
      providerKind: 'self-testing-then-fails',
      async execute(_request: unknown, signal?: AbortSignal, session?: JuliusCodingAgentSession): Promise<JuliusCodingAgentProviderOutcome> {
        await session?.selfTest?.run(signal);
        return { kind: 'failed', failure: 'RATE_LIMITED', runtimeStarted: true, costUsdMicros: null, safeMessage: 'limited', providerFailureClass: 'rate', diagnostics: {} } as JuliusCodingAgentProviderOutcome;
      },
    };
    const refusal = await adapterFor(provider as never, shell, 2).dispatch(DISPATCH as never).then(() => null, (e: unknown) => e as JuliusDispatchError);
    expect(refusal).toBeInstanceOf(JuliusDispatchError);
    const record = readJuliusCodingAgentImplementation((refusal as unknown as { implementation?: unknown }).implementation)?.selfTest;
    expect(record?.calls).toHaveLength(1);
    expect(record?.calls[0]).toMatchObject({ exitCode: 1, passed: false });
  });

  it('no self-test is offered to a mission with no declared test command', async () => {
    const artifacts = createInMemoryArtifactExchange();
    artifacts.seed({ kind: 'PLAN', runId: 'run-live', taskId: 'plan-1', leaseGeneration: 1, role: 'PROMPT_ARCHITECT' }, PLAN);
    const { provider, sessions } = selfTestingProvider(1);
    const adapter = createJuliusCodingAgentAdapter({
      worker: WORKER, contexts: { snapshotFor: () => snapshot() }, artifacts, projectId: 'prj-live',
      workspacePath: '/workspace/mission', testCommand: '', shell: createFakeExecutorShell({}), provider, selfTestCalls: 2,
    });
    await adapter.dispatch(DISPATCH as never);
    expect(sessions).toEqual([undefined]);
  });
});

/* ------------------------------------------------------------------- the evidence the bundle carries, and who may read it */

describe('the self-test telemetry reaches the evidence bundle by exact name, and no scorer reads it', () => {
  const ROOT = join(__dirname, '..', '..');
  const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

  it('the workspace-events dump projects exactly the fact keys the pipeline writes, under the four column names', () => {
    const dump = read('.github/julius-live-evidence-dump.sh');
    const line = dump.split('\n').find((l) => l.includes('AS attempt_outcome')) ?? '';
    expect(line, 'the dump line carrying the attempt facts is found').not.toBe('');
    const columns = [
      ['selfTestCalls', 'self_test_calls'], ['selfTestRefused', 'self_test_refused'], ['selfTestPasses', 'self_test_passes'], ['selfTestFailThenPass', 'self_test_fail_then_pass'],
    ] as const;
    for (const [fact, column] of columns) expect(line, column).toContain(`e.payload->'facts'->>'${fact}' AS ${column}`);
    const pipeline = read('src/relay/mission/julius/julius-task-pipeline.ts');
    for (const key of ['selfTestCalls', 'selfTestRefused', 'selfTestPasses', 'selfTestFailThenPass']) expect(pipeline, key).toContain(key);
    // the dump is a projection of an event that is emitted only for the workspace and scope facts, never a TEST evidence row
    expect(line).toContain("'julius.coder.attempt.workspace'");
  });

  it('NO SCORER OR VERIFIER NAMES THE TELEMETRY: the readers of scope.tsv and the learning/repair/verification modules never mention it', () => {
    const scorers = [
      'scripts/wonderland-beta-gate.mjs', 'scripts/julius-carry-verify.ts',
      'src/relay/mission/julius/julius-learning-loop.ts', 'src/relay/mission/julius/julius-learning-record.ts',
      'src/relay/mission/julius/julius-repair-lineage.ts', 'src/relay/mission/julius/julius-repair-round.ts',
      'src/relay/mission/julius/julius-repair-runtime.ts', 'src/relay/mission/julius/julius-verification-runtime.ts',
      'src/relay/mission/julius/julius-carry-verify.ts', 'src/relay/mission/julius/julius-lineage-asserter.ts',
      'src/relay/mission/julius/julius-segment-lineage.ts',
    ];
    const python = (directory: string): string[] => readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? (entry.name === '__pycache__' ? [] : python(`${directory}/${entry.name}`)) : entry.name.endsWith('.py') ? [`${directory}/${entry.name}`] : []);
    const files = [...scorers, ...python('python/julius_brain_intel')];
    expect(files.length).toBeGreaterThan(20);
    const mentions = files.filter((file) => /self[_-]?test/iu.test(read(file)));
    expect(mentions, 'a scorer that starts reading self-test telemetry must be a reviewed, deliberate change').toEqual([]);
  });

  it('the kernel never turns a self-test into evidence: the attempt record is the only place it is read', () => {
    const kernel = readdirSync(join(ROOT, 'src/relay/mission/julius')).filter((file) => file.endsWith('.ts') && !/\.test\./u.test(file));
    const readers = kernel.filter((file) => /selfTest/u.test(read(`src/relay/mission/julius/${file}`))).sort();
    expect(readers).toEqual(['julius-coding-agent.ts', 'julius-task-pipeline.ts']);
    // and in the pipeline it is only summarised into attempt-event facts: it is never an argument to a verification or a decision
    const pipeline = read('src/relay/mission/julius/julius-task-pipeline.ts');
    expect(pipeline.match(/selfTest/gu)?.length ?? 0).toBeLessThan(12);
    expect(pipeline).not.toMatch(/evidence[^\n]{0,80}selfTest|selfTest[^\n]{0,80}evidence/u);
  });
});
