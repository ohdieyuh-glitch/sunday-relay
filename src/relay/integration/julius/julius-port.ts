/**
 * THE JULIUS PUBLIC PORT — Relay's side of the boundary, and nothing beyond it.
 *
 * WHY A PORT EXISTS AT ALL. Julius's merged kernel
 * (`src/relay/mission/julius/julius-runtime.ts`) is a set of pure primitives:
 * a mission state machine, a task graph, a worker registry, evidence types, a
 * verification decision and a context compiler. It exposes no "start a
 * mission" entry point, no event stream, and no cancellation surface — because
 * those belong to the durable runtime, which is being built separately and is
 * not on merged main.
 *
 * Relay still has to be buildable against that seam TODAY. So this module
 * declares the NARROW INTERFACE Relay needs, in Relay's own namespace, tested
 * against fakes. When the durable runtime lands, one adapter implements this
 * port and nothing in the Relay configuration, command or projection layers
 * changes. What this module must never become is a second Julius: it declares
 * shapes and refuses to implement behaviour behind them.
 *
 * THE DEPENDENCY RUNS ONE WAY. Relay depends on the Julius surface. Julius
 * core must never depend on a Relay UI, route or configuration concern — so
 * this file is imported BY the integration layer and never FROM Julius.
 *
 * PURE. No Node, no network, no clock; a `Promise` in an interface is a shape,
 * not an implementation.
 */

import type { JuliusMissionState } from '../../mission/julius/julius-runtime';
import type { RepositoryPermission } from '../../mission/repository-target';
import type { CompoundAgentSlot, PinnedRevisionReference } from '../compound-agent';

/** The wire version of everything this module declares. Bumped, never mutated. */
export const RELAY_JULIUS_PORT_VERSION = 'relay-julius-port.v1' as const;

/* ---------------------------------------------------------- authorization */

/**
 * HOW THE CALLER WAS AUTHENTICATED — never the credential that authenticated
 * it. `authorizationRef` is an opaque, non-secret handle to an authorization
 * record; a token, cookie, bearer value or session secret must never reach
 * this type, which is why there is no field one could be assigned to.
 */
export const JULIUS_AUTHORIZATION_METHODS = [
  'participant_session', 'operator_token', 'service_identity',
] as const;
export type JuliusAuthorizationMethod = (typeof JULIUS_AUTHORIZATION_METHODS)[number];

export interface JuliusBootstrapAuthorization {
  readonly tenantId: string;
  readonly projectId: string;
  readonly ownerParticipant: string;
  readonly method: JuliusAuthorizationMethod;
  /** Opaque reference to the authorization record. Never a secret. */
  readonly authorizationRef: string;
}

/* --------------------------------------------------------- worker requests */

/**
 * ONE WORKER SLOT, AS REQUESTED.
 *
 * NOTE WHAT IS ABSENT: there is no `providerId`. Julius's `JuliusWorker`
 * carries one because Julius's router RESOLVES a provider at dispatch time,
 * against health, policy and budget that Relay cannot see. Writing a provider
 * id here would be Relay pre-empting that decision with a guess, and the guess
 * would be recorded as if it were the answer. Relay names the ADAPTER it has,
 * the CAPABILITIES the configuration requires, and the INDEPENDENCE GROUP that
 * makes reviewer independence checkable — and stops there.
 */
export interface JuliusWorkerRequest {
  readonly role: CompoundAgentSlot;
  readonly integrationId: string;
  readonly adapterId: string;
  /**
   * The vendor/independence group. Carried so Julius can re-check reviewer
   * independence at dispatch without asking Relay, and so a swap between
   * request and dispatch is visible rather than silent.
   */
  readonly independenceGroup: string;
  readonly requiredCapabilities: readonly string[];
}

/* -------------------------------------------------------- bootstrap request */

export const JULIUS_BOOTSTRAP_REQUEST_VERSION = 'relay-julius-bootstrap.v1' as const;

/**
 * THE COMPILED BOUNDARY REQUEST.
 *
 * Everything Julius needs to plan a mission and nothing Relay merely happens
 * to know. It is a VALUE — deterministic given its inputs, serializable, and
 * safe to log: it holds objectives, criteria, ids, adapter names and pinned
 * revisions, and no credential, prompt, provider response or reasoning.
 */
