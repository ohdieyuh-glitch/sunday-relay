import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { HERMES_TRANSIENT_UPSTREAM_STATUSES, classifyHermesUpstreamFailure } from './hermes-reviewer';

/**
 * A PROVIDER HICCUP IS NOT A VERDICT — AND WAS ONE, ON THE PATH THAT MATTERS.
 *
 * `review_service_unavailable` is the retryable shape, and `live-workers.ts`
 * explains why: capacity clears as runs finish and a drain ends when the deploy
 * lands, so neither needs a human first. That shape was produced only by
 * `hermes-remote-review.ts`. The LOCAL path — the one
 * `createLiveHermesReviewerAdapter` actually runs — answered EVERY upstream
 * status with `review_provider_http_error`, which is final. So a 503 was a
 * transient condition down one transport and a dead review down the other, and
 * the comment justifying the retry governed a shape the live path could not
 * reach.
 *
 * The qualification's shape dispatches the reviewer five times. Five chances
 * for one 503 to end a paid mission that had already bought a plan, a lock and
 * a build.
 */

describe('the same provider condition gets the same answer on both transports', () => {
  it('names exactly the statuses the remote path has always treated as transient', () => {
    expect([...HERMES_TRANSIENT_UPSTREAM_STATUSES].sort((a, b) => a - b)).toEqual([429, 503]);
  });

  /**
   * THE OTHER STATUSES STAY FINAL, and that is a decision rather than an
   * omission: nothing observed says a 500, a 502 or a 504 clears by itself, and
   * widening the set on a hunch spends a paid dispatch to find out.
   */
  it('leaves 500, 502 and 504 out, so the set is evidence and not optimism', () => {
    for (const status of [500, 502, 504]) {
      expect(HERMES_TRANSIENT_UPSTREAM_STATUSES.includes(status), String(status)).toBe(false);
    }
  });

  it('still reads the status off the engine’s own line, for every status', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(classifyHermesUpstreamFailure(`HTTP ${status}: upstream said so\n`))
        .toEqual({ kind: 'upstream', status });
    }
  });
});

/**
 * THE SHAPE THE LIVE PATH ACTUALLY PRODUCES, driven through the real runner
 * over a fake process, because the classification that matters is the one at
 * the end of a real review and not the one a helper returns in isolation.
 */
describe('the live reviewer path classifies a transient status as retryable', () => {
  const emitting = (text: string) => (() => {
    const child = spawn(process.execPath, ['-e', `process.stdout.write(${JSON.stringify(text)})`]);
    return child;
  });

  const shapeFor = async (text: string): Promise<string> => {
    const { runHermesReview, loadHermesConfig } = await import('./hermes-reviewer');
    const outcome = await runHermesReview({
      packet: {
        missionId: 'msn-1', originalRequest: 'the request', handoffJson: '{}',
        baseRevision: 'abc', artifactDigest: 'sha256:0', changedFiles: ['src/x.ts'],
        unifiedDiff: '--- a\n+++ b\n', changedFileContents: '', testCommand: 'npm test',
        testOutput: 'ok', relayEvidence: [],
      } as never,
      config: loadHermesConfig({
        RELAY_HERMES_EXECUTABLE: process.execPath,
        RELAY_HERMES_MODEL: 'grok-build-0.1',
        RELAY_HERMES_PROVIDER: 'xai',
        RELAY_HERMES_LIVE: '1',
      } as never),
      spawnImpl: emitting(text) as never,
    });
    return outcome.kind === 'review_incomplete' ? outcome.shape : `unexpected:${outcome.kind}`;
  };

  it('a 503 reads as the retryable shape, not as a final provider error', async () => {
    expect(await shapeFor('HTTP 503: service unavailable\n')).toBe('review_service_unavailable');
  }, 30_000);

  it('a 429 reads the same way', async () => {
    expect(await shapeFor('HTTP 429: slow down\n')).toBe('review_service_unavailable');
  }, 30_000);

  /**
   * AND THE FINAL ONES ARE STILL FINAL. A repair that made every upstream error
   * retryable would re-buy a review against a provider that is genuinely broken,
   * which is the opposite defect.
   */
  it('a 500 and a 502 still read as a final provider error', async () => {
    expect(await shapeFor('HTTP 500: internal error\n')).toBe('review_provider_http_error');
    expect(await shapeFor('HTTP 502: bad gateway\n')).toBe('review_provider_http_error');
  }, 30_000);

  it('an authentication refusal is still final, and is not confused with capacity', async () => {
    expect(await shapeFor('HTTP 401: unauthorized\n')).toBe('review_authentication_failed');
  }, 30_000);
});
