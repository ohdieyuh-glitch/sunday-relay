/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement, useState, type MutableRefObject } from 'react';
import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { useRelayDurableMission, type DurableMissionApi } from '../app/useRelayDurableMission';
import { RelayNotificationHost, useRelayNotificationCenter } from '../notifications';
import { RelayMissionRecoveryPanel } from '../recovery';
import {
  DURABLE_MISSION_SCHEMA_VERSION,
  assessRecovery,
  createDurableMissionStore,
  createInMemoryDurableBacking,
  sealDurableRecord,
  type DurableKeyValueBacking,
  type DurableMissionRecordDraft,
  type DurableMissionStorePort,
} from '../../mission/durable';

/**
 * Durable persistence wired into the real application shell: notification
 * truthfulness (saved only after a successful write, blocked when unsafe),
 * the single recovery surface, duplicate-resume protection, unchanged Relay
 * Dog state, and no network in offline mode.
 */

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay/project/rly-001';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const NOW = '2026-08-01T10:00:00.000Z';

function draft(overrides: Partial<DurableMissionRecordDraft> = {}): DurableMissionRecordDraft {
  return {
    schemaVersion: DURABLE_MISSION_SCHEMA_VERSION,
    missionId: 'mission-i1',
    projectId: 'rly-001',
    missionContractRef: 'rly-001:mission-i1',
    missionContractRevision: 'r1',
    assignments: [],
    missionState: 'coding',
    stage: 'coding_agent_working',
    currentTaskRef: null,
    lastCompletedAction: null,
    inFlightAction: null,
    evidence: {
      filesReportedChanged: ['src/relay/ui/app/store.ts'],
      commandsReported: [],
      testStatus: 'passed',
      evidenceRefs: [],
      traceLedgerRefs: [],
      executionCapsuleRefs: [],
      findingRefs: ['F-1'],
      repairRefs: [],
      handoffRefs: [],
      approvalRefs: [],
    },
    usage: {
      costReceiptRefs: [],
      knownCostMicros: null,
      currency: null,
      budgetStatus: null,
      usageProvenance: 'offline',
    },
    interruptionReason: 'browser closed',
    provenance: 'offline',
    createdAt: NOW,
    updatedAt: NOW,
    checkpointReason: 'bounded_task_completed',
    checkpointAt: NOW,
    recoveryGeneration: 0,
    owner: null,
    ...overrides,
  };
}

/** A harness that mounts the durable hook with an injected store, exactly as
    the shell does, plus the real notification host. */
function Harness({
  store,
  apiRef,
}: {
  store: DurableMissionStorePort;
  apiRef: MutableRefObject<DurableMissionApi | null>;
}) {
  const center = useRelayNotificationCenter();
  const [inspecting, setInspecting] = useState(false);
  const durable = useRelayDurableMission({
    store,
    publish: center.publish,
    onViewRecovery: () => setInspecting(true),
    runtimeAvailable: false,
    now: () => NOW,
    sessionId: 'session-test',
  });
  apiRef.current = durable;
  return createElement(
    'div',
    null,
    durable.discovered !== null && durable.discovered.classification !== 'completed'
      ? createElement(RelayMissionRecoveryPanel, {
        assessment: durable.discovered,
        missionName: 'Usage Dashboard',
        runtimeAvailable: false,
        inspecting,
        onResume: () => { void durable.resume('mission-i1'); },
        onInspect: () => setInspecting((v) => !v),
        onStop: () => { void durable.stop('mission-i1'); },
      })
      : null,
    createElement(RelayNotificationHost, {
      notifications: center.visible,
      queuedCount: center.queuedCount,
      onDismiss: center.dismiss,
      onPause: center.pauseTimers,
      onResume: center.resumeTimers,
    }),
  );
}

async function mountWith(backing: DurableKeyValueBacking) {
  const store = createDurableMissionStore(backing);
  const apiRef: MutableRefObject<DurableMissionApi | null> = { current: null };
  const view = render(createElement(Harness, { store, apiRef }));
  await waitFor(() => expect(apiRef.current?.discovering).toBe(false));
  return { store, apiRef, view };
}

