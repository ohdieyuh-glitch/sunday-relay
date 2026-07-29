/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 4
 * Source-trust rules (PURE).
 *
 * The trace's credibility rests on one rule: NOBODY GRADES THEIR OWN
 * HOMEWORK. An agent's report about its own work is a `claim` no matter how
 * the caller labels it; only a supervisory source can `attest`, and only an
 * authorized verification service can mark something `verified`.
 *
 * This is the trace-level counterpart of the Milestone 3 rule that an agent
 * may never attest its own launch, and it uses the same execution-identity
 * notion of "the same party".
 */

import { traceError, traceFail, traceOk, type TraceResult } from './trace-errors';
import type { AqualaTraceActorType, AqualaTraceSourceTrust } from './trace-types';

/** Actors whose statements about their own work are always claims. */
const SELF_INTERESTED_ACTORS: readonly AqualaTraceActorType[] = ['agent', 'reviewer'];

/** Services authorized to assert `verified`. Relay's verification service and
    the ledger's own integrity checker — never an agent, never an adapter. */
export const AUTHORIZED_VERIFICATION_SERVICES: readonly string[] = [
  'relay-verification',
  'relay-completion-evaluator',
  'relay-trace-integrity',
];

/** Services authorized to assert `attested` — trusted supervisory sources. */
export const AUTHORIZED_ATTESTATION_SERVICES: readonly string[] = [
  'relay-supervisor',
  'relay-workspace-monitor',
  'relay-permission-service',
  'relay-review-service',
  'relay-approval-service',
  'relay-trace-integrity',
  'trusted-adapter',
];

export interface SourceTrustContext {
  actorId: string;
  actorType: AqualaTraceActorType;
  sourceService: string;
  requestedTrust: AqualaTraceSourceTrust;
  /** Agent ids this event is ABOUT — an actor among them is self-reporting. */
  subjectAgentIds?: readonly string[];
}

/**
 * Validates a requested trust level. A self-interested actor reporting on
 * itself is capped at `claim`; `attested` and `verified` require an
 * authorized service. Rejection is structural, never a silent downgrade — a
 * caller that asked for more credibility than it is entitled to must see the
 * refusal rather than quietly get less.
 */
export function validateSourceTrust(
  context: SourceTrustContext,
): TraceResult<AqualaTraceSourceTrust> {
  const { actorId, actorType, sourceService, requestedTrust } = context;
  const subjects = context.subjectAgentIds ?? [];
  /* Self-reporting is about the SUBJECT, not about a service naming itself as
     the actor: a Relay service legitimately emits its own observations. What
     is never allowed is an agent/reviewer speaking for itself, or any actor
     that is the agent the event is ABOUT. */
  const isSelfReport =
    SELF_INTERESTED_ACTORS.includes(actorType) || subjects.includes(actorId);

  if (isSelfReport && requestedTrust !== 'claim') {
    return traceFail(
      traceError(
        'AGENT_SELF_ATTESTATION_FORBIDDEN',
        `${actorId} is reporting on its own work and cannot mark the event "${requestedTrust}"`,
        'record this as a claim, or let a supervisory service attest it independently',
        {
          field: 'sourceTrust',
          expected: 'claim',
          actual: requestedTrust,
        },
      ),
    );
  }

  if (requestedTrust === 'verified' && !AUTHORIZED_VERIFICATION_SERVICES.includes(sourceService)) {
    return traceFail(
      traceError(
        'INVALID_SOURCE_TRUST',
        `"${sourceService}" is not an authorized verification service and cannot mark an event verified`,
        'record the event as observed or attested, or route it through the verification service',
        { field: 'sourceService', expected: 'an authorized verification service', actual: sourceService },
      ),
    );
  }

  if (requestedTrust === 'attested' && !AUTHORIZED_ATTESTATION_SERVICES.includes(sourceService)) {
    return traceFail(
      traceError(
        'INVALID_SOURCE_TRUST',
        `"${sourceService}" is not a trusted supervisory source and cannot attest`,
        'record the event as observed, or have a supervisory source attest it',
        { field: 'sourceService', expected: 'a trusted supervisory source', actual: sourceService },
      ),
    );
  }

  return traceOk(requestedTrust);
}

/** The default trust for an actor reporting on its own work. */
export function defaultTrustForActor(actorType: AqualaTraceActorType): AqualaTraceSourceTrust {
  return SELF_INTERESTED_ACTORS.includes(actorType) ? 'claim' : 'observed';
}

/** True when the event is a supervisory observation rather than a self-report. */
export function isSupervisoryTrust(trust: AqualaTraceSourceTrust): boolean {
  return trust === 'attested' || trust === 'verified';
}
