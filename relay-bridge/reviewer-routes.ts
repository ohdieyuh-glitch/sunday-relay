/**
 * THE REVIEWER HTTP BOUNDARY.
 *
 * The seven Reviewer operations, behind bearer authentication, in the existing
 * `/relay-api` family. Everything the CLI can do to a Reviewer run, it does
 * through here — which is why the CLI never needs to import a process adapter,
 * a provider client or a credential.
 *
 * READ-ONLY ROUTES ARE ACTUALLY READ-ONLY. `readiness`, `status` and `inspect`
 * start no Hermes process, perform no model discovery, run no inference and
 * consume no usage. Only `test-connection` may contact the provider, and only
 * because a human explicitly asked it to.
 *
 * NOTHING HERE DECIDES A VERDICT. Routes validate, delegate to the canonical
 * operation and sanitize. A credential, a raw provider body, a process
 * environment and a stack trace can none of them reach a response.
 */

import { timingSafeEqual } from 'node:crypto';
import {
  createIsolatedProfile, createProbe, loadXaiConfig, localReadiness, verifiedReadiness,
} from './reviewer-harness/hermes';
import { safeText } from './redact';

export const BRIDGE_TOKEN_ENV = 'RELAY_BRIDGE_API_TOKEN';

export interface ReviewerRouteResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { kind, error: message } });

/**
 * Constant-time bearer comparison.
 *
 * A plain `===` leaks the shared prefix length through timing. This compares
 * fixed-length digests of equal size, so a mismatch costs the same whatever
 * the input — and an absent or malformed header is refused identically to a
 * wrong token, because distinguishing them is itself information.
 */
export function bearerMatches(header: string | undefined, expected: string | undefined): boolean {
  if (expected === undefined || expected.trim() === '') return false;
  if (header === undefined) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) return false;
  const presented = Buffer.from(match[1]);
  const secret = Buffer.from(expected.trim());
  // Equalise lengths first: timingSafeEqual throws on a length mismatch, and
  // the throw itself would be an oracle.
  if (presented.length !== secret.length) {
    // Still burn a comparison so the failure path is not obviously shorter.
    timingSafeEqual(secret, secret);
    return false;
  }
  return timingSafeEqual(presented, secret);
}

export interface ReviewerRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
  /**
   * Decides WHO is calling. Injected so this module keeps knowing nothing
   * about sessions: it asks, and enforces the answer.
   *
   * Absent = operator-token-only, the behaviour before browser pairing
   * existed, which is what the CLI and every existing test rely on.
   */
  readonly authorize?: () => { kind: 'operator' } | { kind: 'browser' }
    | { kind: 'rejected'; status: number; message: string };
}

/** Reviewer run state the bridge can serve without a live run engine yet. */
export interface ReviewerRunPort {
  start(input: {
    missionId: string; reviewGeneration: string; requestedHarness: string;
    requestedModel: string | null; idempotencyKey: string;
    limits: Record<string, number>;
  }): Promise<ReviewerRouteResult>;
  status(missionId: string): Promise<ReviewerRouteResult>;
  inspect(missionId: string): Promise<ReviewerRouteResult>;
  stop(missionId: string): Promise<ReviewerRouteResult>;
  retry(input: {
    missionId: string; priorRunId: string; idempotencyKey: string;
  }): Promise<ReviewerRouteResult>;
}

const REVIEWER_PREFIX = '/reviewer/';

export function isReviewerRoute(path: string): boolean {
  return path === '/reviewer/readiness' || path.startsWith(REVIEWER_PREFIX);
}

function requiredString(body: unknown, field: string): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[field];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function limitsFrom(body: unknown): Record<string, number> | null {
  if (body === null || typeof body !== 'object') return null;
  const raw = (body as Record<string, unknown>).limits;
  if (raw === null || typeof raw !== 'object') return null;
  const out: Record<string, number> = {};
  for (const key of ['timeoutMs', 'maxOutputBytes', 'maxTurns', 'maxPromptBytes']) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    out[key] = value;
  }
  return out;
}

/**
 * Handles a Reviewer route. Returns `null` when the path is not one of ours,
 * so the caller can fall through to the rest of the bridge.
 */
