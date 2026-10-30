/**
 * RECOVERY VIEW OF AN INTERRUPTED OR UNBOUND START. IT NEVER DISPATCHES AND
 * NEVER WRITES.
 *
 * Used only with JULIUS_WONDERLAND_START_V2=1. Every `gh` call here is a read:
 * the paid workflow's run list (`gh run list`), the spent tag and its tag
 * object (`gh api`, GET), each in the exact argv this module builds. Any
 * other argv, including `gh workflow run` and an `api` call with a method or
 * a field in any spelling, is refused before it is spawned
 * ({@link readOnlyGhSpawner}, an allow-list). There is no path from here to `claim` or to
 * `reconcile`, and nothing here writes the admission store or its journal:
 * moving a record is the founder's `reconcile` (operator-claim-cli.ts).
 *
 * Three cases, from the admission journal:
 *
 * - G4. A claim left `dispatching` for longer than {@link DISPATCHING_STUCK_MS}
 *   (a stop between the reservation and the outcome write), or one whose
 *   `gh workflow run` child timed out, was killed or never started (an
 *   outcome-unknown `dispatching` event, `dispatchAttempted: true`, reported
 *   at once), is reported as `operator_reconcile_required` with the reason
 *   (`dispatching_stuck`, or the event's own error). GitHub is not read for
 *   it and the journal is not changed; the founder's `reconcile` resolves it
 *   from GitHub evidence.
 * - G5. A `dispatched` claim with a null `workflowRunId` (gh older than
 *   2.87.0 prints no run URL) is bound by dispatch key: the run list rows
 *   `runsForDispatchKey` accepts (`workflow_dispatch` on `main`, title ending
 *   ` mode=paid key=<the admission's key>`), and only when exactly one row
 *   matches and it is attempt 1. The id is kept in memory, not written: the
 *   journal does not allow a second `dispatched` event. `/events` then checks
 *   the run itself with `runMatchesClaim` before it serves anything.
 * - G8. A `dispatch_failed` claim whose cause is `gh_workflow_run_failed`
 *   (`gh workflow run` exited non-zero; a network failure after the request
 *   was sent exits the same way) is treated as OUTCOME-UNKNOWN: the run may
 *   exist. A timeout, a signal or a `gh` that never started is not this
 *   case: the claim core records it as an outcome-unknown `dispatching`
 *   event (G4). It is never dispatched again, and a retried Start replays the
 *   recorded claim. It is re-read only through the spent-tag check: a present
 *   tag naming a run is `RUN_ID_ALREADY_SPENT`, a present tag that does not
 *   is `SPENT_TAG_UNVERIFIED`. A run found by dispatch key (and, when the tag
 *   names a run, the same run) is bound for `/events`. The journal is not
 *   changed: `dispatch_failed` is final there, so this reports
 *   `operator_reconcile_required` once GitHub shows a run. With no run for
 *   the key and no spent tag past reconcile's grace period (GitHub's clock),
 *   the outcome is known: it did not run.
 *
 * A check runs in the background, one at a time per run, at most once per
 * {@link RECOVERY_RECHECK_MS}. `/status` reads the last view and never waits.
 */

import { isLocalStorePath, readAdmissionDocument } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  githubDateFromResponse,
  interpretSpentTagResponse,
  paidRunListArgs,
  reservationOutlivedGrace,
  runsForDispatchKey,
  spentTagApiArgs,
  spentTagObjectSha,
  spentTagWorkflowRunId,
  type AwaitableGhSpawner,
  type GhResult,
} from '../src/relay/integration/wonderland-admission/operator-claim';

/** Longer than two `gh` timeouts of the claim core, so a claim this bridge is still running is not reported as stuck. */
export const DISPATCHING_STUCK_MS = 300_000;
/** At most one GitHub check per run per this many ms. */
export const RECOVERY_RECHECK_MS = 15_000;

const RUN_ID = /^[1-9][0-9]{0,19}$/u;

export type WonderlandRecoveryState = 'none' | 'reconciling' | 'operator_reconcile_required';
export type WonderlandSpentTagReading = 'RUN_ID_ALREADY_SPENT' | 'SPENT_TAG_UNVERIFIED' | 'absent' | 'unreadable';

