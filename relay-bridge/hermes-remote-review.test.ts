import { describe, expect, it, vi } from 'vitest';

import {
  REMOTE_HERMES_ENV,
  resolveRemoteHermes,
  runRemoteHermesReview,
  type RemoteHermesConfig,
} from './hermes-remote-review';
import type { ReviewPacket } from './hermes-reviewer';

/**
 * THE REVIEWER, REACHED OVER HTTP.
 *
 * `runHermesReview` spawns a local process, which is correct on a laptop and
 * impossible on a container — so a hosted bridge had no Reviewer at all. This
 * is the other implementation of the same seam, and what is held here is that
 * it cannot become a weaker Reviewer: the same validator, the same outcome
 * type, and a credential that will not leave over plaintext.
 */

/**
 * The REAL packet shape, with no cast.
 *
 * The first version of this fixture used `as unknown as ReviewPacket` and was
 * missing half the fields — which the compiler would have caught, and the cast
 * silenced. Every test in this file then failed inside `buildReviewPrompt` on
 * an undefined array. A cast that quiets a type error removes the barrier that
 * was doing the work.
 */
const PACKET: ReviewPacket = {
  missionId: 'msn-1',
  originalRequest: 'Add the migration guard.',
  handoffJson: JSON.stringify({ objective: 'Add the migration guard.' }),
  acceptanceCriteria: ['The guard refuses an unknown version.'],
  baseRevision: 'abc1234',
  artifactDigest: 'sha256:deadbeef',
  changedFiles: ['src/app.ts'],
  unifiedDiff: 'diff --git a/src/app.ts b/src/app.ts',
  changedFileContents: 'export const guard = true;',
  testCommand: 'npm test',
  testOutput: 'ok',
  relayEvidence: ['relay verified the diff applies'],
};

const config: RemoteHermesConfig = {
  serviceUrl: 'https://hermes.example.com',
  token: 'service-token',
  trustedOrigins: ['https://hermes.example.com'],
  timeoutMs: 1_000,
  reviewTimeoutMs: 10_000,
  pollIntervalMs: 1,
};

const deps = { now: () => '2026-08-10T12:00:00.000Z', sleep: () => Promise.resolve() };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const REVIEW_TEXT = JSON.stringify({
  verdict: 'changes_required',
  summary: 'One blocking finding.',
  findings: [{ id: 'F-1', severity: 'blocking', file: 'src/app.ts', detail: 'Unknown version is accepted.' }],
});

describe('resolving the configuration', () => {
  const base = {
    [REMOTE_HERMES_ENV.mode]: 'remote',
    [REMOTE_HERMES_ENV.url]: 'https://hermes.example.com',
    [REMOTE_HERMES_ENV.token]: 'service-token',
    [REMOTE_HERMES_ENV.trustedOrigins]: 'https://hermes.example.com',
  };

  it('resolves when everything is present', () => {
    const resolution = resolveRemoteHermes(base);
    expect(resolution.ok).toBe(true);
  });

  it('says local mode is local mode rather than a misconfiguration', () => {
    const resolution = resolveRemoteHermes({ ...base, [REMOTE_HERMES_ENV.mode]: 'local' });
    if (resolution.ok) throw new Error('local mode resolved a remote reviewer');
    expect(resolution.refusal).toBe('not_remote_mode');
  });

  it('names each missing piece', () => {
    const cases: [Record<string, string>, string][] = [
      [{ ...base, [REMOTE_HERMES_ENV.url]: '' }, 'no_service_url'],
      [{ ...base, [REMOTE_HERMES_ENV.token]: '' }, 'no_token'],
    ];
    for (const [env, refusal] of cases) {
      const resolution = resolveRemoteHermes(env);
      if (resolution.ok) throw new Error(`${refusal} was accepted`);
      expect(resolution.refusal).toBe(refusal);
    }
  });

  it('refuses an unlisted origin', () => {
    const resolution = resolveRemoteHermes({
      ...base, [REMOTE_HERMES_ENV.url]: 'https://someone-else.example.com',
    });
    if (resolution.ok) throw new Error('an unlisted origin was trusted');
    expect(resolution.refusal).toBe('origin_not_trusted');
  });
});

