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
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
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
import { sealJuliusResearchPolicy, type JuliusResearchPolicy } from '../src/relay/mission/julius';
import {
  LIVE_REACH_ACTION_CAPABILITIES,
  LIVE_REACH_READ_CAPABILITIES,
  allSources,
  resolveReadiness,
  type BackendProbe,
  type LiveReachCapability,
  type LiveReachReadiness,
  type LiveReachSource,
} from '../src/relay/mission/live-reach';

/* ------------------------------------------------------------- contract */

export interface LiveMissionContractFile {
  readonly missionId: string;
  /**
   * THE DURABLE ACCOUNTING NAMESPACE FOR THIS CONTRACT.
   *
   * Paid attempt markers are GitHub artifacts counted by name, and the first
   * live mission owned those names outright — so a second contract would have
   * counted the first one's history as its own, been told a paid mission had
   * already completed, and demanded the rerun acknowledgement for a mission
   * that had never run. The reverse is worse: a second mission's completion
   * would have satisfied the first mission's guard.
   *
   * DECLARED, NOT DERIVED. A slug computed from `missionId` would silently
   * collide the moment two ids normalise the same way, and the failure mode is
   * one contract's paid history answering for another's. The contract states
   * it, the parser refuses a contract without one, and the first live mission
   * keeps `julius-first-live` so its completed history stays exactly where it
   * is.
   */
  readonly markerNamespace: string;
  readonly projectId: string;
  readonly tenantId: string;
  readonly objective: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  readonly acceptanceCriteria: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly testCommand: string;
  readonly workspacePath: string;
  readonly limits?: {
    readonly spendUsd?: number;
    readonly repairCycles?: number;
    /**
     * The architect's output ceiling for THIS mission. Governed like the other
     * two: declared in the contract, bounded by the reservation the run budget
     * already makes, and refused by `julius-live-contract-check.mjs` otherwise.
     */
    readonly architectMaxOutputTokens?: number;
  };
  /**
   * THE MISSION'S RESEARCH AUTHORITY, SEALED BY THE CONTRACT THAT GRANTS IT.
   *
   * ABSENT MEANS NO RESEARCH, and absent is the default. Without this clause a
   * mission gets `noJuliusResearch` — allowlist empty, no slot authorised,
   * retrieval budget zero — and a research ask from any worker is refused as
   * `research_not_authorized` before a socket can exist. That was the state of
   * EVERY paid mission before this field existed: the governed-research seam
   * reached `assembleLiveJuliusRuntime` and stopped there, because this
   * entrypoint had nothing to pass it.
   *
   * WHAT THIS IS NOT. It does not assert that Relay can reach anything. A
   * mission saying it may read `docs.python.org` and Relay having a backend
   * observed to serve that read are separate facts, and Live Reach refuses a
   * capability no backend has been OBSERVED serving whatever this says. That
   * observation is an operator's to make, not a contract's, so it arrives
   * through the environment instead (see `JULIUS_RESEARCH_OBSERVED_BACKENDS`).
   * A contract that authorised its own observation would be the mission
   * asserting the one thing it is not in a position to know.
   */
  readonly research?: LiveMissionResearchClause;
}

/**
 * The contract's own words for a research policy, before sealing.
 *
 * Deliberately the SHAPE `sealJuliusResearchPolicy` takes and no more: the
 * domain owns what a valid policy is — host syntax, wildcard rules, budget
 * bounds, the closed role and capability vocabularies — and this is a JSON
 * spelling of its draft. Re-validating any of it here would be a second
 * opinion about the allowlist, which is exactly the sort of thing an allowlist
 * must not have.
 */
export interface LiveMissionResearchClause {
  readonly roles: readonly string[];
  readonly allowances: readonly {
    readonly source: string;
    readonly capabilities: readonly string[];
    readonly hosts: readonly string[];
  }[];
  readonly missionBudget: { readonly maxRetrievals: number; readonly maxBytes?: number | null };
  readonly roleBudget: { readonly maxRetrievals: number; readonly maxBytes?: number | null };
}

/**
 * THE CONTRACT'S WORDS, SEALED BY THE DOMAIN. One place, so the parser and the
 * dispatch cannot seal the same clause two ways.
 */
