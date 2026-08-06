import { paint } from './theme';
import type { CliCaps } from './contracts';
import { formatMicros } from '../../shared/llmops';
import type { RelayFigure, RelayOperationsView } from '../../shared/llmops';

/**
 * PROJECT OPERATIONS, ON THE CLI.
 *
 * The same projection the workspace panel renders. Neither surface computes a
 * figure of its own, so `relay project operations` and the website cannot
 * disagree about an error rate — which is the failure a parity contract exists
 * to prevent, and the one nobody notices until two people are reading different
 * numbers off two screens in the same conversation.
 *
 * The rule this file exists to keep: AN UNKNOWN IS PRINTED AS AN UNKNOWN.
 * `figure()` is the only thing here that turns a `RelayFigure` into text, and
 * it has no branch that produces `0` for `known: false`.
 */

const UNKNOWN_NOTE: Record<string, string> = {
  not_observed: 'not observed',
  insufficient_samples: 'too few samples',
  unknown_denominator: 'denominator unknown',
  stale: 'stale',
};

export interface OperationsViewInput {
  readonly caps: CliCaps;
  /**
   * `null` means NO SOURCE IS CONFIGURED for this surface — a different fact
   * from a project that has reported nothing, and the one that was previously
   * being misreported: projecting an empty record made the CLI say "nothing has
   * reported for this project", which implies a source exists and is silent.
   */
  readonly view: RelayOperationsView | null;
}

