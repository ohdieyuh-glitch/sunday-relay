/**
 * SUNDAY RELAY — WHAT A SERVER MAY DO TO A LOOP RUN.
 *
 * Confirm one. Pause it. Resume it. Stop it. Four operations, each of which a
 * client will retry, and each of which must therefore be safe to ask for twice.
 *
 * EVERY CONTROL ACTION CARRIES ITS OWN DURABLE IDENTITY. Not the run id, not
 * the iteration id, not the recovery generation, not the event id — its own
 * `lpq` request id, minted by the caller and persisted in the event it
 * produces. The generation-derived shortcut this replaces was wrong in a way
 * that only shows up in the unhappy path: a resume that fails and parks the run
 * again leaves the generation unchanged, so the next pause would look like a
 * redelivery of the previous one and be silently discarded. A user would press
 * Pause and nothing would happen, with no error anywhere.
 *
 * CONFIRMATION IS IDEMPOTENT ON WHAT THE USER ACTUALLY DECIDED. The key binds
 * principal, workspace, project, contract digest and the client's request id.
 * Change any of those and it is a different decision deserving a different run;
 * repeat all of them and it is the same decision arriving twice. A second click
 * returns the first run rather than starting a second one that spends money in
 * parallel with it.
 *
 * PURE. Storage, clock, ids and locking all arrive injected.
 */

import {
  appendLoopRunEvent,
  checkpointLoopRun,
  emptyLoopRunRecord,
  readLoopRun,
  type LoopRunStoreBacking,
} from './loop-runtime-store';
import { seedLoopRun, type LoopDigestFn } from './loop-runtime-reducer';
import { isTerminalLoopState, mayResumeFrom } from './loop-runtime-state';
import type { RelayLoopEventInput, RelayLoopEventPayload } from './loop-runtime-events';
import type { RelayLoopBudgetState, RelayLoopRun, RelayLoopRuntimeState } from './loop-runtime-types';

/** The purpose string every Loop lock is taken with. */
export const LOOP_LOCK_PURPOSE = 'loop-run';

/* ------------------------------------------------------- control requests */

export const RELAY_LOOP_CONTROL_ACTIONS = ['pause', 'resume', 'stop'] as const;
export type RelayLoopControlAction = (typeof RELAY_LOOP_CONTROL_ACTIONS)[number];

/**
 * One thing somebody asked for.
 *
 * `requestId` is durable and belongs to the requester, so a retry carries the
 * same one and a genuinely new request carries a new one. Relay never mints it
 * on the caller's behalf: a server-generated id changes on every retry, which
 * is indistinguishable from having no idempotency at all.
 */
export interface RelayLoopControlRequest {
  readonly requestId: string;
  readonly action: RelayLoopControlAction;
  readonly requestedBy: string;
  readonly reason: string | null;
}

export type LoopControlOutcome =
  | { readonly ok: true; readonly run: RelayLoopRun; readonly duplicate: boolean }
  | { readonly ok: false; readonly status: number; readonly kind: string; readonly problem: string };

const deny = (status: number, kind: string, problem: string): LoopControlOutcome =>
  ({ ok: false, status, kind, problem });

export interface LoopOperationDeps {
  readonly backing: LoopRunStoreBacking;
  readonly digest: LoopDigestFn;
  readonly now: () => string;
}

/**
 * Has this exact control request already been recorded?
 *
 * Matched on the request id AND the action. A client that reuses one id for two
 * different actions is confused about its own state, and answering the second
 * as though it were the first would act on a request nobody made.
 */
function priorControlEvent(
  events: readonly { readonly kind: string; readonly idempotencyKey: string | null }[],
  request: RelayLoopControlRequest,
): { readonly found: boolean; readonly conflicting: boolean } {
  const expected = `loop.${request.action}_requested`;
  const matches = events.filter((e) => e.idempotencyKey === request.requestId);
  if (matches.length === 0) return { found: false, conflicting: false };
  return {
    found: matches.some((e) => e.kind === expected),
    conflicting: matches.every((e) => e.kind !== expected),
  };
}

