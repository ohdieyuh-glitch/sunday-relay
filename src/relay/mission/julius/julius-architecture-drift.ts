import { foldJuliusPeerRequests, guardJuliusPeerResponse, type JuliusPeerLedgerEntry } from './julius-peer-channel';
import {
  JULIUS_BOUNDARY_KINDS, foldJuliusArchitecture,
  type JuliusArchitectureState, type JuliusBoundaryKind,
} from './julius-architecture-state';

/**
 * WHEN JULIUS GOES BACK TO THE ARCHITECT, AND WHAT IT ASKS.
 *
 * An architect that plans once and is never spoken to again is a document, not
 * a peer. The implementation moves, evidence contradicts an assumption, a
 * dependency appears, a repair changes the shape of the thing — and the plan
 * that governs the run is the one written before any of it happened.
 *
 * WHAT THIS IS
 *   - TRIGGERS. Seven named moments, each derived from rows that already exist,
 *     each raised at most once for the architecture revision and subject it is
 *     about. Julius decides when the architect is consulted; the architect
 *     cannot summon itself, and consulting it is bounded so a mission cannot
 *     spend its run arguing about diagrams.
 *   - MATERIALITY. Drift is architectural when it crosses a boundary the
 *     architecture names: an interface, a schema, a dependency, who owns a
 *     subsystem, the security boundary, the concurrency model, the persistence
 *     model, an invariant. Renaming, reformatting, a comment, a log line or a
 *     test-only change is NOT drift, and saying so is a list rather than a
 *     feeling — an architect that calls a rename a boundary change is refused.
 *   - THE FINAL CONSISTENCY CHECK. Before a run may complete, the architect
 *     says whether what was built matches what was designed: ALIGNED,
 *     DRIFT_NON_BLOCKING, DRIFT_REQUIRES_REPAIR or REPLAN_REQUIRED. It is an
 *     ASSESSMENT, not a verdict: the architect cannot mint VERIFIED, cannot
 *     accept a task and cannot complete a mission. What it can do is stop a
 *     completion that would have been a lie.
 *
 * WHAT THIS IS NOT
 *   - NOT A SECOND REVIEWER. The reviewer judges work against the contract.
 *     The architect judges the built system against the design it proposed, and
 *     where the two disagree the reviewer's verdict and the contract both win.
 *   - NOT A WAY TO CHANGE THE TERMS. A re-plan that would require a mission
 *     term to move is escalated as exactly that, never applied.
 *
 * Pure: no clock, no network, no Node API. Time arrives as an injected string.
 */

export const JULIUS_ARCHITECTURE_DRIFT_VERSION = 'julius-architecture-consistency.v1' as const;

/* ---------------------------------------------------------------- triggers */

export const JULIUS_ARCHITECTURE_TRIGGERS = [
  /** The record says the built thing no longer matches the design. */
  'IMPLEMENTATION_DRIFT',
  /** A review says its evidence contradicts an assumption the architecture rests on. */
  'CONTRADICTING_EVIDENCE',
  /** A dependency appeared, changed or is prohibited by the agreement. */
  'DEPENDENCY_CHANGE',
  /** A repair round was required for a reason that is architectural. */
  'REPAIR_AFFECTS_ARCHITECTURE',
  /** A coder asked a question the design should answer. */
  'CODER_GUIDANCE_QUESTION',
  /** Julius, or the architect through the peer channel, asked for a re-plan. */
  'JULIUS_REPLAN_REQUEST',
  /** Everything is done and nobody has asked whether it matches the design. */
  'PRE_COMPLETION_CHECK',
] as const;
export type JuliusArchitectureTrigger = (typeof JULIUS_ARCHITECTURE_TRIGGERS)[number];

/**
 * MATERIAL DRIFT IS DRIFT ACROSS A BOUNDARY THE ARCHITECTURE NAMES.
 *
 * Deliberately the same vocabulary as {@link JULIUS_BOUNDARY_KINDS}: the kinds
 * of edge a design declares are exactly the kinds of change that can move it.
 * A second, divergent list would be a second definition of the same thing.
 */
export const JULIUS_MATERIAL_DRIFT_KINDS = JULIUS_BOUNDARY_KINDS;

/** COSMETIC: named, so "not material" is checkable rather than asserted. */
export const JULIUS_COSMETIC_DRIFT_KINDS = [
  'NAMING', 'FORMATTING', 'COMMENT', 'DOCUMENTATION', 'LOGGING', 'TEST_ONLY',
] as const;
export type JuliusCosmeticDriftKind = (typeof JULIUS_COSMETIC_DRIFT_KINDS)[number];
export type JuliusDriftKind = JuliusBoundaryKind | JuliusCosmeticDriftKind;

