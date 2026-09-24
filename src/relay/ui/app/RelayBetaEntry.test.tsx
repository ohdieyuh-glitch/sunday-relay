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
import {
  EMPTY_DRAFT, activate, cardRef, clearAgentDraft, loadAgentDraft, projectMissionConfig, saveAgentDraft,
  startNewCompoundAgent, type CompoundAgentDraft,
} from '../relay-experience';
import { clearConnectedRepository, saveConnectedRepository } from './connected-repository';
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

afterEach(() => {
  cleanup(); clearBridgeSession(); clearActiveMissions();
  clearConnectedRepository(); clearAgentDraft();
  // THE ADDRESS IS STATE TOO, and it now decides which stage of the world opens.
  // A test that left `#/relay` behind would hand the next one a participant
  // standing somewhere it never put them.
  window.history.replaceState(null, '', '/');
});

/**
 * The participant is IN Relay — which, in a browser, means the address says so.
 * Arriving through the passage rewrites the hash to `#/relay`, so this is the
 * URL a real participant holds once they are past the landing, and the one a
 * reload restores them to.
 */
function inTheWorld() {
  window.history.replaceState(null, '', '#/relay');
}

const T0 = '2026-08-27T10:00:00.000Z';
const T1 = '2026-08-27T10:05:00.000Z';

/**
 * A participant who has already built their Compound Agent but not activated
 * it. Pair it with {@link inTheWorld}: the record says what they built, the URL
 * says where they are standing, and ACTIVATE RELAY is the control in front of
 * them — so a test about sign-in can start where sign-in becomes reachable
 * instead of replaying eight onboarding steps. The record alone is deliberately
 * NOT enough to place them: a stored draft used to decide the opening stage by
 * itself, which is how the public URL stopped answering with the public page.
 * The role ids are the product catalogue's — exactly what the world stores.
 */
function agentBuilt(overrides: Partial<CompoundAgentDraft> = {}): CompoundAgentDraft {
  return saveAgentDraft({
    ...EMPTY_DRAFT,
    name: 'Test Agent',
    promptArchitectId: 'architect-sunday-alcatraz',
    codingAgentId: 'coding-claude-code',
    reviewerId: 'reviewer-hermes',
    ...overrides,
  }, T0);
}