function appendControl(
  deps: LoopOperationDeps,
  run: RelayLoopRun,
  payload: RelayLoopEventPayload,
  idempotencyKey: string | null,
  actor: string,
): { ok: true; run: RelayLoopRun } | { ok: false; problem: string } {
  const base: RelayLoopEventInput = {
    at: deps.now(),
    runId: run.runId,
    loopId: run.loopId,
    projectId: run.projectId,
    kind: payload.kind,
    actor,
    recoveryGeneration: run.recoveryGeneration,
    expectedPreviousState: null,
    idempotencyKey,
    payload,
  };
  const appended = appendLoopRunEvent(deps.backing, { runId: run.runId, base, digest: deps.digest });
  return appended.ok ? { ok: true, run: appended.run } : { ok: false, problem: appended.problem };
}

/* ------------------------------------------------------------------ pause */

/**
 * Ask a run to pause.
 *
 * This records the REQUEST and moves the run to `pausing`. It does not claim
 * the run is paused — the engine does that only once the adapter has reached a
 * safe boundary, because saying "paused" while an agent is mid-call is a lie
 * that costs money.
 */
export function requestLoopPause(
  deps: LoopOperationDeps,
  runId: string,
  request: RelayLoopControlRequest,
): LoopControlOutcome {
  const guard = loadForControl(deps, runId, request);
  if (!guard.ok) return guard.outcome;
  const { run, record } = guard;

  const prior = priorControlEvent(record, request);
  if (prior.conflicting) {
    return deny(409, 'conflicting_request', 'That request id has already been used for a different action.');
  }
  if (prior.found) return { ok: true, run, duplicate: true };

  if (run.state === 'pausing' || run.state === 'paused') {
    // Already going there. Not an error, and not a second request.
    return { ok: true, run, duplicate: true };
  }
  const appended = appendControl(
    deps, run,
    { kind: 'loop.pause_requested', requestedBy: request.requestedBy, requestId: request.requestId },
    request.requestId, request.requestedBy,
  );
  return appended.ok
    ? { ok: true, run: appended.run, duplicate: false }
    : deny(409, 'invalid_state', appended.problem);
}

/* ----------------------------------------------------------------- resume */

/**
 * Ask a paused or unconfirmable run to continue.
 *
 * Resume RECORDS the intent and moves to `resuming`; the engine then re-checks
 * authorization, the feature flag, the contract binding and the limits before
 * any work happens. Nothing here decides that continuing is safe.
 */
export function requestLoopResume(
  deps: LoopOperationDeps,
  runId: string,
  request: RelayLoopControlRequest,
): LoopControlOutcome {
  const guard = loadForControl(deps, runId, request);
  if (!guard.ok) return guard.outcome;
  const { run, record } = guard;

  const prior = priorControlEvent(record, request);
  if (prior.conflicting) {
    return deny(409, 'conflicting_request', 'That request id has already been used for a different action.');
  }
  if (prior.found) return { ok: true, run, duplicate: true };

  if (!mayResumeFrom(run.state)) {
    return deny(
      409, 'invalid_state',
      `A run in ${run.state.replace(/_/g, ' ')} cannot be resumed. Only a paused run, or one held for recovery, can.`,
    );
  }
  const requested = appendControl(
    deps, run,
    { kind: 'loop.resume_requested', requestedBy: request.requestedBy, requestId: request.requestId },
    request.requestId, request.requestedBy,
  );
  if (!requested.ok) return deny(409, 'invalid_state', requested.problem);

  // The generation advances EXACTLY ONCE per accepted resume. That number is
  // what makes a worker holding the old one detectable, so incrementing it
  // twice — or not at all — breaks the guard in opposite directions.
  const resumed = appendControl(
    deps, requested.run,
    { kind: 'loop.resumed', recoveryGeneration: requested.run.recoveryGeneration + 1 },
    null, request.requestedBy,
  );
  if (!resumed.ok) return deny(409, 'invalid_state', resumed.problem);
  checkpointLoopRun(deps.backing, runId, deps.digest);
  return { ok: true, run: resumed.run, duplicate: false };
}

