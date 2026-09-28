import { createHash } from 'node:crypto';

import type { BrowserSessionStore } from './browser-session/grants';
import { isValidProjectId } from './browser-session/grants';
import {
  createJuliusMissionFromTrustedContract,
  type JuliusMissionRoutePorts,
} from './julius-mission-routes';
import {
  composeTrustedMissionContract,
  parsePlayerMissionFields,
  parseStoredExecutionProfile,
} from './wonderland-execution-profile';
import type { PlayerMissionContractStore, WonderlandExecutionProfileStore } from './wonderland-execution-profile-routes';
import {
  authorizeWonderlandCaller,
  type WonderlandProjectMembershipSource,
} from './wonderland-julius-routes';
import type { WonderlandProjectCapability } from '../src/relay/mission/wonderland/wonderland-authorization';

/**
 * A PLAYER CREATES A JULIUS MISSION FROM INSIDE WONDERLAND -- founder decision 4.
 *
 *   POST /wonderland/julius/missions?projectId=<id>
 *     Authorization: Relay-Session <a signed-in player's session from the website,
 *                                   or the native client's, paired for THIS project>
 *     x-relay-idempotency-key: <the client's own key for this mission; a retry
 *                               sends the same one>
 *     body: { objective, requirements, constraints, acceptanceCriteria } -- only
 *
 * WHO: a member whose role carries `create_mission` -- the OWNER today.
 * WITH WHAT: the project's CURRENT execution profile, which the operator wrote
 *   and switched on. The player's body can carry nothing else: a workspace, a
 *   command, a budget or a mission id in it is refused by name.
 * HOW: `createJuliusMissionFromTrustedContract`, the operator route's own
 *   compile -> submit path with its own refusal table. There is one way to
 *   create a Julius mission, and this is a second DOOR to it, not a second way.
 * WHAT IT IS NOT: dispatch. The run lands READY; paid execution remains the
 *   operator's `julius-live-mission run --confirm-live` on the machine that holds
 *   the credentials.
 *
 * THE MISSION'S IDENTITY is a hash of (project, player, idempotency key): a
 * retry is the same mission, which Julius's one-active-run guard answers with
 * the same run; a different contract under the same key is Julius's 409 naming
 * the live run; a deliberate new mission is a new key.
 *
 * WHAT A PLAYER NEVER SEES: the profile. The answer is Julius's creation answer
 * -- run id, state, mission id, "dispatched: false" -- and nothing about where
 * or how the run will execute.
 */

export const WONDERLAND_MISSION_CREATION_PATH = '/wonderland/julius/missions';

/** The capability creation requires. */
export const WONDERLAND_CREATE_MISSION_CAPABILITY: WonderlandProjectCapability = 'create_mission';

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/u;

export interface WonderlandMissionCreationRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly url: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  readonly idempotencyKey: string | undefined;
  readonly body: unknown;
  readonly now: number;
}

export interface WonderlandMissionCreationDeps {
  readonly sessions: BrowserSessionStore;
  readonly membership: WonderlandProjectMembershipSource | null;
  readonly profiles: WonderlandExecutionProfileStore | null;
  /** Where the composed contract and its author are recorded before the run is created. */
  readonly contracts: PlayerMissionContractStore | null;
  readonly missions: JuliusMissionRoutePorts;
  /** Injected only by tests, to reach roles the product does not write yet. */
  readonly roleCapabilities?: Readonly<Record<string, readonly WonderlandProjectCapability[]>>;
}

export interface WonderlandMissionCreationResult {
  readonly status: number;
  readonly body: unknown;
}

const err = (status: number, kind: string, message: string, extra: Record<string, unknown> = {}): WonderlandMissionCreationResult =>
  ({ status, body: { error: { kind, message, ...extra } } });

export function isWonderlandMissionCreationRoute(path: string): boolean {
  return path === WONDERLAND_MISSION_CREATION_PATH;
}

/** The mission suffix for (project, player, key): 12 hex digits of a SHA-256, never player text. */
export function wonderlandMissionSuffix(projectId: string, playerId: string, idempotencyKey: string): string {
  return createHash('sha256').update(`${projectId}\n${playerId}\n${idempotencyKey}`).digest('hex').slice(0, 12);
}

