/**
 * THE TASK/SPRINT CONTRACT — what a worker was actually asked to do, fixed in
 * writing before it starts and identical for the worker and its reviewer.
 *
 * WHY THIS EXISTS. Julius already has a Mission Contract (the mission's own
 * revision and binding digest) and a per-worker context packet compiled from
 * the Project Brain. What it did NOT have is the artefact in between: a
 * statement of THIS task's objective, scope, acceptance criteria, permitted
 * files, budget and stopping condition, agreed before implementation and
 * handed unchanged to whoever reviews it.
 *
 * Without one, the Independent Reviewer grades an implementation against prose
 * it inferred from a plan document, and Julius has no way to prove the coder
 * and the reviewer were even looking at the same requirements. Paid run
 * 34037313976 is the evidence: six blocking findings were raised against a
 * plan for lacking a diff, and nothing in the durable record could show what
 * the plan had actually been charged with producing. #234 fixed the rubric
 * (`julius-review-stage.ts`); this fixes the SUBJECT the rubric is applied to.
 *
 * THE CYCLE, and who owns each step:
 *
 *   Prompt Architect DRAFTS       → a proposal, no authority
 *   Evaluator CHALLENGES          → a verdict, no authority
 *   Prompt Architect REVISES      → a new revision, no authority
 *   Evaluator ACCEPTS             → a verdict, still no authority
 *   JULIUS LOCKS                  → the only step that changes what binds
 *
 * The evaluator is deliberately not the orchestrator. It answers one question —
 * is this contract adequate — and Julius decides what happens next. An
 * `ACCEPT` verdict is an input to {@link lockJuliusTaskContract}, not a lock.
 *
 * WHAT A WORKER MAY NOT CHANGE. A revision is a worker's proposal, so the
 * fields that carry MISSION authority are refused rather than merged: the run,
 * the task, the mission contract revision it was cut from, the criterion ids,
 * and the money. A worker that could rewrite its own acceptance criteria could
 * pass any review by lowering the bar, and a worker that could raise its own
 * ceiling could spend the mission's money on itself. See
 * {@link JULIUS_CONTRACT_MISSION_OWNED_FIELDS}.
 *
 * THE BINDING IS THE POINT. `contractRevision` plus `bindingDigest` is what
 * every downstream record carries: the coder's dispatch, the reviewer's
 * dispatch, each context snapshot, each handoff. Two records naming the same
 * pair were compiled from the same agreement — that is checkable rather than
 * assumed — and a record naming an older pair is STALE by construction, not by
 * a timestamp comparison.
 *
 * NO NODE, NO CLOCK, NO NETWORK beyond `node:crypto`, which this directory
 * already depends on (`julius-context-snapshot.ts`). Time arrives as an
 * injected ISO string, exactly as it does everywhere else under `mission/`.
 */

import { createHash } from 'node:crypto';
import type { JuliusEvidence } from './julius-runtime';
import type { JuliusReviewStage } from './julius-review-stage';

/**
 * The compiler version, carried in the digest. Changing how a contract is
 * canonicalised must change every digest, or two different agreements could
 * hash to the same value across a deploy.
 */
export const JULIUS_TASK_CONTRACT_VERSION = 'julius-task-contract.v1' as const;

/**
 * THE LIFECYCLE, and why `SUPERSEDED` is a state rather than a deletion.
 *
 * A locked contract that is later revised does not vanish: work was dispatched
 * under it and evidence was recorded against it, so the record has to survive
 * to explain what that work was asked to do. `SUPERSEDED` is that survival.
 */
export const JULIUS_TASK_CONTRACT_STATES = ['DRAFT', 'CHALLENGED', 'LOCKED', 'SUPERSEDED'] as const;
export type JuliusTaskContractState = typeof JULIUS_TASK_CONTRACT_STATES[number];

/** A blocking criterion. `criterionId` is minted by Julius and a worker may not change it. */
export interface JuliusContractCriterion {
  readonly criterionId: string;
  readonly statement: string;
  /** How this criterion is proven. An empty list is refused: a criterion nothing can prove is prose. */
  readonly requiredEvidenceTypes: readonly JuliusEvidence['type'][];
}

/**
 * THE MONEY, stated in the contract the reviewer also reads.
 *
 * `ceilingUsdMicros` is the mission's grant for this task, not a suggestion:
 * `julius-allocation-runtime.ts` derives the per-dispatch share from the run
 * budget and this is the task-level statement of it. It is mission-owned.
 */
export interface JuliusTaskContractBudget {
  readonly ceilingUsdMicros: number;
  readonly maxRepairRounds: number;
}

/**
 * WHAT EVERY DOWNSTREAM RECORD CARRIES.
 *
 * Small on purpose: a dispatch, a context snapshot and a handoff each embed
 * this and nothing else of the contract, so "were these compiled from the same
 * agreement" is one equality rather than a diff of two documents.
 */
export interface JuliusTaskContractBinding {
  readonly contractId: string;
  readonly taskId: string;
  readonly contractRevision: number;
  readonly bindingDigest: string;
}