export const juliusDriftIsMaterial = (kind: string): boolean =>
  (JULIUS_MATERIAL_DRIFT_KINDS as readonly string[]).includes(kind);

export const JULIUS_ARCHITECTURE_DRIFT_LIMITS = Object.freeze({
  /** How many revisions one run may hold. A re-plan loop is bounded by this. */
  revisions: 8,
  /** How many times the architect may be consulted about drift in one run. */
  consultations: 12,
  /** Drift items in one assessment. */
  drift: 12,
  /** Tasks one assessment may name as drifting. */
  driftingTasks: 8,
  claimChars: 400,
  itemClaimChars: 240,
  nameChars: 120,
  evidenceRefs: 6,
  refChars: 200,
});

/**
 * ONE CONSULTATION, IDENTIFIED. Cause-once: a trigger already raised for this
 * revision and this subject is not raised again, however many times the fact
 * that caused it is re-read on a resume.
 */
export const juliusArchitectureTriggerId = (
  trigger: JuliusArchitectureTrigger,
  revision: number,
  subjectTaskId: string | null,
): string => `arch:${trigger}:r${String(revision)}:${subjectTaskId ?? 'run'}`;

/**
 * THE ARCHITECT TASK JULIUS MINTS TO SERVE ONE TRIGGER — named by the run.
 *
 * A trigger id is cause-once WITHIN a run: its ledger is the run's own. A task id
 * is not: `julius_tasks.task_id` is one key across every run the database has
 * ever held. Without the run in it, the pre-completion check of every run shared
 * one id (`architecture:arch:PRE_COMPLETION_CHECK:r1:run:task`), so the second
 * run in a persistent database could not create its own: the insert found the
 * first run's row, `served` was recorded false, and the completion gate read that
 * as "nobody can serve this" and let the run complete unchecked. Reproduced on
 * main 5c53cb93 with two runs sharing one store.
 */
export const juliusArchitectureCheckTaskId = (runId: string, triggerId: string): string =>
  `architecture:${runId}:${triggerId}:task`;

export interface JuliusArchitectureTriggerCandidate {
  readonly trigger: JuliusArchitectureTrigger;
  readonly triggerId: string;
  readonly revision: number;
  /** The task the trigger is about, or null when it is about the run. */
  readonly subjectTaskId: string | null;
  readonly reasonCode: string;
  readonly detail: string;
}

/** The categories of challenge that mean the shape of the system moved. */
const ARCHITECTURAL_CATEGORIES: readonly string[] = ['contract_drift', 'unsafe_implementation', 'regression'];

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const number = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * EVERY TRIGGER THE ROWS JUSTIFY AND NOBODY HAS SERVED YET.
 *
 * Read from the ledger alone, so a restart reaches the same answer and a
 * resumed run does not re-consult the architect about a question it already
 * asked. Bounded twice: cause-once by trigger id, and by a hard consultation
 * cap on the run, so a mission that keeps producing drift spends its budget on
 * the work rather than on being told about it.
 */