/* ------------------------------------------------------------------- stop */

/**
 * Ask a run to stop.
 *
 * Records the request and moves to `stopping`. The run lands in `stopped` only
 * when the engine has actually cancelled the work — stopping is not stopped,
 * and a surface that conflates them shows a finished run while an agent is
 * still running.
 */
export function requestLoopStop(
  deps: LoopOperationDeps,
  runId: string,
  request: RelayLoopControlRequest,
): LoopControlOutcome {
  const guard = loadForControl(deps, runId, request);
  if (!guard.ok) return guard.outcome;
  const { run, record } = guard;

  const prior = priorControlEvent(record, request);
  if (prior.conflicting) {
    return deny(409, 'conflicting_request', 'That request id has already been used for a different action.');
  }
  if (prior.found) return { ok: true, run, duplicate: true };
  if (run.state === 'stopping' || run.state === 'stopped') {
    return { ok: true, run, duplicate: true };
  }

  const appended = appendControl(
    deps, run,
    {
      kind: 'loop.stop_requested',
      requestedBy: request.requestedBy,
      requestId: request.requestId,
      reason: request.reason ?? 'A stop was requested.',
    },
    request.requestId, request.requestedBy,
  );
  return appended.ok
    ? { ok: true, run: appended.run, duplicate: false }
    : deny(409, 'invalid_state', appended.problem);
}

/* --------------------------------------------------------------- loading */

type ControlGuard =
  | { readonly ok: true; readonly run: RelayLoopRun; readonly record: readonly { readonly kind: string; readonly idempotencyKey: string | null }[] }
  | { readonly ok: false; readonly outcome: LoopControlOutcome };

/**
 * Load a run for a control action, refusing every state in which the action is
 * meaningless — including the one that matters most: a terminal run.
 */
function loadForControl(
  deps: LoopOperationDeps,
  runId: string,
  request: RelayLoopControlRequest,
): ControlGuard {
  if (!request.requestId.startsWith('lpq_')) {
    return {
      ok: false,
      outcome: deny(422, 'validation_failed', 'A control request needs its own lpq_ request id.'),
    };
  }
  const loaded = readLoopRun(deps.backing, runId, deps.digest);
  if (loaded === null) {
    return { ok: false, outcome: deny(404, 'not_found', 'No Loop run with that id.') };
  }
  if (loaded.recoveryRequired || loaded.run === null) {
    return {
      ok: false,
      outcome: deny(
        409, 'recovery_required',
        'This run cannot be vouched for and is held for inspection. No control action was applied.',
      ),
    };
  }
  if (isTerminalLoopState(loaded.run.state)) {
    return {
      ok: false,
      outcome: deny(
        409, 'already_finished',
        `This run ended in ${loaded.run.state.replace(/_/g, ' ')}. A finished run takes no further control actions.`,
      ),
    };
  }
  const record = deps.backing.read(runId)?.events ?? [];
  return { ok: true, run: loaded.run, record };
}

/* ------------------------------------------------------------ confirmation */

export interface LoopConfirmationInput {
  /** The authenticated principal. Part of the idempotency identity. */
  readonly principal: string;
  readonly workspaceId: string | null;
  readonly projectId: string;
  readonly loopId: string;
  readonly runId: string;
  readonly contractRef: string;
  readonly contractVersion: number;
  /** The digest of the contract the user actually confirmed. */
  readonly contractBindingDigest: string;
  /** The CLIENT's request identity. A retry reuses it; a new decision does not. */
  readonly confirmationRequestId: string;
  readonly creationSource: 'cli' | 'website' | 'api' | 'schedule';
  readonly budget: RelayLoopBudgetState;
  readonly provenance: RelayLoopRun['provenance'];
}

export type LoopConfirmationOutcome =
  | { readonly ok: true; readonly run: RelayLoopRun; readonly duplicate: boolean }
  | { readonly ok: false; readonly status: number; readonly kind: string; readonly problem: string };

