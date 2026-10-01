import type { Pool, PoolClient } from 'pg';

import {
  juliusTaskContractBindingDigest,
  type JuliusTaskContract,
  type JuliusTaskContractLockResult,
  type JuliusTaskContractStore,
} from '../mission/julius';
import { juliusSerializable } from './julius-serializable';

/**
 * POSTGRESQL AUTHORITY FOR THE TASK/SPRINT CONTRACT.
 *
 * The domain (`julius-task-contract.ts`) decides what a contract means. This
 * holds the two invariants only a database can hold, and it holds them WITH THE
 * DATABASE rather than by reading first and writing after:
 *
 *   ONE LOCKED REVISION — `julius_task_contract_single_lock`, a partial unique
 *   index. Two ticks that both read "nothing locked yet" and both write cannot
 *   both land; the loser gets a unique violation, which is translated into the
 *   ordinary value `another_revision_is_locked` because losing that race is a
 *   normal outcome in a runtime with more than one worker.
 *
 *   A REVISION IS IMMUTABLE — every write is an INSERT. `putContract` is
 *   `ON CONFLICT DO NOTHING` and then compares what is already there, so a
 *   replay is a no-op and a DIFFERENT proposal at a stored revision is refused
 *   rather than overwriting terms another party may already hold.
 *
 * THE DIGEST IS RE-DERIVED ON READ. The terms are stored as a document; jsonb
 * does not promise to hand back the same key order, and nothing stops an edit
 * made outside this code. So the recorded `binding_digest` is checked against
 * the digest of the terms actually read, and a row that disagrees is refused —
 * a caller must never be handed a binding that does not describe the terms
 * beside it, because every downstream equality check would then pass while
 * comparing the wrong thing.
 */
export class JuliusContractPostgresRepository implements JuliusTaskContractStore {
  constructor(private readonly pool: Pool) {}

  async putTaskContract(input: { projectId: string; contract: JuliusTaskContract; occurredAt: string }): Promise<boolean> {
    const contract = input.contract;
    const inserted = await this.pool.query(
      `INSERT INTO relay_wonderland.julius_task_contracts(
         contract_id,contract_revision,run_id,project_id,task_id,mission_contract_revision,
         state,safe_terms,binding_digest,locked_at,locked_by_evaluator_id,created_at)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12
        WHERE EXISTS(SELECT 1 FROM relay_wonderland.julius_runs r WHERE r.run_id=$3 AND r.project_id=$4)
       ON CONFLICT(contract_id,contract_revision) DO NOTHING`,
      [
        contract.contractId, contract.contractRevision, contract.runId, input.projectId, contract.taskId,
        contract.missionContractRevision, contract.state, JSON.stringify(terms(contract)),
        contract.bindingDigest, contract.lockedAt, contract.lockedByEvaluatorId, input.occurredAt,
      ],
    ).catch((error: unknown) => {
      /**
       * A CONCURRENT PROPOSAL FOR THE SAME REVISION lands on the SECOND unique
       * index — `julius_task_contract_one_per_task` — before the ON CONFLICT
       * arbiter on the primary key ever sees the winner's row, and PostgreSQL
       * reports that as 23505 rather than as "did nothing". Sequentially the
       * arbiter always wins and this branch is unreachable, which is how a
       * real race on a real database was the first thing to reach it: the
       * losing architect's proposal died with a raw constraint name instead
       * of the one answer this method exists to give. Either way the fact is
       * the same — the row exists now — so it is looked at, below.
       */
      if ((error as { code?: unknown }).code === '23505') return { rowCount: 0 };
      throw error;
    });
    if (inserted.rowCount === 1) return true;

    // NOT INSERTED. Either the row is already there — a replay — or the run is
    // not this project's, or ANOTHER contract holds this task's revision. The
    // three are distinguished by looking, because reporting "already stored"
    // for a contract that was never stored would let a caller proceed as if
    // it had been, and a second contract for one task is a caller's defect
    // that must be named, not a replay.
    const existing = await this.readRow(contract.contractId, contract.contractRevision, input.projectId);
    if (existing === null) {
      const other = await this.pool.query<{ contract_id: string }>(
        `SELECT contract_id FROM relay_wonderland.julius_task_contracts
          WHERE task_id=$1 AND contract_revision=$2 AND project_id=$3`,
        [contract.taskId, contract.contractRevision, input.projectId],
      );
      if (other.rows[0] !== undefined) throw new Error('julius_task_contract_one_per_task');
      return false;
    }
    // The LOCK FIELDS are excluded from the digest on purpose, so a stored
    // LOCKED row and the DRAFT a retry re-proposes compare equal. Only the
    // TERMS differing is a conflict.
    if (juliusTaskContractBindingDigest(existing) !== juliusTaskContractBindingDigest(contract)) {
      throw new Error('julius_task_contract_revision_conflict');
    }
    return false;
  }