export function juliusArchitectureTriggers(input: {
  readonly state: JuliusArchitectureState | null;
  readonly entries: readonly JuliusPeerLedgerEntry[];
  /** True when every task is terminal and nothing but this stands between the run and completion. */
  readonly completionReady: boolean;
}): readonly JuliusArchitectureTriggerCandidate[] {
  const state = input.state;
  if (state === null) return Object.freeze([]);
  const revision = state.revision;

  const raised = new Set<string>();
  for (const entry of input.entries) {
    if (entry.type !== 'architecture.trigger.raised') continue;
    const id = text(entry.facts.triggerId);
    if (id !== null) raised.add(id);
  }
  const remaining = JULIUS_ARCHITECTURE_DRIFT_LIMITS.consultations - raised.size;
  if (remaining <= 0) return Object.freeze([]);

  const candidates: JuliusArchitectureTriggerCandidate[] = [];
  const add = (
    trigger: JuliusArchitectureTrigger, subjectTaskId: string | null, reasonCode: string, detail: string,
  ): void => {
    const triggerId = juliusArchitectureTriggerId(trigger, revision, subjectTaskId);
    if (raised.has(triggerId) || candidates.some((item) => item.triggerId === triggerId)) return;
    candidates.push({ trigger, triggerId, revision, subjectTaskId, reasonCode, detail });
  };

  /* The design and the agreement already disagree, on the record. */
  for (const entry of input.entries) {
    if (entry.type !== 'architecture.conflicted') continue;
    if (number(entry.facts.revision) !== revision) continue;
    const kind = text(entry.facts.kind);
    const name = text(entry.facts.name) ?? '(unnamed)';
    if (kind === 'DEPENDENCY_PROHIBITED') {
      add('DEPENDENCY_CHANGE', text(entry.facts.contractTaskId), 'dependency_prohibited_by_contract', name);
    } else {
      add('IMPLEMENTATION_DRIFT', text(entry.facts.contractTaskId), 'boundary_outside_permitted_paths', name);
    }
  }

  /* A reviewer said the work drifted, or that its evidence contradicts an assumption. */
  const assumptionIds = new Set(state.assumptions.map((assumption) => assumption.assumptionId));
  for (const entry of input.entries) {
    if (entry.type === 'finding.recorded') {
      const category = text(entry.facts.category);
      if (category !== null && category === 'contract_drift') {
        add('IMPLEMENTATION_DRIFT', text(entry.taskId), 'finding_says_the_work_drifted', category);
      }
      continue;
    }
    if (entry.type === 'review.verdict.applied') {
      const category = text(entry.facts.category);
      const verdict = text(entry.facts.verdict);
      if (verdict === 'REPAIR_REQUIRED' && category !== null && ARCHITECTURAL_CATEGORIES.includes(category)) {
        add('REPAIR_AFFECTS_ARCHITECTURE', text(entry.facts.reviewsTaskId) ?? text(entry.taskId), 'repair_for_an_architectural_reason', category);
      }
      // `contradicts` names the assumptions this review's evidence stands
      // against. Only ones the architecture actually holds: a reviewer naming
      // an assumption nobody made is answering a different mission.
      for (const id of (text(entry.facts.contradicts) ?? '').split(' ').filter((value) => value.length > 0)) {
        if (assumptionIds.has(id)) {
          add('CONTRADICTING_EVIDENCE', text(entry.taskId), 'review_evidence_contradicts_an_assumption', id);
        }
      }
      continue;
    }
    /* A new revision that adds a dependency is a dependency change by definition. */
    if (entry.type === 'architecture.recorded' && number(entry.facts.revision) === revision) {
      const previous = foldJuliusArchitecture(
        input.entries.filter((item) => item.type === 'architecture.recorded' && (number(item.facts.revision) ?? 0) < revision),
      );
      if (previous !== null) {
        const before = new Set(previous.dependencies.map((dependency) => dependency.name));
        for (const dependency of state.dependencies) {
          if (!before.has(dependency.name)) {
            add('DEPENDENCY_CHANGE', text(entry.facts.proposedByTaskId), 'a_revision_added_a_dependency', dependency.name);
          }
        }
      }
    }
  }

  /* The implementation peer saw the design fail under it, and said so with evidence. */
  for (const entry of input.entries) {
    if (entry.type !== 'architecture.observed' || number(entry.facts.revision) !== revision) continue;
    const kind = text(entry.facts.kind);
    const trigger = kind === null ? undefined : OBSERVATION_TRIGGERS[kind as JuliusCoderObservationKind];
    if (trigger === undefined) continue;
    add(trigger, text(entry.taskId), `coder_observed_${kind!.toLowerCase()}`, text(entry.facts.subject) ?? '(unnamed)');
  }

  /* A coder asked, and a re-plan was asked for. Both are peer requests already. */
  for (const request of foldJuliusPeerRequests(input.entries)) {
    if (request.status !== 'OPEN' && request.status !== 'ANSWERED') continue;
    if (request.kind === 'GUIDANCE_QUESTION') {
      add('CODER_GUIDANCE_QUESTION', request.subjectTaskId, 'a_coder_asked_the_design_a_question', request.requestId);
    }
    if (request.kind === 'REPLAN_PROPOSAL') {
      add('JULIUS_REPLAN_REQUEST', request.subjectTaskId, 'a_re_plan_was_proposed', request.requestId);
    }
  }

  /* The last assessment said the design must change. */
  const assessed = foldJuliusConsistency(input.entries);
  if (assessed !== null && assessed.revision === revision && assessed.assessment === 'REPLAN_REQUIRED') {
    add('JULIUS_REPLAN_REQUEST', null, 'the_consistency_check_required_a_re_plan', assessed.claim);
  }

  /* Nothing is left to build and nobody has asked whether it matches. */
  if (input.completionReady) {
    add('PRE_COMPLETION_CHECK', null, 'the_run_is_ready_to_complete_and_unchecked', `revision ${String(revision)}`);
  }

  return Object.freeze(candidates.slice(0, remaining));
}

export function juliusArchitectureTriggerFacts(
  candidate: JuliusArchitectureTriggerCandidate,
): Record<string, string | number | boolean | null> {
  return {
    trigger: candidate.trigger, triggerId: candidate.triggerId, revision: candidate.revision,
    subjectTaskId: candidate.subjectTaskId, reasonCode: candidate.reasonCode, detail: candidate.detail,
  };
}

