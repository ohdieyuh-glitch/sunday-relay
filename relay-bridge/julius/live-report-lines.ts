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
import { projectJuliusSlotLedger, type JuliusBudgetRow } from '../../src/relay/mission/julius/julius-slot-ledger';
import type { JuliusTimelineReader } from '../../src/relay/mission/julius/julius-runtime-api';
import type { DriveTickAccount, JuliusDriveDeadline, JuliusLearningOutcome } from './live-composition';

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

/* ------------------------------------------------- the accounting key and rollup */

/**
 * THE KEY TO THE BUNDLE'S MONEY AND TOKEN COLUMNS, AND THE ROLLUP THE SQL EXPORT CANNOT WRITE.
 *
 * Paid run 39202992515 was read by the Independent Reviewer, who found four things a reader could not settle from
 * the bundle alone. The files themselves (`cost-accounting.tsv`, `budget.tsv`, `effort.tsv`) are written by SQL in
 * `.github/julius-live-evidence-dump.sh`, which this change does not touch. So the same facts are said here, in
 * the mission's own evidence, as `ACCOUNTING:` lines printed AFTER everything else (after the verification
 * decisions), so no line the gate reads by position (`RESULT:` then `  run:`) moves:
 *
 *   1. A SUBSCRIPTION DISPATCH'S RUNTIME-REPORTED COST HAD NO AGGREGATE. `cost-accounting.tsv` counted the coder as
 *      one UNKNOWN component with `known_usd_micros` 0 while `budget.tsv` settled the same coder `NOT_APPLICABLE` /
 *      `SUBSCRIPTION` with a runtime-reported figure. The role lines below carry that figure as its OWN column,
 *      `runtime_reported_usd_micros`. It is never added to `billed_known_usd_micros` (nobody was charged it), never
 *      converted from tokens, and a settlement that carries neither a bill nor a runtime figure stays unknown.
 *   2. THE POOL HAD NO FINAL ROW. `budget.tsv` `remaining_usd_micros` is the pool at the moment of each allocation, so it
 *      reflects reservations only. The pool line states the pool after settlement, by the one charge rule the ledger
 *      itself uses (`projectJuliusSlotLedger`): known at its bill, runtime-reported at its figure, unknown at what it
 *      HELD. It is a report of that rule and enforces nothing; no limit, ceiling or allocation reads it.
 *   3. THREE TOKEN INSTRUMENTS WERE NAMED NOWHERE. The legend defines them from the code that fills each column.
 *   4. THE RESERVATION ROWS' TIMESTAMPS AND THE REVIEWER'S KEY LINE are explained, not changed.
 */
export const LIVE_ACCOUNTING_LEGEND: readonly string[] = Object.freeze([
  "ACCOUNTING: legend money — billed_known_usd_micros is only a provider-reported or usage-measured amount, money someone was charged; runtime_reported_usd_micros is the runtime's own price for a subscription-backed dispatch (NOT_APPLICABLE basis), consumption and not a bill, never converted from tokens and never added to billed_known_usd_micros; unknown_held_usd_micros is what settlements reporting no amount HELD, which is not a cost of zero and not a cost of that amount",
  "ACCOUNTING: legend tokens_ledger — input_tokens and output_tokens in effort and worker-diagnostics are the runtime result message's own top-level usage block as the Julius ledger recorded it, empty when the result carried none",
  "ACCOUNTING: legend tokens_sdk_result — result_model_first_input_tokens, result_model_first_output_tokens and the second and third entries are the result message's modelUsage entries, one per model the runtime named, largest output first, exactly as the runtime keyed them",
  'ACCOUNTING: legend tokens_stream_floor — stream_input_tokens, stream_output_tokens, stream_cache_read_input_tokens and stream_cache_creation_input_tokens are a sum over the assistant turns whose usage block was readable (stream_usage_messages of them), a floor and never a total or a cost',
  'ACCOUNTING: legend tokens_reconciliation — the three token instruments are not reconciled with one another and none is a provider total; this harness does not state whether each counts cached input; no token figure is converted to money',
  'ACCOUNTING: legend timing — started_at and process_started name the worker process start and provider_request_started is blank unless the adapter observed one; none of them is when a reservation was opened, which is occurred_at on its budget.reserved row',
]);

const accountingNumber = (value: number | null): string => (value === null ? 'unknown' : String(value));
const accountingNum = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
/** A role printed in an allowlisted line is a closed token; anything else is named as unrecognised, never echoed. */
const accountingRole = (role: string): string => (/^[A-Z][A-Z_]{0,39}$/u.test(role) ? role : 'UNRECOGNISED_ROLE');

/**
 * THE LEGEND, THEN ONE LINE PER ROLE THAT OPENED A RESERVATION, THEN THE POOL AFTER SETTLEMENT.
 * Every figure comes from the run's own budget rows; a figure the rows do not carry is `unknown`, never zero.
 */
