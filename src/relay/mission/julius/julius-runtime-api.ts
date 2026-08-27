/**
 * THE AUTHORITATIVE JULIUS EXECUTION API.
 *
 * WHAT IT IS: the one surface through which anything outside the runtime
 * starts, inspects or controls a run. Transport-neutral on purpose — no HTTP,
 * no framework, no serialization — so the bridge mounts it, a CLI could call
 * it, and a test drives it without either. Julius core must not depend on a
 * Relay transport concern, and a method signature is the whole dependency.
 *
 * AUTHORIZATION IS NOT OPTIONAL AND NOT A DECORATOR. Every method takes an
 * identity as its FIRST argument and refuses before it reads anything. There
 * is no method here that can be reached without a project and a scope, because
 * there is no overload that omits them — a check that can be forgotten is a
 * check that will be.
 *
 * WHAT IT DOES NOT DO: it defines no Compound Agent configuration, no
 * integration registry and no mission authoring. Those are Relay's, they
 * already exist on the Relay side of the boundary, and duplicating them here
 * would put two answers in the product for one question.
 *
 * REFUSALS ARE VALUES. An unauthorized call, a missing run and a project
 * mismatch are ordinary outcomes with distinct reason codes, not exceptions:
 * a surface that has to catch to find out whether it may look is a surface
 * that will eventually forget to catch.
 */

import type { JuliusEvidence, JuliusMissionState, JuliusTask, JuliusVerificationDecision } from './julius-runtime';
import type { JuliusReviewerFinding } from './julius-verification-runtime';
import type { JuliusSubagentRecord, JuliusSubagentStore } from './julius-subagent-runtime';
import type { JuliusGauntletRecord, JuliusGauntletRoundRecord, JuliusGauntletStore } from './julius-gauntlet-runtime';
import {
  cancelJuliusRun, decideJuliusApproval, pauseJuliusRun, resumeJuliusRun,
  type JuliusApprovalRecord, type JuliusApprovalStore, type JuliusApproverAuthority,
  type JuliusLifecycleDependencies, type JuliusLifecycleStore,
} from './julius-lifecycle-runtime';
import type { JuliusClock, JuliusRunRow, JuliusRuntimeStore } from './julius-runtime-ports';

/* -------------------------------------------------------------- identity */

/**
 * THE SCOPES, AND WHY THEY SPLIT WHERE THEY DO.
 *
 * Reading a run and controlling one are different authorities: a dashboard
 * needs the first and must never hold the second. Deciding an approval is
 * split from controlling a run because an approver is often someone who may
 * not pause or cancel — they are being asked one question, not handed the
 * controls.
 */
export const JULIUS_API_SCOPES = ['run:read', 'run:control', 'approval:decide'] as const;
export type JuliusApiScope = (typeof JULIUS_API_SCOPES)[number];

export interface JuliusApiIdentity {
  readonly tenantId: string;
  readonly projectId: string;
  /** Who is calling. Recorded on control operations; never a credential. */
  readonly actorId: string;
  readonly scopes: readonly JuliusApiScope[];
}

/* -------------------------------------------------------------- outcomes */

export const JULIUS_API_REFUSALS = [
  'identity_incomplete',
  'scope_missing',
  'run_not_found',
  'not_authorized_for_project',
  'invalid_cursor',
] as const;
export type JuliusApiRefusal = (typeof JULIUS_API_REFUSALS)[number];

export type JuliusApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: JuliusApiRefusal; readonly safeMessage: string };

const refuse = <T>(reason: JuliusApiRefusal, safeMessage: string): JuliusApiResult<T> =>
  ({ ok: false, reason, safeMessage });
const allow = <T>(value: T): JuliusApiResult<T> => ({ ok: true, value });

/* ------------------------------------------------------------- the views */

