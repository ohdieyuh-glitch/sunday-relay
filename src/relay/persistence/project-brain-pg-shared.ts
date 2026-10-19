import type { Pool, PoolClient } from 'pg';

import { parseProjectBrainRef } from '../mission/project-brain/project-brain';
import { WONDERLAND_MIGRATIONS, migrationVersion } from './wonderland-postgres';

/*
 * What the Project Brain's two stores share: how a connection is held, and how a reference is resolved inside a
 * project. One copy, so the record store (project-brain-postgres.ts) and the component store
 * (project-brain-components-postgres.ts) can never disagree on either, and neither imports the other.
 */

/**
 * A CHECKED-OUT CLIENT MUST NOT CRASH THE PROCESS WHEN ITS CONNECTION DIES.
 *
 * node-postgres emits `error` on a client whose backend is terminated; a pool only
 * listens while the client is idle. Unheard, that event is an uncaught exception
 * -- one database restart mid-write would take the whole bridge down instead of
 * answering `durable: false`. The failed query already rejects; this only keeps
 * the event from being fatal while the client is held.
 */
export async function checkout(pool: Pool): Promise<{ client: PoolClient; release: (error?: Error) => void }> {
  const client = await pool.connect();
  const swallow = () => undefined;
  client.on('error', swallow);
  return {
    client,
    release: (error?: Error) => {
      client.off('error', swallow);
      client.release(error);
    },
  };
}

/**
 * DOES THIS REFERENCE NAME SOMETHING IN THIS PROJECT? Checked inside the caller's transaction; a guessed id from another
 * project reads exactly like one that does not exist. Shared by the record store and the component store.
 */
export async function resolveProjectBrainRef(client: PoolClient, projectId: string, ref: string): Promise<boolean> {
  const parsed = parseProjectBrainRef(ref);
  if (parsed === null) return false;
  const { type, id } = parsed;
  const one = async (sql: string, values: readonly unknown[]) => ((await client.query(sql, [...values])).rowCount ?? 0) > 0;
  const viaRun = (table: string, column: string) => one(
    `SELECT 1 FROM relay_wonderland.${table} x JOIN relay_wonderland.julius_runs r ON r.run_id=x.run_id WHERE x.${column}=$1 AND r.project_id=$2`, [id, projectId]);
  switch (type) {
    case 'pbr': return one('SELECT 1 FROM relay_wonderland.project_brain_records WHERE record_id=$1 AND project_id=$2', [ref, projectId]);
    // The C.A.R.D. and eval components (migration 034). The built-in default card exists in every project.
    case 'pbcard': return id === 'default' || one('SELECT 1 FROM relay_wonderland.project_brain_cards WHERE card_id=$1 AND project_id=$2', [ref, projectId]);
    case 'pbeval': return one('SELECT 1 FROM relay_wonderland.project_brain_evals WHERE eval_id=$1 AND project_id=$2', [ref, projectId]);
    case 'mission': return one('SELECT 1 FROM relay_wonderland.julius_runs WHERE run_id=$1 AND project_id=$2', [id, projectId]);
    case 'entry': return one('SELECT 1 FROM relay_wonderland.julius_brain_entries WHERE entry_id=$1 AND project_id=$2', [id, projectId]);
    case 'claim': return one('SELECT 1 FROM relay_wonderland.julius_claim_standings WHERE claim_id=$1 AND project_id=$2', [id, projectId]);
    case 'finding': return viaRun('julius_reviewer_findings', 'finding_id');
    case 'evidence': return viaRun('julius_evidence', 'evidence_id');
    case 'decision': return viaRun('julius_verification_decisions', 'decision_id');
    case 'repair': return viaRun('julius_repair_cycles', 'repair_id');
    case 'transition': return viaRun('julius_transitions', 'transition_id');
    case 'task': return viaRun('julius_tasks', 'task_id');
    case 'approval': return one('SELECT 1 FROM relay_wonderland.julius_approvals WHERE approval_id=$1 AND project_id=$2', [id, projectId]);
    case 'artifact': return one('SELECT 1 FROM relay_wonderland.julius_work_artifacts WHERE artifact_id=$1 AND project_id=$2', [id, projectId]);
    case 'trajectory': return one('SELECT 1 FROM relay_wonderland.julius_trajectory_events WHERE trajectory_event_id=$1 AND project_id=$2', [id, projectId]);
    case 'event': return one('SELECT 1 FROM relay_wonderland.events WHERE event_id=$1 AND project_id=$2', [id, projectId]);
    case 'criterion': {
      const slash = id.indexOf('/');
      if (slash <= 0) return false;
      return one(`SELECT 1 FROM relay_wonderland.julius_acceptance_criteria c JOIN relay_wonderland.julius_runs r ON r.run_id=c.run_id
        WHERE c.run_id=$1 AND c.criterion_id=$2 AND r.project_id=$3`, [id.slice(0, slash), id.slice(slash + 1), projectId]);
    }
    case 'contract': {
      const at = id.lastIndexOf('@');
      const revision = Number(id.slice(at + 1));
      if (at <= 0 || !Number.isSafeInteger(revision)) return false;
      return one('SELECT 1 FROM relay_wonderland.julius_task_contracts WHERE contract_id=$1 AND contract_revision=$2 AND project_id=$3', [id.slice(0, at), revision, projectId]);
    }
    default: return false;
  }
}

