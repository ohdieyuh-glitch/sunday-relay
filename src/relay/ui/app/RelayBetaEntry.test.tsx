/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayBetaEntry } from './RelayBetaEntry';
import {
  saveBridgeSession, clearBridgeSession,
  type completeGitHubSignIn, type registerRepository, type readInstallationFromReturn,
} from './bridge-session';
import type { startBetaMission, pollBetaMission, shipBetaMission } from './beta-mission';
import type { listPsps } from './psp-client';
import type { LiveMissionUpdate } from './contracts';

// Keep the embedded PSP picker hermetic — no network on mount in these tests.
const emptyPspList = (async () => ({ ok: true as const, psps: [], message: null })) as unknown as typeof listPsps;

/**
 * THE BETA ENTRY GATE, clicked through. A fresh participant sees a sign-in
 * screen, then a connect-repository screen, and only reaches the app once the
 * bridge confirms a connected repository. And the property that keeps every
 * other screen safe: with no bridge configured the gate is transparent — the app
 * renders exactly as before.
 */

const BRIDGE = 'https://bridge.example';
const APP = <div data-testid="app">THE APP</div>;

const noComplete = (async () => ({ signedIn: false, message: null })) as typeof completeGitHubSignIn;
const withInstall = (id: string) => (() => id) as typeof readInstallationFromReturn;
const registerOk = (async () => ({ ok: true as const, key: 'github:github.com/beta-alice/their-app', message: null })) as typeof registerRepository;

afterEach(() => { cleanup(); clearBridgeSession(); });

function signedIn() {
  saveBridgeSession({ token: 't', origin: '', expiresAt: '', scope: 'browser_control', participantId: 'ghu-4242' });
}

const codingView = { state: 'running', currentRole: 'coding_agent', events: [], phase: 'coding' } as unknown as LiveMissionUpdate;
const verifiedView = {
  state: 'verified_complete', currentRole: 'relay', events: [], phase: 'verified_complete',
  attestations: [{ role: 'coding_agent', attestationId: 'a1', requestedActor: 'Claude Code', actualActor: 'Claude Code', actualRuntime: 'claude-code-local' }],
} as unknown as LiveMissionUpdate;

describe('RelayBetaEntry', () => {
  it('is TRANSPARENT with no bridge configured — the app renders unchanged', () => {
    render(<RelayBetaEntry bridgeUrl={null}>{APP}</RelayBetaEntry>);
    expect(screen.getByTestId('app')).toBeTruthy();
  });

  it('gates a fresh user at sign-in — the app is not shown', async () => {
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    expect(await screen.findByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('after sign-in, asks the user to connect a repository — still not the app', async () => {
    signedIn();
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete} readInstallationImpl={withInstall('55550001')}>{APP}</RelayBetaEntry>);
    expect(await screen.findByRole('button', { name: /Connect this repository/i })).toBeTruthy();
    expect(screen.getByText(/Signed in as/i).textContent).toContain('ghu-4242');
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('clicks all the way through: signed in → connect a repo → the Mission surface for that repo', async () => {
    signedIn();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        registerImpl={registerOk}
        missionPspListImpl={emptyPspList}
      >
        {APP}
      </RelayBetaEntry>,
    );
    // The connect-repository screen.
    fireEvent.change(await screen.findByLabelText(/Repository owner/i), { target: { value: 'beta-alice' } });
    fireEvent.change(screen.getByLabelText(/Repository name/i), { target: { value: 'their-app' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect this repository/i }));
    // The bridge confirms → the gate advances to the Mission surface for the
    // connected repository (start/watch/ship), keyed to what was registered.
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByText(/Start a Mission on/i).textContent).toContain('github:github.com/beta-alice/their-app');
  });

  it('THE WHOLE JOURNEY through the UI: connect → start → watch verified_complete → ship', async () => {
    signedIn();
    const start = vi.fn<typeof startBetaMission>(async (input) => {
      // The mission targets the repo the user connected, under the beta config.
      expect(input.repositoryKey).toBe('github:github.com/beta-alice/their-app');
      expect((input.config as { mode?: string }).mode).toBe('guided');
      return { ok: true, missionId: 'm-journey', view: codingView, message: null };
    });
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-journey', view: verifiedView, message: null }));
    const shipImpl = vi.fn<typeof shipBetaMission>(async () => ({ ok: true, stage: 'committed', shipped: false, message: null }));

    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        registerImpl={registerOk}
        missionStartImpl={start}
        missionPollImpl={poll}
        missionShipImpl={shipImpl}
        missionPspListImpl={emptyPspList}
      >
        {APP}
      </RelayBetaEntry>,
    );

    // Connect the repository.
    fireEvent.change(await screen.findByLabelText(/Repository owner/i), { target: { value: 'beta-alice' } });
    fireEvent.change(screen.getByLabelText(/Repository name/i), { target: { value: 'their-app' } });
    fireEvent.click(screen.getByRole('button', { name: /Connect this repository/i }));

    // Give Relay an objective and start the Mission.
    fireEvent.change(await screen.findByLabelText(/Objective/i), { target: { value: 'Implement it' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));

    // Watch truthful live state to verified_complete, then ship.
    await waitFor(() => expect(screen.getByText(/State:/i).textContent).toContain('verified_complete'));
    fireEvent.click(screen.getByRole('button', { name: /Ship this Mission/i }));
    await waitFor(() => expect(screen.getByText(/Ship reached/i).textContent).toContain('committed'));
    expect(start).toHaveBeenCalledTimes(1);
    expect(shipImpl).toHaveBeenCalledTimes(1);
  });
});
