import { describe, it, expect } from 'vitest';
import { createRelayAppStore } from './store';
import { createLiveRelayApplicationAdapter } from './live-adapter';
import { deriveMissionProjection } from './projection';
import { createDefaultSettingsDraft } from '../project-settings/defaults';
import { emptyRelayAppData } from './contracts';
import type { LiveMissionUpdate, MissionRole, RelayAppData } from './contracts';
import type { RelayAppStorage } from './persistence';
import type { EventTruthClass, TerminalEventCategory } from '../project-workspace/contracts';

/**
 * Live two-connector mission invariants, exercised through the REAL store +
 * live adapter + projection with a MOCKED bridge (no provider is ever called).
 * These lock the honesty contract: one dispatch, refresh-safe, architect →
 * coding handoff, claim vs evidence, honest failure with no demo fallback, and
 * no fabricated findings/verification/completion on a live mission.
 */

function memStorage(): RelayAppStorage {
  let data = emptyRelayAppData();
  return {
    load: () => data,
    save: (d: RelayAppData) => {
      data = d;
    },
    clear: () => {
      data = emptyRelayAppData();
    },
  };
}

const AT = '2026-07-23T00:00:00.000Z';
const ev = (
  sequence: number,
  role: MissionRole,
  category: TerminalEventCategory,
  truth: EventTruthClass,
  headline: string,
  extra: Record<string, unknown> = {},
) => ({ sequence, at: AT, role, category, truth, headline, ...extra });

const HANDOFF = {
  objective: 'Implement normalizeProjectName so its test passes.',
  instructions: ['Trim surrounding whitespace', 'Lowercase the name'],
  constraints: ['Edit only src/normalize.js'],
  acceptanceCriteria: ['The test suite passes', 'Only the claimed file changed'],
  architectLabel: 'Sunday Alcatraz · live (claude)',
  architectProvenance: 'live' as const,
};
const CLAIM = { summary: 'Implemented the normalizer.', filesChanged: ['src/normalize.js'], checksRun: ['Reported completing the task'] };

const E0 = ev(0, 'relay', 'relay', 'system_notice', 'Mission Contract locked.');
const E1 = ev(1, 'prompt_architect', 'prompt_architect', 'system_notice', 'Sunday Alcatraz preparing the implementation brief.');
const E2 = ev(2, 'prompt_architect', 'prompt_architect', 'system_notice', 'Handoff brief ready.', { done: true });
const E3 = ev(3, 'coding_agent', 'coding_agent', 'system_notice', 'Claude Code session started.');
const E4 = ev(4, 'coding_agent', 'coding_agent', 'agent_claim', 'Work submitted — pending Relay verification.', { done: true });
const E5 = ev(5, 'relay', 'workspace_inspection', 'relay_evidence', 'Claimed files match changed files. No protected files touched.');
const E6 = ev(6, 'relay', 'verification', 'relay_evidence', 'Required tests passed under Relay verification.');
const E7 = ev(7, 'relay', 'completion_engine', 'relay_evidence', 'Completion policy satisfied — MISSION VERIFIED.', { done: true });

const START: LiveMissionUpdate = { state: 'architect_working', currentRole: 'prompt_architect', completedAt: null, events: [E0, E1] };
const CODING: LiveMissionUpdate = { state: 'coding', currentRole: 'coding_agent', completedAt: null, handoff: HANDOFF, events: [E0, E1, E2, E3] };
const CLAIMED: LiveMissionUpdate = { state: 'claim_submitted', currentRole: 'coding_agent', completedAt: null, handoff: HANDOFF, claim: CLAIM, events: [E0, E1, E2, E3, E4] };
const DONE: LiveMissionUpdate = {
  state: 'verified_complete',
  currentRole: 'relay',
  completedAt: '2026-07-23T00:01:00.000Z',
  handoff: HANDOFF,
  claim: CLAIM,
  events: [E0, E1, E2, E3, E4, E5, E6, E7],
};
const FAILED: LiveMissionUpdate = {
  state: 'failed',
  currentRole: 'relay',
  completedAt: '2026-07-23T00:01:00.000Z',
  handoff: HANDOFF,
  error: { code: 'coding_stopped', safeMessage: 'The coding agent stopped before completing.', retryable: true },
  events: [E0, E1, E2, E3, ev(4, 'relay', 'relay', 'system_notice', 'Mission stopped safely — no completion is claimed.', { done: true })],
};
const CANCELLED: LiveMissionUpdate = {
  state: 'cancelled',
  currentRole: 'relay',
  completedAt: '2026-07-23T00:01:00.000Z',
  events: [E0, E1, ev(2, 'relay', 'relay', 'system_notice', 'Mission cancelled by the operator.', { done: true })],
};

