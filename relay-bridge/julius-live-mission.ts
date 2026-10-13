/**
 * THE SUPPORTED LIVE JULIUS MISSION ENTRYPOINT — the one production path from
 * a Mission Contract file to a durable, provider-live Julius run.
 *
 *   node dist-relay-bridge/julius-live-mission.cjs run --contract <file> [--confirm-live]
 *   node dist-relay-bridge/julius-live-mission.cjs observe-research --contract <file>
 *
 * `observe-research` starts no run, opens no database and contacts no model
 * provider. It makes the one observation `run` refuses to invent — whether a
 * backend is seen serving the research the contract grants — through Relay's
 * own bounded fetch, and prints it in the form `run` reads. See
 * `observeResearchCommand` below.
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

import {
  CLAUDE_SUBSCRIPTION_TOKEN_ENV, claudeAuthLine, claudeAuthSourceLine, decideClaudeAuth,
  resolveClaudeAuthMode, type ClaudeAuthProvenance,
} from './hosted-coding-agent/hosted-auth';
import { HOSTED_API_KEY_ENV } from './hosted-coding-agent/hosted-readiness';
import { hostedChildEnv, hostedChildEnvKeys } from './hosted-coding-agent/hosted-envelope';
// The login is observed with the executable the Agent SDK will run, in the
// environment `hostedChildEnv` composes for it — not with the operator's `claude`
// on PATH in this process's environment, which a GitHub runner does not have.
import { observeCoderLogin, resolveCoderClaudeExecutable } from './hosted-coding-agent/hosted-login-probe';
import { readFileSync } from 'node:fs';
import { createPublicKey, type KeyObject } from 'node:crypto';
import { Pool } from 'pg';
import { JULIUS_RUNTIME_DATABASE_ENV_NAMES, juliusRuntimeDatabaseUrl } from '../src/relay/persistence/julius-test-database';
import { TransactionalWonderlandDatabase } from '../src/relay/persistence/wonderland-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { JuliusToolPostgresRepository } from '../src/relay/persistence/julius-tool-postgres';
import { JuliusToolSettlementPostgresRepository } from '../src/relay/persistence/julius-tool-settlement-postgres';
import { RemoteExecutorControlPlane } from '../src/relay/workspace/julius-tools/remote-executor-control-plane';
import type { ExecutorOperation } from '../src/relay/workspace/julius-tools/executor-operation-request';
import { type JuliusBootstrapRequest } from '../src/relay/integration/julius/julius-port';
import {
  compileBootstrapRequest,
  parseLiveMissionContract,
  sealLiveMissionResearchPolicy,
  type LiveMissionContractFile,
  type LiveMissionResearchClause,
} from './julius/mission-contract';
import { createLiveJuliusBootstrapPort } from './julius/bootstrap';
import { createPostgresMissionKnowledgeStore } from './julius/mission-knowledge';
import { createPostgresMissionSeedStore } from './julius/mission-seed';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';
import { createExecutorShellPort } from './julius/executor-effects';
import { createDurableArtifactExchange, juliusReviewerBillingPath, type JuliusArtifactExchange } from './julius/live-workers';
import { createJuliusDurableArtifacts, juliusWorkArtifactRoot } from './julius/durable-artifacts';
import { LocalJuliusArtifactStore } from '../src/relay/workspace/julius-tools/local-artifact-store';
import { JuliusWorkArtifactPostgresRepository } from '../src/relay/persistence/julius-work-artifact-postgres';
import { liveEvidenceLines } from './julius/live-evidence-lines';
import {
  liveClaudeAuthRefusedLine, liveExecutionScopeLine, liveLearningFailedLine, liveOneLine, liveResearchLines, liveTickAccountLine,
  liveTickBudgetLine, liveWorkersBlockedLines, liveStageDeadlineLine,
} from './julius/live-report-lines';
import {
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  liveTickBudgetFor, liveStageDeadline, liveRunAttemptRefusal, JULIUS_LIVE_RATE_LIMIT_BACKOFF,
  recordJuliusLearningOutcome,
  resolveLiveWorkers,
} from './julius/live-composition';
import { JOB_BUDGET_MS } from './reviewer-deadline';

/**
 * WHEN THE JOB'S WALL CLOCK RUNS OUT, as far as this process can know it: the
 * moment the workflow recorded at its dispatch-input gate, plus the job budget
 * the workflow's own timeout mirrors. The gate runs a few tens of seconds after
 * the job starts, so the real deadline is that much EARLIER than printed.
 * UNKNOWN when the moment was not recorded. Printed as recorded; what the
 * drive ENFORCES is `liveStageDeadline`, derived from it (audit F3).
 */
function wallClockDeadline(env: Record<string, string | undefined>): string {
  const started = Date.parse(env.JULIUS_JOB_STARTED_AT ?? '');
  return Number.isFinite(started) ? new Date(started + JOB_BUDGET_MS).toISOString() : 'UNKNOWN';
}

/**
 * AN OPERATOR MAY TIGHTEN THE TICK ALLOWANCE, NEVER LOOSEN IT. `derived` or
 * absent means the allowance Julius counts from the mission's own structure.
 * Anything else must be a positive whole number, and the drive applies it as
 * a minimum with that allowance.
 */