export function renderOperationsView(input: OperationsViewInput): {
  lines: string[]; json: unknown;
} {
  const p = paint(input.caps);
  const { view } = input;

  if (view === null) {
    return {
      lines: [
        `  ${p.dim('OPERATIONS'.padEnd(18))} ${p.tone('gray', 'NO SOURCE CONFIGURED')}`,
        `  ${p.dim(''.padEnd(18))} ${p.dim('This surface has no operations store wired, so nothing '
          + 'is being measured. That is not the same as a project with nothing to report.')}`,
      ],
      // NOT `null`: the CLI's `emit` uses `result.json ?? {lines}`, so a null
      // json silently fell back to printing the rendered LINES as json — a
      // breaking shape change for every `--json` consumer, introduced by the
      // change that was meant to make this surface more truthful.
      json: { operations: null, reason: 'no operations store is wired on this surface' },
    };
  }

  const figure = (value: RelayFigure, format: (n: number) => string): string => (
    value.known ? format(value.value) : `— (${UNKNOWN_NOTE[value.reason] ?? value.reason})`
  );

  const healthTone = view.health === 'healthy' ? 'cyan'
    : view.health === 'failing' ? 'amber'
      : view.health === 'degraded' ? 'amber' : 'gray';

  const lines: string[] = [
    `  ${p.dim('HEALTH'.padEnd(18))} ${p.tone(healthTone, view.health.toUpperCase())}`,
    `  ${p.dim(''.padEnd(18))} ${p.dim(view.healthReason)}`,
    '',
  ];

  // Waiting on the user comes first: it is the only figure here the reader can
  // personally shorten.
  if (view.waitingOnUserOpen) {
    lines.push(p.tone('amber', `  WAITING ON YOU — ${duration(view.waitingOnUserMs)} so far.`), '');
  } else if (view.waitingOnUserMs > 0) {
    lines.push(p.dim(`  Waited on you for ${duration(view.waitingOnUserMs)}.`), '');
  }

  lines.push(
    `  ${p.dim('ERRORS'.padEnd(18))} ${p.tone('cream', String(view.errorCount))}`
    + (view.unrecoveredErrorCount > 0
      ? p.tone('amber', `  (${view.unrecoveredErrorCount} unrecovered)`) : ''),
    `  ${p.dim('ERROR RATE'.padEnd(18))} ${p.tone('cream', figure(view.errorRate, percent))}`,
    `  ${p.dim('EVALUATIONS'.padEnd(18))} ${p.tone('cream', view.evaluations.total === 0
      ? '—'
      : `${view.evaluations.independent} independent`)}`
    + (view.evaluations.selfAssessed > 0
      // Named rather than folded in. An agent grading its own work is a real
      // thing that happened, and it is not a review.
      ? p.dim(`, ${view.evaluations.selfAssessed} self-assessed`) : ''),
    `  ${p.dim('REPAIR LOOPS'.padEnd(18))} ${p.tone('cream', view.repairs.loops === 0
      ? '—'
      : `${view.repairs.converged} converged`)}`
    + (view.repairs.endedUnfixed > 0
      ? p.tone('amber', `, ${view.repairs.endedUnfixed} ended unfixed`) : '')
    + (view.repairs.inProgress > 0 ? p.dim(`, ${view.repairs.inProgress} running`) : ''),
    '',
  );

  /* ---- tokens and money, as economics recorded them ---- */
  const spend = view.spend;
  if (spend === null) {
    lines.push(p.dim('  No economics source is wired, so no tokens or cost are recorded.'), '');
  } else {
    const t = spend.tokens;
    lines.push(
      `  ${p.dim('TOKENS'.padEnd(18))} ${p.tone('cream', t.total)}`
      + p.dim(`  (${t.input} in, ${t.output} out, ${t.cachedInput} cached)`)
      + (t.unreadable > 0 ? p.tone('amber', `  ${t.unreadable} unreadable`) : ''),
    );
    lines.push(`  ${p.dim('COST'.padEnd(18))} ${spend.actual.length === 0
      ? p.dim('—')
      : p.tone('cream', spend.actual
        .map((total) => formatMicros(total.currency, total.amountMicros)).join(', '))}`);
    if (spend.estimated.length > 0) {
      // Never added to actual. A projection and a bill are different facts.
      lines.push(`  ${p.dim('ESTIMATED'.padEnd(18))} ${p.dim(spend.estimated
        .map((total) => formatMicros(total.currency, total.amountMicros)).join(', '))}`);
    }
    // Said beside the total, so a small total cannot read as a cheap run.
    if (spend.amountUnknown > 0) {
      lines.push(p.tone('amber', `  ${spend.amountUnknown} receipt(s) have no cost recorded yet.`));
    }
    if (spend.voidedOrDisputed > 0) {
      lines.push(p.dim(`  ${spend.voidedOrDisputed} receipt(s) voided or disputed, excluded.`));
    }
    if (spend.fixtureSourced > 0) {
      // Simulated data says so.
      lines.push(p.tone('amber', `  ${spend.fixtureSourced} receipt(s) come from a development fixture, not a bill.`));
    }
    lines.push('');
  }

  if (view.droppedErrors > 0) {
    // The count and the rate above are exact; the by-kind list is not.
    lines.push(p.dim(`  ${view.droppedErrors} older error(s) evicted; the counts above `
      + 'are exact and any breakdown covers the kept ones only.'), '');
  }

  lines.push(p.dim('  LATENCY'));
  if (view.latency.length === 0) {
    lines.push(p.dim('  No phase has been timed for this project.'));
  } else {
    lines.push(p.dim(`  ${'PHASE'.padEnd(16)}${'N'.padEnd(6)}${'p50'.padEnd(12)}${'p95'.padEnd(24)}MAX`));
    for (const phase of view.latency) {
      lines.push(
        `  ${p.tone('cream', phase.phase.padEnd(16))}`
        + `${String(phase.samples).padEnd(6)}`
        + `${figure(phase.p50Ms, ms).padEnd(12)}`
        + `${figure(phase.p95Ms, ms).padEnd(24)}`
        + `${figure(phase.maxMs, ms)}`,
      );
    }
  }
  if (view.droppedLatency > 0) {
    lines.push(p.dim(`  Showing the most recent samples; ${view.droppedLatency} older `
      + 'one(s) evicted, so these figures describe recent history.'));
  }
  if (view.missingPhases.length > 0) {
    // Named, so nobody reads an absent row as a fast one.
    lines.push(p.dim(`  Not timed: ${view.missingPhases.join(', ')}.`));
  }
  lines.push('');

  if (view.waits.length > 0) {
    lines.push(p.dim('  WAITING'));
    for (const wait of view.waits) {
      lines.push(
        `  ${p.tone('cream', wait.reason.padEnd(20))}`
        + p.dim(`${duration(wait.totalMs)} over ${wait.intervals} `
          + `interval${wait.intervals === 1 ? '' : 's'}`
          + (wait.openIntervals > 0 ? ' (still waiting)' : '')),
      );
    }
    lines.push('');
  }

  lines.push(p.dim(view.newestSignalAt === null
    ? '  Nothing has reported for this project.'
    : `  Newest signal ${view.newestSignalAt}.`));

  return { lines, json: view };
}

/* ------------------------------------------------------------ formatting */

const ms = (value: number): string => (value >= 1000
  ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}s`
  : `${Math.round(value)}ms`);

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const duration = (value: number): string => {
  if (value < 1000) return `${Math.round(value)}ms`;
  const seconds = Math.floor(value / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};
