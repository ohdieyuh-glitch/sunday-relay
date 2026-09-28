/**
 * MAY THIS PLAYER SEE THIS PROJECT'S WORLD?
 *
 * The Bridge's browser session proves a PLAYER and an ORIGIN. It does not prove
 * a project, and `/wonderland/julius/*` has been answering 503 rather than
 * guessing. This is the missing answer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE AUTHORITY ALREADY EXISTS, AND THIS DOES NOT REPLACE IT.
 *
 * `relay_wonderland.project_members(project_id, player_id, role)` has been the
 * membership record since migration 001, and `julius-tool-postgres.ts` already
 * authorises tool execution against it in production. A second membership model
 * would be a second answer to "who may see this", and the two would diverge on
 * the day somebody was removed from one.
 *
 * So this module holds NO records. It is the decision only: given what the
 * canonical table says, may this player do this thing? The reading of the table
 * belongs to persistence, where it already is.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * WHY A CAPABILITY AND NOT A BOOLEAN. `mayReadProject` would answer today's
 * question and would have to be replaced the first time anything needs a
 * narrower or wider permission — and the replacement would land in a route,
 * where authorisation decisions are hardest to review. A capability is the same
 * work now and does not need replacing.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: invent a role hierarchy. The column has
 * no CHECK constraint, no TypeScript vocabulary, and exactly one value is ever
 * written — `OWNER`, by `mission-seed.ts`. Declaring Leader, Editor, Developer,
 * Reviewer, Viewer and Guest here would be inventing a permission model the
 * product has not decided, in the file least able to enforce it. When the
 * product decides, `WONDERLAND_ROLE_CAPABILITIES` is where it lands, and every
 * role absent from it grants nothing until then.
 */

import { exactKeys } from './wonderland-contracts';

export const WONDERLAND_AUTHORIZATION_SCHEMA_V1 = 'relay-wonderland-authz.v1' as const;

/**
 * What a world session can be authorised to do.
 *
 * ONE ENTRY TODAY, because one thing is being authorised: reading a project's
 * world state. Adding a second is adding a row to the role table below, not a
 * new decision function — which is the point of the shape.
 */
export const WONDERLAND_PROJECT_CAPABILITIES = [
  /**
   * Read a project's runs as world state: mission phase, activity, usage,
   * Project Brain scope and C.A.R.D. slots. READ ONLY, and narrowed further by
   * the scope contracts before anything crosses to a client.
   */
  'read_world_state',
  /**
   * Read a run's USER RESULT (founder decision 5, 2026-09-27): its final state,
   * whether it was verified, what it made, each acceptance criterion and
   * whether it was met, the reviewer's verdict, what is still open, and why it
   * failed if it did. Never reasoning, secrets, credentials or host paths --
   * `wonderland-julius-result.ts` is the projection that keeps that true.
   */
  'read_mission_result',
  /**
   * Read a run's EXACT SPEND. Founder decision 5: the project OWNER and an
   * explicitly authorised ADMIN see it; an ordinary member sees the result
   * without it. Split from `read_mission_result` so that rule is one row here
   * rather than a branch in a route.
   */
  'read_mission_cost',
] as const;
export type WonderlandProjectCapability = (typeof WONDERLAND_PROJECT_CAPABILITIES)[number];

/**
 * What each role may do. THE ONE PLACE A PERMISSION MODEL BELONGS.
 *
 * `OWNER` is the only role the product writes, so it is the only role here. A
 * role the table holds and this table does not is NOT an error and NOT an
 * allow: it grants nothing, and the refusal names it as unrecognised so an
 * operator can see the product moved without this file.
 *
 * Absent-means-nothing is the whole safety property. An allow-list that
 * defaulted open would hand every future role every capability the day it was
 * inserted, before anybody had decided what it was for.
 *
 * DECIDED, NOT YET WRITTEN (founder decisions 4 and 5, 2026-09-27). An
 * explicitly authorised ADMIN is to hold what OWNER holds, and an ordinary
 * MEMBER `read_world_state` and `read_mission_result` -- never
 * `read_mission_cost`. They are not rows here yet because nothing in the
 * product writes those roles, and this table names only roles that are written
 * (the seed test holds that). The route that first writes one adds its row.
 */
export const WONDERLAND_ROLE_CAPABILITIES: Readonly<
  Record<string, readonly WonderlandProjectCapability[]>
> = Object.freeze({
  OWNER: Object.freeze(['read_world_state', 'read_mission_result', 'read_mission_cost'] as const),
});

/**
 * One row of the canonical membership table, as this module needs it.
 *
 * Declared rather than imported, the same inversion the Project Brain and
 * C.A.R.D. scopes use: persistence owns the row, this owns the decision, and
 * nothing here can reach a column it was not handed.
 */
export interface WonderlandMembership {
  readonly projectId: string;
  readonly playerId: string;
  /** Whatever the column holds. Never assumed to be a known role. */
  readonly role: string;
}

/**
 * Why a request was refused. FOR OPERATORS, NOT FOR CALLERS.
 *
 * A caller learns one thing — denied — and these never reach it. Telling an
 * unauthorised person that a project EXISTS but they lack a role, versus that
 * it does not exist, is a membership oracle: query project ids until the
 * refusal changes shape and the tenant list falls out.
 */
