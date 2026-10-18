import { createHash } from 'node:crypto';

import {
  JULIUS_SELF_TEST_LIMITS,
  type JuliusCoderSelfTestPort,
  type JuliusSelfTestCall,
  type JuliusSelfTestRecord,
  type JuliusSelfTestRefusal,
} from '../../src/relay/mission/julius/julius-coding-agent';
import { juliusSelfTestCommand, parseJuliusSelfTest } from './coder-workspace';
import type { ShellEffectPort } from './executor-effects';

/**
 * THE CODER'S SELF-TEST, RECORDED BY THE HARNESS (diagnostic telemetry, founder ruling 2026-10-18).
 *
 * The coder may be lent ONE tool that runs the mission's declared test command through the independent executor, a few
 * times at most, so it can see its own result mid-session. Everything about it is the harness' to say, not the coder's:
 *   - the call cap is enforced here; a call beyond it runs nothing and is recorded as refused;
 *   - the test runs in a COPY of the workspace inside the sandbox (`juliusSelfTestCommand`), so it cannot leave files in
 *     the directory the attempt's diff and own-change set are read from;
 *   - each call is recorded from what the executor returned: exit code, the size and sha256 of the full output, duration,
 *     and the working tree the test ran against (so "the coder edited between two runs" is derivable, not asserted);
 *   - it is NEVER a TEST evidence row and is never read by a verification. The post-session run stays the only TEST evidence.
 * `run` never throws: an executor failure is a refused call, not a failed dispatch, because a diagnostic must not be able to
 * fail the attempt it only observes.
 */

/** A self-test is bounded below the post-session test run's own allowance: it spends session time. */
export const SELF_TEST_TIMEOUT_MS = 120_000;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export function createCoderSelfTest(input: {
  readonly shell: ShellEffectPort;
  /** The same scope every other executor step of this attempt carries. */
  readonly scope: { readonly runId: string; readonly projectId: string; readonly taskId: string; readonly workerId: string };
  readonly testCommand: string;
  readonly maxCalls: number;
  readonly now?: () => number;
}): { readonly port: JuliusCoderSelfTestPort; record(): JuliusSelfTestRecord } {
  if (!Number.isInteger(input.maxCalls) || input.maxCalls < 1 || input.maxCalls >= JULIUS_SELF_TEST_LIMITS.maxCalls) {
    // One slot of the record is kept for the refusal that follows the last allowed call.
    throw new Error('coder_self_test_max_calls_invalid');
  }
  const now = input.now ?? Date.now;
  const calls: JuliusSelfTestCall[] = [];

  const refuse = (n: number, refused: JuliusSelfTestRefusal, started: number, treeBefore: string | null = null) => {
    // Beyond the record's own bound nothing more is kept: the cap has already been shown once.
    if (calls.length < JULIUS_SELF_TEST_LIMITS.maxCalls) {
      calls.push(Object.freeze({ n, exitCode: null, passed: false, refused, outputBytes: 0, outputDigest: null, durationMs: Math.max(0, now() - started), treeBefore }));
    }
    return { n, passed: false, exitCode: null, refused, outputTail: '' } as const;
  };

  const port: JuliusCoderSelfTestPort = {
    maxCalls: input.maxCalls,
    async run(signal) {
      const n = calls.length + 1;
      const started = now();
      if (signal?.aborted === true) return refuse(n, 'CANCELLED', started);
      if (n > input.maxCalls) return refuse(n, 'CALL_CAP', started);
      if (input.testCommand.trim() === '') return refuse(n, 'NO_TEST_DECLARED', started);
      let result;
      try {
        result = await input.shell.run({
          ...input.scope,
          invocationKey: `${input.scope.taskId}:selftest${n}`,
          command: juliusSelfTestCommand(input.testCommand),
          timeoutMs: SELF_TEST_TIMEOUT_MS,
        });
      } catch {
        return refuse(n, 'EXECUTOR_REFUSED', started);
      }
      const observed = parseJuliusSelfTest(result.stdout, result.stderr);
      if (observed.copyFailed) return refuse(n, 'COPY_FAILED', started, observed.treeBefore);
      const exitCode = observed.exitCode;
      const passed = exitCode === 0;
      calls.push(Object.freeze({
        n, exitCode, passed, refused: null,
        outputBytes: Buffer.byteLength(observed.output, 'utf8'),
        outputDigest: sha256(observed.output),
        durationMs: Math.max(0, now() - started),
        treeBefore: observed.treeBefore,
      }));
      const tail = observed.output.length > JULIUS_SELF_TEST_LIMITS.outputTailChars
        ? `[output truncated: the last ${JULIUS_SELF_TEST_LIMITS.outputTailChars} of ${observed.output.length} characters]\n${observed.output.slice(-JULIUS_SELF_TEST_LIMITS.outputTailChars)}`
        : observed.output;
      return { n, passed, exitCode, refused: null, outputTail: tail };
    },
  };
  return { port, record: () => Object.freeze({ calls: Object.freeze([...calls]) }) };
}