/* ------------------------------------------------------- what changed, and does it matter */

export interface JuliusArchitectureChange {
  readonly kind: JuliusDriftKind;
  readonly name: string;
  readonly change: 'ADDED' | 'REMOVED' | 'CHANGED';
  readonly material: boolean;
}

/**
 * WHAT MOVED BETWEEN TWO REVISIONS, IN THE MATERIALITY VOCABULARY.
 *
 * Structural only: a boundary gained, lost or redefined; a dependency gained,
 * lost or re-assumed; a component gained, lost or given a different
 * responsibility — which is an OWNERSHIP change, because who owns what is the
 * thing that moved. A revision whose only difference is wording nobody reads
 * produces nothing here, which is exactly what makes "material" checkable.
 */
export function juliusArchitectureChanges(
  previous: JuliusArchitectureState | null,
  next: JuliusArchitectureState,
): readonly JuliusArchitectureChange[] {
  if (previous === null) return Object.freeze([]);
  const changes: JuliusArchitectureChange[] = [];
  const push = (kind: JuliusDriftKind, name: string, change: JuliusArchitectureChange['change']): void => {
    changes.push({ kind, name, change, material: juliusDriftIsMaterial(kind) });
  };

  const beforeBoundaries = new Map(previous.boundaries.map((item) => [item.name, item]));
  for (const boundary of next.boundaries) {
    const was = beforeBoundaries.get(boundary.name);
    if (was === undefined) push(boundary.kind, boundary.name, 'ADDED');
    else if (was.kind !== boundary.kind || was.contract !== boundary.contract || was.locator !== boundary.locator) {
      push(boundary.kind, boundary.name, 'CHANGED');
    }
    beforeBoundaries.delete(boundary.name);
  }
  for (const [name, boundary] of beforeBoundaries) push(boundary.kind, name, 'REMOVED');

  const beforeDependencies = new Map(previous.dependencies.map((item) => [item.name, item]));
  for (const dependency of next.dependencies) {
    const was = beforeDependencies.get(dependency.name);
    if (was === undefined) push('DEPENDENCY', dependency.name, 'ADDED');
    else if (was.assumption !== dependency.assumption) push('DEPENDENCY', dependency.name, 'CHANGED');
    beforeDependencies.delete(dependency.name);
  }
  for (const name of beforeDependencies.keys()) push('DEPENDENCY', name, 'REMOVED');

  const beforeComponents = new Map(previous.components.map((item) => [item.name, item]));
  for (const component of next.components) {
    const was = beforeComponents.get(component.name);
    if (was === undefined) push('OWNERSHIP', component.name, 'ADDED');
    else if (was.responsibility !== component.responsibility) push('OWNERSHIP', component.name, 'CHANGED');
    beforeComponents.delete(component.name);
  }
  for (const name of beforeComponents.keys()) push('OWNERSHIP', name, 'REMOVED');

  return Object.freeze(changes);
}

export const juliusArchitectureChangeIsMaterial = (changes: readonly JuliusArchitectureChange[]): boolean =>
  changes.some((change) => change.material);

/* ------------------------------------------------- the final consistency check */

export const JULIUS_CONSISTENCY_ASSESSMENTS = [
  /** What was built matches what was designed. */
  'ALIGNED',
  /** It drifted, the drift does not need fixing, and the record says so rather than pretending. */
  'DRIFT_NON_BLOCKING',
  /** It drifted across a boundary that matters, and the named work must be repaired. */
  'DRIFT_REQUIRES_REPAIR',
  /** The design itself is wrong for what was learned; a new revision is needed. */
  'REPLAN_REQUIRED',
] as const;
export type JuliusConsistencyAssessment = (typeof JULIUS_CONSISTENCY_ASSESSMENTS)[number];

export interface JuliusConsistencyDrift {
  readonly kind: JuliusDriftKind;
  readonly name: string;
  readonly claim: string;
  readonly material: boolean;
}

export interface JuliusConsistencyDeclaration {
  readonly version: typeof JULIUS_ARCHITECTURE_DRIFT_VERSION;
  readonly assessment: JuliusConsistencyAssessment;
  readonly revision: number;
  readonly claim: string;
  readonly drift: readonly JuliusConsistencyDrift[];
  /** The work that must be repaired. Required by DRIFT_REQUIRES_REPAIR: a repair needs a target. */
  readonly driftingTaskIds: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export type JuliusConsistencyReading =
  | { readonly ok: true; readonly declaration: JuliusConsistencyDeclaration }
  | { readonly ok: false; readonly reasonCode: string };

const line = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > limit) return null;
  if (/(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[=:]/iu.test(cleaned)) return null;
  return cleaned;
};
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,200}$/u;

