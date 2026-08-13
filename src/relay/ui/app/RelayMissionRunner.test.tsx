/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayMissionRunner } from './RelayMissionRunner';
import type { startBetaMission, pollBetaMission, shipBetaMission, retryBetaMission, cancelBetaMission, listBetaMissions } from './beta-mission';
import type { listPsps, loadPsp } from './psp-client';
import { rememberActiveMission, recallActiveMission, clearActiveMissions } from './active-mission';
import type { LiveMissionUpdate } from './contracts';

// A hermetic PSP list so the embedded picker never reaches the network in tests.
const emptyList = (async () => ({ ok: true as const, psps: [], message: null })) as unknown as typeof listPsps;

/**
 * RUN A MISSION, through the UI. A signed-in user starts a Mission on their
 * connected repo, watches truthful live state to verified_complete with per-role
 * actor evidence, and ships it. The bridge's view is rendered unchanged; Ship
 * appears only at verified_complete; a refusal is shown in the bridge's words.
 */

const KEY = 'github:github.com/beta-alice/their-app';
const BRIDGE = 'https://bridge.example';

const coding = { state: 'running', currentRole: 'coding_agent', events: [], phase: 'coding' } as unknown as LiveMissionUpdate;
const verified = {
  state: 'verified_complete', currentRole: 'relay', events: [], phase: 'verified_complete',
  attestations: [
    { role: 'coding_agent', attestationId: 'a1', requestedActor: 'Claude Code', actualActor: 'Claude Code', actualRuntime: 'claude-code-local' },
    { role: 'reviewer', attestationId: 'a2', requestedActor: 'Hermes', actualActor: 'Hermes', actualRuntime: 'hermes', provider: 'Anthropic' },
  ],
} as unknown as LiveMissionUpdate;
const failedRetryable = {
  state: 'failed', currentRole: 'relay', events: [], phase: 'failed',
  error: { safeMessage: 'Provider timed out.', retryable: true },
} as unknown as LiveMissionUpdate;
const cancelled = { state: 'cancelled', currentRole: 'relay', events: [], phase: 'cancelled' } as unknown as LiveMissionUpdate;

afterEach(() => { cleanup(); vi.restoreAllMocks(); clearActiveMissions(); });