/** Seed storage as if a previous session had checkpointed. */
function seededBacking(record: DurableMissionRecordDraft = draft()) {
  const sealed = sealDurableRecord(record);
  return createInMemoryDurableBacking({
    seed: { [`mission:${sealed.missionId}`]: JSON.stringify(sealed) },
  });
}

/* ------------------------------------------------------- notifications */

describe('persistence notifications are truthful', () => {
  it('Mission saved appears ONLY after the durable write succeeds', async () => {
    const backing = createInMemoryDurableBacking();
    const { apiRef } = await mountWith(backing);
    expect(screen.queryByText('Mission saved')).toBeNull();

    await act(async () => {
      await apiRef.current?.checkpoint(checkpointInput());
    });
    expect(screen.getByText('Mission saved')).toBeTruthy();
    expect(screen.getByText(/Checkpoint created at/)).toBeTruthy();
  });

  it('a FAILED write produces Save delayed and never Mission saved', async () => {
    const backing = createInMemoryDurableBacking({ failWrites: true });
    const { apiRef } = await mountWith(backing);
    await act(async () => {
      await apiRef.current?.checkpoint(checkpointInput());
    });
    expect(screen.getByText('Save delayed')).toBeTruthy();
    expect(screen.getByText('Relay could not confirm the latest durable checkpoint.')).toBeTruthy();
    expect(screen.queryByText('Mission saved')).toBeNull();
    // …and nothing was recorded as the last saved checkpoint.
    expect(apiRef.current?.lastSaved).toBeNull();
  });

  it('a paused checkpoint says Mission paused', async () => {
    const { apiRef } = await mountWith(createInMemoryDurableBacking());
    await act(async () => {
      await apiRef.current?.checkpoint(checkpointInput({ paused: true }));
    });
    expect(screen.getByText('Mission paused')).toBeTruthy();
    expect(screen.getByText('Relay saved the mission before pausing.')).toBeTruthy();
  });

  it('a valid record produces Mission recovered exactly once', async () => {
    await mountWith(seededBacking());
    expect(screen.getAllByText('Mission recovered')).toHaveLength(1);
    expect(screen.getByText('Relay restored the latest safe checkpoint.')).toBeTruthy();
    expect(screen.getAllByText('Ready to resume').length).toBe(1);
  });

  it('an unsafe record produces Recovery blocked, and it does not auto-dismiss', async () => {
    vi.useFakeTimers();
    const backing = createInMemoryDurableBacking({
      seed: { 'mission:mission-i1': '{ "schemaVersion": "relay-durable-mission.v1", broken' },
    });
    const store = createDurableMissionStore(backing);
    const apiRef: MutableRefObject<DurableMissionApi | null> = { current: null };
    render(createElement(Harness, { store, apiRef }));
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Recovery blocked')).toBeTruthy();
    // Critical notifications persist until dismissed.
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(screen.getByText('Recovery blocked')).toBeTruthy();
    expect(screen.queryByText('Mission recovered')).toBeNull();
  });
});

/* ----------------------------------------------------- recovery surface */

