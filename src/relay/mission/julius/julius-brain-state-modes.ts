import {
  canonicalJuliusBrainJson,
  juliusBrainSha256,
  type JuliusBrainRecordKind,
} from './julius-brain-contracts';
import type { JuliusBrainEntityState } from './julius-brain-projection';
import { compileJuliusBrainContext, type JuliusBrainContextRequest, type JuliusBrainContextView } from './julius-brain-query';

/**
 * STATE MODES: WHAT A RUN MAY DRAW ON, AS OPPOSED TO WHAT THE BRAIN KEEPS.
 *
 * ARCHIVE RETENTION DOES NOT IMPLY RETRIEVAL AUTHORITY. Every paid run can live
 * in the Brain permanently — auditable, exportable, provable — and still be
 * invisible to a run that must not be influenced by it. Read grants answer "may
 * this principal see this kind of thing"; a state mode answers "may THIS RUN be
 * shaped by THAT prior state". Both apply; neither implies the other.
 *
 *   FRESH         the current run, plus the mission's and project's authority
 *                 (mission, objective, active requirements, criteria,
 *                 constraints, prohibitions). No prior run, no mission-level
 *                 working state. A qualification or eval run is FRESH.
 *   CONTINUATION  FRESH, plus the prior runs it explicitly resumes, plus the
 *                 mission's run-less state: an intentional resume.
 *   LEARNING      FRESH, plus selected LEARNABLE kinds from prior runs (by run,
 *                 or any), active only, and — when required — verified only.
 *   REGRESSION    FRESH for guidance, plus a PINNED baseline run returned
 *                 separately for comparison. The baseline is refused if it has
 *                 changed since it was pinned: a comparison against a moving
 *                 target is not a regression test.
 *
 * Every selection is counted by reason and hashed with its policy, so a context
 * packet can prove which prior state was — and was not — available to it.
 */

/** Every record the paid-run archive importer writes carries an external reference with this prefix. */
export const JULIUS_ARCHIVE_EXTERNAL_REF_PREFIX = 'julius-paid-run-archive:';

export const JULIUS_BRAIN_STATE_MODES = ['FRESH', 'CONTINUATION', 'LEARNING', 'REGRESSION'] as const;
export type JuliusBrainStateMode = typeof JULIUS_BRAIN_STATE_MODES[number];

/** What every mode admits from the current mission or the project, whatever run wrote it. */
export const JULIUS_BRAIN_AUTHORITY_KINDS: readonly JuliusBrainRecordKind[] = Object.freeze([
  'MISSION', 'OBJECTIVE', 'REQUIREMENT', 'ACCEPTANCE_CRITERION', 'CONSTRAINT', 'PROHIBITION',
]);

/** What LEARNING may carry forward from prior runs, at most. */
export const JULIUS_BRAIN_LEARNABLE_KINDS: readonly JuliusBrainRecordKind[] = Object.freeze([
  'FINDING', 'REPAIR', 'EVIDENCE', 'EVAL', 'RESEARCH', 'MEMORY_FACT', 'DECISION',
]);

export type JuliusBrainStateModePolicy =
  | { readonly mode: 'FRESH'; readonly missionId: string; readonly runId: string }
  | { readonly mode: 'CONTINUATION'; readonly missionId: string; readonly runId: string; readonly resumes: readonly string[] }
  | {
    readonly mode: 'LEARNING'; readonly missionId: string; readonly runId: string;
    readonly learnFrom: { readonly runIds: readonly string[] | null; readonly kinds: readonly JuliusBrainRecordKind[]; readonly requireVerified: boolean };
  }
  | {
    readonly mode: 'REGRESSION'; readonly missionId: string; readonly runId: string;
    readonly baseline: JuliusBrainRegressionBaseline;
  };

export interface JuliusBrainRegressionBaseline {
  readonly runId: string;
  readonly entityCount: number;
  readonly throughSequence: number;
  readonly snapshotHash: string;
}

export type JuliusBrainModeAdmission = 'CURRENT_RUN' | 'AUTHORITY' | 'RESUMED_RUN' | 'MISSION_STATE' | 'LEARNED' | 'REGRESSION_BASELINE';
export type JuliusBrainModeExclusion = 'PRIOR_RUN_STATE' | 'MISSION_LEVEL_STATE' | 'OTHER_MISSION' | 'NOT_LEARNABLE' | 'UNVERIFIED' | 'NOT_ACTIVE';

