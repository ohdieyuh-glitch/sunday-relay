import { useEffect, useState, type ReactNode } from 'react';

import {
  completeGitHubSignIn, configuredBridgeUrl, loadBridgeSession,
  beginRepositoryInstall, registerRepository, readInstallationFromReturn,
} from './bridge-session';
import { RelayGitHubSignIn } from './RelayGitHubSignIn';
import { RelayConnectRepository } from './RelayConnectRepository';
import { RelayWonderlandEntrance } from './RelayWonderlandEntrance';
import { RelayMissionRunner } from './RelayMissionRunner';
import { loadConnectedRepository, saveConnectedRepository } from './connected-repository';
import { listConnectedRepositories, discoverInstallationRepositories, type ConnectedRepository } from './repository-client';
import type { startBetaMission, pollBetaMission, shipBetaMission, listBetaMissions } from './beta-mission';
import type { listPsps, loadPsp, savePsp } from './psp-client';

/** A conservative default config a beta Mission runs under until PSP selection is
 *  wired into this surface: guided, independent review, bounded spend/compute. */
const DEFAULT_BETA_CONFIG = {
  mode: 'guided', review: 'independent', completionRule: 'strict',
  limits: { agentCalls: 8, runtimeMinutes: 30, spendUsd: 5, reviewCycles: 1, repairCycles: 1 },
} as const;

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
  // THE ENTRANCE IS WONDERLAND, NOT GITHUB. A fresh live participant begins in
  // Wonderland with the Wandering Relay Dog; GitHub sign-in is deferred until
  // they deliberately choose to start building. `wantsToBuild` records that
  // choice — only then does the contextual sign-in appear.
  const [wantsToBuild, setWantsToBuild] = useState(false);

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
    if (!wantsToBuild) {
      return <RelayWonderlandEntrance onStartBuilding={() => setWantsToBuild(true)} />;
    }
    // They chose to start building — now the contextual GitHub sign-in.
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

  // Signed in with a connected repository — the beta app: start, watch, ship a
  // Mission on it. (`children` is the demo/preview shell, reached only when the
  // gate is transparent because no live bridge is configured.)
  return (
    <div className="relay-beta-entry" data-state="ready">
      <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
      <RelayMissionRunner
        repositoryKey={connectedKey}
        bridgeUrl={resolvedBridge}
        config={DEFAULT_BETA_CONFIG}
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