/**
 * THE CONTRACT ITSELF.
 *
 * Every field is required. There is no partial contract: a missing scope or a
 * missing stopping condition is the thing that made the old prose plans
 * unreviewable, and defaulting one would be inventing an agreement nobody made.
 * Empty arrays are permitted ONLY where emptiness is a real answer — nothing is
 * out of scope, no action is prohibited — and refused where it is not, such as
 * acceptance criteria.
 */
export interface JuliusTaskContract {
  readonly contractId: string;
  readonly runId: string;
  /** The SUBJECT task this contract governs — the implementation, not the review of it. */
  readonly taskId: string;
  /** The mission contract revision this was cut from. Mission-owned. */
  readonly missionContractRevision: number;
  /** Monotonic from 1. A new revision is a new agreement, never an edit of the old one. */
  readonly contractRevision: number;
  readonly objective: string;
  /** What this worker is responsible for, and by implication what it is not. */
  readonly responsibilityBoundary: string;
  readonly requiredInputs: readonly string[];
  readonly expectedOutputs: readonly string[];
  readonly inScope: readonly string[];
  readonly outOfScope: readonly string[];
  /** Blocking. A contract with none cannot be reviewed against anything. Mission-owned ids. */
  readonly blockingAcceptanceCriteria: readonly JuliusContractCriterion[];
  readonly requiredEvidence: readonly JuliusEvidence['type'][];
  /** Exact commands, where the task has them. Empty is honest for a planning task. */
  readonly requiredChecks: readonly string[];
  /** Files or globs this task may write. Empty means "nothing", which is refused for an implementation. */
  readonly permittedPaths: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly dependencyTaskIds: readonly string[];
  /** What the Independent Reviewer is asked, IN ADDITION to the stage rubric. */
  readonly reviewCriteria: readonly string[];
  readonly failureConditions: readonly string[];
  readonly repairRules: readonly string[];
  readonly budget: JuliusTaskContractBudget;
  /** When the worker must stop, whether or not it succeeded. */
  readonly stoppingCondition: string;
  readonly state: JuliusTaskContractState;
  /**
   * Set when the contract is LOCKED, and only then. A digest on a DRAFT would
   * be a binding nobody had agreed to, and downstream records would be able to
   * cite it.
   */
  readonly bindingDigest: string | null;
  /** The ISO instant of the lock, injected. `null` until locked. */
  readonly lockedAt: string | null;
  /** The evaluator whose ACCEPT the lock consumed. `null` until locked. */
  readonly lockedByEvaluatorId: string | null;
}

/**
 * THE FIELDS A WORKER MAY NOT REWRITE.
 *
 * Julius owns the mission; the workers own their proposals. These five are
 * where those two meet, and each is here because a worker able to change it
 * could satisfy its own review:
 *
 *   runId / taskId              — a contract for a different task is not a revision
 *   missionContractRevision     — re-basing onto another mission revision is Julius's decision
 *   blockingAcceptanceCriteria  — criterion IDS, so the bar cannot be removed or renamed
 *   budget                      — a worker cannot raise its own ceiling or its own repair rounds
 *
 * The criteria's TEXT is deliberately not frozen: an architect clarifying what
 * a criterion means is the entire point of the challenge cycle. What is frozen
 * is the SET of ids, so no criterion can be dropped or invented.
 */
export const JULIUS_CONTRACT_MISSION_OWNED_FIELDS = Object.freeze([
  'runId', 'taskId', 'missionContractRevision', 'criterionIds', 'budget',
] as const);

/* ------------------------------------------------------------ canonical form */

/**
 * DETERMINISTIC CANONICALISATION.
 *
 * Object keys are sorted at every depth so two structurally equal contracts
 * hash equal regardless of construction order. Arrays keep their order, because
 * the order of acceptance criteria and of required checks is meaningful.
 *
 * `undefined` is refused rather than dropped: `JSON.stringify` silently omits
 * an undefined value, so a field that went missing and a field that was never
 * there would produce the same digest, and a contract could lose a constraint
 * without changing its binding.
 */
function canonicalise(value: unknown, path: string): string {
  if (value === undefined) throw new Error(`julius_contract_canonical_undefined:${path}`);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    // NaN and ±Infinity stringify as `null`, which would make an unusable
    // budget hash identically to an absent one.
    if (!Number.isFinite(value)) throw new Error(`julius_contract_canonical_non_finite:${path}`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item, index) => canonicalise(item, `${path}[${index}]`)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalise(item, `${path}.${key}`)}`).join(',')}}`;
  }
  throw new Error(`julius_contract_canonical_unsupported:${path}`);
}

/**
 * THE BINDING DIGEST — over the AGREEMENT, and nothing else.
 *
 * Excluded on purpose, each for the same reason: it would make the digest
 * change without the agreement changing, and then two records compiled from
 * one agreement would disagree.
 *
 *   state                 a DRAFT and the LOCKED contract it becomes are the same agreement
 *   bindingDigest         a value cannot contain its own hash
 *   lockedAt              wall-clock, and a re-lock after recovery would move it
 *   lockedByEvaluatorId   who accepted is provenance, not terms
 *
 * INCLUDED on purpose: `contractRevision`, so revision 2 can never collide with
 * revision 1 even if a challenge round changed nothing, and the compiler
 * version, so a change to this function invalidates every prior digest.
 */
