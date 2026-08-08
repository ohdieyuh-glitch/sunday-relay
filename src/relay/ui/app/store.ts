import { validateSettingsDraft } from '../project-settings/validation';
import { AGENT_OPTIONS } from '../project-settings/options';
import { createDefaultSettingsDraft } from '../project-settings/defaults';
import type { ProjectBriefDraft } from '../entry-home/contracts';
import type { ProjectSettingsDraft } from '../project-settings/contracts';
import { emptyRelayAppData } from './contracts';
import type {
  LiveMissionUpdate,
  RelayAppData,
  RelayApplicationAdapter,
  RelayEvent,
  RelayMission,
  RelayProject,
  StoredProjectBrief,
  StoredProjectSettings,
} from './contracts';
import { createRelayAppStorage } from './persistence';
import type { RelayAppStorage } from './persistence';
import { createDemoRelayApplicationAdapter } from './demo-adapter';
import { createLiveRelayApplicationAdapter } from './live-adapter';
import { createOperationalStore } from '../../shared/llmops';
import type { RelayOperationalRecord, RunObservation } from '../../shared/llmops';

/**
 * RELAY APPLICATION STORE — the service layer and single source of truth
 * for domain state (projects, briefs, settings, brains, missions, events,
 * active project, colorway). Views subscribe; every confirmed mutation
 * writes through the persistence adapter, so refresh, back/forward, and
 * direct routes restore the exact product state.
 *
 * Rules enforced here, not in components:
 *   - duplicate submissions cannot create duplicate projects/missions
 *   - mission state only moves through the adapter's machine
 *   - VERIFIED COMPLETE derives from the machine, never from a view
 *   - demo restart exists only for demo missions
 *   - user-facing errors are simple strings — never raw error objects
 */

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; message: string };

export interface RelayAppStore {
  getState(): RelayAppData;
  subscribe(listener: () => void): () => void;
  /** Idempotent — safe to call on every mount. */
  init(): void;

  // project service
  listProjects(): RelayProject[];
  getProject(projectId: string): RelayProject | null;
  setActiveProject(projectId: string | null): void;

  // brief service
  createDraftFromRequest(request: string): ServiceResult<{ project: RelayProject; brief: StoredProjectBrief }>;
  getBrief(projectId: string): StoredProjectBrief | null;
  updateBrief(projectId: string, patch: Partial<ProjectBriefDraft>): ServiceResult<StoredProjectBrief>;
  approveBrief(projectId: string): ServiceResult<StoredProjectBrief>;
  clearDraft(projectId: string): void;

  // settings service
  getSettings(projectId: string): StoredProjectSettings | null;
  saveSettings(projectId: string, draft: ProjectSettingsDraft): ServiceResult<StoredProjectSettings>;
  startProject(projectId: string, draft: ProjectSettingsDraft): ServiceResult<{ project: RelayProject; mission: RelayMission }>;

  // brain service
  getProjectBrain(projectId: string): ReturnType<RelayApplicationAdapter['prepareProjectBrain']> | null;

  // operations service
  /**
   * The operational record for a project, or `null` when nothing has been
   * recorded — which is every project today, because no browser-side producer
   * exists.
   *
   * DELIBERATELY NOT PERSISTED. `RelayAppData` is validated on load with an
   * exact `schemaVersion` match and ANYTHING that fails recovers to the empty
   * state, so adding a field there risks discarding a user's projects for the
   * sake of a metric. A bounded record is also hundreds of kilobytes per
   * project, and localStorage has a few megabytes in total — a quota failure
   * would take the whole app state with it.
   *
   * So this lives in memory for the session. The store reports its own
   * durability as `volatile-test-only`, and the panel shows that rather than
   * implying a record survives a reload.
   */
  getOperations(projectId: string): RelayOperationalRecord | null;
  /** Folds one observation in. Returns the record as it now stands, or null on failure. */
  recordObservation(projectId: string, observation: RunObservation): Promise<RelayOperationalRecord | null>;
  /** The store's own honest label, for a surface that wants to say what it is. */
  operationsDurability(): 'durable' | 'volatile-test-only';

