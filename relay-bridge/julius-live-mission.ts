/**
 * THE SUPPORTED LIVE JULIUS MISSION ENTRYPOINT — the one production path from
 * a Mission Contract file to a durable, provider-live Julius run.
 *
 *   node dist-relay-bridge/julius-live-mission.cjs run --contract <file> [--confirm-live]
 *
 * WHY THIS LIVES IN THE BRIDGE TREE AND NOT THE CLI. The three live provider
 * implementations sit on both sides of a structural boundary: the GPT
 * architect connector under `src/relay/connectors`, the hosted Claude Agent
 * SDK runner and the Hermes reviewer under `relay-bridge/`. The CLI is
 * boundary-tested never to reference `relay-bridge`, while bridge code
 * importing `src/relay` is the repository's normal direction — so the only
 * home that can compose all three without re-homing a provider stack or
 * widening a boundary is here. One entrypoint, deliberately: there is no
 * second way to start a live Julius mission.
 *
 * WHAT IT DOES, IN ORDER: read and validate the Mission Contract file →
 * resolve the C.A.R.D. roles to live adapters (fail closed, naming every
 * missing variable) → without `--confirm-live`, print the preflight and stop
 * (approval is never inferred) → connect PostgreSQL and the executor control
 * plane → submit through the production `JuliusBootstrapPort` (idempotent, so
 * re-running the same contract resumes its run) → drive the Julius run loop
 * to a terminal state → print a sanitized report. Completion is decided by
 * Julius's verification gate; this file never writes a run state.
 *
 * SECRETS: this process reads credentials from the environment and hands them
 * to the existing connectors. It prints only SET / MISSING — never a value —
 * and nothing here persists a credential into the contract snapshot, brain,
 * evidence, events, or stdout.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createPublicKey, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';
import { JuliusToolSettlementPostgresRepository } from '../src/relay/persistence/julius-tool-settlement-postgres';
import { RemoteExecutorControlPlane } from '../src/relay/workspace/julius-tools/remote-executor-control-plane';
import type { ExecutorOperation } from '../src/relay/workspace/julius-tools/executor-operation-request';
import {
  JULIUS_BOOTSTRAP_REQUEST_VERSION,
  type JuliusBootstrapRequest,
} from '../src/relay/integration/julius/julius-port';
import { createLiveJuliusBootstrapPort } from './julius/bootstrap';
import { createPostgresMissionSeedStore } from './julius/mission-seed';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';
import { createExecutorShellPort } from './julius/executor-effects';
import { createLiveArtifactExchange } from './julius/live-workers';
import {
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  resolveLiveWorkers,
} from './julius/live-composition';

/* ------------------------------------------------------------- contract */

export interface LiveMissionContractFile {
  readonly missionId: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly objective: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly testCommand: string;
  readonly workspacePath: string;
  readonly limits?: { readonly spendUsd?: number; readonly repairCycles?: number };
}

export function parseLiveMissionContract(raw: string): { ok: true; contract: LiveMissionContractFile } | { ok: false; problem: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, problem: 'The contract file is not valid JSON.' }; }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, problem: 'The contract must be a JSON object.' };
  const value = parsed as Record<string, unknown>;
  for (const field of ['missionId', 'projectId', 'tenantId', 'objective', 'testCommand', 'workspacePath'] as const) {
    if (typeof value[field] !== 'string' || (value[field] as string).trim() === '') {
      return { ok: false, problem: `The contract field "${field}" must be a non-empty string.` };
    }
  }
  const criteria = value.acceptanceCriteria;
  if (!Array.isArray(criteria) || criteria.length === 0) return { ok: false, problem: 'The contract needs a non-empty acceptanceCriteria array.' };
  for (const criterion of criteria) {
    const item = criterion as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.blocking !== 'boolean') {
      return { ok: false, problem: 'Every acceptance criterion needs a string id, a string text, and a boolean blocking flag.' };
    }
  }
  const list = (field: string): readonly string[] => Array.isArray(value[field]) ? (value[field] as unknown[]).map(String) : [];
  return {
    ok: true,
    contract: {
      missionId: value.missionId as string, projectId: value.projectId as string,
      tenantId: value.tenantId as string, objective: value.objective as string,
      requirements: list('requirements'), constraints: list('constraints'),
      acceptanceCriteria: criteria as LiveMissionContractFile['acceptanceCriteria'],
      testCommand: value.testCommand as string, workspacePath: value.workspacePath as string,
      limits: typeof value.limits === 'object' && value.limits !== null ? value.limits as LiveMissionContractFile['limits'] : undefined,
    },
  };
}