export function juliusTaskContractBindingDigest(contract: JuliusTaskContract): string {
  const {
    state: _state, bindingDigest: _digest, lockedAt: _lockedAt, lockedByEvaluatorId: _evaluator,
    ...terms
  } = contract;
  return `sha256:${createHash('sha256')
    .update(canonicalise({ version: JULIUS_TASK_CONTRACT_VERSION, terms }, '$'))
    .digest('hex')}`;
}

/* ---------------------------------------------------------------- validation */

export interface JuliusTaskContractValidation {
  readonly valid: boolean;
  /** Stable, machine-readable reason codes. Empty exactly when `valid`. */
  readonly errors: readonly string[];
}

const nonEmpty = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0;

/**
 * STRUCTURAL VALIDATION, before anything is stored or hashed.
 *
 * This does not judge whether a contract is a GOOD contract — that is the
 * evaluator's question, and conflating the two would let a schema check stand
 * in for a review. It answers only whether the document is complete enough to
 * be reviewed and to be reviewed AGAINST.
 */
export function validateJuliusTaskContract(contract: JuliusTaskContract): JuliusTaskContractValidation {
  const errors: string[] = [];
  const require = (ok: boolean, code: string): void => { if (!ok) errors.push(code); };

  require(nonEmpty(contract.contractId), 'contract_id_required');
  require(nonEmpty(contract.runId), 'run_id_required');
  require(nonEmpty(contract.taskId), 'task_id_required');
  require(Number.isInteger(contract.missionContractRevision) && contract.missionContractRevision >= 1,
    'mission_contract_revision_invalid');
  require(Number.isInteger(contract.contractRevision) && contract.contractRevision >= 1,
    'contract_revision_invalid');

  require(nonEmpty(contract.objective), 'objective_required');
  require(nonEmpty(contract.responsibilityBoundary), 'responsibility_boundary_required');
  require(nonEmpty(contract.stoppingCondition), 'stopping_condition_required');

  // A contract with no expected output describes no deliverable, and a contract
  // with no required input cannot say whether its handoff was complete.
  require(contract.requiredInputs.length > 0, 'required_inputs_required');
  require(contract.expectedOutputs.length > 0, 'expected_outputs_required');
  require(contract.inScope.length > 0, 'in_scope_required');
  // `outOfScope`, `prohibitedActions`, `dependencyTaskIds`, `requiredChecks` and
  // `repairRules` may legitimately be empty: "nothing" is a real answer to each.

  require(contract.blockingAcceptanceCriteria.length > 0, 'blocking_acceptance_criteria_required');
  const seenCriterionIds = new Set<string>();
  for (const criterion of contract.blockingAcceptanceCriteria) {
    if (!nonEmpty(criterion.criterionId)) { errors.push('criterion_id_required'); continue; }
    if (seenCriterionIds.has(criterion.criterionId)) errors.push(`criterion_id_duplicated:${criterion.criterionId}`);
    seenCriterionIds.add(criterion.criterionId);
    if (!nonEmpty(criterion.statement)) errors.push(`criterion_statement_required:${criterion.criterionId}`);
    // A criterion nothing can prove is prose wearing a criterion's clothes: the
    // reviewer would have to decide it by opinion, which is the failure mode
    // this whole file exists to remove.
    if (criterion.requiredEvidenceTypes.length === 0) errors.push(`criterion_evidence_required:${criterion.criterionId}`);
  }

  require(contract.requiredEvidence.length > 0, 'required_evidence_required');
  require(contract.reviewCriteria.length > 0, 'review_criteria_required');
  require(contract.failureConditions.length > 0, 'failure_conditions_required');

  require(Number.isInteger(contract.budget.ceilingUsdMicros) && contract.budget.ceilingUsdMicros > 0,
    'budget_ceiling_invalid');
  require(Number.isInteger(contract.budget.maxRepairRounds) && contract.budget.maxRepairRounds >= 0,
    'budget_repair_rounds_invalid');

  // A locked contract without a digest, or a draft carrying one, are both
  // records that would let a downstream dispatch cite a binding that was never
  // agreed. Checked here so no store can persist either shape.
  if (contract.state === 'LOCKED') {
    require(nonEmpty(contract.bindingDigest), 'locked_contract_requires_binding_digest');
    require(nonEmpty(contract.lockedAt), 'locked_contract_requires_locked_at');
    require(nonEmpty(contract.lockedByEvaluatorId), 'locked_contract_requires_evaluator');
  } else if (contract.state === 'DRAFT' || contract.state === 'CHALLENGED') {
    require(contract.bindingDigest === null, 'unlocked_contract_must_not_carry_binding_digest');
    require(contract.lockedAt === null, 'unlocked_contract_must_not_carry_locked_at');
  }

  return { valid: errors.length === 0, errors: Object.freeze(errors) };
}