export interface WonderlandRecoveryView {
  readonly recovery: WonderlandRecoveryState;
  /** A run bound by dispatch key, when the journal has none. Never a run id the journal already has. */
  readonly workflowRunId: string | null;
  readonly workflowRunIdSource: 'dispatch_key' | null;
  /** True for a `gh_workflow_run_failed` claim or an outcome-unknown `dispatching` one: the run may exist. */
  readonly outcomeUnknown: boolean;
  /** The G8 spent-tag reading, or null when none was made. */
  readonly spentTag: WonderlandSpentTagReading | null;
  /** Why the record stays where it is. Null when nothing is pending. */
  readonly reason: string | null;
  /** When this view was read, ms since the epoch. Null before the first check. */
  readonly checkedAtMs: number | null;
}

export const NO_RECOVERY: WonderlandRecoveryView = {
  recovery: 'none',
  workflowRunId: null,
  workflowRunIdSource: null,
  outcomeUnknown: false,
  spentTag: null,
  reason: null,
  checkedAtMs: null,
};

export interface WonderlandRecoveryTarget {
  readonly wljRunId: string;
  readonly storePath: string;
  /** owner/name, or null when the configured repo is unset or invalid: then no GitHub read is made. */
  readonly repo: string | null;
  readonly nowMs: number;
}

export interface WonderlandDispatchingRecovery {
  /** The last view for this run. Synchronous: it never reads GitHub. */
  view(wljRunId: string): WonderlandRecoveryView;
  /** The run bound by dispatch key, for `/events`. */
  boundRunId(wljRunId: string): string | null;
  /** Start a check in the background when one is due. Never waits, never throws. */
  poke(target: WonderlandRecoveryTarget): void;
  /** Run a check now (or join the one running) and answer its view. */
  check(target: WonderlandRecoveryTarget): Promise<WonderlandRecoveryView>;
}

export interface WonderlandRecoveryDeps {
  /** Read-only `gh` ({@link readOnlyGhSpawner} wraps it). A `workflow` argv is refused before it reaches it. */
  readonly spawn: AwaitableGhSpawner;
  readonly stuckAfterMs?: number;
  readonly recheckMs?: number;
}

export function createWonderlandDispatchingRecovery(deps: WonderlandRecoveryDeps): WonderlandDispatchingRecovery {
  const stuckAfterMs = deps.stuckAfterMs ?? DISPATCHING_STUCK_MS;
  const recheckMs = deps.recheckMs ?? RECOVERY_RECHECK_MS;
  const views = new Map<string, WonderlandRecoveryView>();
  const inflight = new Map<string, Promise<WonderlandRecoveryView>>();
  const read = readOnlyGhSpawner(deps.spawn);
  const check = (target: WonderlandRecoveryTarget): Promise<WonderlandRecoveryView> => {
    const running = inflight.get(target.wljRunId);
    if (running !== undefined) return running;
    const run = (async () => {
      let view: WonderlandRecoveryView;
      try {
        view = await recoverOnce(target, read, stuckAfterMs);
      } catch {
        view = { ...NO_RECOVERY, recovery: 'reconciling', reason: 'recovery_failed', checkedAtMs: target.nowMs };
      }
      views.set(target.wljRunId, view);
      return view;
    })().finally(() => inflight.delete(target.wljRunId));
    inflight.set(target.wljRunId, run);
    return run;
  };
  return {
    view: (wlj) => views.get(wlj) ?? NO_RECOVERY,
    boundRunId: (wlj) => views.get(wlj)?.workflowRunId ?? null,
    poke(target) {
      const last = views.get(target.wljRunId)?.checkedAtMs ?? null;
      if (inflight.has(target.wljRunId) || (last !== null && target.nowMs - last < recheckMs)) return;
      void check(target).catch(() => undefined);
    },
    check,
  };
}

