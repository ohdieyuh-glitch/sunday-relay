import type { Pool, PoolClient } from 'pg';

import {
  juliusBrainGenesisHash,
  type JuliusBrainHead,
  type JuliusBrainIdentity,
  type JuliusBrainRecord,
} from '../mission/julius/julius-brain-contracts';
import {
  juliusBrainPlanDependencies,
  planJuliusBrainGroups,
  projectJuliusBrain,
  verifyJuliusBrainLedger,
  type JuliusBrainEntityState,
  type JuliusBrainIdempotencyHit,
} from '../mission/julius/julius-brain-projection';
import {
  JULIUS_BRAIN_READ_LIMIT,
  juliusBrainSingleGroup,
  juliusBrainUngroupResult,
  validateJuliusBrainIdentity,
  type JuliusBrainCommitInput,
  type JuliusBrainCommitResult,
  type JuliusBrainGroupCommitInput,
  type JuliusBrainGroupCommitResult,
  type JuliusBrainEntityFilter,
  type JuliusBrainRecordQuery,
  type JuliusBrainRestoreResult,
  type JuliusBrainStore,
} from '../mission/julius/julius-brain-store';

/**
 * THE DURABLE PROJECT BRAIN, in its dedicated database (`julius_brain`
 * schema; see `julius-brain-database.ts`).
 *
 * ONE LOCK, ONE TRANSACTION, ONE PLANNER. A commit takes the Brain row with
 * `FOR UPDATE`, which serialises every writer of that Brain in every process
 * against the same database; reads what the domain planner asks for; runs the
 * planner; and writes the records, their link edges, the changed entity rows
 * and the new head before COMMIT. A refusal rolls back and wrote nothing.
 *
 * READ COMMITTED IS ENOUGH, AND WHY. Every writer takes the same row lock
 * before reading anything it will decide on, and READ COMMITTED gives each
 * statement a fresh snapshot, so the reads after the lock see every commit that
 * released it. SERIALIZABLE would add 40001 retries without adding safety.
 *
 * THE HEAD IS COMPARE-AND-SET as well as locked: the final UPDATE names the
 * head the plan was computed from, and a mismatch aborts. Belt and braces for a
 * future caller that forgets the lock.
 *
 * EXACTLY-ONCE IS NOT CLAIMED. What is guaranteed: a replayed idempotency key
 * with identical content returns the original receipt and writes nothing, and
 * the same key with different content is refused.
 */

type Queryable = Pick<PoolClient, 'query'>;

const num = (value: unknown): number => Number(value);
const parsed = <T>(value: unknown): T => (typeof value === 'string' ? JSON.parse(value) as T : value as T);

/**
 * THE COMMIT, INSIDE A TRANSACTION SOMEONE ELSE OWNS. Takes the Brain row lock,
 * plans every group against the committed state, and persists the result. On a
 * refusal it has written nothing and the caller must roll back; on success the
 * caller commits — together with whatever else it changed in that transaction
 * (a Python execution's state, for one).
 */
