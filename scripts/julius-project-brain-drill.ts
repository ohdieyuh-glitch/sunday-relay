import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

import { juliusPrincipal, juliusWorkerPrincipal, type JuliusBrainBody } from '../src/relay/mission/julius/julius-brain-contracts';
import { juliusBrainStateHash, projectJuliusBrain } from '../src/relay/mission/julius/julius-brain-projection';
import { createJuliusProjectBrainService, juliusLink, type JuliusProjectBrainService } from '../src/relay/mission/julius/julius-brain-service';
import { readAllJuliusBrainEntities, readAllJuliusBrainRecords, type JuliusBrainCommitResult, type JuliusBrainStore } from '../src/relay/mission/julius/julius-brain-store';
import { verifyJuliusBrainLedger } from '../src/relay/mission/julius/julius-brain-projection';
import { JuliusBrainPostgresStore } from '../src/relay/persistence/julius-brain-postgres';
import { LocalJuliusBrainContentStore, type JuliusBrainContentStore } from '../src/relay/persistence/julius-brain-content-store';
import { assertJuliusBrainDatabase, migrateJuliusBrainDatabase } from '../src/relay/persistence/julius-brain-database';

/**
 * THE PROJECT BRAIN DURABILITY DRILL.
 *
 * Proves, against a real PostgreSQL and in separate operating-system
 * processes, the private-beta durability property:
 *
 *   process A writes Brain state → process A exits
 *   → (optionally) the PostgreSQL server itself restarts
 *   → process B starts cold → reconstructs the same Brain
 *   → provenance is intact → artifacts resolve → nothing is missing.
 *
 * A server restart is claimed only when `pg_postmaster_start_time()` moved;
 * without `JULIUS_BRAIN_DRILL_RESTART` the attestation says "process restart
 * only", because that is what happened.
 *
 *   JULIUS_BRAIN_DATABASE_URL=… node dist-relay-bridge/julius-project-brain-drill.cjs [--artifacts <dir>]
 */

export const BRAIN_DRILL = Object.freeze({
  projectId: 'prj-brain-drill',
  brainId: 'brain:prj-brain-drill',
  missionId: 'mission:brain-drill',
});

const JULIUS = juliusPrincipal('JULIUS', 'julius');
const USER = juliusPrincipal('USER', 'founder');
const ARCHITECT = juliusWorkerPrincipal('architect-1', 'PROMPT_ARCHITECT');
const CODER = juliusWorkerPrincipal('coder-1', 'CODING_AGENT');
const REVIEWER = juliusWorkerPrincipal('reviewer-1', 'INDEPENDENT_REVIEWER');

export function steppingClock(startIso = '2026-09-13T09:00:00.000Z') {
  let tick = 0;
  const start = Date.parse(startIso);
  return { now: () => new Date(start + (tick++) * 1_000).toISOString() };
}

const must = (result: JuliusBrainCommitResult, what: string) => {
  if (result.outcome !== 'COMMITTED') throw new Error(`drill_write_refused:${what}:${result.reasonCode}:${result.detail}`);
  return result.receipts[0]!.entityId;
};

/**
 * A REALISTIC MISSION'S WORTH OF MEMORY, written through the governed API by
 * the principal each record belongs to.
 */