  async challengeTaskContract(input: {
    projectId: string; contractId: string; contractRevision: number;
  }): Promise<boolean> {
    // `state='DRAFT'` in the predicate is the whole guard: a locked, superseded
    // or already-challenged revision matches nothing and the answer is false.
    const result = await this.pool.query(
      `UPDATE relay_wonderland.julius_task_contracts
          SET state='CHALLENGED'
        WHERE contract_id=$1 AND contract_revision=$2 AND project_id=$3 AND state='DRAFT'`,
      [input.contractId, input.contractRevision, input.projectId],
    );
    return result.rowCount === 1;
  }

  async lockTaskContract(input: {
    projectId: string; contractId: string; contractRevision: number;
    bindingDigest: string; lockedAt: string; evaluatorId: string;
  }): Promise<JuliusTaskContractLockResult> {
    /**
     * A SERIALIZATION FAILURE IS RETRIED HERE, NOT ANSWERED.
     *
     * It used to be answered — once, as `lock_contended` — and nothing above
     * this method retries a lock: the accepting decision was recorded anyway,
     * its build was released onto a contract still in DRAFT, and the dispatch
     * gate then failed that build closed with `contract_not_locked`. Real-infra
     * run 36855148392 attempt 1 (PR #305, 2026-10-01) lost one mission of six
     * that way, with two run loops on one database: SSI reports read/write
     * dependencies between transactions on DIFFERENT missions' contracts when
     * their rows share a page, so the conflict needs no second lock of the same
     * contract at all. A 40001 or 40P01 rolled everything back, so the body is
     * simply run again against what is there now — which is either the lock
     * this call was asked for, or a standing refusal it can now see.
     */
    try {
      return await juliusSerializable(this.pool, (client) => this.lockWithin(client, input));
    } catch (error) {
      /**
       * LOSING THE RACE IS AN OUTCOME, NOT A FAULT — and PostgreSQL reports it
       * two different ways, both of which mean the same thing here:
       *
       *   23505  the partial unique index refused a second LOCKED row;
       *   40001  two SERIALIZABLE transactions conflicted and one was aborted,
       *          on every one of the bounded attempts above (40P01 likewise).
       *
       * The answer is then re-read rather than asserted. Announcing "another
       * revision is locked" without looking would be a claim about a race whose
       * outcome this transaction never saw — and if the other transaction
       * failed for its own reasons, nothing is locked and the honest answer is
       * `lock_contended`: transient, retryable, and NOT a reason to release
       * work onto an unlocked contract (the pipeline holds its decision on it).
       */
      const code = (error as { code?: unknown }).code;
      if (code === '23505' || code === '40001' || code === '40P01') {
        const held = await this.pool
          .query<{ contract_revision: number }>(
            `SELECT contract_revision FROM relay_wonderland.julius_task_contracts WHERE contract_id=$1 AND state='LOCKED'`,
            [input.contractId],
          )
          .catch(() => null);
        if (held === null) return { locked: false, reasonCode: 'lock_contended', lockedRevision: null };
        const lockedRevision = held.rows[0] === undefined ? null : Number(held.rows[0].contract_revision);
        return refusalFor(lockedRevision, input.contractRevision)
          ?? { locked: false, reasonCode: 'lock_contended', lockedRevision };
      }
      throw error;
    }
  }