export async function commitJuliusBrainGroupWithin(client: Queryable, input: JuliusBrainGroupCommitInput): Promise<JuliusBrainGroupCommitResult> {
  const brainRow = await client.query(
    'SELECT identity,head_sequence,head_chain_hash FROM julius_brain.brains WHERE brain_id=$1 AND project_id=$2 FOR UPDATE',
    [input.brainId, input.projectId],
  );
  if (brainRow.rows.length === 0) {
    return { outcome: 'REFUSED', index: 0, group: 0, reasonCode: 'brain_not_found', detail: `${input.brainId} is not a Brain of ${input.projectId}.` };
  }
  const brain = parsed<JuliusBrainIdentity>(brainRow.rows[0].identity);
  const head: JuliusBrainHead = { sequence: num(brainRow.rows[0].head_sequence), chainHash: String(brainRow.rows[0].head_chain_hash) };
  if (input.runGuard !== undefined) {
    // Under the Brain row lock, so no writer of this Brain can add to the run between this count and the commit.
    const counted = await client.query('SELECT count(*)::int AS n FROM julius_brain.records WHERE brain_id=$1 AND run_id=$2', [brain.brainId, input.runGuard.runId]);
    const count = num(counted.rows[0]?.n ?? 0);
    if (count !== input.runGuard.recordCount) {
      return { outcome: 'REFUSED', index: 0, group: 0, reasonCode: 'run_changed', detail: `${input.runGuard.runId} holds ${count} records, not the ${input.runGuard.recordCount} planned from.` };
    }
  }
  const drafts = input.groups.flatMap((group) => group.drafts);

  const entities = new Map<string, JuliusBrainEntityState | null>();
  for (let round = 0; round < 3; round += 1) {
    const needed = juliusBrainPlanDependencies(brain.brainId, drafts, entities);
    if (needed.length === 0) break;
    const found = await client.query('SELECT entity_id,state FROM julius_brain.entities WHERE brain_id=$1 AND entity_id=ANY($2::text[])', [brain.brainId, needed]);
    const byId = new Map(found.rows.map((row) => [String(row.entity_id), parsed<JuliusBrainEntityState>(row.state)]));
    for (const id of needed) entities.set(id, byId.get(id) ?? null);
  }
  const keys = [...new Set(drafts.map((draft) => draft.idempotencyKey).filter((key): key is string => typeof key === 'string'))];
  const hits = await client.query(
    'SELECT idempotency_key,record_id,fingerprint,entity_id,entity_version,sequence,kind FROM julius_brain.records WHERE brain_id=$1 AND idempotency_key=ANY($2::text[])',
    [brain.brainId, keys],
  );
  const idempotency = new Map<string, JuliusBrainIdempotencyHit | null>(keys.map((key) => [key, null]));
  for (const row of hits.rows) {
    idempotency.set(String(row.idempotency_key), {
      recordId: String(row.record_id), fingerprint: String(row.fingerprint), entityId: String(row.entity_id),
      entityVersion: num(row.entity_version), sequence: num(row.sequence), kind: row.kind,
    });
  }
  const grantUsage = new Map<string, number>();
  for (const group of input.groups) {
    if (group.grant === null || grantUsage.has(group.grant.grantId)) continue;
    const usage = await client.query('SELECT count(*) AS n FROM julius_brain.records WHERE brain_id=$1 AND grant_id=$2', [brain.brainId, group.grant.grantId]);
    grantUsage.set(group.grant.grantId, num(usage.rows[0]?.n ?? 0));
  }
  const plan = planJuliusBrainGroups({ brain, head, recordedAt: input.recordedAt, groups: input.groups, entities, idempotency, grantUsage });
  if (plan.outcome === 'REFUSED') return plan;
  if (plan.records.length > 0) {
    await persistJuliusBrainRows(client, input.projectId, plan.records, plan.entities);
    const moved = await client.query(
      'UPDATE julius_brain.brains SET head_sequence=$3,head_chain_hash=$4 WHERE brain_id=$1 AND project_id=$2 AND head_sequence=$5',
      [input.brainId, input.projectId, plan.head.sequence, plan.head.chainHash, head.sequence],
    );
    if (moved.rowCount !== 1) throw new Error('julius_brain_head_moved_under_lock');
  }
  return { outcome: 'COMMITTED', receipts: plan.receipts, head: plan.head };
}

