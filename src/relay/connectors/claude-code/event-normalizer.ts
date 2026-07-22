import { RELAY_PROTOCOL_VERSION } from '../../protocol/version';
import type { EventDraft } from '../../protocol/envelopes';
import type { ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';
import type { ParsedStreamState } from './stream-parser';
import type { ClaudeRunOutcome } from './process-runner';

/**
 * Event normalizer (Prompt 8) — PURE. Maps live Claude activity into
 * normalized Relay events (provenance 'live', source 'coding-agent'). Only
 * SAFE activity is surfaced: reading/searching/editing named files, session
 * lifecycle, and the report. Hidden reasoning is never emitted (it was
 * already dropped by the parser; the count is reported as a bare number).
 * Tool arguments are sanitized to file names/patterns before display.
 */

export interface NormalizeContext {
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  workspaceId: WorkspaceRefId;
  adapterId: string;
  attempt: number;
  correlationId?: string;
  now: string;
}

const draft = (
  ctx: NormalizeContext,
  kind: EventDraft['kind'],
  safeSummary: string,
  payload: Record<string, unknown> = {},
  source: EventDraft['source'] = 'coding-agent',
): EventDraft => ({
  protocolVersion: RELAY_PROTOCOL_VERSION,
  at: ctx.now,
  projectId: ctx.projectId,
  runId: ctx.runId,
  taskId: ctx.taskId,
  source,
  kind,
  provenance: 'live',
  classification: 'unverified-claim',
  safeSummary: safeSummary.slice(0, 1000),
  payload,
  correlationId: ctx.correlationId,
  refs: { workspaceId: ctx.workspaceId },
});

const MAX_ACTIVITY_EVENTS = 40;

/** Build the normalized event stream for one completed Claude run. */
export function normalizeClaudeRun(
  ctx: NormalizeContext,
  parsed: ParsedStreamState,
  outcome: ClaudeRunOutcome,
): EventDraft[] {
  const events: EventDraft[] = [];

  events.push(
    draft(ctx, ctx.attempt === 1 ? 'agent.session_started' : 'agent.session_resumed',
      ctx.attempt === 1
        ? `Live Claude session started (${parsed.sessionId ? 'session captured' : 'no session id yet'}).`
        : 'Live Claude session resumed for one focused repair.',
      { attempt: ctx.attempt, hasSession: parsed.sessionId !== null }),
  );

  if (parsed.initSeen) {
    events.push(draft(ctx, 'agent.initialized',
      `Claude initialized${parsed.model ? ` (model ${parsed.model})` : ''}.`,
      { model: parsed.model ?? null }, 'system'));
  }

  // Safe activity — bounded, sanitized, hidden reasoning already excluded.
  let shown = 0;
  for (const activity of parsed.toolActivity) {
    if (shown >= MAX_ACTIVITY_EVENTS) break;
    const target = activity.targets[0] ?? '';
    events.push(draft(ctx, 'agent.activity_observed',
      `${activity.tool}${target ? ` ${target}` : ''}`.slice(0, 200),
      { tool: activity.tool }));
    shown += 1;
  }
  if (parsed.thinkingBlocksOmitted > 0) {
    events.push(draft(ctx, 'agent.activity_observed',
      `${parsed.thinkingBlocksOmitted} internal reasoning block(s) omitted from Relay output.`,
      { omittedReasoningBlocks: parsed.thinkingBlocksOmitted }, 'system'));
  }
  if (parsed.malformedLineCount > 0 || parsed.unknownRecordCount > 0) {
    events.push(draft(ctx, 'agent.malformed_output',
      `Non-critical stream records ignored: ${parsed.malformedLineCount} malformed, ${parsed.unknownRecordCount} unknown.`,
      { malformed: parsed.malformedLineCount, unknown: parsed.unknownRecordCount }, 'system'));
  }

  // Terminal event.
  if (outcome.cancelled) {
    events.push(draft(ctx, 'agent.process_cancelled',
      `Claude process cancelled (${outcome.termination.replace(/_/g, ' ')}).`,
      { termination: outcome.termination }, 'relay-core'));
  } else if (outcome.timedOut) {
    events.push(draft(ctx, 'agent.process_timed_out',
      `Claude process timed out after ${outcome.durationMs}ms (${outcome.termination.replace(/_/g, ' ')}).`,
      { durationMs: outcome.durationMs }, 'relay-core'));
  } else if (outcome.spawnError) {
    events.push(draft(ctx, 'agent.process_failed', 'Claude process failed to start or run.', {}, 'relay-core'));
  } else if (parsed.isError) {
    events.push(draft(ctx, 'agent.process_failed',
      `Claude reported ${parsed.resultSubtype ?? 'an error'}.`, { subtype: parsed.resultSubtype }, 'relay-core'));
  } else {
    events.push(draft(ctx, 'agent.report_created',
      'Claude execution report received (claims only — not evidence).', {}));
    events.push(draft(ctx, 'agent.process_completed',
      `Claude process completed (${parsed.usage.numTurns ?? '?'} turn(s), ${outcome.durationMs}ms).`,
      { turns: parsed.usage.numTurns, durationMs: outcome.durationMs }, 'relay-core'));
  }

  return events;
}