/* -------------------------------------------------------- the evaluator seam */

/**
 * THE EVALUATOR'S VERDICT — a value, never an action.
 *
 * `CHALLENGE` must carry at least one objection; a challenge with nothing to
 * fix is indistinguishable from an accept and would stall the cycle forever.
 * `ACCEPT` carries none, and carrying one is refused rather than ignored:
 * an evaluator that accepts while objecting has not decided.
 */
export type JuliusContractVerdict =
  | { readonly verdict: 'ACCEPT'; readonly evaluatorId: string }
  | { readonly verdict: 'CHALLENGE'; readonly evaluatorId: string; readonly objections: readonly string[] };

export type JuliusContractGateOutcome =
  | { readonly outcome: 'LOCKED'; readonly contract: JuliusTaskContract }
  | { readonly outcome: 'CHALLENGED'; readonly contract: JuliusTaskContract }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

/**
 * RECORD A CHALLENGE. The contract stays exactly as drafted — a challenge does
 * not edit it — and moves to `CHALLENGED`, which is the state a revision may
 * be cut from.
 */
export function challengeJuliusTaskContract(
  contract: JuliusTaskContract,
  verdict: Extract<JuliusContractVerdict, { verdict: 'CHALLENGE' }>,
): JuliusContractGateOutcome {
  if (contract.state === 'LOCKED') return { outcome: 'REFUSED', reasonCode: 'contract_already_locked' };
  if (contract.state === 'SUPERSEDED') return { outcome: 'REFUSED', reasonCode: 'contract_superseded' };
  if (verdict.objections.length === 0) return { outcome: 'REFUSED', reasonCode: 'challenge_requires_objections' };
  if (!nonEmpty(verdict.evaluatorId)) return { outcome: 'REFUSED', reasonCode: 'evaluator_required' };
  return { outcome: 'CHALLENGED', contract: { ...contract, state: 'CHALLENGED' } };
}

/**
 * LOCK — the only step that creates a binding, and the only one Julius performs.
 *
 * The digest is computed HERE, from the accepted terms, so a caller cannot hand
 * in a digest of something else. Validation runs first: locking an incomplete
 * contract would publish a binding to a document that cannot be reviewed.
 *
 * Announce facts, not intentions: this returns a contract that is READY to be
 * locked. It becomes locked when the store's write resolves, and the store is
 * what refuses a second lock — see `JuliusTaskContractStore.lockContract`.
 */
export function lockJuliusTaskContract(input: {
  contract: JuliusTaskContract;
  verdict: Extract<JuliusContractVerdict, { verdict: 'ACCEPT' }>;
  lockedAt: string;
}): JuliusContractGateOutcome {
  const { contract, verdict } = input;
  if (contract.state === 'LOCKED') return { outcome: 'REFUSED', reasonCode: 'contract_already_locked' };
  if (contract.state === 'SUPERSEDED') return { outcome: 'REFUSED', reasonCode: 'contract_superseded' };
  if (!nonEmpty(verdict.evaluatorId)) return { outcome: 'REFUSED', reasonCode: 'evaluator_required' };
  if (!nonEmpty(input.lockedAt)) return { outcome: 'REFUSED', reasonCode: 'locked_at_required' };

  const validation = validateJuliusTaskContract(contract);
  if (!validation.valid) {
    return { outcome: 'REFUSED', reasonCode: `contract_invalid:${validation.errors[0]}` };
  }

  const bindingDigest = juliusTaskContractBindingDigest(contract);
  return {
    outcome: 'LOCKED',
    contract: {
      ...contract,
      state: 'LOCKED',
      bindingDigest,
      lockedAt: input.lockedAt,
      lockedByEvaluatorId: verdict.evaluatorId,
    },
  };
}

/* ------------------------------------------------------------- the revision */

/** Everything a worker may propose changing. The mission-owned fields are absent by type. */
export type JuliusTaskContractProposal = Partial<Omit<
  JuliusTaskContract,
  'contractId' | 'runId' | 'taskId' | 'missionContractRevision' | 'contractRevision'
  | 'budget' | 'state' | 'bindingDigest' | 'lockedAt' | 'lockedByEvaluatorId'
>>;

export type JuliusTaskContractRevisionOutcome =
  | { readonly outcome: 'REVISED'; readonly contract: JuliusTaskContract; readonly supersedes: JuliusTaskContract | null }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: string };

/**
 * CUT A NEW REVISION from an existing contract.
 *
 * Rule 3 of the brief — "contract mutation after lock requires a new revision"
 * — is enforced by there being no other way to change one. There is no mutate
 * function. A locked contract that is revised is returned as `supersedes` so
 * the caller can record BOTH writes; the previous agreement is preserved as
 * `SUPERSEDED` rather than overwritten, because work was dispatched under it.
 *
 * The criterion-id check is the sharp edge: the proposal may reword a criterion
 * but may not drop, add or rename one. A worker that could remove a criterion
 * could pass its own review by deleting the thing it failed.
 */
