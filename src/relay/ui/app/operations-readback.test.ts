import { describe, expect, it } from 'vitest';

import { deriveMissionProjection } from './projection';
import { createRelayAppStore } from './store';
import { emptyOperationalRecord } from '../../shared/llmops';
import { emptyRelayAppData } from './contracts';
import { createDefaultSettingsDraft } from '../project-settings/defaults';
import type { RunObservation } from '../../shared/llmops';

/**
 * THE READ BACK.
 *
 * The producer writes and the store accumulates; this is the half that lets a
 * person see it. What is tested is not that a number arrives — it is the two
 * conditions under which the panel must NOT show one, because getting those
 * wrong is how a surface starts describing a system nobody is measuring.
 */

/** Storage that survives nothing — the store must not need more than this. */
function memoryStorage() {
  let saved: unknown = null;
  return {
    load: () => (saved ?? emptyRelayAppData()) as never,
    save: (value: unknown) => { saved = value; },
    clear: () => { saved = null; },
  };
}

const AT = (s: number) => new Date(Date.parse('2026-08-05T12:00:00.000Z') + s * 1000).toISOString();

const observation = (over: Partial<RunObservation> = {}): RunObservation => ({
  latency: [{ phase: 'total', durationMs: 1200, observedAt: AT(0) }],
  errors: [],
  observedAt: AT(0),
  attemptsObserved: 1,
  ...over,
});

describe('the app store holds a record without persisting it', () => {
  it('reports its own durability as volatile, and does not claim otherwise', () => {
    const store = createRelayAppStore(memoryStorage());
    // A browser session store survives nothing. Saying so is the point: the
    // record is deliberately NOT in `RelayAppData`, whose loader recovers to
    // the empty state on any schema mismatch — adding a metrics field there
    // would risk discarding a user's projects.
    expect(store.operationsDurability()).toBe('volatile-test-only');
  });

  it('has no record until something records one', async () => {
    const store = createRelayAppStore(memoryStorage());
    expect(store.getOperations('prj_1')).toBeNull();
    const written = await store.recordObservation('prj_1', observation());
    expect(written).not.toBeNull();
    expect(store.getOperations('prj_1')?.latency.length).toBe(1);
  });

  it('accumulates across observations and keeps projects apart', async () => {
    const store = createRelayAppStore(memoryStorage());
    await store.recordObservation('a', observation());
    await store.recordObservation('a', observation({ observedAt: AT(1) }));
    await store.recordObservation('b', observation());
    expect(store.getOperations('a')?.latency.length).toBe(2);
    expect(store.getOperations('b')?.latency.length).toBe(1);
  });
});

describe('the panel is shown a record only when there is one AND a clock', () => {
  /** A real started project, built the way the app builds one. */
  const started = () => {
    const store = createRelayAppStore(memoryStorage());
    store.init();
    const draft = store.createDraftFromRequest('Implement normalizeProjectName so its test passes.');
    if (!draft.ok) throw new Error('draft');
    const projectId = draft.value.project.id;
    store.approveBrief(projectId);
    const settingsDraft = createDefaultSettingsDraft(store.getBrief(projectId)!.draft);
    const started = store.startProject(projectId, settingsDraft);
    if (!started.ok) throw new Error('start');
    return { store, projectId, missionId: started.value.mission.id };
  };

  const projectionInput = (store: ReturnType<typeof createRelayAppStore>,
    projectId: string, missionId: string) => ({
    project: store.getProject(projectId)!,
    settings: store.getSettings(projectId)!,
    brain: store.getProjectBrain(projectId),
    mission: store.getMission(missionId)!,
    events: store.getMissionEvents(missionId),
  });

  it('no record and no clock: the panel is told nothing is wired', () => {
    const { store, projectId, missionId } = started();
    const view = deriveMissionProjection(projectionInput(store, projectId, missionId));
    expect((view as { operationsView?: unknown }).operationsView).toBeUndefined();
  });

  it('a record with NO CLOCK is still not shown', () => {
    // `asOf` is what staleness and health are measured FROM. Inventing one
    // would answer "is this system alive?" with a number the projection made
    // up, so the honest response is to show nothing.
    const { store, projectId, missionId } = started();
    const view = deriveMissionProjection({
      ...projectionInput(store, projectId, missionId),
      operations: emptyOperationalRecord(projectId),
    });
    expect((view as { operationsView?: unknown }).operationsView).toBeUndefined();
  });

  it('a clock with NO RECORD is still not shown', () => {
    const { store, projectId, missionId } = started();
    const view = deriveMissionProjection({
      ...projectionInput(store, projectId, missionId), now: AT(5),
    });
    expect((view as { operationsView?: unknown }).operationsView).toBeUndefined();
  });

  it('both present: the panel is handed the real view', async () => {
    const { store, projectId, missionId } = started();
    await store.recordObservation(projectId, observation());
    await store.recordObservation(projectId, observation({
      observedAt: AT(1),
      errors: [{ kind: 'provider_timeout', at: AT(1), recovered: false, attempt: 1 }],
    }));

    const record = store.getOperations(projectId);
    expect(record).not.toBeNull();
    const view = deriveMissionProjection({
      ...projectionInput(store, projectId, missionId), operations: record!, now: AT(2),
    }) as { operationsView?: {
      errorCount: number; health: string; errorRate: { known: boolean; value?: number };
      latency: { phase: string; samples: number }[];
    } };

    expect(view.operationsView).toBeDefined();
    expect(view.operationsView?.latency.find((l) => l.phase === 'total')?.samples).toBe(2);
    expect(view.operationsView?.errorCount).toBe(1);
    // Two real attempts, one failure — the denominator the producer supplies.
    expect(view.operationsView?.errorRate.known).toBe(true);
    expect(view.operationsView?.errorRate.value).toBeCloseTo(0.5, 5);
    expect(view.operationsView?.health).toBe('failing');
  });

  it('a stale record reports UNKNOWN rather than the last good state', async () => {
    const { store, projectId, missionId } = started();
    await store.recordObservation(projectId, observation());
    const view = deriveMissionProjection({
      ...projectionInput(store, projectId, missionId),
      operations: store.getOperations(projectId)!, now: AT(60 * 60),
    }) as { operationsView?: { health: string; healthReason: string } };
    expect(view.operationsView?.health).toBe('unknown');
    expect(view.operationsView?.healthReason).toContain('silent system');
  });
});
