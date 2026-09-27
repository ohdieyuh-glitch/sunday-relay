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
 * integration registry, no mission authoring, and NO GAUNTLET. An earlier
 * version carried `inspectGauntlet`, which made a user-facing review command
 * part of the Julius execution API. The Gauntlet Loop reads its own state
 * through its own surface; Julius exposes only generic run, task, evidence,
 * verification, sub-agent and approval reads. Those are Relay's, they
 * already exist on the Relay side of the boundary, and duplicating them here
 * would put two answers in the product for one question.
 *
 * REFUSALS ARE VALUES. An unauthorized call, a missing run and a project
 * mismatch are ordinary outcomes with distinct reason codes, not exceptions:
 * a surface that has to catch to find out whether it may look is a surface
 * that will eventually forget to catch.
 */

import { JULIUS_DEFAULT_ROLES, type JuliusDefaultRole, type JuliusEvidence, type JuliusMissionState, type JuliusTask, type JuliusVerificationDecision } from './julius-runtime';
import type { JuliusReviewerFinding } from './julius-verification-runtime';
import type { JuliusSubagentRecord, JuliusSubagentStore } from './julius-subagent-runtime';
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

/**
 * WHAT THE MISSION PRODUCED, AND WHETHER IT MAY BE TRUSTED — the loop's last
 * step, which had no projection at all.
 *
 * THE GAP THIS CLOSES. A surface could read a run's state, its tasks, its
 * evidence, its decisions, its findings and its timeline, and from those six
 * reads assemble an answer to the only question a user actually asks: did it
 * work, what did it make, and can I believe it? Every client would assemble it
 * differently, and the first one to get it wrong would show a mission as done
 * because the run said COMPLETED while a criterion had no passing evidence. The
 * answer is computed once, here, from the record.
 *
 * WHAT IT REFUSES TO DO.
 *   - `verified` is true only when the RUN reached COMPLETED. Completion is the
 *     runtime's decision under the completion rule; this reports it and never
 *     re-derives it.
 *   - A criterion is satisfied by the verification evaluator's own rule — every
 *     required evidence type present and PASSED — imported rather than re-spelt.
 *   - An unknown cost is null beside a count of what is unknown, never zero.
 *   - A deliverable whose body was not retained says `retained: false` rather
 *     than reading as an empty one.
 *   - It carries no prose but the safe summaries the record already holds, and
 *     no reasoning of any kind.
 */
export interface JuliusMissionResultView {
  readonly runId: string;
  readonly missionId: string;
  readonly state: JuliusMissionState;
  /** COMPLETED, and nothing else, is a verified result. */
  readonly verified: boolean;
  /** True once the run can no longer change: COMPLETED, FAILED or CANCELLED. */
  readonly terminal: boolean;
  readonly criteria: readonly {
    readonly criterionId: string;
    readonly description: string;
    readonly requiredEvidenceTypes: readonly string[];
    readonly satisfied: boolean;
    /** The PASSED rows that satisfy it, so a reader can go and look. */
    readonly evidenceIds: readonly string[];
  }[];
  /**
   * WHAT THE MISSION MADE. Every PASSED evidence row that is a product rather
   * than a judgement — a diff, an artifact, a test result — with the reference
   * a body can be fetched by and whether one was retained at all.
   */
  readonly deliverables: readonly {
    readonly evidenceId: string;
    readonly taskId: string;
    readonly type: JuliusEvidence['type'];
    readonly safeSummary: string;
    readonly artifactRef: string | null;
    readonly integrityHash: string | null;
    /** False when no body was retained: a reference nobody can resolve is not one. */
    readonly retained: boolean;
    readonly occurredAt: string;
  }[];
  /** Blocking findings still open, which is why a run is not verified. */
  readonly outstandingFindings: readonly { readonly findingId: string; readonly taskId: string; readonly claim: string; readonly severity: string }[];
  /** The independent review's own acceptances, so "who verified this" has an answer. */
  readonly reviewDecisions: readonly { readonly taskId: string; readonly action: string; readonly reasonCode: string }[];
  /** Total spend, and what is unknown about it. Never a zero standing in for unknown. */
  readonly cost: {
    readonly knownUsdMicros: number;
    readonly unknownComponents: number;
    readonly complete: boolean;
  };
  /** Why it is not verified, when it is not: the named reason, never a guess. */
  readonly failure: { readonly reasonCode: string; readonly failureClass: string | null } | null;
}

