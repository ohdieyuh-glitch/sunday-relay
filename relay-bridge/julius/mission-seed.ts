/**
 * DURABLE MISSION PREREQUISITES the Julius runtime reads and nothing yet
 * writes: the referenced project/tenant/mission-contract/execution rows the
 * `julius_runs` foreign keys demand, the acceptance criteria the verification
 * phase evaluates, and the Project Brain entries the context compiler reads.
 *
 * Every statement is idempotent (`ON CONFLICT DO NOTHING`), exactly the
 * pattern the proven real-infrastructure harnesses use
 * (`scripts/julius-sibling-support.ts`), so a retried bootstrap re-creates
 * nothing and conflicts with nothing it already wrote.
 */

import type { Pool } from 'pg';

export interface MissionBaseSeed {
  readonly tenantId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly executionId: string;
  readonly cardRevision: string;
  /** The real Mission Contract value, stored as the contract snapshot. */
  readonly missionSnapshot: unknown;
  readonly canonicalHash: string;
}

export interface SeedCriterion {
  readonly criterionId: string;
  readonly description: string;
  readonly requiredEvidenceTypes: readonly string[];
}

export interface SeedBrainEntry {
  readonly entryId: string;
  readonly kind: 'CONSTRAINT' | 'ACCEPTANCE_UPDATE' | 'HANDOFF';
  readonly text: string;
  readonly revision: number;
}

export interface MissionSeedStore {
  ensureBase(seed: MissionBaseSeed): Promise<void>;
  insertCriteria(runId: string, criteria: readonly SeedCriterion[]): Promise<void>;
  insertBrainEntries(runId: string, projectId: string, entries: readonly SeedBrainEntry[]): Promise<void>;
}

export function createPostgresMissionSeedStore(pool: Pool): MissionSeedStore {
  return {
    async ensureBase(seed) {
      await pool.query(`INSERT INTO relay_wonderland.players(player_id) VALUES($1) ON CONFLICT DO NOTHING`, [seed.tenantId]);
      await pool.query(`INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING`, [seed.projectId]);
      await pool.query(`INSERT INTO relay_wonderland.project_members(project_id,player_id,role) VALUES($1,$2,'OWNER') ON CONFLICT DO NOTHING`, [seed.projectId, seed.tenantId]);
      await pool.query(`INSERT INTO relay_wonderland.agents(agent_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [`agent:${seed.tenantId}`, seed.tenantId]);
      await pool.query(
        `INSERT INTO relay_wonderland.card_versions(card_version_id,agent_id,owner_id,version,snapshot) VALUES($1,$2,$3,1,'{}') ON CONFLICT DO NOTHING`,
        [seed.cardRevision, `agent:${seed.tenantId}`, seed.tenantId],
      );
      await pool.query(
        `INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$3,$4::jsonb) ON CONFLICT DO NOTHING`,
        [seed.missionId, seed.projectId, seed.canonicalHash, JSON.stringify(seed.missionSnapshot)],
      );
      await pool.query(
        `INSERT INTO relay_wonderland.execution_sessions(execution_id,mission_id,project_id,player_id,agent_id,card_version_id,state,workspace_isolation_ref,snapshot,checkpoint)
         VALUES($1,$2,$3,$4,$5,$6,'RUNNING','julius-live-mission','{}','{}') ON CONFLICT DO NOTHING`,
        [seed.executionId, seed.missionId, seed.projectId, seed.tenantId, `agent:${seed.tenantId}`, seed.cardRevision],
      );
    },
    async insertCriteria(runId, criteria) {
      for (const [ordinal, criterion] of criteria.entries()) {
        await pool.query(
          /**
           * `ON CONFLICT (run_id,criterion_id)`, NEVER A BARE `ON CONFLICT`.
           *
           * A bare conflict target means "any constraint", and while
           * `criterion_id` was the primary key ON ITS OWN that included the id
           * alone — so the SECOND run ever to use `criterion-test` or
           * `created-in-world` got NO row, silently, across every project and
           * every tenant. Every explicit rerun lost all of its criteria, because
           * a rerun reuses the ids by definition, and the run then reported
           * "0 of 0 criteria met" with nothing anywhere saying why.
           *
           * Migration 028 re-keys the table on `(run_id, criterion_id)`. Naming
           * the target HERE is what keeps this insert idempotent for the same run,
           * which is what it was for, while never again swallowing a different
           * run's criterion.
           */
          `INSERT INTO relay_wonderland.julius_acceptance_criteria(criterion_id,run_id,description,required_evidence_types,ordinal)
           VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT (run_id,criterion_id) DO NOTHING`,
          [criterion.criterionId, runId, criterion.description, JSON.stringify(criterion.requiredEvidenceTypes), ordinal],
        );
      }
    },
    async insertBrainEntries(runId, projectId, entries) {
      for (const entry of entries) {
        await pool.query(
          `INSERT INTO relay_wonderland.julius_brain_entries(entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
           VALUES($1,$2,$3,NULL,'relay-bootstrap',$4,$5,'[]',$6,now()) ON CONFLICT DO NOTHING`,
          [entry.entryId, runId, projectId, entry.kind, entry.text, entry.revision],
        );
      }
    },
  };
}