/**
 * READ THE ARCHITECT'S ASSESSMENT, OR REFUSE IT BY NAME.
 *
 * The authority guard runs first and on the raw value, so an assessment that
 * names a mission-owned term or mints a Julius-only outcome is refused as
 * exactly that. An architect may say the built thing does not match the
 * design; it may not say the mission is VERIFIED, and it never could — the
 * word is refused before this function reads a field.
 *
 * MATERIALITY IS ENFORCED, NOT TRUSTED. An assessment that demands repair or a
 * re-plan on the strength of a rename is refused: every blocking outcome needs
 * at least one drift item whose kind is a boundary the architecture declares.
 */
export function sanitizeJuliusConsistency(input: {
  readonly value: unknown;
  readonly revision: number;
}): JuliusConsistencyReading {
  const guarded = guardJuliusPeerResponse(input.value);
  if (!guarded.ok) return { ok: false, reasonCode: guarded.reasonCode };
  const value = input.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reasonCode: 'consistency_shape_refused' };
  }
  const source = value as Record<string, unknown>;

  const word = typeof source.assessment === 'string' ? source.assessment.trim().toUpperCase() : '';
  if (!(JULIUS_CONSISTENCY_ASSESSMENTS as readonly string[]).includes(word)) {
    return { ok: false, reasonCode: 'consistency_assessment_unknown' };
  }
  const assessment = word as JuliusConsistencyAssessment;

  const claim = line(source.claim, JULIUS_ARCHITECTURE_DRIFT_LIMITS.claimChars);
  if (claim === null) return { ok: false, reasonCode: 'consistency_claim_invalid' };

  const rawDrift = source.drift ?? [];
  if (!Array.isArray(rawDrift) || rawDrift.length > JULIUS_ARCHITECTURE_DRIFT_LIMITS.drift) {
    return { ok: false, reasonCode: 'consistency_drift_invalid' };
  }
  const drift: JuliusConsistencyDrift[] = [];
  for (const item of rawDrift) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { ok: false, reasonCode: 'consistency_drift_invalid' };
    const entry = item as Record<string, unknown>;
    const kind = typeof entry.kind === 'string' ? entry.kind.trim().toUpperCase() : '';
    const known = (JULIUS_MATERIAL_DRIFT_KINDS as readonly string[]).includes(kind)
      || (JULIUS_COSMETIC_DRIFT_KINDS as readonly string[]).includes(kind);
    const name = line(entry.name, JULIUS_ARCHITECTURE_DRIFT_LIMITS.nameChars);
    const itemClaim = line(entry.claim, JULIUS_ARCHITECTURE_DRIFT_LIMITS.itemClaimChars);
    if (!known || name === null || itemClaim === null) return { ok: false, reasonCode: 'consistency_drift_invalid' };
    drift.push(Object.freeze({ kind: kind as JuliusDriftKind, name, claim: itemClaim, material: juliusDriftIsMaterial(kind) }));
  }

  const rawTasks = source.driftingTaskIds ?? [];
  if (!Array.isArray(rawTasks) || rawTasks.length > JULIUS_ARCHITECTURE_DRIFT_LIMITS.driftingTasks) {
    return { ok: false, reasonCode: 'consistency_drifting_tasks_invalid' };
  }
  const driftingTaskIds: string[] = [];
  for (const item of rawTasks) {
    if (typeof item !== 'string' || !TASK_ID.test(item)) return { ok: false, reasonCode: 'consistency_drifting_tasks_invalid' };
    if (!driftingTaskIds.includes(item)) driftingTaskIds.push(item);
  }

  const rawRefs = source.evidenceRefs ?? [];
  if (!Array.isArray(rawRefs) || rawRefs.length > JULIUS_ARCHITECTURE_DRIFT_LIMITS.evidenceRefs) {
    return { ok: false, reasonCode: 'consistency_evidence_invalid' };
  }
  const evidenceRefs: string[] = [];
  for (const item of rawRefs) {
    const ref = line(item, JULIUS_ARCHITECTURE_DRIFT_LIMITS.refChars);
    if (ref === null) return { ok: false, reasonCode: 'consistency_evidence_invalid' };
    if (!evidenceRefs.includes(ref)) evidenceRefs.push(ref);
  }

  /* ALIGNED means nothing drifted. Saying it beside a list of drift is two answers. */
  if (assessment === 'ALIGNED' && drift.length > 0) {
    return { ok: false, reasonCode: 'consistency_aligned_with_drift' };
  }
  if (assessment !== 'ALIGNED') {
    if (drift.length === 0) return { ok: false, reasonCode: 'consistency_drift_unstated' };
    if (evidenceRefs.length === 0) return { ok: false, reasonCode: 'consistency_drift_unevidenced' };
  }
  /* A BLOCKING ANSWER NEEDS MATERIAL DRIFT. A rename is not a boundary change. */
  if ((assessment === 'DRIFT_REQUIRES_REPAIR' || assessment === 'REPLAN_REQUIRED')
    && !drift.some((item) => item.material)) {
    return { ok: false, reasonCode: 'consistency_drift_immaterial' };
  }
  /* A REPAIR NEEDS A TARGET. Julius will not guess which work is wrong. */
  if (assessment === 'DRIFT_REQUIRES_REPAIR' && driftingTaskIds.length === 0) {
    return { ok: false, reasonCode: 'consistency_repair_names_no_work' };
  }

  return {
    ok: true,
    declaration: Object.freeze({
      version: JULIUS_ARCHITECTURE_DRIFT_VERSION, assessment, revision: input.revision, claim,
      drift: Object.freeze(drift), driftingTaskIds: Object.freeze(driftingTaskIds), evidenceRefs: Object.freeze(evidenceRefs),
    }),
  };
}