export function sealLiveMissionResearchPolicy(
  missionId: string,
  clause: LiveMissionResearchClause,
): JuliusResearchPolicy {
  return sealJuliusResearchPolicy({
    missionId,
    // Cast, not validate: the domain refuses an unknown source, capability or
    // role by name, and a check here would be a second opinion about a closed
    // vocabulary it owns.
    allowances: clause.allowances as never,
    roles: clause.roles as never,
    missionBudget: { maxRetrievals: clause.missionBudget.maxRetrievals, maxBytes: clause.missionBudget.maxBytes ?? null },
    roleBudget: { maxRetrievals: clause.roleBudget.maxRetrievals, maxBytes: clause.roleBudget.maxBytes ?? null },
  });
}

/**
 * WHAT AN OPERATOR HAS SEEN A BACKEND SERVE — never what a mission wants.
 *
 * Live Reach refuses a capability no backend has been OBSERVED serving, and
 * that gate is right: "this mission authorises reading a page" and "Relay has a
 * backend that can read a page" are separate facts. The first is the
 * contract's to state; the second is an observation, and a contract asserting
 * its own observation would be the mission vouching for the one thing it
 * cannot know.
 *
 * So it arrives through the environment, as a compact `backendId:capability`
 * list, and ABSENT MEANS NONE — every governed retrieval is then refused
 * `capability_unavailable`, which is the state every paid mission has run in
 * so far and the honest default.
 *
 * EVERY CLAIM IS CHECKED AGAINST THE REGISTRY, and a claim that fails refuses
 * the run rather than being dropped. `resolveReadiness` consults a probe only
 * when the backend id and the capability both match a real candidate, so a
 * typo does not produce a weaker observation — it produces NO observation, and
 * the mission then runs with research silently inert while the operator
 * believes they armed it. Refusing is the only way that mistake is visible
 * before the money is spent.
 */
export type ObservedResearchBackends =
  | { readonly ok: true; readonly probes: readonly BackendProbe[] }
  | { readonly ok: false; readonly problem: string };

/** Every backend the registry models, by id, with what it implements. */
const registryBackends = (): ReadonlyMap<string, readonly LiveReachCapability[]> => {
  const byId = new Map<string, readonly LiveReachCapability[]>();
  for (const source of allSources()) {
    for (const backend of source.backends) {
      // A backend may serve several sources; its operations are its own.
      if (!byId.has(backend.backendId)) byId.set(backend.backendId, backend.operations);
    }
  }
  return byId;
};

export function observedResearchBackends(
  env: Record<string, string | undefined>,
): ObservedResearchBackends {
  const raw = env.JULIUS_RESEARCH_OBSERVED_BACKENDS?.trim();
  if (raw === undefined || raw === '') return { ok: true, probes: [] };

  const backends = registryBackends();
  const probes: BackendProbe[] = [];
  const seen = new Set<string>();

  for (const entry of raw.split(',')) {
    const claim = entry.trim();
    if (claim === '') continue;
    const parts = claim.split(':');
    if (parts.length !== 2 || parts[0].trim() === '' || parts[1].trim() === '') {
      return { ok: false, problem: `research_observation_malformed: "${claim}" is not backendId:capability.` };
    }
    const backendId = parts[0].trim();
    const capability = parts[1].trim();

    if ((LIVE_REACH_ACTION_CAPABILITIES as readonly string[]).includes(capability)) {
      // Research is looking. An operator vouching for Relay's ability to POST
      // is asserting something true or false, but it is not a research
      // observation and nothing on this path would ever consult it.
      return { ok: false, problem: `research_observation_action_capability: "${capability}" is an action, not a read.` };
    }
    if (!(LIVE_REACH_READ_CAPABILITIES as readonly string[]).includes(capability)) {
      return { ok: false, problem: `research_observation_capability_unknown: "${capability}".` };
    }

    const operations = backends.get(backendId);
    if (operations === undefined) {
      return { ok: false, problem: `research_observation_backend_unknown: "${backendId}" is in no Live Reach source.` };
    }
    if (!operations.includes(capability as LiveReachCapability)) {
      // The registry says this backend does not implement it, so the probe
      // could never be the one `resolveReadiness` consults. An operator
      // asserting it has seen an operation the backend does not have has seen
      // something else.
      return { ok: false, problem: `research_observation_backend_cannot: "${backendId}" does not implement "${capability}".` };
    }

    if (seen.has(claim)) {
      return { ok: false, problem: `research_observation_duplicated: "${claim}".` };
    }
    seen.add(claim);

    probes.push({
      backendId,
      capability: capability as LiveReachCapability,
      result: 'observed',
      /* NULL, NOT NOW. The operator asserts they have seen this; Relay has not
         probed it in this process, and stamping the current instant would date
         an observation nobody made here. */
      probedAt: null,
    });
  }
  return { ok: true, probes };
}

