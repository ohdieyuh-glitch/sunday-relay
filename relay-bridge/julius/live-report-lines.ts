/**
 * THE LIVE REPORT'S TICK, SCOPE, RESEARCH, WORKER-REFUSAL AND LEARNING LINES, AS PRINTERS (P4).
 *
 * The evidence allowlist (`scripts/julius-live-evidence.mjs`) keeps a line only when it matches a known
 * shape. These lines were printed inline, and the allowlist's tests hand-wrote each one. When the tick budget
 * and the tick account gained `disagreement=` and `architecture=`, the printed lines stopped matching.
 * Every paid run's artifact lost them: its tick budget, what the run consumed, its peer execution scope and
 * what research it could reach. The tests, still holding the old shapes, stayed green. (The Actions job log
 * kept every line; only the published artifact lost them.)
 *
 * Printed here, the allowlist's tests generate their lines from these functions. A printer that changes
 * shape without the allowlist then fails a test instead of emptying the artifact.
 */

import type { JuliusTickBudget } from '../../src/relay/mission/julius/julius-tick-budget';
import type { JuliusLearningMetrics } from '../../src/relay/mission/julius/julius-learning-loop';
import { juliusLearningProposal } from '../../src/relay/mission/julius/julius-learning-record';
import type { LiveReachReadiness } from '../../src/relay/mission/live-reach';
import type { CoderRuntimeSchedule } from '../hosted-coding-agent/coder-envelope';
import type { DriveOutcome, DriveTickAccount, JuliusDriveDeadline, JuliusLearningOutcome } from './live-composition';

/**
 * EVERY PRINTED LINE IS ONE PHYSICAL LINE (JUJU's review of 1cee61fd).
 *
 * Several printed fields carry text Julius did not write: an evidence row's summary, a finding's claim, an error
 * message. Each physical line of the log is judged alone. The allowlist keeps or drops it by its shape, and the gate
 * reads `RESULT:` and `  run:` lines by where they begin. A summary carrying a line break and then
 * `RESULT: COMPLETED after 9 ticks` therefore printed a line of its own, and the allowlist kept it as the
 * entrypoint's own word on the run. The entrypoint's writers pass every line through here, so a line break inside
 * a line is shown as an escape and never starts a line. A line with no break is returned unchanged.
 *
 * The breaks are CR, LF, NEL (U+0085) and the Unicode line and paragraph separators (U+2028, U+2029). The last
 * three are built from their code points, never written into this source.
 */
const UNICODE_BREAKS = [0x85, 0x2028, 0x2029].map((code) => String.fromCharCode(code)).join('');
const LINE_BREAK = new RegExp(`\\r\\n|[\\r\\n${UNICODE_BREAKS}]`, 'gu');
export function liveOneLine(text: string): string {
  return text.replace(LINE_BREAK, (found) => (found === '\r\n' ? '\\r\\n'
    : found === '\r' ? '\\r'
      : found === '\n' ? '\\n'
        : `\\u${found.charCodeAt(0).toString(16).padStart(4, '0')}`));
}

/** What the mission's structure permits, said before the first dispatch. */
export function liveTickBudgetLine(
  budget: Pick<JuliusTickBudget, 'plannedTicks' | 'hardMaxTicks' | 'reason' | 'version'>,
  override: number | undefined,
): string {
  return `  tick budget: planned=${budget.plannedTicks} hard_max=${budget.hardMaxTicks} ${budget.reason} override=${override ?? 'none'} version=${budget.version}`;
}

/**
 * THE STAGE DEADLINE THE DRIVE ENFORCES (audit F3), said before the first dispatch beside the wall clock deadline: the
 * instant every stage must end by, the job's limit it is derived from, the reserve after LIVE and each role's stage
 * bound. UNKNOWN when the job's start was not recorded, in which case nothing is enforced.
 */
