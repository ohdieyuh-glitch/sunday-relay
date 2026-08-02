/**
 * SUNDAY RELAY — THE LOOP COMMAND PREVIEW.
 *
 * ONE PROJECTION, rendered by the website composer and the CLI alike. Neither
 * surface formats a label of its own: if the browser says "Unknown" and the
 * terminal says "n/a" for the same fact, one of them is teaching a wrong
 * mental model, and the website↔CLI parity contract exists to stop exactly
 * that. So the words live here, once.
 *
 * WHAT A PREVIEW IS FOR. Money is never spent because a command parsed. A
 * command that requests execution produces a preview the user must confirm,
 * and the preview states — in the user's words, not a schema dump — what would
 * happen: the objective, who would work, what proves it done, and every bound
 * it would run inside. A user who cannot see the target cannot consent to it,
 * which is why `/loop <objective>` shows which roles the active compound agent
 * currently includes rather than silently meaning "all".
 *
 * TRUTHFULNESS. Absent values render `Unknown` or `Not configured` — never
 * `0`, never a plausible default. The labels are imported from mission
 * economics rather than restated, so there is one vocabulary for absence
 * across the whole product.
 *
 * PURE. No clock, no I/O. `observedAt` is supplied by the caller.
 */

import type { RelayAgentRole } from '../agent-operating';
import { NOT_CONFIGURED_LABEL, UNKNOWN_LABEL } from '../economics-barrel';
import type { RelayLoopAvailability } from './loop-availability';
import type { RelayLoopBlocker } from './loop-blockers';
import type { RelayLoopLimits } from './loop-contract';
import {
  RELAY_LOOP_CANONICAL_ALIAS,
  type RelayLoopTargetSelector,
} from './loop-roles';
import type { RelayLoopTarget } from './loop-target';
import { commandRequestsExecution } from './loop-command-parser';
import type { RelayParsedSlashCommand, RelaySlashCommand } from './loop-command-types';

/* ----------------------------------------------------------------- rows */

export interface RelayLoopPreviewRow {
  readonly label: string;
  readonly value: string;
}

export interface RelayLoopCommandPreview {
  /** Exactly what Relay believes the user typed, so a mis-parse is noticed
   *  BEFORE confirmation rather than after execution. */
  readonly raw: string;
  readonly kind: RelaySlashCommand['kind'];
  readonly headline: string;
  /**
   * True only when the command requests execution AND nothing blocks it. A
   * blocked command needs no confirmation because there is nothing to
   * confirm — showing a Confirm button that cannot work is its own small lie.
   */
  readonly requiresConfirmation: boolean;
  readonly rows: readonly RelayLoopPreviewRow[];
  readonly blockers: readonly RelayLoopBlocker[];
  /** Things the user should know that are not blockers. */
  readonly notices: readonly string[];
}

/* -------------------------------------------------------------- helpers */

function roleWords(roles: readonly RelayAgentRole[]): string {
  if (roles.length === 0) return UNKNOWN_LABEL;
  return roles.map((role) => RELAY_LOOP_CANONICAL_ALIAS[role]).join(', ');
}

function boundLabel(value: number | null, unit: string): string {
  if (value === null) return NOT_CONFIGURED_LABEL;
  return `${value} ${unit}`;
}

function moneyBound(value: number | null): string {
  if (value === null) return NOT_CONFIGURED_LABEL;
  return `$${value.toFixed(2)}`;
}

/**
 * Describe the target in the words the user can act on.
 *
 * The distinction that matters: `active_compound_agent` is what `/loop
 * <objective>` means, and naming the roles it currently resolves to is the
 * difference between informed consent and a shrug.
 */
function targetRows(
  selector: RelayLoopTargetSelector,
  target: RelayLoopTarget | null,
): RelayLoopPreviewRow[] {
  const requested =
    selector.requestedExpression === null
      ? 'Your active compound agent (no target was named)'
      : selector.requestedExpression;

  const rows: RelayLoopPreviewRow[] = [{ label: 'Target', value: requested }];

  if (target === null) {
    rows.push({ label: 'Agents', value: UNKNOWN_LABEL });
    return rows;
  }

  rows.push({ label: 'Agents', value: roleWords(target.resolvedRoles) });

  if (target.unavailableRoles.length > 0) {
    rows.push({
      label: 'Unavailable',
      value: target.unavailableRoles
        .map((entry) => `${RELAY_LOOP_CANONICAL_ALIAS[entry.role]} (${entry.availability.replace(/_/g, ' ')})`)
        .join(', '),
    });
  }
  if (target.registryProvenance === null) {
    rows.push({ label: 'Agent data', value: UNKNOWN_LABEL });
  } else if (target.registryProvenance === 'simulated') {
    rows.push({ label: 'Agent data', value: 'Simulated' });
  }
  return rows;
}

function limitRows(limits: RelayLoopLimits): RelayLoopPreviewRow[] {
  return [
    {
      label: 'Max iterations',
      value: limits.maxIterations === null ? 'Unbounded (consented)' : String(limits.maxIterations),
    },
    { label: 'Max duration', value: boundLabel(limits.maxTotalDurationMinutes, 'minutes') },
    { label: 'Spending limit', value: moneyBound(limits.maxTotalSpendUsd) },
    { label: 'Token limit', value: boundLabel(limits.maxTotalTokens, 'tokens') },
    { label: 'Provider-call limit', value: boundLabel(limits.maxTotalProviderCalls, 'calls') },
    { label: 'Parallel slots', value: String(limits.maxConcurrentSlots) },
  ];
}