export async function writeBrainScenario(service: JuliusProjectBrainService, content: JuliusBrainContentStore): Promise<void> {
  const { projectId, brainId, missionId } = BRAIN_DRILL;
  await service.initialize({ brainId, projectId, title: 'Brain durability drill', principal: JULIUS });
  const open = async (principal: typeof JULIUS) => (await service.open({ brainId, projectId, principal }))!;
  const julius = await open(JULIUS);
  const user = await open(USER);
  const architect = await open(ARCHITECT);
  const coder = await open(CODER);
  const reviewer = await open(REVIEWER);
  const scope = { missionId };

  must(await julius.create('MISSION', { missionId, title: 'Durable memory', status: 'ACTIVE', missionContract: { missionId, revision: 1, canonicalHash: null }, parentProjectId: projectId }, { key: 'mission', entityId: 'mission:brain-drill', scope }), 'mission');
  must(await user.create('OBJECTIVE', { statement: 'Julius remembers across restarts', successMeasure: 'process B reconstructs every record' }, { key: 'objective', scope }), 'objective');
  const requirement = must(await architect.create('REQUIREMENT', { requirementClass: 'NON_FUNCTIONAL', statement: 'Survive a PostgreSQL restart', priority: 'MUST', status: 'PROPOSED' }, { key: 'req-durability', scope }), 'requirement');
  must(await julius.revise(requirement, { requirementClass: 'NON_FUNCTIONAL', statement: 'Survive a PostgreSQL restart', priority: 'MUST', status: 'ACTIVE' }, { key: 'req-durability-adopt', expectedVersion: 1 }), 'adopt');
  must(await user.create('PROHIBITION', { statement: 'Never persist Python objects as truth', status: 'ACTIVE' }, { key: 'no-pickle', scope }), 'prohibition');
  must(await architect.create('ARCHITECTURE_COMPONENT', { name: 'Brain ledger', responsibility: 'Authoritative typed history', interfaces: ['JuliusBrainStore'], dependsOn: ['PostgreSQL'], constraints: ['append-only'] }, { key: 'component-ledger', scope }), 'component');
  const research = must(await architect.create('RESEARCH', {
    question: 'Is READ COMMITTED sufficient under a row lock?',
    findings: [{ statement: 'Every writer locks the brain row first', confidence: 0.9 }],
    sources: [{ sourceKind: 'DOCUMENT', reference: 'PostgreSQL docs: explicit locking', retrievedAt: null }],
    contradictions: [], unresolved: [], status: 'CONCLUDED',
  }, { key: 'research-isolation', scope, confidence: 0.9 }), 'research');
  const firstDecision = must(await architect.create('DECISION', { decisionClass: 'ARCHITECTURE', statement: 'Serializable transactions', rationale: 'strongest isolation', alternatives: [], status: 'ACTIVE' }, { key: 'decision-isolation', scope }), 'decision');
  must(await julius.supersede(firstDecision, 1, { decisionClass: 'ARCHITECTURE', statement: 'Row lock under READ COMMITTED', rationale: 'same safety without 40001 retries', alternatives: [{ option: 'SERIALIZABLE', reasonRejected: 'retry storms' }], status: 'ACTIVE' }, {
    key: 'decision-isolation-2', links: [juliusLink('EVIDENCED_BY', research)],
  }), 'supersede');
  must(await julius.create('HANDOFF', { handoffClass: 'ARCHITECT_TO_CODER', fromRole: 'PROMPT_ARCHITECT', toRole: 'CODING_AGENT', summary: 'Implement the store', openQuestions: [] }, { key: 'handoff-build', scope }), 'handoff');

  const bytes = new TextEncoder().encode('sequence,latency_ms\n1,4.1\n2,3.9\n');
  const stored = await content.put(bytes);
  const artifact = must(await coder.create('ARTIFACT', { artifactClass: 'DATASET', name: 'latency.csv', contentType: 'text/csv', byteSize: stored.byteSize, contentHash: stored.contentHash, storageRef: stored.storageRef, commit: null }, { key: 'artifact-latency', scope }), 'artifact');
  const passing = must(await coder.create('EVIDENCE', { evidenceClass: 'MEASUREMENT', claim: 'commit p95 under 5ms', summary: 'p95=4.1ms over 2 samples', status: 'PASSED', verification: 'UNVERIFIED', data: { name: 'p95_ms', value: 4.1, unit: 'ms' }, juliusEvidenceId: null }, {
    key: 'evidence-latency', scope, links: [juliusLink('DERIVED_FROM', artifact)],
  }), 'evidence');
  const failing = must(await reviewer.create('EVIDENCE', { evidenceClass: 'TEST_RESULT', claim: 'concurrent commits lose no update', summary: 'one revision was lost under contention', status: 'FAILED', verification: 'UNVERIFIED', data: null, juliusEvidenceId: null }, {
    key: 'evidence-race', scope, links: [juliusLink('CONTRADICTS', passing)],
  }), 'contradiction');
  const finding = must(await reviewer.create('FINDING', { findingClass: 'DEFECT', severity: 'HIGH', statement: 'Lost update under contention', blocking: true, status: 'OPEN', juliusFindingId: null }, {
    key: 'finding-race', scope, links: [juliusLink('EVIDENCED_BY', failing)],
  }), 'finding');
  const repairBody = (patch: Partial<Record<string, unknown>>): JuliusBrainBody => ({ reason: 'Add the expected-version check', status: 'REQUESTED', implementation: null, verification: 'NOT_RUN', reviewerDisposition: null, resultingState: null, juliusRepairId: null, ...patch } as JuliusBrainBody);
  const repair = must(await julius.create('REPAIR', repairBody({}), { key: 'repair-race', scope, links: [juliusLink('REPAIRS', finding)] }), 'repair');
  must(await coder.revise(repair, repairBody({ status: 'IMPLEMENTED', implementation: 'expectedVersion compare-and-set' }), { key: 'repair-race-impl', expectedVersion: 1 }), 'repair-impl');
  must(await reviewer.revise(repair, repairBody({ status: 'IMPLEMENTED', implementation: 'expectedVersion compare-and-set', reviewerDisposition: 'ACCEPTED', verification: 'PASSED' }), { key: 'repair-race-review', expectedVersion: 2 }), 'repair-review');
  must(await julius.revise(repair, repairBody({ status: 'VERIFIED', implementation: 'expectedVersion compare-and-set', reviewerDisposition: 'ACCEPTED', verification: 'PASSED', resultingState: 'no lost updates in 8-way contention' }), { key: 'repair-race-verified', expectedVersion: 3 }), 'repair-verified');
  must(await julius.revise(finding, { findingClass: 'DEFECT', severity: 'HIGH', statement: 'Lost update under contention', blocking: true, status: 'RESOLVED', juliusFindingId: null }, { key: 'finding-race-resolved', expectedVersion: 1, links: [juliusLink('EVIDENCED_BY', failing), juliusLink('RESOLVES', repair)] }), 'finding-resolved');
  must(await reviewer.revise(passing, { evidenceClass: 'MEASUREMENT', claim: 'commit p95 under 5ms', summary: 'p95=4.1ms over 2 samples', status: 'PASSED', verification: 'VERIFIED', data: { name: 'p95_ms', value: 4.1, unit: 'ms' }, juliusEvidenceId: null }, { key: 'evidence-latency-verified', expectedVersion: 1 }), 'verify');
  const fact = must(await coder.create('MEMORY_FACT', { statement: 'Brain commits are serialised per brain row', trust: 'UNVERIFIED', expiresAt: null }, { key: 'fact-serialised', scope }), 'fact');
  must(await julius.revise(fact, { statement: 'Brain commits are serialised per brain row', trust: 'VERIFIED', expiresAt: null }, { key: 'fact-serialised-verified', expectedVersion: 1, links: [juliusLink('EVIDENCED_BY', passing)] }), 'fact-verified');
  const stale = must(await reviewer.create('FINDING', { findingClass: 'RISK', severity: 'LOW', statement: 'Windows path separators', blocking: false, status: 'OPEN', juliusFindingId: null }, { key: 'finding-stale', scope }), 'stale');
  must(await julius.retire(stale, { reason: 'CAS refs are location-independent', disposition: 'STALE', expectedVersion: 1, key: 'finding-stale-retire' }), 'retire');
  must(await julius.create('MISSION_STATE', { phase: 'VERIFYING', activeTaskIds: ['task-restart'], dependencies: [{ taskId: 'task-restart', dependsOn: ['task-build'] }], waitingOn: [], humanBoundaries: ['server restart'], repairRound: 1, retryState: {}, budget: { spentUsdMicros: 0, limitUsdMicros: null } }, { key: 'state-verifying', scope, retention: 'WORKING' }), 'state');
  must(await julius.create('TRACE', { traceClass: 'LIFECYCLE', summary: 'process A finished writing', facts: { records: 26 } }, { key: 'trace-a-done', scope }), 'trace');
  must(await julius.checkpoint('process-a-final'), 'checkpoint');
}

