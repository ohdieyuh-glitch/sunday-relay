import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import {
  PROJECT_BRAIN_EVENT_SCHEMA_V1,
  PROJECT_BRAIN_MUTATION_SCHEMA_V1,
  projectBrainCanonicalJson,
  projectBrainCapabilitiesFor,
  projectBrainRefusal,
  projectBrainStreamId,
  type ProjectBrainActor,
  type ProjectBrainCapability,
  type ProjectBrainDeliverer,
  type ProjectBrainProvenance,
  type ProjectBrainRefusal,
} from '../mission/project-brain/project-brain';
import {
  authorizeProjectBrainMemberChange,
  parseProjectBrainMemberChange,
  projectBrainMemberEventType,
  type ProjectBrainMemberCommand,
  type ProjectBrainMemberOperation,
} from '../mission/project-brain/project-brain-members';
import { ProjectBrainCorruptionError, ProjectBrainSchemaNewerError, checkout, projectBrainSchema } from './project-brain-pg-shared';

/**
 * WHO MAY USE A PROJECT'S BRAIN, WRITTEN (project-brain-members.ts decides; this applies).
 *
 * `relay_wonderland.project_members` (migration 001) stays the one membership record every door already reads; a change
 * to it goes through the Project Brain's mutation log -- the project's advisory lock, one idempotency namespace, a
 * request hash, an event on the project's stream -- and leaves an append-only version in
 * `project_brain_member_versions` (migration 034) naming the mutation, who made it and the role before. So a
 * multiplayer project can always answer who let whom in, as what, and when.
 *
 * THE CALLER'S RIGHTS ARE READ AGAIN UNDER THE LOCK. The door computed capabilities from the caller's role before the
 * transaction; an admin removed a moment earlier must not still add members. So the store re-reads the caller's role
 * inside the transaction and acts on the intersection of the two.
 */

export interface ProjectBrainMember {
  readonly playerId: string;
  readonly role: string;
  /** The member's last change in this table's history; null for a row the history never saw (the seeded OWNER). */
  readonly version: number | null;
}

export interface ProjectBrainMemberResult {
  readonly schemaVersion: typeof PROJECT_BRAIN_MUTATION_SCHEMA_V1;
  readonly mutationId: string;
  readonly operation: ProjectBrainMemberOperation;
  readonly projectId: string;
  readonly playerId: string;
  /** The role now; null when removed. */
  readonly role: string | null;
  readonly previousRole: string | null;
  readonly version: number;
  readonly eventId: string;
  readonly eventType: string;
  readonly streamId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly author: ProjectBrainActor;
  readonly deliverer: ProjectBrainDeliverer;
}

export type ProjectBrainMemberOutcome =
  | { readonly ok: true; readonly durable: true; readonly replayed: boolean; readonly result: ProjectBrainMemberResult }
  | (ProjectBrainRefusal & { readonly durable: false | 'unknown' });

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const codeOf = (error: unknown): string | undefined =>
  error !== null && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined;

export class ProjectBrainMembersStore {
  private readonly now: () => Date;
  private readonly newId: () => string;

  constructor(private readonly pool: Pool, options: { readonly now?: () => Date; readonly newId?: () => string } = {}) {
    this.now = options.now ?? (() => new Date());
    this.newId = options.newId ?? randomUUID;
  }

