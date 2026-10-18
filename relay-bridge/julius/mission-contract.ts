import { createHash } from 'node:crypto';

import { JULIUS_BOOTSTRAP_REQUEST_VERSION, type JuliusBootstrapRequest } from '../../src/relay/integration/julius/julius-port';
import {
  JULIUS_LEARNING_REGISTRATION_DIGEST,
  juliusLearningPolicyRefusal,
  sealJuliusResearchPolicy,
  type JuliusLearningDimension,
  type JuliusLearningRegistration,
  type JuliusResearchPolicy,
} from '../../src/relay/mission/julius';

/**
 * THE MISSION CONTRACT — its shape, its parser, its sealing, its compilation.
 *
 * ONE DEFINITION, TWO CALLERS. The mission job reads a contract file from disk
 * and the bridge's `POST /julius/missions` reads one off the wire, and both
 * arrive here: the same fields required, the same refusals in the same words,
 * the same `compileBootstrapRequest` deriving the same idempotency key from the
 * same content. A mission created over HTTP and one read from disk are
 * therefore the same mission, and a client cannot drift from the file format
 * because there is no second format to drift to.
 *
 * WHY NOT THE JOB FILE. This code lived in `julius-live-mission.ts`, which is an
 * ENTRYPOINT: it runs `main` when `require.main === module`. Inside the HTTP
 * server's CJS bundle that test is true for the bundle itself, so importing the
 * parser from the job made the server print the job's usage line at startup.
 * A library must not carry an entry guard; this file carries none.
 *
 * NO NODE BEYOND `createHash`, no clock beyond `compiledAt`, no store, no
 * network: parsing and compiling a contract are pure enough to prove without a
 * database, and the route's tests do.
 */

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
  /**
   * ONE ARM OF A REGISTERED LEARNING PAIR (E9-a). ABSENT IS TODAY'S MISSION,
   * BYTE FOR BYTE: the same request, the same digest, the same run.
   *
   * Present, it does two things and nothing else:
   *   - the run takes an identity of its OWN through the explicit-rerun path
   *     (`rerunIntent: 'EXPLICIT'` and this arm's `rerunKey`). Both arms run
   *     one contract, and a run's id is that contract's digest, so without it
   *     arm WITH would carry arm WITHOUT's run id and be served as its
   *     idempotent replay: one run, and no pair (MATCHED_PAIR_PREREG §6);
   *   - at the run's terminal state the live mission records the arm through
   *     the Learning Loop (`recordJuliusLearningOutcome`), against the policy
   *     declared here before anything ran.
   *
   * IT IS NOT PART OF THE MISSION'S BINDING (`compileBootstrapRequest`), so the
   * two arms are provably one objective: the pairing requires it, and an
   * arm-specific field inside the digest would make every pair unmatched.
   */
  readonly learningPair?: LiveMissionLearningPairClause;
}

/**
 * THE CONTRACT'S WORDS FOR ONE ARM, after strict parsing.
 *
 * `registrationDigest` is the sha256 of the frozen pair registration, the
 * same on both arms. `rerunKey` is this arm's own token: one token, one run,
 * however often the job is retried. `withoutRunId` is REQUIRED of arm WITH,
 * which compares against that run, and REFUSED on arm WITHOUT, which has
 * nothing to compare against. `policy` is the gate's, declared in advance.
 */
export interface LiveMissionLearningPairClause extends JuliusLearningRegistration {
  readonly rerunKey: string;
}

const LEARNING_PAIR_FIELDS: readonly string[] = ['registrationDigest', 'arm', 'rerunKey', 'withoutRunId', 'policy'];
/** A token, bounded, with no space or line break: it is folded into a run identity and printed. */
const LEARNING_RERUN_KEY = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u;
/** The run id `createLiveJuliusBootstrapPort` mints: `run:` and 24 hex characters. */
const BOOTSTRAP_RUN_ID = /^run:[0-9a-f]{24}$/u;

/**
 * EVERY FIELD VALIDATED, AND NOTHING ELSE ACCEPTED. A field this build does not
 * read would be a term of the experiment nobody enforces, so an unknown one is
 * refused rather than carried. The clause is rebuilt from what was checked, so
 * nothing unchecked reaches the request or the record.
 */