export interface BrainDrillSummary {
  readonly pid: number;
  readonly head: { readonly sequence: number; readonly chainHash: string } | null;
  readonly recordCount: number;
  readonly entityCount: number;
  readonly recordDigest: string;
  readonly stateHash: string;
  readonly ledgerVerified: boolean;
  readonly problems: readonly string[];
  readonly kinds: Readonly<Record<string, number>>;
  readonly lifecycles: Readonly<Record<string, number>>;
  readonly checkpoint: { readonly throughSequence: number; readonly pinned: string; readonly rederived: string } | null;
  readonly supersededDecision: { readonly lifecycle: string; readonly supersededBy: string | null } | null;
  readonly repairProvenance: { readonly versions: readonly string[]; readonly findingInbound: readonly string[] } | null;
  readonly artifacts: readonly { readonly name: string; readonly resolution: string }[];
}

export async function summariseBrain(store: JuliusBrainStore, content: JuliusBrainContentStore): Promise<BrainDrillSummary> {
  const { projectId, brainId } = BRAIN_DRILL;
  const records = await readAllJuliusBrainRecords(store, brainId, projectId);
  const entities = await readAllJuliusBrainEntities(store, brainId, projectId);
  const verification = verifyJuliusBrainLedger(brainId, records, entities);
  const count = (values: readonly string[]) => values.reduce<Record<string, number>>((acc, value) => ({ ...acc, [value]: (acc[value] ?? 0) + 1 }), {});
  const checkpoint = entities.find((state) => state.kind === 'CHECKPOINT');
  const throughSequence = checkpoint === undefined ? null : Number(checkpoint.body.throughSequence);
  const decisions = entities.filter((state) => state.kind === 'DECISION');
  const superseded = decisions.find((state) => state.lifecycle === 'SUPERSEDED') ?? null;
  const repair = entities.find((state) => state.kind === 'REPAIR') ?? null;
  const finding = entities.find((state) => state.kind === 'FINDING' && state.lifecycle === 'ACTIVE') ?? null;
  const artifacts = [];
  for (const state of entities.filter((candidate) => candidate.kind === 'ARTIFACT')) {
    const resolution = await content.resolve(String(state.body.storageRef), String(state.body.contentHash));
    artifacts.push({ name: String(state.body.name), resolution: resolution.status });
  }
  return {
    pid: process.pid,
    head: await store.head(brainId, projectId),
    recordCount: records.length,
    entityCount: entities.length,
    recordDigest: `sha256:${createHash('sha256').update(records.map((record) => `${record.sequence}:${record.recordId}:${record.chainHash}`).join('\n')).digest('hex')}`,
    stateHash: verification.stateHash,
    ledgerVerified: verification.ok,
    problems: verification.problems,
    kinds: count(entities.map((state) => state.kind)),
    lifecycles: count(entities.map((state) => state.lifecycle)),
    checkpoint: checkpoint === undefined || throughSequence === null ? null : {
      throughSequence, pinned: String(checkpoint.body.stateHash),
      rederived: juliusBrainStateHash(projectJuliusBrain(brainId, records, throughSequence).entities.values()),
    },
    supersededDecision: superseded === null ? null : { lifecycle: superseded.lifecycle, supersededBy: superseded.supersededBy },
    repairProvenance: repair === null || finding === null ? null : {
      versions: records.filter((record) => record.entityId === repair.entityId).map((record) => `${record.entityVersion}:${record.principal.kind}:${record.principal.role ?? '-'}`),
      findingInbound: finding.inbound.map((edge) => `${edge.relation}<-${edge.sourceKind}`),
    },
    artifacts,
  };
}

