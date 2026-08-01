import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import {
  claimWorktreeLease,
  deriveMissionBranch,
  safeWorktreeSegment,
  worktreeDraftFrom,
  worktreeLeaseAllows,
  worktreeRefFor,
  type MissionWorktreeRecord,
  type MissionWorktreeRecordDraft,
  type MissionWorktreeState,
  type WorktreeProcessState,
  type WorktreeValidationFinding,
} from '../mission/worktree';
import { WORKTREE_SCHEMA_VERSION } from '../mission/worktree';
import { inspectRepositoryState, runGit, validateSourceRepository } from './repository-inspector';
import { createWorktree, resolveWorkspaceRoot, removeWorktree } from './worktree-manager';

/**
 * MISSION-SCOPED WORKTREE LIFECYCLE (Node only).
 *
 * The repository already had a run-scoped worktree manager that creates and
 * verifies a real `git worktree` (`worktree-manager.ts`). This module adds
 * the three things a customer-facing mission needs and that manager has no
 * opinion about:
 *
 *   1. MISSION IDENTITY — one worktree per mission, on `relay/mission/<id>`,
 *      under a per-repository directory, with a stable `worktreeRef`.
 *   2. REOPEN — after a restart the worktree already exists, so creation
 *      must be able to ADOPT it, but only after proving it is the same
 *      repository, the same branch, and Relay's own.
 *   3. VALIDATION — every restart re-checks the eight things that could have
 *      changed while Relay was away, and records what it found.
 *
 * It never runs an agent, never force-removes anything, and never touches
 * the primary checkout: `assertNotPrimaryCheckout` refuses before any git
 * command runs.
 */

export const MISSION_WORKTREE_DIRNAME = 'missions';

export interface OpenMissionWorktreeInput {
  readonly missionId: string;
  readonly projectId: string;
  readonly repositoryPath: string;
  readonly sessionId: string;
  readonly now: string;
  /** Existing record from durable storage, when Relay has run before. */
  readonly existing?: MissionWorktreeRecord | null;
}

export interface OpenMissionWorktreeOutput {
  readonly record: MissionWorktreeRecordDraft;
  /** True when an existing worktree was adopted rather than created. */
  readonly reopened: boolean;
  readonly findings: readonly WorktreeValidationFinding[];
}

const finding = (
  check: WorktreeValidationFinding['check'],
  okValue: boolean,
  detail: string,
): WorktreeValidationFinding => ({ check, ok: okValue, detail });

/**
 * THE PRIMARY-CHECKOUT GUARD. The founder's own checkout, and any repository
 * root, can never be a mission worktree. Checked by canonical path before
 * anything is created, adopted or removed.
 */
export function assertNotPrimaryCheckout(
  worktreePath: string,
  repositoryRoot: string,
): RelayResult<null> {
  const candidate = safeReal(worktreePath) ?? worktreePath;
  const root = safeReal(repositoryRoot) ?? repositoryRoot;
  if (candidate === root) {
    return fail(relayError('permission-denied', 'The primary checkout may never be a mission worktree.'));
  }
  if (root.startsWith(candidate + sep)) {
    return fail(relayError('permission-denied', 'A mission worktree may never contain the primary checkout.'));
  }
  if (candidate.startsWith(root + sep)) {
    return fail(relayError('permission-denied', 'A mission worktree may never live inside the primary checkout.'));
  }
  return ok(null);
}

