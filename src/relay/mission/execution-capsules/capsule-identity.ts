/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Requested vs actual agent identity, launch attestation, fallback, and
 * review-credit eligibility (PURE).
 *
 * The product rule this module makes structurally impossible to violate:
 *
 *   what Relay ASKED to launch and what Relay OBSERVED launching are separate
 *   facts, and a requested agent earns no execution or review credit until a
 *   TRUSTED SUPERVISORY source proves the external runtime actually started.
 *
 * `actualAgentId` is not an optional field a caller may fill in — it exists
 * only inside the `verified` and `fallback_unauthorized` identity states, so a
 * wrapper response, a generated sentence claiming "Codex reviewed this", or an
 * agent's own report can never populate it. An unauthorized fallback is its
 * own state precisely because it must remain visible and must never reach
 * `running`.
 *
 * Compatibility: the production `RelayExecutionAttestation`
 * (src/relay/mission/contracts.ts, built by src/relay/mission/attestation.ts)
 * remains the real attestation record. This module defines the capsule-scoped
 * LAUNCH attestation and an adapter FROM the production record — it never
 * builds production attestations and never lets an agent self-attest.
 */

import type { RelayExecutionAttestation } from '../contracts';
import { capsuleError, capsuleFail, capsuleOk, type CapsuleResult } from './capsule-errors';

/* ---------------------------------------------------------- identities */

export interface RequestedAgentIdentity {
  readonly agentId: string;
  readonly agentType: string;
  /** Execution identity — a new SESSION of the same identity is the same
      party (reviewer independence, Milestone 2 semantics). */
  readonly executionIdentityId?: string;
  readonly adapterId?: string;
}

export interface ActualAgentIdentity {
  readonly agentId: string;
  readonly agentType: string;
  readonly executionIdentityId?: string;
  readonly adapterId?: string;
  readonly adapterVersion?: string;
  readonly externalSessionId?: string;
  readonly modelProvider?: string;
  readonly modelName?: string;
  readonly modelVersion?: string;
  readonly runtimeName?: string;
  readonly runtimeVersion?: string;
}

/* --------------------------------------------------- launch attestation */

export const LAUNCH_VERIFICATION_SOURCES = [
  'relay_supervisor',
  'trusted_adapter',
  'workspace_monitor',
  'none',
] as const;
export type LaunchVerificationSource = (typeof LAUNCH_VERIFICATION_SOURCES)[number];

export interface RelayExecutionLaunchAttestation {
  readonly attestationId: string;
  readonly capsuleId: string;
  readonly requestedAgentId: string;
  readonly actualAgentId?: string;
  readonly requestedExecutionIdentityId?: string;
  readonly actualExecutionIdentityId?: string;
  readonly launchRequestedAt: string;
  readonly launchVerifiedAt?: string;
  readonly verificationSource: LaunchVerificationSource;
  readonly externalSessionId?: string;
  readonly verified: boolean;
  readonly failureReason?: string;
  /** Who asserted this — must never be the agent being attested. */
  readonly attestedBy: string;
}

export interface CreateLaunchAttestationInput {
  attestationId: string;
  capsuleId: string;
  requestedAgentId: string;
  actualAgentId?: string;
  requestedExecutionIdentityId?: string;
  actualExecutionIdentityId?: string;
  launchRequestedAt: string;
  launchVerifiedAt?: string;
  verificationSource: LaunchVerificationSource;
  externalSessionId?: string;
  verified: boolean;
  failureReason?: string;
  attestedBy: string;
}

/**
 * Builds a capsule-scoped launch attestation. DETERMINISTIC FIXTURE/DOMAIN
 * RECORD ONLY — real attestations must later be emitted by a trusted
 * supervisory or adapter layer that independently observed the process, never
 * by the executing agent and never by this milestone.
 */