const stable = (value: unknown): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
const digestOf = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');

export function compileBootstrapRequest(contract: LiveMissionContractFile, workers: JuliusBootstrapRequest['workers'], cardRevision: string): JuliusBootstrapRequest {
  const bindingDigest = digestOf(contract);
  return {
    requestVersion: JULIUS_BOOTSTRAP_REQUEST_VERSION,
    // Derived from the contract content: re-running the same file resumes the
    // same durable run instead of paying for a second mission.
    idempotencyKey: bindingDigest.slice(0, 24),
    missionId: contract.missionId,
    projectId: contract.projectId,
    tenantId: contract.tenantId,
    compoundAgentId: 'compound-agent:julius-live',
    compoundAgentRevision: 1,
    authorization: {
      tenantId: contract.tenantId, projectId: contract.projectId,
      ownerParticipant: 'operator', method: 'operator_token',
      authorizationRef: 'julius-live-mission:operator-shell',
    },
    objective: contract.objective,
    requirements: contract.requirements,
    constraints: contract.constraints,
    acceptanceCriteria: contract.acceptanceCriteria,
    scope: { filesInScope: [], filesOutOfScope: [], systemsInScope: [], systemsOutOfScope: [] },
    workers,
    card: { referenceId: 'card:julius-live', revision: cardRevision },
    projectBrain: { referenceId: 'brain:julius-live', revision: '0' },
    requestedPermissions: [],
    executionMode: 'autonomous',
    reviewRequirement: 'independent',
    completionRule: 'all_blocking_criteria_and_independent_review',
    limits: {
      runtimeMinutes: 60, agentCalls: 24,
      spendUsd: contract.limits?.spendUsd ?? 5,
      reviewCycles: 3, repairCycles: contract.limits?.repairCycles ?? 1,
    },
    missionRevision: 1,
    missionBindingDigest: `sha256:${bindingDigest}`,
    compiledAt: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------ environment */

const EXECUTOR_ENV = ['JULIUS_EXECUTOR_ENDPOINT', 'JULIUS_SCOPED_CREDENTIALS', 'EXECUTOR_KEY_ID', 'JULIUS_PUBLIC_KEY_PATH', 'JULIUS_CALLER_ID'] as const;

function presence(env: Record<string, string | undefined>, names: readonly string[]): string {
  return names.map((name) => `  ${name}: ${env[name] ? 'SET' : 'MISSING'}`).join('\n');
}

/* ------------------------------------------------------------------ main */

async function main(argv: readonly string[]): Promise<number> {
  const out = (line: string): void => { process.stdout.write(`${line}\n`); };
  const flag = (name: string): boolean => argv.includes(`--${name}`);
  const option = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : null;
  };

  if (argv[0] !== 'run' || option('contract') === null) {
    out('Usage: julius-live-mission run --contract <mission.json> [--confirm-live] [--max-ticks N]');
    return 2;
  }
  let rawContract: string;
  try { rawContract = readFileSync(option('contract') as string, 'utf8'); } catch {
    out(`The contract file could not be read: ${option('contract')}`);
    return 2;
  }
  const parsedContract = parseLiveMissionContract(rawContract);
  if (!parsedContract.ok) { out(`Mission Contract refused: ${parsedContract.problem}`); return 2; }
  const contract = parsedContract.contract;

  const env = process.env as Record<string, string | undefined>;
  const cardRevision = env.RELAY_JULIUS_CARD_REVISION?.trim() || 'card:julius-live:1';

  /* Executor material — resolved before any adapter exists, fail closed. */
  const executorMissing = EXECUTOR_ENV.filter((name) => !env[name]);
  const databaseMissing = env.DATABASE_URL ? [] : ['DATABASE_URL'];

  const artifacts = createLiveArtifactExchange();
  // Preflight resolution runs with a null shell so that a machine with no
  // executor still reports every problem in one pass; the confirmed run
  // resolves again with the real shell port before anything dispatches.
  const preflight = resolveLiveWorkers({
    env, projectId: contract.projectId, workspacePath: contract.workspacePath,
    testCommand: contract.testCommand,
    contexts: { snapshotFor: () => null }, artifacts, shell: null,
  });

  out('JULIUS LIVE MISSION — preflight');
  out(`  mission: ${contract.missionId} (project ${contract.projectId})`);
  out(`  requested models: architect=${preflight.requested.architectModel ?? 'MISSING'} coder=${preflight.requested.codingModel ?? 'MISSING'} reviewer=${preflight.requested.reviewerProvider ?? 'MISSING'}/${preflight.requested.reviewerModel ?? 'MISSING'}`);
  out(presence(env, ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'XAI_API_KEY', 'DATABASE_URL', ...EXECUTOR_ENV]));
  out('  note: the local Hermes reviewer bills through the hermes profile of this operator account; XAI_API_KEY presence is reported for the record.');
  for (const problem of preflight.problems.filter((entry) => entry.role !== 'CODING_AGENT' || !entry.missing.some((name) => name.startsWith('executor shell')))) {
    out(`  BLOCKED ${problem.role}: ${problem.reason} — ${problem.missing.join(', ')}`);
  }
  if (executorMissing.length > 0) out(`  BLOCKED executor: missing ${executorMissing.join(', ')}`);
  if (databaseMissing.length > 0) out(`  BLOCKED durable store: missing DATABASE_URL`);

  const preflightBlocked = preflight.problems.some((entry) => entry.role !== 'CODING_AGENT')
    || preflight.problems.some((entry) => entry.role === 'CODING_AGENT' && entry.missing.some((name) => !name.startsWith('executor shell')))
    || executorMissing.length > 0 || databaseMissing.length > 0;
  if (preflightBlocked) {
    out('RESULT: BLOCKED — nothing was submitted and no provider was contacted.');
    return 1;
  }
  if (!flag('confirm-live')) {
    out('Preflight is ready. This run will spend real provider money and mutate the mission workspace.');
    out('To proceed, re-run with --confirm-live (approval is never inferred).');
    return 5;
  }

  /* ------------------------------------------------- confirmed live path */
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  try {
    /* `migrate()` applies only the versions `schema_migrations` does not
     * already hold, so this is safe against an empty database, a partially
     * migrated one and a current one alike. It replaced a sentinel that asked
     * whether one column of the then-last migration existed: adding migration
     * 022 made that sentinel report "already migrated" for a database at 021,
     * which would have skipped the new column entirely on the one path that
     * spends money. */
    await new TransactionalWonderlandDatabase(pool).migrate();

    /* A malformed credential map must refuse with a COMPOSED message: the
     * JSON parser's own error quotes a slice of the input, and the input is a
     * credential map. (Independent review finding F4.) */
    let scopedEntries: Record<string, string>;
    try { scopedEntries = JSON.parse(env.JULIUS_SCOPED_CREDENTIALS as string) as Record<string, string>; } catch {
      out('RESULT: BLOCKED — JULIUS_SCOPED_CREDENTIALS is not valid JSON. Its content is never echoed; fix the value and re-run.');
      return 1;
    }
    const scoped = new Map(Object.entries(scopedEntries)) as ReadonlyMap<ExecutorOperation, string>;
    if (!scoped.get('execute')) {
      out('RESULT: BLOCKED — JULIUS_SCOPED_CREDENTIALS has no "execute" credential. Its content is never echoed; fix the value and re-run.');
      return 1;
    }
    const trustedReceiptKeys = new Map<string, KeyObject>([[
      env.EXECUTOR_KEY_ID as string,
      createPublicKey(readFileSync(env.JULIUS_PUBLIC_KEY_PATH as string, 'utf8')),
    ]]);
    const client = new RemoteExecutorControlPlane({
      endpoint: new URL(env.JULIUS_EXECUTOR_ENDPOINT as string),
      serviceCredential: scoped.get('execute') as string,
      scopedCredentials: scoped,
      callerId: env.JULIUS_CALLER_ID as string,
      tenantId: contract.tenantId,
      requestTimeoutMs: Number(env.JULIUS_REQUEST_TIMEOUT_MS ?? '600000'),
      trustedReceiptKeys,
      allowInsecureLoopbackForTests: env.JULIUS_EXECUTOR_ALLOW_LOOPBACK === '1',
    });

    const baseStore = createJuliusPostgresRuntimeStore(pool);
    const handoffs = createContextAndClaimHandoffs(baseStore);
    const executionId = `execution:julius-live:${contract.missionId}`;
    const shell = createExecutorShellPort({
      pool,
      tools: new JuliusToolPostgresRepository(pool),
      settlement: new JuliusToolSettlementPostgresRepository(pool),
      client,
      claims: handoffs.claims,
      tenantId: contract.tenantId,
      callerId: env.JULIUS_CALLER_ID as string,
      policyRevision: cardRevision,
      executionId,
      workspaceSourceRef: contract.workspacePath,
    });
    const resolution = resolveLiveWorkers({
      env, projectId: contract.projectId, workspacePath: contract.workspacePath,
      testCommand: contract.testCommand, contexts: handoffs.contexts, artifacts, shell,
    });
    if (!resolution.ok) {
      for (const problem of resolution.problems) out(`BLOCKED ${problem.role}: ${problem.missing.join(', ')}`);
      return 1;
    }

    const request = compileBootstrapRequest(contract, resolution.entries.map((entry) => ({
      role: entry.worker.role as JuliusBootstrapRequest['workers'][number]['role'],
      integrationId: entry.worker.workerId,
      adapterId: entry.worker.adapterId,
      independenceGroup: entry.worker.providerId,
      requiredCapabilities: entry.worker.capabilities,
    })), cardRevision);

    const bootstrap = createLiveJuliusBootstrapPort({
      runs: new JuliusPostgresRepository(pool),
      seeds: createPostgresMissionSeedStore(pool),
      tenantId: contract.tenantId,
      executionId,
    });
    const submitted = await bootstrap.submit(request);
    if (!submitted.accepted) {
      out(`RESULT: BLOCKED at bootstrap — ${submitted.reasonCode}: ${submitted.safeMessage}`);
      return 1;
    }
    out(`Run ${submitted.runId} accepted in state ${submitted.state}; driving the Julius run loop.`);

    const runtime = assembleLiveJuliusRuntime({
      store: handoffs.store,
      entries: resolution.entries,
      cardRevision,
      spendCeilingUsdMicros: Math.round((contract.limits?.spendUsd ?? 5) * 1_000_000),
      maxRepairRounds: contract.limits?.repairCycles ?? 1,
    });
    const outcome = await driveJuliusRunToTerminal({
      loop: runtime.loop, store: handoffs.store,
      runId: submitted.runId, projectId: contract.projectId,
      maxTicks: Number(option('max-ticks') ?? '32'),
    });

    const tasks = await handoffs.store.tasksForRun(submitted.runId, contract.projectId);
    const evidence = await handoffs.store.evidenceForRun(submitted.runId, contract.projectId);
    const findings = await handoffs.store.findingsForRun(submitted.runId, contract.projectId);
    const decisions = await handoffs.store.decisionsForRun(submitted.runId, contract.projectId);
    out(`RESULT: ${outcome.state}${outcome.stalled ? ' (stalled before terminal state)' : ''} after ${outcome.ticks} ticks`);
    if (outcome.haltCause !== null) out(`  cause: ${outcome.haltCause}`);
    out(`  run: ${submitted.runId}`);
    for (const task of tasks) out(`  task ${task.taskId} [${task.role}/${task.taskType}] → ${task.state}`);
    for (const item of evidence) out(`  evidence ${item.evidenceId} [${item.type}/${item.status}] ${item.safeSummary}`);
    for (const finding of findings) out(`  finding ${finding.findingId} blocking=${finding.blocking} status=${finding.status} — ${finding.claim}`);
    out(`  verification decisions: ${decisions.map((decision) => decision.action).join(', ') || 'none'}`);
    return outcome.state === 'COMPLETED' ? 0 : 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/* The esbuild bundle runs this file directly; import.meta is unavailable in
 * the bridge tsconfig, so the entry check is on `require.main`. */
if (typeof require !== 'undefined' && require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stdout.write(`JULIUS LIVE MISSION crashed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}\n`);
      process.exitCode = 1;
    },
  );
}