export function reviseJuliusTaskContract(input: {
  contract: JuliusTaskContract;
  proposal: JuliusTaskContractProposal;
}): JuliusTaskContractRevisionOutcome {
  const { contract, proposal } = input;
  if (contract.state === 'SUPERSEDED') return { outcome: 'REFUSED', reasonCode: 'contract_superseded' };

  if (proposal.blockingAcceptanceCriteria !== undefined) {
    const before = contract.blockingAcceptanceCriteria.map((criterion) => criterion.criterionId).sort();
    const after = proposal.blockingAcceptanceCriteria.map((criterion) => criterion.criterionId).sort();
    if (before.length !== after.length || before.some((id, index) => id !== after[index])) {
      return { outcome: 'REFUSED', reasonCode: 'criterion_ids_are_mission_owned' };
    }
  }

  const revised: JuliusTaskContract = {
    ...contract,
    ...proposal,
    // Restated rather than spread, so a proposal carrying an extra key at
    // runtime — it is `Partial<>` at compile time only, and provider output is
    // not compiled — cannot reach any of them.
    contractId: contract.contractId,
    runId: contract.runId,
    taskId: contract.taskId,
    missionContractRevision: contract.missionContractRevision,
    budget: contract.budget,
    contractRevision: contract.contractRevision + 1,
    state: 'DRAFT',
    bindingDigest: null,
    lockedAt: null,
    lockedByEvaluatorId: null,
  };

  const validation = validateJuliusTaskContract(revised);
  if (!validation.valid) return { outcome: 'REFUSED', reasonCode: `contract_invalid:${validation.errors[0]}` };

  return {
    outcome: 'REVISED',
    contract: revised,
    supersedes: contract.state === 'LOCKED' ? { ...contract, state: 'SUPERSEDED' } : null,
  };
}

/* ------------------------------------------------------------ the gate rules */

/**
 * THE BINDING OF A LOCKED CONTRACT. `null` for anything else — a caller must
 * not be able to cite a binding that no evaluator accepted.
 */
export function juliusTaskContractBinding(contract: JuliusTaskContract): JuliusTaskContractBinding | null {
  if (contract.state !== 'LOCKED' || contract.bindingDigest === null) return null;
  return Object.freeze({
    contractId: contract.contractId,
    taskId: contract.taskId,
    contractRevision: contract.contractRevision,
    bindingDigest: contract.bindingDigest,
  });
}

export type JuliusContractDispatchVerdict =
  | { readonly permitted: true; readonly binding: JuliusTaskContractBinding }
  | { readonly permitted: false; readonly reasonCode: string };

/**
 * RULE 1 — CODING MUST NOT BEGIN BEFORE THE CONTRACT IS LOCKED.
 *
 * Stated as a predicate over the contract rather than over the task graph,
 * because the two answer different questions. `evaluateJuliusRelease` (#234)
 * decides whether the BUILD TASK's dependencies are satisfied; this decides
 * whether what the build was asked to do has been agreed. A run could satisfy
 * the first and not the second — an accepted plan review whose contract was
 * then revised — and dispatching on the graph alone would send a coder to work
 * against terms nobody had locked.
 *
 * `null` is refused, and refused SEPARATELY from an unlocked one: "there is no
 * contract" and "the contract is not agreed yet" are different facts and a
 * single reason code would hide which.
 */
export function mayDispatchUnderContract(contract: JuliusTaskContract | null): JuliusContractDispatchVerdict {
  if (contract === null) return { permitted: false, reasonCode: 'contract_absent' };
  if (contract.state === 'DRAFT') return { permitted: false, reasonCode: 'contract_not_locked' };
  if (contract.state === 'CHALLENGED') return { permitted: false, reasonCode: 'contract_challenged' };
  if (contract.state === 'SUPERSEDED') return { permitted: false, reasonCode: 'contract_superseded' };
  const binding = juliusTaskContractBinding(contract);
  // Unreachable through `lockJuliusTaskContract`, which always sets a digest.
  // Kept because the contract may have arrived from a store, and a LOCKED row
  // with no digest is corruption, not a permission.
  if (binding === null) return { permitted: false, reasonCode: 'locked_contract_missing_binding' };
  return { permitted: true, binding };
}

export type JuliusBindingCurrency = 'CURRENT' | 'STALE' | 'FOREIGN' | 'INDETERMINATE';

/**
 * RULE 4 — AN OLD HANDOFF IS STALE WHEN THE BINDING CHANGES.
 *
 * Four answers, because collapsing them loses the one a caller needs:
 *
 *   CURRENT        same revision AND same digest — the same agreement
 *   STALE          an older revision of THIS contract — recompile and retry
 *   FOREIGN        another contract, or the same revision with a DIFFERENT
 *                  digest, which means one of the two records is not what it
 *                  claims. Never silently treated as stale: a retry would
 *                  succeed and hide it.
 *   INDETERMINATE  nothing locked to compare against, or an unreadable record
 *
 * A revision NEWER than the current contract is FOREIGN, not current. It cannot
 * happen in a correct run, and reading it as acceptable would let a record from
 * a rolled-back revision authorise work.
 */