  /**
   * One attempt at the lock, inside the caller's SERIALIZABLE transaction. A
   * refusal returns without writing anything, so committing it changes nothing.
   */
  private async lockWithin(client: PoolClient, input: {
    projectId: string; contractId: string; contractRevision: number;
    bindingDigest: string; lockedAt: string; evaluatorId: string;
  }): Promise<JuliusTaskContractLockResult> {
    // FOR UPDATE on the candidate, so two ticks serialise here rather than at
    // the unique index. The index is still the authority — this only makes
    // the common case a wait instead of a retry.
    const candidate = await client.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_task_contracts
        WHERE contract_id=$1 AND contract_revision=$2 AND project_id=$3 FOR UPDATE`,
      [input.contractId, input.contractRevision, input.projectId],
    );
    if (candidate.rows[0] === undefined) {
      return { locked: false, reasonCode: 'contract_revision_not_found', lockedRevision: null };
    }
    const contract = mapRow(candidate.rows[0]);

    const held = await client.query<{ contract_revision: number }>(
      `SELECT contract_revision FROM relay_wonderland.julius_task_contracts
        WHERE contract_id=$1 AND state='LOCKED' FOR UPDATE`,
      [input.contractId],
    );
    const lockedRevision = held.rows[0] === undefined ? null : Number(held.rows[0].contract_revision);
    const standing = refusalFor(lockedRevision, input.contractRevision);
    if (standing !== null) return standing;
    if (contract.state === 'SUPERSEDED') {
      return { locked: false, reasonCode: 'contract_superseded', lockedRevision: null };
    }
    // The caller computed the digest from the terms it accepted; this proves
    // those are the terms actually stored. Without it a caller could lock one
    // document to another document's digest and every later comparison would
    // agree about the wrong thing.
    if (juliusTaskContractBindingDigest(contract) !== input.bindingDigest) {
      return { locked: false, reasonCode: 'binding_digest_mismatch', lockedRevision: null };
    }

    const superseded = await client.query<{ contract_revision: number }>(
      `UPDATE relay_wonderland.julius_task_contracts SET state='SUPERSEDED'
        WHERE contract_id=$1 AND state='LOCKED' AND contract_revision<$2
        RETURNING contract_revision`,
      [input.contractId, input.contractRevision],
    );
    const locked = await client.query<Record<string, unknown>>(
      `UPDATE relay_wonderland.julius_task_contracts
          SET state='LOCKED',binding_digest=$4,locked_at=$5,locked_by_evaluator_id=$6
        WHERE contract_id=$1 AND contract_revision=$2 AND project_id=$3
        RETURNING *`,
      [input.contractId, input.contractRevision, input.projectId, input.bindingDigest, input.lockedAt, input.evaluatorId],
    );
    return {
      locked: true,
      contract: mapRow(locked.rows[0]!),
      supersededRevision: superseded.rows[0] === undefined ? null : Number(superseded.rows[0].contract_revision),
    };
  }

  async loadTaskContract(input: { projectId: string; taskId: string }): Promise<JuliusTaskContract | null> {
    // The LOCKED revision when there is one, else the highest revision. Ordered
    // by the state first so the sort does the choosing and a second query
    // cannot see a different moment than the first.
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_task_contracts
        WHERE task_id=$1 AND project_id=$2
        ORDER BY (state='LOCKED') DESC, contract_revision DESC
        LIMIT 1`,
      [input.taskId, input.projectId],
    );
    if (result.rows[0] === undefined) return null;
    const contract = mapRow(result.rows[0]);
    if (contract.state !== 'LOCKED') return contract;
    // CORRUPTION IS NOT CURRENCY. A locked row whose terms no longer hash to
    // its recorded binding is refused rather than returned; the dispatch gate
    // then reports `contract_absent`, which blocks, instead of permitting work
    // under a binding that describes something else.
    return juliusTaskContractBindingDigest(contract) === contract.bindingDigest ? contract : null;
  }

  async taskContractRevisions(input: { projectId: string; taskId: string }): Promise<readonly JuliusTaskContract[]> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_task_contracts
        WHERE task_id=$1 AND project_id=$2 ORDER BY contract_revision ASC`,
      [input.taskId, input.projectId],
    );
    return result.rows.map(mapRow);
  }

  private async readRow(contractId: string, revision: number, projectId: string): Promise<JuliusTaskContract | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM relay_wonderland.julius_task_contracts
        WHERE contract_id=$1 AND contract_revision=$2 AND project_id=$3`,
      [contractId, revision, projectId],
    );
    return result.rows[0] === undefined ? null : mapRow(result.rows[0]);
  }
}

