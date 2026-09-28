import type { Pool } from 'pg';

import { parseExecutionProfile } from './wonderland-execution-profile';

/**
 * THE OPERATOR'S PROJECT EXECUTION PROFILE, OVER HTTP -- founder decision 4.
 *
 *   PUT /julius/projects/:projectId/execution-profile   OPERATOR ONLY. Validates the
 *                                                       profile (wonderland-execution-
 *                                                       profile.ts) and APPENDS it as the
 *                                                       next version. `x-relay-actor` is
 *                                                       required: who set where and how
 *                                                       paid work runs is recorded.
 *   GET /julius/projects/:projectId/execution-profile   OPERATOR ONLY. The current
 *                                                       version, who wrote it, and when.
 *
 * BOTH ARE OPERATOR ONLY, reading included: a profile names a path on the
 * executor machine and a command it runs, which are exactly the "privileged host
 * paths" and "security-sensitive internal implementation details" decision 5
 * keeps from players. No player route reads or writes a profile; a player-created
 * mission reads the current one SERVER-SIDE and never returns it.
 *
 * AN EXECUTION-AUTHORITY WRITE, so its history is kept (the Julius lane's review):
 * versions are append-only rows, the current profile is the highest, and a
 * concurrent writer is refused 409 rather than allowed to overwrite.
 */

export interface WonderlandExecutionProfileRecord {
  readonly version: number;
  /** The stored profile, re-validated by every reader before it is trusted. */
  readonly body: unknown;
  readonly writtenBy: string;
  readonly writtenAt: string;
}

export interface WonderlandExecutionProfileStore {
  /** The highest version, or null when the project has none. THROWS when the store cannot answer. */
  current(projectId: string): Promise<WonderlandExecutionProfileRecord | null>;
  /** Append the next version; `conflict` when a concurrent write took it. THROWS when the store cannot answer. */
  append(input: {
    readonly projectId: string;
    readonly body: unknown;
    readonly writtenBy: string;
  }): Promise<{ readonly ok: true; readonly version: number } | { readonly ok: false; readonly reason: 'conflict' }>;
}

/**
 * WHICH PLAYER CREATED WHICH MISSION, AS WHAT CONTRACT (migration 027's second
 * table). Recorded BEFORE the run exists, so every mission a player created has
 * its exact contract -- the one the operator's paid run needs -- and its author.
 */
export interface PlayerMissionContractRecord {
  readonly missionId: string;
  readonly projectId: string;
  readonly playerId: string;
  readonly profileVersion: number;
  readonly contract: unknown;
  readonly runId: string | null;
  readonly createdAt: string;
}

export interface PlayerMissionContractStore {
  /** Record once per mission id; a retry's second record is a no-op. THROWS when the store cannot answer. */
  record(input: {
    readonly missionId: string;
    readonly projectId: string;
    readonly playerId: string;
    readonly profileVersion: number;
    readonly contract: unknown;
  }): Promise<void>;
  /** Fill the run id Julius answered with, once. */
  attachRun(missionId: string, runId: string): Promise<void>;
  get(missionId: string): Promise<PlayerMissionContractRecord | null>;
}

export interface ExecutionProfileRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  /** True only for a verified OPERATOR credential. */
  readonly operator: boolean;
  /** `x-relay-actor`: which operator is writing. Attribution, not authentication -- the bearer is that. */
  readonly actor: string | undefined;
  readonly body: string | undefined;
}

export interface ExecutionProfileRouteResult {
  readonly status: number;
  readonly body: unknown;
}

const PATH_RE = /^\/julius\/projects\/([^/]+)\/execution-profile$/u;
const ACTOR_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;

const ok = (data: unknown): ExecutionProfileRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ExecutionProfileRouteResult =>
  ({ status, body: { error: { kind, message } } });

export function isExecutionProfileRoute(path: string): boolean {
  return PATH_RE.test(path);
}

export async function handleExecutionProfileRoute(
  request: ExecutionProfileRouteRequest,
  store: WonderlandExecutionProfileStore | null,
): Promise<ExecutionProfileRouteResult | null> {
  const match = PATH_RE.exec(request.path);
  if (match === null) return null;
  let projectId: string;
  try {
    projectId = decodeURIComponent(match[1]);
  } catch {
    return err(404, 'project_not_found', 'The project id in the path is not a valid percent-encoding.');
  }
  if (request.method !== 'GET' && request.method !== 'PUT') {
    return err(405, 'method_not_allowed', 'An execution profile is read with GET and written with PUT.');
  }
  // READ AND WRITE ALIKE: a profile names the executor's workspace and the command it runs.
  if (!request.operator) {
    return err(401, 'operator_required', 'A project execution profile is read and written with operator authentication only.');
  }
  if (store === null) {
    return err(503, 'execution_profile_store_unavailable',
      'No durable store is reachable from this process, so no profile can be read or written.');
  }

  if (request.method === 'GET') {
    let record: WonderlandExecutionProfileRecord | null;
    try {
      record = await store.current(projectId);
    } catch {
      return err(503, 'execution_profile_store_unavailable', 'The profile store could not be read.');
    }
    if (record === null) return err(404, 'execution_profile_not_found', 'This project has no execution profile.');
    return ok({ projectId, version: record.version, writtenBy: record.writtenBy, writtenAt: record.writtenAt, profile: record.body });
  }

  const actor = request.actor?.trim();
  if (actor === undefined || !ACTOR_RE.test(actor)) {
    return err(400, 'actor_required',
      'Send x-relay-actor naming who is writing: setting where and how paid work runs is recorded against a name.');
  }
  if (request.body === undefined || request.body.trim() === '') {
    return err(400, 'profile_required', 'The request body must be the execution profile, as JSON.');
  }
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(request.body);
  } catch {
    return err(400, 'invalid_execution_profile', 'The execution profile is not valid JSON.');
  }
  const parsed = parseExecutionProfile(projectId, parsedBody);
  if (!parsed.ok) return err(400, 'invalid_execution_profile', parsed.problem);

  let appended: Awaited<ReturnType<WonderlandExecutionProfileStore['append']>>;
  try {
    appended = await store.append({ projectId, body: parsed.value, writtenBy: `operator:${actor}` });
  } catch {
    return err(503, 'execution_profile_store_unavailable', 'The profile store could not be written; nothing changed.');
  }
  if (!appended.ok) {
    return err(409, 'execution_profile_write_conflict',
      'Another write to this project\'s profile landed first. Read the current version and write again.');
  }
  return ok({ projectId, version: appended.version, enabled: parsed.value.enabled });
}

