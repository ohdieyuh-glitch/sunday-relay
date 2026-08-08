import { safeText } from './redact';
import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from './reviewer-routes';
import { decideBetaAccess, projectWaveStatus, RELAY_BETA_WAVES } from '../src/relay/mission/beta';
import type { BetaWaveConfig, BetaWaveState, RelayBetaWave } from '../src/relay/mission/beta';
import type { BetaEnrolmentStore } from '../src/relay/persistence';
import { isUsableParticipantId } from '../src/relay/persistence';

/**
 * SUNDAY RELAY — THE BETA ADMISSION ROUTES.
 *
 * Three operations, and the split between them is the whole security shape:
 *
 *   POST /beta/request   — PUBLIC. Anyone may ask. Recording a request is not
 *                          admitting anyone, and this route cannot admit.
 *   POST /beta/access    — OPERATOR. Asks the gate about one participant.
 *   GET  /beta/status    — OPERATOR. The wave board.
 *
 * WAVE_0.md: "publicly discoverable, open signup, admission-controlled." The
 * public half is one route that writes an enrolment record; the controlled half
 * is that a record grants nothing. Admission is decided by `decideBetaAccess`
 * against the durable count, every time it is asked, and no request body can
 * influence it — a caller supplies an id and nothing else.
 *
 * NO ANONYMOUS EXECUTION, which WAVE_0.md requires. This module records and
 * answers; it issues no session, no token and no capability. Whatever a
 * participant may then DO is the existing authentication and permission
 * surface's decision, unchanged, and nothing here relaxes it.
 *
 * OFF UNLESS SWITCHED ON. `RELAY_BETA_ENABLED=1`, and without a mounted state
 * root there is no store, so the routes answer `beta_not_ready` rather than
 * pretending. A public route that silently no-ops is worse than an absent one.
 */

export const BETA_PREFIX = '/beta/';
export const BETA_ENABLED_ENV = 'RELAY_BETA_ENABLED';

export function isBetaRoute(path: string): boolean {
  return path.startsWith(BETA_PREFIX);
}

export function betaEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[BETA_ENABLED_ENV] === '1';
}

export const BETA_WAVE_0_OPEN_ENV = 'RELAY_BETA_WAVE_0_OPEN';

/**
 * Whether wave 0 is OPEN, CLOSED, or has simply never been opened.
 *
 * THREE STATES FROM ONE VARIABLE, and `not_open` is what an unset one means —
 * a wave nobody opened admits nobody, and that is the only thing a missing
 * decision can honestly say. Opening the controlled public beta is therefore a
 * deliberate act by whoever sets this, not a side effect of deploying.
 */
export function betaWaveZeroState(env: NodeJS.ProcessEnv): BetaWaveState {
  const raw = env[BETA_WAVE_0_OPEN_ENV];
  if (raw === '1') return 'open';
  if (raw === 'closed') return 'closed';
  return 'not_open';
}

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { error: { kind, message } } });

/**
 * Which wave a public request joins.
 *
 * NOT CALLER-SUPPLIED. A public route that let the caller name their wave would
 * let them name the one with room, which is the cap deciding nothing. Wave 0 is
 * the controlled public beta and the only wave open signup reaches.
 */
const PUBLIC_SIGNUP_WAVE: RelayBetaWave = 'wave_0';

export interface BetaRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: unknown;
  readonly env: NodeJS.ProcessEnv;
  /** The server's clock. Never a caller's — it orders the wave's queue. */
  readonly now: string;
  /**
   * The waves and their state, from the deployment. Absent means no wave is
   * configured, which admits nobody: `not_open` is the safe default and the
   * only one a missing config can honestly mean.
   */
  readonly waves: readonly BetaWaveConfig[];
}

export async function handleBetaRoute(
  request: BetaRouteRequest,
  store: BetaEnrolmentStore | null,
): Promise<ReviewerRouteResult | null> {
  if (!isBetaRoute(request.path)) return null;
  await Promise.resolve();

  if (!betaEnabled(request.env)) {
    return err(403, 'beta_disabled', 'The controlled beta is not enabled on this server.');
  }
  if (store === null) {
    // No mounted volume, no durable record, and an enrolment that does not
    // survive a restart is not an enrolment.
    return err(503, 'beta_not_ready', 'No durable state root is mounted, so no enrolment can be recorded.');
  }

  const operator = (): boolean => bearerMatches(request.authorization, request.env[BRIDGE_TOKEN_ENV]);

  /* ---------------------------------------------------------- public ask */

  if (request.method === 'POST' && request.path === '/beta/request') {
    const participantId = readParticipantId(request.body);
    if (participantId === null) {
      return err(422, 'validation_failed',
        'A participantId is required, matching ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$.');
    }

    const result = store.enrol(participantId, PUBLIC_SIGNUP_WAVE, request.now);
    if (!result.ok) return err(422, 'enrolment_failed', safeText(result.problem));

    /**
     * A REQUEST IS NOT AN ADMISSION, and the response says so in the same
     * breath rather than leaving a caller to infer it. `recorded` is the only
     * fact this route establishes; whether it leads anywhere is the gate's
     * answer, asked separately and at the time it matters.
     */
    return ok({
      recorded: true,
      alreadyRequested: result.outcome === 'already_enrolled',
      wave: PUBLIC_SIGNUP_WAVE,
      requestedAt: result.enrollment.enrolledAt,
      admitted: false,
      note: 'Requesting access is recorded, not granted. Admission is decided separately '
        + 'and is capped; this response never means you may use Relay.',
    });
  }

  /* -------------------------------------------------------- operator ask */

  if (request.method === 'POST' && request.path === '/beta/access') {
    if (!operator()) return err(401, 'authentication_failed', 'Beta access decisions are operator-only.');
    const participantId = readParticipantId(request.body);
    if (participantId === null) return err(422, 'validation_failed', 'A participantId is required.');

    const decision = decideBetaAccess({
      participantId,
      // BOTH from the store, and deliberately by two different reads: the list
      // orders the queue, the count proves the list is complete. Deriving one
      // from the other would make the cap unenforceable.
      enrollments: RELAY_BETA_WAVES.flatMap((w) => store.list(w)),
      waves: request.waves,
      // `countFor` may answer `null` — a directory it could not read. That
      // flows straight through to the gate, which refuses `occupancy_unknown`
      // rather than admitting against a count nobody has.
      occupancy: Object.fromEntries(RELAY_BETA_WAVES.map((w) => [w, store.countFor(w)])),
    });

    return ok(decision.admitted
      ? { admitted: true, wave: decision.wave, enrolledAt: decision.enrolledAt }
      : { admitted: false, reason: decision.reason, detail: safeText(decision.detail) });
  }

  if (request.method === 'GET' && request.path === '/beta/status') {
    if (!operator()) return err(401, 'authentication_failed', 'The wave board is operator-only.');
    const occupancy = Object.fromEntries(RELAY_BETA_WAVES.map((w) => [w, store.countFor(w)]));
    return ok({
      waves: request.waves.map((w) => projectWaveStatus(w, occupancy, store.list(w.wave))),
      // A wave the deployment never configured is absent from `waves`, and
      // absent is stated rather than rendered as a wave that is merely closed.
      unconfigured: RELAY_BETA_WAVES.filter((w) => !request.waves.some((c) => c.wave === w)),
    });
  }

  return err(404, 'unknown_beta_route', 'No such beta route.');
}

function readParticipantId(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).participantId;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isUsableParticipantId(trimmed) ? trimmed : null;
}