  // mission service
  getMission(missionId: string): RelayMission | null;
  getMissionEvents(missionId: string): RelayEvent[];
  advanceMission(missionId: string): ServiceResult<RelayMission>;
  restartDemoMission(missionId: string): ServiceResult<RelayMission>;

  // live mission service — backed by the real Relay bridge. The backend is
  // the authority; these mirror its view into the store (id-keyed by
  // sequence), never inventing state. No-ops for the demo adapter.
  readonly adapterKind: 'demo' | 'live';
  ingestLiveUpdate(missionId: string, update: LiveMissionUpdate): ServiceResult<RelayMission>;
  beginLiveMission(missionId: string): Promise<ServiceResult<RelayMission>>;
  pollLiveMission(missionId: string): Promise<ServiceResult<RelayMission>>;
  cancelLiveMission(missionId: string): Promise<ServiceResult<RelayMission>>;
  retryLiveMission(missionId: string): Promise<ServiceResult<RelayMission>>;

  // appearance
  setColorway(colorway: RelayAppData['colorway']): void;
  /** Scenery. Stored beside the colorway, and reported by nothing else. */
  setStageBackdrop(backdrop: RelayAppData['stageBackdrop']): void;

  // demo reset — wipes browser-demo state only
  resetAll(): void;
}