/**
 * The idempotency identity of a confirmation.
 *
 * Everything that makes it a DIFFERENT decision is in the key. Two clicks by
 * one user on one contract are the same decision; the same click by a
 * different principal, or against a contract that has since changed, is not —
 * and must not be answered with the first run, because the second user's
 * request was never actually carried out.
 */
export function loopConfirmationKey(input: {
  readonly principal: string;
  readonly workspaceId: string | null;
  readonly projectId: string;
  readonly contractBindingDigest: string;
  readonly confirmationRequestId: string;
}): string {
  return [
    input.principal,
    input.workspaceId ?? 'no-workspace',
    input.projectId,
    input.contractBindingDigest,
    input.confirmationRequestId,
  ].join('|');
}

/**
 * Create at most one run for one confirmed contract.
 *
 * PROCESS- AND PERSISTENCE-BACKED, NOT DISTRIBUTED. The guarantee is that this
 * store will not hold two runs for one confirmation key: the check reads the
 * durable record, and the creation refuses if the run directory already exists.
 * Two bridge processes racing against one filesystem are serialised by that
 * refusal, not by a lock, so the loser is told the run exists rather than
 * creating a second one. Nothing here claims a guarantee across independent
 * stores, and no consensus is implied.
 */
export function confirmLoopRun(
  deps: LoopOperationDeps,
  input: LoopConfirmationInput,
): LoopConfirmationOutcome {
  const key = loopConfirmationKey(input);

  const existing = readLoopRun(deps.backing, input.runId, deps.digest);
  if (existing !== null) {
    if (existing.recoveryRequired || existing.run === null) {
      return {
        ok: false, status: 409, kind: 'recovery_required',
        problem: 'A run already exists under that id and cannot be vouched for. It was not replaced.',
      };
    }
    if (existing.run.idempotencyKey !== '' && existing.run.idempotencyKey !== key) {
      // Same run id, different decision. Answering with the stored run would
      // report someone else's work as the answer to this request.
      return {
        ok: false, status: 409, kind: 'idempotency_conflict',
        problem: 'A different confirmation already created a run with that id.',
      };
    }
    return { ok: true, run: existing.run, duplicate: true };
  }

  const seed = seedLoopRun({
    runId: input.runId,
    loopId: input.loopId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    contractRef: input.contractRef,
    contractVersion: input.contractVersion,
    contractBindingDigest: input.contractBindingDigest,
    budget: input.budget,
    createdAt: deps.now(),
    provenance: input.provenance,
  });

  try {
    deps.backing.create(emptyLoopRunRecord(seed));
  } catch {
    // Lost a race against another process that created it first. Read theirs;
    // do not create a second run for one decision.
    const raced = readLoopRun(deps.backing, input.runId, deps.digest);
    if (raced?.run != null) return { ok: true, run: raced.run, duplicate: true };
    return {
      ok: false, status: 409, kind: 'conflict',
      problem: 'That Loop run could not be created and does not read back.',
    };
  }

  const confirmed = appendControl(
    deps, seed,
    {
      kind: 'loop.contract_confirmed',
      contractRef: input.contractRef,
      contractVersion: input.contractVersion,
      bindingDigest: input.contractBindingDigest,
      confirmedBy: input.principal,
    },
    null, input.principal,
  );
  if (!confirmed.ok) {
    return { ok: false, status: 422, kind: 'validation_failed', problem: confirmed.problem };
  }
  const created = appendControl(
    deps, confirmed.run,
    {
      kind: 'loop.run_created',
      idempotencyKey: key,
      creationSource: input.creationSource,
      createdBy: input.principal,
    },
    key, input.principal,
  );
  if (!created.ok) {
    return { ok: false, status: 422, kind: 'validation_failed', problem: created.problem };
  }
  return { ok: true, run: created.run, duplicate: false };
}

/** States in which a run is doing or about to do work. */
export function loopRunIsActive(state: RelayLoopRuntimeState): boolean {
  return !isTerminalLoopState(state) && state !== 'paused' && state !== 'recovery_required';
}