export function evaluateJuliusBindingCurrency(input: {
  recorded: JuliusTaskContractBinding | null;
  contract: JuliusTaskContract | null;
}): JuliusBindingCurrency {
  const { recorded } = input;
  if (recorded === null || input.contract === null) return 'INDETERMINATE';
  const current = juliusTaskContractBinding(input.contract);
  if (current === null) return 'INDETERMINATE';
  if (recorded.contractId !== current.contractId || recorded.taskId !== current.taskId) return 'FOREIGN';
  if (!Number.isInteger(recorded.contractRevision) || recorded.contractRevision < 1) return 'INDETERMINATE';
  if (recorded.contractRevision > current.contractRevision) return 'FOREIGN';
  if (recorded.contractRevision < current.contractRevision) return 'STALE';
  return recorded.bindingDigest === current.bindingDigest ? 'CURRENT' : 'FOREIGN';
}

export type JuliusSharedBindingVerdict =
  | { readonly shared: true; readonly binding: JuliusTaskContractBinding }
  | { readonly shared: false; readonly reasonCode: string };

/**
 * RULE 2 — THE CODER AND THE REVIEWER MUST HOLD THE SAME BINDING.
 *
 * The whole point of the contract is that the thing being graded and the thing
 * being graded AGAINST are one document. This is that check, and it compares
 * the digest as well as the revision: two records agreeing on revision 2 while
 * disagreeing on its content is exactly the corruption a revision-only check
 * would pass.
 */
export function evaluateJuliusSharedBinding(input: {
  implementation: JuliusTaskContractBinding | null;
  review: JuliusTaskContractBinding | null;
}): JuliusSharedBindingVerdict {
  if (input.implementation === null) return { shared: false, reasonCode: 'implementation_binding_absent' };
  if (input.review === null) return { shared: false, reasonCode: 'review_binding_absent' };
  const a = input.implementation;
  const b = input.review;
  if (a.contractId !== b.contractId) return { shared: false, reasonCode: 'binding_contract_mismatch' };
  if (a.taskId !== b.taskId) return { shared: false, reasonCode: 'binding_task_mismatch' };
  if (a.contractRevision !== b.contractRevision) return { shared: false, reasonCode: 'binding_revision_mismatch' };
  if (a.bindingDigest !== b.bindingDigest) return { shared: false, reasonCode: 'binding_digest_mismatch' };
  return { shared: true, binding: a };
}

/* -------------------------------------------------------- the review charge */

/**
 * RULE 5 — THE REVIEWER GRADES AGAINST THE CONTRACT.
 *
 * The stage rubric from `julius-review-stage.ts` says what KIND of thing is
 * under judgement; this says WHAT THIS TASK was charged with. The two compose:
 * the stage's questions first, because they are what distinguishes a plan
 * review from a build review, then this contract's own criteria, each named by
 * its id so a finding can cite one.
 *
 * `mustNotDemand` is carried through unchanged. A contract cannot widen what a
 * plan review may demand — that is the #234 repair, and a per-task override
 * would reopen it.
 */
export interface JuliusContractReviewCharge {
  readonly stage: JuliusReviewStage;
  readonly binding: JuliusTaskContractBinding;
  readonly objective: string;
  readonly responsibilityBoundary: string;
  readonly stoppingCondition: string;
  readonly inScope: readonly string[];
  readonly outOfScope: readonly string[];
  readonly permittedPaths: readonly string[];
  readonly prohibitedActions: readonly string[];
  /** `[<criterionId>] <statement>` — quoted so a finding's `criterionId` can point at one. */
  readonly blockingCriteria: readonly string[];
  readonly requiredEvidence: readonly JuliusEvidence['type'][];
  readonly requiredChecks: readonly string[];
  readonly contractReviewCriteria: readonly string[];
  readonly failureConditions: readonly string[];
}

/**
 * Build the contract half of a review charge. `null` when the contract is not
 * locked: a reviewer must never be handed terms that are still being argued
 * about, because its findings would cite a version that never bound anyone.
 */
export function juliusContractReviewCharge(input: {
  contract: JuliusTaskContract;
  stage: JuliusReviewStage;
}): JuliusContractReviewCharge | null {
  const binding = juliusTaskContractBinding(input.contract);
  if (binding === null) return null;
  const contract = input.contract;
  return Object.freeze({
    stage: input.stage,
    binding,
    objective: contract.objective,
    responsibilityBoundary: contract.responsibilityBoundary,
    stoppingCondition: contract.stoppingCondition,
    inScope: contract.inScope,
    outOfScope: contract.outOfScope,
    permittedPaths: contract.permittedPaths,
    prohibitedActions: contract.prohibitedActions,
    blockingCriteria: Object.freeze(contract.blockingAcceptanceCriteria.map(
      (criterion) => `[${criterion.criterionId}] ${criterion.statement}`,
    )),
    requiredEvidence: contract.requiredEvidence,
    requiredChecks: contract.requiredChecks,
    contractReviewCriteria: contract.reviewCriteria,
    failureConditions: contract.failureConditions,
  });
}