/**
 * A LOCK MOVES FORWARD OR NOT AT ALL.
 *
 * Locking revision N while N-1 is locked is the ORDINARY path — that is what
 * superseding is — so an "anything already locked" refusal would make a revised
 * contract permanently unlockable. What is refused is a lock that does not move
 * forward: the same revision twice, and an OLDER revision than the one held,
 * which would roll the agreement backwards under parties already holding the
 * newer one. `null` means nothing stands in the way.
 *
 * One function, used by the pre-check and by the race handler, because the two
 * answering differently is exactly how a retry ends up reported as a success.
 */
function refusalFor(lockedRevision: number | null, requested: number):
  | { readonly locked: false; readonly reasonCode: string; readonly lockedRevision: number | null }
  | null {
  if (lockedRevision === null || lockedRevision < requested) return null;
  return lockedRevision === requested
    ? { locked: false, reasonCode: 'contract_revision_already_locked', lockedRevision }
    : { locked: false, reasonCode: 'newer_revision_is_locked', lockedRevision };
}

/**
 * THE COLUMNS AND THE DOCUMENT DO NOT OVERLAP.
 *
 * Six fields are columns because the database constrains or indexes them —
 * identity, the run and task foreign keys, the mission revision, the state and
 * the lock. Everything else is the document, and is stored once. Storing a
 * field in both places would create two answers to the same question, which is
 * the condition this whole file exists to remove.
 */
type ContractTerms = Omit<
  JuliusTaskContract,
  'contractId' | 'contractRevision' | 'runId' | 'taskId' | 'missionContractRevision'
  | 'state' | 'bindingDigest' | 'lockedAt' | 'lockedByEvaluatorId'
>;

function terms(contract: JuliusTaskContract): ContractTerms {
  const {
    contractId: _id, contractRevision: _revision, runId: _run, taskId: _task,
    missionContractRevision: _mission, state: _state, bindingDigest: _digest,
    lockedAt: _lockedAt, lockedByEvaluatorId: _evaluator, ...rest
  } = contract;
  return rest;
}

function mapRow(row: Record<string, unknown>): JuliusTaskContract {
  const stored = (typeof row.safe_terms === 'string' ? JSON.parse(row.safe_terms) : row.safe_terms) as ContractTerms;
  const lockedAt = row.locked_at;
  return {
    ...stored,
    contractId: String(row.contract_id),
    contractRevision: Number(row.contract_revision),
    runId: String(row.run_id),
    taskId: String(row.task_id),
    missionContractRevision: Number(row.mission_contract_revision),
    state: String(row.state) as JuliusTaskContract['state'],
    bindingDigest: row.binding_digest === null || row.binding_digest === undefined ? null : String(row.binding_digest),
    // `timestamptz` comes back as a Date. The domain speaks ISO strings and
    // nothing under `mission/` reads a clock, so the conversion belongs here.
    lockedAt: lockedAt === null || lockedAt === undefined
      ? null
      : lockedAt instanceof Date ? lockedAt.toISOString() : String(lockedAt),
    lockedByEvaluatorId: row.locked_by_evaluator_id === null || row.locked_by_evaluator_id === undefined
      ? null
      : String(row.locked_by_evaluator_id),
  };
}
