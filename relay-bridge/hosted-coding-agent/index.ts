/**
 * THE HOSTED CODING AGENT — server-side only.
 *
 * Relay's second Coding Agent execution surface. The local surface runs the
 * founder's installed Claude Code against their own subscription; this one runs
 * the Claude Agent SDK — Claude Code as a library — against a server-side
 * credential, so a mission can continue when the founder's machine is off.
 *
 * Nothing here is importable from the browser: it reads a provider credential
 * from the server environment and resolves packages on disk. The browser sees
 * only `sanitizeHostedStatus`, which reports facts ABOUT the configuration and
 * never the configuration itself.
 *
 * The local path is untouched. Two surfaces exist side by side, and every
 * record says which one actually executed.
 */

export {
  DEFAULT_HOSTED_LIMITS, HOSTED_ALLOWED_TOOLS, HOSTED_CHILD_ENV_KEYS,
  HOSTED_DISALLOWED_TOOLS, compileHostedEnvelope, hostedChildEnv,
  verifyGrantedEnvelope, withinCostCeiling,
} from './hosted-envelope';
export type {
  EnvelopeVerification, HostedEnvelope, HostedLimits,
} from './hosted-envelope';

export {
  CODING_AGENT_SURFACES, HOSTED_ADAPTER_ID, HOSTED_API_KEY_ENV, HOSTED_MODEL_ENV,
  HOSTED_SDK_PACKAGE, LOCAL_ADAPTER_ID, nodeResolveProbe, probeHostedReadiness,
  runtimePackageFor, sanitizeHostedStatus, surfaceForAdapter,
} from './hosted-readiness';
export type {
  CodingAgentSurface, HostedReadiness, ResolveProbe, SanitizedHostedStatus,
} from './hosted-readiness';

export {
  UNKNOWN_HOSTED_USAGE, emptyObservation, foldHostedMessage,
  hostedStreamIsUsable, observeHostedMessages,
} from './hosted-observation';
export type { HostedObservation, HostedUsage } from './hosted-observation';

export {
  HOSTED_RUN_ADAPTER_ID, loadHostedQuery, runHostedCodingAgent,
} from './hosted-runner';
export type { HostedQueryFn, HostedRunInput, HostedRunOutcome } from './hosted-runner';

export {
  ACTIVE_HOSTED_STATES, HOSTED_RUN_SCHEMA, HOSTED_RUN_STATES, NO_EVIDENCE,
  isTerminal, newHostedRun, sanitizeHostedRun, settleHostedRun,
} from './hosted-run-record';
export type {
  HostedRunEvidence, HostedRunRecord, HostedRunState, SanitizedHostedRun,
} from './hosted-run-record';

export {
  createHostedRunStore, decideHostedStart, recoverHostedRun,
} from './hosted-run-store';
export type { HostedRunStore, StartDecision } from './hosted-run-store';

export {
  HOSTED_PREFIX, browserMayReadHostedRoute, handleHostedCodingRoute,
  isHostedCodingRoute,
} from './hosted-routes';
export type { HostedCodingRunPort, HostedRouteRequest } from './hosted-routes';