/* ---------------------------------------------------------------- the seed */

/**
 * WHAT JULIUS PUTS IN THE CONTRACT BEFORE ANY WORKER SEES IT.
 *
 * The brief has the Prompt Architect DRAFT the contract. In Julius's shape that
 * would hand a worker the mission's own terms to write, and the very first rule
 * of the cycle is that it may not: Julius retains mission authority, workers
 * propose. So revision 1 is authored HERE, from the Mission Contract, and the
 * architect's contribution is a REVISION — the detail it is genuinely closer
 * to (the required implementation, the checks, the boundary) proposed against
 * terms it cannot rewrite.
 *
 * That ordering is also what makes the gate usable. A build cannot be
 * dispatched without a locked contract; if nothing seeded one, every mission
 * would stall at the build waiting for a document nobody was obliged to write.
 *
 * THE SHAPE IS DECLARED HERE, not imported. `JuliusBootstrapRequest` lives in
 * `integration/julius`, and this directory does not import from there — the
 * domain states what it needs and a composition root maps the request onto it.
 */
export interface JuliusMissionTerms {
  readonly runId: string;
  readonly taskId: string;
  readonly missionContractRevision: number;
  readonly objective: string;
  readonly requirements: readonly string[];
  readonly constraints: readonly string[];
  /** Only the BLOCKING criteria become contract criteria; the ids are the mission's. */
  readonly acceptanceCriteria: readonly { readonly id: string; readonly text: string; readonly blocking: boolean }[];
  readonly filesInScope: readonly string[];
  readonly filesOutOfScope: readonly string[];
  /** The mission's authorised spend. `null` is UNKNOWN, and a contract cannot be seeded from it. */
  readonly spendUsd: number | null;
  /** Authorised repair rounds. `null` is UNKNOWN, and is likewise refused. */
  readonly repairCycles: number | null;
  /** The evidence the implementation must produce, from the seeded build task. */
  readonly requiredEvidence: readonly JuliusEvidence['type'][];
}

export type JuliusContractSeedOutcome =
  | { readonly seeded: true; readonly contract: JuliusTaskContract }
  | { readonly seeded: false; readonly reasonCode: string };

/**
 * UNKNOWN IS NOT A DEFAULT. A mission with no spend ceiling, no authorised
 * repair rounds or no blocking criterion is REFUSED rather than seeded with a
 * number nobody authorised — a contract whose budget was invented is a contract
 * whose reviewer would be grading against an invented bar.
 *
 * `contractId` is derived from the task, so a replayed bootstrap seeds the same
 * contract rather than a second one, and the store's `one_per_task` index and
 * this derivation agree by construction.
 */
export function seedJuliusTaskContract(terms: JuliusMissionTerms): JuliusContractSeedOutcome {
  if (terms.spendUsd === null) return { seeded: false, reasonCode: 'mission_spend_ceiling_unknown' };
  if (terms.repairCycles === null) return { seeded: false, reasonCode: 'mission_repair_rounds_unknown' };
  const blocking = terms.acceptanceCriteria.filter((criterion) => criterion.blocking);
  if (blocking.length === 0) return { seeded: false, reasonCode: 'mission_has_no_blocking_criterion' };

  const ceilingUsdMicros = Math.round(terms.spendUsd * 1_000_000);
  if (!Number.isSafeInteger(ceilingUsdMicros) || ceilingUsdMicros <= 0) {
    return { seeded: false, reasonCode: 'mission_spend_ceiling_invalid' };
  }

  const contract: JuliusTaskContract = {
    contractId: `contract:${terms.taskId}`,
    runId: terms.runId,
    taskId: terms.taskId,
    missionContractRevision: terms.missionContractRevision,
    contractRevision: 1,
    objective: terms.objective,
    // Stated rather than left implied: the boundary a seeded contract can
    // honestly assert is the mission's own, and the architect's revision is
    // where a narrower one is proposed.
    responsibilityBoundary:
      'Implement the mission objective within the files in scope, and produce the evidence required below. '
      + 'Reviewing, releasing and deciding acceptance belong to other roles.',
    requiredInputs: [
      'the locked task contract',
      'the accepted plan',
      ...terms.requirements.map((requirement) => `requirement: ${requirement}`),
    ],
    expectedOutputs: ['a unified diff of the change', 'the output of every required check'],
    // A mission with no declared file scope is in scope for the repository it
    // was granted; saying "the repository" is honest, and inventing a narrower
    // list would be a constraint nobody authorised.
    inScope: terms.filesInScope.length > 0 ? terms.filesInScope : ['the granted repository'],
    outOfScope: terms.filesOutOfScope,
    blockingAcceptanceCriteria: blocking.map((criterion) => ({
      criterionId: criterion.id,
      statement: criterion.text,
      // The mission states criteria as prose and does not type their evidence.
      // The build task's own `requiredEvidenceTypes` is what the runtime
      // actually enforces, so the contract quotes THAT rather than guessing a
      // per-criterion answer the mission never gave.
      requiredEvidenceTypes: terms.requiredEvidence,
    })),
    requiredEvidence: terms.requiredEvidence,
    // Empty, and honestly so: the mission does not name commands. The architect
    // proposes them in its revision, where they can be reviewed.
    requiredChecks: [],
    permittedPaths: terms.filesInScope,
    prohibitedActions: [
      ...terms.constraints.map((constraint) => `violating the mission constraint: ${constraint}`),
      ...terms.filesOutOfScope.map((path) => `writing to ${path}`),
    ],
    dependencyTaskIds: [],
    reviewCriteria: [
      'Does the change satisfy every blocking acceptance criterion, each shown by the required evidence?',
      'Did the change stay inside the permitted paths, leaving the out-of-scope ones untouched?',
      'Are the mission constraints respected?',
    ],
    failureConditions: [
      'a blocking acceptance criterion is not satisfied',
      'required evidence is absent',
      'a path outside the permitted scope was written',
    ],
    repairRules: [
      'a repair round addresses the recorded findings and does not widen the change',
      `at most ${terms.repairCycles} repair round(s) are authorised`,
    ],
    // The same two numbers `juliusAllocationPolicy` takes, so the contract's
    // statement of the money and the allocator's derivation of a per-dispatch
    // share cannot disagree.
    budget: { ceilingUsdMicros, maxRepairRounds: terms.repairCycles },
    stoppingCondition:
      'Stop when every blocking acceptance criterion is satisfied with its required evidence, '
      + 'when the authorised repair rounds are spent, or when the mission budget is exhausted.',
    state: 'DRAFT',
    bindingDigest: null,
    lockedAt: null,
    lockedByEvaluatorId: null,
  };

  const validation = validateJuliusTaskContract(contract);
  return validation.valid
    ? { seeded: true, contract }
    : { seeded: false, reasonCode: `contract_invalid:${validation.errors[0]}` };
}

