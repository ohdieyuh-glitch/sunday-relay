import { useEffect, useState, type ReactNode } from 'react';

import {
  completeGitHubSignIn, configuredBridgeUrl, loadBridgeSession,
  beginRepositoryInstall, registerRepository, readInstallationFromReturn,
} from './bridge-session';
import { RelayGitHubSignIn } from './RelayGitHubSignIn';
import { RelayConnectRepository } from './RelayConnectRepository';
import { RelayMissionRunner } from './RelayMissionRunner';
import type { startBetaMission, pollBetaMission, shipBetaMission } from './beta-mission';
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
  missionStartImpl,
  missionPollImpl,
  missionShipImpl,
  missionPspListImpl,
  missionPspLoadImpl,
  missionPspSaveImpl,
}: {
  readonly children: ReactNode;
  readonly bridgeUrl?: string | null;
  readonly completeImpl?: typeof completeGitHubSignIn;
  readonly installBeginImpl?: typeof beginRepositoryInstall;
  readonly registerImpl?: typeof registerRepository;
  readonly readInstallationImpl?: typeof readInstallationFromReturn;
  readonly missionStartImpl?: typeof startBetaMission;
  readonly missionPollImpl?: typeof pollBetaMission;
  readonly missionShipImpl?: typeof shipBetaMission;
  readonly missionPspListImpl?: typeof listPsps;
  readonly missionPspLoadImpl?: typeof loadPsp;
  readonly missionPspSaveImpl?: typeof savePsp;
}) {
  const resolvedBridge = bridgeUrl !== undefined ? bridgeUrl : configuredBridgeUrl();
  // With no bridge there is nothing to resolve — ready immediately, and transparent.
  const [ready, setReady] = useState(resolvedBridge === null);
  const [participant, setParticipant] = useState<string | null>(() => loadBridgeSession()?.participantId ?? null);
  const [connectedKey, setConnectedKey] = useState<string | null>(null);

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

  // Demo/preview build: the gate does nothing at all.
  if (resolvedBridge === null) return <>{children}</>;

  if (!ready) {
    return <div className="relay-beta-entry" data-state="resolving"><p>Connecting to Relay…</p></div>;
  }

  if (participant === null) {
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
    return (
      <div className="relay-beta-entry" data-state="connect-repo">
        <h1>Connect a repository</h1>
        <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
        <RelayConnectRepository
          bridgeUrl={resolvedBridge}
          installBeginImpl={installBeginImpl}
          registerImpl={registerImpl}
          readInstallationImpl={readInstallationImpl}
          onConnected={(key) => setConnectedKey(key)}
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
      />
    </div>
  );
}
