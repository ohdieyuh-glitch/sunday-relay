import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  completeGitHubSignIn, configuredBridgeUrl, loadBridgeSession,
  beginRepositoryInstall, registerRepository, readInstallationFromReturn,
} from './bridge-session';
import { RelayGitHubSignIn } from './RelayGitHubSignIn';
import { RelayConnectRepository } from './RelayConnectRepository';
import { RelayWorld } from '../relay-world';
import {
  canActivate, cardBelongsTo, cardCurrency, cardNotCarriedNote, cardReference, claimCard, isConfigured, isPersistedCard,
  loadAgentDraft, missionConfigLabel, newCardForAgent, projectMissionConfig, startNewCompoundAgent,
  type CompoundAgentDraft, type OnboardingStepId,
} from '../relay-experience';
import { RelayConfigureAgent } from './RelayConfigureAgent';
import { RelayMissionRunner } from './RelayMissionRunner';
import { loadConnectedRepository, saveConnectedRepository } from './connected-repository';
import { listConnectedRepositories, discoverInstallationRepositories, type ConnectedRepository } from './repository-client';
import { startBetaMission, type pollBetaMission, type shipBetaMission, type listBetaMissions } from './beta-mission';
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
 *
 * ONE C.A.R.D. THROUGHOUT. The Compound Agent built in the world is the record
 * this gate binds at sign-in, projects into the Mission request, re-reads after
 * an explicit edit, and refuses to run a stale revision of. No stage of this
 * journey seeds a configuration of its own.
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
  // THE CANONICAL FLOW: the Relay experience → sign-in. A fresh live participant
  // begins in Aquala and builds their Compound Agent — its C.A.R.D. — in the
  // world; bringing it online advances straight to the contextual GitHub
  // sign-in. There is NO second configuration stage: the C.A.R.D. built in the
  // world is the one every later surface reads. GitHub is never the entrance,
  // and the Agent is always configured before any repository connects.
  //
  // The first phase is still spelled `wonderland` because that is the name the
  // persisted journey has always used; renaming it would change stored state
  // for no behavioural gain. It means "before the Agent is online".
  const [phase, setPhase] = useState<'wonderland' | 'signin'>('wonderland');
  // THE ACTIVE C.A.R.D. — the authoritative record, read from its durable store
  // on mount and RE-READ whenever it can have changed (activation, sign-in,
  // an explicit edit). It is what the Mission runs under; the request the
  // runner sends is its projection. It MAY be unpersisted: a signed-in
  // participant who has not built one has NO Agent, and we FAIL CLOSED rather
  // than silently defaulting (founder rule A). The record is a REQUEST the
  // runner forwards; the bridge stays the authority for what actually runs.
  const [card, setCard] = useState<CompoundAgentDraft>(() => loadAgentDraft());
  const cardRef = useRef(card);
  cardRef.current = card;
  // EDIT C.A.R.D. (founder rules B/C): a signed-in participant may re-open the
  // dedicated edit surface from the runner WITHOUT re-signing-in or losing the
  // connected repo. This is distinct from `phase` (which only governs the
  // pre-sign-in journey): it applies AFTER sign-in, in the runner branch. It is
  // the ONLY way the same C.A.R.D. is configured again — explicitly.
  const [reconfiguring, setReconfiguring] = useState(false);
  // Where the world opens when the participant explicitly asked for a NEW
  // C.A.R.D. (its C.A.R.D. step) or a NEW COMPOUND AGENT (step one); otherwise
  // the world resumes where the record left off.
  const [worldStep, setWorldStep] = useState<OnboardingStepId | undefined>(undefined);

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

  // BIND THE C.A.R.D. TO THE PARTICIPANT the moment one is known. Built before
  // sign-in, the record is unbound; sign-in claims it. A record already claimed
  // by SOMEONE ELSE in this browser is refused and left as it is — the runner
  // then fails closed with the reason instead of running another participant's
  // Agent.
  useEffect(() => {
    if (participant === null) return;
    setCard(claimCard(participant).card);
  }, [participant]);

  // THE PROJECTION the runner consumes — derived, never stored. Null unless an
  // ACTIVATED C.A.R.D. exists and belongs to this participant: a Mission runs
  // under a Compound Agent the participant completed and brought online, never
  // under a record that merely exists.
  const foreignCard = isPersistedCard(card) && !cardBelongsTo(card, participant);
  const cardUsable = !foreignCard && isConfigured(card);
  const missionConfig = useMemo(() => (cardUsable ? projectMissionConfig(card) : null), [card, cardUsable]);
  const missionConfigLabelText = cardUsable ? missionConfigLabel(card) : undefined;
  // What the request does NOT carry, said next to what it does.
  const requestNotes = useMemo(() => (cardUsable ? [cardNotCarriedNote(card)] : []), [card, cardUsable]);

  // A MISSION STARTS UNDER THE CURRENT REVISION OR NOT AT ALL. The runner holds
  // the projection it was handed; if the C.A.R.D. changed since (another tab,
  // an edit), the store is the authority: the stale request is refused, the
  // current record is reloaded into the runner, and the participant starts
  // again from what is actually configured.
  const startUnderCurrentCard = useCallback<typeof startBetaMission>(async (input) => {
    const held = cardRef.current;
    if (isPersistedCard(held)) {
      const currency = cardCurrency(cardReference(held));
      if (!currency.ok) {
        setCard(currency.current);
        const why = currency.reason === 'stale_revision'
          ? `Your C.A.R.D. changed (revision ${held.revision} → ${currency.current.revision}).`
          : currency.reason === 'no_card' ? 'Your C.A.R.D. is no longer in this browser.'
          : 'A different C.A.R.D. is active now.';
        return { ok: false, missionId: null, view: null, message: `${why} The current C.A.R.D. was reloaded — review it and start again.` };
      }
    }
    return (missionStartImpl ?? startBetaMission)(input);
  }, [missionStartImpl]);

  // Demo/preview build: the gate does nothing at all.
  if (resolvedBridge === null) return <>{children}</>;

  if (!ready) {
    return <div className="relay-beta-entry" data-state="resolving"><p>Connecting to Relay…</p></div>;
  }

  if (participant === null) {
    // THE FRONT DOOR IS THE RELAY EXPERIENCE, not a GitHub wall.
    //
    // A fresh live participant arrives in Aquala, travels to Relay through the
    // same persistent scene, and creates their Compound Agent there. GitHub
    // stays deferred and contextual, exactly as it was.
    //
    // This replaced `RelayWonderlandEntrance`, a thin live wrapper whose only
    // job was to make the superseded Entry Home the live front door. It is
    // deleted rather than left unreferenced, because an unused component that
    // renders the old shell is precisely how the old shell comes back. The
    // Entry Home ITSELF is untouched — it still holds working surfaces and is
    // still served at the explicit `#/relay/home-legacy` route that nothing in
    // the product links to.
    if (phase === 'wonderland') {
      // A participant who already built their Agent resumes at the Relay stage
      // of the SAME scene rather than replaying the arrival — the world is
      // continuous, so returning is a camera position, not a different screen.
      // A first-time visitor gets the full passage from Aquala.
      //
      // The test is `canActivate`, not `isConfigured`: the second also requires
      // activation, and someone who BUILT an Agent but has not brought it
      // online is exactly the person who needs to land on the control that
      // does.
      const stage = canActivate(loadAgentDraft()) ? 'relay' : 'aquala';
      // Bringing the Agent online advances DIRECTLY to sign-in. The C.A.R.D.
      // the world just persisted is complete by construction (activation
      // requires it), so there is nothing left to ask — a second configuration
      // screen for the same values is exactly the defect this replaced. The
      // runner reads that same record.
      return <RelayWorld initialStage={stage} onActivated={() => { setCard(loadAgentDraft()); setPhase('signin'); }} />;
    }
    // The Agent is online — now the contextual sign-in.
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

  // A C.A.R.D. ANOTHER PARTICIPANT LEFT IN THIS BROWSER is not this one's. It is
  // neither edited nor run under; the only way forward is explicit — their own
  // new Compound Agent, owned by them, built in the world like every other.
  if (foreignCard) {
    return (
      <div className="relay-beta-entry" data-state="foreign-card">
        <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
        <p role="alert">
          The C.A.R.D. in this browser belongs to a different participant. It will not run under your account.
        </p>
        <button
          type="button"
          className="relay-beta-entry__new-agent"
          onClick={() => setCard(startNewCompoundAgent(new Date().toISOString(), participant))}
        >
          Create a new Compound Agent
        </button>
      </div>
    );
  }

  // A SIGNED-IN PARTICIPANT WITHOUT AN ACTIVATED C.A.R.D. — cleared storage, a
  // new browser, an Agent built but never brought online, a new Agent just
  // started — builds it where every C.A.R.D. is built: in the world. Nothing
  // here seeds a default in its place (founder rule A), and the C.A.R.D. they
  // activate is claimed for them on the spot.
  if (!isConfigured(card)) {
    return (
      <RelayWorld
        initialStage="relay"
        {...(worldStep !== undefined ? { initialStep: worldStep } : {})}
        onActivated={() => { setWorldStep(undefined); setCard(claimCard(participant).card); }}
      />
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

  // EDIT C.A.R.D. (founder rules B/C): the runner asked to edit the C.A.R.D.
  // Render the SAME dedicated edit surface — never inline authoring in the
  // runner, never a trip back through sign-in — and on completion (or cancel)
  // re-read the authoritative record and return to the runner. The session and
  // the connected repo are untouched (participant/connectedKey are not cleared),
  // so the participant lands back on their repository with the UPDATED C.A.R.D.
  // The surface only EDITS: a participant with no C.A.R.D. never reaches it —
  // they are routed to the world above, where a C.A.R.D. is created.
  if (reconfiguring) {
    const backToRunner = () => { setCard(claimCard(participant).card); setReconfiguring(false); };
    return (
      <div className="relay-beta-entry" data-state="reconfigure">
        <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
        <RelayConfigureAgent primaryLabel="Save C.A.R.D." onStartBuilding={backToRunner} onCancel={backToRunner} />
      </div>
    );
  }

  // Signed in with a connected repository and an activated C.A.R.D. — the beta
  // app: start, watch, ship a Mission on it under that C.A.R.D. The projection
  // is memoised on the record, so the runner follows it exactly when it changes.
  // (`children` is the demo/preview shell, reached only when the gate is
  // transparent because no live bridge is configured.)
  return (
    <div className="relay-beta-entry" data-state="ready">
      <p>Signed in as <span className="relay-beta-entry__who">{participant}</span>.</p>
      <RelayMissionRunner
        repositoryKey={connectedKey}
        bridgeUrl={resolvedBridge}
        config={missionConfig}
        onReconfigure={() => setReconfiguring(true)}
        // EXPLICIT new C.A.R.D. / new Compound Agent: the record changes and the
        // world opens on the right step — nothing is inherited that should not be.
        onNewCard={() => { setWorldStep('card'); setCard(newCardForAgent(new Date().toISOString())); }}
        onNewAgent={() => { setWorldStep('name'); setCard(startNewCompoundAgent(new Date().toISOString(), participant)); }}
        requestNotes={requestNotes}
        startImpl={startUnderCurrentCard}
        {...(missionConfigLabelText !== undefined ? { configLabel: missionConfigLabelText } : {})}
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