  /** Every member of a project and their role, in one snapshot. Null when there is no such project. */
  async list(projectId: string): Promise<readonly ProjectBrainMember[] | null> {
    const { client, release } = await checkout(this.pool);
    let broken: Error | undefined;
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      if (!(await projectBrainSchema(client)).componentsInstalled) throw new Error('project_brain_components_not_installed');
      const exists = await client.query('SELECT 1 FROM relay_wonderland.projects WHERE project_id=$1', [projectId]);
      if (exists.rowCount === 0) { await client.query('ROLLBACK'); return null; }
      const rows = await client.query<{ player_id: string; role: string; version: string | null }>(
        `SELECT m.player_id, m.role, (SELECT max(v.version) FROM relay_wonderland.project_brain_member_versions v
            WHERE v.project_id=m.project_id AND v.player_id=m.player_id) AS version
           FROM relay_wonderland.project_members m WHERE m.project_id=$1 ORDER BY m.player_id`, [projectId]);
      await client.query('COMMIT');
      return rows.rows.map((row) => Object.freeze({ playerId: row.player_id, role: row.role, version: row.version === null ? null : Number(row.version) }));
    } catch (error) {
      broken = error instanceof Error ? error : new Error(String(error));
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      release(broken);
    }
  }

  async change(input: {
    readonly projectId: string;
    readonly provenance: ProjectBrainProvenance;
    readonly capabilities: readonly ProjectBrainCapability[];
    /** The member the caller acts as (a player, or the operator's tenant). */
    readonly actorId: string;
    readonly command: ProjectBrainMemberCommand;
  }): Promise<ProjectBrainMemberOutcome> {
    const { projectId, provenance, actorId } = input;
    const refuse = (refusal: ProjectBrainRefusal): ProjectBrainMemberOutcome => ({ ...refusal, durable: false });
    // The store validates what it stores, whoever calls it.
    const reparsed = parseProjectBrainMemberChange(input.command);
    if (!reparsed.ok) return refuse(reparsed);
    const command = reparsed.command;
    let client: PoolClient;
    let release: (error?: Error) => void;
    try {
      ({ client, release } = await checkout(this.pool));
    } catch {
      return refuse(projectBrainRefusal(503, 'project_brain_unavailable', 'The Project Brain database could not be reached. Nothing was saved.'));
    }
    let phase: 'open' | 'commit' | 'done' = 'open';
    let broken: Error | undefined;
    const abort = async (outcome: ProjectBrainMemberOutcome): Promise<ProjectBrainMemberOutcome> => {
      await client.query('ROLLBACK').catch(() => undefined);
      phase = 'done';
      return outcome;
    };
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`project_brain:${projectId}`]);
      const project = await client.query('SELECT 1 FROM relay_wonderland.projects WHERE project_id=$1', [projectId]);
      if (project.rowCount === 0) return abort(refuse(projectBrainRefusal(404, 'project_not_found', 'No such project.')));
      if (!(await projectBrainSchema(client)).componentsInstalled) {
        return abort(refuse(projectBrainRefusal(503, 'project_brain_components_not_installed',
          'This Project Brain store has no membership history (migration 034 is not applied). Nothing was saved.')));
      }

      const requestHash = sha256(projectBrainCanonicalJson({ projectId, provenance, actorId, command }));
      const prior = await client.query<{ request_hash: string; result: unknown }>(
        'SELECT request_hash,result FROM relay_wonderland.project_brain_mutations WHERE project_id=$1 AND idempotency_key=$2', [projectId, command.idempotencyKey]);
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].request_hash !== requestHash) {
          return abort(refuse(projectBrainRefusal(409, 'idempotency_conflict',
            'That idempotency key was already used for a different change. Nothing was saved; use a new key for a new change.')));
        }
        const stored = prior.rows[0].result;
        if (stored === null || typeof stored !== 'object' || Array.isArray(stored)) {
          throw new ProjectBrainCorruptionError('project_brain_mutations', command.idempotencyKey, 'result is not an object');
        }
        await client.query('ROLLBACK');
        phase = 'done';
        return { ok: true, durable: true, replayed: true, result: stored as ProjectBrainMemberResult };
      }

      // The caller's rights NOW, under the lock: the intersection of what the door saw and what the table says.
      const actor = await client.query<{ role: string }>('SELECT role FROM relay_wonderland.project_members WHERE project_id=$1 AND player_id=$2', [projectId, actorId]);
      const actorRole = actor.rows[0]?.role ?? null;
      const capabilities = projectBrainCapabilitiesFor(actorRole).filter((capability) => input.capabilities.includes(capability));
      const target = await client.query<{ role: string }>(
        'SELECT role FROM relay_wonderland.project_members WHERE project_id=$1 AND player_id=$2 FOR UPDATE', [projectId, command.playerId]);
      const currentRole = target.rows[0]?.role ?? null;
      const allowed = authorizeProjectBrainMemberChange({ provenance, capabilities, actorRole, actorId, command, currentRole });
      if (!allowed.ok) return abort(refuse(allowed));

      const occurredAt = this.now().toISOString();
      const mutationId = `pbm:${this.newId()}`;
      const eventId = `project-brain:${this.newId()}`;
      const streamId = projectBrainStreamId(projectId);
      const eventType = projectBrainMemberEventType(command.operation);
      const role = command.operation === 'MEMBER_SET' ? command.role : null;
      if (command.operation === 'MEMBER_SET') {
        await client.query('INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING', [command.playerId]);
        await client.query(`INSERT INTO relay_wonderland.project_members(project_id,player_id,role) VALUES($1,$2,$3)
          ON CONFLICT(project_id,player_id) DO UPDATE SET role=EXCLUDED.role`, [projectId, command.playerId, command.role]);
      } else {
        const removed = await client.query('DELETE FROM relay_wonderland.project_members WHERE project_id=$1 AND player_id=$2 AND role=$3', [projectId, command.playerId, currentRole]);
        if (removed.rowCount !== 1) throw new Error('member_row_moved_under_lock');
      }
      const last = await client.query<{ version: string | null }>(
        'SELECT max(version) AS version FROM relay_wonderland.project_brain_member_versions WHERE project_id=$1 AND player_id=$2', [projectId, command.playerId]);
      const version = Number(last.rows[0]?.version ?? 0) + 1;
      await client.query(`INSERT INTO relay_wonderland.project_brain_member_versions(project_id,player_id,version,role,previous_role,mutation_id,changed_by_kind,changed_by_id,changed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [projectId, command.playerId, version, role, currentRole, mutationId, provenance.author.kind, provenance.author.id, occurredAt]);

      const allocated = await client.query<{ sequence: string }>(
        `INSERT INTO relay_wonderland.stream_sequences(stream_id,next_sequence) VALUES($1,2)
         ON CONFLICT(stream_id) DO UPDATE SET next_sequence=relay_wonderland.stream_sequences.next_sequence+1 RETURNING next_sequence-1 AS sequence`, [streamId]);
      const sequence = Number(allocated.rows[0]?.sequence);
      const result: ProjectBrainMemberResult = {
        schemaVersion: PROJECT_BRAIN_MUTATION_SCHEMA_V1, mutationId, operation: command.operation, projectId, playerId: command.playerId,
        role, previousRole: currentRole, version, eventId, eventType, streamId, sequence, occurredAt, author: provenance.author, deliverer: provenance.deliverer,
      };
      await client.query(
        `INSERT INTO relay_wonderland.events(event_id,stream_id,project_id,sequence,event_type,visibility,payload,occurred_at) VALUES($1,$2,$3,$4,$5,'PROJECT',$6::jsonb,$7)`,
        [eventId, streamId, projectId, sequence, eventType, JSON.stringify({
          schemaVersion: PROJECT_BRAIN_EVENT_SCHEMA_V1, projectId, type: eventType, mutationId, runId: null,
          recordRef: `member:${command.playerId}`, version, status: role ?? 'REMOVED',
          author: provenance.author, deliverer: { kind: provenance.deliverer.kind }, occurredAt,
        }), occurredAt]);
      await client.query(
        `INSERT INTO relay_wonderland.project_brain_mutations(mutation_id,project_id,idempotency_key,request_hash,operation,record_id,resulting_version,run_id,
           author_kind,author_id,deliverer_kind,deliverer_id,event_id,result,occurred_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
        [mutationId, projectId, command.idempotencyKey, requestHash, command.operation, `member:${command.playerId}`, version,
          provenance.author.kind, provenance.author.id, provenance.deliverer.kind, provenance.deliverer.id, eventId, JSON.stringify(result), occurredAt]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');

      phase = 'commit';
      await client.query('COMMIT');
      phase = 'done';
      return { ok: true, durable: true, replayed: false, result };
    } catch (error) {
      broken = error instanceof Error ? error : new Error(String(error));
      if (phase === 'commit') {
        return {
          ...projectBrainRefusal(503, 'project_brain_commit_unknown',
            'The database did not confirm the change. It may or may not be saved; retrying with the same idempotency key is safe.'),
          durable: 'unknown',
        };
      }
      await client.query('ROLLBACK').catch(() => undefined);
      if (error instanceof ProjectBrainCorruptionError) return refuse(projectBrainRefusal(500, 'project_brain_corrupt', `${error.message}. Nothing was saved.`));
      if (error instanceof ProjectBrainSchemaNewerError) {
        return refuse(projectBrainRefusal(503, 'project_brain_schema_newer', `${error.message}. This build cannot write it; nothing was saved.`));
      }
      if (codeOf(error) === '23505') {
        return refuse(projectBrainRefusal(409, 'idempotency_conflict', 'A concurrent change used the same key. Nothing was saved; read again and retry.'));
      }
      return refuse(projectBrainRefusal(503, 'project_brain_persistence_failed', 'The Project Brain could not save this change. Nothing was saved.'));
    } finally {
      release(broken);
    }
  }
}