export function createLaunchAttestation(
  input: CreateLaunchAttestationInput,
): CapsuleResult<RelayExecutionLaunchAttestation> {
  // An agent may never attest its own launch, whatever source it names.
  if (
    input.attestedBy === input.requestedAgentId ||
    (input.actualAgentId !== undefined && input.attestedBy === input.actualAgentId)
  ) {
    return capsuleFail(
      capsuleError(
        'AGENT_SELF_ATTESTATION_FORBIDDEN',
        `${input.attestedBy} cannot attest its own launch`,
        'have a Relay supervisor, workspace monitor, or trusted adapter attest the launch',
        {
          capsuleId: input.capsuleId,
          field: 'attestedBy',
          expected: 'a supervisory attester',
          actual: input.attestedBy,
        },
      ),
    );
  }

  if (input.verified) {
    if (input.verificationSource === 'none') {
      return capsuleFail(
        capsuleError(
          'INVALID_LAUNCH_ATTESTATION',
          'a verified launch requires a named trusted verification source',
          'name the supervisory source that observed the launch',
          { capsuleId: input.capsuleId, field: 'verificationSource', actual: 'none' },
        ),
      );
    }
    if (!input.actualAgentId) {
      return capsuleFail(
        capsuleError(
          'INVALID_LAUNCH_ATTESTATION',
          'a verified launch must name the agent that was actually observed running',
          'record the observed runtime identity, or mark the attestation unverified',
          { capsuleId: input.capsuleId, field: 'actualAgentId' },
        ),
      );
    }
    if (!input.launchVerifiedAt) {
      return capsuleFail(
        capsuleError(
          'INVALID_LAUNCH_ATTESTATION',
          'a verified launch must record when verification occurred',
          'supply launchVerifiedAt from the supervisory observation',
          { capsuleId: input.capsuleId, field: 'launchVerifiedAt' },
        ),
      );
    }
    if (input.launchVerifiedAt < input.launchRequestedAt) {
      return capsuleFail(
        capsuleError(
          'INVALID_TIMESTAMP_ORDER',
          'launch cannot be verified before it was requested',
          'correct the observation timestamps',
          {
            capsuleId: input.capsuleId,
            field: 'launchVerifiedAt',
            expected: `>= ${input.launchRequestedAt}`,
            actual: input.launchVerifiedAt,
          },
        ),
      );
    }
  } else if (input.actualAgentId) {
    // An UNVERIFIED attestation may still report what was observed instead
    // (that is how an unauthorized wrapper is caught) — but it must say why
    // the requested launch was not verified.
    if (!input.failureReason) {
      return capsuleFail(
        capsuleError(
          'INVALID_LAUNCH_ATTESTATION',
          'an unverified attestation naming a different runtime must state why the requested launch failed',
          'supply failureReason describing what was observed instead',
          { capsuleId: input.capsuleId, field: 'failureReason' },
        ),
      );
    }
  }

  return capsuleOk(Object.freeze({ ...input }));
}

/**
 * Compatibility adapter: the PRODUCTION `RelayExecutionAttestation` already
 * carries requested/actual identity, launchRequested/launchVerified, fallback,
 * and session/version facts. This reads that record into the capsule-scoped
 * launch attestation WITHOUT copying the production record into the capsule
 * and without inventing anything it does not assert.
 */
export function adaptProductionExecutionAttestation(
  attestation: RelayExecutionAttestation,
  capsuleId: string,
  attestedBy: string,
): CapsuleResult<RelayExecutionLaunchAttestation> {
  return createLaunchAttestation({
    attestationId: attestation.attestationId,
    capsuleId,
    requestedAgentId: attestation.requestedAgentId,
    actualAgentId: attestation.launchVerified ? attestation.actualAgentId : undefined,
    externalSessionId: attestation.externalSessionId ?? undefined,
    launchRequestedAt: attestation.startedAt ?? '',
    launchVerifiedAt: attestation.launchVerified ? (attestation.startedAt ?? '') : undefined,
    verificationSource: attestation.launchVerified ? 'trusted_adapter' : 'none',
    verified: attestation.launchRequested && attestation.launchVerified,
    failureReason: attestation.launchVerified ? undefined : (attestation.fallbackReason ?? undefined),
    attestedBy,
  });
}

/* ---------------------------------------------------------- fallback */

export type CapsuleFallback =
  | { readonly occurred: false }
  | {
      readonly occurred: true;
      readonly authorized: true;
      readonly authorizedBy: string;
      readonly reason: string;
    }
  | { readonly occurred: true; readonly authorized: false; readonly reason: string };

export const NO_FALLBACK: CapsuleFallback = Object.freeze({ occurred: false });

/* -------------------------------------------------- identity states */

/**
 * The capsule's identity is a DISCRIMINATED UNION, not a bag of optional
 * fields: `actual` simply does not exist until a trusted source verified a
 * launch, and an unauthorized fallback is a distinct state that can never be
 * mistaken for a verified run.
 */
export type CapsuleIdentityState =
  /** Prepared: Relay knows what it intends to launch. Nothing has started. */
  | { readonly kind: 'requested'; readonly requested: RequestedAgentIdentity }
  /** Launch attempted; no trusted source has confirmed activity yet. */
  | {
      readonly kind: 'launch_requested';
      readonly requested: RequestedAgentIdentity;
      readonly launchRequestedAt: string;
      readonly attestationId?: string;
    }
  /** A trusted source proved the requested runtime did NOT become active. */
  | {
      readonly kind: 'launch_failed';
      readonly requested: RequestedAgentIdentity;
      readonly launchRequestedAt: string;
      readonly attestationId: string;
      readonly failureReason: string;
    }
  /** Verified: a trusted source observed this actual runtime running. */
  | {
      readonly kind: 'verified';
      readonly requested: RequestedAgentIdentity;
      readonly actual: ActualAgentIdentity;
      readonly launchRequestedAt: string;
      readonly launchVerifiedAt: string;
      readonly attestationId: string;
      readonly fallback: CapsuleFallback;
    }
  /** Something else ran, and policy did not authorize it. Visible forever;
      never runnable. */
  | {
      readonly kind: 'fallback_unauthorized';
      readonly requested: RequestedAgentIdentity;
      readonly observed: ActualAgentIdentity;
      readonly launchRequestedAt: string;
      readonly attestationId: string;
      readonly reason: string;
    };