export function liveStageDeadlineLine(deadline: JuliusDriveDeadline | null): string {
  if (deadline === null) return '  stage deadline: UNKNOWN (no job start recorded; not enforced)';
  const bounds = Object.entries(deadline.stageBoundMs).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([role, ms]) => `${role}:${ms}`).join(',');
  return `  stage deadline: every stage must end by ${new Date(deadline.stagesEndByMs).toISOString()} (job limit ${new Date(deadline.hardLimitAtMs).toISOString()}; reserve_after_live_ms=${deadline.reserveAfterLiveMs}; stage_bounds_ms=${bounds || 'none'})`;
}

/**
 * THE OPT-IN CODER SESSION BUDGET, said before the first dispatch beside the stage deadline it lengthens. Nothing at all for a
 * contract that declares none (so every existing contract's report is what it always was). Closed tokens and numbers only, and the
 * evidence allowlist keeps exactly these shapes.
 *
 * `repair_cycles_reduced=no` is a fact, not a setting: the mechanism never lowers a declared cycle count. When fewer cycles are
 * GUARANTEED at worst case than were declared, a second line says so plainly, and says what governs the rest (the stage stop line,
 * which starts a repair only while it can still end before the job's limit).
 */
export function liveCoderRuntimeBudgetLines(schedule: CoderRuntimeSchedule | null): string[] {
  if (schedule === null) return [];
  const lines = [
    `  coder session budget: minutes=${schedule.coderRuntimeMinutes} attempt_deadline_ms=${schedule.attemptDeadlineMs}`
    + ` repair_cycles_declared=${schedule.declaredRepairCycles} repair_cycles_guaranteed_at_worst_case=${schedule.guaranteedRepairCycles}`
    + ` repair_cycles_if_one_full_attempt_per_dispatch=${schedule.singleAttemptCyclesThatFit}`
    + ` main_path_worst_case_ms=${schedule.mainPathWorstCaseMs} job_limit_ms=${schedule.limitMs} repair_cycles_reduced=no`,
  ];
  if (!schedule.allDeclaredCyclesGuaranteed) {
    lines.push('  coder session budget notice: repair cycles beyond the worst-case guarantee start only while the stage stop line allows; none is removed');
  }
  return lines;
}

/** What the run consumed. The entrypoint prints it between RESULT (and its cause) and the `run:` line. */
export function liveTickAccountLine(ticks: DriveTickAccount): string {
  return `  ticks: consumed=${ticks.ticksConsumed} allowance=${ticks.allowance} remaining=${ticks.ticksRemaining} beyond_main_path=${ticks.beyondMainPath} disagreement=${ticks.disagreementTicks} architecture=${ticks.architectureTicks} retries=${ticks.retries} exhausted=${ticks.exhausted ? 'yes' : 'no'}`;
}

/** Which workflow attempt the run's peer records are scoped to (`liveExecutionScope`). */
export function liveExecutionScopeLine(scope: string): string {
  return `  peer execution scope: ${scope}`;
}

/** The research a contract granted, and what each granted capability can actually reach, said before any money is spent. */
export function liveResearchLines(
  research: {
    readonly roles: readonly string[];
    readonly allowances: number;
    readonly observedBackends: number;
    readonly reach: readonly { readonly source: string; readonly capability: string; readonly readiness: LiveReachReadiness }[];
  } | null,
): string[] {
  if (research === null) return ['  research: NOT AUTHORISED (no contract clause) — every ask is refused research_not_authorized'];
  // A sealed clause may name no role: the seal validates each role it is given and requires none. Such a
  // clause grants nobody anything, and says so as the closed token `(none)`. An empty join printed
  // `authorised for  across …`, which the allowlist's shape dropped (JUJU's review of ef0c09c3, F4).
  const roles = research.roles.length === 0 ? '(none)' : research.roles.join(', ');
  return [
    `  research: authorised for ${roles} across ${research.allowances} allowance(s); ${research.observedBackends} observed backend(s)`,
    ...research.reach.map((row) => `    ${row.source}/${row.capability}: ${row.readiness}${row.readiness === 'ready' ? '' : ' — retrieval will be refused'}`),
  ];
}

