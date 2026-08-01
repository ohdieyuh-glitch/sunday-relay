/**
 * THE READINESS COMPOSER — turns local probes and an explicit provider check
 * into the ONE evidence record the pure domain understands.
 *
 * It is deliberately split in two:
 *
 *   `localReadiness`    free, offline, no provider contact. Safe to call on a
 *                       status request, and it is what a bridge reports when
 *                       nobody has asked for a connection test.
 *   `verifiedReadiness` adds the authenticated model check, and therefore runs
 *                       ONLY from an explicit Test connection or an already
 *                       authorized run.
 *
 * Nothing here ever upgrades itself: a local check cannot conclude a model is
 * verified, so a page that only ever calls `localReadiness` can never display
 * a connected Reviewer.
 */

import type { HarnessRuntimeEvidence } from '../../../src/relay/mission/reviewer-harness/harness-readiness';
import { discoverHermes, type HermesDiscovery, type Probe } from './discovery';
import {
  describeXaiConfig, verifyXaiModel, XAI_PROVIDER_ID,
  type FetchLike, type XaiConfig, type XaiVerification,
} from './xai-models';

export const REVIEWER_HARNESS_ID = 'hermes';
export const REVIEWER_PROVIDER_ID = XAI_PROVIDER_ID;

export interface HermesReadinessInput {
  readonly executable: string;
  readonly probe: Probe;
  readonly xai: XaiConfig;
  readonly now?: () => string;
}

function evidenceFrom(input: {
  discovery: HermesDiscovery;
  credentialPresent: boolean;
  requestedModel: string | null;
  modelVerified: boolean;
  verifiedModelId: string | null;
  checkedAt: string;
  failureReason: string | null;
}): HarnessRuntimeEvidence {
  const d = input.discovery;
  return {
    // This function only ever runs INSIDE a bridge process, so by construction
    // a bridge answered.
    bridgeAvailable: true,
    installed: d.installed,
    binaryPath: d.binaryPath,
    version: d.version,
    compatible: d.compatible,
    machineInterface: d.machineInterface,
    machineInterfaceVerified: d.machineInterfaceVerified,
    credentialPresent: input.credentialPresent,
    modelVerified: input.modelVerified,
    requestedModel: input.requestedModel,
    verifiedModelId: input.verifiedModelId,
    readOnlyEnforceable: d.readOnlyEnforceable,
    checkedAt: input.checkedAt,
    failureReason: input.failureReason ?? d.failureReason,
  };
}

/** Offline readiness. Makes NO provider request — assert this in tests. */
export function localReadiness(input: HermesReadinessInput): HarnessRuntimeEvidence {
  const now = input.now ?? (() => new Date().toISOString());
  const discovery = discoverHermes({ executable: input.executable, probe: input.probe });
  const described = describeXaiConfig(input.xai);
  return evidenceFrom({
    discovery,
    credentialPresent: described.credentialPresent,
    requestedModel: described.requestedModel,
    // A credential is not a verified model, and a local check cannot prove one.
    modelVerified: false,
    verifiedModelId: null,
    checkedAt: now(),
    failureReason: null,
  });
}

export interface VerifiedReadiness {
  readonly evidence: HarnessRuntimeEvidence;
  /** Present only when the provider was actually contacted. */
  readonly verification: XaiVerification | null;
  readonly providerRequestMade: boolean;
}

/**
 * Full readiness, including the authenticated model check.
 *
 * The provider is contacted ONLY when every local requirement already passed —
 * so a missing binary or an incompatible version costs nothing, and a bridge
 * with no credential never issues a request it knows will fail.
 */
export async function verifiedReadiness(
  input: HermesReadinessInput & { fetchImpl?: FetchLike },
): Promise<VerifiedReadiness> {
  const now = input.now ?? (() => new Date().toISOString());
  const local = localReadiness(input);

  const localBlocked = !local.installed || !local.compatible
    || !local.machineInterfaceVerified || !local.readOnlyEnforceable || !local.credentialPresent;
  if (localBlocked) {
    return { evidence: local, verification: null, providerRequestMade: false };
  }

  const verification = await verifyXaiModel({
    config: input.xai, fetchImpl: input.fetchImpl, now,
  });

  const verified = verification.kind === 'verified';
  return {
    evidence: {
      ...local,
      modelVerified: verified,
      verifiedModelId: verified ? verification.verifiedModelId : null,
      checkedAt: now(),
      failureReason: verified ? null : verification.kind === 'credentials_missing'
        ? verification.safeMessage
        : verification.safeMessage,
    },
    verification,
    providerRequestMade: true,
  };
}