/* ------------------------------------------------------------- headlines */

function headlineFor(command: RelaySlashCommand): string {
  switch (command.kind) {
    case 'loop_composer':
      return 'Open the Loop Composer';
    case 'loop_catalog':
      return 'Loop catalog — active, scheduled, templates and history';
    case 'loop_create':
      return 'Draft Loop — review before it runs';
    case 'loop_action':
      return `Loop ${command.action}`;
    case 'loop_schedule_composer':
      return 'Open the Scheduled Loop Composer';
    case 'loop_schedule_create':
      return 'Draft scheduled Loop — review before it is armed';
    case 'loop_cron_create':
      return 'Draft Cron Loop — review before it is armed';
    case 'loop_schedule_list':
      return 'Scheduled Loops';
    case 'sloop_composer':
      return 'Open the Swarm Loop Composer';
    case 'sloop_create':
      return 'Draft S-Loop — review before it runs';
    case 'sloop_action':
      return `S-Loop ${command.action}`;
  }
}

/* -------------------------------------------------------------- project */

export interface RelayLoopPreviewInput {
  readonly parsed: RelayParsedSlashCommand;
  readonly availability: RelayLoopAvailability;
  /** Resolved target, when the surface could consult a registry. `null` is
   *  Unknown and renders as such — never as an empty agent list. */
  readonly target: RelayLoopTarget | null;
  readonly limits: RelayLoopLimits;
  /** Whether an independent review would be required. */
  readonly independentReviewRequired: boolean;
}

/**
 * Build the preview both surfaces render.
 *
 * A creation command shows the full bound list. An action command shows only
 * what it addresses — padding it with limits it will not apply would imply
 * `/loop pause` might spend something.
 */
export function projectLoopCommandPreview(
  input: RelayLoopPreviewInput,
): RelayLoopCommandPreview {
  const { parsed, availability } = input;
  const command = parsed.command;
  const rows: RelayLoopPreviewRow[] = [];
  const notices: string[] = [];

  const requestsExecution = commandRequestsExecution(command);

  if (command.kind === 'loop_create' || command.kind === 'sloop_create') {
    rows.push({ label: 'Objective', value: command.objective });
    rows.push(...targetRows(command.target, input.target));
  } else if (command.kind === 'loop_schedule_create') {
    rows.push({ label: 'Schedule request', value: command.scheduleRequest });
    rows.push(...targetRows(command.target, input.target));
    notices.push(
      'The schedule has not been interpreted yet — it is preserved exactly as written and will be shown as a parsed schedule, with its timezone, before it can be armed.',
    );
  } else if (command.kind === 'loop_cron_create') {
    rows.push({ label: 'Cron expression', value: command.cronExpression });
    rows.push({ label: 'Objective', value: command.objective });
    rows.push(...targetRows(command.target, input.target));
    notices.push(
      'The cron expression has not been interpreted yet — its next run and timezone will be shown in plain language before it can be armed.',
    );
  } else if (command.kind === 'loop_action' || command.kind === 'sloop_action') {
    rows.push({ label: 'Loop', value: command.loopId ?? 'The Loop you are viewing' });
  }

  if (requestsExecution) {
    rows.push({
      label: 'Proof of completion',
      value: input.independentReviewRequired
        ? 'Evidence at attested or verified trust, plus an approving independent review'
        : 'Evidence at attested or verified trust',
    });
    rows.push(...limitRows(input.limits));
    notices.push('Nothing runs and nothing is spent until you confirm this contract.');
  }

  if (parsed.family === 'sloop') {
    notices.push(
      `An S-Loop requires an active Unchain session, which grants exactly ${availability.grantedTemporarySlots === 0 ? 'two' : String(availability.grantedTemporarySlots)} temporary agent slots. Unchain expands capacity, never permissions.`,
    );
  }

  return {
    raw: parsed.raw,
    kind: command.kind,
    headline: headlineFor(command),
    requiresConfirmation: requestsExecution && availability.state === 'available',
    rows,
    blockers: availability.blockers,
    notices,
  };
}

/**
 * Render the preview as plain lines.
 *
 * The CLI prints these directly and the website reads the same rows, so the
 * two surfaces cannot describe the same command differently. Deliberately
 * unstyled: colour and layout are a surface's business, wording is not.
 */
export function renderLoopPreviewLines(preview: RelayLoopCommandPreview): string[] {
  const lines: string[] = [preview.headline];
  const width = preview.rows.reduce((max, row) => Math.max(max, row.label.length), 0);
  for (const row of preview.rows) {
    lines.push(`  ${row.label.padEnd(width)}  ${row.value}`);
  }
  for (const blocker of preview.blockers) {
    lines.push(`  BLOCKED  ${blocker.reason.replace(/_/g, ' ')} — ${blocker.detail}`);
    if (blocker.requiredUserAction !== null) lines.push(`           ${blocker.requiredUserAction}`);
  }
  for (const notice of preview.notices) lines.push(`  ${notice}`);
  if (preview.requiresConfirmation) lines.push('  Confirm to compile and start this Loop.');
  return lines;
}
