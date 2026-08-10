import { describe, expect, it, vi } from 'vitest';

import { runRemoteHermesReview } from './hermes-remote-review';
import { parseReviewBody, SERVICE_MAX_TURNS } from '../relay-hermes-service/service';
import type { ReviewPacket } from './hermes-reviewer';

/**
 * THE BRIDGE'S REQUEST, RUN THROUGH THE SERVICE'S OWN VALIDATOR.
 *
 * The bridge sent `limits: {}`. The service requires four positive safe
 * integers and refuses anything else with 422 — so every remote review was
 * rejected before Hermes was asked to read a single diff, and the mission
 * reported only "The Reviewer service refused the review (422)".
 *
 * The first real hosted three-role Mission got all the way here: the Prompt
 * Architect was paid, the hosted Coding Agent edited the file, Relay's own
 * verification passed the tests and bound an artifact digest. The Reviewer
 * refused the request shape.
 *
 * NO UNIT TEST ON EITHER SIDE COULD CATCH THAT. The bridge's tests asserted it
 * POSTs a body; the service's tests asserted it rejects a bad one. Each half
 * was correct about itself. This is the only test that puts the real request
 * in front of the real validator, which is where the disagreement lived.
 */

const PACKET: ReviewPacket = {
  missionId: 'msn-1',
  originalRequest: 'Add the guard.',
  handoffJson: '{"objective":"Add the guard."}',
  acceptanceCriteria: ['The guard refuses an unknown version.'],
  baseRevision: 'abc1234',
  artifactDigest: 'sha256:deadbeef',
  changedFiles: ['src/normalize.js'],
  unifiedDiff: 'diff --git a/src/normalize.js b/src/normalize.js',
  changedFileContents: 'export const guard = true;',
  testCommand: 'node --test',
  testOutput: 'ok',
  relayEvidence: ['relay verified the diff applies'],
};

const config = {
  serviceUrl: 'https://hermes.example.com',
  token: 'service-token',
  trustedOrigins: ['https://hermes.example.com'],
  timeoutMs: 30_000,
  reviewTimeoutMs: 180_000,
  pollIntervalMs: 1,
};

/** Captures the POST body the bridge actually sends. */
async function capturePostedBody(): Promise<unknown> {
  let posted: unknown = null;
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && String(url).endsWith('/v1/reviews')) {
      posted = JSON.parse(String(init.body));
      // Refuse afterwards; this test is about the REQUEST, not the review.
      return new Response('{}', { status: 503 });
    }
    return new Response('{}', { status: 503 });
  });
  await runRemoteHermesReview({
    packet: PACKET, config, runId: 'run-1',
    deps: { fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} },
  });
  return posted;
}

describe('the remote review request satisfies the service contract', () => {
  it('is actually captured, so nothing below passes on a null body', () => {
    // Guards the guard: an unsent body would make every assertion vacuous.
    return capturePostedBody().then((body) => {
      expect(body).not.toBeNull();
      expect(typeof body).toBe('object');
    });
  });

  it('PASSES the service’s own validator', async () => {
    const body = await capturePostedBody();
    const parsed = parseReviewBody(body);
    // The assertion the 422 was telling us about, in a test rather than in
    // production after three paid legs.
    expect(parsed.ok, parsed.ok ? '' : parsed.message).toBe(true);
  });

  it('sends the one-shot turn count the adapter genuinely has', async () => {
    // The isolated profile pins `agent.max_turns: 1` and there is no flag to
    // raise it. Asking for more would be a control that does not exist.
    const body = await capturePostedBody() as { limits: { maxTurns: number } };
    expect(body.limits.maxTurns).toBe(SERVICE_MAX_TURNS);
  });

  it('sends positive safe integers for every limit', async () => {
    const body = await capturePostedBody() as { limits: Record<string, unknown> };
    for (const [k, v] of Object.entries(body.limits)) {
      expect(Number.isSafeInteger(v), k).toBe(true);
      expect(v as number, k).toBeGreaterThan(0);
    }
  });

  it('sends no field the service would reject as unsupported', async () => {
    // The service refuses unknown keys outright rather than ignoring them.
    const body = await capturePostedBody() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['idempotencyKey', 'limits', 'prompt', 'runId']);
  });
});