async function persistJuliusBrainRows(client: Queryable, projectId: string, records: readonly JuliusBrainRecord[], entities: readonly JuliusBrainEntityState[]): Promise<void> {
  for (const record of records) {
    await client.query(
      `INSERT INTO julius_brain.records(brain_id,project_id,sequence,record_id,entity_id,entity_version,kind,op,idempotency_key,fingerprint,content_hash,chain_hash,principal_kind,principal_id,grant_id,mission_id,run_id,task_id,record,occurred_at,recorded_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20,$21)`,
      [record.brainId, projectId, record.sequence, record.recordId, record.entityId, record.entityVersion, record.kind, record.op, record.idempotencyKey,
        record.fingerprint, record.contentHash, record.chainHash, record.principal.kind, record.principal.id, record.principal.grantId,
        record.scope.missionId, record.scope.runId, record.scope.taskId, JSON.stringify(record), record.occurredAt, record.recordedAt],
    );
    for (const link of record.links) {
      await client.query(
        `INSERT INTO julius_brain.links(brain_id,project_id,sequence,source_entity_id,relation,target_entity_id,target_version)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [record.brainId, projectId, record.sequence, record.entityId, link.relation, link.target, link.targetVersion],
      );
    }
  }
  for (const state of entities) {
    await client.query(
      `INSERT INTO julius_brain.entities(brain_id,project_id,entity_id,kind,version,lifecycle,status,mission_id,task_id,created_sequence,updated_sequence,state)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT(brain_id,entity_id) DO UPDATE SET version=EXCLUDED.version,lifecycle=EXCLUDED.lifecycle,status=EXCLUDED.status,
         updated_sequence=EXCLUDED.updated_sequence,state=EXCLUDED.state`,
      [state.brainId, projectId, state.entityId, state.kind, state.version, state.lifecycle,
        typeof state.body.status === 'string' ? state.body.status : null, state.scope.missionId, state.scope.taskId,
        state.createdSequence, state.updatedSequence, JSON.stringify(state)],
    );
  }
}

export class JuliusBrainPostgresStore implements JuliusBrainStore {
  constructor(private readonly pool: Pool) {}

  async createBrain(identity: JuliusBrainIdentity): Promise<{ readonly created: boolean; readonly brain: JuliusBrainIdentity }> {
    const errors = validateJuliusBrainIdentity(identity);
    if (errors.length > 0) throw new Error(`julius_brain_identity_invalid:${errors.join('; ')}`);
    await this.pool.query('INSERT INTO julius_brain.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [identity.projectId]);
    const inserted = await this.pool.query(
      `INSERT INTO julius_brain.brains(brain_id,project_id,title,schema_version,created_by,created_at,identity,head_sequence,head_chain_hash)
       VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,0,$8) ON CONFLICT(brain_id) DO NOTHING`,
      [identity.brainId, identity.projectId, identity.title, identity.schemaVersion, JSON.stringify(identity.createdBy), identity.createdAt, JSON.stringify(identity), juliusBrainGenesisHash(identity.brainId)],
    );
    if (inserted.rowCount === 1) return { created: true, brain: identity };
    const existing = await this.pool.query('SELECT project_id,identity FROM julius_brain.brains WHERE brain_id=$1', [identity.brainId]);
    if (existing.rows[0]?.project_id !== identity.projectId) throw new Error('julius_brain_id_taken');
    return { created: false, brain: parsed<JuliusBrainIdentity>(existing.rows[0].identity) };
  }

  async loadBrain(brainId: string, projectId: string): Promise<JuliusBrainIdentity | null> {
    const result = await this.pool.query('SELECT identity FROM julius_brain.brains WHERE brain_id=$1 AND project_id=$2', [brainId, projectId]);
    return result.rows[0] ? parsed<JuliusBrainIdentity>(result.rows[0].identity) : null;
  }

  async listBrains(projectId: string): Promise<readonly JuliusBrainIdentity[]> {
    const result = await this.pool.query('SELECT identity FROM julius_brain.brains WHERE project_id=$1 ORDER BY brain_id', [projectId]);
    return result.rows.map((row) => parsed<JuliusBrainIdentity>(row.identity));
  }

  async head(brainId: string, projectId: string): Promise<JuliusBrainHead | null> {
    const result = await this.pool.query('SELECT head_sequence,head_chain_hash FROM julius_brain.brains WHERE brain_id=$1 AND project_id=$2', [brainId, projectId]);
    return result.rows[0] ? { sequence: num(result.rows[0].head_sequence), chainHash: String(result.rows[0].head_chain_hash) } : null;
  }

  async commit(input: JuliusBrainCommitInput): Promise<JuliusBrainCommitResult> {
    return juliusBrainUngroupResult(await this.commitGroup(juliusBrainSingleGroup(input)));
  }

  async commitGroup(input: JuliusBrainGroupCommitInput): Promise<JuliusBrainGroupCommitResult> {
    return this.transaction<JuliusBrainGroupCommitResult>(async (client) => {
      const result = await commitJuliusBrainGroupWithin(client, input);
      return { rollback: result.outcome === 'REFUSED', value: result };
    });
  }

  async records(brainId: string, projectId: string, query: JuliusBrainRecordQuery): Promise<{ readonly records: readonly JuliusBrainRecord[]; readonly hasMore: boolean }> {
    const limit = Math.max(1, Math.min(query.limit, JULIUS_BRAIN_READ_LIMIT));
    const values: unknown[] = [brainId, projectId, query.afterSequence];
    let where = 'brain_id=$1 AND project_id=$2 AND sequence>$3';
    if (query.entityId !== undefined) { values.push(query.entityId); where += ` AND entity_id=$${values.length}`; }
    if (query.kinds !== undefined) { values.push([...query.kinds]); where += ` AND kind=ANY($${values.length}::text[])`; }
    values.push(limit + 1);
    const result = await this.pool.query(`SELECT record FROM julius_brain.records WHERE ${where} ORDER BY sequence LIMIT $${values.length}`, values);
    const rows = result.rows.map((row) => parsed<JuliusBrainRecord>(row.record));
    return { records: rows.slice(0, limit), hasMore: rows.length > limit };
  }

  async entities(brainId: string, projectId: string, filter: JuliusBrainEntityFilter): Promise<readonly JuliusBrainEntityState[]> {
    const values: unknown[] = [brainId, projectId];
    let where = 'brain_id=$1 AND project_id=$2';
    const add = (clause: (index: number) => string, value: unknown) => { values.push(value); where += ` AND ${clause(values.length)}`; };
    if (filter.kinds !== undefined) add((i) => `kind=ANY($${i}::text[])`, [...filter.kinds]);
    if (filter.entityIds !== undefined) add((i) => `entity_id=ANY($${i}::text[])`, [...filter.entityIds]);
    if (filter.lifecycles !== undefined) add((i) => `lifecycle=ANY($${i}::text[])`, [...filter.lifecycles]);
    if (filter.missionId === null) where += ' AND mission_id IS NULL';
    else if (filter.missionId !== undefined) add((i) => `mission_id=$${i}`, filter.missionId);
    if (filter.taskId === null) where += ' AND task_id IS NULL';
    else if (filter.taskId !== undefined) add((i) => `task_id=$${i}`, filter.taskId);
    if (filter.statuses !== undefined) add((i) => `COALESCE(status,'')=ANY($${i}::text[])`, [...filter.statuses]);
    // COLLATE "C": entity ids sort by code point here exactly as they do in
    // JavaScript, or keyset paging would skip and repeat under a locale collation.
    if (filter.afterEntityId !== undefined) add((i) => `entity_id COLLATE "C">$${i}`, filter.afterEntityId);
    values.push(Math.max(1, Math.min(filter.limit ?? JULIUS_BRAIN_READ_LIMIT, JULIUS_BRAIN_READ_LIMIT)));
    const result = await this.pool.query(
      `SELECT state FROM julius_brain.entities WHERE ${where} ORDER BY entity_id COLLATE "C" LIMIT $${values.length}`, values,
    );
    return result.rows.map((row) => parsed<JuliusBrainEntityState>(row.state));
  }

  async restore(identity: JuliusBrainIdentity, records: readonly JuliusBrainRecord[]): Promise<JuliusBrainRestoreResult> {
    const errors = validateJuliusBrainIdentity(identity);
    if (errors.length > 0) return { outcome: 'REFUSED', reasonCode: 'identity_invalid', detail: errors.join('; ') };
    const verification = verifyJuliusBrainLedger(identity.brainId, records);
    if (!verification.ok) return { outcome: 'REFUSED', reasonCode: 'ledger_invalid', detail: verification.problems.slice(0, 8).join('; ') };
    const projection = projectJuliusBrain(identity.brainId, records);
    return this.transaction<JuliusBrainRestoreResult>(async (client) => {
      await client.query('INSERT INTO julius_brain.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [identity.projectId]);
      const inserted = await client.query(
        `INSERT INTO julius_brain.brains(brain_id,project_id,title,schema_version,created_by,created_at,identity,head_sequence,head_chain_hash)
         VALUES($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8,$9) ON CONFLICT(brain_id) DO NOTHING`,
        [identity.brainId, identity.projectId, identity.title, identity.schemaVersion, JSON.stringify(identity.createdBy), identity.createdAt, JSON.stringify(identity), projection.head.sequence, projection.head.chainHash],
      );
      if (inserted.rowCount !== 1) {
        return { rollback: true, value: { outcome: 'REFUSED' as const, reasonCode: 'brain_exists', detail: 'A restore never merges into an existing Brain.' } };
      }
      await persistJuliusBrainRows(client, identity.projectId, records, [...projection.entities.values()]);
      return { rollback: false, value: { outcome: 'RESTORED' as const, head: projection.head, entityCount: projection.entities.size } };
    });
  }

  private async transaction<T>(effect: (client: PoolClient) => Promise<{ rollback: boolean; value: T }>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rollback, value } = await effect(client);
      await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