/** WHY a Claude auth mode was refused (`resolveClaudeAuthMode`); the RESULT: BLOCKED that follows says only that it was. */
export function liveClaudeAuthRefusedLine(refused: { readonly refusal: string; readonly because: string }): string {
  return `  CLAUDE AUTH: REFUSED — ${refused.refusal}: ${refused.because}`;
}

/**
 * THE LIVE WORKERS COULD NOT BE RESOLVED, after the preflight passed. This path printed an unindented
 * `BLOCKED <role>` that the allowlist's `^  BLOCKED` did not keep, and returned with no RESULT line, so its
 * artifact said nothing about what happened. It now states each role's problem and the outcome. Nothing has
 * been submitted at this point, and no provider has been contacted.
 */
export function liveWorkersBlockedLines(problems: readonly { readonly role: string; readonly missing: readonly string[] }[]): string[] {
  return [
    ...problems.map((problem) => `  BLOCKED ${problem.role}: ${problem.missing.join(', ')}`),
    `RESULT: BLOCKED — live_workers_unresolved: ${problems.map((problem) => problem.role).join(', ')}; nothing was submitted and no provider was contacted.`,
  ];
}

/**
 * V6 G-1: WHAT THE CONTRACT'S `approvalGates` CLAUSE HOLDS FOR A PERSON, said in the preflight before anything is
 * submitted. Ungated (no clause): no line at all, so an ungated mission's output is unchanged. Closed tokens only;
 * the gate's `reason` is not printed (`scripts/julius-live-evidence.mjs` keeps exactly this shape).
 */
export function liveApprovalGatesLine(
  gates: readonly { readonly operation: string; readonly roles: readonly string[]; readonly taskTypes: readonly string[] }[] | undefined,
): string | null {
  if (gates === undefined) return null;
  return `  approval gates: ${gates.length} (${gates.map((gate) => `${gate.operation} role=${gate.roles.join(',')} task=${gate.taskTypes.join(',')}`).join('; ')})`;
}

/** V6 G-3: the entrypoint's exit for a run held on its declared approval gate. Distinct from 0, 1, 2 and 5. */
export const JULIUS_EXIT_HELD_FOR_APPROVAL = 3;

/**
 * THE HELD-FOR-APPROVAL REPORT, or null (V6 G-3).
 *
 * Non-null in exactly one case: the contract declares an approval gate (`gated`), the drive says the run is held
 * for an approval (`heldForApproval`: BLOCKED on RUN_AWAITING_APPROVAL) and the store holds the PENDING
 * approval(s) it is held on. Then the run has not ended and has not failed; a person is being asked. The lines are
 * one `HELD_FOR_APPROVAL:` per approval, the run, the tick account and the tasks, and NO `RESULT:` line (a held job
 * is no answer, and the Beta Gate reads only lines that start with `RESULT:`); the entrypoint prints them and
 * returns `JULIUS_EXIT_HELD_FOR_APPROVAL`.
 *
 * Null in every other case, and the entrypoint then prints the report it always printed, unchanged: an ungated
 * run that somehow stopped on an approval, or a held run whose approval could not be read, keeps RESULT + exit 1.
 */
export function liveHeldForApprovalLines(input: {
  readonly outcome: Pick<DriveOutcome, 'heldForApproval' | 'tickAccount'>;
  readonly runId: string;
  readonly gated: boolean;
  readonly pending: readonly { readonly approvalId: string; readonly operation: string; readonly taskId: string | null }[];
  readonly tasks: readonly { readonly taskId: string; readonly role: string; readonly taskType: string; readonly state: string }[];
}): string[] | null {
  if (!input.gated || !input.outcome.heldForApproval || input.pending.length === 0) return null;
  return [
    ...input.pending.map((gate) => `HELD_FOR_APPROVAL: run ${input.runId} approval ${gate.approvalId} operation ${gate.operation} task ${gate.taskId ?? 'none'}`),
    `  run: ${input.runId}`,
    ...(input.outcome.tickAccount === null ? [] : [liveTickAccountLine(input.outcome.tickAccount)]),
    ...input.tasks.map((task) => `  task ${task.taskId} [${task.role}/${task.taskType}] → ${task.state}`),
  ];
}