export const WONDERLAND_AUTHORIZATION_VERDICTS = [
  'granted',
  /** No row for this player in this project. The common denial. */
  'not_a_member',
  /** A row exists and its role is not in the capability table. */
  'unrecognised_role',
  /** A row exists, the role is known, and it does not carry this capability. */
  'role_lacks_capability',
  /** The record handed in describes a different player or project than asked. */
  'record_mismatch',
  /** The question itself was malformed: a blank player, project or capability. */
  'malformed_request',
] as const;
export type WonderlandAuthorizationVerdict =
  (typeof WONDERLAND_AUTHORIZATION_VERDICTS)[number];

export interface WonderlandAuthorizationRequest {
  readonly playerId: string;
  readonly projectId: string;
  readonly capability: WonderlandProjectCapability;
}

export interface WonderlandAuthorizationDecision {
  readonly schemaVersion: typeof WONDERLAND_AUTHORIZATION_SCHEMA_V1;
  readonly granted: boolean;
  readonly verdict: WonderlandAuthorizationVerdict;
  /** For an operator's log. NEVER for a response body. */
  readonly detail: string;
  /** Echoed so a log line can be read without the request beside it. */
  readonly playerId: string;
  readonly projectId: string;
  readonly capability: WonderlandProjectCapability;
}

export const WONDERLAND_AUTHORIZATION_DECISION_FIELDS =
  exactKeys<WonderlandAuthorizationDecision>()([
    'schemaVersion',
    'granted',
    'verdict',
    'detail',
    'playerId',
    'projectId',
    'capability',
  ] as const);

const blank = (value: string): boolean => typeof value !== 'string' || value.trim() === '';

const decide = (
  request: WonderlandAuthorizationRequest,
  verdict: WonderlandAuthorizationVerdict,
  detail: string,
): WonderlandAuthorizationDecision =>
  Object.freeze({
    schemaVersion: WONDERLAND_AUTHORIZATION_SCHEMA_V1,
    granted: verdict === 'granted',
    verdict,
    detail,
    playerId: request.playerId,
    projectId: request.projectId,
    capability: request.capability,
  });

/**
 * Decide one request against one membership record, or the absence of one.
 *
 * `null` MEANS NO ROW, AND NOT "COULD NOT LOOK". Those are different facts with
 * different safe answers: no row is a denial, and a lookup that failed is a
 * 503 the caller above must produce — it never reaches here, because a
 * function that could not tell them apart would eventually be handed a failure
 * and read it as an absence.
 */
export function authorizeWonderlandProjectCapability(
  request: WonderlandAuthorizationRequest,
  membership: WonderlandMembership | null,
  /**
   * The role table. Defaults to the canonical one and is injectable only so a
   * test can reach the `role_lacks_capability` branch.
   *
   * THAT BRANCH IS UNREACHABLE TODAY, because one capability exists and the one
   * role carries it — and an untested branch in an authorisation function is
   * exactly the kind that is wrong the first time it matters. The alternative
   * was inventing a second capability to make it reachable, which would put a
   * permission the product has not decided into the vocabulary. Injecting the
   * table costs nothing, leaves the default canonical, and the test that uses
   * it is explicitly testing a future the product has not reached.
   */
  capabilities: Readonly<
    Record<string, readonly WonderlandProjectCapability[]>
  > = WONDERLAND_ROLE_CAPABILITIES,
): WonderlandAuthorizationDecision {
  if (
    blank(request.playerId) ||
    blank(request.projectId) ||
    !(WONDERLAND_PROJECT_CAPABILITIES as readonly string[]).includes(request.capability)
  ) {
    return decide(request, 'malformed_request', 'The request named no player, project or known capability.');
  }

  if (membership === null) {
    return decide(request, 'not_a_member', 'No membership row exists for this player in this project.');
  }

  // THE RECORD MUST ANSWER THE QUESTION THAT WAS ASKED. A caller that looked up
  // the wrong row — or a store that returned a near-miss — would otherwise have
  // its mistake read as an authorisation. Checking is cheap; trusting is not.
  if (membership.playerId !== request.playerId || membership.projectId !== request.projectId) {
    return decide(
      request,
      'record_mismatch',
      'The membership record describes a different player or project than was asked about.',
    );
  }

  const granted = capabilities[membership.role];
  if (granted === undefined) {
    return decide(
      request,
      'unrecognised_role',
      `The membership role is not one this build grants capabilities for.`,
    );
  }
  if (!granted.includes(request.capability)) {
    return decide(request, 'role_lacks_capability', 'That role does not carry this capability.');
  }

  return decide(request, 'granted', 'The membership role carries this capability.');
}

/**
 * THE ONE SENTENCE A DENIED CALLER EVER SEES.
 *
 * Every refusal collapses to this, including the ones that know more. A body
 * that said "not a member" where another said "no such project" is a membership
 * oracle: an attacker enumerates project ids and reads the tenant list off the
 * shape of the answers.
 */
export const WONDERLAND_DENIAL_MESSAGE = 'permission denied' as const;

/**
 * The sentence for an authority that could not answer. DIFFERENT ON PURPOSE.
 *
 * This one is not a denial and must not read as one: the request may have been
 * perfectly authorised and the deployment could not check. Reporting it as
 * denied sends an operator hunting permissions that were never the issue, and
 * reporting it as granted would be the worst outcome available.
 */
export const WONDERLAND_UNAVAILABLE_MESSAGE =
  'Julius world streaming is not configured on this deployment' as const;