/** What Julius does with an assessment. Never a verdict, never a completion. */
export type JuliusConsistencyRoute = 'PROCEED' | 'RECORD' | 'REPAIR' | 'REPLAN';

export const juliusConsistencyRoute = (assessment: JuliusConsistencyAssessment): JuliusConsistencyRoute => {
  switch (assessment) {
    case 'ALIGNED': return 'PROCEED';
    case 'DRIFT_NON_BLOCKING': return 'RECORD';
    case 'DRIFT_REQUIRES_REPAIR': return 'REPAIR';
    default: return 'REPLAN';
  }
};

export function juliusConsistencyFacts(
  declaration: JuliusConsistencyDeclaration,
): Record<string, string | number | boolean | null> {
  return {
    consistencyVersion: declaration.version,
    assessment: declaration.assessment,
    route: juliusConsistencyRoute(declaration.assessment),
    revision: declaration.revision,
    claim: declaration.claim,
    drift: declaration.drift.length,
    materialDrift: declaration.drift.filter((item) => item.material).length,
    driftKinds: declaration.drift.map((item) => item.kind).join(' '),
    driftingTaskIds: declaration.driftingTaskIds.join(' '),
    evidenceRefs: declaration.evidenceRefs.join(' '),
  };
}

/** The most recent assessment on the record, whatever revision it was about. */
export function foldJuliusConsistency(
  entries: readonly JuliusPeerLedgerEntry[],
): JuliusConsistencyDeclaration | null {
  let latest: JuliusConsistencyDeclaration | null = null;
  for (const entry of entries) {
    if (entry.type !== 'architecture.assessed') continue;
    const assessment = text(entry.facts.assessment);
    const revision = number(entry.facts.revision);
    const claim = text(entry.facts.claim);
    if (assessment === null || revision === null || claim === null) continue;
    if (!(JULIUS_CONSISTENCY_ASSESSMENTS as readonly string[]).includes(assessment)) continue;
    const kinds = (text(entry.facts.driftKinds) ?? '').split(' ').filter((value) => value.length > 0);
    latest = Object.freeze({
      version: JULIUS_ARCHITECTURE_DRIFT_VERSION,
      assessment: assessment as JuliusConsistencyAssessment,
      revision, claim,
      drift: Object.freeze(kinds.map((kind) => Object.freeze({
        kind: kind as JuliusDriftKind, name: '(recorded)', claim: '(recorded)', material: juliusDriftIsMaterial(kind),
      }))),
      driftingTaskIds: Object.freeze((text(entry.facts.driftingTaskIds) ?? '').split(' ').filter((value) => value.length > 0)),
      evidenceRefs: Object.freeze((text(entry.facts.evidenceRefs) ?? '').split(' ').filter((value) => value.length > 0)),
    });
  }
  return latest;
}

export type JuliusArchitectureCompletionGate =
  | { readonly ok: true; readonly reasonCode: 'ARCHITECTURE_ALIGNED' | 'ARCHITECTURE_DRIFT_ACCEPTED' | 'NO_ARCHITECTURE_RECORDED' | 'ARCHITECTURE_CHECK_UNROUTABLE' }
  | { readonly ok: false; readonly reasonCode: 'ARCHITECTURE_CHECK_PENDING' | 'ARCHITECTURE_CHECK_NOT_CREATED' | 'ARCHITECTURE_DRIFT_REQUIRES_REPAIR' | 'ARCHITECTURE_REPLAN_REQUIRED' };