/* ------------------------------------------- a proposal from a provider */

/**
 * SANITISE A CONTRACT REVISION PROPOSED BY A WORKER.
 *
 * `reviseJuliusTaskContract` already refuses to move a mission-owned field, and
 * `validateJuliusTaskContract` refuses an incomplete result. This is the layer
 * before both: the value arrives from a PROVIDER, so it is `unknown` in the
 * honest sense — not typed, not trusted, not necessarily an object.
 *
 * IT IS AN ALLOWLIST, and deliberately not a filter. Every key not named here
 * is dropped rather than carried, so a field added to the contract later is
 * absent from a proposal until someone decides it may be proposed. A rejected
 * SHAPE is `null` rather than a partial object: half a proposal is a document
 * nobody wrote, and merging one would produce terms that are neither the
 * architect's nor Julius's.
 *
 * Strings are trimmed and bounded; arrays are bounded in length and per entry.
 * The bounds are not security theatre — a context packet has a character budget
 * and a contract that exceeded it would push the findings out of a repair's
 * context, which is the failure `repairContextFindings` exists to prevent.
 */
const PROPOSAL_STRING_FIELDS = ['objective', 'responsibilityBoundary', 'stoppingCondition'] as const;
const PROPOSAL_LIST_FIELDS = [
  'requiredInputs', 'expectedOutputs', 'inScope', 'outOfScope', 'requiredChecks',
  'permittedPaths', 'prohibitedActions', 'reviewCriteria', 'failureConditions', 'repairRules',
] as const;

/** Per-entry and per-field bounds. A contract is a page, not a transcript. */
export const JULIUS_CONTRACT_PROPOSAL_LIMITS = Object.freeze({
  stringChars: 2_000,
  entryChars: 500,
  entriesPerList: 40,
});

const boundedString = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
};

export function sanitizeJuliusContractProposal(value: unknown): JuliusTaskContractProposal | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const proposal: Record<string, unknown> = {};

  for (const field of PROPOSAL_STRING_FIELDS) {
    if (!(field in source)) continue;
    const text = boundedString(source[field], JULIUS_CONTRACT_PROPOSAL_LIMITS.stringChars);
    // A field that is PRESENT and unusable is a refusal, not an omission: the
    // worker meant to say something and what arrived cannot be used, and
    // silently keeping Julius's own text would attribute it to the worker.
    if (text === null) return null;
    proposal[field] = text;
  }

  for (const field of PROPOSAL_LIST_FIELDS) {
    if (!(field in source)) continue;
    const raw = source[field];
    if (!Array.isArray(raw) || raw.length > JULIUS_CONTRACT_PROPOSAL_LIMITS.entriesPerList) return null;
    const entries: string[] = [];
    for (const entry of raw) {
      const text = boundedString(entry, JULIUS_CONTRACT_PROPOSAL_LIMITS.entryChars);
      if (text === null) return null;
      entries.push(text);
    }
    proposal[field] = Object.freeze(entries);
  }

  // Nothing proposable was proposed. `null` rather than an empty object, so a
  // caller cannot cut a revision that changes nothing and calls itself new.
  return Object.keys(proposal).length === 0 ? null : proposal as JuliusTaskContractProposal;
}
