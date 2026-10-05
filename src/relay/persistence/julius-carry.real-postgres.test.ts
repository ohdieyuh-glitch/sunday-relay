import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { juliusArchitectureProposalEntryId } from '../mission/julius/julius-architecture-state';
import { juliusCarryEntryId, juliusCarryPairGate, selectJuliusCarry } from '../mission/julius/julius-carry';
import { juliusClaimIdFor } from '../mission/julius/julius-claim-ledger';
import { juliusFindingTransitionFacts, type JuliusFindingMove } from '../mission/julius/julius-finding-lifecycle';
import { JuliusCarryPostgresRepository, juliusCarryManifestEventId } from './julius-carry-postgres';
import { JuliusClaimPostgresRepository } from './julius-claim-postgres';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { JuliusTimelinePostgresRepository } from './julius-timeline-postgres';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * THE CORRECTED CARRY ON REAL POSTGRESQL — Decision C's four points, each read
 * back from the store rather than asserted from memory:
 *
 *   1. what WITHOUT wrote      — its findings and their finding.* ledger rows;
 *   2. what became eligible    — the selection, and the manifest event naming
 *                                what was refused and why;
 *   3. what WITH restored      — the carried brain rows and their standings;
 *   4. what the planner got    — covered where the packet is compiled
 *                                (`juliusCarryReceivedFacts` on `context.compiled`).
 *
 * Plus the defect class the first carry let through, present in the store and
 * proven to stay out: a reviewed task's HANDOFF promoted VERIFIED, and a "NOT IN
 * FORCE" architecture proposal promoted with it.
 *
 * Runs wherever JULIUS_TEST_DATABASE_URL names a throwaway database; `todo`
 * everywhere else, so an absent database is a skipped proof, never a passing one.
 */

const databaseUrl = juliusTestDatabaseUrl();
const suite = databaseUrl !== null ? describe : describe.todo;