const runProcess = promisify(execFile);

async function postmasterStart(databaseUrl: string): Promise<string> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    return String((await pool.query('SELECT pg_postmaster_start_time()::text AS t')).rows[0].t);
  } finally {
    await pool.end();
  }
}

async function waitForDatabase(databaseUrl: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await postmasterStart(databaseUrl); return; } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function runProjectBrainDrill(input: { readonly argv: readonly string[]; readonly databaseUrl: string | undefined; readonly restartCommand: string | undefined; readonly self: string }): Promise<number> {
  const mode = input.argv[0] === 'write' || input.argv[0] === 'read' ? input.argv[0] : 'orchestrate';
  const artifactsFlag = input.argv.indexOf('--artifacts');
  const artifactsRoot = artifactsFlag >= 0 ? input.argv[artifactsFlag + 1]! : mkdtempSync(join(tmpdir(), 'julius-brain-cas-'));
  if (!input.databaseUrl) {
    process.stderr.write('julius_project_brain_drill_requires_database_url: set JULIUS_BRAIN_DATABASE_URL to a dedicated Project Brain PostgreSQL this drill may write to\n');
    return 2;
  }
  const content = new LocalJuliusBrainContentStore(artifactsRoot);

  if (mode === 'write') {
    const pool = new Pool({ connectionString: input.databaseUrl });
    try {
      await migrateJuliusBrainDatabase(pool, { environment: 'test' });
      const store = new JuliusBrainPostgresStore(pool);
      if ((await store.head(BRAIN_DRILL.brainId, BRAIN_DRILL.projectId)) !== null) {
        process.stderr.write('julius_project_brain_drill_database_not_fresh\n');
        return 8;
      }
      await writeBrainScenario(createJuliusProjectBrainService({ store, clock: steppingClock() }), content);
      process.stdout.write(`${JSON.stringify({ mode, summary: await summariseBrain(store, content) })}\n`);
      return 0;
    } finally {
      await pool.end();
    }
  }

  if (mode === 'read') {
    const pool = new Pool({ connectionString: input.databaseUrl });
    try {
      await assertJuliusBrainDatabase(pool, { environment: 'test' });
      process.stdout.write(`${JSON.stringify({ mode, summary: await summariseBrain(new JuliusBrainPostgresStore(pool), content) })}\n`);
      return 0;
    } finally {
      await pool.end();
    }
  }

  const env = { ...process.env, JULIUS_BRAIN_DATABASE_URL: input.databaseUrl };
  const a = await runProcess(process.execPath, [input.self, 'write', '--artifacts', artifactsRoot], { env, timeout: 300_000 });
  const written = JSON.parse(a.stdout.trim().split('\n').at(-1)!).summary as BrainDrillSummary;
  const startBefore = await postmasterStart(input.databaseUrl);
  if (input.restartCommand) {
    await runProcess(input.restartCommand.split(' ')[0]!, input.restartCommand.split(' ').slice(1), { timeout: 120_000 });
    await waitForDatabase(input.databaseUrl);
  }
  const startAfter = await postmasterStart(input.databaseUrl);
  const b = await runProcess(process.execPath, [input.self, 'read', '--artifacts', artifactsRoot], { env, timeout: 300_000 });
  const read = JSON.parse(b.stdout.trim().split('\n').at(-1)!).summary as BrainDrillSummary;
  const { pid: _pa, ...writtenFacts } = written;
  const { pid: _pb, ...readFacts } = read;
  const identical = JSON.stringify(writtenFacts) === JSON.stringify(readFacts);
  const checks = {
    separateProcesses: written.pid !== read.pid && written.pid !== process.pid,
    serverRestarted: input.restartCommand ? startAfter !== startBefore : false,
    identicalReconstruction: identical,
    ledgerVerified: read.ledgerVerified,
    checkpointRederived: read.checkpoint !== null && read.checkpoint.pinned === read.checkpoint.rederived,
    artifactsResolve: read.artifacts.length > 0 && read.artifacts.every((artifact) => artifact.resolution === 'RESOLVED'),
    supersessionPreserved: read.supersededDecision?.lifecycle === 'SUPERSEDED' && read.supersededDecision.supersededBy !== null,
    repairProvenance: (read.repairProvenance?.versions.length ?? 0) === 4,
  };
  const restartClaimed = input.restartCommand !== undefined && input.restartCommand !== '';
  const passed = checks.separateProcesses && checks.identicalReconstruction && checks.ledgerVerified && checks.checkpointRederived
    && checks.artifactsResolve && checks.supersessionPreserved && checks.repairProvenance && (!restartClaimed || checks.serverRestarted);
  process.stdout.write(`${JSON.stringify({ mode, checks, restart: restartClaimed ? 'POSTGRESQL SERVER RESTART' : 'PROCESS RESTART ONLY', startBefore, startAfter, written, read }, null, 2)}\n`);
  process.stdout.write(passed ? 'JULIUS PROJECT BRAIN DURABILITY VERIFIED\n' : 'JULIUS PROJECT BRAIN DURABILITY NOT VERIFIED\n');
  return passed ? 0 : 8;
}
