import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  WONDER_WEB_CAPABILITIES,
  type WonderWebCapability,
  type WonderWebCreationDraft,
  type WonderWebRuntimeType,
} from './wonder-web-contracts';

/**
 * WONDER WEB — the execution boundary.
 *
 * Generated software is software nobody reviewed. This module decides what it
 * may reach, and the answer is NOTHING unless something explicitly said
 * otherwise. Two separate questions live here and they are kept apart on
 * purpose, because collapsing them is how a sandbox comes to be described
 * rather than enforced:
 *
 *   1. IS IT PERMITTED?  — a capability grant. Policy. Fail closed.
 *   2. IS IT ENFORCED?   — an isolation profile. Mechanism. Claimed honestly.
 *
 * A grant that permits network egress does not make egress safe, and a mechanism
 * that blocks egress does not make it permitted. A run needs both to proceed,
 * and `authorizeWonderWebRun` is where the two are required together.
 *
 * WHY THE HONESTY MATTERS MORE THAN THE MECHANISM. The instruction this was
 * built to was explicit: do not build fake security, and where a capability is
 * not truly isolated, say so. So an isolation profile carries `unenforcedDenials`
 * — capabilities the policy denies but the MECHANISM cannot actually prevent —
 * and a profile with a non-empty `unenforcedDenials` must carry a `limitation`
 * sentence. A test asserts that pairing, so a future profile cannot quietly
 * claim an isolation it does not implement.
 */

/* ------------------------------------------------------------- the grant */

/**
 * An explicit permission, naming who granted it.
 *
 * There is no "grant everything" value and no wildcard. A capability is present
 * in `granted` or it is denied; that is the whole policy model, and its
 * smallness is the point.
 */
export interface WonderWebCapabilityGrant {
  readonly creationId: string;
  /** The Wonderland account that authorized this. Never a session or a device. */
  readonly grantedByUserId: string;
  readonly granted: readonly WonderWebCapability[];
  readonly grantedAtIso: string;
  /** Why, in a sentence, for the audit trail and for the panel that shows it. */
  readonly reason: string;
}

/**
 * THE DEFAULT. Referenced by name wherever a creation has no grant, so that the
 * fail-closed default is a value somebody can read rather than an absence
 * somebody has to notice.
 */
export const WONDER_WEB_NO_CAPABILITIES: readonly WonderWebCapability[] = Object.freeze([]);

export interface WonderWebCapabilityDecision {
  readonly capability: WonderWebCapability;
  readonly allowed: boolean;
  /** Always a sentence. A denial with no reason is not reviewable. */
  readonly reason: string;
}

/**
 * Decide ONE capability against a grant. `null` is the normal case and it denies.
 *
 * A grant belonging to a different creation is not merely ignored — it denies
 * and says why, because silently treating another creation's grant as absent
 * would make a mis-wired caller look like a correctly denied one.
 */
export function decideWonderWebCapability(
  capability: WonderWebCapability,
  creationId: string,
  grant: WonderWebCapabilityGrant | null,
): WonderWebCapabilityDecision {
  if (grant === null) {
    return {
      capability,
      allowed: false,
      reason: 'No capability grant exists for this creation, and the default is to deny.',
    };
  }
  if (grant.creationId !== creationId) {
    return {
      capability,
      allowed: false,
      reason: `The grant presented belongs to creation ${grant.creationId}, not ${creationId}.`,
    };
  }
  return grant.granted.includes(capability)
    ? { capability, allowed: true, reason: `Granted by ${grant.grantedByUserId}: ${grant.reason}` }
    : { capability, allowed: false, reason: 'The grant does not name this capability.' };
}

/** Every capability decided at once — what a panel renders and a log records. */
export function decideAllWonderWebCapabilities(
  creationId: string,
  grant: WonderWebCapabilityGrant | null,
): readonly WonderWebCapabilityDecision[] {
  return WONDER_WEB_CAPABILITIES.map((capability) =>
    decideWonderWebCapability(capability, creationId, grant),
  );
}

/* --------------------------------------------------------- the mechanism */