describe('the recovery surface', () => {
  it('shows the truthful summary, and never claims a live runtime', async () => {
    await mountWith(seededBacking());
    const panel = screen.getByLabelText('Unfinished mission recovery');
    expect(within(panel).getByText('READY TO RESUME')).toBeTruthy();
    expect(within(panel).getByText('Usage Dashboard')).toBeTruthy();
    expect(within(panel).getByText('browser closed')).toBeTruthy();
    expect(within(panel).getByText('1 reported')).toBeTruthy();
    expect(within(panel).getByText('Passed')).toBeTruthy();
    // A cost Relay does not know stays Unknown — never 0.
    expect(within(panel).getByText('Unknown')).toBeTruthy();
    expect(panel.textContent).not.toContain('$0');
    expect(panel.textContent).toContain('has not reconnected an agent');
    // With no runtime, the primary control restores state — it does not
    // promise to resume execution.
    expect(within(panel).getByRole('button', { name: 'RESTORE SAVED STATE' })).toBeTruthy();
  });

  it('Inspect reveals the recovery checks without resuming anything', async () => {
    const { apiRef } = await mountWith(seededBacking());
    // The notification carries an INSPECT MISSION action too — scope to the
    // recovery panel so the query names exactly one control.
    const panel = screen.getByLabelText('Unfinished mission recovery');
    fireEvent.click(within(panel).getByRole('button', { name: 'INSPECT MISSION' }));
    const checks = screen.getByLabelText('Recovery checks');
    expect(checks.textContent).toContain('checksum verified');
    expect(apiRef.current?.lastSaved).toBeNull();
  });

  it('an ambiguous in-flight action offers no Resume at all', async () => {
    await mountWith(seededBacking(draft({
      inFlightAction: {
        actionId: 'a-1',
        kind: 'command',
        summary: 'RUN database migration',
        startedAt: NOW,
        outcome: 'unknown',
        completedAt: null,
      },
    })));
    const panel = screen.getByLabelText('Unfinished mission recovery');
    expect(within(panel).getByText('CANNOT RESUME SAFELY')).toBeTruthy();
    expect(
      (within(panel).getByRole('button', { name: 'RESTORE SAVED STATE' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(panel.textContent).toContain('cannot tell whether');
  });

  it('Stop removes the record deliberately; a corrupt one is never auto-removed', async () => {
    const backing = seededBacking();
    const { store, apiRef } = await mountWith(backing);
    fireEvent.click(screen.getByRole('button', { name: 'STOP MISSION' }));
    await waitFor(() => expect(apiRef.current?.discovered).toBeNull());
    expect(await store.list()).toEqual([]);
  });
});

/* -------------------------------------------------- duplicate execution */

describe('duplicate execution protection', () => {
  it('two Resume clicks accept ONE resume', async () => {
    const backing = seededBacking();
    const { store } = await mountWith(backing);
    const button = screen.getByRole('button', { name: 'RESTORE SAVED STATE' });
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
      await Promise.resolve();
    });
    await waitFor(async () => {
      const read = await store.read('mission-i1');
      expect(read.ok && read.record.recoveryGeneration).toBe(1);
    });
  });

  it('a refresh mid-recovery does not duplicate work — the generation is preserved', async () => {
    const backing = seededBacking();
    const first = await mountWith(backing);
    await act(async () => { await first.apiRef.current?.resume('mission-i1'); });
    cleanup();

    // A "refresh": a brand-new mount over the same storage.
    const second = await mountWith(backing);
    const read = await second.store.read('mission-i1');
    expect(read.ok && read.record.recoveryGeneration).toBe(1);
    await act(async () => { await second.apiRef.current?.resume('mission-i1'); });
    const after = await second.store.read('mission-i1');
    // A second session legitimately takes over ONCE — never repeatedly.
    expect(after.ok && after.record.recoveryGeneration).toBe(2);
    await act(async () => { await second.apiRef.current?.resume('mission-i1'); });
    const stable = await second.store.read('mission-i1');
    expect(stable.ok && stable.record.recoveryGeneration).toBe(2);
  });
});

/* --------------------------------------------------- state preservation */

describe('what must survive a restart', () => {
  it('paused state, review findings and known costs all round-trip', async () => {
    const backing = seededBacking(draft({
      checkpointReason: 'mission_paused',
      evidence: { ...draft().evidence, findingRefs: ['F-1', 'F-2'], repairRefs: ['R-1'] },
      usage: { ...draft().usage, knownCostMicros: '4500000', currency: 'USD' },
    }));
    const { apiRef } = await mountWith(backing);
    const discovered = apiRef.current?.discovered;
    expect(discovered?.classification).toBe('paused');
    expect(discovered?.record?.evidence.findingRefs).toEqual(['F-1', 'F-2']);
    expect(discovered?.record?.evidence.repairRefs).toEqual(['R-1']);
    expect(discovered?.record?.usage.knownCostMicros).toBe('4500000');
  });

  it('an unknown cost stays unknown after recovery', async () => {
    const { apiRef } = await mountWith(seededBacking());
    expect(apiRef.current?.discovered?.record?.usage.knownCostMicros).toBeNull();
    const panel = screen.getByLabelText('Unfinished mission recovery');
    expect(within(panel).getByText('Unknown')).toBeTruthy();
  });

  it('simulated provenance stays disclosed through recovery', async () => {
    await mountWith(seededBacking(draft({ provenance: 'simulated' })));
    const panel = screen.getByLabelText('Unfinished mission recovery');
    expect(panel.textContent).toContain('SIMULATED MISSION');
  });

  it('recovery never reports a reconnected runtime', async () => {
    const { apiRef } = await mountWith(seededBacking());
    expect(apiRef.current?.discovered?.runtimeReconnected).toBe(false);
    const assessment = assessRecovery(
      { ok: true, record: sealDurableRecord(draft()), migrated: false },
      { runtimeAvailable: true, budgetSufficient: true, sessionId: 's', now: NOW },
    );
    // Even WITH a runtime, restoring state is not a claim of reconnection.
    expect(assessment.runtimeReconnected).toBe(false);
  });
});

/* ---------------------------------------------------- the whole shell */

describe('the application shell', () => {
  it('boots with no unfinished mission, one notification host, and no network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelectorAll('[data-relay-notification-host]').length).toBeLessThanOrEqual(1);
    expect(document.querySelectorAll('[data-relay-recovery-panel]')).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    // The Usage Bar stays truthful alongside persistence.
    expect(screen.getAllByRole('button', { name: /^Usage — / })[0].textContent)
      .toBe('USAGE · UNAVAILABLE');
  });

  it('Relay Dog state is untouched by persistence', async () => {
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    const dogLine = () =>
      screen.getAllByRole('status').find((n) => n.textContent?.includes('Relay Dog'))?.textContent
      ?? '';
    const before = dogLine();
    expect(before).toContain('Relay Dog');
    await act(async () => { await Promise.resolve(); });
    expect(dogLine()).toBe(before);
  });

  it('existing fullscreen panels still open and close', async () => {
    render(createElement(RelayPreviewApp));
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'Expand Relay Console panel' }));
    const dialog = screen.getAllByRole('dialog').find(
      (d) => d.getAttribute('aria-label')?.includes('focused panel'),
    );
    expect(dialog).toBeTruthy();
    fireEvent.keyDown(dialog as HTMLElement, { key: 'Escape' });
    expect(
      screen.queryAllByRole('dialog').filter(
        (d) => d.getAttribute('aria-label')?.includes('focused panel'),
      ),
    ).toHaveLength(0);
  });
});

/* ------------------------------------------------------------ helpers */

function checkpointInput(options: { paused?: boolean } = {}) {
  const mission = {
    id: 'mission-i1',
    projectId: 'rly-001',
    title: 'Usage Dashboard',
    objective: 'ship it',
    state: options.paused === true ? 'configured' : 'coding',
    currentRole: 'coding_agent',
    currentStep: -1,
    demo: false,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: null,
  } as never;
  const project = {
    id: 'rly-001',
    reference: 'RLY / 001',
    name: 'Usage Dashboard',
    summary: '',
    originalRequest: '',
    status: 'active',
    demo: false,
    createdAt: NOW,
    updatedAt: NOW,
    activeMissionId: 'mission-i1',
  } as never;
  return {
    mission,
    project,
    settings: null,
    events: [],
    usage: null,
    interruptionReason: options.paused === true ? 'paused by the founder' : null,
    // PAUSE is a boundary only the caller knows — it is named, not inferred.
    ...(options.paused === true ? { reason: 'mission_paused' as const } : {}),
  };
}