export interface JuliusBootstrapRequest {
  readonly requestVersion: typeof JULIUS_BOOTSTRAP_REQUEST_VERSION;
  /** Supplied by the caller; makes a retried submit safe to repeat. */
  readonly idempotencyKey: string;

  readonly missionId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly compoundAgentId: string;
  readonly compoundAgentRevision: number;
  readonly authorization: JuliusBootstrapAuthorization;

  readonly objective: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly scope: {
    readonly filesInScope: readonly string[];
    readonly filesOutOfScope: readonly string[];
    readonly systemsInScope: readonly string[];
    readonly systemsOutOfScope: readonly string[];
  };

  readonly workers: readonly JuliusWorkerRequest[];
  readonly card: PinnedRevisionReference;
  readonly projectBrain: PinnedRevisionReference;
  /**
   * The repository authority this run REQUESTS. Requested, never granted:
   * Relay's repository resolver narrows it against what a human granted on the
   * registration, and Julius narrows it again per worker and per sub-agent.
   * Carrying it is what lets Julius refuse a task that needs authority the
   * mission never asked for, instead of discovering it at the git call.
   */
  readonly requestedPermissions: readonly RepositoryPermission[];

  readonly executionMode: 'guided' | 'semi' | 'autonomous';
  readonly reviewRequirement: 'none' | 'independent' | 'security' | 'manual_founder';
  readonly completionRule: 'all_blocking_criteria_and_independent_review' | 'all_blocking_criteria';
  readonly limits: {
    readonly runtimeMinutes: number | null;
    readonly agentCalls: number | null;
    readonly spendUsd: number | null;
    readonly reviewCycles: number | null;
    readonly repairCycles: number | null;
  };

  /** The mission revision and digest this request was compiled from. */
  readonly missionRevision: number;
  readonly missionBindingDigest: string;
  readonly compiledAt: string;
}

/* -------------------------------------------------------------- outcomes */

/**
 * A SUBMISSION MAY BE DENIED, AND THE TYPE SAYS SO.
 *
 * Every request across this boundary is a REQUEST. Julius's policy engine,
 * budget reservations and provider health can all refuse one, and a Relay
 * surface that modelled acceptance as the only outcome would render a run that
 * does not exist. `accepted: false` is therefore a first-class result rather
 * than a thrown error: refusal is ordinary, and ordinary things are values.
 *
 * `runId` appears only on the accepted branch, so no caller can read one out
 * of a refusal.
 */
export type JuliusBootstrapOutcome =
  | {
    readonly accepted: true;
    readonly runId: string;
    readonly acceptedAt: string;
    readonly state: JuliusMissionState;
  }
  | {
    readonly accepted: false;
    /** Stable, machine-readable. Never a formatted sentence. */
    readonly reasonCode: string;
    /** Safe to show an operator: no credential, prompt or provider payload. */
    readonly safeMessage: string;
    readonly retryable: boolean;
  };

/**
 * THE ONE METHOD RELAY NEEDS TO START WORK.
 *
 * Deliberately singular. Every additional method here would be a second place
 * Relay could reach into Julius's runtime, and the boundary is only as narrow
 * as its widest hole.
 */
export interface JuliusBootstrapPort {
  readonly portVersion: typeof RELAY_JULIUS_PORT_VERSION;
  submit(request: JuliusBootstrapRequest): Promise<JuliusBootstrapOutcome>;
}

/**
 * THE PORT NOBODY IMPLEMENTED YET.
 *
 * A Relay deployment with no Julius runtime attached must say so, not fail
 * with a stack trace and not pretend a run began. This refuses every submit
 * with a reason an operator can act on, and `retryable: false` because nothing
 * about retrying changes whether a runtime is wired.
 *
 * It is exported for PRODUCTION use, not only for tests: an unwired bridge
 * mounts this and answers honestly, which is the same shape the Loop routes
 * already use when their engine is absent.
 */
export function unwiredJuliusBootstrapPort(): JuliusBootstrapPort {
  return {
    portVersion: RELAY_JULIUS_PORT_VERSION,
    submit: async () => ({
      accepted: false,
      reasonCode: 'julius_runtime_not_wired',
      safeMessage: 'No Julius runtime is attached to this deployment, so no mission can be started. The request was compiled and validated; it was not submitted anywhere.',
      retryable: false,
    }),
  };
}