describe('production refuses what development may allow', () => {
  const productionEnvs = [{ NODE_ENV: 'production' }, { RAILWAY_ENVIRONMENT: 'production' }];

  it('will not trust an unlisted URL in production', () => {
    for (const env of productionEnvs) {
      const resolution = resolveRemoteHermes({
        ...env,
        [REMOTE_HERMES_ENV.mode]: 'remote',
        [REMOTE_HERMES_ENV.url]: 'https://hermes.example.com',
        [REMOTE_HERMES_ENV.token]: 'service-token',
        // No trusted origins configured.
      });
      if (resolution.ok) throw new Error('production trusted an unlisted URL');
      expect(resolution.refusal).toBe('no_trusted_origins_in_production');
    }
  });

  it('will not send its credential over plaintext in production', () => {
    // A bearer token over HTTP is a published bearer token.
    const resolution = resolveRemoteHermes({
      NODE_ENV: 'production',
      [REMOTE_HERMES_ENV.mode]: 'remote',
      [REMOTE_HERMES_ENV.url]: 'http://hermes.example.com',
      [REMOTE_HERMES_ENV.token]: 'service-token',
      [REMOTE_HERMES_ENV.trustedOrigins]: 'http://hermes.example.com',
    });
    if (resolution.ok) throw new Error('production sent a credential over http');
    expect(resolution.refusal).toBe('url_not_https_in_production');
  });

  it('allows plaintext loopback outside production, where it is a local service', () => {
    const resolution = resolveRemoteHermes({
      [REMOTE_HERMES_ENV.mode]: 'remote',
      [REMOTE_HERMES_ENV.url]: 'http://127.0.0.1:8080',
      [REMOTE_HERMES_ENV.token]: 'service-token',
      [REMOTE_HERMES_ENV.trustedOrigins]: 'http://127.0.0.1:8080',
    });
    expect(resolution.ok).toBe(true);
  });
});

describe('running a review', () => {
  it('starts, polls, and reads the verdict with the LOCAL validator', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ accepted: true, runId: 'run-1', duplicate: false }))
      .mockResolvedValueOnce(json({ runId: 'run-1', status: 'running' }))
      .mockResolvedValueOnce(json({ runId: 'run-1', status: 'completed', reviewText: REVIEW_TEXT }));

    const outcome = await runRemoteHermesReview({
      packet: PACKET, config, runId: 'run-1',
      deps: { ...deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(outcome.kind).toBe('reviewed');
    if (outcome.kind !== 'reviewed') throw new Error(JSON.stringify(outcome));
    // The same shape the local path produces — no second verdict vocabulary.
    expect(outcome.result.findings.length).toBeGreaterThan(0);
    expect(outcome.startedAt).toBe('2026-08-10T12:00:00.000Z');
  });

  it('sends the credential as a bearer token and reuses the run id for idempotency', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ accepted: true, runId: 'run-1' }))
      .mockResolvedValueOnce(json({ runId: 'run-1', status: 'completed', reviewText: REVIEW_TEXT }));
    await runRemoteHermesReview({
      packet: PACKET, config, runId: 'run-1',
      deps: { ...deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer service-token');
    const body = JSON.parse(init.body as string) as { runId: string; idempotencyKey: string };
    // A redelivered request must not start a second PAID review.
    expect(body.idempotencyKey).toBe(body.runId);
  });

  it('reports an unreachable service as a launch failure', async () => {
    const outcome = await runRemoteHermesReview({
      packet: PACKET, config, runId: 'run-1',
      deps: { ...deps, fetchImpl: (() => Promise.reject(new Error('down'))) as unknown as typeof fetch },
    });
    expect(outcome.kind).toBe('launch_failed');
  });

  it('reports a refusal the service MADE as incomplete, not as a launch failure', async () => {
    // It answered. That is a different fact from never having been reached,
    // and an operator debugging them looks in different places.
    const outcome = await runRemoteHermesReview({
      packet: PACKET, config, runId: 'run-1',
      deps: { ...deps, fetchImpl: (() => Promise.resolve(json({ error: 'at capacity' }, 503))) as unknown as typeof fetch },
    });
    expect(outcome.kind).toBe('review_incomplete');
    if (outcome.kind === 'review_incomplete') expect(outcome.safeMessage).toContain('503');
  });

  it('keeps an unfinished review UNKNOWN rather than calling it failed', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ accepted: true, runId: 'run-1' }))
      .mockResolvedValue(json({ runId: 'run-1', status: 'running' }));
    const outcome = await runRemoteHermesReview({
      packet: PACKET,
      config: { ...config, reviewTimeoutMs: -1 },
      runId: 'run-1',
      deps: { ...deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(outcome.kind).toBe('review_incomplete');
    if (outcome.kind === 'review_incomplete') {
      // The service may still be reviewing. Saying it failed would be a claim
      // about somebody else's process.
      expect(outcome.safeMessage).toContain('unknown');
    }
  });

  it('refuses a review it cannot read rather than inventing a verdict', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({ accepted: true, runId: 'run-1' }))
      .mockResolvedValueOnce(json({ runId: 'run-1', status: 'completed', reviewText: 'not json at all' }));
    const outcome = await runRemoteHermesReview({
      packet: PACKET, config, runId: 'run-1',
      deps: { ...deps, fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(outcome.kind).toBe('review_incomplete');
  });

  it('never puts the credential in an outcome message', async () => {
    const outcome = await runRemoteHermesReview({
      packet: PACKET, config, runId: 'run-1',
      deps: { ...deps, fetchImpl: (() => Promise.resolve(json({}, 500))) as unknown as typeof fetch },
    });
    expect(JSON.stringify(outcome)).not.toContain('service-token');
  });
});
