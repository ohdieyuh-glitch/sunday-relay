import { useEffect, useState, type ReactNode } from 'react';

import {
  completeGitHubSignIn, configuredBridgeUrl, loadBridgeSession,
  beginRepositoryInstall, registerRepository, readInstallationFromReturn,
} from './bridge-session';
import { RelayGitHubSignIn } from './RelayGitHubSignIn';
import { RelayConnectRepository } from './RelayConnectRepository';
import { RelayWonderlandEntrance } from './RelayWonderlandEntrance';
import { RelayConfigureAgent } from './RelayConfigureAgent';
import { RelayMissionRunner } from './RelayMissionRunner';
import { loadConnectedRepository, saveConnectedRepository } from './connected-repository';
import { loadConfiguredPsp } from './configured-psp';
import { listConnectedRepositories, discoverInstallationRepositories, type ConnectedRepository } from './repository-client';
import type { startBetaMission, pollBetaMission, shipBetaMission, listBetaMissions } from './beta-mission';
import type { listPsps, loadPsp, savePsp } from './psp-client';

/**
 * THE BETA ENTRY GATE — the front door of the private beta.
 *
 * When a live Relay Bridge is configured, a fresh user signs in and connects a
 * repository before reaching the app: the SAME journey the API enforces, now the
 * thing a user actually clicks. When NO bridge is configured — the demo/preview
 * build, and every test that does not opt in — the gate is TRANSPARENT: it renders
 * its children unchanged, so nothing about the offline product moves and no
 * existing screen is disturbed.
 *
 * It announces facts, not intentions: it resolves the session before deciding
 * what to show, gates on a real session, and advances to the app only once the
 * bridge has confirmed a connected repository.
 */