/** A participant whose Compound Agent is complete AND online: the C.A.R.D. every later surface runs under. */
function agentActivated(overrides: Partial<CompoundAgentDraft> = {}): CompoundAgentDraft {
  return saveAgentDraft(activate({
    ...EMPTY_DRAFT,
    name: 'Test Agent',
    promptArchitectId: 'architect-sunday-alcatraz',
    codingAgentId: 'coding-claude-code',
    reviewerId: 'reviewer-hermes',
    ...overrides,
  }, T0), T0);
}

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

  it('AC-1/AC-3: a fresh live user lands in the RELAY EXPERIENCE — GitHub is deferred, no simulated data', async () => {
    const { container } = render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    // The front door is the persistent 3D scene, entered at Aquala.
    await waitFor(() => expect(container.querySelector('.rw')).toBeTruthy());
    expect(container.querySelectorAll('canvas.rw-canvas')).toHaveLength(1);
    // AC-3: no simulated data on the live front door.
    expect(screen.queryByText(/FIXTURE/)).toBeNull();
    // GitHub sign-in is DEFERRED — not shown until the Agent is brought online.
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    // And the demo/preview shell is never shown while the gate is live.
    expect(screen.queryByTestId('app')).toBeNull();
  });

  /**
   * THE SUPERSEDED SHELL IS NOT THE FRONT DOOR.
   *
   * `RelayWonderlandEntrance` wrapped the Entry Home, and for a while it was
   * what a live participant saw first — which meant production served the old
   * shell no matter what the demo build rendered. This asserts the markers of
   * that shell are absent from the live entrance, so the two builds cannot
   * drift apart again without a test saying so.
   */
  it('never renders the superseded Entry Home shell as the live front door', async () => {
    const { container } = render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    await waitFor(() => expect(container.querySelector('.rw')).toBeTruthy());
    expect(container.querySelector('.reh')).toBeNull();
    for (const marker of ['What are we building', 'WANDERING', 'RELAY DOG', 'NO RELAY PROJECTS YET']) {
      expect(container.innerHTML, `the live front door still shows "${marker}"`).not.toContain(marker);
    }
  });

  /**
   * THE AUTH GATE IS NOT THE ROOT STATE OF THE SITE.
   *
   * FOUNDER (2026-09-24): "A user who decides not to authenticate must be able
   * to return to the normal Wonderland landing page. The GitHub authentication
   * gate may protect ENTRY INTO WONDERLAND. It must NOT permanently trap the
   * entire public Wonderland website."
   *
   * Reproduced on the deployed site before it was fixed: activate a Compound
   * Agent, decline to sign in, and every route back — refresh, reopen, or type
   * the bare public URL — returned the same GitHub screen, which carried no
   * control that went anywhere else. Nothing was wrong with the session logic:
   * there was no session. What persisted was the RECORD of an activation, and
   * two places read it as a decision to authenticate.
   *
   * These tests separate the four states the interface has to keep apart —
   * public, entry requested, signed in, and abandoned — and they are written
   * against the LOADS a person actually performs, because "refresh" and "open
   * the URL again" are exactly the two things a trapped user will try.
   */
  describe('an attempt to authenticate is not an authentication', () => {
    it('does not open the GitHub wall for an Agent activated on a previous visit', async () => {
      // THE TRAP, EXACTLY. This record is what the browser held: complete, online
      // and nobody's — the state a visitor is left in by declining to sign in.
      agentActivated();
      inTheWorld();
      const { container } = render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
      await waitFor(() => expect(container.querySelector('.rw')).toBeTruthy());
      expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
      // And the way on is offered, not taken on their behalf.
      expect(await screen.findByRole('button', { name: /ENTER WONDERLAND/i })).toBeTruthy();
    });

    it('answers the bare public URL with the public landing, activated record or not', async () => {
      // CASE E: abandon the attempt, come back to the address on the business
      // card. The landing is the front door and stays the front door; the world
      // is continuous, so this is the arrival beat, not a different site.
      agentActivated();
      const { container } = render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
      await waitFor(() => expect(container.querySelector('.rw')).toBeTruthy());
      expect(container.querySelector('.rw')?.getAttribute('data-stage')).toBe('aquala');
      expect(screen.getAllByRole('button', { name: /ENTER RELAY/i }).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    });

    it('does not restore the sign-in screen across a reload — the attempt lives in the tab, not in storage', async () => {
      // CASE D. The remount IS the refresh: a reload destroys React state and
      // rebuilds the interface from whatever survived it. Nothing about an
      // unfinished attempt may survive it, which is why `phase` is plain state
      // and why no effect writes it anywhere durable.
      inTheWorld();
      agentBuilt();
      render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
      fireEvent.click(await screen.findByRole('button', { name: /ACTIVATE RELAY/i }));
      fireEvent.click(await screen.findByRole('button', { name: /ENTER WONDERLAND/i }));
      expect(await screen.findByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();

      cleanup();
      const { container } = render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
      await waitFor(() => expect(container.querySelector('.rw')).toBeTruthy());
      expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    });

    it('offers a way back OUT of the sign-in screen, and it returns to the public landing', async () => {
      // CASE C. Declining is an ordinary decision. The screen that asks must not
      // be the only screen that answers.
      inTheWorld();
      agentActivated();
      const { container } = render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
      fireEvent.click(await screen.findByRole('button', { name: /ENTER WONDERLAND/i }));
      expect(await screen.findByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();

      const back = screen.getByRole('button', { name: /Back to Wonderland/i });
      fireEvent.click(back);
      await waitFor(() => expect(container.querySelector('.rw')).toBeTruthy());
      expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
      // The URL agrees with the screen, so a reload does not disagree with it.
      expect(window.location.hash).toBe('');
      expect(container.querySelector('.rw')?.getAttribute('data-stage')).toBe('aquala');
    });

    it('signs nobody out and loses no work on the way back', async () => {
      // CLEAR THE TRANSIENT, AND ONLY THE TRANSIENT. A cleanup that reached the
      // C.A.R.D. or a legitimate session would turn "I would rather not sign in
      // right now" into lost work, which is a worse bug than the one being fixed.
      inTheWorld();
      const built = agentActivated({ name: 'Keeper' });
      render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
      fireEvent.click(await screen.findByRole('button', { name: /ENTER WONDERLAND/i }));
      fireEvent.click(await screen.findByRole('button', { name: /Back to Wonderland/i }));
      const after = loadAgentDraft();
      expect(after.name).toBe('Keeper');
      expect(after.cardId).toBe(built.cardId);
      expect(after.revision).toBe(built.revision);
      expect(after.activatedAt).not.toBeNull();
    });

    it('still lets a SIGNED-IN participant straight through — the gate protects what it always protected', async () => {
      // CASE G. The bug belonged to people who are not authenticated. Nothing
      // here loosens the gate: a real session still reaches the repository step,
      // and an unauthenticated visitor still cannot.
      agentActivated();
      signedIn();
      render(
        <RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete} listRepositoriesImpl={emptyRepoList}>
          {APP}
        </RelayBetaEntry>,
      );
      expect(await screen.findByText(/Connect a repository/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
      expect(screen.queryByTestId('app')).toBeNull();
    });
  });

  it('AC-2: ASKING TO ENTER reveals sign-in DIRECTLY — no second configuration stage, and GitHub is never the entrance', async () => {
    inTheWorld();
    agentBuilt();
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    const activateRelay = await screen.findByRole('button', { name: /ACTIVATE RELAY/i });
    // Still no GitHub wall while the participant is in the world.
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    fireEvent.click(activateRelay);
    // ACTIVATION IS NOT A REQUEST TO ENTER. It used to be read as one: the gate
    // advanced to GitHub the instant the world reported an online Agent, and the
    // world reports one it read out of storage — so the wall came back on every
    // later visit and the public site was unreachable behind it. Bringing the
    // Agent online leaves the participant in the world, looking at their Agent.
    expect(await screen.findByRole('button', { name: /ENTER WONDERLAND/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    // ASKING to enter is what reveals it, and what follows is the contextual
    // sign-in — never a screen asking for the same values again.
    fireEvent.click(screen.getByRole('button', { name: /ENTER WONDERLAND/i }));
    expect(await screen.findByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();
    expect(screen.queryByText(/Edit your C.A.R.D./i)).toBeNull();
    expect(screen.queryByLabelText('Execution mode')).toBeNull();
    expect(screen.queryByTestId('app')).toBeNull();
  });

  it('THE SEAM, CLOSED: the C.A.R.D. built in the world is the ONE configuration — it survives the OAuth reload and reaches the Mission unchanged, with no second setup', async () => {
    // The participant chose their C.A.R.D. in the world: autonomous, $3, 90 min, network blocked.
    inTheWorld();
    agentBuilt({ mode: 'autonomous', spendUsd: 3, runtimeMinutes: 90, network: 'blocked' });
    render(<RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete}>{APP}</RelayBetaEntry>);
    fireEvent.click(await screen.findByRole('button', { name: /ACTIVATE RELAY/i }));
    fireEvent.click(await screen.findByRole('button', { name: /ENTER WONDERLAND/i }));
    // Straight to sign-in. Nothing asks for the same values again, and no
    // default is shown in their place.
    expect(await screen.findByRole('button', { name: /Sign in with GitHub/i })).toBeTruthy();
    expect(screen.queryByText(/Edit your C.A.R.D./i)).toBeNull();
    expect(screen.queryByLabelText('Execution mode')).toBeNull();
    expect(screen.queryByText(/Default beta configuration/i)).toBeNull();
    // The record is persisted, addressable, and not yet anyone's.
    const stored = loadAgentDraft();
    expect(stored.activatedAt).not.toBeNull();
    expect(stored.revision).toBeGreaterThan(0);
    expect(stored.cardId).toMatch(/^card-/);
    expect(stored.participantId).toBeNull();

    // SIMULATE THE FULL OAUTH ROUND-TRIP: the redirect destroys React state, and
    // the return is a fresh document load. The session (now signed in) and the
    // connected repository are restored; the C.A.R.D. is in its durable store.
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

    // Claimed for the signed-in participant and named truthfully — never
    // "Default beta configuration" over the C.A.R.D. they configured.
    expect((await screen.findByText(/Running under/i)).textContent).toContain('C.A.R.D. Test Agent · revision');
    expect(screen.getByText(/Running under/i).textContent).not.toContain('Default beta configuration');
    expect(loadAgentDraft().participantId).toBe('ghu-4242');
    // The requested view shows what they chose — the catalogue's own names.
    const agent = screen.getByLabelText('Active C.A.R.D.').textContent ?? '';
    expect(agent).toContain('Claude Code');
    expect(agent).toContain('autonomous');
    // What the request does NOT carry is said next to what it does.
    expect(agent).toContain('Not carried by the Mission request');
    expect(agent).toContain('network blocked');
    expect(agent).toMatch(/Provenance: revision \d+ of your C\.A\.R\.D\./);

    // Straight to the runner for the connected repo, and its Start carries the
    // C.A.R.D. — autonomous, $3, 90 min, the roles they picked — never a default.
    fireEvent.change(await screen.findByLabelText(/Objective/i), { target: { value: 'Build it' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    const config = start.mock.calls[0][0].config as {
      mode?: string; pspId?: string | null;
      limits?: { spendUsd?: number | null; runtimeMinutes?: number | null };
      roles?: { architect?: string | null; coding?: string | null; reviewer?: string | null };
    };
    expect(config.mode).toBe('autonomous');
    expect(config.limits?.spendUsd).toBe(3);
    expect(config.limits?.runtimeMinutes).toBe(90);
    expect(config.roles).toEqual({ architect: 'architect-sunday-alcatraz', coding: 'coding-claude-code', reviewer: 'reviewer-hermes' });
    // ONE SOURCE: what was sent IS the projection of the stored record. Nothing
    // was copied into a second store on the way — the old one no longer exists.
    expect(config).toEqual(projectMissionConfig(loadAgentDraft()));
    expect(config.pspId).toBe(cardRef(loadAgentDraft()));
    expect(sessionStorage.getItem('sunday-relay.configured-psp')).toBeNull();
  });

  it('after sign-in, asks the user to connect a repository — the post-install picker, still not the app', async () => {
    signedIn();
    agentActivated(); // a repository is connected TO an Agent that already exists
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
    agentActivated({ mode: 'guided' });
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
    agentActivated({ mode: 'guided' });
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
    agentActivated({ mode: 'guided' });
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
    agentActivated({ mode: 'guided' });
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
    agentActivated(); // a repository is connected TO an Agent that already exists
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
    agentActivated(); // a repository is connected TO an Agent that already exists
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
    agentActivated(); // a repository is connected TO an Agent that already exists
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
    agentActivated(); // a repository is connected TO an Agent that already exists
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
    agentActivated({ mode: 'guided' });
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
    // They were NOT dropped into an edit surface, and nothing asked them to configure again.
    expect(screen.queryByText(/Edit your C.A.R.D./i)).toBeNull();
    expect(screen.queryByLabelText('Execution mode')).toBeNull();
    expect(screen.getByText(/Running under/i).textContent).toContain('C.A.R.D. Test Agent · revision 1');
  });

  it('WP-2 NO C.A.R.D.: a signed-in participant without one builds it in the world — nothing is defaulted, nothing dispatches', async () => {
    signedIn();
    saveConnectedRepository('github:github.com/beta-alice/their-app');
    // Deliberately NO C.A.R.D. — session restored, but no Compound Agent.
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
    // The world at the Relay stage, step one — where every C.A.R.D. is created.
    // Not the runner, not an edit surface, not a default Agent.
    expect(await screen.findByText(/Create your Compound Agent/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start Mission/i })).toBeNull();
    expect(screen.queryByLabelText(/Objective/i)).toBeNull();
    expect(screen.queryByText(/Default beta configuration/i)).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('WP-2 BUILT, NOT ONLINE: a signed-in participant resumes at ACTIVATE RELAY; activating claims the C.A.R.D. and continues to the repository', async () => {
    signedIn();
    agentBuilt();
    render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        listRepositoriesImpl={emptyRepoList}
        discoverRepositoriesImpl={discoverEmpty}
      >
        {APP}
      </RelayBetaEntry>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /ACTIVATE RELAY/i }));
    expect(await screen.findByText(/Connect a repository/i)).toBeTruthy();
    const record = loadAgentDraft();
    expect(record.activatedAt).not.toBeNull();
    expect(record.participantId).toBe('ghu-4242');
  });

  it('WP-2 EDIT C.A.R.D.: from the runner, Edit opens the SAME C.A.R.D. hydrated, Save writes a new revision and returns — repo kept, no sign-in', async () => {
    signedIn();
    agentActivated({ mode: 'guided' });
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
    // On the runner with the current (guided, revision 1) C.A.R.D.
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByLabelText('Active C.A.R.D.').textContent).toContain('guided');
    expect(screen.getByText(/Running under/i).textContent).toContain('revision 1');

    // Edit → the dedicated surface, NOT sign-in — hydrated from the record.
    fireEvent.click(screen.getByRole('button', { name: /Edit C.A.R.D./i }));
    expect(await screen.findByText(/Edit your C.A.R.D./i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
    expect((screen.getByLabelText('Execution mode') as HTMLSelectElement).value).toBe('guided');
    expect(screen.queryByText(/Default beta configuration/i)).toBeNull();

    // Change a field and Save — it persists first, then returns.
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'autonomous' } });
    fireEvent.click(screen.getByRole('button', { name: /Save C.A.R.D./i }));

    // Back on the runner for the SAME repo, showing the UPDATED C.A.R.D. — revision 2.
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByText(/Start a Mission on/i).textContent).toContain('github:github.com/beta-alice/their-app');
    expect(screen.getByLabelText('Active C.A.R.D.').textContent).toContain('autonomous');
    expect(screen.getByText(/Running under/i).textContent).toContain('revision 2');
    const record = loadAgentDraft();
    expect(record.mode).toBe('autonomous');
    expect(record.revision).toBe(2);
  });

  it('STALE REVISION: a Mission never starts under a C.A.R.D. revision the store has moved past', async () => {
    signedIn();
    agentActivated({ mode: 'guided' });
    saveConnectedRepository('github:github.com/beta-alice/their-app');
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-stale', view: codingView, message: null }));
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
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    expect(screen.getByText(/Running under/i).textContent).toContain('revision 1');
    // Another tab (or an edit) moved the record on: revision 2.
    saveAgentDraft({ ...loadAgentDraft(), spendUsd: 1 }, T1);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'Build it' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    // Refused — nothing dispatched under revision 1 — and the current record reloaded.
    await waitFor(() => expect(screen.getByText(/changed \(revision 1 → 2\)/i)).toBeTruthy());
    expect(start).not.toHaveBeenCalled();
    expect(screen.getByText(/Running under/i).textContent).toContain('revision 2');
  });

  it('WRONG PARTICIPANT: a C.A.R.D. claimed by someone else never runs, is never edited, and is never inherited', async () => {
    agentActivated({ participantId: 'ghu-1' });
    signedIn(); // ghu-4242
    saveConnectedRepository('github:github.com/beta-alice/their-app');
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-wp', view: codingView, message: null }));
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
    expect((await screen.findByRole('alert')).textContent).toMatch(/belongs to a different participant/i);
    expect(screen.queryByRole('button', { name: /Start Mission/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit C.A.R.D./i })).toBeNull();
    expect(loadAgentDraft().participantId).toBe('ghu-1'); // untouched
    // The only way forward is explicit — and it inherits nothing.
    fireEvent.click(screen.getByRole('button', { name: /Create a new Compound Agent/i }));
    expect(await screen.findByText(/Create your Compound Agent/i)).toBeTruthy();
    const fresh = loadAgentDraft();
    expect(fresh.participantId).toBe('ghu-4242');
    expect(fresh.name).toBe('');
    expect(fresh.activatedAt).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('TERM HYGIENE: the live journey never shows the internal name "PSP" — the product configuration is the C.A.R.D.', async () => {
    signedIn();
    agentActivated({ mode: 'guided' });
    saveConnectedRepository('github:github.com/beta-alice/their-app');
    const { container } = render(
      <RelayBetaEntry
        bridgeUrl={BRIDGE}
        completeImpl={noComplete}
        missionPspListImpl={emptyPspList}
        missionHistoryImpl={emptyHistory}
      >
        {APP}
      </RelayBetaEntry>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    const visible = () => {
      const labels = Array.from(container.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label') ?? '');
      return `${container.textContent ?? ''}\n${labels.join('\n')}`;
    };
    expect(visible()).not.toMatch(/\bPSP\b/);
    fireEvent.click(screen.getByRole('button', { name: /Edit C.A.R.D./i }));
    await screen.findByText(/Edit your C.A.R.D./i);
    expect(visible()).not.toMatch(/\bPSP\b/);
  });

  it('NEW C.A.R.D. from the runner: the same Compound Agent, a fresh operating profile, back in the world on the C.A.R.D. step', async () => {
    signedIn();
    const first = agentActivated({ mode: 'autonomous', spendUsd: 3 });
    saveConnectedRepository('github:github.com/beta-alice/their-app');
    render(
      <RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete} missionPspListImpl={emptyPspList} missionHistoryImpl={emptyHistory}>
        {APP}
      </RelayBetaEntry>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /New C\.A\.R\.D\./i }));
    // The world, on STEP 05 — the C.A.R.D. — for the same Agent.
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('C.A.R.D.');
    expect(screen.queryByRole('button', { name: /Start Mission/i })).toBeNull();
    const fresh = loadAgentDraft();
    expect(fresh.agentId).toBe(first.agentId);
    expect(fresh.cardId).not.toBe(first.cardId);
    expect(fresh.name).toBe('Test Agent');
    expect(fresh.mode).toBe(EMPTY_DRAFT.mode);
    expect(fresh.spendUsd).toBe(EMPTY_DRAFT.spendUsd);
    expect(fresh.activatedAt).toBeNull();
    expect(fresh.participantId).toBe('ghu-4242');
  });

  it('NEW COMPOUND AGENT from the runner: inherits nothing, owned by the signed-in participant, back in the world on step one', async () => {
    signedIn();
    const first = agentActivated({ mode: 'autonomous' });
    saveConnectedRepository('github:github.com/beta-alice/their-app');
    render(
      <RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete} missionPspListImpl={emptyPspList} missionHistoryImpl={emptyHistory}>
        {APP}
      </RelayBetaEntry>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /New Compound Agent/i }));
    expect(await screen.findByText(/Create your Compound Agent/i)).toBeTruthy();
    const fresh = loadAgentDraft();
    expect(fresh.agentId).not.toBe(first.agentId);
    expect(fresh.cardId).not.toBe(first.cardId);
    expect(fresh.name).toBe('');
    expect(fresh.promptArchitectId).toBeNull();
    expect(fresh.mode).toBe(EMPTY_DRAFT.mode);
    expect(fresh.participantId).toBe('ghu-4242');
  });

  it('WRONG AGENT: a Mission never starts under a C.A.R.D. of a Compound Agent that is no longer the active one', async () => {
    signedIn();
    agentActivated({ mode: 'guided' });
    saveConnectedRepository('github:github.com/beta-alice/their-app');
    const start = vi.fn<typeof startBetaMission>(async () => ({ ok: true, missionId: 'm-wa', view: codingView, message: null }));
    render(
      <RelayBetaEntry bridgeUrl={BRIDGE} completeImpl={noComplete} missionStartImpl={start} missionPspListImpl={emptyPspList} missionHistoryImpl={emptyHistory}>
        {APP}
      </RelayBetaEntry>,
    );
    await waitFor(() => expect(screen.getByRole('button', { name: /Start Mission/i })).toBeTruthy());
    // Another tab created — and activated — a different Compound Agent.
    const other = saveAgentDraft(activate({ ...startNewCompoundAgent(T1, 'ghu-4242'), name: 'Other', promptArchitectId: 'architect-sunday-alcatraz', codingAgentId: 'coding-claude-code', reviewerId: 'reviewer-hermes' }, T1), T1);
    fireEvent.change(screen.getByLabelText(/Objective/i), { target: { value: 'Build it' } });
    fireEvent.click(screen.getByRole('button', { name: /Start Mission/i }));
    await waitFor(() => expect(screen.getByText(/A different C\.A\.R\.D\. is active now/i)).toBeTruthy());
    expect(start).not.toHaveBeenCalled();
    // The runner now follows the record that is actually active.
    expect(screen.getByText(/Running under/i).textContent).toContain(`C.A.R.D. Other · revision ${other.revision}`);
  });
});
