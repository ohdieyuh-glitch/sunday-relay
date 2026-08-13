/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayMissionRunner } from './RelayMissionRunner';
import type { startBetaMission, pollBetaMission, shipBetaMission } from './beta-mission';
import type { listPsps, loadPsp } from './psp-client';
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

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
});
