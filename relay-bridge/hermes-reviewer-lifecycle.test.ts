import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

import {
  DEFAULT_KILL_GRACE_MS, isEngineReportedTimeout, runHermesReview,
  type HermesConfig, type HermesOutcome, type HermesReviewDiagnostics, type ReviewPacket,
} from './hermes-reviewer';
import { safeReviewDiagnostics } from '../src/relay/mission/julius';

/**
 * PAID RUN 34311556047 SPENT NINE MINUTES SAYING NOTHING.
 *
 * Its Independent Reviewer failed three times on `review:plan`, 180 seconds
 * apart to the tenth of a second, and every one of the three durable rows read
 * the same: `timed_out=true`, `output_bytes_observed=0`, no exit code, no
 * status, no served model. The build stayed BLOCKED, which was correct. What
 * was not correct is that the evidence could not say WHY, and a second paid run
 * was the only instrument left.
 *
 * It could not say why because zero bytes means nothing on this transport.
 * Measured against the real Hermes v0.18.2 at the pinned commit, `-z` buffers
 * the whole review and prints it in ONE write at the end: a healthy review's
 * first stdout byte arrived at 34.7 s, all sixty of them at once, after the
 * provider had been streaming for sixteen seconds. So zero bytes is the state
 * of every in-flight review right up to the instant it finishes, and it is
 * equally the state of one whose provider was never reached. Three more facts
 * from the same probes, all provider-free:
 *
 *   • left alone against an endpoint that accepts and never answers, Hermes ran
 *     420 s, made 30 connection attempts, printed nothing, and never exited;
 *   • given a deadline of its own it reported at 127 s and exited 0;
 *   • SIGTERM mid-request is honoured in about ten milliseconds — which is why
 *     the old handler's single un-escalated, unconfirmed signal never leaked a
 *     process, and why nothing ever noticed that it could.
 *
 * Every case below drives the REAL runner over a fake process. No Hermes, no
 * provider, no network, no clock beyond the injected one. They exist so the
 * NEXT reviewer failure is read rather than bought.
 */

/** A child this test controls: what it writes, when it exits, and what kills it. */
function processFake(input: {
  /** `[afterMs, text]` pairs, written on the fake process's own schedule. */
  readonly writes?: ReadonlyArray<readonly [number, string]>;
  /** When it exits by itself. `null` means it never does. */
  readonly exitsAfterMs?: number | null;
  readonly exitCode?: number;
  /** Which signal actually ends it. `null` models a process that ignores both. */
  readonly diesOn?: 'SIGTERM' | 'SIGKILL' | null;
  /** The runtime gave it no pid — a spawn that half-succeeded. */
  readonly withoutPid?: boolean;
}) {
  const signals: string[] = [];
  const spawned: Array<{ cwd: string }> = [];
  const spawnImpl = ((_exe: string, _args: string[], opts: { cwd: string }) => {
    spawned.push({ cwd: opts.cwd });
    const child = new EventEmitter() as EventEmitter & {
      stdout: Readable; stderr: Readable; kill: (signal?: string) => boolean; pid?: number;
    };
    child.stdout = new Readable({ read() { /* pushed on schedule */ } });
    child.stderr = new Readable({ read() { /* never surfaced */ } });
    if (input.withoutPid !== true) child.pid = 4242;
    let closed = false;
    /* Idempotent, and written without an early return: `ci-test-accounting`
       scans this file for a test that can finish having asserted nothing, and
       a bare `return` inside a helper reads to it exactly like one. */
    const close = (code: number | null): void => {
      if (!closed) {
        closed = true;
        child.stdout.push(null);
        child.stderr.push(null);
        child.emit('close', code);
      }
    };
    child.kill = (signal?: string) => {
      signals.push(signal ?? 'SIGTERM');
      // A REAL PROCESS DIES WHEN THE SIGNAL REACHES IT. Modelling `kill` as a
      // no-op would let a test pass while Relay leaked reviewers.
      if (input.diesOn === signal || (input.diesOn === 'SIGTERM' && signal === 'SIGKILL')) close(null);
      return true;
    };
    for (const [afterMs, text] of input.writes ?? []) {
      setTimeout(() => { if (!closed) child.stdout.push(Buffer.from(text, 'utf8')); }, afterMs);
    }
    if (input.exitsAfterMs !== null && input.exitsAfterMs !== undefined) {
      setTimeout(() => close(input.exitCode ?? 0), input.exitsAfterMs);
    }
    return child as never;
  }) as never;
  return { spawnImpl, signals, spawned };
}