export interface JuliusBrainModeSelection {
  readonly outcome: 'SELECTED';
  readonly mode: JuliusBrainStateMode;
  readonly policyHash: string;
  /** Entities that may shape this run, with why. */
  readonly admitted: readonly { readonly entity: JuliusBrainEntityState; readonly admission: Exclude<JuliusBrainModeAdmission, 'REGRESSION_BASELINE'> }[];
  /** REGRESSION only: the pinned baseline, for comparison — never blended into guidance. */
  readonly baseline: readonly JuliusBrainEntityState[] | null;
  readonly excluded: Readonly<Partial<Record<JuliusBrainModeExclusion, number>>>;
  readonly excludedEntityIds: readonly string[];
}

export type JuliusBrainModeResult = JuliusBrainModeSelection | { readonly outcome: 'REFUSED'; readonly reasonCode: string; readonly detail: string };

const sortById = <T extends { entityId: string }>(items: T[]): T[] => items.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0));

export const juliusBrainStateModePolicyHash = (policy: JuliusBrainStateModePolicy): string => juliusBrainSha256(canonicalJuliusBrainJson(policy));

/**
 * PIN A BASELINE: the run's current entities, hashed. A REGRESSION policy
 * carries this, and selection refuses if the same run no longer hashes to it.
 */
export function pinJuliusBrainRegressionBaseline(entities: readonly JuliusBrainEntityState[], runId: string): JuliusBrainRegressionBaseline {
  const members = sortById(entities.filter((state) => state.scope.runId === runId));
  return {
    runId,
    entityCount: members.length,
    throughSequence: members.reduce((max, state) => Math.max(max, state.updatedSequence), 0),
    snapshotHash: juliusBrainSha256(canonicalJuliusBrainJson(members)),
  };
}

function verified(state: JuliusBrainEntityState): boolean {
  switch (state.kind) {
    case 'EVIDENCE': return state.body.verification === 'VERIFIED';
    case 'MEMORY_FACT': return state.body.trust === 'VERIFIED' || state.body.trust === 'APPROVED';
    case 'EVAL': return state.body.outcome !== 'ERROR' && state.body.outcome !== 'REFUSED';
    default: return true;
  }
}

export function validateJuliusBrainStateModePolicy(policy: JuliusBrainStateModePolicy): string[] {
  const errors: string[] = [];
  if (!(JULIUS_BRAIN_STATE_MODES as readonly string[]).includes(policy.mode)) return ['mode: unknown'];
  if (!policy.missionId?.trim()) errors.push('missionId: required');
  if (!policy.runId?.trim()) errors.push('runId: required — a mode is always relative to the run it serves');
  if (policy.mode === 'CONTINUATION') {
    if (policy.resumes.length === 0) errors.push('resumes: a continuation names the runs it resumes');
    if (policy.resumes.includes(policy.runId)) errors.push('resumes: a run does not resume itself');
  }
  if (policy.mode === 'LEARNING') {
    for (const kind of policy.learnFrom.kinds) if (!JULIUS_BRAIN_LEARNABLE_KINDS.includes(kind)) errors.push(`learnFrom.kinds: ${kind} is not learnable`);
    if (policy.learnFrom.kinds.length === 0) errors.push('learnFrom.kinds: at least one');
  }
  if (policy.mode === 'REGRESSION' && policy.baseline.runId === policy.runId) errors.push('baseline.runId: a run is not its own baseline');
  return errors;
}