export function createRelayAppStore(
  storage: RelayAppStorage = createRelayAppStorage(),
  adapter: RelayApplicationAdapter = createDemoRelayApplicationAdapter(),
): RelayAppStore {
  let data: RelayAppData = emptyRelayAppData();

  /**
   * IN MEMORY, for this session only — see `getOperations` on the interface for
   * why this is not persisted. The backing declares itself volatile and the
   * store carries that label out, so no surface can imply otherwise.
   */
  const operationBacking = new Map<string, string>();
  const operationStore = createOperationalStore({
    durability: 'volatile-test-only',
    locationLabel: 'browser session memory',
    async getText(key) { return operationBacking.get(key) ?? null; },
    async putText(key, value) { operationBacking.set(key, value); },
  });
  const operationSnapshots = new Map<string, RelayOperationalRecord>();
  let initialized = false;
  let creating = false; // duplicate-submit guard for createDraftFromRequest
  const startingLive = new Set<string>(); // one-dispatch guard for live starts
  const listeners = new Set<() => void>();

  const liveErrorMessage = (e: unknown): string =>
    e instanceof Error && e.message ? e.message : 'The Relay backend is unavailable.';

  const emit = () => {
    for (const l of listeners) l();
  };

  const commit = (next: RelayAppData) => {
    data = { ...next, updatedAt: new Date().toISOString() };
    storage.save(data);
    emit();
  };

  const nextProjectNumber = (): number => {
    // RLY / 001 is the labeled fixture project; created projects start at 002.
    let n = data.projects.length + 2;
    while (data.projects.some((p) => p.id === `rly-${String(n).padStart(3, '0')}`)) n += 1;
    return n;
  };

  const genEventId = (missionId: string, sequence: number) => `${missionId}-ev-${sequence}`;

  /** Mirror a backend-authoritative live update into the store. The backend
      owns the full ordered event list, so we replace (not append) — id-keyed
      by sequence — and never invent state the backend has not reported. */
  const applyLiveUpdate = (missionId: string, update: LiveMissionUpdate): ServiceResult<RelayMission> => {
    const mission = data.missions[missionId];
    if (!mission) return { ok: false, message: 'Relay could not load this mission.' };
    const events: RelayEvent[] = update.events.map((e) => ({
      ...e,
      id: genEventId(missionId, e.sequence),
      missionId,
      demo: false,
    }));
    const complete = update.state === 'verified_complete';
    const terminal = complete || update.state === 'failed' || update.state === 'cancelled';
    const now = new Date().toISOString();
    const updatedMission: RelayMission = {
      ...mission,
      state: update.state,
      currentRole: update.currentRole,
      currentStep: update.currentStep ?? mission.currentStep,
      updatedAt: now,
      completedAt: update.completedAt ?? (terminal ? mission.completedAt ?? now : mission.completedAt),
      handoff: update.handoff ?? mission.handoff,
      claim: update.claim ?? mission.claim,
      error: update.error,
      // Terminal state is backend-authoritative while it is being reported;
      // once reported it is retained (never downgraded to undefined) so a
      // completed mission keeps its terminal across polls and refreshes.
      terminal: update.terminal ?? mission.terminal,
      // The three-role record is mirrored the same way: reported values win,
      // already-reported values are retained. The browser never synthesizes an
      // attestation, a review, or a digest — absent stays absent.
      phase: update.phase ?? mission.phase,
      missionRevision: update.missionRevision ?? mission.missionRevision,
      handoffDigest: update.handoffDigest ?? mission.handoffDigest,
      artifactDigest: update.artifactDigest ?? mission.artifactDigest,
      architectReceipt: update.architectReceipt ?? mission.architectReceipt,
      review: update.review ?? mission.review,
      attestations:
        update.attestations && update.attestations.length ? update.attestations : mission.attestations,
    };
    const status: RelayProject['status'] = complete
      ? 'complete'
      : update.state === 'configured'
        ? 'configured'
        : 'active';
    commit({
      ...data,
      missions: { ...data.missions, [missionId]: updatedMission },
      events: { ...data.events, [missionId]: events },
      projects: data.projects.map((p) =>
        p.id === mission.projectId ? { ...p, status, updatedAt: now } : p,
      ),
    });
    return { ok: true, value: updatedMission };
  };

  return {
    getState: () => data,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    init() {
      if (initialized) return;
      initialized = true;
      data = storage.load();
      emit();
    },

    listProjects: () => data.projects,
    getProject: (projectId) => data.projects.find((p) => p.id === projectId) ?? null,

    setActiveProject(projectId) {
      if (data.activeProjectId === projectId) return;
      commit({ ...data, activeProjectId: projectId });
    },

    createDraftFromRequest(request) {
      const trimmed = request.trim();
      if (!trimmed) return { ok: false, message: 'Describe your project first.' };
      if (creating) return { ok: false, message: 'Relay is already preparing your project brief.' };
      // Idempotent: the same request never creates a second draft project.
      const existing = data.projects.find(
        (p) => p.status === 'draft' && p.originalRequest === trimmed,
      );
      if (existing) {
        return { ok: true, value: { project: existing, brief: data.briefs[existing.id] } };
      }
      creating = true;
      try {
        const now = new Date().toISOString();
        const n = nextProjectNumber();
        const id = `rly-${String(n).padStart(3, '0')}`;
        const draft = adapter.createProjectBrief(trimmed);
        const project: RelayProject = {
          id,
          reference: `RLY / ${String(n).padStart(3, '0')}`,
          name: draft.workingTitle,
          summary: draft.desiredResult || draft.problem,
          originalRequest: trimmed,
          status: 'draft',
          // A live adapter creates real (non-demo) missions; the demo adapter
          // creates demo missions. This flips RelayMissionPlayback off for live
          // and routes progression through polling instead of manual advance.
          demo: adapter.kind === 'demo',
          createdAt: now,
          updatedAt: now,
          activeMissionId: null,
        };
        const brief: StoredProjectBrief = {
          projectId: id,
          draft,
          approved: false,
          generatedAt: now,
          updatedAt: now,
        };
        commit({
          ...data,
          projects: [...data.projects, project],
          briefs: { ...data.briefs, [id]: brief },
          activeProjectId: id,
        });
        return { ok: true, value: { project, brief } };
      } finally {
        creating = false;
      }
    },

    getBrief: (projectId) => data.briefs[projectId] ?? null,

    updateBrief(projectId, patch) {
      const brief = data.briefs[projectId];
      if (!brief) return { ok: false, message: 'Relay could not load this project.' };
      const updated: StoredProjectBrief = {
        ...brief,
        draft: { ...brief.draft, ...patch },
        updatedAt: new Date().toISOString(),
      };
      const name = updated.draft.workingTitle;
      commit({
        ...data,
        briefs: { ...data.briefs, [projectId]: updated },
        projects: data.projects.map((p) => (p.id === projectId ? { ...p, name, updatedAt: updated.updatedAt } : p)),
      });
      return { ok: true, value: updated };
    },

    approveBrief(projectId) {
      const brief = data.briefs[projectId];
      if (!brief) return { ok: false, message: 'Relay could not load this project.' };
      const updated = { ...brief, approved: true, updatedAt: new Date().toISOString() };
      commit({ ...data, briefs: { ...data.briefs, [projectId]: updated } });
      return { ok: true, value: updated };
    },

    clearDraft(projectId) {
      const project = data.projects.find((p) => p.id === projectId);
      if (!project || project.status !== 'draft') return;
      const { [projectId]: _b, ...briefs } = data.briefs;
      const { [projectId]: _s, ...settings } = data.settings;
      commit({
        ...data,
        projects: data.projects.filter((p) => p.id !== projectId),
        briefs,
        settings,
        activeProjectId: data.activeProjectId === projectId ? null : data.activeProjectId,
      });
    },

    getSettings: (projectId) => data.settings[projectId] ?? null,

    saveSettings(projectId, draft) {
      if (!data.projects.some((p) => p.id === projectId)) {
        return { ok: false, message: 'Relay could not load this project.' };
      }
      const stored: StoredProjectSettings = {
        projectId,
        draft,
        confirmed: data.settings[projectId]?.confirmed ?? false,
        updatedAt: new Date().toISOString(),
      };
      commit({ ...data, settings: { ...data.settings, [projectId]: stored } });
      return { ok: true, value: stored };
    },

    startProject(projectId, draft) {
      const project = data.projects.find((p) => p.id === projectId);
      if (!project) return { ok: false, message: 'Relay could not load this project.' };
      // A project has exactly one active mission — starting twice is idempotent.
      if (project.activeMissionId) {
        const mission = data.missions[project.activeMissionId];
        if (mission) return { ok: true, value: { project, mission } };
      }
      const validation = validateSettingsDraft(draft, AGENT_OPTIONS);
      if (validation.blockers.length > 0) {
        return { ok: false, message: 'Finish selecting the required roles before continuing.' };
      }
      const now = new Date().toISOString();
      const brief = data.briefs[projectId];
      const missionId = `${projectId}-msn-1`;
      const mission: RelayMission = {
        id: missionId,
        projectId,
        title: 'First mission',
        objective: brief?.draft.desiredResult || project.summary || project.name,
        state: 'configured',
        currentRole: 'relay',
        currentStep: 0,
        demo: project.demo,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      };
      const settings: StoredProjectSettings = { projectId, draft, confirmed: true, updatedAt: now };
      const brain = adapter.prepareProjectBrain({ projectId, brief: brief?.draft ?? adapter.createProjectBrief(project.originalRequest), settings: draft });
      const updatedProject: RelayProject = {
        ...project,
        name: draft.projectName ?? project.name,
        status: 'configured',
        activeMissionId: missionId,
        updatedAt: now,
      };
      commit({
        ...data,
        projects: data.projects.map((p) => (p.id === projectId ? updatedProject : p)),
        settings: { ...data.settings, [projectId]: settings },
        brains: { ...data.brains, [projectId]: brain },
        missions: { ...data.missions, [missionId]: mission },
        events: { ...data.events, [missionId]: data.events[missionId] ?? [] },
        activeProjectId: projectId,
      });
      return { ok: true, value: { project: updatedProject, mission } };
    },

    getProjectBrain: (projectId) => data.brains[projectId] ?? null,

    getOperations: (projectId) => operationSnapshots.get(projectId) ?? null,
    operationsDurability: () => operationStore.status.durability,
    recordObservation: async (projectId, observation) => {
      const written = await operationStore.record(projectId, observation);
      if (!written.ok) return null;
      // The snapshot is what a synchronous projection can read; the store is
      // the thing that folds and bounds. Keeping both in step here is what
      // stops a surface rendering a record the store has already superseded.
      operationSnapshots.set(projectId, written.record);
      return written.record;
    },

    getMission: (missionId) => data.missions[missionId] ?? null,
    getMissionEvents: (missionId) => data.events[missionId] ?? [],

    advanceMission(missionId) {
      const mission = data.missions[missionId];
      if (!mission) return { ok: false, message: 'Relay could not load this mission.' };
      if (mission.state === 'verified_complete') {
        return { ok: false, message: 'This mission is already complete.' };
      }
      const step = adapter.advanceMission({ mission, existingEvents: data.events[missionId] ?? [] });
      if (!step) return { ok: false, message: 'This action is unavailable in the demonstration environment.' };
      const existing = data.events[missionId] ?? [];
      const appended: RelayEvent[] = step.events.map((e, i) => ({
        ...e,
        id: genEventId(missionId, existing.length + i),
        missionId,
        sequence: existing.length + i,
        demo: mission.demo,
      }));
      // Duplicate-insert prevention: sequences are contiguous by construction;
      // a stale double-dispatch of the same step would collide on id.
      if (appended.some((e) => existing.some((x) => x.id === e.id))) {
        return { ok: false, message: 'This step has already been recorded.' };
      }
      const now = new Date().toISOString();
      const complete = step.nextState === 'verified_complete';
      const updated: RelayMission = {
        ...mission,
        state: step.nextState,
        currentRole: step.role,
        currentStep: mission.currentStep + 1,
        updatedAt: now,
        completedAt: complete ? now : mission.completedAt,
      };
      commit({
        ...data,
        missions: { ...data.missions, [missionId]: updated },
        events: { ...data.events, [missionId]: [...existing, ...appended] },
        projects: data.projects.map((p) =>
          p.id === mission.projectId
            ? { ...p, status: complete ? 'complete' : 'active', updatedAt: now }
            : p,
        ),
      });
      return { ok: true, value: updated };
    },

    restartDemoMission(missionId) {
      const mission = data.missions[missionId];
      if (!mission) return { ok: false, message: 'Relay could not load this mission.' };
      if (!mission.demo) {
        return { ok: false, message: 'This action is unavailable outside the demonstration environment.' };
      }
      const now = new Date().toISOString();
      const reset: RelayMission = {
        ...mission,
        state: 'configured',
        currentRole: 'relay',
        currentStep: 0,
        updatedAt: now,
        completedAt: null,
      };
      commit({
        ...data,
        missions: { ...data.missions, [missionId]: reset },
        events: { ...data.events, [missionId]: [] },
        projects: data.projects.map((p) =>
          p.id === mission.projectId ? { ...p, status: 'configured', updatedAt: now } : p,
        ),
      });
      return { ok: true, value: reset };
    },

    adapterKind: adapter.kind,

    ingestLiveUpdate: applyLiveUpdate,

    async beginLiveMission(missionId) {
      const mission = data.missions[missionId];
      if (!mission) return { ok: false, message: 'Relay could not load this mission.' };
      if (mission.demo || adapter.kind !== 'live' || !adapter.startMission) {
        return { ok: false, message: 'Live missions are unavailable in this environment.' };
      }
      // One dispatch, ever: already-started (has events / past configured) or
      // an in-flight start never dispatches a second provider run.
      const alreadyStarted = mission.state !== 'configured' || (data.events[missionId]?.length ?? 0) > 0;
      if (alreadyStarted || startingLive.has(missionId)) return { ok: true, value: mission };
      const project = data.projects.find((p) => p.id === mission.projectId);
      const settings = data.settings[mission.projectId];
      if (!project || !settings) return { ok: false, message: 'Relay could not load this project.' };
      startingLive.add(missionId);
      try {
        const update = await adapter.startMission({ mission, project, settings });
        return applyLiveUpdate(missionId, update);
      } catch (e) {
        return { ok: false, message: liveErrorMessage(e) };
      } finally {
        startingLive.delete(missionId);
      }
    },

    async pollLiveMission(missionId) {
      const mission = data.missions[missionId];
      if (!mission || mission.demo || adapter.kind !== 'live' || !adapter.pollMission) {
        return { ok: false, message: 'Live missions are unavailable in this environment.' };
      }
      try {
        const update = await adapter.pollMission({ mission });
        return applyLiveUpdate(missionId, update);
      } catch (e) {
        return { ok: false, message: liveErrorMessage(e) };
      }
    },

    async cancelLiveMission(missionId) {
      const mission = data.missions[missionId];
      if (!mission || mission.demo || adapter.kind !== 'live' || !adapter.cancelMission) {
        return { ok: false, message: 'Live missions are unavailable in this environment.' };
      }
      try {
        const update = await adapter.cancelMission({ mission });
        return applyLiveUpdate(missionId, update);
      } catch (e) {
        return { ok: false, message: liveErrorMessage(e) };
      }
    },

    async retryLiveMission(missionId) {
      const mission = data.missions[missionId];
      if (!mission || mission.demo || adapter.kind !== 'live' || !adapter.retryMission) {
        return { ok: false, message: 'Live missions are unavailable in this environment.' };
      }
      try {
        const update = await adapter.retryMission({ mission });
        return applyLiveUpdate(missionId, update);
      } catch (e) {
        return { ok: false, message: liveErrorMessage(e) };
      }
    },

    setColorway(colorway) {
      if (data.colorway === colorway) return;
      commit({ ...data, colorway });
    },

    setStageBackdrop(stageBackdrop) {
      if (data.stageBackdrop === stageBackdrop) return;
      commit({ ...data, stageBackdrop });
    },

    resetAll() {
      storage.clear();
      data = emptyRelayAppData();
      emit();
    },
  };
}