/**
 * WHAT A RUNTIME ACTUALLY ENFORCES.
 *
 * `enforcedDenials`   the mechanism itself prevents these. Not a promise — a
 *                     property of the frame/CSP/process boundary described.
 * `unenforcedDenials` policy denies these and the mechanism does NOT stop them.
 *                     Non-empty requires `limitation` to say so in words.
 * `betaEligible`      whether a creation on this runtime may be run at all in
 *                     the private beta. False is a refusal, not a warning.
 */
export interface WonderWebIsolationProfile {
  readonly runtimeType: WonderWebRuntimeType;
  readonly mechanism: string;
  readonly enforcedDenials: readonly WonderWebCapability[];
  readonly unenforcedDenials: readonly WonderWebCapability[];
  readonly limitation: string | null;
  readonly betaEligible: boolean;
}

/**
 * THE PROFILES, one per runtime type.
 *
 * `static_bundle` is the one the private beta runs, and it is the one where the
 * claim is defensible: the artifacts are served as inert bytes into a frame with
 * no same-origin privilege and a content policy that permits no outbound
 * connection. The frame cannot reach a filesystem it has no API for, cannot read
 * credentials it has no origin for, and cannot call Wonderland because no bridge
 * object is installed in it.
 *
 * `node_service` and `native_process` are NOT beta-eligible, and the honest
 * reason is recorded rather than softened: running generated code as a host
 * process on the user's machine has no boundary at all short of a container or a
 * VM, and this repository has not built one. Claiming otherwise would be exactly
 * the fake security the design forbids. They stay in the vocabulary because the
 * pipeline must be able to REPRESENT a creation it refuses to run — refusing to
 * model them would push them somewhere unexamined.
 */
export const WONDER_WEB_ISOLATION_PROFILES: Readonly<
  Record<WonderWebRuntimeType, WonderWebIsolationProfile>
> = Object.freeze({
  unknown: {
    runtimeType: 'unknown',
    mechanism: 'none',
    enforcedDenials: WONDER_WEB_CAPABILITIES,
    unenforcedDenials: [],
    limitation: 'Relay has not established how this creation runs, so it is not run.',
    betaEligible: false,
  },
  static_bundle: {
    runtimeType: 'static_bundle',
    mechanism: 'inert-bytes + opaque-origin frame + connect-denying content policy',
    enforcedDenials: WONDER_WEB_CAPABILITIES,
    unenforcedDenials: [],
    limitation: null,
    betaEligible: true,
  },
  node_service: {
    runtimeType: 'node_service',
    mechanism: 'host process — no container, no VM, no syscall boundary',
    enforcedDenials: [],
    unenforcedDenials: WONDER_WEB_CAPABILITIES,
    limitation:
      'A host process shares the user account with Wonderland. Nothing in this repository isolates it, so it is refused rather than run behind a boundary that does not exist.',
    betaEligible: false,
  },
  native_process: {
    runtimeType: 'native_process',
    mechanism: 'host process — no container, no VM, no syscall boundary',
    enforcedDenials: [],
    unenforcedDenials: WONDER_WEB_CAPABILITIES,
    limitation:
      'A native executable receives whatever the signed-in operating-system user has. Nothing in this repository isolates it, so it is refused.',
    betaEligible: false,
  },
});

/* ------------------------------------------------------- run authorization */

export interface WonderWebRunAuthorization {
  readonly creationId: string;
  readonly profile: WonderWebIsolationProfile;
  readonly decisions: readonly WonderWebCapabilityDecision[];
}

/**
 * MAY THIS RUN PROCEED, and under what boundary.
 *
 * Refuses, in this order: a requester who does not own the creation; a runtime
 * whose isolation profile is not beta-eligible; and a grant that permits a
 * capability the mechanism cannot enforce. That last one is the rule that keeps
 * policy and mechanism honest with each other — permission to reach the network
 * from inside a boundary that cannot mediate the network is not a permission,
 * it is a hole, and it is refused at the door.
 */