export async function handleWonderlandMissionCreation(
  request: WonderlandMissionCreationRequest,
  deps: WonderlandMissionCreationDeps,
): Promise<WonderlandMissionCreationResult | null> {
  if (!isWonderlandMissionCreationRoute(request.path)) return null;
  if (request.method !== 'POST') return err(405, 'method_not_allowed', 'A mission is created with POST.');

  const projectId = new URL(request.url, 'http://relay.invalid').searchParams.get('projectId');
  if (!isValidProjectId(projectId)) return err(400, 'project_required', 'Name the project: ?projectId=<id>.');

  // WHO, AND MAY THEY: the world routes' own caller check, asking for create_mission.
  const caller = await authorizeWonderlandCaller(
    request, projectId,
    { sessions: deps.sessions, membership: deps.membership ?? undefined, roleCapabilities: deps.roleCapabilities },
    WONDERLAND_CREATE_MISSION_CAPABILITY,
  );
  if (!caller.ok) return { status: caller.status, body: { error: { kind: 'not_authorized', message: caller.error } } };

  const key = request.idempotencyKey?.trim();
  if (key === undefined || !IDEMPOTENCY_KEY_RE.test(key)) {
    return err(400, 'idempotency_key_required',
      'Send x-relay-idempotency-key: 8-128 letters, digits or ._:- naming THIS mission. A retry sends the same key, so a '
      + 'double submission is one mission, not two.');
  }

  // THE PLAYER'S HALF, and only that half.
  const fields = parsePlayerMissionFields(request.body);
  if (!fields.ok) {
    return err(400, fields.kind, fields.problem, fields.forbidden === undefined ? {} : { forbidden: fields.forbidden });
  }

  // THE OPERATOR'S HALF: the project's current profile, re-validated -- a stored profile that no longer parses is the
  // operator's to fix, and nothing is created from it.
  if (deps.profiles === null) {
    return err(503, 'execution_profile_store_unavailable', 'No durable store is reachable, so no mission can be composed.');
  }
  let record: Awaited<ReturnType<WonderlandExecutionProfileStore['current']>>;
  try {
    record = await deps.profiles.current(projectId);
  } catch {
    return err(503, 'execution_profile_store_unavailable', 'The execution profile could not be read; nothing was created.');
  }
  if (record === null) {
    return err(409, 'execution_not_configured',
      'This project has no execution profile yet. An operator sets where and how its missions may run; nothing was created.');
  }
  const profile = parseStoredExecutionProfile(projectId, record.body);
  if (!profile.ok) {
    return err(503, 'execution_profile_invalid',
      'This project\'s execution profile no longer validates; an operator must rewrite it. Nothing was created.');
  }
  if (!profile.value.enabled) {
    return err(403, 'execution_disabled', 'An operator has switched off mission creation for this project. Nothing was created.');
  }

  const composed = composeTrustedMissionContract(profile.value, fields.value,
    wonderlandMissionSuffix(projectId, caller.playerId, key));
  if (!composed.ok) return err(400, 'malformed_mission', composed.problem);

  // WHO ASKED, AND THE EXACT CONTRACT -- recorded BEFORE the run exists, so a mission that exists always has both.
  // Fail closed: if this cannot be recorded, nothing is created.
  if (deps.contracts === null) {
    return err(503, 'mission_contract_store_unavailable', 'The mission record cannot be written, so nothing was created.');
  }
  try {
    await deps.contracts.record({
      missionId: composed.value.missionId, projectId, playerId: caller.playerId,
      profileVersion: record.version, contract: composed.value,
    });
  } catch {
    return err(503, 'mission_contract_store_unavailable', 'The mission record could not be written; nothing was created.');
  }

  const created = await createJuliusMissionFromTrustedContract(composed.value, deps.missions);
  const runId = (created.body as { data?: { runId?: unknown } }).data?.runId;
  if (created.status === 201 && typeof runId === 'string') {
    // Best effort: the record already holds the contract and its author, and a retry with the same key fills this.
    await deps.contracts.attachRun(composed.value.missionId, runId).catch(() => undefined);
  }
  return created;
}