/* ------------------------------------------------------- app singleton */

let appStore: RelayAppStore | null = null;

/** Selects the demo or live adapter from a NON-SECRET build flag. Live mode
    (`VITE_RELAY_LIVE=1`) talks to the Relay bridge over HTTP — by default at
    the same-origin `/relay-api` (the Vite dev proxy / a prod reverse proxy),
    or an explicit `VITE_RELAY_BRIDGE_URL`. No provider key is ever read here. */
function selectAdapter(): RelayApplicationAdapter {
  const env = (typeof import.meta !== 'undefined' ? import.meta.env : undefined) as
    | { VITE_RELAY_LIVE?: string; VITE_RELAY_BRIDGE_URL?: string }
    | undefined;
  if (env?.VITE_RELAY_LIVE === '1') {
    return createLiveRelayApplicationAdapter({ bridgeBaseUrl: env.VITE_RELAY_BRIDGE_URL || undefined });
  }
  return createDemoRelayApplicationAdapter();
}

/** The application's store instance (browser singleton; tests create their
    own isolated instances with injected storage/adapter). */
export function getRelayAppStore(): RelayAppStore {
  if (!appStore) appStore = createRelayAppStore(createRelayAppStorage(), selectAdapter());
  return appStore;
}

/** Default settings draft for a project's settings screen, prefilled from
    its stored brief (kept here so screens share one prefill rule). */
export function defaultSettingsForProject(
  store: RelayAppStore,
  projectId: string,
): ProjectSettingsDraft {
  const brief = store.getBrief(projectId);
  return createDefaultSettingsDraft(brief?.draft ?? null);
}