export function selectJuliusBrainEntitiesForMode(entities: readonly JuliusBrainEntityState[], policy: JuliusBrainStateModePolicy): JuliusBrainModeResult {
  const errors = validateJuliusBrainStateModePolicy(policy);
  if (errors.length > 0) return { outcome: 'REFUSED', reasonCode: 'invalid_state_mode_policy', detail: errors.join('; ') };
  // The current run is admitted whole, so it must be a live run: a run id that
  // imported history already holds would carry that history in as its own.
  const archived = entities.find((state) => state.scope.runId === policy.runId && (state.provenance.externalRef ?? '').startsWith(JULIUS_ARCHIVE_EXTERNAL_REF_PREFIX));
  if (archived !== undefined) {
    return { outcome: 'REFUSED', reasonCode: 'current_run_is_archived_history', detail: `run ${policy.runId} is imported archive history (${archived.entityId}); a live run takes a new run id.` };
  }

  let baseline: JuliusBrainEntityState[] | null = null;
  if (policy.mode === 'REGRESSION') {
    const now = pinJuliusBrainRegressionBaseline(entities, policy.baseline.runId);
    if (now.snapshotHash !== policy.baseline.snapshotHash) {
      return {
        outcome: 'REFUSED', reasonCode: 'regression_baseline_moved',
        detail: `run ${policy.baseline.runId} no longer matches its pinned baseline (${now.entityCount} entities through sequence ${now.throughSequence}; pinned ${policy.baseline.entityCount} through ${policy.baseline.throughSequence}).`,
      };
    }
    baseline = sortById(entities.filter((state) => state.scope.runId === policy.baseline.runId));
  }

  const admitted: { entity: JuliusBrainEntityState; admission: Exclude<JuliusBrainModeAdmission, 'REGRESSION_BASELINE'> }[] = [];
  const excluded: Partial<Record<JuliusBrainModeExclusion, number>> = {};
  const excludedIds: string[] = [];
  const exclude = (state: JuliusBrainEntityState, reason: JuliusBrainModeExclusion) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
    if (excludedIds.length < 200) excludedIds.push(state.entityId);
  };
  const baselineIds = new Set((baseline ?? []).map((state) => state.entityId));

  for (const state of entities) {
    const { missionId, runId } = state.scope;
    const inMission = missionId === null || missionId === policy.missionId;
    if (runId !== null && runId === policy.runId) { admitted.push({ entity: state, admission: 'CURRENT_RUN' }); continue; }
    if (baselineIds.has(state.entityId)) continue; // returned separately, never as guidance
    if (!inMission) { exclude(state, 'OTHER_MISSION'); continue; }
    if (runId === null && JULIUS_BRAIN_AUTHORITY_KINDS.includes(state.kind)) { admitted.push({ entity: state, admission: 'AUTHORITY' }); continue; }

    switch (policy.mode) {
      case 'FRESH':
      case 'REGRESSION':
        exclude(state, runId === null ? 'MISSION_LEVEL_STATE' : 'PRIOR_RUN_STATE');
        break;
      case 'CONTINUATION':
        if (runId === null) admitted.push({ entity: state, admission: 'MISSION_STATE' });
        else if (policy.resumes.includes(runId)) admitted.push({ entity: state, admission: 'RESUMED_RUN' });
        else exclude(state, 'PRIOR_RUN_STATE');
        break;
      case 'LEARNING': {
        const fromAllowedRun = runId === null || policy.learnFrom.runIds === null || policy.learnFrom.runIds.includes(runId);
        if (!fromAllowedRun) { exclude(state, 'PRIOR_RUN_STATE'); break; }
        if (!policy.learnFrom.kinds.includes(state.kind)) { exclude(state, 'NOT_LEARNABLE'); break; }
        if (state.lifecycle !== 'ACTIVE') { exclude(state, 'NOT_ACTIVE'); break; }
        if (policy.learnFrom.requireVerified && !verified(state)) { exclude(state, 'UNVERIFIED'); break; }
        admitted.push({ entity: state, admission: 'LEARNED' });
        break;
      }
    }
  }
  return {
    outcome: 'SELECTED', mode: policy.mode, policyHash: juliusBrainStateModePolicyHash(policy),
    admitted: admitted.sort((a, b) => (a.entity.entityId < b.entity.entityId ? -1 : a.entity.entityId > b.entity.entityId ? 1 : 0)),
    baseline, excluded, excludedEntityIds: excludedIds,
  };
}

export interface JuliusBrainModeContext {
  readonly mode: JuliusBrainStateMode;
  readonly policyHash: string;
  readonly context: JuliusBrainContextView;
  /** Entities in the context that came from a prior run, by admission — so a prompt can label them. */
  readonly priorState: { readonly resumed: readonly string[]; readonly learned: readonly string[] };
  readonly baseline: readonly JuliusBrainEntityState[] | null;
  readonly excluded: Readonly<Partial<Record<JuliusBrainModeExclusion, number>>>;
}

/** Relevant context for a run under a state mode: selection first, then the ordinary compiler. */
export function compileJuliusBrainContextForMode(
  entities: readonly JuliusBrainEntityState[],
  request: Omit<JuliusBrainContextRequest, 'missionId'>,
  policy: JuliusBrainStateModePolicy,
): JuliusBrainModeContext | { readonly outcome: 'REFUSED'; readonly reasonCode: string; readonly detail: string } {
  const selection = selectJuliusBrainEntitiesForMode(entities, policy);
  if (selection.outcome === 'REFUSED') return selection;
  const context = compileJuliusBrainContext(selection.admitted.map((item) => item.entity), { ...request, missionId: policy.missionId });
  const inContext = new Set(context.items.map((item) => item.entityId));
  const pick = (admission: JuliusBrainModeAdmission) => selection.admitted.filter((item) => item.admission === admission && inContext.has(item.entity.entityId)).map((item) => item.entity.entityId);
  return {
    mode: selection.mode, policyHash: selection.policyHash, context,
    priorState: { resumed: [...pick('RESUMED_RUN'), ...pick('MISSION_STATE')], learned: pick('LEARNED') },
    baseline: selection.baseline, excluded: selection.excluded,
  };
}