function tickOverrideOf(value: string | null): { readonly ok: true; readonly override: number | undefined } | { readonly ok: false } {
  if (value === null || value === 'derived') return { ok: true, override: undefined };
  if (!/^[1-9][0-9]{0,5}$/u.test(value)) return { ok: false };
  return { ok: true, override: Number(value) };
}
import { noJuliusResearch, type JuliusResearchPolicy } from '../src/relay/mission/julius';
import {
  LIVE_REACH_ACTION_CAPABILITIES,
  LIVE_REACH_READ_CAPABILITIES,
  allSources,
  resolveReadiness,
  type BackendProbe,
  type LiveReachCapability,
  type LiveReachReadiness,
  type LiveReachSource,
  backendCandidates,
} from '../src/relay/mission/live-reach';
import { probeReachability, type LiveFetchRequest } from '../src/relay/connectors/live-reach/live-fetch';

/* ------------------------------------------------------------- contract */

/**
 * THE CONTRACT IS A LIBRARY NOW, NOT A PARAGRAPH OF THIS ENTRYPOINT.
 *
 * `./julius/mission-contract` holds the contract file's shape, its parser, the
 * research-clause sealing and the bootstrap-request compiler. They moved out of
 * this file the day a second caller needed them: the bridge's
 * `POST /julius/missions`. That caller runs inside the HTTP server's bundle,
 * and this file's entry guard is `require.main === module` — which, in a CJS
 * bundle, is TRUE for the bundle. Importing the parser from here would have run
 * this job's `main` at server start (it did: the bundled server printed this
 * job's usage line). A library that is also an entrypoint is a library that
 * runs when it is read.
 *
 * Re-exported here so every existing importer — the tests, the scripts, the
 * first live mission's checks — keeps its path.
 */
export {
  compileBootstrapRequest,
  parseLiveMissionContract,
  sealLiveMissionResearchPolicy,
  type LiveMissionContractFile,
  type LiveMissionResearchClause,
};

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

/**
 * WHETHER A STORE CAN SERVE ITS OWN LEDGER.
 *
 * Both consumers of the per-slot money ledger — allocation v3 and the research
 * mediator's durable meter — are bound only when the store carries a `timeline`
 * reader, and silently fall back when it does not. A paid run must never start
 * on that fallback, so the entrypoint asks this of the store in preflight and
 * again of the store the runtime will receive.
 */
/**
 * THE EXECUTION ATTEMPT THIS PROCESS IS, as Julius names peer requests under it.
 *
 * A live mission's run id is derived from its contract, so qualification
 * attempts 1-3 all ran as the same run id. Peer requests named from the run
 * alone would then collide wherever two attempts are read together — the
 * paid-run archive, a receipt, a Project Brain import. GitHub's run id and
 * attempt separate them; a process with neither is a local drill and says so.
 * Digits only, so nothing an environment carries can reach an id but a number.
 */
export function liveExecutionScope(env: Record<string, string | undefined>): string {
  const runId = env.GITHUB_RUN_ID ?? '';
  const attempt = env.GITHUB_RUN_ATTEMPT ?? '';
  return /^[0-9]{1,20}$/u.test(runId) && /^[0-9]{1,4}$/u.test(attempt) ? `gh-${runId}.${attempt}` : 'local';
}

export function liveLedgerState(store: unknown): 'BOUND' | 'UNBOUND' {
  return store !== null && typeof store === 'object' && typeof (store as { timeline?: unknown }).timeline === 'function'
    ? 'BOUND' : 'UNBOUND';
}

/**
 * HOW EACH ROLE WILL BE PAID FOR, answered before anything runs.
 *
 * The founder's accounting requirement is that the record can tell an API bill
 * from a subscription for every role, so the preflight states all three:
 *   - the Prompt Architect is API-billed BY CONSTRUCTION: the live architect
 *     cannot exist without its OpenAI key;
 *   - the Coding Agent is whatever the auth decision above resolved, which is
 *     `null` here when that decision failed (and the preflight is then blocked
 *     for its own reason);
 *   - the Independent Reviewer is the OPERATOR'S DECLARATION,
 *     `RELAY_HERMES_BILLING_MODE`, because nothing Julius observes can tell what
 *     credential sits in Hermes's profile.
 *
 * AN UNDECLARED REVIEWER BLOCKS A PAID RUN. Its settlements would carry no
 * billing path, and the owner would read UNKNOWN for a role whose money is real
 * — decided in advance, by omission. Declared but unrecognised is NOT blocked:
 * it reads UNKNOWN on this line, where the operator sees it, because refusing a
 * legitimate word the attestation also knows (`portal`) would be wrong.
 */
export function liveBillingPaths(input: {
  readonly coder: ClaudeAuthProvenance | null;
  readonly reviewerDeclaration: string | undefined;
}): { readonly line: string; readonly blocked: string | null } {
  const coder = input.coder === null ? 'UNDECIDED'
    : input.coder.authentication === 'CLAUDE_SUBSCRIPTION' ? 'SUBSCRIPTION' : 'API_BILLED';
  const reviewer = juliusReviewerBillingPath(input.reviewerDeclaration);
  return {
    line: `billing paths: architect=API_BILLED coder=${coder} reviewer=${reviewer ?? 'UNDECLARED'}`,
    blocked: reviewer === null
      ? 'RELAY_HERMES_BILLING_MODE is not declared, so the Independent Reviewer\'s settlements could not say how they were paid for'
      : null,
  };
}

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