export function RelayBetaEntry({
  children,
  bridgeUrl,
  completeImpl = completeGitHubSignIn,
  installBeginImpl = beginRepositoryInstall,
  registerImpl = registerRepository,
  readInstallationImpl = readInstallationFromReturn,
  listRepositoriesImpl = listConnectedRepositories,
  discoverRepositoriesImpl = discoverInstallationRepositories,
  missionStartImpl,
  missionPollImpl,
  missionShipImpl,
  missionPspListImpl,
  missionPspLoadImpl,
  missionPspSaveImpl,
  missionHistoryImpl,
}: {
  readonly children: ReactNode;
  readonly bridgeUrl?: string | null;
  readonly completeImpl?: typeof completeGitHubSignIn;
  readonly installBeginImpl?: typeof beginRepositoryInstall;
  readonly registerImpl?: typeof registerRepository;
  readonly readInstallationImpl?: typeof readInstallationFromReturn;
  readonly listRepositoriesImpl?: typeof listConnectedRepositories;
  readonly discoverRepositoriesImpl?: typeof discoverInstallationRepositories;
  readonly missionStartImpl?: typeof startBetaMission;
  readonly missionPollImpl?: typeof pollBetaMission;
  readonly missionShipImpl?: typeof shipBetaMission;
  readonly missionPspListImpl?: typeof listPsps;
  readonly missionPspLoadImpl?: typeof loadPsp;
  readonly missionPspSaveImpl?: typeof savePsp;
  readonly missionHistoryImpl?: typeof listBetaMissions;
}) {
  const resolvedBridge = bridgeUrl !== undefined ? bridgeUrl : configuredBridgeUrl();
  // With no bridge there is nothing to resolve — ready immediately, and transparent.
  const [ready, setReady] = useState(resolvedBridge === null);
  const [participant, setParticipant] = useState<string | null>(() => loadBridgeSession()?.participantId ?? null);
  // Reconnect: a full reload mid-Mission restores the connected repository the
  // same way the session and the active-mission pointer are restored, so the
  // signed-in user lands back on the live Mission surface (which re-reads
  // authoritative state) instead of the "Connect a repository" screen.
  const [connectedKey, setConnectedKey] = useState<string | null>(() => loadConnectedRepository());
  // A RETURNING participant (criterion 2 "select"): once signed in with no
  // reconnect pointer, ask the bridge which repositories they already connected
  // so they SELECT one instead of re-installing. `loading` is a truthful pending
  // state — never an empty "connect" flash while the list is in flight. A list
  // that refuses or fails leaves `repositories` empty and carries the reason, so
  // the gate degrades to the first-time connect flow rather than blocking on it.
  const [repoChoices, setRepoChoices] = useState<{
    readonly status: 'loading' | 'ready';
    readonly repositories: readonly ConnectedRepository[];
    readonly message: string | null;
  }>({ status: 'loading', repositories: [], message: null });
  // The user asked to connect a DIFFERENT repository than the ones listed — the
  // existing connect flow, reached on demand from the picker.
  const [connectingNew, setConnectingNew] = useState(false);
  // THE CANONICAL FLOW: Wonderland → CONFIGURE the Compound PSP Agent → sign-in.
  // A fresh live participant begins in Wonderland with the Wandering Relay Dog;
  // choosing to start building advances to the pre-GitHub Configure step (which
  // persists the Agent to sessionStorage so it survives the OAuth redirect), and
  // only THEN does the contextual GitHub sign-in appear. GitHub is never the
  // entrance, and the Agent is always configured before any repository connects.
  const [phase, setPhase] = useState<'wonderland' | 'configure' | 'signin'>('wonderland');
  // The active Compound PSP Agent, rehydrated on mount and RE-READABLE thereafter.
  // The Configure step wrote it to sessionStorage before the redirect, and a fresh
  // mount reads it back here — exactly as connectedKey is rehydrated from
  // loadConnectedRepository(). It MAY be null: a signed-in participant who has not
  // configured one has NO Agent, and we FAIL CLOSED rather than silently defaulting
  // (founder rule A). The runner refuses to start a Mission without a valid Agent.
  // It is a REQUEST the runner forwards; the bridge stays the authority for what
  // actually runs. Note on the seam (founder rule E): `configured-psp` is
  // sessionStorage — browser-FLOW continuity across the OAuth/install redirect, NOT
  // the durable source of truth for PSP/Project Brain identity, which lands later.
  const [configuredAgent, setConfiguredAgent] = useState<unknown>(() => loadConfiguredPsp());
  const missionConfig = configuredAgent;
  // The label matters only when an Agent exists; the fail-closed state shows no
  // "running under" line, so a null Agent needs no label. A rehydrated custom
  // Agent must never render as "Default beta configuration".
  const missionConfigLabel = configuredAgent !== null ? 'Your configured Agent' : undefined;
  // RECONFIGURE (founder rules B/C): a signed-in participant may re-open the
  // dedicated Configure surface from the runner WITHOUT re-signing-in or losing the
  // connected repo. This is distinct from `phase` (which only governs the
  // pre-sign-in journey): it applies AFTER sign-in, in the runner branch.
  const [reconfiguring, setReconfiguring] = useState(false);

  useEffect(() => {
    if (resolvedBridge === null) return undefined;
    let cancelled = false;
    void (async () => {
      // Finish a sign-in that redirected back with a claim, then read the session.
      await completeImpl({ bridgeUrl: resolvedBridge });
      if (cancelled) return;
      setParticipant(loadBridgeSession()?.participantId ?? null);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, [completeImpl, resolvedBridge]);

  // Fetch the participant's connected repositories once signed in — but ONLY
  // when no reconnect pointer already decides the view. The persisted key (WP-1)
  // takes precedence: a reload mid-flow lands straight on the live Mission and
  // never triggers this fetch.
  useEffect(() => {
    if (resolvedBridge === null || !ready || participant === null || connectedKey !== null) return undefined;
    let cancelled = false;
    setRepoChoices({ status: 'loading', repositories: [], message: null });
    void (async () => {
      const result = await listRepositoriesImpl({ bridgeUrl: resolvedBridge });
      if (cancelled) return;
      setRepoChoices({
        status: 'ready',
        repositories: result.ok ? result.repositories : [],
        message: result.ok ? null : result.message,
      });
    })();
    return () => { cancelled = true; };
  }, [resolvedBridge, ready, participant, connectedKey, listRepositoriesImpl]);

  // Demo/preview build: the gate does nothing at all.
  if (resolvedBridge === null) return <>{children}</>;

  if (!ready) {
    return <div className="relay-beta-entry" data-state="resolving"><p>Connecting to Relay…</p></div>;
  }

  if (participant === null) {
    // The Wonderland entrance, NOT a GitHub wall: the fresh participant explores
    // here with the Wandering Relay Dog until they choose to start building.
    if (phase === 'wonderland') {
      // "Start building" from Wonderland advances to CONFIGURE, not sign-in: the
      // Compound PSP Agent is set up BEFORE any GitHub, per the canonical flow.
      return <RelayWonderlandEntrance onStartBuilding={() => setPhase('configure')} />;
    }
    // CONFIGURE the Compound PSP Agent before Start Building. Its own Start
    // Building control persists the Agent to sessionStorage (so it survives the
    // OAuth redirect) and THEN advances to the contextual GitHub sign-in.
    if (phase === 'configure') {
      return <RelayConfigureAgent onStartBuilding={() => setPhase('signin')} />;
    }
    // They finished configuring and chose to build — now the contextual sign-in.
    return (
      <div className="relay-beta-entry" data-state="sign-in">
        <h1>Sunday Relay — private beta</h1>
        <p>Sign in to start a Mission on your own repository.</p>
        <RelayGitHubSignIn
          bridgeUrl={resolvedBridge}
          // The gate already finished any redirect; the component need not repeat it.
          completeImpl={async () => ({ signedIn: false, message: null })}
        />
      </div>
    );
  }

  if (connectedKey === null) {
    // Only NON-revoked registrations are selectable: a revoked one would fail
    // closed at the bridge, so it is never offered.
    const selectable = repoChoices.repositories.filter((r) => !r.revoked);

    // The reconnect pointer took precedence above; here we choose between the
    // returning-participant PICKER and the first-time CONNECT flow. The connect
    // flow is the fallback for a fresh user, an empty list, a list that refused,
    // OR an explicit "connect a different repository" — it is never blocked on a
    // list error.
    if (!connectingNew && repoChoices.status === 'loading') {
      return (
        <div className="relay-beta-entry" data-state="loading-repos">
          <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
          <p>Loading your connected repositories…</p>
        </div>
      );
    }

    if (!connectingNew && selectable.length > 0) {
      return (
        <div className="relay-beta-entry" data-state="select-repo">
          <h1>Choose a repository</h1>
          <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
          <ul className="relay-beta-entry__repos" aria-label="Connected repositories">
            {selectable.map((repo) => (
              <li key={repo.key} className="relay-beta-entry__repo">
                <button
                  type="button"
                  className="relay-beta-entry__repo-select"
                  onClick={() => { saveConnectedRepository(repo.key); setConnectedKey(repo.key); }}
                >
                  {repo.owner}/{repo.name}
                </button>
                <span className="relay-beta-entry__repo-branch">
                  {' '}default branch <code>{repo.defaultBranch}</code>
                </span>
                {repo.grants.length > 0 && (
                  <span className="relay-beta-entry__repo-grants"> · granted {repo.grants.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="relay-beta-entry__connect-different"
            onClick={() => setConnectingNew(true)}
          >
            Connect a different repository
          </button>
        </div>
      );
    }

    return (
      <div className="relay-beta-entry" data-state="connect-repo">
        <h1>Connect a repository</h1>
        <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
        {/* A list that refused is surfaced non-fatally — the connect flow still
            works, and the reason is honest rather than reading as "no repos". */}
        {repoChoices.message !== null && (
          <p className="relay-beta-entry__repos-error" role="status">{repoChoices.message}</p>
        )}
        <RelayConnectRepository
          bridgeUrl={resolvedBridge}
          installBeginImpl={installBeginImpl}
          registerImpl={registerImpl}
          readInstallationImpl={readInstallationImpl}
          discoverImpl={discoverRepositoriesImpl}
          onConnected={(key) => { saveConnectedRepository(key); setConnectedKey(key); }}
        />
      </div>
    );
  }

  // RECONFIGURE (founder rules B/C): the runner asked to (re)configure the Agent.
  // Render the SAME dedicated Configure surface — never inline authoring in the
  // runner, never a trip back through sign-in — and on completion re-read the
  // persisted Agent and return to the runner. The session and the connected repo
  // are untouched (participant/connectedKey are not cleared), so the participant
  // lands back on their repository with the UPDATED Agent rehydrated. This same
  // surface also resolves the FAIL-CLOSED state: a signed-in participant with no
  // Agent configures one here before any Mission becomes startable.
  if (reconfiguring) {
    return (
      <div className="relay-beta-entry" data-state="reconfigure">
        <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
        <RelayConfigureAgent
          primaryLabel="Save Agent"
          onStartBuilding={() => { setConfiguredAgent(loadConfiguredPsp()); setReconfiguring(false); }}
        />
      </div>
    );
  }

  // Signed in with a connected repository — the beta app: start, watch, ship a
  // Mission on it. `config` MAY be null (fail-closed): the runner refuses to start
  // a Mission and offers Configure / Load Saved PSP instead. (`children` is the
  // demo/preview shell, reached only when the gate is transparent because no live
  // bridge is configured.)
  return (
    <div className="relay-beta-entry" data-state="ready">
      <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
      <RelayMissionRunner
        repositoryKey={connectedKey}
        bridgeUrl={resolvedBridge}
        config={missionConfig}
        onReconfigure={() => setReconfiguring(true)}
        {...(missionConfigLabel !== undefined ? { configLabel: missionConfigLabel } : {})}
        {...(missionStartImpl !== undefined ? { startImpl: missionStartImpl } : {})}
        {...(missionPollImpl !== undefined ? { pollImpl: missionPollImpl } : {})}
        {...(missionShipImpl !== undefined ? { shipImpl: missionShipImpl } : {})}
        {...(missionPspListImpl !== undefined ? { pspListImpl: missionPspListImpl } : {})}
        {...(missionPspLoadImpl !== undefined ? { pspLoadImpl: missionPspLoadImpl } : {})}
        {...(missionPspSaveImpl !== undefined ? { pspSaveImpl: missionPspSaveImpl } : {})}
        {...(missionHistoryImpl !== undefined ? { historyImpl: missionHistoryImpl } : {})}
      />
    </div>
  );
}