export function authorizeWonderWebRun(
  creation: WonderWebCreationDraft,
  requesterUserId: string,
  grant: WonderWebCapabilityGrant | null,
): RelayResult<WonderWebRunAuthorization> {
  if (creation.ownerUserId !== requesterUserId) {
    return fail(
      relayError('permission-denied', 'A creation may be run only by the account that owns it.', {
        entityIds: { creationId: creation.creationId },
      }),
    );
  }
  const profile = WONDER_WEB_ISOLATION_PROFILES[creation.runtimeType];
  if (!profile.betaEligible) {
    return fail(
      relayError('permission-denied', profile.limitation ?? 'This runtime is not eligible for the private beta.', {
        entityIds: { creationId: creation.creationId },
        details: [`runtimeType=${creation.runtimeType}`, `mechanism=${profile.mechanism}`],
      }),
    );
  }
  const decisions = decideAllWonderWebCapabilities(creation.creationId, grant);
  const permittedButUnenforced = decisions
    .filter((decision) => decision.allowed && profile.unenforcedDenials.includes(decision.capability))
    .map((decision) => decision.capability);
  if (permittedButUnenforced.length > 0) {
    return fail(
      relayError(
        'permission-denied',
        'A capability was granted that this runtime cannot actually mediate, so the run is refused rather than run behind a boundary that does not exist.',
        {
          entityIds: { creationId: creation.creationId },
          details: permittedButUnenforced,
        },
      ),
    );
  }
  return ok({ creationId: creation.creationId, profile, decisions });
}

/* --------------------------------------------------------- read authority */

/** What one account may do with one creation. Replication is not authorization. */
export type WonderWebAccess = 'none' | 'observe' | 'control';

/**
 * WHO MAY SEE, AND WHO MAY ACT.
 *
 * `observe` is what a co-present player in a multiplayer session gets: they may
 * know the creation exists, its name and its status, because that is what makes
 * Wonderland feel inhabited. It grants no ability to run, stop, rebuild or read
 * the creation's files.
 *
 * `control` is the owner only. The distinction is the entire reason another
 * player's tab can appear in Wonder Web without their creation becoming
 * something a stranger can restart.
 */
export function wonderWebAccessFor(
  creation: WonderWebCreationDraft,
  requesterUserId: string,
  coPresentUserIds: readonly string[] = [],
): WonderWebAccess {
  if (creation.ownerUserId === requesterUserId) return 'control';
  /**
   * THE PREDICATE IS ABOUT THE OWNER, NOT THE REQUESTER.
   *
   * A viewer may know that a creation exists because its OWNER is present in
   * the same session — "I can see your work because you are here with me". An
   * earlier draft asked whether the REQUESTER appeared in the co-present list,
   * which is the same question asked of the wrong person: a requester is never
   * in their own peer list, so `observe` was unreachable and every peer fell
   * through to `none`. That was caught by a test that expected an observed
   * viewport and got a controllable one, because the projection then failed to
   * handle `none` at all and showed the creation. Both halves are fixed; this
   * comment exists so the predicate is not "simplified" back.
   */
  if (coPresentUserIds.includes(creation.ownerUserId)) return 'observe';
  return 'none';
}

/** The control actions. Named so the authorization test can walk all of them. */
export const WONDER_WEB_CONTROL_ACTIONS = [
  'open',
  'run',
  'stop',
  'restart',
  'rebuild',
  'read_files',
  'read_logs',
  'save_to_project',
  'grant_capability',
] as const;
export type WonderWebControlAction = (typeof WONDER_WEB_CONTROL_ACTIONS)[number];

/**
 * Authorize one action. Every control action requires `control`; there is no
 * action an observer may take. A future "shared project" model will widen this
 * by consulting project membership — and it will do it HERE, in one function,
 * rather than at each call site.
 */
export function authorizeWonderWebAction(
  creation: WonderWebCreationDraft,
  requesterUserId: string,
  action: WonderWebControlAction,
  coPresentUserIds: readonly string[] = [],
): RelayResult<null> {
  const access = wonderWebAccessFor(creation, requesterUserId, coPresentUserIds);
  if (access === 'control') return ok(null);
  return fail(
    relayError('permission-denied', `Only the owning account may ${action} this creation.`, {
      entityIds: { creationId: creation.creationId, requesterUserId },
    }),
  );
}