function parseLearningPairClause(value: unknown): { ok: true; clause: LiveMissionLearningPairClause } | { ok: false; reason: string } {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reason: 'learning_pair_not_an_object' };
  const clause = value as Record<string, unknown>;
  if (Object.keys(clause).some((key) => !LEARNING_PAIR_FIELDS.includes(key))) return { ok: false, reason: 'learning_pair_field_unknown' };
  const { registrationDigest, arm, rerunKey, withoutRunId, policy } = clause;
  if (typeof registrationDigest !== 'string' || !JULIUS_LEARNING_REGISTRATION_DIGEST.test(registrationDigest)) {
    return { ok: false, reason: 'learning_pair_registration_digest_invalid' };
  }
  if (arm !== 'WITHOUT' && arm !== 'WITH') return { ok: false, reason: 'learning_pair_arm_invalid' };
  if (typeof rerunKey !== 'string' || !LEARNING_RERUN_KEY.test(rerunKey)) return { ok: false, reason: 'learning_pair_rerun_key_invalid' };
  if (arm === 'WITH' && (typeof withoutRunId !== 'string' || !BOOTSTRAP_RUN_ID.test(withoutRunId))) {
    return { ok: false, reason: 'learning_pair_without_run_required' };
  }
  if (arm === 'WITHOUT' && withoutRunId !== undefined) return { ok: false, reason: 'learning_pair_without_run_forbidden' };
  const policyRefusal = juliusLearningPolicyRefusal(policy);
  if (policyRefusal !== null) return { ok: false, reason: policyRefusal };
  const declared = policy as { dimensions: JuliusLearningDimension[]; minimumRelativeImprovement: number; minimumImprovedDimensions: number };
  return {
    ok: true,
    clause: {
      registrationDigest, arm, rerunKey,
      ...(arm === 'WITH' ? { withoutRunId: withoutRunId as string } : {}),
      policy: {
        dimensions: [...declared.dimensions],
        minimumRelativeImprovement: declared.minimumRelativeImprovement,
        minimumImprovedDimensions: declared.minimumImprovedDimensions,
      },
    },
  };
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

export function parseLiveMissionContract(raw: string): { ok: true; contract: LiveMissionContractFile } | { ok: false; problem: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, problem: 'The contract file is not valid JSON.' }; }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, problem: 'The contract must be a JSON object.' };
  const value = parsed as Record<string, unknown>;
  for (const field of ['missionId', 'markerNamespace', 'projectId', 'tenantId', 'objective', 'workspacePath'] as const) {
    if (typeof value[field] !== 'string' || (value[field] as string).trim() === '') {
      return { ok: false, problem: `The contract field "${field}" must be a non-empty string.` };
    }
  }
  /**
   * `testCommand` MUST BE PRESENT AND MAY BE EMPTY. Present, so that leaving it
   * out is still a malformed contract rather than a silent decision; empty, so a
   * mission with no deterministic check — a report, an analysis, a plan — can say
   * so deliberately. An empty command runs nothing and records no TEST evidence;
   * the build is then held to the diff it produced. See `compileBootstrapRequest`.
   */
  if (typeof value.testCommand !== 'string') {
    return { ok: false, problem: 'The contract field "testCommand" must be a string — empty when the mission declares no deterministic check.' };
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

  /* THE LEARNING-PAIR CLAUSE, LIKE THE RESEARCH CLAUSE, IS REFUSED HERE OR NOT
     AT ALL: a malformed registration found after the arm has run would be a
     paid run that measures nothing. */
  let learningPair: LiveMissionLearningPairClause | undefined;
  if (value.learningPair !== undefined) {
    const parsedPair = parseLearningPairClause(value.learningPair);
    if (!parsedPair.ok) return { ok: false, problem: `The contract's learningPair clause was refused: ${parsedPair.reason}.` };
    learningPair = parsedPair.clause;
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
      ...(learningPair === undefined ? {} : { learningPair }),
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
  /**
   * THE LEARNING-PAIR CLAUSE IS OUTSIDE THE BINDING, ALL OF IT.
   *
   * The binding digest is the mission's identity and, as `missionBindingDigest`,
   * the objective digest the Learning Loop pairs two arms on. The clause's arm,
   * rerun key and WITHOUT run id differ between the arms by definition, so any
   * of them inside the digest would make every pair unmatched. Its registration
   * digest and policy are the same on both arms, and they stay out as well: they
   * describe the EXPERIMENT, not the mission, so an arm and a plain run of the
   * same contract are also one objective. The arms are told apart by the rerun
   * key instead, which is what the explicit-rerun path exists for.
   *
   * With no clause the destructuring removes nothing, so the digest, the
   * idempotency key and the request are exactly what they were before it.
   */
  const { learningPair, ...mission } = contract;
  const bindingDigest = digestOf(mission);
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
    // Read off the contract, never inferred from the objective's prose.
    deterministicCheck: { declared: contract.testCommand.trim() !== '' },
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
    // ONE ARM, ONE RUN: the arm's own key folded into the identity (`createLiveJuliusBootstrapPort`).
    ...(learningPair === undefined ? {} : { rerunIntent: 'EXPLICIT' as const, rerunKey: learningPair.rerunKey }),
  };
}
