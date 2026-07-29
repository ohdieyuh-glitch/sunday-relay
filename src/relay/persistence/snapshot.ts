import { existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import type { RelayExecutionAttestation, RelayFinding, RelayRepair } from '../mission/contracts';
import type { OutputVisibility } from '../mission/entitlement';
import {
  freshCallBudget, RELAY_STATE_SCHEMA_VERSION, TERMINAL_LIFECYCLE_STATES,
  type EvidenceManifest, type PersistedEvent, type ProviderSessionReference,
  type RunLifecycleState, type RunSnapshot,
} from './contracts';
import { digestOf } from './integrity';
import { readTextIfExists, writeFileAtomic } from './atomic-file';

/**
 * Snapshots + deterministic replay (Prompt 8.5). The journal remains the
 * single authority; a snapshot is a versioned, digest-validated projection
 * that must ALWAYS be reconstructable by replaying the journal from scratch.
 * Snapshot writes rotate the previous known-good copy to
 * `snapshot.previous.json` — the only known-good snapshot is never
 * overwritten in place — and the loader falls back previous→replay-only.
 *
 * Replay validates every lifecycle transition against an explicit edge map
 * (recovery can never skip states) and enforces call-budget monotonicity
 * (an event can never un-consume a call).
 */

export const SNAPSHOT_FILE = 'snapshot.json';
export const SNAPSHOT_PREVIOUS_FILE = 'snapshot.previous.json';

/* ----------------------- lifecycle transitions ---------------------- */

const EDGES: Record<RunLifecycleState, readonly RunLifecycleState[]> = {
  initialized: ['implementation_running', 'stopped_safely', 'canceled'],
  implementation_running: ['held_for_inspection', 'stopped_safely', 'canceled'],
  held_for_inspection: ['held_for_verification', 'held_for_reverification', 'stopped_safely'],
  held_for_verification: ['held_for_review', 'stopped_safely'],
  held_for_review: ['revision_required', 'approved_for_release', 'stopped_safely', 'canceled'],
  revision_required: ['repair_authorized', 'stopped_safely'],
  repair_authorized: ['repair_running', 'stopped_safely'],
  repair_running: ['held_for_inspection', 'stopped_safely', 'canceled'],
  held_for_reverification: ['held_for_rereview', 'stopped_safely'],
  held_for_rereview: ['approved_for_release', 'stopped_safely'],
  approved_for_release: ['verified_complete', 'stopped_safely'],
  verified_complete: ['released'],
  released: [],
  stopped_safely: [],
  canceled: [],
  recovery_required: [],
  corrupted: ['quarantined'],
  quarantined: [],
};

export function canTransition(from: RunLifecycleState, to: RunLifecycleState): boolean {
  if (from === to) return true;
  // Recovery marking suspends any non-terminal state; recovery_ready returns
  // to the exact pre-recovery state recorded in the marker payload.
  if (to === 'recovery_required') return !TERMINAL_LIFECYCLE_STATES.includes(from);
  if (from === 'recovery_required') return to !== 'verified_complete' && to !== 'released';
  if (to === 'quarantined') return true;
  return EDGES[from]?.includes(to) ?? false;
}

/* ----------------------------- reducer ------------------------------ */

export type ReducedState = Omit<RunSnapshot, 'stateDigest'>;

export interface ReplayResult {
  state: ReducedState | null;
  problems: string[];
}

function emptyState(runId: string): ReducedState {
  return {
    schemaVersion: RELAY_STATE_SCHEMA_VERSION,
    runId,
    project: { projectId: '', displayName: '', missionIds: [], ledgerRefs: [] },
    mission: { missionId: '', objective: '', acceptanceCriteria: [], policyRefs: [], taskIds: [], requestedWorkforce: [] },
    task: { taskId: '', owner: null, status: 'pending', fileClaims: [], protectedPaths: [], attemptLineage: [] },
    run: {
      mode: 'guided', lifecycle: 'initialized', startedAt: '', updatedAt: '', phase: 'initialized',
      outputVisibility: 'working', stopReason: null, completionVerdict: null,
    },
    callBudget: freshCallBudget(0, {}),
    workspace: null,
    sessions: [],
    attestations: [],
    evidence: [],
    findings: [],
    repairs: [],
    pendingManualTasks: [],
    lastEventSequence: 0,
  };
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** Apply one event. Returns an error string on an ILLEGAL application —
 * replay treats that as corruption, never silent continuation. */
export function applyEvent(state: ReducedState, event: PersistedEvent): string | null {
  const p = event.payload;

  const moveLifecycle = (): string | null => {
    const to = p.lifecycleAfter as RunLifecycleState | undefined;
    if (to === undefined) return null;
    if (!canTransition(state.run.lifecycle, to)) {
      return `invalid lifecycle transition ${state.run.lifecycle} -> ${to} at seq ${event.sequence}`;
    }
    state.run.lifecycle = to;
    return null;
  };
  const setVisibility = (): void => {
    const v = p.visibilityAfter as OutputVisibility | undefined;
    if (v !== undefined) state.run.outputVisibility = v;
  };
  const consumeCall = (): string | null => {
    const provider = str(p.provider);
    const budget = state.callBudget;
    const entry = budget.byProvider[provider];
    if (!entry) return `call authorized for unknown provider "${provider}" at seq ${event.sequence}`;
    if (budget.remaining <= 0 || entry.consumed >= entry.max) {
      return `call authorized beyond the persisted budget at seq ${event.sequence}`;
    }
    budget.consumed += 1;
    budget.remaining = budget.maxCalls - budget.consumed;
    entry.consumed += 1;
    return null;
  };
  const upsertSession = (): void => {
    const ref = p.sessionRef as Partial<ProviderSessionReference> | undefined;
    if (!ref || (ref.provider !== 'claude' && ref.provider !== 'codex')) return;
    const existing = state.sessions.find((s) => s.provider === ref.provider);
    const merged: ProviderSessionReference = {
      provider: ref.provider,
      adapterId: str(ref.adapterId, existing?.adapterId ?? ''),
      relayRef: str(ref.relayRef, existing?.relayRef ?? ''),
      providerSessionId: typeof ref.providerSessionId === 'string' ? ref.providerSessionId : existing?.providerSessionId ?? null,
      projectId: state.project.projectId, missionId: state.mission.missionId,
      taskId: state.task.taskId, runId: state.runId,
      workspaceId: state.workspace?.workspaceId ?? '',
      attempt: num(ref.attempt, existing?.attempt ?? 1),
      executionAuthor: str(ref.executionAuthor, existing?.executionAuthor ?? ''),
      independenceGroup: str(ref.independenceGroup, existing?.independenceGroup ?? ''),
      initializationVerified: ref.initializationVerified === true || existing?.initializationVerified === true,
      createdAt: existing?.createdAt ?? event.at,
      lastUsedAt: event.at,
      resumeEligible: ref.resumeEligible ?? existing?.resumeEligible ?? true,
      invalidated: ref.invalidated ?? existing?.invalidated ?? false,
      readiness: 'persisted_unverified',
    };
    if (existing) Object.assign(existing, merged);
    else state.sessions.push(merged);
  };
  const appendEvidence = (): void => {
    const manifest = p.evidence as EvidenceManifest | undefined;
    if (manifest && typeof manifest.evidenceId === 'string') state.evidence.push({ ...manifest, status: 'current' });
    const revision = str(p.workspaceRevision, event.workspaceRevision ?? '');
    if (state.workspace && revision) state.workspace.lastVerifiedRevision = revision;
  };

  switch (event.kind) {
    case 'run.initialized': {
      state.project = {
        projectId: str(p.projectId, event.projectId), displayName: str(p.displayName),
        missionIds: [str(p.missionId, event.missionId ?? '')], ledgerRefs: strArray(p.ledgerRefs),
      };
      state.mission = {
        missionId: str(p.missionId, event.missionId ?? ''), objective: str(p.objective),
        acceptanceCriteria: Array.isArray(p.acceptanceCriteria)
          ? (p.acceptanceCriteria as Array<{ id: string; text: string; blocking: boolean }>) : [],
        policyRefs: strArray(p.policyRefs), taskIds: [str(p.taskId, event.taskId ?? '')],
        requestedWorkforce: strArray(p.requestedWorkforce),
      };
      state.task = {
        taskId: str(p.taskId, event.taskId ?? ''), owner: str(p.owner) || null, status: 'assigned',
        fileClaims: strArray(p.claimedFiles), protectedPaths: strArray(p.protectedPaths), attemptLineage: [1],
      };
      state.run.mode = str(p.mode, 'guided');
      state.run.startedAt = event.at;
      state.run.phase = str(p.phase, 'initialized');
      state.callBudget = freshCallBudget(
        num(p.maxCalls), Object.fromEntries(Object.entries((p.providerBudgets as Record<string, number>) ?? {})
          .map(([k, v]) => [k, num(v)])),
      );
      break;
    }
    case 'workspace.created': {
      state.workspace = {
        workspaceId: str(p.workspaceId), canonicalPath: str(p.canonicalPath),
        sourceRepositoryPath: str(p.sourceRepositoryPath), sourceRevision: str(p.sourceRevision),
        worktreeBranch: str(p.worktreeBranch), claimedFiles: strArray(p.claimedFiles),
        protectedPaths: strArray(p.protectedPaths), lastInspectedRevision: null, lastVerifiedRevision: null,
        claimedFileDigests: {}, cleanupStatus: 'active',
      };
      break;
    }
    case 'provider_launch.authorized':
    case 'session_resume.authorized': {
      const budgetProblem = consumeCall();
      if (budgetProblem) return budgetProblem;
      if (event.kind === 'session_resume.authorized') {
        const provider = str(p.provider);
        const session = state.sessions.find((s) => s.provider === provider);
        if (session) { session.attempt = 2; session.lastUsedAt = event.at; session.resumeEligible = false; }
        if (!state.task.attemptLineage.includes(2)) state.task.attemptLineage.push(2);
      }
      break;
    }
    case 'implementer.initialization_verified':
    case 'reviewer.initialization_verified':
    case 'implementer.report_received':
      upsertSession();
      break;
    case 'workspace.inspected': {
      if (state.workspace) {
        state.workspace.lastInspectedRevision = str(p.revision, event.workspaceRevision ?? '') || null;
        const digests = p.claimedFileDigests as Record<string, string> | undefined;
        if (digests) state.workspace.claimedFileDigests = { ...digests };
      }
      break;
    }
    case 'verification.completed':
    case 're_verification.completed':
      appendEvidence();
      break;
    case 'review.received':
    case 're_review.received': {
      upsertSession();
      if (Array.isArray(p.attestation) === false && p.attestation && typeof p.attestation === 'object') {
        state.attestations.push(p.attestation as RelayExecutionAttestation);
      }
      if (Array.isArray(p.findings)) state.findings = p.findings as RelayFinding[];
      if (Array.isArray(p.repairs)) state.repairs = p.repairs as RelayRepair[];
      break;
    }
    case 'finding.created':
      if (Array.isArray(p.findings)) state.findings = p.findings as RelayFinding[];
      break;
    case 'repair.created':
      if (Array.isArray(p.repairs)) state.repairs = p.repairs as RelayRepair[];
      break;
    case 'repair.received':
      break;
    case 'completion.evaluated':
      state.run.completionVerdict = str(p.outcome) || null;
      break;
    case 'run.verified_complete':
      state.run.completionVerdict = 'verified_complete';
      break;
    case 'run.stopped_safely':
      state.run.stopReason = str(p.stopReason) || null;
      break;
    case 'cleanup.completed':
      if (state.workspace) state.workspace.cleanupStatus = 'cleaned';
      break;
    case 'evidence.marked_stale': {
      const ids = new Set(strArray(p.evidenceIds));
      for (const manifest of state.evidence) if (ids.has(manifest.evidenceId)) manifest.status = 'stale';
      break;
    }
    case 'run.recovery_required':
      state.run.phase = 'recovery';
      break;
    case 'run.recovery_ready':
      state.run.phase = str(p.phase, state.run.phase);
      break;
    case 'run.archived':
    case 'run.quarantined':
      break;
    default:
      return `unhandled event kind ${event.kind as string} at seq ${event.sequence}`;
  }

  const lifecycleProblem = moveLifecycle();
  if (lifecycleProblem) return lifecycleProblem;
  setVisibility();
  if (typeof p.phase === 'string' && event.kind !== 'run.recovery_ready') state.run.phase = p.phase;
  state.run.updatedAt = event.at;
  state.lastEventSequence = event.sequence;
  return null;
}

/** Deterministic full replay of the journal into a reduced state. */
export function replayJournal(runId: string, events: readonly PersistedEvent[], from?: ReducedState): ReplayResult {
  const state = from ? structuredClone(from) : emptyState(runId);
  const problems: string[] = [];
  for (const event of events) {
    if (event.sequence <= state.lastEventSequence) continue; // idempotent replay
    const problem = applyEvent(state, event);
    if (problem) { problems.push(problem); return { state: null, problems }; }
  }
  return { state, problems };
}

export function snapshotFromState(state: ReducedState): RunSnapshot {
  return { ...structuredClone(state), stateDigest: digestOf(state) };
}

/* --------------------------- read / write --------------------------- */

export function writeSnapshot(runDir: string, snapshot: RunSnapshot): void {
  const current = join(runDir, SNAPSHOT_FILE);
  const previous = join(runDir, SNAPSHOT_PREVIOUS_FILE);
  const serialized = JSON.stringify(snapshot, null, 0);
  if (existsSync(current)) renameSync(current, previous);
  writeFileAtomic(current, serialized);
}

export type SnapshotSource = 'current' | 'previous' | 'replay_only';

export interface SnapshotLoadResult {
  snapshot: RunSnapshot | null;
  source: SnapshotSource;
  diagnostics: string[];
}

function parseAndValidate(text: string | null, label: string, diagnostics: string[]): RunSnapshot | null {
  if (text === null) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { diagnostics.push(`${label} snapshot is not valid JSON`); return null; }
  if (parsed === null || typeof parsed !== 'object') { diagnostics.push(`${label} snapshot is not an object`); return null; }
  const snapshot = parsed as RunSnapshot;
  if (snapshot.schemaVersion !== RELAY_STATE_SCHEMA_VERSION) {
    diagnostics.push(`${label} snapshot has schema ${String(snapshot.schemaVersion)} (expected ${RELAY_STATE_SCHEMA_VERSION})`);
    return null;
  }
  const { stateDigest, ...rest } = snapshot;
  if (digestOf(rest) !== stateDigest) { diagnostics.push(`${label} snapshot digest mismatch`); return null; }
  return snapshot;
}

/** Load the newest VALID snapshot: current → previous → none (replay-only). */
export function loadSnapshot(runDir: string): SnapshotLoadResult {
  const diagnostics: string[] = [];
  const current = parseAndValidate(readTextIfExists(join(runDir, SNAPSHOT_FILE)), 'current', diagnostics);
  if (current) return { snapshot: current, source: 'current', diagnostics };
  const previous = parseAndValidate(readTextIfExists(join(runDir, SNAPSHOT_PREVIOUS_FILE)), 'previous', diagnostics);
  if (previous) {
    diagnostics.push('fell back to the previous known-good snapshot');
    return { snapshot: previous, source: 'previous', diagnostics };
  }
  diagnostics.push('no valid snapshot — reconstructing by full journal replay');
  return { snapshot: null, source: 'replay_only', diagnostics };
}