const REPO_PART = '[A-Za-z0-9_.-]+';
const SPENT_TAG_REF_PATH = new RegExp(`^repos/(${REPO_PART}/${REPO_PART})/git/ref/tags/julius-run-spent-(?:[0-9a-f]{24}|[0-9a-f]{32})$`, 'u');
const TAG_OBJECT_PATH = new RegExp(`^repos/(${REPO_PART}/${REPO_PART})/git/tags/[0-9a-f]{40}$`, 'u');

/** owner/name, each a GitHub name and neither `.` nor `..`. The status route uses it too. */
export function isRepoName(repo: string): boolean {
  const parts = repo.split('/');
  return parts.length === 2 && parts.every((part) => new RegExp(`^${REPO_PART}$`, 'u').test(part) && part !== '.' && part !== '..');
}

/**
 * ALLOW-LIST, not a deny-list: exactly the three reads this module builds,
 * token for token, and nothing else.
 * - `gh api --include repos/<owner>/<name>/git/ref/tags/julius-run-spent-<hex>` ({@link spentTagApiArgs}),
 * - `gh api repos/<owner>/<name>/git/tags/<40-hex sha>` (the spent tag's object),
 * - {@link paidRunListArgs}`(<owner>/<name>)`, exactly.
 * Any extra token is refused, so a method or a body in any spelling
 * (`-X POST`, `-XPOST`, `-X=POST`, `--method=POST`, `-f`, `-F`, `--field`,
 * `--raw-field`, `--input`), `gh workflow run`, `gh run rerun` and
 * `gh api graphql` never reach `gh`.
 */
export function isRecoveryReadArgv(args: readonly string[]): boolean {
  if (args.length === 3 && args[0] === 'api' && args[1] === '--include') {
    const match = SPENT_TAG_REF_PATH.exec(args[2]);
    return match !== null && isRepoName(match[1]);
  }
  if (args.length === 2 && args[0] === 'api') {
    const match = TAG_OBJECT_PATH.exec(args[1]);
    return match !== null && isRepoName(match[1]);
  }
  if (args[0] === 'run' && args[1] === 'list' && args[2] === '--repo' && typeof args[3] === 'string' && isRepoName(args[3])) {
    const expected = paidRunListArgs(args[3]);
    return args.length === expected.length && expected.every((token, index) => token === args[index]);
  }
  return false;
}

/** Every argv must be one of {@link isRecoveryReadArgv}'s reads. A `workflow` subcommand (`gh workflow run`) is never spawned from here. */
export function readOnlyGhSpawner(spawn: AwaitableGhSpawner): AwaitableGhSpawner {
  return {
    run(args) {
      if (!isRecoveryReadArgv(args)) return { code: 1, stdout: '', stderr: 'refused: recovery reads only' };
      return spawn.run(args);
    },
  };
}

