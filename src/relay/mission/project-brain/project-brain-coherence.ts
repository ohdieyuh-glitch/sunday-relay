/**
 * MISSION STATE COHERENCE AND EVIDENCE LINKAGE, CHECKED ON EVERY READ.
 *
 * Project Brain never writes one of Julius's rows, so it cannot PREVENT an impossible mission state -- Julius's kernel
 * does that. What it must never do is show one as if it were fine, or fork it into a second story. So every document
 * is checked against the combinations the founder named as impossible, and every violation is reported by reference,
 * with the rule it breaks:
 *
 *   COMPLETE_WITH_ACTIVE_WORK        a mission COMPLETED while a task is still ACTIVE or RUNNABLE (Julius completes a run
 *                                    only when every task SUCCEEDED or was SKIPPED, julius-run-loop.ts; a FAILED or
 *                                    CANCELLED run may legitimately leave work unclaimed, so it is not checked);
 *   COMPLETED_WITH_OPEN_BLOCKER      a mission COMPLETED while a blocking finding is still OPEN;
 *   DUPLICATE_COMPLETION             a mission that entered COMPLETED more than once;
 *   NON_MONOTONIC_TRANSITIONS        two of a mission's transitions at the same run version (gaps are normal: the version
 *                                    also moves on updates that change no state), or a last transition that does not
 *                                    end in the mission's current state (a state written without its transition);
 *   ORPHAN_REPAIR                    a repair whose original task, repair task or findings are not in its mission;
 *   EVIDENCE_NOT_PRESENT             a decision, criterion, finding or repair citing evidence the mission does not hold
 *                                    (a missing artifact represented as present);
 *   EVIDENCE_FROM_ANOTHER_MISSION    evidence cited by one mission that belongs to another;
 *   PIN_ON_UNKNOWN_MISSION / HANDOFF_ON_UNKNOWN_MISSION   a component naming a mission the project does not have.
 *
 * A violation is a fact about the durable rows, never a guess: each check reads only what the rows say. Checks that
 * need rows a truncated read did not return are SKIPPED and say so, never passed silently.
 *
 * Pure: no clock, no I/O.
 */

import type { ProjectBrainRows } from './project-brain-document';

export const PROJECT_BRAIN_COHERENCE_RULES = [
  'COMPLETE_WITH_ACTIVE_WORK', 'COMPLETED_WITH_OPEN_BLOCKER', 'DUPLICATE_COMPLETION', 'NON_MONOTONIC_TRANSITIONS',
  'ORPHAN_REPAIR', 'EVIDENCE_NOT_PRESENT', 'EVIDENCE_FROM_ANOTHER_MISSION', 'PIN_ON_UNKNOWN_MISSION', 'HANDOFF_ON_UNKNOWN_MISSION',
] as const;
export type ProjectBrainCoherenceRule = (typeof PROJECT_BRAIN_COHERENCE_RULES)[number];

export interface ProjectBrainCoherenceViolation {
  readonly rule: ProjectBrainCoherenceRule;
  /** The mission the violation is in (`mission:<runId>`). */
  readonly missionRef: string;
  /** The rows that show it, by reference. */
  readonly refs: readonly string[];
  readonly detail: string;
}

export interface ProjectBrainCoherence {
  /** True only when every check ran and none found a violation. */
  readonly ok: boolean;
  readonly violations: readonly ProjectBrainCoherenceViolation[];
  /** Checks not run because the read that feeds them was truncated: a window cannot prove an absence. */
  readonly skipped: readonly string[];
}

const LIVE_TASK = new Set(['ACTIVE', 'RUNNABLE']);

