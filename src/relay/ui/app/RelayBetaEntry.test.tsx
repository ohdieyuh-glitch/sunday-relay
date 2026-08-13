/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RelayBetaEntry } from './RelayBetaEntry';
import {
  saveBridgeSession, clearBridgeSession,
  type completeGitHubSignIn, type registerRepository, type readInstallationFromReturn,
} from './bridge-session';
import type { startBetaMission, pollBetaMission, shipBetaMission, listBetaMissions } from './beta-mission';
import type { listPsps } from './psp-client';
import type { listConnectedRepositories, discoverInstallationRepositories, ConnectedRepository } from './repository-client';
import { clearActiveMissions } from './active-mission';
import { clearConnectedRepository } from './connected-repository';
import type { LiveMissionUpdate } from './contracts';

// Keep the embedded picker + history hermetic — no network on mount in these tests.
const emptyPspList = (async () => ({ ok: true as const, psps: [], message: null })) as unknown as typeof listPsps;
const emptyHistory = (async () => ({ ok: true as const, missions: [], message: null })) as unknown as typeof listBetaMissions;
// A returning participant's connected-repository list, hermetic. `emptyRepoList`
// models a FIRST-TIME user (no prior registrations) — the gate degrades straight
// to the connect flow, which is the behaviour the pre-picker tests assert.
const emptyRepoList = (async () => ({ ok: true as const, repositories: [], message: null })) as unknown as typeof listConnectedRepositories;
const repoListOf = (...repositories: ConnectedRepository[]) =>
  (async () => ({ ok: true as const, repositories, message: null })) as unknown as typeof listConnectedRepositories;
const aliceRepo: ConnectedRepository = {
  key: 'github:github.com/beta-alice/their-app',
  provider: 'github', owner: 'beta-alice', name: 'their-app', defaultBranch: 'main',
  grants: ['read', 'write_worktree'], revoked: false, registeredAt: '2026-08-12T00:00:00Z',
};
// Discovery of a fresh installation's authorized repositories, hermetic. The
// post-install connect step now SELECTS from these instead of typing owner/name.
// `discoverEmpty` models an installation that authorizes nothing yet, so the
// connect flow degrades to its inline manual fallback — the shape the
// degradation tests assert against.
const discoverAlice = (async () => ({
  ok: true as const,
  repositories: [{ owner: 'beta-alice', name: 'their-app', fullName: 'beta-alice/their-app', defaultBranch: 'main', private: false }],
  truncated: false, message: null,
})) as unknown as typeof discoverInstallationRepositories;
const discoverEmpty = (async () => ({
  ok: true as const, repositories: [], truncated: false, message: null,
})) as unknown as typeof discoverInstallationRepositories;

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

