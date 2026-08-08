import { safeText } from './redact';
import { betaEnabled } from './beta-routes';
import { decideBetaAccess, RELAY_BETA_WAVES } from '../src/relay/mission/beta';
import type { BetaWaveConfig } from '../src/relay/mission/beta';
import type { ReviewerRouteResult } from './reviewer-routes';
import type { BetaEnrolmentStore } from '../src/relay/persistence';

/**
 * SUNDAY RELAY — THE ADMISSION GUARD.
 *
 * The gate decides, the store records, the routes answer — and until this
 * module none of it stopped anybody doing anything. A gate with no caller is a
 * correct decision nobody has to obey, which is the shape review has named in
 * this codebase more than once.
 *
 * WHERE IT BITES. `POST /mission/start` runs the real three-role pipeline —
 * Prompt Architect, Coding Agent, independent Reviewer — and spends real money.
 * That is the operation a controlled beta exists to control, so that is where
 * admission is checked rather than at the edge of the API in general.
 *
 * IT ADDS A GATE, IT NEVER REMOVES ONE. `WAVE_0.md` is explicit: existing
 * authentication, permissions, Mission controls, usage limits, security
 * boundaries and verification requirements all remain enforced. This runs
 * ALONGSIDE them. A participant who is admitted to the beta and not authorised
 * for an operation is still refused by the surface that already refuses them,
 * and nothing here relaxes that.
 *
 * WHEN THE BETA IS OFF, IT IS NOT A GATE. A bridge with no controlled beta
 * behaves exactly as it did — the guard returns `null` and the route proceeds
 * to the checks it always had. Turning the beta ON is what makes admission
 * required, which is the only reading of "controlled" that does not silently
 * change an unrelated deployment.
 *
 * NO ANONYMOUS EXECUTION. With the beta on, a request that names no participant
 * is refused, and a participant the gate does not admit is refused with the
 * gate's own reason rather than a flat "no" — an operator who cannot tell
 * "never asked" from "we are full" cannot run a beta, and neither can the
 * person turned away.
 */

export interface BetaAdmissionInput {
  readonly env: NodeJS.ProcessEnv;
  /** Who the request says it is. Absent is a refusal when the beta is on. */
  readonly participantId: string | null;
  readonly store: BetaEnrolmentStore | null;
  readonly waves: readonly BetaWaveConfig[];
}

/**
 * `null` when the request may proceed; a refusal otherwise.
 *
 * Returning `null` rather than `true` is deliberate: a caller that forgets to
 * check the result gets a type error on the response, not a silent admission.
 */
export function guardBetaAdmission(input: BetaAdmissionInput): ReviewerRouteResult | null {
  // NOT A GATE WHEN THE BETA IS OFF. Existing deployments are unchanged.
  if (!betaEnabled(input.env)) return null;

  if (input.store === null) {
    // The beta is on and its records are unreachable. Admitting here would be
    // admitting against no record at all, which is worse than refusing.
    return {
      status: 503,
      body: {
        error: {
          kind: 'beta_not_ready',
          message: 'The controlled beta is enabled but no durable state root is mounted, '
            + 'so admission cannot be established.',
        },
      },
    };
  }

  if (input.participantId === null) {
    return {
      status: 403,
      body: {
        error: {
          kind: 'beta_admission_required',
          message: 'The controlled beta is open and this operation names no participant. '
            + 'Relay does not run work for an unnamed caller.',
        },
      },
    };
  }

  // A BLOCK OUTRANKS AN ENROLMENT. Someone blocked after they were admitted
  // must stop working, not merely stop signing up.
  if (input.store.isBlocked(input.participantId)) {
    return {
      status: 403,
      body: {
        error: {
          kind: 'beta_not_admitted',
          message: 'This participant is not admitted to the controlled beta.',
          reason: 'not_enrolled',
        },
      },
    };
  }

  /**
   * A LIST WE COULD NOT READ IS NOT AN EMPTY ONE. `list` runs before occupancy
   * in the gate, so passing `[]` for an unreadable directory answered
   * `not_enrolled` — telling an admitted participant that Relay holds no record
   * for them while it sat on the volume. Refuse instead.
   */
  const lists = RELAY_BETA_WAVES.map((w) => input.store!.list(w));
  if (lists.some((l) => l === null)) {
    return {
      status: 503,
      body: {
        error: {
          kind: 'beta_not_ready',
          message: 'Relay cannot read its beta records, so it will not decide admission against them.',
        },
      },
    };
  }

  const decision = decideBetaAccess({
    participantId: input.participantId,
    // TWO READS OF THE SAME TRUTH, exactly as the routes do it: the list orders
    // the queue, the count proves the list is complete. `countFor` may answer
    // `null`, and the gate refuses on that rather than admitting against a
    // count nobody has.
    enrollments: lists.flatMap((l) => l ?? []),
    waves: input.waves,
    occupancy: Object.fromEntries(RELAY_BETA_WAVES.map((w) => [w, input.store!.countFor(w)])),
  });

  if (decision.admitted) return null;

  return {
    status: 403,
    body: {
      error: {
        kind: 'beta_not_admitted',
        // THE GATE'S OWN REASON, not a flat refusal. "You never asked", "we are
        // full" and "the wave is not open yet" are three different things for
        // the person being turned away to do next.
        message: safeText(decision.detail),
        reason: decision.reason,
      },
    },
  };
}

/** Reads the participant a request claims, without trusting it. */
export function participantFromBody(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>).participantId;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}