/* ------------------------------------------------------- the learning record */

const measured = (value: number | null): string => (value === null ? 'unknown' : String(value));
const named = (values: readonly string[]): string => (values.length === 0 ? 'none' : values.join(','));

/** One arm's projection, as it was recorded or compared. */
function liveLearningMetricsLine(runId: string, trajectoryRows: number | null, metrics: JuliusLearningMetrics): string {
  return `LEARNING: metrics run=${runId} trajectory_rows=${measured(trajectoryRows)} dispatches=${metrics.dispatches} retries=${metrics.retries} repairs=${metrics.repairs} recoveries=${metrics.recoveries} fallbacks=${metrics.fallbacks} findings=${metrics.findings} verified_completions=${metrics.verifiedCompletions} known_usd_micros=${metrics.knownUsdMicros} cost_complete=${metrics.costComplete ? 'yes' : 'no'} average_duration_ms=${measured(metrics.averageDurationMs)} known_input_tokens=${measured(metrics.knownInputTokens)} known_output_tokens=${measured(metrics.knownOutputTokens)} unknown_usage_components=${metrics.unknownUsageComponents}`;
}

/**
 * WHAT THE LEARNING LOOP'S CALLER RECORDED FOR A REGISTERED ARM (E9-a), said in the job log as well as the
 * ledger: the arm and its record, its measurement and, on arm WITH, the comparison, each declared dimension and
 * the gate's decision. Closed tokens, run ids, the lower-case registration digest and numbers only, so each line
 * has one shape the allowlist keeps. A dimension name is never glued to a verdict (`dimension=… verdict=…`): a
 * camel-case name and an upper-case verdict in one 32-character run would read as an opaque secret and be withheld.
 * Printed BEFORE the RESULT line, so the `run:` line stays directly under it.
 */
export function liveLearningLines(outcome: Omit<JuliusLearningOutcome, 'lines'>): string[] {
  const lines = [`LEARNING: arm=${outcome.registration.arm} run=${outcome.runId} registration=${outcome.registration.registrationDigest} state=${outcome.runState} record=${outcome.record}`];
  if (outcome.metrics === null) return lines;
  lines.push(liveLearningMetricsLine(outcome.runId, outcome.trajectoryRows, outcome.metrics));
  const pair = outcome.pair;
  if (pair === null) return lines;
  const { comparison, decision } = pair;
  lines.push(`LEARNING: comparison=${comparison.outcome}${comparison.outcome === 'COMPARED' ? '' : ` reason=${comparison.reasonCode}`} without=${pair.withoutRunId} without_state=${pair.withoutRunState ?? 'unknown'} without_trajectory_rows=${measured(pair.withoutTrajectoryRows)}`);
  if (comparison.outcome === 'COMPARED') {
    lines.push(liveLearningMetricsLine(pair.withoutRunId, pair.withoutTrajectoryRows, comparison.without));
    for (const delta of comparison.deltas) {
      lines.push(`LEARNING: delta dimension=${delta.dimension} verdict=${delta.verdict} without=${measured(delta.without)} with=${measured(delta.with)} bounded=${delta.bounded ? 'yes' : 'no'}`);
    }
  }
  lines.push(`LEARNING: decision=${decision.outcome}${decision.outcome === 'REFUSE' ? ` reason=${decision.reasonCode}` : ''} improved=${named(decision.outcome === 'PROMOTE' ? decision.improved : [])} regressed=${named(decision.outcome === 'REFUSE' ? decision.regressed : [])} marginal_value=${decision.outcome === 'PROMOTE' ? String(decision.marginalValue) : 'none'} proposal=${juliusLearningProposal(decision)}`);
  return lines;
}

/** The caller could not record the arm. The tail is an error message, kept like `  cause:` and screened the same way. */
export function liveLearningFailedLine(error: unknown): string {
  return `LEARNING: NOT RECORDED — ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`;
}
