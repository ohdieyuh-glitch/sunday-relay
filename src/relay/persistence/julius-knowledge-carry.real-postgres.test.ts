import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { JuliusTask } from '../mission/julius';
import {
  JULIUS_ARCHITECTURE_VERSION, juliusArchitectureEntryId, juliusArchitectureFacts, juliusArchitectureProposalEntryId,
  type JuliusArchitectureState,
} from '../mission/julius/julius-architecture-state';
import { juliusAdmittedClaimFor, juliusCarriedCopyId, juliusClaimIdFor } from '../mission/julius/julius-claim-ledger';
import type { JuliusOperationalEventType } from '../mission/julius/julius-events';
import { juliusFindingTransitionFacts } from '../mission/julius/julius-finding-lifecycle';
import { JuliusClaimPostgresRepository } from './julius-claim-postgres';
import { JuliusEventPostgresRepository } from './julius-event-postgres';
import { JuliusPostgresRepository } from './julius-postgres';
import { juliusTestDatabaseUrl } from './julius-test-database';
import { TransactionalWonderlandDatabase } from './wonderland-postgres';

/**
 * THE CORRECTED CARRY ON REAL POSTGRESQL (founder ruling 2026-10-04, R1 and R3).
 *
 * `julius-claim-ledger.test.ts` holds the pure rule to its cases. This holds the
 * STORE to it: that `carryProjectKnowledge` reads eligibility from the durable
 * rows the runtime really writes — a finding's life from its `finding.*` ledger
 * rows, the design in force from its `architecture.*` rows, the run's state and
 * mission from `julius_runs` — never from an entry's kind or text; that what it
 * writes is scoped to the inheriting run's plan task under an id no other heir
 * can collide with; that the decision and every exclusion land as ONE
 * `knowledge.carried` row in the same transaction; and that a failure is
 * recorded, never swallowed.
 *
 * The source run is SEEDED here, row by row, the way the pipeline writes each
 * row (`appendBrainEntry` + the admitted standing, `finding.recorded` and
 * `finding.transitioned` through the event repository, `architecture.recorded`
 * with `juliusArchitectureFacts`). The end-to-end drive through the real run
 * loop is `relay-bridge/julius-carry-reaches-planner.real-postgres.test.ts`.
 *
 * Gated on JULIUS_TEST_DATABASE_URL like every real-postgres suite, and `todo`
 * without it. Every case carries a random identity.
 */

const databaseUrl = juliusTestDatabaseUrl();
const enabled = databaseUrl !== null;
const suite = enabled ? describe : describe.todo;

const REVIEWER = 'independent-reviewer-hermes';
const ARCHITECT = 'prompt-architect-openai';
const SENTINEL = 'CARRY-STORE-SENTINEL the deploy runs before the migration';
const T0 = '2026-10-04T10:00:00.000Z';

type CarriedRow = { entry_id: string; task_id: string | null; worker_id: string; entry_kind: string; safe_content: string; evidence_ids: string[] };
type EventRow = { event_id: string; payload: { taskId: string | null; facts: Record<string, string | number | boolean | null> } };