afterEach(() => { cleanup(); clearBridgeSession(); clearActiveMissions(); clearConnectedRepository(); });

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

  it('AC-1/AC-3: a fresh live user lands in WONDERLAND with the Wandering Relay Dog — GitHub is deferred, no simulated data', async () => {
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    // The entrance is Wonderland, not a GitHub wall.
    expect(await screen.findByText(/What are we building/i)).toBeTruthy();
    // The Wandering Relay Dog is a real part of the experience.
    expect(screen.getByText('WANDERING')).toBeTruthy();
    expect(screen.getByText('RELAY DOG')).toBeTruthy();
    // AC-3: the live entrance shows NO simulated data — no FIXTURE label, and the
    // recent-projects surface is its honest empty state, never fixture projects.
    expect(screen.queryByText(/FIXTURE/)).toBeNull();
    expect(screen.getByText(/NO RELAY PROJECTS YET/i)).toBeTruthy();
    // GitHub sign-in is DEFERRED — not shown until the user chooses to build.
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    // And the app itself is never shown at the entrance.
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('AC-2: choosing to start building reveals the contextual GitHub sign-in', async () => {
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    const startBuilding = await screen.findByRole('button', { name: /CONNECT EXISTING PROJECT/i });
    // Still no GitHub wall while exploring Wonderland.
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    // Choosing to start building is the deliberate exit into sign-in.
    fireEvent.click(startBuilding);
    expect(await screen.findByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('after sign-in, asks the user to connect a repository — the post-install picker, still not the app', async () => {
    signedIn();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        listRepositoriesImpl={emptyRepoList}
        discoverRepositoriesImpl={discoverAlice}
      >
        {APP}
      </RelayBetaEntry>,
    );
    // The connect step SELECTS a discovered repository — no owner/name typed.
    expect(await screen.findByRole('button', { name: /beta-alice\/their-app/i })).toBeTruthy();
    expect(screen.queryByLabelText(/Repository owner/i)).toBeNull();
    expect(screen.getByText(/Signed in as/i).textContent).toContain('ghu-4242');
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('clicks all the way through: signed in → SELECT a discovered repo → the Mission surface for that repo', async () => {
    signedIn();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        registerImpl={registerOk}
        listRepositoriesImpl={emptyRepoList}
        discoverRepositoriesImpl={discoverAlice}
        missionPspListImpl={emptyPspList}
        missionHistoryImpl={emptyHistory}
      >
        {APP}
      </RelayBetaEntry>,
    );
    // The post-install picker: select the discovered repository — no typing.
    fireEvent.click(await screen.findByRole('button', { name: /beta-alice\/their-app/i }));
    // The bridge confirms the registration → the gate advances to the Mission
    // surface for the connected repository (start/watch/ship), keyed to what was
    // registered.
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByText(/Start a Mission on/i).textContent).toContain('github:github.com/beta-alice/their-app');
  });

  it('AC-1: a full reload mid-Mission returns the signed-in user to the live Mission view, not the connect screen', async () => {
    signedIn();
    // First mount: sign in is already done; connect a repository and reach the
    // Mission surface.
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        registerImpl={registerOk}
        listRepositoriesImpl={emptyRepoList}
        discoverRepositoriesImpl={discoverAlice}
        missionPspListImpl={emptyPspList}
        missionHistoryImpl={emptyHistory}
      >
        {APP}
      </RelayBetaEntry>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /beta-alice\/their-app/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());

    // Simulate a FULL PAGE RELOAD: tear down the whole tree, keep only what
    // survives a reload (the session + the connected-repository pointer, both
    // in sessionStorage), then mount a completely fresh gate.
    cleanup();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        missionPspListImpl={emptyPspList}
        missionHistoryImpl={emptyHistory}
      >
        {APP}
      </RelayBetaEntry>,
    );

    // The fresh mount lands back on the live Mission view for the SAME
    // repository — never the "Connect a repository" screen.
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByText(/Start a Mission on/i).textContent).toContain('github:github.com/beta-alice/their-app');
    expect(screen.queryByRole('heading', { name: /Connect a repository/i })).toBeNull();
    expect(screen.queryByTestId('app')).toBeNull();
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
        discoverRepositoriesImpl={discoverAlice}
        missionStartImpl={start}
        missionPollImpl={poll}
        missionShipImpl={shipImpl}
        listRepositoriesImpl={emptyRepoList}
        missionPspListImpl={emptyPspList}
        missionHistoryImpl={emptyHistory}
      >
        {APP}
      </RelayBetaEntry>,
    );

    // Connect the repository by SELECTING it from the post-install picker.
    fireEvent.click(await screen.findByRole('button', { name: /beta-alice\/their-app/i }));

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

  it('WP-3: a returning participant SELECTS an already-connected repo — no re-install/register', async () => {
    signedIn();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        // No installation on the URL, and yet the user never needs the install
        // path — the picker offers what they already connected.
        listRepositoriesImpl={repoListOf(aliceRepo)}
        missionPspListImpl={emptyPspList}
        missionHistoryImpl={emptyHistory}
      >
        {APP}
      </RelayBetaEntry>,
    );

    // The picker lists the participant's own repository — the re-install path is
    // NOT the shown affordance.
    const select = await screen.findByRole('button', { name: /beta-alice\/their-app/i });
    expect(screen.queryByRole('button', { name: /Install the Relay app on GitHub/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Connect this repository/i })).toBeNull();
    expect(screen.getByText(/default branch/i).textContent).toContain('main');

    // Selecting it lands straight on the Mission surface for that repo — the
    // SAME repository key a fresh connect would have produced.
    fireEvent.click(select);
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(await screen.findByLabelText(/Objective/i)).toBeTruthy();
    expect(screen.getByText(/Start a Mission on/i).textContent).toContain('github:github.com/beta-alice/their-app');
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('WP-3: "Connect a different repository" from the picker opens the connect flow', async () => {
    signedIn();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        // An installation id is present, so the connect flow runs its post-install
        // step; with no repositories discovered it degrades to the manual fallback.
        readInstallationImpl={withInstall('55550001')}
        listRepositoriesImpl={repoListOf(aliceRepo)}
        discoverRepositoriesImpl={discoverEmpty}
      >
        {APP}
      </RelayBetaEntry>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Connect a different repository/i }));
    // The existing connect-repository flow — not the picker.
    expect(await screen.findByRole('button', { name: /Connect this repository/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /beta-alice\/their-app/i })).toBeNull();
  });

  it('WP-3: a signed-in participant with NO connected repositories sees the connect flow directly', async () => {
    signedIn();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        listRepositoriesImpl={emptyRepoList}
        discoverRepositoriesImpl={discoverEmpty}
      >
        {APP}
      </RelayBetaEntry>,
    );

    // Today's first-time behaviour, preserved: straight to connect, no returning-
    // participant picker. With nothing discovered, the manual fallback is inline.
    expect(await screen.findByRole('button', { name: /Connect this repository/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Connect a different repository/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Choose a repository/i })).toBeNull();
  });

  it('WP-3: a list-fetch FAILURE degrades to the connect flow, never a hard block, and states the reason', async () => {
    signedIn();
    const failing = (async () => ({
      ok: false as const, repositories: [], message: 'Your connected repositories could not be read.',
    })) as unknown as typeof listConnectedRepositories;
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        listRepositoriesImpl={failing}
        discoverRepositoriesImpl={discoverEmpty}
      >
        {APP}
      </RelayBetaEntry>,
    );

    // Never blocked on a list error — the connect flow is reachable.
    expect(await screen.findByRole('button', { name: /Connect this repository/i })).toBeTruthy();
    // The failure is surfaced non-fatally, never as an empty "you have no repos".
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /beta-alice\/their-app/i })).toBeNull();
  });

  it('WP-3: a REVOKED registration is never offered — an all-revoked list degrades to connect', async () => {
    signedIn();
    const revoked: ConnectedRepository = { ...aliceRepo, key: 'github:github.com/beta-alice/old-app', name: 'old-app', revoked: true };
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        readInstallationImpl={withInstall('55550001')}
        listRepositoriesImpl={repoListOf(revoked)}
        discoverRepositoriesImpl={discoverEmpty}
      >
        {APP}
      </RelayBetaEntry>,
    );

    expect(await screen.findByRole('button', { name: /Connect this repository/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /beta-alice\/old-app/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /Choose a repository/i })).toBeNull();
  });
});
