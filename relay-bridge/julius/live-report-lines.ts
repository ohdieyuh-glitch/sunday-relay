/**
 * THE LIVE REPORT'S TICK, SCOPE, RESEARCH AND WORKER-REFUSAL LINES, AS PRINTERS (P4).
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
import type { LiveReachReadiness } from '../../src/relay/mission/live-reach';
import type { DriveTickAccount } from './live-composition';

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
  return [
    `  research: authorised for ${research.roles.join(', ')} across ${research.allowances} allowance(s); ${research.observedBackends} observed backend(s)`,
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