function scriptedBridge(script: {
  start: LiveMissionUpdate;
  polls: LiveMissionUpdate[];
  cancel?: LiveMissionUpdate;
  retry?: LiveMissionUpdate;
}) {
  let pollIdx = 0;
  const calls = { start: 0, poll: 0, cancel: 0, retry: 0 };
  const fetchImpl = (async (url: RequestInfo | URL) => {
    const u = String(url);
    let view: LiveMissionUpdate;
    if (u.endsWith('/mission/start')) {
      calls.start += 1;
      view = script.start;
    } else if (u.endsWith('/cancel')) {
      calls.cancel += 1;
      view = script.cancel ?? script.polls[script.polls.length - 1];
    } else if (u.endsWith('/retry')) {
      calls.retry += 1;
      view = script.retry ?? script.start;
    } else {
      calls.poll += 1;
      view = script.polls[Math.min(pollIdx++, script.polls.length - 1)];
    }
    return { ok: true, status: 200, json: async () => ({ view }) } as unknown as Response;
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function liveStore(bridge: { fetchImpl: typeof fetch }) {
  const adapter = createLiveRelayApplicationAdapter({ bridgeBaseUrl: '/relay-api', fetchImpl: bridge.fetchImpl });
  const storage = memStorage();
  const store = createRelayAppStore(storage, adapter);
  store.init();
  return { store, storage };
}

function startedProject(store: ReturnType<typeof liveStore>['store']) {
  const r = store.createDraftFromRequest('Implement normalizeProjectName so its test passes.');
  if (!r.ok) throw new Error('draft');
  const id = r.value.project.id;
  store.approveBrief(id);
  const draft = createDefaultSettingsDraft(store.getBrief(id)!.draft);
  const sp = store.startProject(id, draft);
  if (!sp.ok) throw new Error('start');
  return { projectId: id, missionId: sp.value.mission.id };
}

describe('live mission — identity + single dispatch', () => {
  it('a live adapter creates non-demo projects and missions', () => {
    const { store } = liveStore(scriptedBridge({ start: START, polls: [DONE] }));
    expect(store.adapterKind).toBe('live');
    const { projectId, missionId } = startedProject(store);
    expect(store.getProject(projectId)!.demo).toBe(false);
    const mission = store.getMission(missionId)!;
    expect(mission.demo).toBe(false);
    expect(mission.state).toBe('configured');
  });

  it('beginLiveMission dispatches exactly once; a duplicate call and a refresh never re-dispatch', async () => {
    const bridge = scriptedBridge({ start: START, polls: [CODING, DONE] });
    const { store, storage } = liveStore(bridge);
    const { missionId } = startedProject(store);

    await store.beginLiveMission(missionId);
    expect(bridge.calls.start).toBe(1);
    expect(store.getMission(missionId)!.state).toBe('architect_working');

    // Duplicate click: no second dispatch.
    await store.beginLiveMission(missionId);
    expect(bridge.calls.start).toBe(1);

    // Refresh: a fresh store over the SAME storage must not re-dispatch a
    // mission that has already started.
    const store2 = createRelayAppStore(storage, createLiveRelayApplicationAdapter({ fetchImpl: bridge.fetchImpl }));
    store2.init();
    await store2.beginLiveMission(missionId);
    expect(bridge.calls.start).toBe(1);
  });
});

describe('live mission — architect → coding → verified, honest truth classes', () => {
  it('the architect result becomes the coding-agent handoff and the coding result becomes a claim', async () => {
    const bridge = scriptedBridge({ start: START, polls: [CODING, CLAIMED, DONE] });
    const { store } = liveStore(bridge);
    const { missionId } = startedProject(store);
    await store.beginLiveMission(missionId);

    await store.pollLiveMission(missionId); // → CODING
    const mCoding = store.getMission(missionId)!;
    expect(mCoding.handoff?.objective).toContain('normalizeProjectName');
    expect(mCoding.handoff?.instructions.length).toBeGreaterThan(0);
    expect(mCoding.handoff?.architectProvenance).toBe('live');

    await store.pollLiveMission(missionId); // → CLAIMED
    const mClaim = store.getMission(missionId)!;
    expect(mClaim.claim?.filesChanged).toContain('src/normalize.js');
    // The claim event is an agent_claim, verification events are relay_evidence.
    const events = store.getMissionEvents(missionId);
    expect(events.find((e) => e.headline.startsWith('Work submitted'))!.truth).toBe('agent_claim');

    await store.pollLiveMission(missionId); // → DONE
    const evDone = store.getMissionEvents(missionId);
    expect(evDone.find((e) => e.category === 'verification')!.truth).toBe('relay_evidence');
    // Events are contiguous and id-keyed by sequence.
    evDone.forEach((e, i) => {
      expect(e.sequence).toBe(i);
      expect(e.id).toBe(`${missionId}-ev-${i}`);
      expect(e.demo).toBe(false);
    });
  });

  it('projection for a live mission never fabricates findings/verification/completion', () => {
    const bridge = scriptedBridge({ start: START, polls: [DONE] });
    const { store } = liveStore(bridge);
    const { projectId, missionId } = startedProject(store);
    store.ingestLiveUpdate(missionId, DONE);

    const project = store.getProject(projectId)!;
    const settings = store.getSettings(projectId)!;
    const brain = store.getProjectBrain(projectId);
    const mission = store.getMission(missionId)!;
    const events = store.getMissionEvents(missionId);
    const p = deriveMissionProjection({ project, settings, brain, mission, events });

    // No demo F-1/R-1 sample content on a live mission.
    expect(p.findings).toHaveLength(0);
    expect(p.repairs).toHaveLength(0);
    // Completion is honest — verified, but never claims an independent review.
    expect(p.completionState.verdict).toBe('verified_complete');
    const evidenceText = p.completionState.evidence.join(' ');
    expect(evidenceText).not.toMatch(/reviewer/i);
    expect(evidenceText).toMatch(/no independent review/i);
    expect(p.outputState).toBe('verified_complete');
  });
});

describe('live mission — honest failure, cancel, retry', () => {
  it('a live failure is shown honestly with no demo fallback and no fabricated completion', () => {
    const { store } = liveStore(scriptedBridge({ start: START, polls: [FAILED] }));
    const { projectId, missionId } = startedProject(store);
    store.ingestLiveUpdate(missionId, FAILED);

    const mission = store.getMission(missionId)!;
    expect(mission.state).toBe('failed');
    expect(mission.error?.retryable).toBe(true);
    expect(mission.error?.safeMessage).toBeTruthy();

    const p = deriveMissionProjection({
      project: store.getProject(projectId)!,
      settings: store.getSettings(projectId)!,
      brain: store.getProjectBrain(projectId),
      mission,
      events: store.getMissionEvents(missionId),
    });
    expect(p.completionState.verdict).toBe('not_complete');
    expect(p.outputState).toBe('stopped_safely');
  });

  it('cancel transitions to cancelled; retry re-dispatches through the backend', async () => {
    const bridge = scriptedBridge({ start: START, polls: [CODING], cancel: CANCELLED, retry: START });
    const { store } = liveStore(bridge);
    const { missionId } = startedProject(store);
    await store.beginLiveMission(missionId);

    await store.cancelLiveMission(missionId);
    expect(bridge.calls.cancel).toBe(1);
    expect(store.getMission(missionId)!.state).toBe('cancelled');
  });

  it('retry calls the backend retry endpoint and mirrors its view', async () => {
    const bridge = scriptedBridge({ start: START, polls: [FAILED], retry: START });
    const { store } = liveStore(bridge);
    const { missionId } = startedProject(store);
    store.ingestLiveUpdate(missionId, FAILED);
    await store.retryLiveMission(missionId);
    expect(bridge.calls.retry).toBe(1);
    expect(store.getMission(missionId)!.state).toBe('architect_working');
  });
});

describe('live mission — no secrets persist or render', () => {
  it('nothing credential-shaped is stored after a full mission', () => {
    const { store, storage } = liveStore(scriptedBridge({ start: START, polls: [DONE] }));
    const { missionId } = startedProject(store);
    store.ingestLiveUpdate(missionId, DONE);
    const serialized = JSON.stringify(storage.load());
    expect(serialized).not.toMatch(
      /"(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|password|bearer)"\s*:|sk-[a-z0-9]{16,}/i,
    );
  });
});