/**
 * MAY THIS RUN COMPLETE, AS FAR AS THE ARCHITECTURE IS CONCERNED?
 *
 * A run that never recorded an architecture is not held: there is nothing to
 * be consistent with, and inventing a gate for missions that never used the
 * feature would stop work for a reason nobody stated. A run that DID record
 * one must have been asked about the revision in force — an assessment of an
 * older revision is not an answer about this one — and the answer must not be
 * that the work or the design still has to change.
 *
 * This gates COMPLETION only. It cannot accept a task, cannot mint a verdict
 * and cannot verify a mission; the strongest thing it does is refuse to let a
 * completion happen while the architect's answer says it would be untrue.
 */
export function juliusArchitectureCompletionGate(input: {
  readonly entries: readonly JuliusPeerLedgerEntry[];
}): JuliusArchitectureCompletionGate {
  const state = foldJuliusArchitecture(input.entries);
  if (state === null) return { ok: true, reasonCode: 'NO_ARCHITECTURE_RECORDED' };
  const assessed = foldJuliusConsistency(input.entries);
  if (assessed === null || assessed.revision !== state.revision) {
    /**
     * A CHECK NOBODY CAN RUN IS NOT A REASON TO HOLD A MISSION FOREVER.
     *
     * Julius mints the pre-completion consultation only when a worker accepts
     * the task; a deployment whose architect does not serve `architecture`
     * records that it would have asked and carries on. Holding the run instead
     * would make this feature able to strand every mission on an engine that
     * never opted into it, which is exactly the failure `GUIDANCE_UNROUTABLE`
     * exists to avoid.
     */
    const unserved = input.entries.filter((entry) => entry.type === 'architecture.trigger.raised'
      && text(entry.facts.trigger) === 'PRE_COMPLETION_CHECK'
      && number(entry.facts.revision) === state.revision
      && entry.facts.served === false);
    /*
     * UNROUTABLE IS A ROUTING FACT, AND ONLY A ROUTING FACT PASSES THE GATE.
     * A check nobody could have served is not waited for. A check that WAS
     * routable and was simply not created — its task id taken, a storage
     * refusal — is not a reason to believe the design was checked, so it holds
     * the run and says which of the two it was.
     */
    if (unserved.some((entry) => entry.facts.unroutable === true)) return { ok: true, reasonCode: 'ARCHITECTURE_CHECK_UNROUTABLE' };
    if (unserved.length > 0) return { ok: false, reasonCode: 'ARCHITECTURE_CHECK_NOT_CREATED' };
    return { ok: false, reasonCode: 'ARCHITECTURE_CHECK_PENDING' };
  }
  switch (assessed.assessment) {
    case 'ALIGNED': return { ok: true, reasonCode: 'ARCHITECTURE_ALIGNED' };
    case 'DRIFT_NON_BLOCKING': return { ok: true, reasonCode: 'ARCHITECTURE_DRIFT_ACCEPTED' };
    case 'DRIFT_REQUIRES_REPAIR': return { ok: false, reasonCode: 'ARCHITECTURE_DRIFT_REQUIRES_REPAIR' };
    default: return { ok: false, reasonCode: 'ARCHITECTURE_REPLAN_REQUIRED' };
  }
}

/* ------------------------------------------- what the implementation peer saw */

/**
 * WHAT A CODING AGENT MAY TELL JULIUS ABOUT THE DESIGN, AND NOTHING ELSE.
 *
 * The coder is the peer that meets the design against real code first: the
 * assumption that turns out false, the dependency that behaves differently, the
 * boundary the work cannot stay inside, the design that cannot be satisfied. It
 * may SAY so, with evidence, and Julius decides whether that is a reason to go
 * back to the architect. It may not revise the architecture, propose a
 * revision or assess consistency — those channels are the architect's, and a
 * coder that uses them is refused on the record.
 */
export const JULIUS_CODER_OBSERVATION_KINDS = [
  /** An assumption the architecture holds is false in the code. */
  'ASSUMPTION_INVALIDATED',
  /** A dependency the design names behaves differently, or another is needed. */
  'DEPENDENCY_CHANGED',
  /** The implementation had to cross a boundary the design declares. */
  'BOUNDARY_CROSSED',
  /** The work cannot be done inside the current design at all. */
  'ARCHITECTURE_UNSATISFIABLE',
  /** The coder believes a different design would serve the contract better. */
  'REPLAN_SUGGESTED',
] as const;
export type JuliusCoderObservationKind = (typeof JULIUS_CODER_OBSERVATION_KINDS)[number];

/** Each observation reaches exactly one of the consultation triggers PR #271 already defines. */
const OBSERVATION_TRIGGERS: Readonly<Record<JuliusCoderObservationKind, JuliusArchitectureTrigger>> = Object.freeze({
  ASSUMPTION_INVALIDATED: 'CONTRADICTING_EVIDENCE',
  DEPENDENCY_CHANGED: 'DEPENDENCY_CHANGE',
  BOUNDARY_CROSSED: 'IMPLEMENTATION_DRIFT',
  ARCHITECTURE_UNSATISFIABLE: 'JULIUS_REPLAN_REQUEST',
  REPLAN_SUGGESTED: 'JULIUS_REPLAN_REQUEST',
});