export async function handleReviewerRoute(
  request: ReviewerRouteRequest,
  runs: ReviewerRunPort | null,
): Promise<ReviewerRouteResult | null> {
  const { method, path, env } = request;
  if (!isReviewerRoute(path)) return null;

  // EVERY Reviewer route is authenticated, including the read-only ones: run
  // state is operational detail, and an unauthenticated readiness probe would
  // still disclose what is installed on the host.
  //
  // An operator may call anything. A paired browser session may call only the
  // read-only subset — the decision belongs to the injected authorizer, and
  // this module simply refuses whatever it rejects.
  const decision = request.authorize?.()
    ?? (bearerMatches(request.authorization, env[BRIDGE_TOKEN_ENV])
      ? { kind: 'operator' as const }
      : { kind: 'rejected' as const, status: 401, message: 'Authentication is required for Reviewer operations.' });
  if (decision.kind === 'rejected') {
    return err(
      decision.status,
      decision.status === 403 ? 'authorization_required' : 'authentication_failed',
      decision.message,
    );
  }

  /* ------------------------------------------------ readiness (local) --- */
  if (method === 'GET' && path === '/reviewer/readiness') {
    const profile = createIsolatedProfile();
    try {
      const evidence = localReadiness({
        executable: env.RELAY_HERMES_EXECUTABLE ?? 'hermes',
        probe: createProbe(profile.home),
        xai: loadXaiConfig(env),
      });
      return ok({ harness: 'hermes', evidence: { ...evidence, binaryPath: null } });
    } finally {
      profile.dispose();
    }
  }

  /* ------------------------------------- test connection (may contact) --- */
  if (method === 'POST' && path === '/reviewer/test-connection') {
    const profile = createIsolatedProfile();
    try {
      const xai = loadXaiConfig(env);
      const result = await verifiedReadiness({
        executable: env.RELAY_HERMES_EXECUTABLE ?? 'hermes',
        probe: createProbe(profile.home),
        xai,
      });
      const v = result.verification;
      const connected = result.evidence.modelVerified;
      return ok({
        harness: 'hermes',
        evidence: { ...result.evidence, binaryPath: null },
        providerRequestMade: result.providerRequestMade,
        requestedModel: result.evidence.requestedModel,
        // Only ever from server proof; absent stays null and renders Unknown.
        verifiedModelId: result.evidence.verifiedModelId,
        provider: connected ? 'xai' : null,
        checkedAt: result.evidence.checkedAt,
        connected,
        reason: connected
          ? null
          : safeText(
            v !== null && 'safeMessage' in v && typeof v.safeMessage === 'string'
              ? v.safeMessage
              : result.evidence.failureReason ?? 'The Reviewer harness is not ready.',
          ),
      });
    } finally {
      profile.dispose();
    }
  }

  // The remaining operations need a run engine. Without one the bridge says so
  // rather than inventing a run.
  if (runs === null) {
    return err(
      503, 'reviewer_not_ready',
      'This Relay Bridge has no Reviewer run engine configured, so no review can be started or inspected.',
    );
  }

  if (method === 'POST' && path === '/reviewer/start') {
    const body = request.body;
    const missionId = requiredString(body, 'missionId');
    const reviewGeneration = requiredString(body, 'reviewGeneration');
    const requestedHarness = requiredString(body, 'requestedHarness');
    const idempotencyKey = requiredString(body, 'idempotencyKey');
    const limits = limitsFrom(body);
    const authorized = (body as { authorized?: unknown } | null)?.authorized === true;
    const rawModel = (body as { requestedModel?: unknown } | null)?.requestedModel;
    const requestedModel = typeof rawModel === 'string' && rawModel.trim() !== '' ? rawModel.trim() : null;

    if (missionId === null || reviewGeneration === null || requestedHarness === null
      || idempotencyKey === null || limits === null) {
      return err(
        422, 'validation_failed',
        'start requires missionId, reviewGeneration, requestedHarness, idempotencyKey and complete limits.',
      );
    }
    if (!authorized) {
      return err(403, 'authorization_required', 'A Reviewer run requires explicit authorization.');
    }
    return await runs.start({
      missionId, reviewGeneration, requestedHarness, requestedModel, idempotencyKey, limits,
    });
  }

  const statusMatch = /^\/reviewer\/(status|inspect|stop)\/(.+)$/.exec(path);
  if (statusMatch !== null) {
    const action = statusMatch[1];
    const missionId = decodeURIComponent(statusMatch[2]);
    if (missionId.trim() === '') {
      return err(422, 'validation_failed', 'A mission id is required.');
    }
    if (method === 'GET' && action === 'status') return await runs.status(missionId);
    if (method === 'GET' && action === 'inspect') return await runs.inspect(missionId);
    if (method === 'POST' && action === 'stop') return await runs.stop(missionId);
    return err(422, 'validation_failed', 'Unsupported method for this Reviewer route.');
  }

  if (method === 'POST' && path === '/reviewer/retry') {
    const missionId = requiredString(request.body, 'missionId');
    const priorRunId = requiredString(request.body, 'priorRunId');
    const idempotencyKey = requiredString(request.body, 'idempotencyKey');
    const authorized = (request.body as { authorized?: unknown } | null)?.authorized === true;
    if (missionId === null || priorRunId === null || idempotencyKey === null) {
      return err(422, 'validation_failed', 'retry requires missionId, priorRunId and idempotencyKey.');
    }
    if (!authorized) {
      // A retry is a NEW paid call; prior authorization does not carry over.
      return err(403, 'authorization_required', 'A Reviewer retry requires fresh explicit authorization.');
    }
    return await runs.retry({ missionId, priorRunId, idempotencyKey });
  }

  return err(422, 'validation_failed', 'Unknown Reviewer operation.');
}