export interface JuliusRunView {
  readonly runId: string;
  readonly missionId: string;
  readonly state: JuliusMissionState;
  readonly revision: number;
  readonly cardRevision: string;
  readonly missionContractRevision: number;
  readonly projectBrainRevision: number;
  readonly taskCounts: Readonly<Record<JuliusTask['state'], number>>;
  readonly activeTasks: number;
  readonly pendingApprovals: number;
}

/** One safe timeline entry. Never a payload, never a prompt, never reasoning. */
export interface JuliusTimelineEntry {
  readonly eventId: string;
  readonly sequence: number;
  readonly type: string;
  readonly taskId: string | null;
  readonly workerId: string | null;
  readonly occurredAt: string;
  readonly facts: Readonly<Record<string, string | number | boolean | null>>;
}

export interface JuliusTimelinePage {
  readonly runId: string;
  readonly entries: readonly JuliusTimelineEntry[];
  /** Feed back as `sinceSequence` to continue. Never a row offset. */
  readonly nextCursor: number;
  /** A sequence was missing from the range. Surfaced, never filled. */
  readonly gapDetected: boolean;
  readonly hasMore: boolean;
}

/**
 * READING THE EVENT LEDGER.
 *
 * A CURSOR IS A SEQUENCE, NOT AN OFFSET. An offset shifts under an insert and
 * a reconnecting reader silently skips or repeats; a sequence is stable, which
 * is what makes replay-from-cursor and duplicate suppression possible at all.
 */
export interface JuliusTimelineReader {
  timeline(input: {
    runId: string; projectId: string; sinceSequence: number; limit: number;
  }): Promise<{ readonly entries: readonly JuliusTimelineEntry[]; readonly hasMore: boolean }>;
}

/* ------------------------------------------------------------ the surface */

export interface JuliusRuntimeApiDependencies {
  readonly store: JuliusRuntimeStore & JuliusSubagentStore & JuliusGauntletStore
  & JuliusApprovalStore & JuliusLifecycleStore;
  readonly timeline: JuliusTimelineReader;
  readonly approvers: JuliusApproverAuthority;
  readonly clock: JuliusClock;
}

/** The most timeline entries one page will carry. */
export const JULIUS_TIMELINE_PAGE_LIMIT = 200;

export class JuliusRuntimeApi {
  constructor(private readonly deps: JuliusRuntimeApiDependencies) {}

  /* ------------------------------------------------------------- reading */