/* ------------------------------------------------------- flat accessors */

export function identityRequestedAgentId(identity: CapsuleIdentityState): string {
  return identity.requested.agentId;
}

/** The actual agent id — present ONLY when a launch was verified. An
    unauthorized fallback exposes what was OBSERVED through
    `identityObservedAgentId`, never as the capsule's actual agent. */
export function identityActualAgentId(identity: CapsuleIdentityState): string | undefined {
  return identity.kind === 'verified' ? identity.actual.agentId : undefined;
}

export function identityObservedAgentId(identity: CapsuleIdentityState): string | undefined {
  if (identity.kind === 'verified') return identity.actual.agentId;
  if (identity.kind === 'fallback_unauthorized') return identity.observed.agentId;
  return undefined;
}

export function identityLaunchRequested(identity: CapsuleIdentityState): boolean {
  return identity.kind !== 'requested';
}

export function identityLaunchVerified(identity: CapsuleIdentityState): boolean {
  return identity.kind === 'verified';
}

export function identityFallbackOccurred(identity: CapsuleIdentityState): boolean {
  if (identity.kind === 'verified') return identity.fallback.occurred;
  return identity.kind === 'fallback_unauthorized';
}

export function identityFallbackAuthorized(identity: CapsuleIdentityState): boolean {
  return identity.kind === 'verified' && identity.fallback.occurred && identity.fallback.authorized;
}

/** Every agent id this capsule is ABOUT — used to reject self-attestation and
    agent-authored supervisory events. */
export function identitySubjectAgentIds(identity: CapsuleIdentityState): string[] {
  const ids = [identity.requested.agentId];
  const observed = identityObservedAgentId(identity);
  if (observed && !ids.includes(observed)) ids.push(observed);
  return ids;
}

/**
 * Two identities are the SAME PARTY when they share an execution identity —
 * a fresh session of one runtime is not a different agent. Falls back to the
 * agent id when no execution identity is recorded.
 */
export function isSameExecutionParty(
  a: Pick<RequestedAgentIdentity, 'agentId' | 'executionIdentityId'>,
  b: Pick<ActualAgentIdentity, 'agentId' | 'executionIdentityId'>,
): boolean {
  if (a.executionIdentityId && b.executionIdentityId) {
    return a.executionIdentityId === b.executionIdentityId;
  }
  return a.agentId === b.agentId;
}

/* ------------------------------------------------- review-credit rules */

export interface ReviewCreditAssessment {
  eligible: boolean;
  /** The identity that would receive review attribution, when eligible. */
  creditedAgentId?: string;
  reason: string;
}

/**
 * Review credit requires a VERIFIED actual reviewer identity. A requested
 * reviewer that never launched receives nothing; wrapper output is never
 * credited as the requested reviewer; an authorized fallback credits the agent
 * that ACTUALLY reviewed, never the one that was asked.
 *
 * Eligibility is about identity only — whether the review's findings apply to
 * the CURRENT artifact remains Milestone 1/2 territory (stale-review
 * detection) and is deliberately not decided here.
 */
export function evaluateReviewCredit(
  identity: CapsuleIdentityState,
  responsibility: string,
): ReviewCreditAssessment {
  if (responsibility !== 'review') {
    return { eligible: false, reason: `capsule responsibility is "${responsibility}", not review` };
  }
  switch (identity.kind) {
    case 'requested':
      return { eligible: false, reason: 'the requested reviewer was never launched' };
    case 'launch_requested':
      return {
        eligible: false,
        reason: 'the reviewer launch has not been independently verified',
      };
    case 'launch_failed':
      return {
        eligible: false,
        reason: `the requested reviewer never launched (${identity.failureReason})`,
      };
    case 'fallback_unauthorized':
      return {
        eligible: false,
        reason: `${identity.observed.agentId} ran instead of the requested reviewer without authorization — its output is not ${identity.requested.agentId} review credit`,
      };
    case 'verified':
      return {
        eligible: true,
        creditedAgentId: identity.actual.agentId,
        reason: identity.fallback.occurred
          ? `credit belongs to ${identity.actual.agentId}, the authorized fallback that actually reviewed`
          : `${identity.actual.agentId} launch was independently verified`,
      };
  }
}