/**
 * WHICH OF THE MISSION'S OWN ALLOWANCES ANY BACKEND HAS BEEN OBSERVED TO SERVE.
 *
 * Reported, never enforced. A mission may authorise more than Relay can
 * currently reach — that is a legitimate contract, and Live Reach refuses the
 * unreachable part honestly at request time. What is NOT acceptable is an
 * operator believing a clause is live when every retrieval under it will be
 * refused, so the entrypoint prints this before the run and the reader decides.
 *
 * It asks the same question the runtime will ask, through the same function.
 */
export function researchReachSummary(
  clause: LiveMissionResearchClause,
  probes: readonly BackendProbe[],
): readonly { readonly source: string; readonly capability: string; readonly readiness: LiveReachReadiness }[] {
  const rows: { source: string; capability: string; readiness: LiveReachReadiness }[] = [];
  for (const allowance of clause.allowances) {
    for (const capability of allowance.capabilities) {
      rows.push({
        source: allowance.source,
        capability,
        readiness: resolveReadiness({
          source: allowance.source as LiveReachSource,
          capability: capability as LiveReachCapability,
          probes,
        }),
      });
    }
  }
  return rows;
}

export function parseLiveMissionContract(raw: string): { ok: true; contract: LiveMissionContractFile } | { ok: false; problem: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, problem: 'The contract file is not valid JSON.' }; }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, problem: 'The contract must be a JSON object.' };
  const value = parsed as Record<string, unknown>;
  for (const field of ['missionId', 'markerNamespace', 'projectId', 'tenantId', 'objective', 'testCommand', 'workspacePath'] as const) {
    if (typeof value[field] !== 'string' || (value[field] as string).trim() === '') {
      return { ok: false, problem: `The contract field "${field}" must be a non-empty string.` };
    }
  }
  /**
   * An artifact name, and one this repository can count. Lower-case, starts
   * with a letter, no path separators and no upper case — the alphabet GitHub
   * artifact names and `count_markers` both handle without quoting surprises.
   * Anything else is refused rather than sanitised: a namespace quietly
   * rewritten is a namespace that can collide.
   */
  if (!/^[a-z][a-z0-9-]{2,48}$/u.test(value.markerNamespace as string)) {
    return { ok: false, problem: 'The contract field "markerNamespace" must be 3-49 lower-case letters, digits or hyphens, starting with a letter.' };
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

  /**
   * THE RESEARCH CLAUSE IS SEALED HERE, OR THE CONTRACT IS REFUSED.
   *
   * Sealing at PARSE time rather than at dispatch is the whole point: a
   * malformed allowlist, an unknown role, a budget the domain will not accept
   * — every one of them stops the mission before a provider is contacted, with
   * the domain's own reason code. A policy first sealed at dispatch would be a
   * contract that looked valid right up until it had already been paid for.
   *
   * `sealJuliusResearchPolicy` throws named errors; they are caught and
   * reported rather than allowed to crash the CLI, because a bad contract is a
   * refusal with a reason, not an exception.
   */
  let research: LiveMissionResearchClause | undefined;
  if (value.research !== undefined) {
    if (value.research === null || typeof value.research !== 'object' || Array.isArray(value.research)) {
      return { ok: false, problem: 'The contract field "research" must be an object when present.' };
    }
    const clause = value.research as LiveMissionResearchClause;
    try {
      sealLiveMissionResearchPolicy(value.missionId as string, clause);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'research_policy_invalid';
      return { ok: false, problem: `The contract's research clause was refused: ${reason}.` };
    }
    research = clause;
  }

  return {
    ok: true,
    contract: {
      missionId: value.missionId as string, markerNamespace: value.markerNamespace as string,
      projectId: value.projectId as string,
      tenantId: value.tenantId as string, objective: value.objective as string,
      requirements: list('requirements'), constraints: list('constraints'),
      acceptanceCriteria: criteria as LiveMissionContractFile['acceptanceCriteria'],
      testCommand: value.testCommand as string, workspacePath: value.workspacePath as string,
      limits: typeof value.limits === 'object' && value.limits !== null ? value.limits as LiveMissionContractFile['limits'] : undefined,
      ...(research === undefined ? {} : { research }),
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

  /**
   * THE OPERATOR'S OBSERVATIONS, CHECKED BEFORE ANYTHING IS SUBMITTED.
   *
   * Read here rather than at the assembly below so a mistyped claim refuses
   * the run while there is still no run: after `bootstrap.submit` there is a
   * durable record and a state to reconcile, and refusing then would leave one
   * behind for a typo. It is validated even when the contract authorises no
   * research at all — a false belief about what Relay can reach is worth
   * correcting whether or not this mission would have used it.
   */
  const observed = observedResearchBackends(env);
  if (!observed.ok) {
    out(`JULIUS_RESEARCH_OBSERVED_BACKENDS refused: ${observed.problem}`);
    out('RESULT: BLOCKED — nothing was submitted and no provider was contacted.');
    return 2;
  }

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
    architectMaxOutputTokens: contract.limits?.architectMaxOutputTokens,
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
      architectMaxOutputTokens: contract.limits?.architectMaxOutputTokens,
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

    /**
     * TWO REPOSITORIES, ONE STORE SHAPE. Bootstrap needs the run writer AND the
     * task-contract writer; they are separate classes because they own separate
     * tables, and composing them here is what keeps `RunCreationStore` a narrow
     * port rather than a class reference.
     */
    const bootstrapRuns = new JuliusPostgresRepository(pool);
    const bootstrapContracts = new JuliusContractPostgresRepository(pool);
    const bootstrap = createLiveJuliusBootstrapPort({
      runs: {
        loadRun: bootstrapRuns.loadRun.bind(bootstrapRuns),
        createRun: bootstrapRuns.createRun.bind(bootstrapRuns),
        addTask: bootstrapRuns.addTask.bind(bootstrapRuns),
        transition: bootstrapRuns.transition.bind(bootstrapRuns),
        putTaskContract: bootstrapContracts.putTaskContract.bind(bootstrapContracts),
      },
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

    /**
     * THE TWO HALVES OF RESEARCH AUTHORITY, SUPPLIED SEPARATELY BECAUSE THEY
     * ARE SEPARATE FACTS.
     *
     * The contract says what this mission is AUTHORISED to read; the
     * environment says what an operator has OBSERVED a backend serve. Absent
     * either one, nothing is retrievable: no clause means `noJuliusResearch`,
     * and no probe means `capability_unavailable` whatever the clause says.
     * Both absent is the state every paid mission has run in so far, and it
     * stays the default.
     */
    const researchClause = contract.research;
    const runtime = assembleLiveJuliusRuntime({
      store: handoffs.store,
      entries: resolution.entries,
      cardRevision,
      spendCeilingUsdMicros: Math.round((contract.limits?.spendUsd ?? 5) * 1_000_000),
      maxRepairRounds: contract.limits?.repairCycles ?? 1,
      ...(researchClause === undefined ? {} : {
        researchPolicyFor: (missionId: string) => sealLiveMissionResearchPolicy(missionId, researchClause),
        researchProbes: observed.probes,
      }),
    });
    if (researchClause === undefined) {
      out('  research: NOT AUTHORISED (no contract clause) — every ask is refused research_not_authorized');
    } else {
      out(`  research: authorised for ${[...researchClause.roles].join(', ')} across ${researchClause.allowances.length} allowance(s); ${observed.probes.length} observed backend(s)`);
      /* WHAT THE CLAUSE CAN ACTUALLY REACH, said before the money is spent
         rather than discovered one refusal at a time in the evidence. */
      for (const row of researchReachSummary(researchClause, observed.probes)) {
        out(`    ${row.source}/${row.capability}: ${row.readiness}${row.readiness === 'ready' ? '' : ' — retrieval will be refused'}`);
      }
    }
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