describe('RelayMissionRunner', () => {
  it('starts a Mission on the connected repo, carrying the objective + config', async () => {
    const start = vi.fn<typeof startBetaMission>(async (input) => {
      expect(input.repositoryKey).toBe(KEY);
      expect(input.objective).toBe('Implement the normalizer');
      return { ok: true, missionId: 'm-1', view: coding, message: null };
    });
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-1', view: coding, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} config={{ mode: 'autonomous' }} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'Implement the normalizer' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    // The live state is shown.
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('running'));
  });

  it('watches to verified_complete, shows actor evidence, and ships', async () => {
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-2', view: coding, message: null }));
    // The mission progresses to verified_complete on the next poll.
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-2', view: verified, message: null }));
    const shipImpl = vi.fn<typeof shipBetaMission>(async () => ({ ok: true, stage: 'committed', shipped: false, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} shipImpl={shipImpl} pspListImpl={emptyList} pollIntervalMs={10} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'Do it' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));

    // Truthful live state reaches verified_complete.
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('verified_complete'));
    // Per-role actor evidence is visible (requested vs actual).
    const evidence = screen.getByLabelText(/Role evidence/i).textContent ?? '';
    expect(evidence).toContain('coding_agent');
    expect(evidence).toContain('Claude Code');
    expect(evidence).toContain('Anthropic');

    // Ship is offered only now; clicking ships.
    fireEvent.click(screen.getByRole('button', { name: /Ship this Mission/i }));
    await waitFor(() => expect(shipImpl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/Ship reached/i).textContent).toContain('committed'));
  });

  it('states a start refusal in the bridge’s own words, and does not begin watching', async () => {
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: false, missionId: null, view: null, message: 'This repository is not yours to target.' }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'x', view: coding, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'sneak' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/not yours to target/i);
    expect(poll).not.toHaveBeenCalled();
  });

  it('runs under a SELECTED PSP: its config, not the default, is what start carries', async () => {
    const list = (async () => ({
      ok: true as const,
      psps: [{ pspId: 'careful', name: 'Careful', updatedAt: 'x', mode: 'guided' }],
      message: null,
    })) as unknown as typeof listPsps;
    const load = vi.fn<typeof loadPsp>(async ({ pspId }) => ({
      ok: true, pspId, name: 'Careful', config: { mode: 'guided', tag: pspId }, message: null,
    }));
    const start = vi.fn<typeof startBetaMission>(async (input) => {
      // The engine acts on the SELECTED profile's config, not the default.
      expect((input.config as { tag?: string }).tag).toBe('careful');
      return { ok: true, missionId: 'm-9', view: coding, message: null };
    });
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-9', view: coding, message: null }));
    render(
      <RelayMissionRunner
        repositoryKey={KEY}
        bridgeUrl={BRIDGE}
        startImpl={start}
        pollImpl={poll}
        pspListImpl={list}
        pspLoadImpl={load}
        config={{ mode: 'guided', tag: 'default' }}
      />,
    );
    // Pick the saved profile; its config loads.
    fireEvent.change(await screen.findByLabelText(/Configuration \(PSP\)/i), { target: { value: 'careful' } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    // The runner now says it will run under that profile.
    expect(screen.getByText(/Running under/i).textContent).toContain('Careful');
    // Start carries the selected profile's config.
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'Do it carefully' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it('reconnects to a remembered mission after a refresh, then can start another', async () => {
    // A prior render started m-prev; a "refresh" is a fresh mount for the same repo.
    rememberActiveMission(KEY, 'm-prev');
    const start = vi.fn<typeof startBetaMission>();
    const poll = vi.fn<typeof pollBetaMission>(async ({ missionId }) => {
      // The runner re-reads the SAME mission's authoritative state from the bridge.
      expect(missionId).toBe('m-prev');
      return { ok: true, missionId, view: verified, message: null };
    });
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} pollIntervalMs={10} />);
    // No Start form — it went straight to watching the remembered mission.
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('verified_complete'));
    expect(start).not.toHaveBeenCalled();
    // "Start another" drops the pointer and returns to Start.
    fireEvent.click(screen.getByRole('button', { name: /Start another Mission/i }));
    expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy();
    expect(recallActiveMission(KEY)).toBeNull();
  });

  it('offers Retry for a retryable failure and re-drives the same mission', async () => {
    let failed = true; // first poll fails retryably; after retry, it runs again.
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-r', view: coding, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-r', view: failed ? failedRetryable : coding, message: null }));
    const retry = vi.fn<typeof retryBetaMission>(async ({ missionId }) => { failed = false; return { ok: true, missionId, view: coding, message: null }; });
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} retryImpl={retry} pspListImpl={emptyList} pollIntervalMs={10} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    // The retryable failure is shown, with its safe reason.
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('failed'));
    expect(screen.getByText(/Stopped:/i).textContent).toContain('Provider timed out');
    // Retrying re-drives the SAME mission and watching resumes.
    fireEvent.click(screen.getByRole('button', { name: /Retry Mission/i }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('running'));
  });

  it('does not offer Retry for a non-retryable failure', async () => {
    const nonRetryable = { state: 'failed', currentRole: 'relay', events: [], phase: 'failed', error: { safeMessage: 'Refused.', retryable: false } } as unknown as LiveMissionUpdate;
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-n', view: coding, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-n', view: nonRetryable, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} pollIntervalMs={10} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('failed'));
    // Start another is offered (any terminal); Retry is not (not retryable).
    expect(screen.getByRole('button', { name: /Start another Mission/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Retry Mission/i })).toBeNull();
    // Never offers to ship a Mission that failed — completion is earned, not offered.
    expect(screen.queryByRole('button', { name: /Ship this Mission/i })).toBeNull();
  });

  it('requests least privilege — omits permissions when the config names none (safe floor)', async () => {
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-lp', view: coding, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-lp', view: coding, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} config={{ mode: 'guided' }} />);
    // The user sees what authority the Mission will ask for, before starting.
    expect(screen.getByText(/safe floor/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'inspect' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    // No hardcoded ship ladder — the key is absent, so the server applies its floor.
    expect('permissions' in start.mock.calls[0][0]).toBe(false);
  });

  it('forwards exactly the permissions the chosen profile names — never more', async () => {
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-lp2', view: coding, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-lp2', view: coding, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} config={{ mode: 'guided', permissions: ['read', 'write_worktree', 'commit'] }} />);
    expect(screen.getByText(/Permissions requested/i).textContent).toContain('commit');
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'build' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0].permissions).toEqual(['read', 'write_worktree', 'commit']);
  });

  it('surfaces repo, branch, contract revision, and the ACTUAL permissions held', async () => {
    const evidenced = {
      state: 'running', currentRole: 'coding_agent', events: [], phase: 'coding',
      missionRevision: 'rev-7',
      config: {
        pspId: null, roles: { architect: null, coding: null, reviewer: null },
        mode: 'guided', review: 'independent', completionRule: 'strict',
        permissions: ['read', 'write_worktree'],
        limits: { runtimeMinutes: null, agentCalls: 8, spendUsd: 5, reviewCycles: null, repairCycles: null },
      },
    } as unknown as LiveMissionUpdate;
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-e', view: evidenced, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-e', view: evidenced, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} workingBranch="relay/beta-x" pollIntervalMs={100000} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(screen.getByLabelText(/Mission evidence/i)).toBeTruthy());
    const facts = screen.getByLabelText(/Mission evidence/i).textContent ?? '';
    expect(facts).toContain(KEY);              // repo
    expect(facts).toContain('relay/beta-x');   // branch
    expect(facts).toContain('rev-7');          // contract revision
    // The permissions HELD come from the authoritative view, not the browser's request.
    expect(facts).toContain('read, write_worktree');
    // The authorized spend/compute ceiling the Mission runs under (criterion 15).
    expect(facts).toContain('$5');
    expect(facts).toContain('8 agent calls');
  });

  it('requires Mission Contract confirmation before a high-consequence Mission runs (criterion 7)', async () => {
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-hc', view: coding, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-hc', view: coding, message: null }));
    render(
      <RelayMissionRunner
        repositoryKey={KEY}
        bridgeUrl={BRIDGE}
        startImpl={start}
        pollImpl={poll}
        pspListImpl={emptyList}
        config={{ mode: 'guided', permissions: ['read', 'write_worktree', 'commit', 'push_feature_branch', 'create_pr', 'merge_pr'], limits: { spendUsd: 5, agentCalls: 8 } }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'Merge the PR' } });
    // The button is a Contract gate, not an immediate start.
    fireEvent.click(screen.getByRole('button', { name: /Review Mission Contract/i }));
    // The Contract is presented; nothing has been dispatched yet.
    const contract = screen.getByLabelText(/Mission Contract/i).textContent ?? '';
    expect(contract).toContain('merge_pr');
    expect(contract).toContain('$5');
    expect(start).not.toHaveBeenCalled();
    // Only an explicit fresh confirmation runs the Mission.
    fireEvent.click(screen.getByRole('button', { name: /Confirm authorization & start/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it('shows the Mission brief from the architect handoff, with honest provenance', async () => {
    const briefed = {
      state: 'running', currentRole: 'coding_agent', events: [], phase: 'coding',
      handoff: {
        objective: 'Add a normalizer', instructions: ['do x'], constraints: ['no new deps'],
        acceptanceCriteria: ['handles null input', 'has a unit test'],
        architectLabel: 'Sunday Alcatraz (live)', architectProvenance: 'live',
      },
    } as unknown as LiveMissionUpdate;
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-b', view: briefed, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-b', view: briefed, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} pollIntervalMs={100000} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(screen.getByText(/Mission brief/i)).toBeTruthy());
    // Honest provenance — the label says which architect, live or simulated.
    expect(screen.getByText(/Mission brief/i).textContent).toMatch(/live/i);
    const ac = screen.getByLabelText(/Acceptance criteria/i).textContent ?? '';
    expect(ac).toContain('handles null input');
    expect(ac).toContain('has a unit test');
  });

  it('shows the independent reviewer verdict and the SERVED model', async () => {
    const reviewed = {
      state: 'verified_complete', currentRole: 'relay', events: [], phase: 'verified_complete',
      review: {
        reviewer: 'Hermes', runtime: 'hermes', provider: 'Anthropic', requestedModel: 'claude',
        servedModel: 'claude-opus-4-8', billing: 'api_billed', verdict: 'approved',
        summary: 'Meets the stated acceptance criteria.', findings: [], requirementsChecked: [],
        reviewedArtifactDigest: 'd', startedAt: 'a', completedAt: 'b',
      },
    } as unknown as LiveMissionUpdate;
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-rv', view: reviewed, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-rv', view: reviewed, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} pollIntervalMs={100000} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(screen.getByLabelText(/Reviewer verdict/i)).toBeTruthy());
    const rv = screen.getByLabelText(/Reviewer verdict/i).textContent ?? '';
    expect(rv).toContain('approved');
    // The served model is shown verbatim, not defaulted from the requested one.
    expect(rv).toContain('claude-opus-4-8');
  });

  it('opens a past Mission from history and reconnects to it without starting anything', async () => {
    const history = (async () => ({
      ok: true as const,
      missions: [{ missionId: 'm-old', objective: 'Old one', state: 'verified_complete', createdAt: 'x', completedAt: 'y' }],
      message: null,
    })) as unknown as typeof listBetaMissions;
    const start = vi.fn<typeof startBetaMission>();
    const poll = vi.fn<typeof pollBetaMission>(async ({ missionId }) => ({ ok: true, missionId, view: verified, message: null }));
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} pspListImpl={emptyList} historyImpl={history} pollIntervalMs={10} />);
    // Click "Open" on the past mission → reconnect to its authoritative state.
    fireEvent.click(await screen.findByRole('button', { name: /Open/i }));
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('verified_complete'));
    expect(start).not.toHaveBeenCalled();
    expect(recallActiveMission(KEY)).toBe('m-old');
  });

  it('cancels an in-flight mission', async () => {
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-c', view: coding, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-c', view: coding, message: null }));
    const cancel = vi.fn<typeof cancelBetaMission>(async ({ missionId }) => ({ ok: true, missionId, view: cancelled, message: null }));
    // Long poll interval: the running state comes from start; no background poll
    // races the authoritative cancel back to running.
    render(<RelayMissionRunner repositoryKey={KEY} bridgeUrl={BRIDGE} startImpl={start} pollImpl={poll} cancelImpl={cancel} pspListImpl={emptyList} pollIntervalMs={100000} />);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'go' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('running'));
    fireEvent.click(screen.getByRole('button', { name: /Cancel Mission/i }));
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('cancelled'));
  });
});
