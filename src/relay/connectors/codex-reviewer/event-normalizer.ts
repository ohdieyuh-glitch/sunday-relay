import { RELAY_PROTOCOL_VERSION } from '../../protocol/version';
import type { EventDraft, RelayEventKind } from '../../protocol/envelopes';
import type { EventSource } from '../../protocol/enums';
import type { ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';
import type { ParsedReviewerStream } from './stream-parser';

/**
 * Codex Reviewer event normalizer (Prompt 8.3) — PURE. Projects the parsed
 * reviewer stream + process outcome into normalized `reviewer.*` EventDrafts
 * with provenance 'live' and classification 'unverified-claim'. These feed the
 * Live Terminal, Relay Dog (REVIEWING), Reviewer Gate, Mission Timeline, and
 * Final Audit. Hidden reasoning is never included (the stream parser already
 * dropped it — only the omission COUNT surfaces). The dispatch/approval,
 * attestation, finding, verdict, and output.* events are emitted by the
 * orchestrator (live-runner), not here.
 */

export interface NormalizeReviewerContext {
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  workspaceId: WorkspaceRefId;
  reviewId: string;
  adapterId: string;
  attempt: number;
  correlationId?: string;
  now: string;
}

export interface ReviewerRunOutcomeLite {
  cancelled: boolean;
  timedOut: boolean;
  spawnError?: string;
  reportReceived: boolean;
}

const MAX_ACTIVITY_EVENTS = 40;

export function normalizeCodexReview(
  ctx: NormalizeReviewerContext,
  parsed: ParsedReviewerStream,
  outcome: ReviewerRunOutcomeLite,
): EventDraft[] {
  const drafts: EventDraft[] = [];
  const draft = (
    kind: RelayEventKind,
    source: EventSource,
    safeSummary: string,
    payload: Record<string, unknown> = {},
  ): void => {
    drafts.push({
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
      payload: { reviewId: ctx.reviewId, attempt: ctx.attempt, ...payload },
      correlationId: ctx.correlationId,
      refs: { workspaceId: ctx.workspaceId },
    });
  };

  draft('reviewer.process_started', 'relay-core',
    `Independent reviewer process started (attempt ${ctx.attempt}).`);

  if (parsed.sessionId) {
    draft('reviewer.session_created', 'system', 'Reviewer session identity captured.',
      { sessionCaptured: true });
  }
  if (parsed.initSeen) {
    draft('reviewer.initialization_verified', 'system', 'Reviewer initialization verified.');
  }

  let activityCount = 0;
  for (const act of parsed.activity) {
    if (activityCount >= MAX_ACTIVITY_EVENTS) break;
    activityCount += 1;
    draft('reviewer.activity_observed', 'reviewer',
      `Reviewer ${act.kind}${act.targets.length ? `: ${act.targets.join(', ')}` : ''}`,
      { kind: act.kind });
  }
  if (parsed.reasoningBlocksOmitted > 0) {
    draft('reviewer.activity_observed', 'system',
      `Private reasoning omitted (${parsed.reasoningBlocksOmitted} block(s)).`,
      { reasoningOmitted: parsed.reasoningBlocksOmitted });
  }
  if (parsed.diffInspectionSeen) {
    draft('reviewer.diff_inspection_observed', 'reviewer', 'Reviewer inspected the actual changed files.');
  }
  if (parsed.evidenceInspectionSeen) {
    draft('reviewer.evidence_inspection_observed', 'reviewer', 'Reviewer inspected verification evidence.');
  }
  if (parsed.malformedLineCount > 0 || parsed.unknownRecordCount > 0) {
    draft('reviewer.output_malformed', 'system',
      `Reviewer emitted ${parsed.malformedLineCount} malformed / ${parsed.unknownRecordCount} unknown record(s) (ignored for decisions).`);
  }

  if (outcome.cancelled) {
    draft('reviewer.process_cancelled', 'relay-core', 'Reviewer process cancelled by Relay.');
  } else if (outcome.timedOut) {
    draft('reviewer.process_timed_out', 'relay-core', 'Reviewer process exceeded the runtime limit.');
  } else if (outcome.spawnError) {
    draft('reviewer.process_failed', 'relay-core', 'Reviewer process failed to run.');
  } else if (outcome.reportReceived) {
    draft('reviewer.report_received', 'reviewer',
      'Structured review report received. This is a claim pending Relay validation.');
    draft('reviewer.process_completed', 'relay-core', 'Reviewer process completed.');
  } else {
    draft('reviewer.process_failed', 'relay-core', 'Reviewer produced no valid report.');
  }

  return drafts;
}
