import { safeText } from './redact';
import { bearerMatches, BRIDGE_TOKEN_ENV, type ReviewerRouteResult } from './reviewer-routes';
import { decideBetaAccess, projectWaveStatus, RELAY_BETA_WAVES } from '../src/relay/mission/beta';
import type { BetaWaveConfig, BetaWaveState, RelayBetaWave } from '../src/relay/mission/beta';
import type { BetaEnrolmentStore } from '../src/relay/persistence';
import type { BetaRateLimiter } from './beta-rate-limit';
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
  /**
   * The client as the platform edge reports it, and the clock, for the rate
   * limit on the one unauthenticated write surface Relay has. Absent means no
   * limit is applied — a host that cannot identify callers should not pretend
   * to.
   */
  readonly rateLimit?: {
    readonly limiter: BetaRateLimiter;
    readonly clientKey: string;
    readonly nowMs: number;
  };
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
    /**
     * THE LIMIT COMES FIRST, before the body is even read. Review consumed
     * every production seat in 671 ms through this route; the seat cap made
     * that a bounded refusal and this is what stops the bound being reached in
     * a second. Refusing before any work also means a flood costs a map lookup
     * rather than a volume read.
     */
    if (request.rateLimit !== undefined) {
      const verdict = request.rateLimit.limiter.check(
        request.rateLimit.clientKey, request.rateLimit.nowMs,
      );
      if (!verdict.allowed) {
        return {
          status: 429,
          body: {
            error: {
              kind: 'rate_limited',
              message: `Too many beta requests. Try again in ${String(verdict.retryAfterSeconds)}s.`,
              retryAfterSeconds: verdict.retryAfterSeconds,
            },
          },
        };
      }
    }

    const participantId = readParticipantId(request.body);
    if (participantId === null) {
      return err(422, 'validation_failed',
        'A participantId is required, matching ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$.');
    }

    /**
     * A BLOCKED PARTICIPANT IS REFUSED THE SAME WAY A FULL WAVE REFUSES.
     *
     * Deliberately indistinguishable from `wave_full`: a distinct "you are
     * blocked" answer would be a free oracle telling someone their id is known
     * and singled out, and would tell them to come back under another one.
     * The operator's board still shows the truth.
     */
    if (store.isBlocked(participantId)) {
      return err(429, 'wave_full', 'This wave has no seats left, so no new request is recorded.');
    }

    /**
     * THE WAVE CANNOT BE CONSUMED BY STRANGERS.
     *
     * Review filled all one hundred seats with anonymous requests in 671 ms and
     * found no way back — every real customer was then number 101, forever, and
     * the only remedy was deleting files on the volume by hand. Seats could
     * even be consumed while the wave was still `not_open`, so the founder
     * would open a wave already full of bots.
     *
     * A NEW participant is refused once the wave is full; an EXISTING one is
     * still answered, because they already hold their seat and telling them
     * otherwise would be false. This turns permanent destruction into a bounded
     * refusal — and it is a bound, not a fix: a rate limit and a blocklist are
     * named in BETA_WAVES.md as still missing.
     */
    const configured = request.waves.find((w) => w.wave === PUBLIC_SIGNUP_WAVE);
    const taken = store.countFor(PUBLIC_SIGNUP_WAVE);
    if (configured === undefined) {
      return err(503, 'beta_not_ready', 'No wave is configured to receive requests.');
    }
    if (taken === null) {
      // Recording against a count nobody has is how the cap stops existing.
      return err(503, 'beta_not_ready', 'Relay cannot count the wave, so it will not record against it.');
    }
    /**
     * THE SAME ANSWER FOR EVERYONE ON A FULL WAVE.
     *
     * The first version skipped the cap for an existing holder, which was
     * kind and made the route a membership oracle again the moment the wave
     * filled — a state an attacker can create in three seconds, after which
     * `200` versus `429` answered "is this id enrolled?" for free and without
     * writing anything. A member loses nothing by being refused here: they
     * already hold their seat, and this route grants nothing either way.
     */
    if (taken >= configured.seats) {
      return err(429, 'wave_full', 'This wave has no seats left, so no new request is recorded.');
    }

    const result = store.enrol(participantId, PUBLIC_SIGNUP_WAVE, request.now);
    if (!result.ok) return err(422, 'enrolment_failed', safeText(result.problem));

    /**
     * A REQUEST IS NOT AN ADMISSION, and the response says so in the same
     * breath rather than leaving a caller to infer it.
     *
     * IT IS ALSO NOT AN ORACLE. The body is IDENTICAL whether this was a first
     * request or a repeat, and it echoes the REQUEST's instant rather than the
     * stored one. Review used the old response to ask "is <id> in the beta, and
     * exactly when did they join?" — and since `enrolledAt` orders the queue,
     * the answer leaked their seat position too. Probing was not even passive:
     * a miss created an enrolment, so enumeration was also the exhaustion
     * attack. The operator route still distinguishes the two.
     */
    return ok({
      recorded: true,
      wave: PUBLIC_SIGNUP_WAVE,
      receivedAt: request.now,
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

    /**
     * THE DIAGNOSTIC ROUTE MUST NOT BE THE ONE THAT LIES. The guard was
     * repaired to refuse on an unreadable list; this re-coerced `null` to `[]`
     * and so answered `not_enrolled` for an enrolled participant — on exactly
     * the surface an operator uses to ask "why was this person refused?".
     */
    const lists = RELAY_BETA_WAVES.map((w) => store.list(w));
    if (lists.some((l) => l === null)) {
      return err(503, 'beta_not_ready',
        'Relay cannot read its beta records, so it will not decide admission against them.');
    }

    const decision = decideBetaAccess({
      participantId,
      // BOTH from the store, and deliberately by two different reads: the list
      // orders the queue, the count proves the list is complete. Deriving one
      // from the other would make the cap unenforceable.
      enrollments: lists.flatMap((l) => l ?? []),
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

  if (request.method === 'POST' && request.path === '/beta/remove') {
    /**
     * THE RECOVERY PATH, REACHABLE. `store.remove` existed and nothing called
     * it, so the doc's claim that "a seat can be given back" was true of a
     * function and false of the product — an operator still had only volume
     * surgery. Operator-only, because freeing someone else's seat is exactly
     * the thing a stranger must not do.
     */
    if (!operator()) return err(401, 'authentication_failed', 'Removing an enrolment is operator-only.');
    const participantId = readParticipantId(request.body);
    if (participantId === null) return err(422, 'validation_failed', 'A participantId is required.');
    const wave = readWave(request.body);
    if (wave === null) return err(422, 'validation_failed', 'A known wave is required.');

    const result = store.remove(participantId, wave);
    if (!result.ok) return err(422, 'removal_failed', 'That enrolment could not be removed.');
    // `removed: false` is the truth, not a failure — the seat is free either
    // way, and reporting an error would invite a retry loop over nothing.
    return ok({ removed: result.removed, wave, seatsTaken: store.countFor(wave) });
  }

  if (request.method === 'POST' && (request.path === '/beta/block' || request.path === '/beta/unblock')) {
    if (!operator()) return err(401, 'authentication_failed', 'Blocking is operator-only.');
    const participantId = readParticipantId(request.body);
    if (participantId === null) return err(422, 'validation_failed', 'A participantId is required.');

    if (request.path === '/beta/unblock') {
      return store.unblock(participantId).ok
        ? ok({ blocked: false, participantId })
        : err(422, 'unblock_failed', 'That block could not be removed.');
    }

    const blocked = store.block(participantId, request.now);
    if (!blocked.ok) return err(422, 'block_failed', 'That participant could not be blocked.');
    /**
     * BLOCKING ALSO TAKES THE SEAT BACK. A block that left the seat held would
     * leave the wave full of people who can never use it — the operator would
     * have stopped the caller and kept the damage.
     */
    const freed = RELAY_BETA_WAVES.map((w) => ({ wave: w, removed: store.remove(participantId, w).removed }))
      .filter((x) => x.removed).map((x) => x.wave);
    return ok({ blocked: true, participantId, seatsFreed: freed });
  }

  if (request.method === 'GET' && request.path === '/beta/status') {
    if (!operator()) return err(401, 'authentication_failed', 'The wave board is operator-only.');
    const occupancy = Object.fromEntries(RELAY_BETA_WAVES.map((w) => [w, store.countFor(w)]));
    return ok({
      waves: request.waves.map((w) => projectWaveStatus(w, occupancy, store.list(w.wave) ?? [])),
      // A wave the deployment never configured is absent from `waves`, and
      // absent is stated rather than rendered as a wave that is merely closed.
      unconfigured: RELAY_BETA_WAVES.filter((w) => !request.waves.some((c) => c.wave === w)),
    });
  }

  return err(404, 'unknown_beta_route', 'No such beta route.');
}

/** The wave an operator names, checked against the closed set. */
function readWave(body: unknown): RelayBetaWave | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).wave;
  return typeof value === 'string' && (RELAY_BETA_WAVES as readonly string[]).includes(value)
    ? value as RelayBetaWave
    : null;
}

function readParticipantId(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).participantId;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return isUsableParticipantId(trimmed) ? trimmed : null;
}