export function liveAccountingLines(runId: string, rows: readonly JuliusBudgetRow[]): string[] {
  // The pool the run opened with: `remaining_usd_micros` on its FIRST allocation row, which is read before
  // any reservation has been taken from it. No such row means the opening is unknown, and so is what remains.
  const firstAllocation = rows.find((row) => row.type === 'budget.allocated');
  const opening = firstAllocation === undefined ? null : accountingNum(firstAllocation.facts.remainingUsdMicros);
  const ledger = projectJuliusSlotLedger({ runId, policy: null, policyVersion: 'accounting-report', ceilingUsdMicros: opening ?? 0, rows });
  let reservedTotal = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.type !== 'budget.reserved') continue;
    const id = typeof row.facts.reservationId === 'string' ? row.facts.reservationId : null;
    const held = accountingNum(row.facts.usdMicros);
    if (id === null || held === null || seen.has(id)) continue;
    seen.add(id);
    reservedTotal += held;
  }
  const lines = [...LIVE_ACCOUNTING_LEGEND];
  const total = { known: 0, execution: 0, unknown: 0, outstanding: 0, released: 0 };
  for (const slot of Object.keys(ledger.bySlot).sort()) {
    const account = ledger.bySlot[slot]!;
    if (account.reservationsOpened === 0) continue;
    total.known += account.settledKnownUsdMicros;
    total.execution += account.settledExecutionUsdMicros;
    total.unknown += account.settledUnknownUsdMicros;
    total.outstanding += account.outstandingUsdMicros;
    total.released += account.releasedUsdMicros;
    lines.push(`ACCOUNTING: role run=${runId} role=${accountingRole(slot)} reservations=${account.reservationsOpened} billed_known_usd_micros=${account.settledKnownUsdMicros} billed_known_reservations=${account.settledKnownCount} runtime_reported_usd_micros=${account.settledExecutionUsdMicros} runtime_reported_reservations=${account.settledExecutionCount} unknown_held_usd_micros=${account.settledUnknownUsdMicros} unknown_reservations=${account.settledUnknownCount} unsettled_usd_micros=${account.outstandingUsdMicros} unsettled_reservations=${account.outstandingCount} released_usd_micros=${account.releasedUsdMicros}`);
  }
  const remaining = opening === null ? null : ledger.unallocatedUsdMicros;
  lines.push(`ACCOUNTING: pool run=${runId} opening_usd_micros=${accountingNumber(opening)} reserved_total_usd_micros=${reservedTotal} billed_known_usd_micros=${total.known} runtime_reported_usd_micros=${total.execution} unknown_held_usd_micros=${total.unknown} unsettled_usd_micros=${total.outstanding} released_usd_micros=${total.released} final_remaining_usd_micros=${accountingNumber(remaining)} basis=slot_ledger_charge_rule`);
  return lines;
}

const ACCOUNTING_TIMELINE_PAGE = 500;

/**
 * THE RUN'S BUDGET ROWS, PAGED TO THE END, AS LINES. Evidence only: a reader that fails says so in one line and
 * the mission's outcome and exit code are untouched, because nothing here is read by a limit or a gate's verdict.
 */
export async function liveAccountingLinesFor(reader: JuliusTimelineReader, runId: string, projectId: string): Promise<string[]> {
  try {
    const rows: JuliusBudgetRow[] = [];
    let since = 0;
    for (;;) {
      const page = await reader.timeline({ runId, projectId, sinceSequence: since, limit: ACCOUNTING_TIMELINE_PAGE });
      for (const entry of page.entries) {
        since = Math.max(since, entry.sequence);
        if (entry.type === 'budget.allocated' || entry.type === 'budget.reserved' || entry.type === 'budget.settled') {
          rows.push({ type: entry.type, taskId: entry.taskId, facts: entry.facts });
        }
      }
      if (!page.hasMore || page.entries.length === 0) break;
    }
    return liveAccountingLines(runId, rows);
  } catch (error) {
    return [`ACCOUNTING: NOT RECORDED — ${error instanceof Error ? error.message.slice(0, 300) : 'unknown error'}`];
  }
}

/**
 * WHAT THE PREFLIGHT'S PRESENCE REPORT DOES AND DOES NOT SAY ABOUT THE REVIEWER'S KEY. `XAI_API_KEY: MISSING` in
 * the mission's evidence is this process's environment only; the Hermes reviewer reads its key from its own profile
 * and the readiness probe tests the job's key. The bundle prints no key value, fragment or fingerprint (the
 * codebase has no credential-fingerprint helper), so it cannot tie the billed key to the probe, and says so.
 */
export const LIVE_REVIEWER_KEY_IDENTITY_LINE =
  '  key identity: the XAI_API_KEY line above reports presence in this process only and does not identify the key the reviewer billed or the key the readiness probe tested; no key value, fragment or fingerprint is printed, so this bundle cannot tie them together';
