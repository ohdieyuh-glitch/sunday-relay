import type {
  IsoTimestamp,
  RelayMission,
  RelayResult,
  RelayStageId,
  ReviewReport,
} from './types';

/** Golden-path order — the single source of truth for the pipeline rail. */
export const RELAY_STAGES: ReadonlyArray<{
  id: RelayStageId;
  label: string;
  description: string;
}> = [
  { id: 'mission', label: 'Mission', description: 'Mission created' },
  { id: 'handoff', label: 'Handoff', description: 'Implementer handoff generated' },
  { id: 'implementation', label: 'Implementation', description: 'Implementation report received' },
  { id: 'review', label: 'Review', description: 'Independent review received' },
  { id: 'repair-task', label: 'Repair task', description: 'Repair task generated from findings' },
  { id: 'repair', label: 'Repair', description: 'Repair completion received' },
  { id: 'evidence', label: 'Evidence', description: 'Test evidence recorded' },
  { id: 'verified', label: 'Verified', description: 'Verification gate passed' },
];

export const STAGE_ORDER: ReadonlyArray<RelayStageId> = RELAY_STAGES.map((s) => s.id);

/** A clean approval with zero findings is the only path that skips repair. */
export function reviewRequiresRepair(review: ReviewReport): boolean {
  return review.verdict === 'changes-requested' || review.findings.length > 0;
}

/** Milestones achieved so far. Repair stages count as satisfied (skipped)
 * when the review verdict is a clean approval with zero findings. */
export function completedStages(mission: RelayMission): ReadonlySet<RelayStageId> {
  const done = new Set<RelayStageId>(['mission']);
  if (mission.handoff) done.add('handoff');
  if (mission.implementationReport) done.add('implementation');
  if (mission.review) {
    done.add('review');
    if (!reviewRequiresRepair(mission.review)) {
      done.add('repair-task');
      done.add('repair');
    }
  }
  if (mission.repairTask) done.add('repair-task');
  if (mission.repairReport) done.add('repair');
  if (mission.evidence) done.add('evidence');
  if (mission.verification) done.add('verified');
  return done;
}

/** The first golden-path milestone not yet achieved ('verified' when all are). */
export function currentStage(mission: RelayMission): RelayStageId {
  const done = completedStages(mission);
  for (const id of STAGE_ORDER) {
    if (!done.has(id)) return id;
  }
  return 'verified';
}

/** The single primary action that advances the mission. The UI may add
 * secondary affordances (e.g. generating the optional review brief) but the
 * pipeline only ever moves through these, in this order. */
export type RelayNextAction =
  | { type: 'generate-handoff' }
  | { type: 'ingest-implementation-report' }
  | { type: 'ingest-review' }
  | { type: 'generate-repair-task' }
  | { type: 'ingest-repair-report' }
  | { type: 'ingest-evidence' }
  | { type: 'mark-verified' }
  | { type: 'complete' };

export function nextAction(mission: RelayMission): RelayNextAction {
  if (mission.verification) return { type: 'complete' };
  if (!mission.handoff) return { type: 'generate-handoff' };
  if (!mission.implementationReport) return { type: 'ingest-implementation-report' };
  if (!mission.review) return { type: 'ingest-review' };
  if (reviewRequiresRepair(mission.review)) {
    if (!mission.repairTask) return { type: 'generate-repair-task' };
    if (!mission.repairReport) return { type: 'ingest-repair-report' };
  }
  if (!mission.evidence) return { type: 'ingest-evidence' };
  return { type: 'mark-verified' };
}

export interface MissionDraft {
  title: string;
  objective: string;
  context?: string;
  constraints?: string[];
  acceptanceCriteria?: string[];
}

const cleanList = (items: string[] | undefined): string[] =>
  (items ?? []).map((s) => s.trim()).filter((s) => s.length > 0);

export function createMission(
  draft: MissionDraft,
  opts: { id: string; at: IsoTimestamp },
): RelayResult<RelayMission> {
  const errors: string[] = [];
  const title = draft.title.trim();
  const objective = draft.objective.trim();
  if (!title) errors.push('Mission title is required.');
  if (!objective) errors.push('Mission objective is required.');
  const acceptanceCriteria = cleanList(draft.acceptanceCriteria);
  if (acceptanceCriteria.length === 0) {
    errors.push('At least one acceptance criterion is required — "verified complete" must mean something.');
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id: opts.id,
      createdAt: opts.at,
      title,
      objective,
      context: draft.context?.trim() || undefined,
      constraints: cleanList(draft.constraints),
      acceptanceCriteria,
      ledger: [{ at: opts.at, stage: 'mission', summary: `Mission created: ${title}` }],
    },
  };
}