/* ------------------------------------------- the operator's contract export */

const CONTRACT_PATH_RE = /^\/julius\/missions\/([^/]+)\/contract$/u;

export function isPlayerMissionContractRoute(path: string): boolean {
  return CONTRACT_PATH_RE.test(path);
}

/**
 * GET /julius/missions/:missionId/contract -- OPERATOR ONLY.
 *
 * The exact contract a player-created mission was composed from, who created
 * it, from which profile version, and its run. This is what the operator's paid
 * run takes: `julius-live-mission run --contract <this, saved as a file>
 * --confirm-live`. Operator only, because the contract carries the executor's
 * workspace and command.
 */
export async function handlePlayerMissionContractRoute(
  request: { readonly method: string; readonly path: string; readonly operator: boolean },
  store: PlayerMissionContractStore | null,
): Promise<ExecutionProfileRouteResult | null> {
  const match = CONTRACT_PATH_RE.exec(request.path);
  if (match === null) return null;
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'A mission contract is read with GET.');
  if (!request.operator) return err(401, 'operator_required', 'A player-created mission\'s contract is read with operator authentication only.');
  if (store === null) return err(503, 'mission_contract_store_unavailable', 'No durable store is reachable from this process.');
  let missionId: string;
  try {
    missionId = decodeURIComponent(match[1]);
  } catch {
    return err(404, 'mission_contract_not_found', 'The mission id in the path is not a valid percent-encoding.');
  }
  let record: PlayerMissionContractRecord | null;
  try {
    record = await store.get(missionId);
  } catch {
    return err(503, 'mission_contract_store_unavailable', 'The mission contract store could not be read.');
  }
  if (record === null) return err(404, 'mission_contract_not_found', 'No player-created mission has that id.');
  return ok(record);
}

/**
 * THE POSTGRES STORE, over migration 027. `append` creates the project row the
 * way the mission seed does, then inserts max(version)+1 in one transaction; a
 * concurrent append computes the same number and loses on the primary key.
 */
export class WonderlandExecutionProfilePostgres implements WonderlandExecutionProfileStore, PlayerMissionContractStore {
  constructor(private readonly pool: Pool) {}

  async record(input: { missionId: string; projectId: string; playerId: string; profileVersion: number; contract: unknown }): Promise<void> {
    await this.pool.query(
      `INSERT INTO relay_wonderland.player_mission_contracts(mission_id, project_id, player_id, profile_version, contract)
       VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (mission_id) DO NOTHING`,
      [input.missionId, input.projectId, input.playerId, input.profileVersion, JSON.stringify(input.contract)],
    );
  }

  async attachRun(missionId: string, runId: string): Promise<void> {
    await this.pool.query(
      'UPDATE relay_wonderland.player_mission_contracts SET run_id=$2 WHERE mission_id=$1 AND run_id IS NULL',
      [missionId, runId],
    );
  }

  async get(missionId: string): Promise<PlayerMissionContractRecord | null> {
    const result = await this.pool.query<{
      mission_id: string; project_id: string; player_id: string; profile_version: number; contract: unknown;
      run_id: string | null; created_at: Date;
    }>(
      `SELECT mission_id, project_id, player_id, profile_version, contract, run_id, created_at
         FROM relay_wonderland.player_mission_contracts WHERE mission_id=$1`,
      [missionId],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      missionId: row.mission_id, projectId: row.project_id, playerId: row.player_id,
      profileVersion: Number(row.profile_version), contract: row.contract, runId: row.run_id,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async current(projectId: string): Promise<WonderlandExecutionProfileRecord | null> {
    const result = await this.pool.query<{ version: number; profile: unknown; written_by: string; written_at: Date }>(
      `SELECT version, profile, written_by, written_at FROM relay_wonderland.project_execution_profiles
        WHERE project_id=$1 ORDER BY version DESC LIMIT 1`,
      [projectId],
    );
    const row = result.rows[0];
    return row === undefined ? null : {
      version: Number(row.version), body: row.profile, writtenBy: row.written_by,
      writtenAt: new Date(row.written_at).toISOString(),
    };
  }

  async append(input: { projectId: string; body: unknown; writtenBy: string }):
    Promise<{ ok: true; version: number } | { ok: false; reason: 'conflict' }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [input.projectId]);
      const inserted = await client.query<{ version: number }>(
        `INSERT INTO relay_wonderland.project_execution_profiles(project_id, version, profile, written_by)
         SELECT $1, COALESCE(MAX(version), 0) + 1, $2::jsonb, $3
           FROM relay_wonderland.project_execution_profiles WHERE project_id=$1
         RETURNING version`,
        [input.projectId, JSON.stringify(input.body), input.writtenBy],
      );
      await client.query('COMMIT');
      return { ok: true, version: Number(inserted.rows[0].version) };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if ((error as { code?: string }).code === '23505') return { ok: false, reason: 'conflict' };
      throw error;
    } finally {
      client.release();
    }
  }
}