suite('the corrected carry on real PostgreSQL', () => {
  let pool: Pool;
  let carry: JuliusCarryPostgresRepository;
  let events: JuliusEventPostgresRepository;
  let claims: JuliusClaimPostgresRepository;
  const id = randomBytes(4).toString('hex');
  const projectId = `prj-carry-${id}`;
  const otherProject = `prj-carry-other-${id}`;
  const without = `run:carry-without-${id}`;
  const withRun = `run:carry-with-${id}`;
  const stranger = `run:carry-stranger-${id}`;
  const at = (minute: number): string => `2026-10-04T10:${String(minute).padStart(2, '0')}:00.000Z`;
  let sequence = 0;

  const insertRun = async (runId: string, project: string): Promise<void> => {
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [project]);
    await pool.query(
      `INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$1,'{}') ON CONFLICT DO NOTHING`,
      [`mission:${runId}`, project],
    );
    await pool.query(
      `INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision)
       VALUES($1,$2,$3,'COMPLETED','1','card',1,0)`,
      [runId, `mission:${runId}`, project],
    );
  };
  const insertTask = async (runId: string, taskId: string, role: string, type: string, ordinal: number): Promise<void> => {
    await pool.query(
      "INSERT INTO relay_wonderland.julius_tasks(task_id,run_id,parent_task_id,role,task_type,state,ordinal,required_evidence_types) VALUES($1,$2,NULL,$3,$4,'SUCCEEDED',$5,'[]'::jsonb)",
      [taskId, runId, role, type, ordinal],
    );
  };
  const insertFinding = async (runId: string, findingId: string, taskId: string, status = 'OPEN'): Promise<void> => {
    await pool.query(
      `INSERT INTO relay_wonderland.julius_reviewer_findings(finding_id,run_id,task_id,reviewer_worker_id,severity,category,claim,criterion_id,evidence_ids,blocking,status,created_at,updated_at)
       VALUES($1,$2,$3,'reviewer-hermes','HIGH','correctness',$4,NULL,'["evidence:review-1"]'::jsonb,true,$5,$6,$6)`,
      [findingId, runId, taskId, `The claim of ${findingId}: parseDate accepts 2026-02-30.`, status, at(1)],
    );
  };
  const event = async (runId: string, project: string, type: 'finding.recorded' | 'finding.transitioned', facts: Record<string, string | number | boolean | null>): Promise<void> => {
    sequence += 1;
    await events.append({
      eventId: `test:${id}:${String(sequence)}`, runId, projectId: project, type, taskId: null, workerId: null,
      correlationId: runId, causationId: null, occurredAt: at(2 + sequence), facts,
    });
  };
  const move = (runId: string, findingId: string, mv: JuliusFindingMove, ids: { review?: string; repair?: string }): Promise<void> =>
    event(runId, projectId, 'finding.transitioned', juliusFindingTransitionFacts({
      findingId, move: mv, at: at(30), reviewTaskId: ids.review ?? null, repairTaskId: ids.repair ?? null, supersededByFindingId: null,
    }));
  const brainRow = async (runId: string, entryId: string, taskId: string | null, kind: string, text: string, revision: number): Promise<void> => {
    await pool.query(
      `INSERT INTO relay_wonderland.julius_brain_entries(entry_id,run_id,project_id,task_id,worker_id,entry_kind,safe_content,evidence_ids,revision,created_at)
       VALUES($1,$2,$3,$4,'coder',$5,$6,'[]'::jsonb,$7,$8)`,
      [entryId, runId, projectId, taskId, kind, text, revision, at(40)],
    );
    await claims.recordClaimStanding({
      runId, projectId, reason: 'REVIEW_ACCEPTED', occurredAt: at(41),
      claim: {
        claimId: juliusClaimIdFor(entryId), entryId, provenance: 'reviewer_verified', trust: 'VERIFIED', assertedBy: 'coder',
        assertedAt: at(40), evidence: [{ kind: 'REVIEW', id: `${runId}:review` }], supersedes: null, contradicts: [],
      },
    });
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    carry = new JuliusCarryPostgresRepository(pool);
    events = new JuliusEventPostgresRepository(pool);
    claims = new JuliusClaimPostgresRepository(pool);

    // POINT 1 — WHAT WITHOUT WROTE.
    await insertRun(without, projectId);
    await insertTask(without, `${without}:plan`, 'PROMPT_ARCHITECT', 'plan', 0);
    await insertTask(without, `${without}:build`, 'CODING_AGENT', 'build', 1);
    await insertTask(without, `${without}:review`, 'INDEPENDENT_REVIEWER', 'review:build', 2);
    await insertTask(without, `${without}:repair-1`, 'CODING_AGENT', 'repair:build', 3);
    await insertTask(without, `${without}:review:repair-1`, 'INDEPENDENT_REVIEWER', 'review:repair:build', 4);
    // f-repaired: raised, repaired, resolved by the re-review. The thing a pair exists to move.
    await insertFinding(without, `f-repaired-${id}`, `${without}:build`);
    await event(without, projectId, 'finding.recorded', { findingId: `f-repaired-${id}`, reviewTaskId: `${without}:review` });
    await move(without, `f-repaired-${id}`, 'REPAIR_SUCCEEDED', { repair: `${without}:repair-1` });
    await move(without, `f-repaired-${id}`, 'REVIEWER_RESOLVED', { review: `${without}:review:repair-1` });
    // f-open: raised and never answered. An unverified observation.
    await insertFinding(without, `f-open-${id}`, `${without}:build`);
    await event(without, projectId, 'finding.recorded', { findingId: `f-open-${id}`, reviewTaskId: `${without}:review` });
    // f-addressed: a repair acted, no reviewer said it worked.
    await insertFinding(without, `f-addressed-${id}`, `${without}:build`);
    await event(without, projectId, 'finding.recorded', { findingId: `f-addressed-${id}`, reviewTaskId: `${without}:review` });
    await move(without, `f-addressed-${id}`, 'REPAIR_SUCCEEDED', { repair: `${without}:repair-1` });
    // The first carry's defect class, present in the store at VERIFIED:
    await brainRow(without, `brain:handoff:${id}`, `${without}:build`, 'HANDOFF', 'I changed src/date.ts in this task.', 10);
    await brainRow(without, juliusArchitectureProposalEntryId(`${without}:plan`), `${without}:plan`, 'DECISION',
      'PROPOSED ARCHITECTURE REVISION — NOT IN FORCE.', 11);

    // A stranger project's resolved finding must never cross.
    await insertRun(stranger, otherProject);
    await insertTask(stranger, `${stranger}:build`, 'CODING_AGENT', 'build', 0);
    await insertFinding(stranger, `f-stranger-${id}`, `${stranger}:build`);

    // The receiving run exists before restore, as the bootstrap creates it.
    await insertRun(withRun, projectId);
  });
  afterAll(async () => pool?.end());

  it('point 1: reads back exactly what WITHOUT wrote, and nothing from another project', async () => {
    const sources = await carry.carrySources({ projectId, excludeRunId: withRun });
    expect(sources.map((source) => source.runId)).toEqual([without]);
    expect(sources[0]!.findings.map((finding) => finding.findingId).sort()).toEqual(
      [`f-addressed-${id}`, `f-open-${id}`, `f-repaired-${id}`].sort(),
    );
    expect(sources[0]!.ledger.filter((row) => row.type === 'finding.transitioned')).toHaveLength(3);
  });

  it('point 2: selects the repaired finding only, and names every refusal — the defect class included', async () => {
    const selection = selectJuliusCarry({
      targetRunId: withRun,
      sources: await carry.carrySources({ projectId, excludeRunId: withRun }),
      claims: await carry.carryClaimCandidates({ projectId, excludeRunId: withRun }),
    });
    expect(selection.selected.map((item) => [item.carryClass, item.entryId])).toEqual([
      ['VERIFIED_REPAIR_FINDING', juliusCarryEntryId(without, `finding:f-repaired-${id}`)],
    ]);
    const refused = Object.fromEntries(selection.excluded.map((item) => [item.sourceRef, item.reasonCode]));
    expect(refused).toEqual({
      [`finding:f-open-${id}`]: 'FINDING_UNRESOLVED',
      [`finding:f-addressed-${id}`]: 'FINDING_ADDRESSED_NOT_VERIFIED',
      [`brain:handoff:${id}`]: 'KIND_NOT_CARRYABLE',
      [juliusArchitectureProposalEntryId(`${without}:plan`)]: 'DECISION_PROPOSED_NOT_IN_FORCE',
    });
    expect(juliusCarryPairGate('WITH', selection)).toEqual({ valid: true, reasonCode: 'CARRY_PAIR_VALID' });
  });

  it('point 3: WITH restores the copy with its standing and the manifest, once', async () => {
    const selection = selectJuliusCarry({
      targetRunId: withRun,
      sources: await carry.carrySources({ projectId, excludeRunId: withRun }),
      claims: await carry.carryClaimCandidates({ projectId, excludeRunId: withRun }),
    });
    expect(await carry.manifestRecorded(withRun)).toBe(false);
    expect(await carry.restore({ runId: withRun, projectId, arm: 'WITH', selection, firstRevision: 5, occurredAt: at(50) })).toBe(1);

    const carriedId = juliusCarryEntryId(without, `finding:f-repaired-${id}`);
    const row = await pool.query('SELECT task_id,worker_id,entry_kind,safe_content,revision FROM relay_wonderland.julius_brain_entries WHERE entry_id=$1 AND run_id=$2', [carriedId, withRun]);
    expect(row.rows[0]).toMatchObject({ task_id: null, worker_id: 'reviewer-hermes', entry_kind: 'FINDING', revision: '5' });
    expect(String(row.rows[0].safe_content)).toMatch(/^PRIOR VERIFIED REPAIR FINDING \(an earlier mission of this project, not this one\)\./u);
    expect(String(row.rows[0].safe_content)).toContain(`resolved by review ${without}:review:repair-1`);

    const standing = await pool.query(
      'SELECT trust,provenance,asserted_by,evidence,reason FROM relay_wonderland.julius_claim_standings WHERE claim_id=$1 AND run_id=$2',
      [juliusClaimIdFor(carriedId), withRun],
    );
    expect(standing.rows[0]).toMatchObject({
      trust: 'VERIFIED', provenance: 'reviewer_verified', asserted_by: 'reviewer-hermes',
      reason: `CARRIED_FROM:${without}:finding:f-repaired-${id}`,
    });
    expect(standing.rows[0].evidence).toEqual([{ kind: 'REVIEW', id: `${without}:review:repair-1` }, { kind: 'FINDING', id: `f-repaired-${id}` }]);

    // The manifest, as the timeline serves it.
    const page = await new JuliusTimelinePostgresRepository(pool).timeline({ runId: withRun, projectId, sinceSequence: 0, limit: 50 });
    const manifest = page.entries.filter((entry) => entry.type === 'knowledge.carried');
    expect(manifest).toHaveLength(1);
    expect(manifest[0]!.eventId).toBe(juliusCarryManifestEventId(withRun));
    expect(manifest[0]!.facts).toMatchObject({
      version: 'julius-carry.v2', arm: 'WITH', selected: 1, verifiedRepairFindings: 1, written: 1, excluded: 4,
      excludedByCode: 'DECISION_PROPOSED_NOT_IN_FORCE=1 FINDING_ADDRESSED_NOT_VERIFIED=1 FINDING_UNRESOLVED=1 KIND_NOT_CARRYABLE=1',
      selectedEntryIds: carriedId,
    });

    // A replay inherits nothing twice and writes no second manifest.
    expect(await carry.restore({ runId: withRun, projectId, arm: 'WITH', selection, firstRevision: 5, occurredAt: at(55) })).toBe(0);
    const again = await new JuliusTimelinePostgresRepository(pool).timeline({ runId: withRun, projectId, sinceSequence: 0, limit: 50 });
    expect(again.entries.filter((entry) => entry.type === 'knowledge.carried')).toHaveLength(1);
  });

  it('the copy is never carried onward: a third run sees the original, not the copy', async () => {
    const third = `run:carry-third-${id}`;
    await insertRun(third, projectId);
    const selection = selectJuliusCarry({
      targetRunId: third,
      sources: await carry.carrySources({ projectId, excludeRunId: third }),
      claims: await carry.carryClaimCandidates({ projectId, excludeRunId: third }),
    });
    expect(selection.selected.map((item) => item.scope.sourceRunId)).toEqual([without]);
    expect(selection.excluded.filter((item) => item.reasonCode === 'CARRY_OF_CARRY').map((item) => item.sourceRunId)).toEqual([withRun]);
  });
});
