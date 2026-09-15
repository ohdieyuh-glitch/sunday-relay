import type { JuliusOperationalEventType } from './julius-events';
import {
  foldJuliusPeerRequests, juliusPeerRequestId, juliusPeerRequestOpenedFacts, juliusPeerRequestTransitionFacts,
  juliusResearchContinuationIds, openJuliusPeerRequest, projectJuliusArchitectState, projectJuliusReviewerState,
  transitionJuliusPeerRequest,
  type JuliusArchitectPeerState, type JuliusPeerLedgerEntry, type JuliusPeerParty, type JuliusPeerRequest,
  type JuliusPeerRequestKind, type JuliusPeerRequestOutcome, type JuliusPeerRequestStatus, type JuliusReviewerPeerState,
} from './julius-peer-channel';
import type { JuliusTask, JuliusWorkerRole } from './julius-runtime';
import type { JuliusTimelineReader } from './julius-runtime-api';

/**
 * THE PEER CHANNEL, ON THE RUNTIME PATH.
 *
 * `julius-peer-channel` says what a request is and which moves are legal. This
 * is where the pipeline opens one and moves it, and it holds exactly one rule of
 * its own: A MOVE IS WRITTEN ONLY WHEN THE LEDGER SAYS IT IS LEGAL NOW. The
 * current state is read back from the run's own rows before every move, so a
 * resumed verification, a replayed tick or a crash between a decision and its
 * announcement re-derives the same position and writes nothing twice.
 *
 * Where no timeline reader is bound there is nothing to read the position from.
 * The caller then says whether this is the first write of the fact that caused
 * the move (`firstWrite`, the same guard the brain entries use), and the fold
 * ignores any move that would not be legal, so the projection stays correct
 * either way.
 */

export interface JuliusPeerRuntimeContext {
  readonly runId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly executionScope: string;
  readonly now: () => string;
  readonly timeline?: JuliusTimelineReader;
  readonly emit: (
    type: JuliusOperationalEventType,
    input: { taskId: string | null; workerId?: string | null; facts: Record<string, string | number | boolean | null> },
  ) => Promise<void>;
}

/**
 * THE SCOPE A PEER REQUEST IS NAMED UNDER when the deployment did not supply
 * one. A harness and a local drill run once per store, so one scope is honest
 * for them; the live entrypoint supplies the workflow run and attempt, because a
 * mission's run id repeats across attempts.
 */
export const JULIUS_LOCAL_EXECUTION_SCOPE = 'local' as const;

/** The workers that can take part in the channel; anything else cannot address a peer. */
export function juliusPeerPartyForRole(role: JuliusWorkerRole): JuliusPeerParty | null {
  return role === 'PROMPT_ARCHITECT' || role === 'CODING_AGENT' || role === 'INDEPENDENT_REVIEWER' ? role : null;
}

/** Every row a peer projection reads, paged from the run's timeline. Null when none is bound. */
export async function readJuliusPeerLedger(
  timeline: JuliusTimelineReader | undefined,
  run: { readonly runId: string; readonly projectId: string },
): Promise<readonly JuliusPeerLedgerEntry[] | null> {
  if (timeline === undefined) return null;
  const rows: JuliusPeerLedgerEntry[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await timeline.timeline({ runId: run.runId, projectId: run.projectId, sinceSequence, limit: 500 });
    for (const entry of page.entries) {
      sinceSequence = Math.max(sinceSequence, entry.sequence);
      if (entry.type.startsWith('peer.') || entry.type === 'checkpoint.verdict' || entry.type === 'guidance.issued') {
        rows.push({ type: entry.type, facts: entry.facts, taskId: entry.taskId });
      }
    }
    if (!page.hasMore || page.entries.length === 0) break;
  }
  return rows;
}

/**
 * OPEN A REQUEST, OR RECORD WHY IT COULD NOT BE OPENED.
 *
 * `announce: false` validates without writing, for a caller that must know the
 * direction is legal before it mints the task that will carry the answer and
 * cannot know every field until afterwards.
 */
export async function openJuliusPeerRequestOnLedger(
  context: JuliusPeerRuntimeContext,
  input: Omit<Parameters<typeof openJuliusPeerRequest>[0], 'missionId' | 'runId' | 'projectId' | 'executionScope' | 'createdAt'> & {
    readonly announce: boolean;
    readonly workerId?: string | null;
  },
): Promise<JuliusPeerRequestOutcome> {
  const { announce, workerId, ...fields } = input;
  const opened = openJuliusPeerRequest({
    ...fields,
    missionId: context.missionId,
    runId: context.runId,
    projectId: context.projectId,
    executionScope: context.executionScope,
    createdAt: context.now(),
  });
  if (!announce) return opened;
  if (opened.outcome === 'REFUSED') {
    await context.emit('peer.request.refused', {
      taskId: input.subjectTaskId, workerId: workerId ?? null,
      facts: {
        kind: String(input.kind), sourceRole: String(input.sourceRole), targetRole: String(input.targetRole),
        reasonCode: opened.reasonCode, executionScope: context.executionScope,
      },
    });
    return opened;
  }
  await context.emit('peer.request.opened', {
    taskId: opened.request.subjectTaskId, workerId: workerId ?? null,
    facts: juliusPeerRequestOpenedFacts(opened.request),
  });
  return opened;
}