async function recoverOnce(
  target: WonderlandRecoveryTarget,
  spawn: AwaitableGhSpawner,
  stuckAfterMs: number,
): Promise<WonderlandRecoveryView> {
  const at = target.nowMs;
  const pending = (recovery: WonderlandRecoveryState, reason: string, over: Partial<WonderlandRecoveryView> = {}): WonderlandRecoveryView =>
    ({ ...NO_RECOVERY, recovery, reason, checkedAtMs: at, ...over });
  if (!isLocalStorePath(target.storePath)) return pending('reconciling', 'store_unavailable');
  const document = readAdmissionDocument(target.storePath);
  const admission = document.admissions.find((row) => row.runId === target.wljRunId) ?? null;
  if (admission === null) return { ...NO_RECOVERY, checkedAtMs: at };
  const latest = document.claims.filter((event) => event.wonderlandRunId === target.wljRunId && event.serverRunId === admission.serverRunId).at(-1) ?? null;
  if (latest === null) return { ...NO_RECOVERY, checkedAtMs: at };

  if (latest.state === 'dispatching') {
    // The child gave no answer: whether GitHub has the dispatch is unknown, and only the founder's reconcile moves it.
    if (latest.dispatchAttempted) {
      return pending('operator_reconcile_required', latest.dispatchError ?? 'dispatch_outcome_unknown', { outcomeUnknown: true });
    }
    const since = Date.parse(latest.at);
    if (!Number.isFinite(since) || at - since <= stuckAfterMs) return { ...NO_RECOVERY, checkedAtMs: at };
    // Reported, not resolved: this view writes nothing.
    return pending('operator_reconcile_required', 'dispatching_stuck');
  }

  if (latest.state === 'dispatched' && latest.workflowRunId === null) {
    if (target.repo === null) return pending('reconciling', 'repo_unconfigured');
    const bound = await runByDispatchKey(spawn, target.repo, admission.keyHash);
    if (bound.kind === 'one') return { ...NO_RECOVERY, workflowRunId: bound.runId, workflowRunIdSource: 'dispatch_key', checkedAtMs: at };
    if (bound.kind === 'many') return pending('operator_reconcile_required', 'workflow_runs_ambiguous');
    return pending('reconciling', bound.kind === 'unreadable' ? 'workflow_runs_unreadable' : 'workflow_run_not_listed');
  }

  if (latest.state === 'dispatch_failed' && latest.dispatchError === 'gh_workflow_run_failed') {
    const unknown = { outcomeUnknown: true } as const;
    if (target.repo === null) return pending('reconciling', 'repo_unconfigured', unknown);
    const tagRead = await spawn.run(spentTagApiArgs(target.repo, admission.serverRunId));
    const tag = interpretSpentTagResponse(tagRead);
    if (tag === 'unreadable') return pending('reconciling', 'spent_tag_unreadable', { ...unknown, spentTag: 'unreadable' });
    let tagRunId: string | null = null;
    if (tag === 'present') {
      const objectSha = spentTagObjectSha(tagRead);
      tagRunId = objectSha === null ? null : spentTagWorkflowRunId(await spawn.run(['api', `repos/${target.repo}/git/tags/${objectSha}`]), admission.serverRunId);
      if (tagRunId === null) return pending('operator_reconcile_required', 'spent_tag_unverified', { ...unknown, spentTag: 'SPENT_TAG_UNVERIFIED' });
    }
    const spentTag: WonderlandSpentTagReading = tag === 'present' ? 'RUN_ID_ALREADY_SPENT' : 'absent';
    const bound = await runByDispatchKey(spawn, target.repo, admission.keyHash);
    if (bound.kind === 'one' && (tagRunId === null || tagRunId === bound.runId)) {
      return pending('operator_reconcile_required', 'workflow_run_exists', { ...unknown, spentTag, workflowRunId: bound.runId, workflowRunIdSource: 'dispatch_key' });
    }
    if (bound.kind === 'many' || bound.kind === 'one' || tag === 'present') {
      return pending('operator_reconcile_required', 'workflow_runs_disagree', { ...unknown, spentTag });
    }
    // Reconcile's own rule for "it never ran": no run for the key and no spent tag, past the grace period on GitHub's clock.
    if (bound.kind === 'none' && reservationOutlivedGrace(latest.githubDate, githubDateFromResponse(tagRead))) {
      return { ...NO_RECOVERY, spentTag, reason: 'workflow_run_absent', checkedAtMs: at };
    }
    return pending('reconciling', bound.kind === 'unreadable' ? 'workflow_runs_unreadable' : 'workflow_run_not_listed', { ...unknown, spentTag });
  }

  return { ...NO_RECOVERY, checkedAtMs: at };
}

type ByKey =
  | { readonly kind: 'one'; readonly runId: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'many' }
  | { readonly kind: 'unreadable' };

/** Exactly one first-attempt paid run on main for this dispatch key (reconcile's rule), or why not. */
async function runByDispatchKey(spawn: AwaitableGhSpawner, repo: string, keyHash: string): Promise<ByKey> {
  const listing: GhResult = await spawn.run(paidRunListArgs(repo));
  const runs = runsForDispatchKey(listing, keyHash);
  if (runs === null) return { kind: 'unreadable' };
  if (runs.length === 0) return { kind: 'none' };
  const only = runs.length === 1 ? runs[0] ?? null : null;
  if (only === null || only.attempt !== 1 || !RUN_ID.test(only.workflowRunId)) return { kind: 'many' };
  return { kind: 'one', runId: only.workflowRunId };
}