  async inspectRun(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<JuliusRunView>> {
    const run = await this.#authorizedRun(identity, runId, 'run:read');
    if (!run.ok) return run;
    const [tasks, approvals, active] = await Promise.all([
      this.deps.store.tasksForRun(runId, identity.projectId),
      this.deps.store.pendingApprovals(runId, identity.projectId),
      this.deps.store.activeTaskCount(runId, identity.projectId),
    ]);
    const taskCounts = {
      BLOCKED: 0, RUNNABLE: 0, ACTIVE: 0, SUCCEEDED: 0, FAILED: 0, CANCELLED: 0, SKIPPED: 0,
    } as Record<JuliusTask['state'], number>;
    for (const task of tasks) taskCounts[task.state] += 1;
    return allow({
      runId: run.value.runId, missionId: run.value.missionId, state: run.value.state,
      revision: run.value.version, cardRevision: run.value.cardRevision,
      missionContractRevision: run.value.missionContractRevision,
      projectBrainRevision: run.value.projectBrainRevision,
      taskCounts, activeTasks: active, pendingApprovals: approvals.length,
    });
  }

  async inspectTasks(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<readonly JuliusTask[]>> {
    const run = await this.#authorizedRun(identity, runId, 'run:read');
    if (!run.ok) return run;
    return allow(await this.deps.store.tasksForRun(runId, identity.projectId));
  }

  async inspectEvidence(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<readonly JuliusEvidence[]>> {
    const run = await this.#authorizedRun(identity, runId, 'run:read');
    if (!run.ok) return run;
    return allow(await this.deps.store.evidenceForRun(runId, identity.projectId));
  }

  async inspectVerification(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<{
    readonly decisions: readonly JuliusVerificationDecision[];
    readonly findings: readonly JuliusReviewerFinding[];
  }>> {
    const run = await this.#authorizedRun(identity, runId, 'run:read');
    if (!run.ok) return run;
    const [decisions, findings] = await Promise.all([
      this.deps.store.decisionsForRun(runId, identity.projectId),
      this.deps.store.findingsForRun(runId, identity.projectId),
    ]);
    return allow({ decisions, findings });
  }

  async inspectSubagents(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<readonly JuliusSubagentRecord[]>> {
    const run = await this.#authorizedRun(identity, runId, 'run:read');
    if (!run.ok) return run;
    // Scoped again on the way out. The store's own filter is by run, and a
    // record whose project disagrees with the caller's must not ride along on
    // a run the caller was allowed to name.
    const records = await this.deps.store.subagentsForRun(runId);
    return allow(records.filter((record) => record.projectId === identity.projectId));
  }

  async inspectGauntlet(identity: JuliusApiIdentity, runId: string, gauntletId: string): Promise<JuliusApiResult<{
    readonly gauntlet: JuliusGauntletRecord; readonly rounds: readonly JuliusGauntletRoundRecord[];
  } | null>> {
    const run = await this.#authorizedRun(identity, runId, 'run:read');
    if (!run.ok) return run;
    const gauntlet = await this.deps.store.loadGauntlet(runId, gauntletId);
    if (gauntlet === null || gauntlet.projectId !== identity.projectId) return allow(null);
    return allow({ gauntlet, rounds: await this.deps.store.roundsFor(gauntletId) });
  }

  async inspectApprovals(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<readonly JuliusApprovalRecord[]>> {
    const run = await this.#authorizedRun(identity, runId, 'run:read');
    if (!run.ok) return run;
    return allow(await this.deps.store.pendingApprovals(runId, identity.projectId));
  }

  /**
   * The safe timeline, page by page.
   *
   * GAPS ARE REPORTED, NOT FILLED. A missing sequence means the caller is not
   * being shown everything that happened, and that is the one thing a timeline
   * must never do quietly.
   */
  async timeline(
    identity: JuliusApiIdentity,
    runId: string,
    sinceSequence = 0,
    limit = JULIUS_TIMELINE_PAGE_LIMIT,
  ): Promise<JuliusApiResult<JuliusTimelinePage>> {
    const run = await this.#authorizedRun(identity, runId, 'run:read');
    if (!run.ok) return run;
    if (!Number.isSafeInteger(sinceSequence) || sinceSequence < 0) {
      return refuse('invalid_cursor', 'A timeline cursor is a non-negative sequence number.');
    }
    const bounded = Number.isSafeInteger(limit) && limit > 0
      ? Math.min(limit, JULIUS_TIMELINE_PAGE_LIMIT)
      : JULIUS_TIMELINE_PAGE_LIMIT;

    const page = await this.deps.timeline.timeline({
      runId, projectId: identity.projectId, sinceSequence, limit: bounded,
    });

    const entries: JuliusTimelineEntry[] = [];
    const seen = new Set<number>();
    let expected = sinceSequence + 1;
    let gapDetected = false;
    for (const entry of [...page.entries].sort((a, b) => a.sequence - b.sequence)) {
      if (seen.has(entry.sequence)) continue;      // duplicate delivery
      seen.add(entry.sequence);
      if (entry.sequence > expected) gapDetected = true;
      expected = entry.sequence + 1;
      entries.push(entry);
    }
    return allow({
      runId, entries, gapDetected, hasMore: page.hasMore,
      nextCursor: entries.at(-1)?.sequence ?? sinceSequence,
    });
  }

  /* ----------------------------------------------------------- controlling */

  async pause(identity: JuliusApiIdentity, runId: string, reason: string) {
    return this.#control(identity, runId, reason, pauseJuliusRun);
  }

  async resume(identity: JuliusApiIdentity, runId: string, reason: string) {
    return this.#control(identity, runId, reason, resumeJuliusRun);
  }

  async cancel(identity: JuliusApiIdentity, runId: string, reason: string) {
    return this.#control(identity, runId, reason, cancelJuliusRun);
  }

  /**
   * Answer an approval.
   *
   * TWO AUTHORITIES, DELIBERATELY. The API scope says this caller may submit
   * approval decisions AT ALL; `JuliusApproverAuthority` says whether THIS
   * identity may approve THAT operation on THIS run. A scope is about the
   * client; the authority is about the person, and collapsing them would let a
   * correctly-scoped service approve anything.
   */
  async decideApproval(
    identity: JuliusApiIdentity,
    input: { runId: string; approvalId: string; decision: 'APPROVED' | 'DENIED'; reason: string },
  ) {
    const authorized = this.#authorize(identity, 'approval:decide');
    if (authorized !== null) return authorized;
    return allow(await decideJuliusApproval({
      runId: input.runId, projectId: identity.projectId, approvalId: input.approvalId,
      decision: input.decision, approverId: identity.actorId, reason: input.reason,
    }, { ...this.#lifecycleDeps(), approvers: this.deps.approvers }));
  }

  /* -------------------------------------------------------------- internals */
  /*
   * `#`-PRIVATE, NOT `private`. TypeScript's `private` is erased, so a
   * `private` helper still appears on the prototype and is still callable from
   * JavaScript — which means a test that enumerates the public surface cannot
   * tell a helper from an endpoint, and neither can anything else. These are
   * genuinely inaccessible.
   */

  #lifecycleDeps(): JuliusLifecycleDependencies {
    return { store: this.deps.store, clock: this.deps.clock };
  }

  async #control<T>(
    identity: JuliusApiIdentity,
    runId: string,
    reason: string,
    operation: (
      input: { runId: string; projectId: string; actor: string; reason: string },
      deps: JuliusLifecycleDependencies,
    ) => Promise<T>,
  ): Promise<JuliusApiResult<T>> {
    const authorized = this.#authorize(identity, 'run:control');
    if (authorized !== null) return authorized as JuliusApiResult<T>;
    return allow(await operation(
      { runId, projectId: identity.projectId, actor: identity.actorId, reason },
      this.#lifecycleDeps(),
    ));
  }

  /**
   * The identity check, returning a refusal or `null` for "carry on".
   *
   * A BLANK FIELD IS A MISSING IDENTITY, not an empty one. An actor id of `''`
   * would otherwise be recorded as the approver of an approval, which is how a
   * control operation ends up attributed to nobody.
   */
  #authorize(identity: JuliusApiIdentity, scope: JuliusApiScope): JuliusApiResult<never> | null {
    for (const field of [identity.tenantId, identity.projectId, identity.actorId]) {
      if (typeof field !== 'string' || field.trim() === '') {
        return refuse('identity_incomplete', 'A caller must present a tenant, a project and an actor.');
      }
    }
    if (!identity.scopes.includes(scope)) {
      return refuse('scope_missing', `This caller does not hold the ${scope} scope.`);
    }
    return null;
  }

  /**
   * Authorize AND load, because the two must not be separable.
   *
   * A run that belongs to another project is reported as NOT FOUND rather than
   * as forbidden: telling a caller that a run exists somewhere they cannot see
   * is itself a leak, and "not found" is both true from where they stand and
   * the answer that leaks nothing.
   */
  async #authorizedRun(
    identity: JuliusApiIdentity, runId: string, scope: JuliusApiScope,
  ): Promise<JuliusApiResult<JuliusRunRow>> {
    const authorized = this.#authorize(identity, scope);
    if (authorized !== null) return authorized;
    if (typeof runId !== 'string' || runId.trim() === '') {
      return refuse('run_not_found', 'No such run in this project.');
    }
    const run = await this.deps.store.loadRun(runId, identity.projectId);
    if (run === null) return refuse('run_not_found', 'No such run in this project.');
    return allow(run);
  }
}