/* ------------------------------------------------------------ environment */

const EXECUTOR_ENV = ['JULIUS_EXECUTOR_ENDPOINT', 'JULIUS_SCOPED_CREDENTIALS', 'EXECUTOR_KEY_ID', 'JULIUS_PUBLIC_KEY_PATH', 'JULIUS_CALLER_ID'] as const;

/**
 * ONE ROW PER NAME, AND EACH ROW IS ITS OWN LINE.
 *
 * Returned as rows, never joined. `out` escapes every line break
 * (`liveOneLine`), so one call holding eleven rows printed ONE physical line.
 * Every reader of these rows is line-anchored:
 *  - the paid workflow's preflight grep (`^  NAME: SET$`);
 *  - the local launcher's;
 *  - the artifact allowlist.
 * They all found nothing, so the preflight step failed closed on the first
 * name (JUJU's review of ef0c09c3, F1).
 */
function presence(env: Record<string, string | undefined>, names: readonly string[]): readonly string[] {
  return names.map((name) => `  ${name}: ${env[name] ? 'SET' : 'MISSING'}`);
}

/* --------------------------------------------------- research observation */

/**
 * THE VOCABULARY A RESEARCH OBSERVATION MAY REPORT — `probeReachability`'s own,
 * and nothing wider.
 *
 * Only `observed` becomes a claim. The other four are printed so an operator
 * reads WHY a host was not observed, and none of them is ever rounded up: a
 * throttled host answered, but it did not serve, and a claim built from it
 * would be the operator vouching for a read nobody saw succeed.
 */
export const RESEARCH_OBSERVATION_RESULTS = ['observed', 'unreachable', 'throttled', 'unauthenticated', 'unconfigured'] as const;
export type ResearchObservationResult = (typeof RESEARCH_OBSERVATION_RESULTS)[number];

export interface ResearchObservationRow {
  readonly source: string;
  readonly capability: string;
  readonly host: string;
  /** The backend that would serve this read, or `none` when the registry has no candidate. */
  readonly backendId: string;
  readonly result: ResearchObservationResult;
}

/**
 * INJECTED SO THE WHOLE PATH IS TESTABLE WITHOUT A NETWORK, and absent in
 * production on purpose: absent means the real `fetch`, and no resolver —
 * which is exactly how the live composition's research retrieval is built
 * (`createLiveReachService` with neither). An observation made through a
 * DIFFERENT network path from the one that will serve the retrieval would be an
 * observation of something else.
 */
export interface ResearchObservationDeps {
  readonly fetchImpl?: typeof fetch;
  readonly resolver?: LiveFetchRequest['resolver'];
  readonly timeoutMs?: number;
}

/**
 * PROBE EVERY (source, capability, host) THE ALLOWANCES NAME, AND SAY WHAT WAS SEEN.
 *
 * WHY A REAL PROBE AND NOT A DECLARATION. Live Reach refuses a capability no
 * backend has been OBSERVED serving, and the paid workflow never set
 * `JULIUS_RESEARCH_OBSERVED_BACKENDS` — so a mission granted research would
 * have run with every ask refused `capability_unavailable` and still been
 * able to complete, proving the opposite of what it was dispatched to show.
 * Hard-coding the variable in the workflow would repair the symptom by making
 * the claim a bare assertion again. This makes the claim EARNED: one
 * side-effect-free GET per host, through `probeReachability` — the same
 * `liveFetch`, network policy, redirect checks and content-type rule the
 * retrieval itself will use.
 *
 * THE BACKEND IS THE REGISTRY'S ANSWER, not this file's: `backendCandidates`,
 * preferred first, the same choice `LiveReachService.probe` makes. A source
 * the registry has no candidate for is reported `none` and never probed —
 * there is nothing the probe could be a probe OF.
 *
 * NEVER AN ACTION. The sealed policy already refuses an action capability, and
 * this function is still handed raw allowances by its tests, so it refuses one
 * again at the only place a request could be made: reported, not probed, never
 * claimed. A probe that could post is not a probe.
 *
 * A WILDCARD HOST IS A PATTERN, NOT AN ADDRESS. `*.python.org` names no host a
 * GET could reach, and inventing one (`www.`? the apex, which the policy says
 * the pattern does not even include?) would observe a host the contract did
 * not name. It is reported `unconfigured` — an operator who wants it observed
 * names an exact host — and never probed.
 *
 * UNKNOWN IS NOT ZERO, AND AN EXCEPTION IS NOT AN ANSWER. `liveFetch` turns a
 * failed request into `unreachable` itself, but a throw from anywhere else on
 * the path (a resolver, a body read) would otherwise escape as a crash — or,
 * worse, be caught by a caller that defaults the row to something. It is
 * `unreachable` here, and only a returned `observed` counts.
 */