suite('the corrected knowledge carry on real PostgreSQL', () => {
  let pool: Pool;
  let runs: JuliusPostgresRepository;
  let claims: JuliusClaimPostgresRepository;
  let events: JuliusEventPostgresRepository;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl! });
    await new TransactionalWonderlandDatabase(pool).migrate();
    runs = new JuliusPostgresRepository(pool);
    claims = new JuliusClaimPostgresRepository(pool);
    events = new JuliusEventPostgresRepository(pool);
  });
  afterAll(async () => pool?.end());

  /* ------------------------------------------------------------- seeding, the runtime's way */

  const id = () => randomBytes(4).toString('hex');

  async function project(projectId: string, missionIds: readonly string[]): Promise<void> {
    await pool.query('INSERT INTO relay_wonderland.projects(project_id) VALUES($1) ON CONFLICT DO NOTHING', [projectId]);
    for (const missionId of missionIds) {
      // `UNIQUE(project_id, canonical_hash)`: each mission its own hash, or the second one is silently not written.
      await pool.query(
        `INSERT INTO relay_wonderland.mission_contracts(mission_id,project_id,stage,canonical_hash,snapshot) VALUES($1,$2,'READY',$1,'{}'::jsonb) ON CONFLICT (mission_id) DO NOTHING`,
        [missionId, projectId]);
    }
  }

  async function run(input: { runId: string; missionId: string; projectId: string; state: string; createdAt: string }): Promise<void> {
    await pool.query(
      `INSERT INTO relay_wonderland.julius_runs(run_id,mission_id,project_id,state,runtime_version,card_revision,mission_contract_revision,project_brain_revision,created_at)
       VALUES($1,$2,$3,$4,'julius-runtime.v1','card',1,0,$5)`,
      [input.runId, input.missionId, input.projectId, input.state, input.createdAt]);
  }

  async function task(input: { runId: string; projectId: string; missionId: string; taskId: string; taskType: string; role: JuliusTask['role']; parentTaskId?: string | null }): Promise<void> {
    await runs.addTask({
      commandId: `seed:${input.taskId}`, runId: input.runId, projectId: input.projectId,
      task: {
        taskId: input.taskId, missionId: input.missionId, parentTaskId: input.parentTaskId ?? null, dependencyIds: [],
        requiredEvidenceTypes: ['ARTIFACT'], taskType: input.taskType, role: input.role, ordinal: 0, state: 'SUCCEEDED',
      } as JuliusTask,
    });
  }

  /** A brain row and its admitted standing, exactly as `appendBrainEntryAdmitting` writes them. */
  async function brain(input: { runId: string; projectId: string; taskId: string | null; workerId: string; entryId: string; kind: 'DECISION' | 'HANDOFF'; text: string }): Promise<void> {
    const append = { ...input, safeText: input.text, evidenceIds: [], occurredAt: T0 };
    expect(await runs.appendBrainEntry(append)).toBe(true);
    expect(await claims.recordClaimStanding({ runId: input.runId, projectId: input.projectId, claim: juliusAdmittedClaimFor(append), reason: 'ADMITTED', occurredAt: T0 })).toBe(true);
  }

  async function event(input: { runId: string; projectId: string; type: JuliusOperationalEventType; taskId: string | null; facts: Record<string, string | number | boolean | null> }): Promise<void> {
    await events.append({
      eventId: `seed:${id()}`, runId: input.runId, projectId: input.projectId, type: input.type, taskId: input.taskId,
      workerId: REVIEWER, correlationId: `seed:${input.runId}`, causationId: null, occurredAt: T0, facts: input.facts,
    });
  }

  /** A finding row, then its life on the ledger, move by move, as the pipeline records it. */
  async function finding(input: {
    runId: string; projectId: string; findingId: string; taskId: string; blocking: boolean;
    moves: readonly ('REPAIR_SUCCEEDED' | 'REVIEWER_RESOLVED' | 'REVIEWER_MAINTAINED')[];
  }): Promise<void> {
    await pool.query(
      `INSERT INTO relay_wonderland.julius_reviewer_findings(finding_id,run_id,task_id,reviewer_worker_id,severity,category,claim,criterion_id,evidence_ids,blocking,status,created_at,updated_at)
       VALUES($1,$2,$3,$4,'HIGH','review',$5,NULL,$6::jsonb,$7,'OPEN',$8,$8)`,
      [input.findingId, input.runId, input.taskId, REVIEWER, `${SENTINEL} (${input.findingId})`, JSON.stringify([`evidence:${input.findingId}`]), input.blocking, T0]);
    const on = { runId: input.runId, projectId: input.projectId, taskId: input.taskId };
    await event({ ...on, type: 'finding.recorded', facts: { findingId: input.findingId, evidenceId: `evidence:${input.findingId}`, blocking: input.blocking, reviewTaskId: `review:${input.taskId}` } });
    for (const move of input.moves) {
      await event({
        ...on, type: 'finding.transitioned',
        facts: juliusFindingTransitionFacts(move === 'REPAIR_SUCCEEDED'
          ? { findingId: input.findingId, move, at: T0, repairTaskId: `repair:${input.taskId}:1:task` }
          : { findingId: input.findingId, move, at: T0, reviewTaskId: `review:repair:${input.taskId}:1:task` }),
      });
    }
  }

  const design = (revision: number, proposedByTaskId: string, name: string): JuliusArchitectureState => ({
    version: JULIUS_ARCHITECTURE_VERSION, revision,
    components: [{ name, responsibility: 'Runs the migration, then the deploy.' }],
    boundaries: [], dependencies: [], decisions: [], assumptions: [], openQuestions: [], risks: [],
    proposedByTaskId, recordedAt: T0,
  });

  /**
   * THE SOURCE RUN: what one completed run of mission A really leaves behind.
   *   - finding F-resolved: blocking, repaired, RESOLVED by the re-review   -> CARRIED
   *   - finding F-open: blocking, repaired, the re-review MAINTAINED it     -> finding_unresolved
   *   - finding F-warning: non-blocking, RESOLVED                          -> finding_not_blocking
   *   - architecture r1 (IN_FORCE) then r2 (IN_FORCE): r2 is in force      -> r2 architecture_not_a_source, r1 architecture_not_in_force
   *   - a proposal r3 (PROPOSED, never accepted)                           -> architecture_proposal
   *   - the plan's REPAIR verdict mirror                                   -> decision_mirror
   */
  async function sourceRun(input: { projectId: string; missionId: string; runId: string; state: string; createdAt: string }) {
    const { projectId, missionId, runId } = input;
    await run(input);
    await task({ runId, projectId, missionId, taskId: `${runId}:plan`, taskType: 'plan', role: 'PROMPT_ARCHITECT' });
    await task({ runId, projectId, missionId, taskId: `${runId}:architecture:1`, taskType: 'architecture', role: 'PROMPT_ARCHITECT' });
    const resolved = `finding:${runId}:resolved`;
    await finding({ runId, projectId, findingId: resolved, taskId: `${runId}:plan`, blocking: true, moves: ['REPAIR_SUCCEEDED', 'REVIEWER_RESOLVED'] });
    await finding({ runId, projectId, findingId: `finding:${runId}:open`, taskId: `${runId}:plan`, blocking: true, moves: ['REPAIR_SUCCEEDED', 'REVIEWER_MAINTAINED'] });
    await finding({ runId, projectId, findingId: `finding:${runId}:warning`, taskId: `${runId}:plan`, blocking: false, moves: ['REVIEWER_RESOLVED'] });
    const mirror = `brain:decision:${runId}:plan:REPAIR:BLOCKING_FINDINGS`;
    await brain({ runId, projectId, taskId: `${runId}:plan`, workerId: REVIEWER, entryId: mirror, kind: 'DECISION', text: 'REPAIR (BLOCKING_FINDINGS): Verification requires repair.' });
    for (const revision of [1, 2]) {
      await event({ runId, projectId, type: 'architecture.recorded', taskId: `${runId}:plan`, facts: { ...juliusArchitectureFacts(design(revision, `${runId}:plan`, `design-r${String(revision)}`)), status: 'IN_FORCE' } });
      await brain({ runId, projectId, taskId: null, workerId: ARCHITECT, entryId: juliusArchitectureEntryId(runId, revision), kind: 'DECISION', text: `ACCEPTED ARCHITECTURE (revision ${String(revision)}) of ${runId}` });
    }
    const proposal = juliusArchitectureProposalEntryId(`${runId}:architecture:1`);
    await event({ runId, projectId, type: 'architecture.recorded', taskId: `${runId}:architecture:1`, facts: { ...juliusArchitectureFacts(design(3, `${runId}:architecture:1`, 'design-r3')), status: 'PROPOSED' } });
    await brain({ runId, projectId, taskId: `${runId}:architecture:1`, workerId: ARCHITECT, entryId: proposal, kind: 'DECISION', text: 'PROPOSED ARCHITECTURE REVISION — NOT IN FORCE.' });
    return { resolved, mirror, proposal, r1: juliusArchitectureEntryId(runId, 1), r2: juliusArchitectureEntryId(runId, 2) };
  }

  /** An inheriting run as the bootstrap leaves it when the carry runs: CREATED, with its plan task. */
  async function heir(input: { projectId: string; missionId: string; runId: string }): Promise<void> {
    await run({ ...input, state: 'CREATED', createdAt: '2026-10-04T12:00:00.000Z' });
    await task({ runId: input.runId, projectId: input.projectId, missionId: input.missionId, taskId: `${input.runId}:plan`, taskType: 'plan', role: 'PROMPT_ARCHITECT' });
  }

  const carriedRows = async (runId: string): Promise<readonly CarriedRow[]> => (await pool.query<CarriedRow>(
    `SELECT entry_id, task_id, worker_id, entry_kind, safe_content, evidence_ids FROM relay_wonderland.julius_brain_entries
      WHERE run_id = $1 AND entry_id LIKE 'carried:%' ORDER BY revision`, [runId])).rows;

  const carryEvents = async (runId: string): Promise<readonly EventRow[]> => (await pool.query<EventRow>(
    `SELECT event_id, payload FROM relay_wonderland.events WHERE stream_id = $1 AND event_type = 'julius.knowledge.carried' ORDER BY sequence`, [runId])).rows;

  const carry = (input: { runId: string; projectId: string; missionId: string; fromRunIds?: readonly string[] }) => claims.carryProjectKnowledge({
    ...input, scopeTaskId: `${input.runId}:plan`, limit: 12, occurredAt: '2026-10-04T12:00:01.000Z',
  });

  /* ------------------------------------------------------------------------- the cases */

  it('carries the RESOLVED repair finding — scoped to the plan, with provenance — names the design in force as no source, and records every exclusion', async () => {
    const n = id();
    const projectId = `prj-carry-${n}`;
    const missionId = `mission:carry-${n}`;
    const src = `run:carry-src-${n}`;
    const heirRun = `run:carry-heir-${n}`;
    await project(projectId, [missionId]);
    const seeded = await sourceRun({ projectId, missionId, runId: src, state: 'COMPLETED', createdAt: '2026-10-04T09:00:00.000Z' });
    await heir({ projectId, missionId, runId: heirRun });

    const outcome = await carry({ runId: heirRun, projectId, missionId });
    expect(outcome).toMatchObject({ outcome: 'CARRIED', carried: 1, carriedFindings: 1, findingSourceRunIds: [src], written: 1, reasonCode: null });

    // (3) WHAT WAS CARRIED: one row, the finding, scoped to the heir's plan task, never run-wide, under its own id.
    const rows = await carriedRows(heirRun);
    expect(rows.map((row) => row.entry_id)).toEqual([juliusCarriedCopyId(heirRun, src, seeded.resolved)]);
    for (const row of rows) expect(row.task_id, `${row.entry_id} is the plan's, never run-wide`).toBe(`${heirRun}:plan`);
    const [findingRow] = rows;
    expect(findingRow).toMatchObject({ entry_kind: 'FINDING', worker_id: REVIEWER, evidence_ids: [`evidence:${seeded.resolved}`] });
    for (const line of [
      `SOURCE RUN: ${src} (COMPLETED)`,
      `SOURCE TASK: ${src}:plan (plan, PROMPT_ARCHITECT)`,
      `FINDING: ${seeded.resolved} | severity HIGH | category review | criterion none | blocking`,
      `RAISED BY: ${REVIEWER} in review:${src}:plan, citing evidence:${seeded.resolved}`,
      `REPAIRED BY: repair:${src}:plan:1:task | RESOLVED BY THE INDEPENDENT RE-REVIEW: review:repair:${src}:plan:1:task`,
      `SCOPE HERE: ${heirRun}:plan (plan, PROMPT_ARCHITECT) only`,
      `REVIEWER'S CLAIM: ${SENTINEL} (${seeded.resolved})`,
    ]) expect(findingRow!.safe_content.split('\n'), line).toContain(line);

    // NOTHING ELSE CROSSED: not the design in force, not the verdict mirror, not the proposal, not the superseded revision, not the open finding.
    const everything = rows.map((row) => `${row.entry_id}\n${row.safe_content}`).join('\n');
    for (const absent of [seeded.r2, seeded.mirror, seeded.proposal, `${seeded.r1}:into`, 'ACCEPTED ARCHITECTURE', 'Verification requires repair', 'NOT IN FORCE', `finding:${src}:open`, `finding:${src}:warning`]) {
      expect(everything, `${absent} must not be carried`).not.toContain(absent);
    }

    // THE STANDING: admission's derivation for the finding (VERIFIED, the reviewer), and no other. Reason names the source.
    const standings = await pool.query<{ claim_id: string; trust: string; provenance: string; asserted_by: string; reason: string }>(
      `SELECT claim_id, trust, provenance, asserted_by, reason FROM relay_wonderland.julius_claim_standings WHERE run_id = $1 AND claim_id LIKE 'claim:carried:%' ORDER BY claim_id`,
      [heirRun]);
    expect(standings.rows).toEqual([
      { claim_id: juliusClaimIdFor(findingRow!.entry_id), trust: 'VERIFIED', provenance: 'reviewer_verified', asserted_by: REVIEWER, reason: `CARRIED_FROM:${src}` },
    ]);

    // (2) WHAT BECAME ELIGIBLE, AND WHY THE REST DID NOT: one event on the heir's stream, in the same transaction.
    const recorded = await carryEvents(heirRun);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.event_id).toBe(outcome.eventId);
    const facts = recorded[0]!.payload.facts;
    expect(facts).toMatchObject({
      outcome: 'CARRIED', missionId, scopeTaskId: `${heirRun}:plan`, scopeRole: 'PROMPT_ARCHITECT', sourceRuns: 1, sourceRunIds: src,
      eligible: 1, carried: 1, carriedFindings: 1, carriedArchitecture: 0,
    });
    for (const reason of ['finding_unresolved=1', 'finding_not_blocking=1', 'architecture_proposal=1', 'architecture_not_in_force=1', 'architecture_not_a_source=1', 'decision_mirror=1']) {
      expect(String(facts.excludedByReason), reason).toContain(reason);
    }
    expect(String(facts.excludedRefs), 'the design in force, named').toContain(`architecture_not_a_source:${src}:${seeded.r2}`);
    expect(String(facts.carriedEntries)).toContain(`${findingRow!.entry_id}|FINDING|VERIFIED_REPAIR_FINDING|${src}|${src}:plan|plan|TASK|HIGH|review|-|${REVIEWER}|VERIFIED|sha256:`);
    expect(JSON.stringify(facts), 'the finding text never reaches the ledger').not.toContain('CARRY-STORE-SENTINEL');
  });

  it('inherits nothing from another mission of the same project, or from another project', async () => {
    const n = id();
    const projectId = `prj-carry-scope-${n}`;
    const missionA = `mission:carry-a-${n}`;
    const missionB = `mission:carry-b-${n}`;
    await project(projectId, [missionA, missionB]);
    await sourceRun({ projectId, missionId: missionB, runId: `run:carry-b-${n}`, state: 'COMPLETED', createdAt: '2026-10-04T09:00:00.000Z' });
    const heirA = `run:carry-heir-a-${n}`;
    await heir({ projectId, missionId: missionA, runId: heirA });
    expect(await carry({ runId: heirA, projectId, missionId: missionA }), 'another mission is not a source').toMatchObject({ outcome: 'EMPTY', carried: 0 });
    expect(await carriedRows(heirA)).toEqual([]);
    expect((await carryEvents(heirA))[0]!.payload.facts).toMatchObject({ outcome: 'EMPTY', sourceRuns: 0, candidates: 0 });

    const elsewhere = `prj-carry-elsewhere-${n}`;
    await project(elsewhere, [missionB]);
    const heirElsewhere = `run:carry-heir-elsewhere-${n}`;
    await heir({ projectId: elsewhere, missionId: missionB, runId: heirElsewhere });
    expect(await carry({ runId: heirElsewhere, projectId: elsewhere, missionId: missionB })).toMatchObject({ outcome: 'EMPTY', carried: 0 });
  });

  it('a replay writes nothing twice; a second heir gets its own copies; a copy is never a source; a pinned source is the only source', async () => {
    const n = id();
    const projectId = `prj-carry-heirs-${n}`;
    const missionId = `mission:carry-heirs-${n}`;
    const src = `run:carry-src-${n}`;
    await project(projectId, [missionId]);
    await sourceRun({ projectId, missionId, runId: src, state: 'COMPLETED', createdAt: '2026-10-04T09:00:00.000Z' });
    const first = `run:carry-first-${n}`;
    await heir({ projectId, missionId, runId: first });
    const once = await carry({ runId: first, projectId, missionId });

    // A REPLAY: the same decision, the same event id, no second row or standing.
    const again = await carry({ runId: first, projectId, missionId });
    expect(again).toMatchObject({ outcome: 'CARRIED', carried: 1, written: 0, eventId: once.eventId });
    expect(await carriedRows(first)).toHaveLength(1);
    expect(await carryEvents(first)).toHaveLength(1);
    const history = await claims.claimStandingHistory(juliusClaimIdFor(juliusCarriedCopyId(first, src, `finding:${src}:resolved`)), projectId);
    expect(history, 'one standing, recorded once').toHaveLength(1);

    // A SECOND HEIR of the same source: the old id was the source's alone, so this insert used to be skipped silently.
    const second = `run:carry-second-${n}`;
    await heir({ projectId, missionId, runId: second });
    const outcome = await carry({ runId: second, projectId, missionId });
    expect(outcome).toMatchObject({ outcome: 'CARRIED', carried: 1, written: 1 });
    // The first heir is a source run now too (same mission): its copy is excluded as a copy, never re-carried.
    expect(String((await carryEvents(second))[0]!.payload.facts.excludedByReason)).toContain('carried_copy=1');
    expect((await carriedRows(second)).map((row) => row.entry_id).every((entryId) => entryId.startsWith(`carried:${src}:`) && entryId.endsWith(`:into:${second}`))).toBe(true);

    // A PINNED SOURCE (arm WITH names its arm WITHOUT): only that run is read.
    const pinned = `run:carry-pinned-${n}`;
    await heir({ projectId, missionId, runId: pinned });
    expect(await carry({ runId: pinned, projectId, missionId, fromRunIds: [first] }), 'the pinned run holds only copies').toMatchObject({ outcome: 'EMPTY', carried: 0 });
    expect((await carryEvents(pinned))[0]!.payload.facts).toMatchObject({ sourceRuns: 1, sourceRunIds: first });
  });

  it('records a failed write as FAILED, by its closed reason, with nothing half-written — and a failed read the same way', async () => {
    const n = id();
    const projectId = `prj-carry-fail-${n}`;
    const missionId = `mission:carry-fail-${n}`;
    const src = `run:carry-src-${n}`;
    await project(projectId, [missionId]);
    await sourceRun({ projectId, missionId, runId: src, state: 'COMPLETED', createdAt: '2026-10-04T09:00:00.000Z' });
    // The heir has NO plan task, so the scoped insert violates julius_brain_entries.task_id's foreign key.
    const orphan = `run:carry-orphan-${n}`;
    await run({ runId: orphan, missionId, projectId, state: 'CREATED', createdAt: '2026-10-04T12:00:00.000Z' });
    const failed = await carry({ runId: orphan, projectId, missionId });
    expect(failed).toMatchObject({ outcome: 'FAILED', reasonCode: 'carry_write_failed', carried: 0, written: 0 });
    expect(failed.eventId, 'the failure is on the record').not.toBeNull();
    expect(await carriedRows(orphan), 'the transaction rolled back whole').toEqual([]);
    const recorded = await carryEvents(orphan);
    expect(recorded.map((row) => row.payload.facts.outcome)).toEqual(['FAILED']);
    expect(recorded[0]!.payload.facts).toMatchObject({ reasonCode: 'carry_write_failed', carried: null, candidates: null });

    // A READ THAT FAILS: the source query is refused; the failure is still written, through a real connection.
    const brokenReads = new Proxy(pool, {
      get(target, property, receiver) {
        if (property === 'query') {
          return (text: unknown, values?: unknown) => (typeof text === 'string' && text.includes('mission_id = $2 AND run_id <> $3')
            ? Promise.reject(new Error('read refused'))
            : target.query(text as string, values as unknown[]));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const unread = await new JuliusClaimPostgresRepository(brokenReads).carryProjectKnowledge({
      runId: orphan, projectId, missionId, scopeTaskId: `${orphan}:plan`, limit: 12, occurredAt: '2026-10-04T12:00:02.000Z',
    });
    expect(unread).toMatchObject({ outcome: 'FAILED', reasonCode: 'carry_sources_unreadable' });
    expect((await carryEvents(orphan)).map((row) => row.payload.facts.reasonCode)).toEqual(['carry_write_failed', 'carry_sources_unreadable']);
  });
});