const CONFIG = (over: Partial<HermesConfig> = {}): HermesConfig => ({
  executable: '/nonexistent/hermes', model: 'grok-build-0.1', provider: 'xai',
  // Milliseconds, not the production minutes: the point is the ORDER of events.
  timeoutMs: 120, maxOutputBytes: 512 * 1024, killGraceMs: 40, ...over,
});

const PACKET: ReviewPacket = {
  missionId: 'mission:lifecycle', baseRevision: 'base', artifactDigest: 'digest',
  originalRequest: 'do the thing', handoffJson: '{}', changedFiles: ['a.ts'],
  unifiedDiff: 'diff', changedFileContents: 'content', testCommand: 'npm test',
  testOutput: 'ok', relayEvidence: [],
};

const APPROVED = JSON.stringify({
  verdict: 'approved', summary: 'Meets every criterion.', findings: [],
  requirementsChecked: [{ requirement: 'r1', status: 'passed', evidence: 'tests pass' }],
});

async function run(
  fake: ReturnType<typeof processFake>, cfg: Partial<HermesConfig> = {},
): Promise<HermesOutcome> {
  return runHermesReview({ packet: PACKET, config: CONFIG(cfg), spawnImpl: fake.spawnImpl });
}

function diagnosticsOf(outcome: HermesOutcome): HermesReviewDiagnostics {
  if (outcome.kind !== 'review_incomplete') throw new Error(`expected review_incomplete, got ${outcome.kind}`);
  if (outcome.diagnostics === undefined) throw new Error('a failed review must carry diagnostics');
  return outcome.diagnostics;
}