export async function observeResearchAllowances(
  allowances: LiveMissionResearchClause['allowances'],
  deps: ResearchObservationDeps = {},
): Promise<{ readonly rows: readonly ResearchObservationRow[]; readonly pairs: readonly string[] }> {
  const rows: ResearchObservationRow[] = [];
  const pairs: string[] = [];
  const probed = new Set<string>();

  for (const allowance of allowances) {
    for (const capability of allowance.capabilities) {
      for (const host of allowance.hosts) {
        // The same triple twice is one observation, not two GETs of one page.
        const key = `${allowance.source}\u0000${capability}\u0000${host}`;
        if (probed.has(key)) continue;
        probed.add(key);

        const row = (backendId: string, result: ResearchObservationResult): void => {
          rows.push({ source: allowance.source, capability, host, backendId, result });
        };

        if (!(LIVE_REACH_READ_CAPABILITIES as readonly string[]).includes(capability)) {
          // An action capability, or a word that is no capability at all.
          row('none', 'unconfigured');
          continue;
        }
        const candidates = backendCandidates(allowance.source as LiveReachSource, capability as LiveReachCapability);
        const backendId = candidates[0]?.backendId ?? 'none';
        if (candidates.length === 0 || host.startsWith('*.')) {
          row(backendId, 'unconfigured');
          continue;
        }

        let result: ResearchObservationResult;
        try {
          result = await probeReachability({
            url: `https://${host}/`,
            ...(deps.fetchImpl === undefined ? {} : { fetchImpl: deps.fetchImpl }),
            ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
            ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
          });
        } catch {
          result = 'unreachable';
        }
        // A value outside the vocabulary is not a sixth answer; it is no answer.
        if (!(RESEARCH_OBSERVATION_RESULTS as readonly string[]).includes(result)) result = 'unreachable';
        row(backendId, result);

        const pair = `${backendId}:${capability}`;
        if (result === 'observed' && !pairs.includes(pair)) pairs.push(pair);
      }
    }
  }
  return { rows, pairs };
}

/** The machine line `run` reads back, and the only one the workflow exports. */
export const RESEARCH_OBSERVED_ENV_PREFIX = 'JULIUS_RESEARCH_OBSERVED_BACKENDS=';
export const RESEARCH_NOT_GRANTED_LINE = 'research_not_granted: the contract has no research clause, so there is nothing to observe.';

/**
 * `observe-research --contract <file>` — THE OPERATOR'S OBSERVATION, MADE BY RELAY.
 *
 * The contract says what a mission may read; this says whether Relay was just
 * seen able to read it. The two stay separate facts — the contract is not
 * consulted about reachability, only about WHICH hosts to look at — and the
 * output is the environment line an operator would otherwise have typed.
 *
 * THE CONTRACT IS READ BY `parseLiveMissionContract` AND SEALED BY
 * `sealLiveMissionResearchPolicy`, the exact pair `run` uses, so this cannot
 * observe a clause `run` would have refused or normalised differently.
 *
 * FAILS CLOSED. A contract granting research of which NOTHING was observed
 * exits 1: a mission whose every research ask will be refused must not be
 * dispatched and allowed to "complete" without it. PARTIAL observation exits 0
 * — a contract may legitimately authorise more than Relay can reach, and Live
 * Reach refuses the unreachable part honestly at request time — but every
 * unobserved host is printed, so nobody mistakes partial for whole.
 *
 * Prints no response body and no header: a row is five closed-vocabulary
 * fields. The claim line is checked against `observedResearchBackends` before
 * it is printed, so a line this command emits is a line `run` accepts.
 *
 * Exit: 0 observed (or no research granted), 1 unobservable, 2 usage / an
 * unreadable or refused contract.
 */
export async function observeResearchCommand(input: {
  readonly contractPath: string | null;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly readFile?: (path: string) => string;
} & ResearchObservationDeps): Promise<number> {
  const { out, err } = input;
  if (input.contractPath === null) {
    out('Usage: julius-live-mission observe-research --contract <mission.json>');
    return 2;
  }
  let raw: string;
  try {
    raw = (input.readFile ?? ((path: string) => readFileSync(path, 'utf8')))(input.contractPath);
  } catch {
    out(`The contract file could not be read: ${input.contractPath}`);
    return 2;
  }
  const parsed = parseLiveMissionContract(raw);
  if (!parsed.ok) { out(`Mission Contract refused: ${parsed.problem}`); return 2; }
  const clause = parsed.contract.research;
  if (clause === undefined) {
    out(RESEARCH_NOT_GRANTED_LINE);
    return 0;
  }

  const policy = sealLiveMissionResearchPolicy(parsed.contract.missionId, clause);
  const { rows, pairs } = await observeResearchAllowances(policy.allowances, input);
  for (const row of rows) {
    out(`research_observation source=${row.source} capability=${row.capability} host=${row.host} backend=${row.backendId} result=${row.result}`);
  }
  const observedRows = rows.filter((row) => row.result === 'observed').length;
  out(`research_observation_summary observed=${String(observedRows)} of=${String(rows.length)}`);

  if (pairs.length === 0) {
    err(`research_unobservable: no backend was observed serving any of the ${String(rows.length)} research probe(s) the contract grants; refusing to dispatch a mission whose research would all be refused.`);
    return 1;
  }

  const line = `${RESEARCH_OBSERVED_ENV_PREFIX}${pairs.join(',')}`;
  const readBack = observedResearchBackends({ JULIUS_RESEARCH_OBSERVED_BACKENDS: line.slice(RESEARCH_OBSERVED_ENV_PREFIX.length) });
  if (!readBack.ok || readBack.probes.length !== pairs.length) {
    // Unreachable while the registry and the parser agree — and if they ever
    // stop agreeing, the mission must not be armed with a claim `run` refuses.
    err(`research_observation_inconsistent: ${readBack.ok ? 'the claim did not read back whole' : readBack.problem}`);
    return 1;
  }
  out(line);
  return 0;
}

