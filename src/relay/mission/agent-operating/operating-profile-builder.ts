/**
 * SUNDAY RELAY — BUILDING AN OPERATING PROFILE FROM CANONICAL STATE.
 *
 * A profile is DERIVED, never authored. Its runtime comes from the execution
 * attestation Relay already records, its mission-contract reference from the
 * contract itself, its tools from the role's grant table checked against the
 * mode policy. Nothing here is a second source of truth, and nothing here
 * invents a value it was not given.
 *
 * PURE. No I/O, no provider call, no clock.
 */

import type { RelayExecutionAttestation, RelayMissionContract } from '../contracts';
import type { RelayMode, RelayModePolicy } from '../modes';
import { toolGrantsForRole, toolGrantsOutsidePolicy } from './operating-profile-tools';
import type {
  RelayAgentOperatingProfile,
  RelayAgentRole,
  RelayEnvironmentReference,
  RelayMissionContractReference,
  RelayRuntimeReference,
} from './operating-profile-types';

/**
 * THE MISSION CONTRACT, REFERENCED.
 *
 * Only identity plus the few display fields survive. The requirements,
 * constraints and acceptance criteria stay in the contract, where there is
 * exactly one of them.
 */
export function missionContractReference(
  contract: RelayMissionContract,
  mode: RelayMode,
): RelayMissionContractReference {
  return {
    missionId: contract.missionId,
    revision: contract.revision,
    bindingDigest: contract.bindingDigest,
    title: contract.title,
    mode,
    status: contract.status,
    completionRule: contract.completionRule,
  };
}

/**
 * THE RUNTIME, FROM THE ATTESTATION.
 *
 * `launchVerified` is what distinguishes "connected" from "a runtime we asked
 * for". A requested-but-unverified launch is `not_connected`, and an
 * attestation with no actual identity at all leaves the fields `null` so they
 * render as `Unknown`. Relay never fills these in with a guess.
 */
export function runtimeReferenceFromAttestation(
  attestation: Pick<
    RelayExecutionAttestation,
    'requestedAgentType' | 'actualAgentType' | 'adapterId' | 'modelVersion' | 'launchVerified' | 'provenance'
  >,
): RelayRuntimeReference {
  const actual = attestation.actualAgentType.trim() === '' ? null : attestation.actualAgentType;
  return {
    requestedAgentType: attestation.requestedAgentType,
    actualAgentType: actual,
    adapterId: attestation.adapterId.trim() === '' ? null : attestation.adapterId,
    modelVersion: attestation.modelVersion,
    executionMode: attestation.provenance,
    availability: attestation.launchVerified ? 'connected' : actual === null ? 'unknown' : 'not_connected',
  };
}

/** A runtime nothing has reported on yet. Every unknown stays unknown. */
export function unknownRuntimeReference(requestedAgentType: string): RelayRuntimeReference {
  return {
    requestedAgentType,
    actualAgentType: null,
    adapterId: null,
    modelVersion: null,
    executionMode: 'simulated',
    availability: 'unknown',
  };
}

export interface BuildAgentOperatingProfileInput {
  readonly role: RelayAgentRole;
  readonly runtime: RelayRuntimeReference;
  readonly contract: RelayMissionContract;
  readonly mode: RelayMode;
  readonly environment: RelayEnvironmentReference;
  /** The authority on what may be granted. Prohibited grants are dropped. */
  readonly policy: Pick<RelayModePolicy, 'prohibitedTools'>;
}

/**
 * Builds one agent's operating profile.
 *
 * A grant the mode policy prohibits is DROPPED rather than displayed, because
 * a tool list is a claim about what the agent may do — showing a capability
 * the policy forbids would be exactly the kind of untrue statement this
 * foundation exists to prevent.
 */
export function buildAgentOperatingProfile(
  input: BuildAgentOperatingProfileInput,
): RelayAgentOperatingProfile {
  const granted = toolGrantsForRole(input.role);
  const refused = new Set(toolGrantsOutsidePolicy(granted, input.policy).map((g) => g.toolId));
  return {
    role: input.role,
    runtime: input.runtime,
    missionContract: missionContractReference(input.contract, input.mode),
    environment: input.environment,
    tools: granted.filter((grant) => !refused.has(grant.toolId)),
  };
}