/**
 * WHAT ONE C.A.R.D. SLOT IS DOING, FOR A SURFACE THAT HAS TO DRAW IT.
 *
 * WHY THIS EXISTS. Wonderland has to represent three peers — the Prompt
 * Architect, the Coding Agent, the Independent Reviewer — and `JuliusRunView`
 * carries a run state and task counts. A surface given only that has two
 * choices: invent per-role state from task names, or read the timeline and
 * re-derive the runtime's own conclusions in UI code. Both make the UI a second
 * authority on Julius, which is the failure this API exists to prevent.
 *
 * EVERY FIELD IS PROJECTED FROM THE DURABLE LEDGER. Nothing here is counted
 * alongside the events; a number that disagreed with the timeline would be
 * impossible rather than unlikely.
 *
 * AND EVERY UNKNOWN IS NULL. A slot whose provider never reported a model has
 * `servedModel: null`, not the requested one — the two are separate fields
 * because the provider's answer is the only authority on what actually ran. A
 * slot whose costs were never reported has `costComplete: false` and a
 * `knownUsdMicros` that is a FLOOR. A surface that renders a floor as a total is
 * wrong, and this shape is what lets it know.
 */
export interface JuliusSlotView {
  /**
   * ONE OF THE THREE PERMANENT PEERS, and deliberately not `JuliusWorkerRole`.
   * A `SPECIALIST:*` is a bounded child of a slot rather than a slot: it has no
   * standing peer to draw, and `inspectSubagents` is where its record lives.
   * Widening this to the full union would promise rows nothing ever produces.
   */
  readonly role: JuliusDefaultRole;
  /** The worker that most recently held this slot, or null if none ever has. */
  readonly workerId: string | null;
  /** The provider that answered, as the adapter reported it. Never inferred. */
  readonly providerId: string | null;
  /** What was ASKED FOR. */
  readonly requestedModel: string | null;
  /** What ANSWERED. Null is the provider's silence, never a copy of the request. */
  readonly servedModel: string | null;
  /**
   * `NEVER_DISPATCHED` is a real state and the commonest one early in a mission.
   * `ACTIVE` means a dispatch is open — dispatched with nothing recorded after
   * it. `FAILED` means this slot's last recorded outcome was a failure, which is
   * not the same as the run having failed.
   */
  readonly state: 'NEVER_DISPATCHED' | 'ACTIVE' | 'IDLE' | 'FAILED';
  readonly dispatches: number;
  /** The ledger position of this slot's last activity. Null when it has none. */
  readonly lastSequence: number | null;
  /** A FLOOR whenever `costComplete` is false. */
  readonly knownUsdMicros: number;
  /** Settlements this slot made that reported no amount. Not zero-cost ones. */
  readonly unknownCostComponents: number;
  readonly costComplete: boolean;
  /** The failure class of this slot's last failure, or null. Never prose. */
  readonly lastFailureClass: string | null;
  /** Findings this slot RAISED, which is a reviewer's number and nobody else's. */
  readonly findingsRaised: number;
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
  readonly store: JuliusRuntimeStore & JuliusSubagentStore & JuliusApprovalStore & JuliusLifecycleStore;
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