/* ------------------------------------------------------------------ main */

async function main(argv: readonly string[]): Promise<number> {
  // ONE PHYSICAL LINE PER LINE: text Julius did not write can carry a line break (`liveOneLine`).
  const out = (line: string): void => { process.stdout.write(`${liveOneLine(line)}\n`); };
  const flag = (name: string): boolean => argv.includes(`--${name}`);
  const option = (name: string): string | null => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : null;
  };

  /* A SECOND COMMAND, NOT A LOOSER FIRST ONE. `observe-research` is matched
   * exactly and returns before anything below exists; `run`'s own check is
   * untouched, so every argv that reached `run` before still does, and every
   * one it refused is still refused with the same line. */
  if (argv[0] === 'observe-research') {
    return observeResearchCommand({
      contractPath: option('contract'),
      out,
      err: (line) => { process.stderr.write(`${liveOneLine(line)}\n`); },
    });
  }
  if (argv[0] !== 'run' || option('contract') === null) {
    out('Usage: julius-live-mission run --contract <mission.json> [--confirm-live] [--max-ticks N]');
    return 2;
  }
  let rawContract: string;
  try { rawContract = readFileSync(option('contract') as string, 'utf8'); } catch {
    out(`The contract file could not be read: ${option('contract')}`);
    return 2;
  }
  const tickOverride = tickOverrideOf(option('max-ticks'));
  if (!tickOverride.ok) { out(`max_ticks_invalid: '${option('max-ticks') ?? ''}' is neither "derived" nor a positive whole number`); return 2; }
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
  // THE JOB'S OWN LAUNCH ENVIRONMENT names the database: `JULIUS_DATABASE_URL`
  // first, `DATABASE_URL` after it. Never a test variable — the real-PostgreSQL
  // suites read `JULIUS_TEST_DATABASE_URL` precisely so that this process and
  // those suites can never be pointed at the same place by accident.
  const databaseUrl = juliusRuntimeDatabaseUrl(env);
  const databaseMissing = databaseUrl === null ? [...JULIUS_RUNTIME_DATABASE_ENV_NAMES] : [];

  /**
   * THE PREFLIGHT HAS NO ARTIFACT STORE, AND SAYS SO RATHER THAN HAVING ONE.
   *
   * It resolves workers to report every problem in one pass and dispatches
   * nothing — `snapshotFor` returns null, so `requireSnapshot` refuses before
   * any adapter reaches the exchange. That was already true and was kept true
   * by nothing. An exchange that throws makes it structural: if a preflight
   * ever did reach a body, it would fail loudly here instead of quietly
   * reading or writing one outside a run.
   */
  const artifacts: JuliusArtifactExchange = {
    put: () => { throw new Error('julius_preflight_stores_no_artifacts'); },
    get: () => { throw new Error('julius_preflight_reads_no_artifacts'); },
  };
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
  for (const row of presence(env, ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', CLAUDE_SUBSCRIPTION_TOKEN_ENV, 'XAI_API_KEY', ...JULIUS_RUNTIME_DATABASE_ENV_NAMES, ...EXECUTOR_ENV])) out(row);
  out('  note: the local Hermes reviewer bills through the hermes profile of this operator account; XAI_API_KEY presence is reported for the record.');

  /**
   * WHICH CREDENTIAL THE CODING AGENT WOULD USE, ANSWERED BEFORE ANYTHING RUNS.
   *
   * The founder's Max subscription can authenticate the Coding Agent, which removes
   * the need for a separately funded Anthropic API balance during founder-operated
   * qualification. That is a billing change and NOT a provider change: the Coding
   * Agent is still Anthropic, still the Claude Agent SDK, and every model and
   * latency column keeps its meaning.
   *
   * THE AUTHORITY HERE IS THE COMPOSED CHILD ENVIRONMENT, not a CLI probe. Measured
   * on 2026-09-28: with a fake key in an otherwise minimal child environment,
   * `claude auth status --json` still reported `authMethod: "claude.ai"` and
   * `apiProvider: "firstParty"`, and only `subscriptionType` changed. So asking the
   * CLI whether a key is in play would answer SUBSCRIPTION with the key present.
   * `hostedChildEnv` builds the child from `{}`, so what it omits is absent by
   * construction, and that is what is checked.
   *
   * A login is consulted only for what it does know: whether a first-party
   * subscription path exists. Since 2026-09-29 it is observed IN THE CHILD'S OWN
   * ENVIRONMENT with the SDK's own executable (`observeCoderLogin`), so a
   * `claude setup-token` token in `CLAUDE_CODE_OAUTH_TOKEN` — the only way the
   * subscription reaches a GitHub runner — is seen exactly as the child will see
   * it. It returns a class and a coarse plan label and never a credential.
   */
  const authMode = resolveClaudeAuthMode(env);
  /**
   * A FAILED AUTH DECISION BLOCKS, whatever the composition said. This printed
   * "BLOCKED CLAUDE AUTH" and then left the verdict to `preflight.problems`, which
   * knows nothing about a login: subscription mode with NO login observed resolved
   * every role, and the preflight answered ready. The Coding Agent would then have
   * failed at dispatch — after the architect had been paid.
   */
  let coderProvenance: ClaudeAuthProvenance | null = null;
  let claudeAuthBlocked = false;
  if (!authMode.ok) {
    out(liveClaudeAuthRefusedLine(authMode));
    claudeAuthBlocked = true;
  } else {
    // THE CHILD'S OWN ENVIRONMENT, composed by the same function and from the same
    // sources the runner uses (PATH, HOME, the token, the requested model), so the
    // names decided over and the environment observed are the ones the Coding Agent
    // will get.
    const subscriptionChild = authMode.mode === 'CLAUDE_SUBSCRIPTION'
      ? hostedChildEnv({
        apiKey: '', path: env.PATH, home: env.HOME, mode: 'CLAUDE_SUBSCRIPTION',
        oauthToken: env[CLAUDE_SUBSCRIPTION_TOKEN_ENV],
        model: preflight.requested.codingModel,
      })
      : null;
    const observed = subscriptionChild === null
      ? undefined
      : observeCoderLogin({ executable: resolveCoderClaudeExecutable(env), childEnv: subscriptionChild });
    const decision = decideClaudeAuth({
      mode: authMode.mode,
      apiKeyProvided: (env[HOSTED_API_KEY_ENV] ?? '') !== '' && authMode.mode === 'ANTHROPIC_API',
      childEnvNames: subscriptionChild === null ? [...hostedChildEnvKeys(authMode.mode)] : Object.keys(subscriptionChild),
      ...(observed === undefined ? {} : {
        login: {
          loggedIn: observed.loggedIn,
          sourceClass: observed.sourceClass,
          subscriptionLabel: observed.subscriptionLabel,
        },
      }),
    });
    if (decision.ok) {
      coderProvenance = decision.provenance;
      out(`  ${claudeAuthLine(decision.provenance)}`);
      out(`  ${claudeAuthSourceLine(decision.provenance)}`);
      if (!decision.provenance.apiCostApplicable) {
        out('  note: no Anthropic API billing event exists for a subscription-backed Coding Agent, so its API cost is NOT APPLICABLE rather than zero. Subscription usage is never reported as $0.00 of API spend.');
      }
    } else {
      // FAIL CLOSED, and loudly: a run that wanted the subscription and would have
      // used a key must not proceed quietly on the key.
      out(`  BLOCKED CLAUDE AUTH: ${decision.refusal} — ${decision.because}`);
      claudeAuthBlocked = true;
    }
  }
  const billing = liveBillingPaths({ coder: coderProvenance, reviewerDeclaration: env.RELAY_HERMES_BILLING_MODE });
  out(`  ${billing.line}`);
  if (billing.blocked !== null) out(`  BLOCKED billing: ${billing.blocked}`);
  // The preflight composes with no executor shell, so the Coding Agent ALWAYS lists
  // one as missing; that entry is reported by the executor line below. Anything ELSE
  // the Coding Agent is missing is printed — this used to drop the whole entry, so a
  // key configured beside a subscription request blocked with no reason on the page.
  for (const problem of preflight.problems) {
    const missing = problem.role === 'CODING_AGENT'
      ? problem.missing.filter((name) => !name.startsWith('executor shell'))
      : problem.missing;
    if (problem.role === 'CODING_AGENT' && missing.length === 0) continue;
    out(`  BLOCKED ${problem.role}: ${problem.reason} — ${missing.join(', ')}`);
  }
  if (executorMissing.length > 0) out(`  BLOCKED executor: missing ${executorMissing.join(', ')}`);
  if (databaseMissing.length > 0) out(`  BLOCKED durable store: set ${databaseMissing.join(' or ')}`);

  /**
   * THE LIVE LEDGER, OR NO PAID RUN.
   *
   * Paid run 34739303313 spent its whole mission at 30¢ per dispatch: the live
   * store exposed no `timeline`, the composition bound none, allocation v3 fell
   * back to `ESTIMATE_NO_LEDGER`, and the Coding Agent was stopped by its own
   * $0.30 ceiling after two turns. Nothing said so until the bundle was read.
   * A paid mission allocated against a flat estimate is not a full-capability
   * run, so the store this entrypoint will use is asked HERE, before anything is
   * submitted, whether it can serve its own ledger — and the answer is printed,
   * so the workflow's preflight step can require it.
   *
   * No query is made: the check is whether the composed store carries the
   * reader both consumers are gated on, not whether the database is reachable.
   */
  const ledger = databaseMissing.length > 0 ? 'UNKNOWN' : liveLedgerState(createJuliusPostgresRuntimeStore(new Pool({ connectionString: databaseUrl! })));
  out(`  live_ledger: ${ledger}`);
  if (ledger === 'UNBOUND') out('  BLOCKED allocation: the live store serves no timeline, so every dispatch would be allocated a flat estimate');

  const preflightBlocked = preflight.problems.some((entry) => entry.role !== 'CODING_AGENT')
    || preflight.problems.some((entry) => entry.role === 'CODING_AGENT' && entry.missing.some((name) => !name.startsWith('executor shell')))
    || executorMissing.length > 0 || databaseMissing.length > 0 || ledger === 'UNBOUND'
    || claudeAuthBlocked || billing.blocked !== null;
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
  const pool = new Pool({ connectionString: databaseUrl! });
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
    // THE SAME QUESTION ON THE STORE THE RUNTIME WILL ACTUALLY RECEIVE, after the
    // handoff wrapper: a wrapper that dropped the reader would reintroduce the
    // flat-estimate fallback past a preflight that passed. Refused before any
    // run is created and before any provider can be reached.
    if (liveLedgerState(handoffs.store) !== 'BOUND') {
      out('RESULT: BLOCKED — live_ledger_unbound: the composed store serves no timeline, so allocation would fall back to a flat estimate. Nothing was submitted and no provider was contacted.');
      return 1;
    }
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
    /**
     * THE SEALED RESEARCH POLICY, ONCE, FOR BOTH OF ITS READERS. The workers are
     * told what it authorises and the mediator decides every ask against it, so
     * the sentence and the decision come from one function. With no clause both
     * see `noJuliusResearch`, which is what the composition defaults to anyway.
     */
    const researchClause = contract.research;
    const researchPolicyOf = (missionId: string): JuliusResearchPolicy => (researchClause === undefined
      ? noJuliusResearch(missionId)
      : sealLiveMissionResearchPolicy(missionId, researchClause));
    /**
     * WHERE THIS MISSION'S BODIES ACTUALLY GO.
     *
     * #285 landed the durable home and wired nothing to it; this is the
     * wiring. The record of which attempt wrote what goes to PostgreSQL
     * beside every other durable mission fact; the BYTES go to the same
     * content-addressed store the tool path already uses, which hashes on
     * write and re-hashes on read.
     *
     * THE ROOT, AND WHAT IT HONESTLY BUYS. `JULIUS_WORK_ARTIFACT_ROOT` when
     * the operator mounts durable storage; otherwise a per-mission directory
     * under the system temp root. That survives a PROCESS restart on this
     * host, which is the restart the reviewer-absent failure was about, and
     * it does NOT survive a host that is torn down — a fresh CI runner starts
     * with nothing. It is stated rather than implied, and the operator can
     * make it durable without a code change.
     *
     * NOT the workspace: bodies written under the workspace would appear in
     * the coder's own `git diff` and become part of the change under review.
     */
    const liveArtifacts = createDurableArtifactExchange({
      projectId: contract.projectId,
      artifacts: createJuliusDurableArtifacts({
        // An empty value is the default, and a relative one is refused here,
        // before anything is dispatched (`juliusWorkArtifactRoot`).
        content: new LocalJuliusArtifactStore(juliusWorkArtifactRoot(env.JULIUS_WORK_ARTIFACT_ROOT, contract.missionId)),
        records: new JuliusWorkArtifactPostgresRepository(pool),
        tenancy: { tenantId: contract.tenantId },
      }),
    });
    const resolution = resolveLiveWorkers({
      env, projectId: contract.projectId, workspacePath: contract.workspacePath,
      testCommand: contract.testCommand, contexts: handoffs.contexts, artifacts: liveArtifacts, shell,
      architectMaxOutputTokens: contract.limits?.architectMaxOutputTokens,
      researchPolicyFor: researchPolicyOf,
    });
    if (!resolution.ok) {
      // Each role's problem, then the outcome: an artifact never says nothing (`liveWorkersBlockedLines`).
      for (const line of liveWorkersBlockedLines(resolution.problems)) out(line);
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
      // What earlier runs of this mission verified, inherited by this run's planner.
      knowledge: createPostgresMissionKnowledgeStore(pool),
      /*
       * A REGISTERED ARM WITH INHERITS FROM ITS OWN ARM WITHOUT, OR IT DOES NOT START (founder ruling
       * 2026-10-04, R2). The source is pinned to the WITHOUT run the registration names, and an empty or
       * failed carry refuses the bootstrap before the run is READY: the RESULT line says
       * `carried_knowledge_required`, the `knowledge.carried` event says why, and no provider is paid for
       * an experiment about inherited knowledge that inherited nothing. Every other mission is unchanged.
       */
      ...(contract.learningPair?.arm === 'WITH' && contract.learningPair.withoutRunId !== undefined
        ? { carry: { required: true, fromRunIds: [contract.learningPair.withoutRunId] } }
        : {}),
      tenantId: contract.tenantId,
      executionId,
    });
    const submitted = await bootstrap.submit(request);
    if (!submitted.accepted) {
      out(`RESULT: BLOCKED at bootstrap — ${submitted.reasonCode}: ${submitted.safeMessage}`);
      return 1;
    }
    out(`Run ${submitted.runId} accepted in state ${submitted.state}; driving the Julius run loop.`);
    /* A RE-RUN STOPS HERE, before any provider can be reached (audit F4): the bootstrap above wrote only to this job's
       disposable database, and the drive below is the first thing that can spend. */
    const rerunRefusal = liveRunAttemptRefusal(env);
    if (rerunRefusal !== null) {
      out(`RESULT: BLOCKED — ${rerunRefusal}`);
      out(`  run: ${submitted.runId}`);
      return 1;
    }

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
    const runtime = assembleLiveJuliusRuntime({
      store: handoffs.store,
      entries: resolution.entries,
      cardRevision,
      spendCeilingUsdMicros: Math.round((contract.limits?.spendUsd ?? 5) * 1_000_000),
      maxRepairRounds: contract.limits?.repairCycles ?? 1,
      executionScope: liveExecutionScope(env),
      ...(researchClause === undefined ? {} : {
        researchPolicyFor: researchPolicyOf,
        researchProbes: observed.probes,
      }),
    });
    /* WHAT THE CLAUSE CAN ACTUALLY REACH, said before the money is spent
       rather than discovered one refusal at a time in the evidence. */
    for (const line of liveResearchLines(researchClause === undefined ? null : {
      roles: [...researchClause.roles], allowances: researchClause.allowances.length,
      observedBackends: observed.probes.length, reach: researchReachSummary(researchClause, observed.probes),
    })) out(line);
    /* THE ALLOWANCE, SAID BEFORE THE FIRST DISPATCH: counted from this run's
       seeded units and the verification policy it was assembled with, so the
       evidence shows what the mission was permitted before it shows what it
       used. Qualification attempt 4 stopped at a ceiling of 32 fixed for a
       six-task graph, with the run still inside every bound its contract set. */
    const tickBudget = await liveTickBudgetFor({
      store: handoffs.store, runId: submitted.runId, projectId: contract.projectId, verification: runtime.verification,
    });
    out(liveTickBudgetLine(tickBudget, tickOverride.override));
    out(`  wall clock deadline: ${wallClockDeadline(env)}`);
    /* THE DEADLINE IS ENFORCED NOW, NOT ONLY PRINTED (audit F3): no stage starts once a stage could no longer finish
       with the steps after LIVE still inside the job's limit. The run then ends FAILED (job_deadline_reached, Julius
       code TIMEOUT) through its ordinary path, so its learning record below is written and the evidence steps run. */
    const stageDeadline = liveStageDeadline({ jobStartedAt: env.JULIUS_JOB_STARTED_AT, workers: resolution.entries.map((entry) => entry.worker) });
    out(liveStageDeadlineLine(stageDeadline));
    out(liveExecutionScopeLine(liveExecutionScope(env)));
    const outcome = await driveJuliusRunToTerminal({
      loop: runtime.loop, store: handoffs.store,
      runId: submitted.runId, projectId: contract.projectId,
      verification: runtime.verification,
      ...(tickOverride.override === undefined ? {} : { maxTicks: tickOverride.override }),
      ...(stageDeadline === null ? {} : { deadline: stageDeadline }),
      retryBackoff: JULIUS_LIVE_RATE_LIMIT_BACKOFF,
    });

    /*
     * THE LEARNING LOOP, CALLED BY THE RUNTIME (E9-a), and only for a contract that registers an arm
     * of a matched pair. Every other mission runs exactly as it did. The arm is measured off its own
     * durable trajectory and recorded as ONE ledger event; arm WITH is also compared with arm WITHOUT
     * from this same store and gated under the policy the contract declared, and a PROMOTE is recorded
     * as a proposal and nothing more (`recordJuliusLearningOutcome`).
     *
     * BEFORE THE RESULT, so the `  run:` line stays directly under it (F10). A record that could not be
     * made is said here and FAILS THE JOB: an arm of a registered pair whose measurement never reached
     * the ledger is not a usable arm, and exit 0 would let it be counted as one.
     */
    let learningUnrecorded = false;
    if (contract.learningPair !== undefined) {
      try {
        const learning = await recordJuliusLearningOutcome({
          store: handoffs.store, runId: submitted.runId, projectId: contract.projectId,
          registration: contract.learningPair, objectiveDigest: request.missionBindingDigest,
          roles: resolution.entries.map((entry) => entry.worker.role),
        });
        for (const line of learning.lines) out(line);
      } catch (error) {
        learningUnrecorded = true;
        out(liveLearningFailedLine(error));
      }
    }

    const tasks = await handoffs.store.tasksForRun(submitted.runId, contract.projectId);
    const evidence = await handoffs.store.evidenceForRun(submitted.runId, contract.projectId);
    const findings = await handoffs.store.findingsForRun(submitted.runId, contract.projectId);
    const decisions = await handoffs.store.decisionsForRun(submitted.runId, contract.projectId);
    /*
     * THE RUN IS NAMED DIRECTLY UNDER ITS RESULT, then the details (JUJU's review of ef0c09c3, F10).
     * The gate credits a RESULT only to a `  run:` line at most three lines below it. With the cause
     * and the tick account in between, `run:` sat in the last slot, and one more kept line would have
     * left the RESULT unattributed, which the gate reads as no answer. Directly under the RESULT, no
     * detail line can push it out of the window.
     */
    out(`RESULT: ${outcome.state}${outcome.stalled ? ' (stalled before terminal state)' : ''} after ${outcome.ticks} ticks`);
    out(`  run: ${submitted.runId}`);
    if (outcome.haltCause !== null) out(`  cause: ${outcome.haltCause}`);
    if (outcome.tickAccount !== null) out(liveTickAccountLine(outcome.tickAccount));
    for (const task of tasks) out(`  task ${task.taskId} [${task.role}/${task.taskType}] → ${task.state}`);
    // A row from an attempt the decision did not read is labelled, not hidden (`liveEvidenceLines`).
    for (const line of liveEvidenceLines(evidence, tasks)) out(line);
    for (const finding of findings) out(`  finding ${finding.findingId} blocking=${finding.blocking} status=${finding.status} — ${finding.claim}`);
    out(`  verification decisions: ${decisions.map((decision) => decision.action).join(', ') || 'none'}`);
    return outcome.state === 'COMPLETED' && !learningUnrecorded ? 0 : 1;
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
      process.stdout.write(`${liveOneLine(`JULIUS LIVE MISSION crashed: ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`)}\n`);
      process.exitCode = 1;
    },
  );
}