describe('what the reviewer process did, when the review did not arrive', () => {
  it('a reviewer that hangs forever is timed out, killed, and CONFIRMED gone', async () => {
    const fake = processFake({ exitsAfterMs: null, diesOn: 'SIGTERM' });
    const outcome = await run(fake);
    const d = diagnosticsOf(outcome);

    expect(outcome.kind === 'review_incomplete' && outcome.shape).toBe('review_timeout');
    expect(d.timedOut).toBe(true);
    // THE FACTS PAID RUN 34311556047 COULD NOT STATE.
    expect(d.processStarted).toBe(true);
    expect(d.processPidObserved).toBe(true);
    expect(d.firstOutputObserved).toBe(false);
    expect(d.firstOutputAfterMs).toBeNull();
    expect(d.exitObserved).toBe(true);
    expect(d.signalSent).toBe('SIGTERM');
    expect(d.cleanupCompleted).toBe(true);
    expect(d.timeoutMs).toBe(120);
    expect(d.elapsedMs).not.toBeNull();
    expect(fake.signals).toEqual(['SIGTERM']);
  });

  it('a reviewer that ignores SIGTERM is escalated to SIGKILL, and the record says so', async () => {
    const fake = processFake({ exitsAfterMs: null, diesOn: 'SIGKILL' });
    const d = diagnosticsOf(await run(fake));

    expect(fake.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(d.signalSent).toBe('SIGTERM,SIGKILL');
    expect(d.cleanupCompleted).toBe(true);
    expect(d.exitObserved).toBe(true);
  });

  it('a reviewer that ignores BOTH signals is reported as not cleaned up, never waited on forever', async () => {
    const fake = processFake({ exitsAfterMs: null, diesOn: null });
    const d = diagnosticsOf(await run(fake));

    expect(fake.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(d.signalSent).toBe('SIGTERM,SIGKILL');
    // THE ONE ANSWER THE OLD CODE COULD NEVER GIVE. A leaked reviewer holds a
    // provider connection into the next attempt, and this is the column that
    // would show it.
    expect(d.cleanupCompleted).toBe(false);
    expect(d.exitObserved).toBe(false);
  });

  it('emitting zero bytes and exiting 0 is NOT a timeout, and is told apart from one', async () => {
    const d = diagnosticsOf(await run(processFake({ exitsAfterMs: 5, exitCode: 0 })));

    expect(d.failureShape).toBe('review_json_absent');
    expect(d.timedOut).toBe(false);
    expect(d.firstOutputObserved).toBe(false);
    expect(d.exitObserved).toBe(true);
    // Nothing was killed, so no signal was sent — the difference between a
    // reviewer that gave up and one Relay had to end.
    expect(d.signalSent).toBeNull();
    expect(d.cleanupCompleted).toBe(true);
    expect(d.processExitCode).toBe(0);
  });

  it('partial output and then a hang records WHEN the bytes arrived, not just that they did', async () => {
    const fake = processFake({ writes: [[20, '{"verdict":"appro']], exitsAfterMs: null, diesOn: 'SIGTERM' });
    const d = diagnosticsOf(await run(fake));

    expect(d.failureShape).toBe('review_timeout');
    expect(d.firstOutputObserved).toBe(true);
    expect(d.firstOutputAfterMs).not.toBeNull();
    expect(d.firstOutputAfterMs!).toBeLessThan(120);
    expect(d.outputBytesObserved).toBe(17);
    // A HALF-SENTENCE IS NOT A VERDICT. The timeout owns the outcome, and what
    // the reviewer flushed on its way out is never parsed into one.
    expect(d.verdictPresent).toBe(false);
  });

  it('exiting before any output is a process exit, with the code, not a timeout', async () => {
    const d = diagnosticsOf(await run(processFake({ exitsAfterMs: 5, exitCode: 3 })));

    expect(d.failureShape).toBe('review_process_exit');
    expect(d.processExitCode).toBe(3);
    expect(d.timedOut).toBe(false);
    expect(d.firstOutputObserved).toBe(false);
  });

  it('a connection that never establishes is INDISTINGUISHABLE here, and says so rather than guessing', async () => {
    // Probe B: an endpoint that accepts and never answers produced exactly this
    // — silence, no exit — for 420 s. Relay reads a pipe, not a socket, so it
    // cannot know whether a request was ever sent. Unknown is not zero.
    const d = diagnosticsOf(await run(processFake({ exitsAfterMs: null, diesOn: 'SIGTERM' })));
    expect(d.providerRequestStarted).toBeNull();
    expect(d.providerHttpStatus).toBeNull();
    expect(d.servedModel).toBeNull();
  });

  it('the engine reporting its OWN timeout stays a timeout, and stays retryable', async () => {
    // Both lines observed verbatim from Hermes v0.18.2 once it was given a
    // deadline: without this, prose with no JSON classifies as
    // `review_json_absent` — a WORKER_EXECUTION_FAILURE that is NOT retryable —
    // and giving the engine a voice would have made a transient provider
    // timeout permanent.
    for (const line of [
      'API call failed after 1 retries: Request timed out.\n',
      'Provider has been unresponsive (no response received) for 5 consecutive stale attempts — aborting this call to avoid an indefinite stall.\n',
    ]) {
      expect(isEngineReportedTimeout(line)).toBe(true);
      const d = diagnosticsOf(await run(processFake({ writes: [[5, line]], exitsAfterMs: 20, exitCode: 0 })));
      expect(d.failureShape, line).toBe('review_timeout');
      expect(d.timedOut).toBe(true);
      // THE TWO TIMEOUTS ARE STILL TOLD APART: this one exited by itself.
      expect(d.signalSent).toBeNull();
      expect(d.processExitCode).toBe(0);
      expect(d.firstOutputObserved).toBe(true);
    }
  });

  it('a reviewer QUOTING the engine\'s give-up line still has its own verdict read', async () => {
    // The trap `classifyHermesUpstreamFailure` already documents, one layer on:
    // a review of THIS repository quotes these lines, and a review that states a
    // verdict has reviewed.
    const quoting = JSON.stringify({
      verdict: 'changes_required',
      summary: 'The handler swallows "API call failed after 1 retries: Request timed out." without classifying it.',
      findings: [{ severity: 'blocking', title: 'unclassified engine timeout', detail: 'see summary' }],
      requirementsChecked: [{ requirement: 'r1', status: 'failed', evidence: 'see findings' }],
    });
    const outcome = await run(processFake({ writes: [[5, quoting]], exitsAfterMs: 20, exitCode: 0 }));
    expect(outcome.kind).toBe('reviewed');
    expect(outcome.kind === 'reviewed' && outcome.result.verdict).toBe('changes_required');
  });

  it('each attempt gets its own process and its own scratch directory', async () => {
    // Nothing carries between attempts: a new child, a new empty cwd. The
    // reviewer profile is the operator's and Relay never touches it, so "fresh
    // profile state" is a property of never having written to it at all.
    const fake = processFake({ exitsAfterMs: null, diesOn: 'SIGTERM' });
    await run(fake);
    await run(fake);
    expect(fake.spawned).toHaveLength(2);
    expect(fake.spawned[0]!.cwd).not.toBe(fake.spawned[1]!.cwd);
    expect(fake.signals).toEqual(['SIGTERM', 'SIGTERM']);
  });

  it('a review that arrives is still a review — the guard added here changes nothing about the happy path', async () => {
    const outcome = await run(processFake({ writes: [[5, APPROVED]], exitsAfterMs: 20, exitCode: 0 }));
    expect(outcome.kind).toBe('reviewed');
    expect(outcome.kind === 'reviewed' && outcome.result.verdict).toBe('approved');
  });

  it('every new fact survives the domain allowlist, and no lifecycle fact is invented', async () => {
    // The columns are worthless if they die at the boundary: a nested object
    // once reached the durable row as the literal text `[object Object]`.
    const d = diagnosticsOf(await run(processFake({ exitsAfterMs: null, diesOn: 'SIGKILL' })));
    const safe = safeReviewDiagnostics(d);
    expect(safe).not.toBeNull();
    expect(safe!.processStarted).toBe(true);
    expect(safe!.processPidObserved).toBe(true);
    expect(safe!.firstOutputObserved).toBe(false);
    expect(safe!.exitObserved).toBe(true);
    expect(safe!.signalSent).toBe('SIGTERM,SIGKILL');
    expect(safe!.cleanupCompleted).toBe(true);
    expect(safe!.timeoutMs).toBe(120);
    expect(safe!.providerRequestStarted).toBeNull();

    // AND THE ALLOWLIST REFUSES WHAT IT SHOULD. A signal outside the closed set
    // is dropped rather than carried, and a negative duration is not a duration.
    const forged = safeReviewDiagnostics({ ...d, signalSent: 'SIGSTOP; rm -rf /', elapsedMs: -1 });
    expect(forged!.signalSent).toBeNull();
    expect(forged!.elapsedMs).toBeNull();
  });

  it('a spawn that yields no pid is recorded as such rather than as a healthy launch', async () => {
    const d = diagnosticsOf(await run(processFake({ withoutPid: true, exitsAfterMs: null, diesOn: 'SIGTERM' })));
    expect(d.processStarted).toBe(true);
    expect(d.processPidObserved).toBe(false);
  });

  it('the production kill grace is a bounded number, not a wait for the process to feel like it', () => {
    expect(DEFAULT_KILL_GRACE_MS).toBeGreaterThan(0);
    expect(DEFAULT_KILL_GRACE_MS).toBeLessThanOrEqual(10_000);
  });
});
