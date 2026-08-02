/**
 * THE HERMES REVIEWER HARNESS ADAPTER — server-side only.
 *
 * Hermes is the HARNESS, xAI is the PROVIDER and Grok is the MODEL. The three
 * are separate identities everywhere in this module and are never collapsed
 * into one label.
 *
 * Nothing here is importable from the browser: it spawns processes, reads a
 * credential from the server environment and touches the filesystem. The
 * browser reaches it only through the existing Relay Bridge boundary.
 */

export {
  MINIMUM_HERMES_VERSION, NOT_INSTALLED, REQUIRED_ONESHOT_FLAGS,
  createProbe, discoverHermes, parseHermesVersion, versionAtLeast,
} from './discovery';
export type { HermesDiscovery, HermesMachineInterface, Probe, ProbeResult } from './discovery';

export {
  DISABLED_TOOLSETS, WRITE_CAPABLE_TOOLSETS, createIsolatedProfile,
  isolatedChildEnv, isolatedConfigYaml, unknownToolsets,
} from './isolated-profile';
export type { IsolatedProfile } from './isolated-profile';

export {
  XAI_API_KEY_ENV, XAI_BASE_URL_ENV, XAI_DEFAULT_BASE_URL, XAI_PROVIDER_ID,
  describeXaiConfig, loadXaiConfig, modelMatchesVerified, parseModelList, verifyXaiModel,
} from './xai-models';
export type { FetchLike, XaiConfig, XaiModelRecord, XaiVerification } from './xai-models';

export { REVIEWER_HARNESS_ID, REVIEWER_PROVIDER_ID, localReadiness, verifiedReadiness } from './readiness';
export type { HermesReadinessInput, VerifiedReadiness } from './readiness';

export {
  DEFAULT_RUN_LIMITS, UNKNOWN_USAGE, buildHermesArgs, parseUsageFile, runHermesReviewer,
} from './runner';
export type { HermesRunInput, HermesRunLimits, HermesRunOutcome, HermesUsage } from './runner';

export {
  HERMES_FAILURE_KINDS, HERMES_MODES, HERMES_SERVICE_PROTOCOL, selectHermesMode,
} from './hermes-transport';
export type {
  HermesConnectionEvidence, HermesFailureKind, HermesMode, HermesReviewerTransport,
  RemoteHermesCancelResult, RemoteHermesReviewInput, RemoteHermesReviewStart,
  RemoteHermesReviewState,
} from './hermes-transport';
export {
  ALL_PROVIDER_ENV_NAMES, HERMES_PROVIDERS, PROVIDER_BASE_URL_ENV, PROVIDER_CREDENTIAL_ENV,
  describeProvider, loadHermesProviderConfig, providerEnvNames, providerVerificationLimit,
} from './hermes-provider';
export type { HermesProviderConfig, HermesProviderId, SafeProviderIdentity } from './hermes-provider';
export { createRemoteHermesTransport } from './remote-transport';
export { buildHermesTransport } from './transport-factory';