export const JULIUS_CODER_OBSERVATION_LIMITS = Object.freeze({ observations: 6, subjectChars: 120, claimChars: 240, evidenceRefs: 4, refChars: 200 });

export interface JuliusCoderObservation {
  readonly kind: JuliusCoderObservationKind;
  /** The assumption id, dependency or boundary name it is about. */
  readonly subject: string;
  readonly claim: string;
  readonly evidenceRefs: readonly string[];
}

export type JuliusCoderObservationReading =
  | { readonly ok: true; readonly observations: readonly JuliusCoderObservation[] }
  | { readonly ok: false; readonly reasonCode: string };

const OBSERVATION_KEYS: readonly string[] = ['kind', 'subject', 'claim', 'evidenceRefs'];

/**
 * READ A CODER'S OBSERVATIONS, OR REFUSE THEM BY NAME.
 *
 * The authority guard first, on the raw value. An observation with no evidence
 * is refused: drift claimed without a locator is a feeling, and a feeling does
 * not buy an architect. An assumption observation must name an assumption the
 * architecture in force actually holds.
 */
export function sanitizeJuliusCoderObservations(input: {
  readonly value: unknown;
  readonly state: JuliusArchitectureState | null;
}): JuliusCoderObservationReading {
  const guarded = guardJuliusPeerResponse(input.value);
  if (!guarded.ok) return { ok: false, reasonCode: guarded.reasonCode };
  if (!Array.isArray(input.value) || input.value.length === 0 || input.value.length > JULIUS_CODER_OBSERVATION_LIMITS.observations) {
    return { ok: false, reasonCode: 'coder_observations_shape_refused' };
  }
  if (input.state === null) return { ok: false, reasonCode: 'coder_observations_without_architecture' };
  const observations: JuliusCoderObservation[] = [];
  for (const item of input.value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { ok: false, reasonCode: 'coder_observations_shape_refused' };
    const entry = item as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !OBSERVATION_KEYS.includes(key))) return { ok: false, reasonCode: 'coder_observations_unknown_field' };
    const kind = typeof entry.kind === 'string' ? entry.kind.trim().toUpperCase() : '';
    if (!(JULIUS_CODER_OBSERVATION_KINDS as readonly string[]).includes(kind)) return { ok: false, reasonCode: 'coder_observation_kind_unknown' };
    const subject = line(entry.subject, JULIUS_CODER_OBSERVATION_LIMITS.subjectChars);
    const claim = line(entry.claim, JULIUS_CODER_OBSERVATION_LIMITS.claimChars);
    if (subject === null || claim === null) return { ok: false, reasonCode: 'coder_observation_text_invalid' };
    if (!Array.isArray(entry.evidenceRefs) || entry.evidenceRefs.length === 0 || entry.evidenceRefs.length > JULIUS_CODER_OBSERVATION_LIMITS.evidenceRefs) {
      return { ok: false, reasonCode: 'coder_observation_unevidenced' };
    }
    const evidenceRefs: string[] = [];
    for (const ref of entry.evidenceRefs) {
      const safe = line(ref, JULIUS_CODER_OBSERVATION_LIMITS.refChars);
      if (safe === null) return { ok: false, reasonCode: 'coder_observation_unevidenced' };
      if (!evidenceRefs.includes(safe)) evidenceRefs.push(safe);
    }
    if (kind === 'ASSUMPTION_INVALIDATED' && !input.state.assumptions.some((assumption) => assumption.assumptionId === subject)) {
      return { ok: false, reasonCode: 'coder_observation_names_unknown_assumption' };
    }
    observations.push(Object.freeze({ kind: kind as JuliusCoderObservationKind, subject, claim, evidenceRefs: Object.freeze(evidenceRefs) }));
  }
  return { ok: true, observations: Object.freeze(observations) };
}

/**
 * ONE OBSERVATION AS A LEDGER ROW. Locators are joined by newline, which `line`
 * has already removed from inside each one, so the row splits back exactly.
 */
export function juliusCoderObservationFacts(input: {
  readonly observation: JuliusCoderObservation;
  readonly revision: number;
  readonly observedByRole: string;
}): Record<string, string | number> {
  return {
    revision: input.revision,
    kind: input.observation.kind,
    subject: input.observation.subject,
    claim: input.observation.claim,
    evidenceRefs: input.observation.evidenceRefs.join('\n'),
    evidenceRefCount: input.observation.evidenceRefs.length,
    observedByRole: input.observedByRole,
  };
}