/**
 * JSON READ BACK FROM THE DATABASE MUST BE WHAT WAS WRITTEN. A content column that is not an object, or a card whose
 * stored hash no longer matches its content, is CORRUPT: the read fails closed and says which row, never a fallback.
 */
export class ProjectBrainCorruptionError extends Error {
  constructor(readonly table: string, readonly key: string, readonly why: string) {
    super(`project_brain_corrupt: ${table} ${key}: ${why}`);
    this.name = 'ProjectBrainCorruptionError';
  }
}

/** The migration that installs the C.A.R.D., Mission Handoff and eval components. */
export const PROJECT_BRAIN_COMPONENTS_VERSION = '034_project_brain_components';
/** Every ledger version this build carries, read from the migrations it packages. */
const BUILD_VERSIONS: ReadonlySet<string> = new Set(WONDERLAND_MIGRATIONS.map(migrationVersion).filter((version): version is string => version !== null));

export class ProjectBrainSchemaNewerError extends Error {
  constructor(readonly versions: readonly string[]) {
    super(`project_brain_schema_newer: the store holds migration(s) this build does not carry: ${versions.join(', ')}`);
    this.name = 'ProjectBrainSchemaNewerError';
  }
}

/**
 * THE STORE MUST NOT BE NEWER THAN THE CODE THAT READS IT. A ledger version this build does not carry was applied by a
 * newer build, which may have changed what a row means; this code would read it on a guess. So the Brain is then neither
 * read nor written, and says why by name. It never just keeps working on a schema it does not know. Also answers whether
 * the components (034) are installed, from the same ledger read.
 */
export async function projectBrainSchema(client: PoolClient | Pool): Promise<{ readonly componentsInstalled: boolean }> {
  // A build whose migrations were not found knows no versions at all: say THAT (as migrate() does), never "newer".
  if (WONDERLAND_MIGRATIONS.some((sql) => sql === '')) throw new Error('wonderland_migration_not_packaged');
  const ledger = await client.query<{ version: string }>('SELECT version FROM relay_wonderland.schema_migrations');
  const versions = ledger.rows.map((row) => String(row.version));
  const newer = versions.filter((version) => !BUILD_VERSIONS.has(version)).sort();
  if (newer.length > 0) throw new ProjectBrainSchemaNewerError(newer);
  return { componentsInstalled: versions.includes(PROJECT_BRAIN_COMPONENTS_VERSION) };
}