  /**
   * THE RESULT, AS A USER WOULD ASK FOR IT. One read, from the record, with the
   * completion decision quoted rather than recomputed. See
   * `JuliusMissionResultView` for what it will not say.
   */
  async inspectResult(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<JuliusMissionResultView>> {
    const authorized = await this.#authorizedRun(identity, runId, 'run:read');
    if (!authorized.ok) return authorized;
    const run = authorized.value;
    const [criteria, evidence, findings, decisions, entries] = await Promise.all([
      this.deps.store.criteriaForRun(runId, identity.projectId),
      this.deps.store.evidenceForRun(runId, identity.projectId),
      this.deps.store.findingsForRun(runId, identity.projectId),
      this.deps.store.decisionsForRun(runId, identity.projectId),
      // ONE WALK, TWO PROJECTIONS: the slots and the failure both come from the
      // same entries, so they cannot describe different moments of the run.
      this.#timelineEntries(runId, identity.projectId),
    ]);
    const slots = projectJuliusSlotViews(entries);

    const passed = evidence.filter((item) => item.status === 'PASSED');
    const satisfies = (criterion: { readonly requiredEvidenceTypes: readonly string[] }) =>
      // THE EVALUATOR'S OWN RULE, not a second opinion: every required type
      // present and PASSED. A criterion that requires nothing is satisfied by
      // the run reaching completion, which is what `verified` reports.
      criterion.requiredEvidenceTypes.every((type) => passed.some((item) => item.type === type));

    /**
     * A JUDGEMENT IS NOT A DELIVERABLE. A review finding and a provider receipt
     * say what somebody thought or what was billed; a diff, an artifact and a
     * test result are what the mission produced. A surface that showed the
     * former as the result would be showing the reviewer's opinion as the work.
     */
    const PRODUCT_TYPES: readonly JuliusEvidence['type'][] = ['DIFF', 'ARTIFACT', 'TEST', 'BUILD', 'LINT', 'TYPECHECK', 'COMMAND'];

    const cost = slots.reduce(
      (total, slot) => ({
        knownUsdMicros: total.knownUsdMicros + slot.knownUsdMicros,
        unknownComponents: total.unknownComponents + slot.unknownCostComponents,
        complete: total.complete && slot.costComplete,
      }),
      { knownUsdMicros: 0, unknownComponents: 0, complete: true },
    );

    /**
     * WHY IT IS NOT VERIFIED — and a FAILED run must always be able to say.
     *
     * Three sources, in the order a reader would want them: the last `task.failed`
     * row (which carries the dispatch's own code and class), then a HALT or
     * REPAIR decision (the verification's own reason), then — for a run that is
     * FAILED with neither, which should not happen and therefore must not be
     * silent — a named `UNRECORDED` rather than null. `null` is reserved for "no
     * failure", and a failed run answering null would read as a success.
     */
    const lastFailed = [...entries].reverse().find((entry) => entry.type === 'task.failed') ?? null;
    const text = (value: unknown): string | null =>
      (typeof value === 'string' && value.trim() !== '' ? value : null);
    const haltOrRepair = [...decisions].reverse()
      .find((decision) => decision.action === 'HALT' || decision.action === 'REPAIR') ?? null;
    const failure = run.state === 'COMPLETED'
      ? null
      : lastFailed !== null
        ? {
          reasonCode: text(lastFailed.facts.reasonCode) ?? text(lastFailed.facts.code) ?? 'TASK_FAILED',
          failureClass: text(lastFailed.facts.failureClass),
        }
        : haltOrRepair !== null
          ? { reasonCode: haltOrRepair.reasonCode, failureClass: null }
          : run.state === 'FAILED' || run.state === 'CANCELLED'
            ? { reasonCode: 'UNRECORDED', failureClass: null }
            : null;

    return allow({
      runId: run.runId,
      missionId: run.missionId,
      state: run.state,
      // NEVER DERIVED. The runtime decided this under the completion rule.
      verified: run.state === 'COMPLETED',
      terminal: run.state === 'COMPLETED' || run.state === 'FAILED' || run.state === 'CANCELLED',
      criteria: criteria.map((criterion) => ({
        criterionId: criterion.criterionId,
        description: criterion.description,
        requiredEvidenceTypes: criterion.requiredEvidenceTypes,
        satisfied: satisfies(criterion),
        evidenceIds: passed
          .filter((item) => criterion.requiredEvidenceTypes.includes(item.type))
          .map((item) => item.evidenceId),
      })),
      deliverables: passed
        .filter((item) => PRODUCT_TYPES.includes(item.type))
        .map((item) => ({
          evidenceId: item.evidenceId, taskId: item.taskId, type: item.type,
          safeSummary: item.safeSummary, artifactRef: item.artifactRef, integrityHash: item.integrityHash,
          retained: item.artifactRef !== null,
          occurredAt: item.occurredAt,
        })),
      outstandingFindings: findings
        .filter((finding) => finding.blocking && finding.status === 'OPEN')
        .map((finding) => ({ findingId: finding.findingId, taskId: finding.taskId, claim: finding.claim, severity: finding.severity })),
      reviewDecisions: decisions.map((decision) => ({
        taskId: decision.taskId, action: decision.action, reasonCode: decision.reasonCode,
      })),
      cost,
      failure,
    });
  }

  /**
   * THE THREE PEER SLOTS, PROJECTED. One page of the timeline per call at the
   * reader's own limit, walked to the end — the same paging every other
   * projection here uses, so a long mission does not silently report a prefix.
   */
  async inspectSlots(identity: JuliusApiIdentity, runId: string): Promise<JuliusApiResult<readonly JuliusSlotView[]>> {
    const authorized = await this.#authorizedRun(identity, runId, 'run:read');
    if (!authorized.ok) return authorized;
    return allow(projectJuliusSlotViews(await this.#timelineEntries(runId, identity.projectId)));
  }

  /**
   * THE WHOLE TIMELINE, WALKED TO THE END — one page at a time, so a long
   * mission is never reported from a prefix. Shared by every projection that
   * needs the event record, because two walkers would eventually disagree about
   * where the end was.
   */
  async #timelineEntries(runId: string, projectId: string): Promise<readonly JuliusTimelineEntry[]> {
    const entries: JuliusTimelineEntry[] = [];
    let sinceSequence = 0;
    for (;;) {
      const page = await this.deps.timeline.timeline({ runId, projectId, sinceSequence, limit: 500 });
      entries.push(...page.entries);
      if (page.entries.length === 0 || !page.hasMore) break;
      sinceSequence = Math.max(...page.entries.map((entry: JuliusTimelineEntry) => entry.sequence));
    }
    return entries;
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

/* ---------------------------------------------------- the slot projection */

/**
 * THE THREE SLOTS, OUT OF THE LEDGER AND NOTHING ELSE.
 *
 * Exported so the projection is testable without an API instance, and so a
 * bundle exporter can produce the same rows from a dump of the same events.
 *
 * ONE PASS, IN LEDGER ORDER. `sequence` is the position the ledger allocates on
 * append — `UNIQUE(stream_id, sequence)` in PostgreSQL — and NOT `occurredAt`,
 * which routinely ties: several events of one mission land in the same
 * millisecond and a wall-clock sort has no deterministic tiebreak.
 */
export function projectJuliusSlotViews(
  entries: readonly JuliusTimelineEntry[],
): readonly JuliusSlotView[] {
  const ordered = [...entries].sort((left, right) => left.sequence - right.sequence);
  const byRole = new Map<JuliusDefaultRole, {
    workerId: string | null; providerId: string | null;
    requestedModel: string | null; servedModel: string | null;
    dispatches: number; lastSequence: number | null;
    knownUsdMicros: number; unknownCostComponents: number;
    lastFailureClass: string | null; findingsRaised: number;
    open: boolean; failed: boolean;
  }>();
  const roleOfTask = new Map<string, JuliusDefaultRole>();
  const slot = (role: JuliusDefaultRole) => {
    const existing = byRole.get(role);
    if (existing !== undefined) return existing;
    const fresh = {
      workerId: null, providerId: null, requestedModel: null, servedModel: null,
      dispatches: 0, lastSequence: null as number | null,
      knownUsdMicros: 0, unknownCostComponents: 0,
      lastFailureClass: null as string | null, findingsRaised: 0,
      open: false, failed: false,
    };
    byRole.set(role, fresh);
    return fresh;
  };

  const text = (value: unknown): string | null =>
    (typeof value === 'string' && value.trim() !== '' ? value : null);
  const roleOf = (entry: JuliusTimelineEntry): JuliusDefaultRole | null => {
    const stated = text(entry.facts.role);
    if (stated !== null && (JULIUS_DEFAULT_ROLES as readonly string[]).includes(stated)) {
      return stated as JuliusDefaultRole;
    }
    // A row that does not state its role still belongs to a task whose role an
    // earlier row did state. Nothing is guessed from a task NAME.
    return entry.taskId === null ? null : roleOfTask.get(entry.taskId) ?? null;
  };

  for (const entry of ordered) {
    const role = roleOf(entry);
    if (role === null) continue;
    if (entry.taskId !== null) roleOfTask.set(entry.taskId, role);
    const account = slot(role);
    account.lastSequence = entry.sequence;
    if (entry.workerId !== null) account.workerId = entry.workerId;
    // Provider identity and the two model fields arrive on whichever row carries
    // the adapter's diagnostics. They are only ever OVERWRITTEN by a later row
    // that states them, so a silent row cannot erase what an earlier one said.
    account.providerId = text(entry.facts.provider) ?? text(entry.facts.providerId) ?? account.providerId;
    account.requestedModel = text(entry.facts.requestedModel) ?? account.requestedModel;
    account.servedModel = text(entry.facts.servedModel) ?? account.servedModel;

    switch (entry.type) {
      case 'worker.dispatched':
        account.dispatches += 1;
        account.open = true;
        break;
      case 'worker.completed':
        account.open = false;
        account.failed = false;
        break;
      case 'task.failed':
      case 'provider.failure':
        account.open = false;
        account.failed = true;
        account.lastFailureClass = text(entry.facts.failureClass) ?? account.lastFailureClass;
        break;
      case 'finding.recorded':
        account.findingsRaised += 1;
        break;
      case 'budget.settled': {
        const amount = entry.facts.usdMicros;
        // AN UNKNOWN SETTLEMENT IS NOT A FREE ONE. It is counted as a component
        // nobody priced, which is what turns the sum into a floor.
        if (typeof amount === 'number' && Number.isFinite(amount) && amount >= 0) {
          account.knownUsdMicros += amount;
        } else {
          account.unknownCostComponents += 1;
        }
        break;
      }
      default:
        break;
    }
  }

  return JULIUS_DEFAULT_ROLES.map((role): JuliusSlotView => {
    const account = byRole.get(role);
    if (account === undefined) {
      return {
        role, workerId: null, providerId: null, requestedModel: null, servedModel: null,
        state: 'NEVER_DISPATCHED', dispatches: 0, lastSequence: null,
        knownUsdMicros: 0, unknownCostComponents: 0, costComplete: true,
        lastFailureClass: null, findingsRaised: 0,
      };
    }
    return {
      role,
      workerId: account.workerId,
      providerId: account.providerId,
      requestedModel: account.requestedModel,
      servedModel: account.servedModel,
      state: account.dispatches === 0 ? 'NEVER_DISPATCHED'
        : account.open ? 'ACTIVE' : account.failed ? 'FAILED' : 'IDLE',
      dispatches: account.dispatches,
      lastSequence: account.lastSequence,
      knownUsdMicros: account.knownUsdMicros,
      unknownCostComponents: account.unknownCostComponents,
      costComplete: account.unknownCostComponents === 0,
      lastFailureClass: account.lastFailureClass,
      findingsRaised: account.findingsRaised,
    };
  });
}
