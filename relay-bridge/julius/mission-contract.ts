import { createHash } from 'node:crypto';

import { JULIUS_BOOTSTRAP_REQUEST_VERSION, type JuliusBootstrapRequest } from '../../src/relay/integration/julius/julius-port';
import { resolveWorkerRole, sealJuliusResearchPolicy, type JuliusApprovalScope, type JuliusResearchPolicy } from '../../src/relay/mission/julius';

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
   * V6 G-1: THE DISPATCHES THIS MISSION'S C.A.R.D. HOLDS FOR A PERSON.
   *
   * ABSENT MEANS UNGATED, and absent is the default: the parsed contract then
   * carries no `approvalGates` key at all, so every existing contract's parse
   * result and `missionBindingDigest` are byte-for-byte what they were.
   *
   * Present, it is SEALED at parse time like `research`: 1 or 2 gates, each a
   * `DISPATCH_WORKER` hold on named roles and task types, with a reason. The
   * entrypoint passes it to the card as `approvalScopes` (`approvalScopesOf`)
   * and binds the card revision to it (`gatedCardRevision`). Which gate a
   * mission may declare is REGISTERED per namespace in
   * `scripts/julius-approval-gates.mjs`; a contract cannot choose its own.
   */
  readonly approvalGates?: readonly LiveMissionApprovalGate[];
}

/** One gate of the `approvalGates` clause (V6 G-1). v1: `DISPATCH_WORKER` only (V6 G-2). */
export interface LiveMissionApprovalGate {
  readonly id: string;
  readonly operation: 'DISPATCH_WORKER';
  readonly roles: readonly string[];
  readonly taskTypes: readonly string[];
  readonly reason: string;
}

const APPROVAL_GATE_KEYS = ['id', 'operation', 'roles', 'taskTypes', 'reason'] as const;

/**
 * THE CLAUSE, SEALED, OR THE PROBLEM THAT REFUSES THE CONTRACT. Every refusal
 * names its problem; nothing is coerced, defaulted or dropped.
 */
function sealApprovalGates(value: unknown): { ok: true; gates: readonly LiveMissionApprovalGate[] } | { ok: false; problem: string } {
  const refuse = (problem: string) => ({ ok: false as const, problem: `The contract's approvalGates clause was refused: ${problem}.` });
  if (!Array.isArray(value)) return refuse('approvalGates must be an array of 1 or 2 gates');
  if (value.length < 1 || value.length > 2) return refuse('approvalGates must hold 1 or 2 gates');
  const ids = new Set<string>();
  const pairs = new Set<string>();
  const gates: LiveMissionApprovalGate[] = [];
  for (const [index, entry] of value.entries()) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return refuse(`gate ${index} must be an object`);
    const gate = entry as Record<string, unknown>;
    const unknown = Object.keys(gate).find((key) => !(APPROVAL_GATE_KEYS as readonly string[]).includes(key));
    if (unknown !== undefined) return refuse(`gate ${index} has an unknown key "${unknown}"`);
    if (typeof gate.id !== 'string' || !/^[a-z][a-z0-9-]{2,48}$/u.test(gate.id)) {
      return refuse(`gate ${index} id must be 3-49 lower-case letters, digits or hyphens, starting with a letter`);
    }
    if (gate.operation !== 'DISPATCH_WORKER') return refuse(`gate ${index} operation must be DISPATCH_WORKER (the only operation a v1 gate may scope)`);
    if (!Array.isArray(gate.roles) || gate.roles.length === 0) return refuse(`gate ${index} roles must be a non-empty array`);
    for (const role of gate.roles) {
      if (typeof role !== 'string' || resolveWorkerRole(role) === null) return refuse(`gate ${index} role "${String(role)}" is not a role Julius can resolve`);
    }
    if (!Array.isArray(gate.taskTypes) || gate.taskTypes.length === 0) return refuse(`gate ${index} taskTypes must be a non-empty array`);
    for (const taskType of gate.taskTypes) {
      if (typeof taskType !== 'string' || !/^[a-z][a-z0-9:_-]{0,63}$/u.test(taskType)) {
        return refuse(`gate ${index} names a wildcard or empty task type "${String(taskType)}"; a gate names exact task types`);
      }
    }
    if (typeof gate.reason !== 'string' || gate.reason.trim() === '' || gate.reason.length > 280) return refuse(`gate ${index} reason must be 1-280 characters`);
    if (ids.has(gate.id)) return refuse(`duplicate gate id "${gate.id}"`);
    ids.add(gate.id);
    for (const role of gate.roles as string[]) {
      for (const taskType of gate.taskTypes as string[]) {
        const pair = `${role}/${taskType}`;
        if (pairs.has(pair)) return refuse(`duplicate role and task type ${pair}`);
        pairs.add(pair);
      }
    }
    gates.push({
      id: gate.id, operation: 'DISPATCH_WORKER',
      roles: [...gate.roles as string[]], taskTypes: [...gate.taskTypes as string[]], reason: gate.reason,
    });
  }
  return { ok: true, gates };
}

/** The clause as the card's `approvalScopes` (V6 G-2): operation, roles and task types, nothing else. */
export function approvalScopesOf(gates: readonly LiveMissionApprovalGate[]): JuliusApprovalScope[] {
  return gates.map((gate) => ({ operation: gate.operation, roles: [...gate.roles], taskTypes: [...gate.taskTypes] }));
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

  let approvalGates: readonly LiveMissionApprovalGate[] | undefined;
  if (value.approvalGates !== undefined) {
    const sealed = sealApprovalGates(value.approvalGates);
    if (!sealed.ok) return { ok: false, problem: sealed.problem };
    approvalGates = sealed.gates;
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
      // Spread ONLY when present: an ungated contract parses to exactly the object (and digest) it always did.
      ...(approvalGates === undefined ? {} : { approvalGates }),
    },
  };
}

const stable = (value: unknown): string => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
const digestOf = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex');

/**
 * V6 G-1: THE CARD REVISION A GATED MISSION RUNS UNDER. The base revision, plus
 * `:gate-` and the first 16 hex of the clause's stable digest, so an approval
 * (keyed by revision, `juliusDispatchApprovalId`) given under one gate never
 * authorises a dispatch under another, and the run's `card_revision` names the
 * gate it ran under. Stable under key order; the characters stay in `[\w:.-]`.
 * Ungated: the base, untouched.
 */
export function gatedCardRevision(base: string, gates: readonly LiveMissionApprovalGate[] | undefined): string {
  return gates === undefined ? base : `${base}:gate-${digestOf(gates).slice(0, 16)}`;
}

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
  };
}