/** EVERY COHERENCE RULE OVER ONE SNAPSHOT'S ROWS. Deterministic: violations sorted by mission, rule, then refs. */
export function projectBrainCoherence(rows: ProjectBrainRows): ProjectBrainCoherence {
  const violations: ProjectBrainCoherenceViolation[] = [];
  const skipped = new Set<string>();
  const truncated = new Set(rows.truncated);
  const add = (rule: ProjectBrainCoherenceRule, runId: string, refs: readonly string[], detail: string) =>
    violations.push({ rule, missionRef: `mission:${runId}`, refs: [...refs].sort(), detail });
  // A rule that proves an ABSENCE needs the whole set it looks in; a truncated set skips it, by name.
  const complete = (rule: string, ...sets: string[]): boolean => {
    const cut = sets.filter((set) => truncated.has(set));
    if (cut.length > 0) skipped.add(`${rule} (truncated: ${cut.join(', ')})`);
    return cut.length === 0;
  };

  const runs = new Map(rows.missions.map((mission) => [mission.runId, mission]));
  const evidenceRun = new Map(rows.evidence.map((evidence) => [evidence.evidenceId, evidence.runId]));
  const taskRun = new Map(rows.tasks.map((task) => [task.taskId, task.runId]));
  const findingRun = new Map(rows.findings.map((finding) => [finding.findingId, finding.runId]));

  for (const mission of rows.missions) {
    const runId = mission.runId;
    if (mission.state === 'COMPLETED' && complete('COMPLETE_WITH_ACTIVE_WORK', 'tasks')) {
      const live = rows.tasks.filter((task) => task.runId === runId && LIVE_TASK.has(task.state));
      if (live.length > 0) {
        add('COMPLETE_WITH_ACTIVE_WORK', runId, live.map((task) => `task:${task.taskId}`), `the mission is COMPLETED while ${live.length} task(s) are still ${[...new Set(live.map((t) => t.state))].join('/')}`);
      }
    }
    if (mission.state === 'COMPLETED' && complete('COMPLETED_WITH_OPEN_BLOCKER', 'findings')) {
      const open = rows.findings.filter((finding) => finding.runId === runId && finding.blocking && finding.status === 'OPEN');
      if (open.length > 0) add('COMPLETED_WITH_OPEN_BLOCKER', runId, open.map((f) => `finding:${f.findingId}`), `the mission is COMPLETED with ${open.length} blocking finding(s) still OPEN`);
    }
    if (complete('TRANSITIONS', 'transitions')) {
      const transitions = rows.transitions.filter((t) => t.runId === runId).sort((a, b) => a.sequence - b.sequence);
      const completions = transitions.filter((t) => t.toState === 'COMPLETED');
      if (completions.length > 1) add('DUPLICATE_COMPLETION', runId, completions.map((t) => `transition:${t.transitionId}`), `the mission entered COMPLETED ${completions.length} times`);
      // A transition's sequence is the RUN'S VERSION when it was written (julius-postgres.ts), and the version also moves on
      // updates that change no state, so gaps are normal. What may never happen is a repeat: two state changes claiming
      // the same version is a stale write that overwrote a newer one.
      const sequences = transitions.map((t) => t.sequence);
      const strictlyIncreasing = sequences.every((sequence, index) => index === 0 || sequence > sequences[index - 1]!);
      const last = transitions.at(-1);
      if (!strictlyIncreasing) add('NON_MONOTONIC_TRANSITIONS', runId, transitions.map((t) => `transition:${t.transitionId}`), `transition sequences [${sequences.join(',')}] repeat a version`);
      else if (last !== undefined && last.toState !== mission.state) {
        add('NON_MONOTONIC_TRANSITIONS', runId, [`transition:${last.transitionId}`], `the last transition ends in ${last.toState} but the mission reads ${mission.state}: a state written without its transition`);
      }
    }
  }

  if (complete('ORPHAN_REPAIR', 'tasks', 'findings')) {
    for (const repair of rows.repairs) {
      const missing = [
        taskRun.get(repair.originalTaskId) === repair.runId ? null : `task:${repair.originalTaskId}`,
        taskRun.get(repair.repairTaskId) === repair.runId ? null : `task:${repair.repairTaskId}`,
        ...repair.findingIds.map((id) => (findingRun.get(id) === repair.runId ? null : `finding:${id}`)),
      ].filter((ref): ref is string => ref !== null);
      if (missing.length > 0) add('ORPHAN_REPAIR', repair.runId, [`repair:${repair.repairId}`, ...missing], `the repair names ${missing.length} thing(s) its mission does not hold`);
    }
  }

  if (complete('EVIDENCE', 'evidence')) {
    const cite = (runId: string, owner: string, ids: readonly string[]) => {
      for (const id of ids) {
        const holder = evidenceRun.get(id);
        if (holder === undefined) add('EVIDENCE_NOT_PRESENT', runId, [owner, `evidence:${id}`], `${owner} cites evidence the Brain does not hold`);
        else if (holder !== runId) add('EVIDENCE_FROM_ANOTHER_MISSION', runId, [owner, `evidence:${id}`], `${owner} cites evidence of mission ${holder}`);
      }
    };
    for (const decision of rows.decisions) cite(decision.runId, `decision:${decision.decisionId}`, decision.evidenceIds);
    for (const finding of rows.findings) cite(finding.runId, `finding:${finding.findingId}`, finding.evidenceIds);
    for (const repair of rows.repairs) cite(repair.runId, `repair:${repair.repairId}`, repair.evidenceIds);
    for (const criterion of rows.criteria) cite(criterion.runId, `criterion:${criterion.runId}/${criterion.criterionId}`, criterion.linkedEvidenceIds);
  }

  const components = rows.components ?? null;
  if (components !== null && complete('COMPONENT_MISSIONS', 'missions')) {
    for (const pin of components.missionCards) if (!runs.has(pin.runId)) add('PIN_ON_UNKNOWN_MISSION', pin.runId, [`mission:${pin.runId}#card`], 'a card pin names a mission this project read does not hold');
    for (const handoff of components.handoffs) if (!runs.has(handoff.runId)) add('HANDOFF_ON_UNKNOWN_MISSION', handoff.runId, [`mission:${handoff.runId}#handoff`], 'a handoff names a mission this project read does not hold');
  }

  violations.sort((a, b) => (a.missionRef === b.missionRef ? (a.rule === b.rule ? a.refs.join(' ').localeCompare(b.refs.join(' ')) : a.rule.localeCompare(b.rule)) : a.missionRef.localeCompare(b.missionRef)));
  return { ok: violations.length === 0 && skipped.size === 0, violations, skipped: [...skipped].sort() };
}