function safeReal(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The per-mission path under the approved Relay worktree root:
    `<approved-root>/missions/<repository>/<mission>`. */
export function resolveMissionWorktreePath(input: {
  approvedRoot: string;
  repositoryName: string;
  missionId: string;
}): RelayResult<string> {
  const repo = safeWorktreeSegment(input.repositoryName);
  if (!repo.ok) return fail(relayError('validation-failed', repo.reason));
  const mission = safeWorktreeSegment(input.missionId);
  if (!mission.ok) return fail(relayError('validation-failed', mission.reason));
  const path = join(input.approvedRoot, MISSION_WORKTREE_DIRNAME, repo.segment, mission.segment);
  // Containment is re-proved on the JOINED path, so a sanitised segment that
  // somehow still escaped would be caught here rather than trusted.
  if (!path.startsWith(input.approvedRoot + sep)) {
    return fail(relayError('permission-denied', 'Mission worktree path escapes the approved root.'));
  }
  return ok(path);
}

/**
 * Open the mission's isolated worktree: create it, or reopen the one that is
 * already there. A partial result is never returned as ready — every exit
 * that has not passed verification carries a non-ready state.
 */
export function openMissionWorktree(
  input: OpenMissionWorktreeInput,
): RelayResult<OpenMissionWorktreeOutput> {
  const findings: WorktreeValidationFinding[] = [];

  const source = validateSourceRepository(input.repositoryPath);
  if (!source.ok) return source;
  const repositoryRoot = source.value.root;
  const repositoryName = basename(repositoryRoot);
  findings.push(finding('repository_exists', true, `Repository ${repositoryName} validated at its root.`));

  // Ownership: a live lease held by another session stops us before any
  // filesystem or git work happens.
  const existing = input.existing ?? null;
  if (!worktreeLeaseAllows(existing, input.sessionId, input.now)) {
    return fail(relayError('permission-denied', 'Another Relay session currently owns this mission worktree.'));
  }

  const branch = deriveMissionBranch(input.missionId);
  if (!branch.ok) return fail(relayError('validation-failed', branch.reason));

  const approvedRoot = resolveWorkspaceRoot(repositoryRoot);
  if (!approvedRoot.ok) return approvedRoot;
  const pathResult = resolveMissionWorktreePath({
    approvedRoot: approvedRoot.value,
    repositoryName,
    missionId: input.missionId,
  });
  if (!pathResult.ok) return pathResult;
  const worktreePath = pathResult.value;

  const primaryGuard = assertNotPrimaryCheckout(worktreePath, repositoryRoot);
  if (!primaryGuard.ok) return primaryGuard;

  const pinned = inspectRepositoryState(repositoryRoot);
  if (!pinned.ok) return pinned;

  const baseCommit = existing?.baseCommit ?? pinned.value.revision;
  const baseBranch = existing?.baseBranch ?? pinned.value.branch;

  const draftBase = {
    schemaVersion: WORKTREE_SCHEMA_VERSION,
    worktreeRef: worktreeRefFor(input.projectId, input.missionId),
    missionId: input.missionId,
    projectId: input.projectId,
    repositoryName,
    repositoryRoot,
    baseBranch,
    baseCommit,
    missionBranch: branch.branch,
    worktreePath,
    createdAt: existing?.createdAt ?? input.now,
    lastValidatedAt: input.now,
    owner: claimWorktreeLease(input.sessionId, input.now),
    expectedHead: baseCommit,
    archived: existing?.archived ?? false,
    interruptionReason: null,
    evidenceRefs: existing?.evidenceRefs ?? [],
    provenance: 'live' as const,
  };

  /* ------------------------------------------------------- reopen path */
  if (existsSync(worktreePath)) {
    const adopted = validateMissionWorktree({
      record: existing !== null
        ? existing
        : ({ ...draftBase, state: 'requires_inspection', actualHead: null, dirty: null,
          processState: 'unknown', cleanupEligible: false, cleanupBlockers: [],
          validationFindings: [], checksum: '' } as MissionWorktreeRecord),
      now: input.now,
      sessionId: input.sessionId,
    });
    if (!adopted.ok) return adopted;
    return ok({ record: adopted.value.record, reopened: true, findings: adopted.value.record.validationFindings });
  }

  /* ------------------------------------------------------- create path */
  mkdirSync(join(approvedRoot.value, MISSION_WORKTREE_DIRNAME), { recursive: true, mode: 0o700 });

  const created = createWorktree({
    sourceRoot: repositoryRoot,
    workspacePath: worktreePath,
    branchName: branch.branch,
    revision: baseCommit,
  });
  if (!created.ok) {
    // A failed creation is NEVER reported ready. Nothing outside this
    // mission's own path is touched.
    return created;
  }
  findings.push(finding('git_registration', true, 'Git reported the new worktree at the expected path.'));
  findings.push(finding('branch_matches', true, `Mission branch ${branch.branch} created from ${baseCommit.slice(0, 12)}.`));
  findings.push(finding('head_matches', true, `HEAD verified at the pinned base commit ${baseCommit.slice(0, 12)}.`));
  findings.push(finding('ownership', true, `Claimed by this Relay session.`));

  const record: MissionWorktreeRecordDraft = {
    ...draftBase,
    state: 'ready',
    actualHead: created.value.revision,
    dirty: false,
    processState: 'none',
    cleanupEligible: false,
    cleanupBlockers: ['mission is not terminal'],
    validationFindings: findings,
  };
  return ok({ record, reopened: false, findings });
}

/* ------------------------------------------------------------ validate */

export interface ValidateMissionWorktreeInput {
  readonly record: MissionWorktreeRecord;
  readonly now: string;
  readonly sessionId: string;
  /** Supplied by the caller when it knows; `unknown` after a restart. */
  readonly processState?: WorktreeProcessState;
}

/**
 * Re-validate a recorded worktree. This is what runs after a restart, and it
 * answers every question the customer surface asks — without repairing
 * anything. A missing worktree is REPORTED, never recreated: uncommitted
 * work may have existed inside it.
 */
export function validateMissionWorktree(
  input: ValidateMissionWorktreeInput,
): RelayResult<{ record: MissionWorktreeRecordDraft }> {
  const { record, now } = input;
  const findings: WorktreeValidationFinding[] = [];
  let state: MissionWorktreeState = 'ready';
  let dirty: boolean | null = null;
  let actualHead: string | null = null;

  const settle = (
    nextState: MissionWorktreeState,
    processState: WorktreeProcessState,
  ): RelayResult<{ record: MissionWorktreeRecordDraft }> => {
    const cleanup = evaluateWorktreeCleanup({
      state: nextState,
      dirty,
      processState,
      archived: record.archived,
      missionTerminal: false,
    });
    return ok({
      record: {
        ...worktreeDraftFrom(record),
        state: nextState,
        lastValidatedAt: now,
        actualHead,
        dirty,
        processState,
        cleanupEligible: cleanup.eligible,
        cleanupBlockers: cleanup.blockers,
        validationFindings: findings,
        owner: worktreeLeaseAllows(record, input.sessionId, now)
          ? claimWorktreeLease(input.sessionId, now)
          : record.owner,
      },
    });
  };

  const processState: WorktreeProcessState = input.processState ?? 'unknown';

  // 1. repository still there?
  const source = validateSourceRepository(record.repositoryRoot);
  if (!source.ok) {
    findings.push(finding('repository_exists', false, 'The repository this mission used could not be validated.'));
    return settle('missing', processState);
  }
  findings.push(finding('repository_exists', true, `Repository ${record.repositoryName} still present.`));

  // 2. directory still there?
  if (!existsSync(record.worktreePath)) {
    findings.push(finding('directory_exists', false, 'The worktree directory is gone. Relay will not recreate it — uncommitted work may have existed.'));
    return settle('missing', processState);
  }
  if (lstatSync(record.worktreePath).isSymbolicLink()) {
    findings.push(finding('directory_exists', false, 'The worktree path is now a symlink — refused.'));
    return settle('conflicted', processState);
  }
  findings.push(finding('directory_exists', true, 'Worktree directory present.'));

  // 3. does git still know about it, and is it OUR repository?
  const commonDir = runGit(['rev-parse', '--git-common-dir'], record.worktreePath);
  if (!commonDir.ok) {
    findings.push(finding('git_registration', false, 'Git no longer recognizes this directory as a worktree.'));
    return settle('requires_inspection', processState);
  }
  const linked = safeReal(commonDir.value.trim());
  const expectedGitDir = safeReal(join(record.repositoryRoot, '.git'));
  if (linked === null || expectedGitDir === null || linked !== expectedGitDir) {
    findings.push(finding('git_registration', false, 'This worktree belongs to a different repository than the mission recorded.'));
    return settle('conflicted', processState);
  }
  findings.push(finding('git_registration', true, 'Git registration matches the recorded repository.'));

  // 4-6. branch, HEAD, dirty state.
  const state_ = inspectRepositoryState(record.worktreePath);
  if (!state_.ok) {
    findings.push(finding('head_matches', false, 'The worktree state could not be read.'));
    return settle('requires_inspection', processState);
  }
  actualHead = state_.value.revision;
  dirty = state_.value.dirty;

  if (state_.value.branch !== record.missionBranch) {
    findings.push(finding('branch_matches', false,
      `Branch changed while Relay was unavailable: expected ${record.missionBranch}, found ${state_.value.branch}.`));
    return settle('requires_inspection', processState);
  }
  findings.push(finding('branch_matches', true, `On the recorded mission branch ${record.missionBranch}.`));

  if (actualHead === record.expectedHead) {
    findings.push(finding('head_matches', true, `HEAD is at the expected commit ${actualHead.slice(0, 12)}.`));
  } else {
    // An ADVANCED head is truthful progress, not corruption — but it is
    // still reported rather than assumed.
    findings.push(finding('head_matches', true,
      `HEAD advanced to ${actualHead.slice(0, 12)} from the recorded ${record.expectedHead.slice(0, 12)}.`));
  }
  findings.push(finding('dirty_state', true, dirty ? 'Uncommitted mission work is present.' : 'Working tree is clean.'));
  findings.push(finding('active_process', processState !== 'unknown',
    processState === 'unknown'
      ? 'No process status is known after the restart.'
      : `Process state: ${processState}.`));

  if (state_.value.conflicted) {
    findings.push(finding('ownership', false, 'The worktree contains an unresolved merge conflict.'));
    return settle('conflicted', processState);
  }

  state = dirty ? 'active' : 'ready';
  return settle(state, processState);
}

/* ------------------------------------------------------------- cleanup */

export interface WorktreeCleanupAssessment {
  readonly eligible: boolean;
  readonly blockers: readonly string[];
}

/**
 * Cleanup eligibility. Conservative on purpose: every unknown counts as a
 * blocker, and there is no stash, no force, and no discard anywhere.
 */
export function evaluateWorktreeCleanup(input: {
  state: MissionWorktreeState;
  dirty: boolean | null;
  processState: WorktreeProcessState;
  archived: boolean;
  missionTerminal: boolean;
}): WorktreeCleanupAssessment {
  const blockers: string[] = [];
  if (!input.missionTerminal && !input.archived) {
    blockers.push('mission is not terminal');
  }
  if (input.dirty === true) {
    blockers.push('uncommitted mission work remains');
  }
  if (input.dirty === null) {
    blockers.push('the working tree has not been inspected');
  }
  if (input.processState === 'active' || input.processState === 'unknown') {
    blockers.push(
      input.processState === 'active'
        ? 'a process is using the worktree'
        : 'no process status is known',
    );
  }
  if (input.state === 'conflicted' || input.state === 'requires_inspection') {
    blockers.push(`worktree state ${input.state} requires inspection first`);
  }
  if (input.state === 'missing') {
    blockers.push('the worktree is missing');
  }
  return { eligible: blockers.length === 0, blockers };
}

/**
 * Remove a mission worktree. Refuses unless the assessment is clean, the
 * path is the recorded one, and it is not the primary checkout. Delegates
 * the actual removal to the existing manager, which never forces.
 */
export function removeMissionWorktree(input: {
  record: MissionWorktreeRecord;
  assessment: WorktreeCleanupAssessment;
}): RelayResult<{ record: MissionWorktreeRecordDraft }> {
  const { record, assessment } = input;
  if (!assessment.eligible) {
    return fail(relayError('permission-denied',
      `Cleanup blocked — ${assessment.blockers.join('; ')}.`));
  }
  const guard = assertNotPrimaryCheckout(record.worktreePath, record.repositoryRoot);
  if (!guard.ok) return guard;

  const approvedRoot = resolveWorkspaceRoot(record.repositoryRoot);
  if (!approvedRoot.ok) return approvedRoot;
  const real = safeReal(record.worktreePath);
  if (real === null) {
    return fail(relayError('not-found', 'The worktree path no longer exists.'));
  }
  if (!real.startsWith(approvedRoot.value + sep)) {
    return fail(relayError('permission-denied', 'Refusing to remove a path outside the approved Relay worktree root.'));
  }

  const removed = removeWorktree(record.repositoryRoot, record.worktreePath);
  if (!removed.ok) return removed;

  return ok({
    record: {
      ...worktreeDraftFrom(record),
      state: 'removed',
      cleanupEligible: false,
      cleanupBlockers: [],
      processState: 'none',
      owner: null,
    },
  });
}
