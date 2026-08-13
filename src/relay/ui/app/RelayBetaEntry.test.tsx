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
import { clearConnectedRepository, saveConnectedRepository } from './connected-repository';
import { clearConfiguredPsp, loadConfiguredPsp, saveConfiguredPsp } from './configured-psp';
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

afterEach(() => { cleanup(); clearBridgeSession(); clearActiveMissions(); clearConnectedRepository(); clearConfiguredPsp(); });

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

  it('AC-2: choosing to start building reveals CONFIGURE first, then sign-in — GitHub is never the entrance', async () => {
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    const startBuilding = await screen.findByRole('button', { name: /CONNECT EXISTING PROJECT/i });
    // Still no GitHub wall while exploring Wonderland.
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    // Choosing to start building lands on the CONFIGURE step — the Compound PSP
    // Agent is configured BEFORE any GitHub. Sign-in is not shown yet.
    fireEvent.click(startBuilding);
    expect(await screen.findByText(/Configure your Compound PSP Agent/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    // Continuing from Configure (its own Start Building) reveals the sign-in.
    fireEvent.click(screen.getByRole('button', { name: /Start Building/i }));
    expect(await screen.findByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('AC-4/AC-5: a config set BEFORE sign-in survives the OAuth reload and reaches the runner unchanged', async () => {
    // A fresh participant configures the Agent, diverging from the default.
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    fireEvent.click(await screen.findByRole('button', { name: /CONNECT EXISTING PROJECT/i }));
    fireEvent.change(await screen.findByLabelText('Execution mode'), { target: { value: 'autonomous' } });
    fireEvent.change(screen.getByLabelText('Spend ceiling (USD)'), { target: { value: '3' } });
    // Start Building persists the configured Agent before the (redirecting) sign-in.
    fireEvent.click(screen.getByRole('button', { name: /Start Building/i }));
    expect((loadConfiguredPsp() as { mode?: string }).mode).toBe('autonomous');

    // SIMULATE THE FULL OAUTH ROUND-TRIP: the redirect destroys React state, and
    // the return is a fresh document load. Only sessionStorage survives — the
    // session (now signed in), the connected repository, and the configured PSP.
    // Nothing in the sign-in/install/discovery/select path cleared it (AC-5).
    cleanup();
    signedIn();
    saveConnectedRepository('github:github.com/beta-alice/their-app');

    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-cfg', view: codingView, message: null }));
    const poll = vi.fn<typeof pollBetaMission>(async () => ({ ok: true, missionId: 'm-cfg', view: codingView, message: null }));
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        missionStartImpl={start}
        missionPollImpl={poll}
        missionPspListImpl={emptyPspList}
        missionHistoryImpl={emptyHistory}
      >
        {APP}
      </RelayBetaEntry>,
    );

    // TRUTHFUL LABEL (F1): the runner names the rehydrated custom Agent honestly —
    // never "Default beta configuration" over a config that is autonomous + $3.
    expect((await screen.findByText(/Running under/i)).textContent).toContain('Your configured Agent');
    expect(screen.getByText(/Running under/i).textContent).not.toContain('Default beta configuration');

    // Straight to the runner for the connected repo, and its Start carries the
    // CONFIGURED Agent — autonomous + the $3 ceiling — never DEFAULT_BETA_CONFIG.
    fireEvent.change(await screen.findByLabelText(/Objective/i), { target: { value: 'Build it' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const config = start.mock.calls[0][0].config as { mode?: string; limits?: { spendUsd?: number | null } };
    expect(config.mode).toBe('autonomous');
    expect(config.limits?.spendUsd).toBe(3);
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
    // This participant configured their Agent before Start Building; without it the
    // runner would (correctly) fail closed. The persisted Agent is what lets them
    // reach Start Mission.
    saveConfiguredPsp({ mode: 'guided' });
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
    saveConfiguredPsp({ mode: 'guided' });
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
    // The participant configured a guided Agent before connecting the repository.
    saveConfiguredPsp({ mode: 'guided' });
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
    saveConfiguredPsp({ mode: 'guided' });
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

  it('WP-2 RETURNING USER: signed in WITH a valid Agent + connected repo lands on the runner, NOT Configure', async () => {
    signedIn();
    // A returning participant: their Agent already exists and their repo is
    // connected. They must NOT be forced back through Configure.
    saveConfiguredPsp({ mode: 'guided' });
    saveConnectedRepository('github:github.com/beta-alice/their-app');
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
    // Straight to the runner for their repo — Start Mission is available.
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByText(/Start a Mission on/i).textContent).toContain('github:github.com/beta-alice/their-app');
    // They were NOT dropped into the Configure surface.
    expect(screen.queryByText(/Configure your Compound PSP Agent/i)).toBeNull();
  });

  it('WP-2 FAIL-CLOSED: signed in with a connected repo but NO Agent cannot start a Mission', async () => {
    signedIn();
    saveConnectedRepository('github:github.com/beta-alice/their-app');
    // Deliberately NO saveConfiguredPsp — session restored, but no valid Agent.
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-fc', view: codingView, message: null }));
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        missionStartImpl={start}
        missionPspListImpl={emptyPspList}
        missionHistoryImpl={emptyHistory}
      >
        {APP}
      </RelayBetaEntry>,
    );
    // The runner is reached (repo is connected) but FAILS CLOSED: the honest
    // message, no Start Mission, and no silent default Agent.
    expect((await screen.findByRole('alert')).textContent).toMatch(/No Compound PSP Agent is configured/i);
    expect(screen.queryByRole('button', { name: /Start Mission/i })).toBeNull();
    expect(screen.queryByLabelText(/Objective/i)).toBeNull();
    // Both escape hatches are offered.
    expect(screen.getByRole('button', { name: /Configure Agent/i })).toBeTruthy();
    expect(screen.getByLabelText(/Configuration \(PSP\)/i)).toBeTruthy();
    // Nothing was ever dispatched.
    expect(start).not.toHaveBeenCalled();
  });

  it('WP-2 RECONFIGURE: from the runner, Reconfigure opens Configure, Save Agent persists + returns with the UPDATED Agent — repo kept, no sign-in', async () => {
    signedIn();
    saveConfiguredPsp({ mode: 'guided' });
    saveConnectedRepository('github:github.com/beta-alice/their-app');
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
    // On the runner with the current (guided) Agent.
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByLabelText('Configured Compound PSP Agent').textContent).toContain('guided');

    // Reconfigure → the dedicated Configure surface, NOT sign-in.
    fireEvent.click(screen.getByRole('button', { name: /Reconfigure Agent/i }));
    expect(await screen.findByText(/Configure your Compound PSP Agent/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();

    // Change a field and Save Agent — it persists first, then returns.
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'autonomous' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Agent/i }));

    // Back on the runner for the SAME repo, showing the UPDATED Agent.
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByText(/Start a Mission on/i).textContent).toContain('github:github.com/beta-alice/their-app');
    expect(screen.getByLabelText('Configured Compound PSP Agent').textContent).toContain('autonomous');
    // And the durable pointer carries the change.
    expect((loadConfiguredPsp() as { mode?: string }).mode).toBe('autonomous');
  });
});