export type JuliusPeerMoveOutcome =
  | { readonly outcome: 'MOVED'; readonly request: JuliusPeerRequest | null }
  | { readonly outcome: 'NOT_MOVED'; readonly reasonCode: string };

/**
 * MOVE A REQUEST, IF THE LEDGER SAYS THE MOVE IS LEGAL NOW.
 *
 * A request that was never opened is not invented — `peer_request_unknown` —
 * and a move from the state it is already in writes nothing. `from` narrows the
 * move to requests in the named states, for a caller that means "answer it if
 * it is still open" rather than "answer it whatever it is".
 */
export async function moveJuliusPeerRequest(
  context: JuliusPeerRuntimeContext,
  input: {
    readonly kind: JuliusPeerRequestKind;
    readonly anchor: string;
    readonly to: JuliusPeerRequestStatus;
    readonly from?: readonly JuliusPeerRequestStatus[];
    readonly responseRef?: string | null;
    readonly transitionCode?: string | null;
    /** What caused the move. A cause is applied to a request once. */
    readonly causeRef: string;
    readonly taskId: string | null;
    readonly workerId?: string | null;
    readonly firstWrite: boolean;
  },
): Promise<JuliusPeerMoveOutcome> {
  const requestId = juliusPeerRequestId({ kind: input.kind, executionScope: context.executionScope, anchor: input.anchor });
  const at = context.now();
  const ledger = await readJuliusPeerLedger(context.timeline, context);
  let moved: JuliusPeerRequest | null = null;
  if (ledger === null) {
    if (!input.firstWrite) return { outcome: 'NOT_MOVED', reasonCode: 'peer_ledger_unreadable_replay' };
  } else {
    const current = foldJuliusPeerRequests(ledger).find((request) => request.requestId === requestId);
    if (current === undefined) return { outcome: 'NOT_MOVED', reasonCode: 'peer_request_unknown' };
    const applied = ledger.some((row) => row.type === 'peer.request.transitioned'
      && row.facts.requestId === requestId && row.facts.causeRef === input.causeRef && row.facts.to === input.to);
    if (applied) return { outcome: 'NOT_MOVED', reasonCode: 'peer_request_cause_already_applied' };
    if (input.from !== undefined && !input.from.includes(current.status)) {
      return { outcome: 'NOT_MOVED', reasonCode: 'peer_request_not_in_expected_state' };
    }
    const next = transitionJuliusPeerRequest(current, {
      to: input.to, at,
      responseRef: input.responseRef ?? null, transitionCode: input.transitionCode ?? null,
    });
    if (next.outcome === 'REFUSED') return { outcome: 'NOT_MOVED', reasonCode: next.reasonCode };
    moved = next.request;
  }
  await context.emit('peer.request.transitioned', {
    taskId: input.taskId, workerId: input.workerId ?? null,
    facts: juliusPeerRequestTransitionFacts({
      requestId, to: input.to, at,
      responseRef: input.responseRef ?? null, transitionCode: input.transitionCode ?? null, causeRef: input.causeRef,
    }),
  });
  return { outcome: 'MOVED', request: moved };
}

export interface JuliusPeerChannelView {
  readonly requests: readonly JuliusPeerRequest[];
  readonly architect: JuliusArchitectPeerState;
  readonly reviewer: JuliusReviewerPeerState;
}

/**
 * WHAT THE PEERS ARE DOING, FROM THE ROWS THAT EXIST.
 *
 * Nothing here is stored. The same tasks and the same ledger give the same view
 * in a continuation, after a restart, and in a store rebuilt from an evidence
 * bundle. Null when no timeline reader is bound: the requests cannot be read,
 * and a view without them would call a waiting peer idle.
 */
export async function readJuliusPeerChannel(input: {
  readonly timeline: JuliusTimelineReader | undefined;
  readonly tasks: readonly JuliusTask[];
  readonly runId: string;
  readonly projectId: string;
}): Promise<JuliusPeerChannelView | null> {
  const ledger = await readJuliusPeerLedger(input.timeline, input);
  if (ledger === null) return null;
  const requests = foldJuliusPeerRequests(ledger);
  const state = { tasks: input.tasks, requests, researchContinuationTaskIds: juliusResearchContinuationIds(ledger) };
  return { requests, architect: projectJuliusArchitectState(state), reviewer: projectJuliusReviewerState(state) };
}
