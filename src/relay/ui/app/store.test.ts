import { describe, expect, it, beforeEach } from 'vitest';
import { createRelayAppStore } from './store';
import { createRelayAppStorage, RELAY_APP_STORAGE_KEY } from './persistence';
import { createDemoRelayApplicationAdapter, DEMO_MISSION_SCRIPT } from './demo-adapter';
import { deriveMissionProjection } from './projection';
import { createDefaultSettingsDraft } from '../project-settings/defaults';
import { buildProjectBriefDraft } from '../entry-home/project-brief';
import type { RelayAppStore } from './store';

/**
 * Application store — the product's single source of truth. These tests lock
 * the founder-demo flow, persistence/recovery, the mission state machine,
 * and the demo-truthfulness + safety guarantees.
 */

/** In-memory Storage double (no jsdom needed). */
function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => (m.has(k) ? (m.get(k) as string) : null),
    key: (i) => Array.from(m.keys())[i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

function freshStore(backing = memStorage()): { store: RelayAppStore; backing: Storage } {
  const store = createRelayAppStore(createRelayAppStorage(backing));
  store.init();
  return { store, backing };
}

// A valid, startable settings draft — derived from a brief so a project
// source is set (matching the real flow's brief-prefilled defaults).
const DRAFT = createDefaultSettingsDraft(buildProjectBriefDraft('Build a dashboard', null));

describe('project flow', () => {
  let store: RelayAppStore;
  beforeEach(() => {
    store = freshStore().store;
  });

  it('Ask Relay creates exactly one project and preserves the original request', () => {
    const request = 'Build a usage dashboard for AI developers';
    const r1 = store.createDraftFromRequest(request);
    expect(r1.ok).toBe(true);
    expect(store.listProjects()).toHaveLength(1);
    const project = store.listProjects()[0];
    expect(project.originalRequest).toBe(request);
    expect(project.status).toBe('draft');
    // A duplicate submit of the same request does not create a second project.
    const r2 = store.createDraftFromRequest(request);
    expect(r2.ok).toBe(true);
    expect(store.listProjects()).toHaveLength(1);
  });

  it('empty Ask Relay input is rejected with a simple message', () => {
    const r = store.createDraftFromRequest('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/Describe your project/i);
    expect(store.listProjects()).toHaveLength(0);
  });

  it('different requests produce different briefs', () => {
    store.createDraftFromRequest('Build a mobile fitness app');
    store.createDraftFromRequest('Design an API for billing events');
    const [a, b] = store.listProjects();
    expect(store.getBrief(a.id)!.draft.workingTitle).not.toBe(store.getBrief(b.id)!.draft.workingTitle);
  });

  it('a brief can be edited and approved; the project name follows the title', () => {
    const { value } = store.createDraftFromRequest('Build a dashboard') as { value: { project: { id: string } } };
    const id = value.project.id;
    store.updateBrief(id, { workingTitle: 'Renamed Project' });
    expect(store.getProject(id)!.name).toBe('Renamed Project');
    store.approveBrief(id);
    expect(store.getBrief(id)!.approved).toBe(true);
  });

  it('required agents are enforced before a mission can start', () => {
    const { value } = store.createDraftFromRequest('Build a dashboard') as { value: { project: { id: string } } };
    const id = value.project.id;
    const missingAgents = { ...DRAFT, workforce: { ...DRAFT.workforce, codingAgentId: null } };
    const blocked = store.startProject(id, missingAgents);
    expect(blocked.ok).toBe(false);
    expect(store.getProject(id)!.activeMissionId).toBeNull();
    // A complete draft (defaults recommend the real workforce) starts.
    const started = store.startProject(id, DRAFT);
    expect(started.ok).toBe(true);
    expect(store.getProject(id)!.status).toBe('configured');
    expect(store.getProject(id)!.activeMissionId).toBeTruthy();
  });

  it('starting a configured project twice is idempotent (no duplicate mission)', () => {
    const { value } = store.createDraftFromRequest('Build a dashboard') as { value: { project: { id: string } } };
    const id = value.project.id;
    const a = store.startProject(id, DRAFT);
    const b = store.startProject(id, DRAFT);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.mission.id).toBe(b.value.mission.id);
    expect(Object.keys(store.getState().missions)).toHaveLength(1);
  });
});

describe('persistence and recovery', () => {
  it('domain state restores across a reload (new store, same backing)', () => {
    const backing = memStorage();
    const { store } = freshStore(backing);
    const { value } = store.createDraftFromRequest('Persist me') as { value: { project: { id: string } } };
    store.startProject(value.project.id, DRAFT);
    store.setColorway('manual');

    // Simulate refresh: brand-new store over the same storage.
    const reloaded = createRelayAppStore(createRelayAppStorage(backing));
    reloaded.init();
    expect(reloaded.listProjects()).toHaveLength(1);
    expect(reloaded.getProject(value.project.id)!.status).toBe('configured');
    expect(reloaded.getState().colorway).toBe('manual');
    expect(reloaded.getState().activeProjectId).toBe(value.project.id);
  });

  it('initialization is idempotent — init twice does not duplicate', () => {
    const backing = memStorage();
    const { store } = freshStore(backing);
    store.createDraftFromRequest('Once');
    store.init();
    store.init();
    expect(store.listProjects()).toHaveLength(1);
  });

  it('malformed stored data recovers to a clean empty state', () => {
    const backing = memStorage();
    backing.setItem(RELAY_APP_STORAGE_KEY, '{ this is not valid json ');
    const store = createRelayAppStore(createRelayAppStorage(backing));
    store.init();
    expect(store.listProjects()).toEqual([]);
    // The corrupt payload was dropped so the next save heals it.
    store.createDraftFromRequest('Fresh start');
    expect(store.listProjects()).toHaveLength(1);
  });

  it('wrong-shape (foreign) data recovers to empty without throwing', () => {
    const backing = memStorage();
    backing.setItem(RELAY_APP_STORAGE_KEY, JSON.stringify({ hello: 'world' }));
    const store = createRelayAppStore(createRelayAppStorage(backing));
    expect(() => store.init()).not.toThrow();
    expect(store.listProjects()).toEqual([]);
  });

  it('the chosen backdrop survives a reload', () => {
    const backing = memStorage();
    const { store } = freshStore(backing);
    expect(store.getState().stageBackdrop).toBeNull();
    store.setStageBackdrop('space_station');

    const reloaded = createRelayAppStore(createRelayAppStorage(backing));
    reloaded.init();
    expect(reloaded.getState().stageBackdrop).toBe('space_station');
  });

  it('a store written before backdrops existed keeps its projects and shows no scene', () => {
    const backing = memStorage();
    const { store } = freshStore(backing);
    store.createDraftFromRequest('Older build');

    // Exactly what a pre-backdrop build wrote: the same schema version, and no
    // `stageBackdrop` key at all. Requiring the field would discard this user's
    // real project to recover a piece of scenery.
    const stored = JSON.parse(backing.getItem(RELAY_APP_STORAGE_KEY)!) as Record<string, unknown>;
    delete stored.stageBackdrop;
    backing.setItem(RELAY_APP_STORAGE_KEY, JSON.stringify(stored));

    const reloaded = createRelayAppStore(createRelayAppStorage(backing));
    reloaded.init();
    expect(reloaded.listProjects()).toHaveLength(1);
    // None is what those builds showed, so it is what they keep showing.
    expect(reloaded.getState().stageBackdrop).toBeNull();
  });

  it('a backdrop this build does not have becomes None, never another scene', () => {
    const backing = memStorage();
    const { store } = freshStore(backing);
    store.createDraftFromRequest('Newer build wrote this');

    for (const foreign of ['volcano', '', 42, null, { id: 'jungle' }]) {
      const stored = JSON.parse(backing.getItem(RELAY_APP_STORAGE_KEY)!) as Record<string, unknown>;
      stored.stageBackdrop = foreign;
      backing.setItem(RELAY_APP_STORAGE_KEY, JSON.stringify(stored));

      const reloaded = createRelayAppStore(createRelayAppStorage(backing));
      reloaded.init();
      // Substituting a real scene would be the surface deciding something the
      // user did not — and the project must survive either way.
      expect(reloaded.getState().stageBackdrop, JSON.stringify(foreign)).toBeNull();
      expect(reloaded.listProjects()).toHaveLength(1);
    }
  });

  it('scenery is not a mission fact: choosing one commits nothing else', () => {
    const backing = memStorage();
    const { store } = freshStore(backing);
    const { value } = store.createDraftFromRequest('Unaffected') as { value: { project: { id: string } } };
    store.startProject(value.project.id, DRAFT);
    const before = store.getState();

    store.setStageBackdrop('jungle');
    const after = store.getState();
    expect(after.stageBackdrop).toBe('jungle');
    expect(after.projects).toEqual(before.projects);
    expect(after.missions).toEqual(before.missions);
    expect(after.events).toEqual(before.events);
    expect(after.colorway).toBe(before.colorway);
  });
});

describe('mission state machine', () => {
  function startedMission() {
    const { store } = freshStore();
    const { value } = store.createDraftFromRequest('Mission project') as { value: { project: { id: string } } };
    const started = store.startProject(value.project.id, DRAFT);
    if (!started.ok) throw new Error('setup failed');
    return { store, projectId: value.project.id, missionId: started.value.mission.id };
  }

  it('advances through the full script to VERIFIED COMPLETE and no further', () => {
    const { store, missionId } = startedMission();
    for (let i = 0; i < DEMO_MISSION_SCRIPT.length; i++) {
      const r = store.advanceMission(missionId);
      expect(r.ok, `step ${i}`).toBe(true);
    }
    expect(store.getMission(missionId)!.state).toBe('verified_complete');
    // Already complete — a further advance is refused with a clear message.
    const extra = store.advanceMission(missionId);
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.message).toMatch(/already complete/i);
  });

  it('a coding claim is a claim, verified evidence appears only after Relay verification', () => {
    const { store, missionId } = startedMission();
    // Advance to claim_submitted (script step index 4 → state after 5 advances).
    for (let i = 0; i < 5; i++) store.advanceMission(missionId);
    expect(store.getMission(missionId)!.state).toBe('claim_submitted');
    const events = store.getMissionEvents(missionId);
    const claim = events.find((e) => e.headline.includes('work submitted'));
    expect(claim?.truth).toBe('agent_claim');
    // No relay_evidence exists yet.
    expect(events.some((e) => e.truth === 'relay_evidence')).toBe(false);
    // Relay verification step produces evidence.
    store.advanceMission(missionId);
    expect(store.getMissionEvents(missionId).some((e) => e.truth === 'relay_evidence')).toBe(true);
  });

  it('a reviewer finding appears only at repair_required and repair follows it', () => {
    const { store, missionId } = startedMission();
    for (let i = 0; i < 8; i++) store.advanceMission(missionId); // → repair_required
    expect(store.getMission(missionId)!.state).toBe('repair_required');
    expect(store.getMissionEvents(missionId).some((e) => e.findingId === 'F-1')).toBe(true);
    store.advanceMission(missionId); // → repair_in_progress
    expect(store.getMissionEvents(missionId).some((e) => e.repairId === 'R-1')).toBe(true);
  });

  it('a route remount / double dispatch does not duplicate events', () => {
    const { store, missionId } = startedMission();
    store.advanceMission(missionId);
    const afterOne = store.getMissionEvents(missionId).length;
    // Advancing again is the NEXT step (not a duplicate of the same one).
    store.advanceMission(missionId);
    const afterTwo = store.getMissionEvents(missionId).length;
    expect(afterTwo).toBeGreaterThan(afterOne);
    // Event ids are unique across the whole mission.
    const ids = store.getMissionEvents(missionId).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('restart is demo-only and clears events', () => {
    const { store, missionId } = startedMission();
    store.advanceMission(missionId);
    store.advanceMission(missionId);
    expect(store.getMissionEvents(missionId).length).toBeGreaterThan(0);
    const r = store.restartDemoMission(missionId);
    expect(r.ok).toBe(true);
    expect(store.getMission(missionId)!.state).toBe('configured');
    expect(store.getMissionEvents(missionId)).toEqual([]);
  });
});

describe('demo truthfulness and safety', () => {
  it('the demo adapter is explicitly demo and never fabricates a live provider', () => {
    const adapter = createDemoRelayApplicationAdapter();
    expect(adapter.kind).toBe('demo');
  });

  it('demo events can never enter a non-demo mission', () => {
    const adapter = createDemoRelayApplicationAdapter();
    const nonDemo = adapter.advanceMission({
      mission: {
        id: 'm', projectId: 'p', title: '', objective: '', state: 'configured',
        currentRole: 'relay', currentStep: 0, demo: false,
        createdAt: '', updatedAt: '', completedAt: null,
      },
      existingEvents: [],
    });
    expect(nonDemo).toBeNull();
  });

  it('VERIFIED COMPLETE only appears at the final projected state', () => {
    const { store } = freshStore();
    const { value } = store.createDraftFromRequest('Complete me') as { value: { project: { id: string } } };
    const id = value.project.id;
    const started = store.startProject(id, DRAFT);
    if (!started.ok) throw new Error('setup');
    const mid = started.value.mission.id;
    const project = () => store.getProject(id)!;
    const project0 = deriveMissionProjection({
      project: project(), settings: store.getSettings(id)!, brain: store.getProjectBrain(id),
      mission: store.getMission(mid)!, events: store.getMissionEvents(mid),
    });
    expect(project0.completionState.verdict).toBe('not_complete');
    for (let i = 0; i < DEMO_MISSION_SCRIPT.length; i++) store.advanceMission(mid);
    const projectionFinal = deriveMissionProjection({
      project: project(), settings: store.getSettings(id)!, brain: store.getProjectBrain(id),
      mission: store.getMission(mid)!, events: store.getMissionEvents(mid),
    });
    expect(projectionFinal.completionState.verdict).toBe('verified_complete');
  });

  it('no persisted value ever contains a credential-like key', () => {
    const backing = memStorage();
    const { store } = freshStore(backing);
    const { value } = store.createDraftFromRequest('Secrets check') as { value: { project: { id: string } } };
    store.startProject(value.project.id, DRAFT);
    for (let i = 0; i < 4; i++) store.advanceMission(store.getProject(value.project.id)!.activeMissionId!);
    const raw = backing.getItem(RELAY_APP_STORAGE_KEY) ?? '';
    // Scoped to actual credential material — a JSON key named like a credential
    // or an `sk-`/bearer token. A bare substring match would false-flag safe
    // vocabulary such as the "secrets" protected-area label, the "secret_scan"
    // inspection, or a project request that simply mentions secrets.
    expect(raw).not.toMatch(
      /"(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|bearer)"\s*:|sk-[a-z0-9]{16,}/i,
    );
  });

  it('resetAll clears all persisted state', () => {
    const backing = memStorage();
    const { store } = freshStore(backing);
    store.createDraftFromRequest('Wipe me');
    store.resetAll();
    expect(store.listProjects()).toEqual([]);
    expect(backing.getItem(RELAY_APP_STORAGE_KEY)).toBeNull();
  });
});
