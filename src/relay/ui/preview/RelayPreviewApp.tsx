import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MissionControl } from '../MissionControl';
import { RelayEntryHome } from '../entry-home';
import {
  DEFAULT_CONNECTION_STATUSES,
  FIXTURE_GUIDE_MESSAGES,
  FIXTURE_RECENT_PROJECTS,
  SUGGESTED_QUESTIONS,
  buildEvidenceRecommendation,
  buildResearchRecommendation,
  buildWorkforceRecommendation,
  fixtureGuideReply,
} from '../entry-home';
import type {
  GuideMessage,
  ProjectBriefDraft,
  ProjectRouteDefinition,
} from '../entry-home';
import {
  RelayProjectWorkspace,
  RelayMissionPlayback,
  RelayLiveMissionControl,
  WORKSPACE_FIXTURES,
  WORKSPACE_FIXTURE_KEYS,
} from '../project-workspace';
import type { RelayMissionState } from '../app';
import type { ProjectMessage, WorkspaceFixtureKey } from '../project-workspace';
import { AGENT_OPTIONS, RelayProjectSettings } from '../project-settings';
import type { ProjectSettingsDraft } from '../project-settings';
import {
  deriveMissionProjection,
  getRelayAppStore,
  defaultSettingsForProject,
  useRelayAppState,
} from '../app';
import {
  RelayDemoSimulationControls,
  RelayDemoMissionSummary,
  projectDemoSimulationIntoWorkspace,
  useRelayDemoSimulation,
} from '../app/demo-simulation';
import { RelayMissionRunControls } from '../mission-control';
import {
  DeterministicCommandInterpreter,
  InMemoryMissionCommandRepository,
  InMemoryMissionContextStore,
} from '../../mission/commands';
import { createAuthMissionContext } from '../../mission/commands/command-fixtures';
import type { PSPAgentImportRecord } from '../../psp';
import { createFixtureEntitlementService } from '../../psp/psp-fixtures';
import { COLORWAY_LABEL, RELAY_COLORWAYS, applyRelayColorway } from './colorway';
import type { RelayColorway } from './colorway';
import { IS_DEV_BUILD, siblingProductTarget } from './environment';
import './relay-preview.css';

/**
 * RELAY BROWSER APPLICATION SHELL — the product host that wires the domain
 * store (projects, briefs, settings, brains, missions, events) to the
 * approved screens across a continuous, refresh-safe flow:
 *
 *   #/relay                              → Relay Entry Home + Ask Relay
 *   #/relay/project/:id/settings         → Project Settings
 *   #/relay/project/:id                  → Active Project Workspace
 *   #/relay/project/:id/terminal         → full-screen Live Terminal
 *   #/relay/console                      → Mission Control (execution console)
 *
 * All domain state lives in the application store and persists through the
 * browser-demo adapter, so refresh and direct routes restore the exact
 * project and mission. The demo mission path is deterministic and offline —
 * no provider is ever called. The bottom-right DEV PREVIEW switcher — now
 * collapsible at every width behind its DEV PREVIEW handle, with a ZOOM control that
 * shrinks the whole app into view — is a development tool only, never part of
 * any production component contract.
 *
 * The `rly-001` id remains the labeled design fixture (unchanged), so the
 * approved screenshots keep working; created projects are `rly-002+` and are
 * fully store-backed with live mission progression.
 */

export type PreviewRoute =
  | { screen: 'home' }
  | { screen: 'settings'; projectId: string }
  | { screen: 'console' }
  | { screen: 'workspace'; projectId: string; terminal: boolean };

export function parsePreviewHash(hash: string): PreviewRoute {
  const clean = hash.replace(/^#/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] !== 'relay') return { screen: 'home' };
  if (parts[1] === 'console') return { screen: 'console' };
  // Back-compat: bare settings route resolves to the active project later.
  if (parts[1] === 'project-settings') return { screen: 'settings', projectId: '' };
  if (parts[1] === 'project' && parts[2]) {
    if (parts[3] === 'settings') return { screen: 'settings', projectId: parts[2] };
    return { screen: 'workspace', projectId: parts[2], terminal: parts[3] === 'terminal' };
  }
  return { screen: 'home' };
}

function useHashRoute(): [PreviewRoute, (hash: string) => void] {
  const [route, setRoute] = useState<PreviewRoute>(() =>
    parsePreviewHash(typeof window !== 'undefined' ? window.location.hash : ''),
  );
  useEffect(() => {
    const onHash = () => setRoute(parsePreviewHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);
  return [route, navigate];
}

let previewMessageSeq = 100;

const isTerminalMissionState = (state: RelayMissionState) =>
  state === 'verified_complete' || state === 'failed' || state === 'cancelled';

/** Dev-only preview zoom levels — shrink the whole app to fit the full page on
    screen at once. The value scales the app via CSS `zoom`; the fixed dev
    controls live outside the scaled stage and stay full size. */
const DEV_ZOOM_LEVELS = [100, 90, 75, 60, 50] as const;
const DEV_ZOOM_KEY = 'sunday-relay.dev.zoom';

function readDevZoom(): number {
  if (typeof window === 'undefined') return 100;
  try {
    const raw = Number(window.localStorage.getItem(DEV_ZOOM_KEY));
    return (DEV_ZOOM_LEVELS as readonly number[]).includes(raw) ? raw : 100;
  } catch {
    return 100;
  }
}

function writeDevZoom(zoom: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(DEV_ZOOM_KEY, String(zoom));
  } catch {
    /* dev-only convenience — a storage failure must never break the app */
  }
}

export function RelayPreviewApp() {
  const store = useMemo(() => getRelayAppStore(), []);
  useEffect(() => {
    store.init();
  }, [store]);
  const state = useRelayAppState(store);

  const [route, navigate] = useHashRoute();
  const demoSimulation = useRelayDemoSimulation();
  const demoProjectIdRef = useRef<string | null>(null);
  const [mobileFrame, setMobileFrame] = useState(false);
  // Presentation-only local state: collapsing the developer panel must not
  // alter routes, appearance, fixture state, or mission execution.
  const [switcherOpen, setSwitcherOpen] = useState(true);
  // Dev-only preview zoom: shrink the whole app to see the full page at once.
  const [zoom, setZoom] = useState<number>(readDevZoom);
  useEffect(() => {
    writeDevZoom(zoom);
  }, [zoom]);

  // Appearance persists through the store (existing frontend appearance
  // contract). Apply on every change and on first restore.
  const colorway = state.colorway;
  useEffect(() => {
    applyRelayColorway(colorway, document.documentElement);
  }, [colorway]);
  const setColorway = (c: RelayColorway) => store.setColorway(c);

  /* -------- live mission driver: begin once + poll authoritative state ----- */
  // The active non-demo mission id for the current workspace route. A stable
  // string, so the effect below runs once per live mission (not per poll).
  const liveMissionId = useMemo(() => {
    if (route.screen !== 'workspace') return null;
    const project = store.getProject(route.projectId);
    const m = project?.activeMissionId ? store.getMission(project.activeMissionId) : null;
    return m && !m.demo ? m.id : null;
    // `state` dep: recompute after store commits so a newly-created mission is seen.
  }, [route, store, state]);

  useEffect(() => {
    if (!liveMissionId) return;
    const mission = store.getMission(liveMissionId);
    if (!mission) return;

    let stopped = false;
    // Begin exactly once — never re-dispatch on refresh or route remount.
    if (mission.state === 'configured' && store.getMissionEvents(liveMissionId).length === 0) {
      void store.beginLiveMission(liveMissionId).then((r) => {
        if (!r.ok && !stopped) setNotice(r.message);
      });
    }
    if (isTerminalMissionState(mission.state)) return;

    const interval = window.setInterval(() => {
      const m = store.getMission(liveMissionId);
      if (!m || isTerminalMissionState(m.state)) {
        window.clearInterval(interval);
        return;
      }
      void store.pollLiveMission(liveMissionId).then((r) => {
        if (!r.ok && !stopped) {
          // Backend lost the mission (e.g. it restarted). Stop polling and say
          // so honestly; the persisted last-known state stays on screen.
          window.clearInterval(interval);
          setNotice(r.message);
        }
      });
    }, 1200);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [liveMissionId, store]);

  /* ---------------- Entry Home host state (memory-only UI bits) ------- */
  const [projectIdeaDraft, setProjectIdeaDraft] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<ProjectRouteDefinition | null>(null);
  const [guideMessages, setGuideMessages] = useState<GuideMessage[]>(FIXTURE_GUIDE_MESSAGES);
  const [recentPopulated, setRecentPopulated] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /* ---------------- workspace fixture-showcase state ------------------ */
  const [fixtureKey, setFixtureKey] = useState<WorkspaceFixtureKey>('implementing');
  const [extraWsMessages, setExtraWsMessages] = useState<ProjectMessage[]>([]);

  /* -------------- Mission run controls (PAUSE / RESUME) -------------- */
  /* The controls drive the REAL Milestone 2 command protocol over a loaded
     mission context. The dev preview supplies the Mission Operations fixture
     context; a signed-in application supplies the live one. Either way the
     path is identical — interpret, validate, preview, checkpoint, execute. */
  const missionCommandStore = useMemo(() => {
    const store_ = new InMemoryMissionContextStore();
    store_.save(createAuthMissionContext());
    return store_;
  }, []);
  const missionCommandRepo = useMemo(() => new InMemoryMissionCommandRepository(), []);
  const missionCommandSeq = useRef(0);
  const missionRunDeps = useMemo(() => ({
    interpreter: new DeterministicCommandInterpreter(),
    repository: missionCommandRepo,
    contextStore: missionCommandStore,
    now: () => new Date().toISOString(),
    requestId: () => `cmd-preview-${++missionCommandSeq.current}`,
    actorUserId: 'user-founder',
    projectId: 'project-sunday',
    missionId: 'mission-auth',
  }), [missionCommandRepo, missionCommandStore]);

  /* ------------------ Agents -> Import PSP Agent -------------------- */
  /* The dev preview exercises the real import flow against the DETERMINISTIC
     DEVELOPMENT FIXTURE service: version-0 synthetic credentials, no
     marketplace, no purchase, no trade, no payment provider. Ship on Sunday's
     entitlement backend does not exist yet; the production adapter refuses
     every credential rather than inventing one. */
  const [importedAgents, setImportedAgents] = useState<PSPAgentImportRecord[]>([]);
  const pspImportCounter = useRef(0);
  const pspService = useMemo(() => createFixtureEntitlementService(), []);
  const agentsPanel = useMemo(() => ({
    workspace: {
      workspaceId: 'ws-relay-preview',
      userId: 'user-holder',
      importAllowed: true,
      relayVersion: '0.5.0',
      grantablePermissions: [
        'workspace.read', 'workspace.write', 'mission.run', 'mission.review',
      ],
      installedPspIds: importedAgents.map((agent) => agent.pspId),
    },
    service: pspService,
    now: () => new Date().toISOString(),
    importId: () => `imp-preview-${++pspImportCounter.current}`,
    importedAgents,
    onImported: (record: PSPAgentImportRecord) =>
      setImportedAgents((current) => [...current, record]),
  }), [importedAgents, pspService]);

  // The active draft project's brief drives the Entry Home brief panel.
  const activeProjectId = state.activeProjectId;
  const activeBrief = activeProjectId ? store.getBrief(activeProjectId) : null;
  const activeProject = activeProjectId ? store.getProject(activeProjectId) : null;
  const homeBriefDraft: ProjectBriefDraft | null =
    activeProject && activeProject.status === 'draft' && activeBrief ? activeBrief.draft : null;

  const category = selectedRoute?.category ?? null;
  const workforceRecommendation = useMemo(
    () => buildWorkforceRecommendation(category, DEFAULT_CONNECTION_STATUSES),
    [category],
  );
  const researchRecommendation = useMemo(() => buildResearchRecommendation(category), [category]);
  const evidenceRecommendation = useMemo(() => buildEvidenceRecommendation(category), [category]);

  const askRelay = (text: string) => {
    previewMessageSeq += 1;
    const developer: GuideMessage = {
      messageId: `preview-dev-${previewMessageSeq}`,
      author: 'developer',
      text,
      at: 'preview session',
    };
    const reply = fixtureGuideReply(text, previewMessageSeq);
    setGuideMessages((m) => [...m, developer, reply]);
  };

  // Resolved once: where (if anywhere) the Alcatraz sibling-product control
  // should take the user. Reading it here keeps the render pure.
  const alcatraz = useMemo(() => siblingProductTarget(), []);

  // Ask Relay → persisted project draft. Idempotent, guarded against
  // duplicate submits, recovers with a simple message on failure.
  const buildBrief = (objective: string) => {
    const result = store.createDraftFromRequest(objective);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setNotice(null);
  };

  const continueToSettings = (_draft: ProjectBriefDraft) => {
    if (!activeProjectId) return;
    store.approveBrief(activeProjectId);
    navigate(`/relay/project/${activeProjectId}/settings`);
  };

  const openProjectSettings = () => {
    if (activeProjectId) {
      navigate(`/relay/project/${activeProjectId}/settings`);
      return;
    }
    const result = store.createDraftFromRequest(
      projectIdeaDraft.trim() || 'New Relay project',
    );
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    navigate(`/relay/project/${result.value.project.id}/settings`);
  };

  const copyBrief = (formatted: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(formatted).catch(() => undefined);
    }
    setNotice('Draft copied (preview clipboard).');
  };

  const pushWsMessage = (author: ProjectMessage['author'], text: string) => {
    previewMessageSeq += 1;
    setExtraWsMessages((m) => [
      ...m,
      {
        messageId: `preview-ws-${previewMessageSeq}`,
        author,
        text,
        at: 'preview session',
        fixture: author === 'relay',
      },
    ]);
  };

  /* ------------------------------------------------------- Entry Home */
  const home = (
    <RelayEntryHome
      productState={homeBriefDraft ? 'draft' : 'unconfigured'}
      currentProject={null}
      recentProjects={recentPopulated ? FIXTURE_RECENT_PROJECTS : []}
      projectIdeaDraft={projectIdeaDraft}
      projectBriefDraft={homeBriefDraft}
      selectedRoute={selectedRoute}
      workforceRecommendation={workforceRecommendation}
      researchRecommendation={researchRecommendation}
      evidenceRecommendation={evidenceRecommendation}
      guideMessages={guideMessages}
      guideStatus="idle"
      suggestedQuestions={SUGGESTED_QUESTIONS}
      dogState={projectIdeaDraft.trim() ? 'ready' : 'wandering'}
      handoffNetworkState="standby"
      entitlement="pro"
      connectionStatuses={DEFAULT_CONNECTION_STATUSES}
      // Sunday Alcatraz is an Aquala SIBLING PRODUCT, not a route of this
      // application: `/` is Relay's own canonical entry, so the old
      // `window.location.href = '/'` never reached Alcatraz. The control now
      // navigates to a CONFIGURED external Alcatraz URL, and reports itself
      // as unavailable when none is configured — never a broken link, and
      // never a hardcoded domain this repository has no authority over.
      onReturnToSunday={alcatraz.configured
        ? () => { window.location.href = alcatraz.url; }
        : undefined}
      siblingProductUnavailableReason={alcatraz.configured ? undefined : alcatraz.reason}
      onSelectProjectRoute={(r) => {
        setSelectedRoute(r);
        setProjectIdeaDraft(r.objectiveTemplate);
      }}
      onUpdateProjectIdea={setProjectIdeaDraft}
      onBuildProjectBrief={buildBrief}
      onConnectExistingProject={() => askRelay('Connect an existing project')}
      onAskRelay={askRelay}
      onSelectSuggestedQuestion={askRelay}
      onUpdateProjectBriefDraft={(patch) => {
        if (activeProjectId) store.updateBrief(activeProjectId, patch);
      }}
      onCopyProjectBrief={copyBrief}
      onClearProjectBrief={() => {
        if (activeProjectId) store.clearDraft(activeProjectId);
      }}
      onContinueToProjectSettings={continueToSettings}
      onOpenRecentProject={(projectId) => navigate(`/relay/project/${projectId}`)}
      onOpenProjectSettings={openProjectSettings}
      onOpenTerminal={() => navigate('/relay/project/rly-001/terminal')}
    />
  );

  /* ---------------------------------------------------- Project Settings */
  const settingsProjectId =
    route.screen === 'settings' ? route.projectId || activeProjectId || '' : '';
  const settingsProject = settingsProjectId ? store.getProject(settingsProjectId) : null;
  const settingsBrief = settingsProjectId ? store.getBrief(settingsProjectId) : null;
  const storedSettings = settingsProjectId ? store.getSettings(settingsProjectId) : null;

  const projectSettings = settingsProject ? (
    <RelayProjectSettings
      brief={settingsBrief?.draft ?? null}
      agentOptions={AGENT_OPTIONS}
      entitlement="pro"
      initialDraft={
        storedSettings?.draft ?? defaultSettingsForProject(store, settingsProject.id)
      }
      onSaveDraft={(d: ProjectSettingsDraft) => {
        store.saveSettings(settingsProject.id, d);
      }}
      onStartProject={(d: ProjectSettingsDraft) => {
        const result = store.startProject(settingsProject.id, d);
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        setExtraWsMessages([]);
        navigate(`/relay/project/${settingsProject.id}`);
      }}
      onConnectRepository={() => undefined}
      onBack={() => navigate('/relay')}
    />
  ) : (
    <SafeNotFound
      title="Relay could not load this project."
      detail="Start a new project from the Relay Entry Home."
      onHome={() => navigate('/relay')}
    />
  );

  /* --------------------------------------------------- Active Workspace */
  const workspace = renderWorkspace();

  function renderWorkspace() {
    if (route.screen !== 'workspace') return null;
    return renderWorkspaceProject(route.projectId, route.terminal);
  }

  function renderWorkspaceProject(projectId: string, terminalOpen: boolean) {
    // The labeled design fixture project stays available for the showcase.
    if (projectId === 'rly-001' && !store.getProject('rly-001')) {
      return renderFixtureWorkspace(terminalOpen);
    }

    const project = store.getProject(projectId);
    if (!project) {
      return (
        <SafeNotFound
          title="Relay could not load this project."
          detail="It may have been reset. Start a new project from the Relay Entry Home."
          onHome={() => navigate('/relay')}
        />
      );
    }
    // Draft projects have no mission yet — send the founder to finish settings.
    if (project.status === 'draft' || !project.activeMissionId) {
      return (
        <SafeNotFound
          title="Finish configuring this project."
          detail="Choose the required roles in Project Settings to start the mission."
          actionLabel="OPEN PROJECT SETTINGS"
          onAction={() => navigate(`/relay/project/${projectId}/settings`)}
          onHome={() => navigate('/relay')}
        />
      );
    }

    const settings = store.getSettings(projectId);
    const mission = store.getMission(project.activeMissionId);
    if (!settings || !mission) {
      return (
        <SafeNotFound
          title="Relay could not load this mission."
          detail="Start a new project from the Relay Entry Home."
          onHome={() => navigate('/relay')}
        />
      );
    }
    const brain = store.getProjectBrain(projectId);
    const events = store.getMissionEvents(mission.id);
    const projection = deriveMissionProjection({ project, settings, brain, mission, events });
    const presentation = demoSimulation.state.active
      ? projectDemoSimulationIntoWorkspace(demoSimulation.state, projection)
      : projection;

    const advance = () => {
      setBusy(true);
      const r = store.advanceMission(mission.id);
      if (!r.ok) setNotice(r.message);
      setBusy(false);
    };
    const restart = () => {
      const r = store.restartDemoMission(mission.id);
      if (!r.ok) setNotice(r.message);
      setExtraWsMessages([]);
    };

    return (
      <RelayProjectWorkspace
        {...presentation}
        agentsPanel={agentsPanel}
        projectMessages={[...presentation.projectMessages, ...extraWsMessages]}
        terminalOpen={terminalOpen}
        terminalFullScreen
        missionPlayback={
          demoSimulation.state.active ? (
            <RelayDemoMissionSummary state={demoSimulation.state} />
          ) : mission.demo ? (
            <RelayMissionPlayback
              state={mission.state}
              busy={busy}
              onAdvance={advance}
              onRestart={restart}
            />
          ) : (
            <RelayLiveMissionControl
              state={mission.state}
              error={mission.error}
              architectLabel={mission.handoff?.architectLabel}
              busy={busy}
              onStop={() => {
                setBusy(true);
                void store.cancelLiveMission(mission.id).then((r) => {
                  if (!r.ok) setNotice(r.message);
                  setBusy(false);
                });
              }}
              onRetry={() => {
                setBusy(true);
                void store.retryLiveMission(mission.id).then((r) => {
                  if (!r.ok) setNotice(r.message);
                  setBusy(false);
                });
              }}
              runControls={<RelayMissionRunControls deps={missionRunDeps} />}
            />
          )
        }
        onSendProjectMessage={(text) => {
          pushWsMessage('developer', text);
          pushWsMessage(
            'relay',
            'Relay answers from the current mission state. Use DEMO MISSION to step the sample mission.',
          );
        }}
        onApproveDecision={(id) => pushWsMessage('relay', `Decision ${id} approval recorded.`)}
        onRejectDecision={(id) => pushWsMessage('relay', `Decision ${id} rejection recorded.`)}
        onOpenTerminal={() => navigate(`/relay/project/${projectId}/terminal`)}
        onCloseTerminal={() => navigate(`/relay/project/${projectId}`)}
        onOpenProjectSettings={() => navigate(`/relay/project/${projectId}/settings`)}
        onOpenManualTask={(id) => pushWsMessage('relay', `Opened Manual Task ${id}.`)}
        onApproveManualTask={(id) => pushWsMessage('relay', `Manual Task ${id} approved.`)}
        onRejectManualTask={(id) => pushWsMessage('relay', `Manual Task ${id} kept blocked.`)}
        onRequestResearch={(topic) =>
          pushWsMessage('relay', `Research request "${topic}" recorded.`)
        }
        onOpenFinding={(id) => pushWsMessage('relay', `Opened finding ${id}.`)}
        onOpenRepair={(id) => pushWsMessage('relay', `Opened repair ${id}.`)}
        onReturnHome={() => navigate('/relay')}
      />
    );
  }

  function renderFixtureWorkspace(terminalOpen: boolean) {
    const fixture = WORKSPACE_FIXTURES[fixtureKey];
    const presentation = demoSimulation.state.active
      ? projectDemoSimulationIntoWorkspace(demoSimulation.state, fixture)
      : fixture;
    return (
      <RelayProjectWorkspace
        {...presentation}
        agentsPanel={agentsPanel}
        projectMessages={[...presentation.projectMessages, ...extraWsMessages]}
        terminalOpen={terminalOpen}
        terminalFullScreen
        missionPlayback={
          demoSimulation.state.active
            ? <RelayDemoMissionSummary state={demoSimulation.state} />
            : undefined
        }
        onSendProjectMessage={(text) => {
          pushWsMessage('developer', text);
          pushWsMessage('relay', 'Fixture showcase — no mission is actually running.');
        }}
        onApproveDecision={(id) => pushWsMessage('relay', `Fixture: decision ${id} approved.`)}
        onRejectDecision={(id) => pushWsMessage('relay', `Fixture: decision ${id} rejected.`)}
        onOpenTerminal={() => navigate('/relay/project/rly-001/terminal')}
        onCloseTerminal={() => navigate('/relay/project/rly-001')}
        onOpenProjectSettings={() => navigate('/relay')}
        onOpenManualTask={(id) => pushWsMessage('relay', `Fixture: opened Manual Task ${id}.`)}
        onApproveManualTask={(id) => pushWsMessage('relay', `Fixture: Manual Task ${id} approved.`)}
        onRejectManualTask={(id) => pushWsMessage('relay', `Fixture: Manual Task ${id} blocked.`)}
        onRequestResearch={(t) => pushWsMessage('relay', `Fixture: research "${t}" recorded.`)}
        onOpenFinding={(id) => pushWsMessage('relay', `Fixture: opened finding ${id}.`)}
        onOpenRepair={(id) => pushWsMessage('relay', `Fixture: opened repair ${id}.`)}
        onReturnHome={() => navigate('/relay')}
      />
    );
  }

  let screen: JSX.Element;
  if (
    demoSimulation.state.active &&
    demoProjectIdRef.current &&
    (route.screen === 'workspace' || route.screen === 'console')
  ) {
    screen = renderWorkspaceProject(
      demoProjectIdRef.current,
      route.screen === 'workspace' && route.terminal,
    ) ?? home;
  } else if (route.screen === 'console') screen = <MissionControl />;
  else if (route.screen === 'settings') screen = projectSettings;
  else if (route.screen === 'workspace') screen = workspace ?? home;
  else screen = home;

  const demoProjectId =
    state.projects.find((p) => p.status !== 'draft')?.id ?? activeProjectId ?? 'rly-001';
  const playDemo = () => {
    if (route.screen !== 'workspace') {
      setNotice('Open the Relay Workspace before starting Demo Simulation.');
      return;
    }
    const liveMission = liveMissionId ? store.getMission(liveMissionId) : null;
    if (liveMission && !isTerminalMissionState(liveMission.state)) {
      setNotice('Demo Simulation is unavailable while a live mission is running.');
      return;
    }
    demoProjectIdRef.current = route.projectId;
    demoSimulation.play();
  };
  const exitDemo = () => {
    demoSimulation.exit();
    demoProjectIdRef.current = null;
  };

  return (
    <div className="rpv">
      <div
        className="rpv-stage"
        style={zoom === 100 ? undefined : { zoom: zoom / 100 }}
      >
        {mobileFrame && route.screen !== 'console' ? (
          <div className="rpv-mobile-frame">
            <div className="rpv-mobile-viewport">{screen}</div>
          </div>
        ) : (
          screen
        )}
      </div>

      {notice && (
        <p className="rpv-notice" role="status">
          {notice}{' '}
          <button type="button" onClick={() => setNotice(null)}>
            dismiss
          </button>
        </p>
      )}

      {/* DEVELOPMENT-ONLY TOOLING.
          The chip and the switcher below are how the founder walks the whole
          product flow in a browser, and they stay exactly as they are in a dev
          build. They must never ship: a production bundle that renders a
          "DEV PREVIEW" label presents development scaffolding as the product.
          Gated on the build, not on a runtime flag, so the bundler drops the
          markup entirely. `production-entry.test.tsx` fails in both
          directions — if the label ships, and if the tooling disappears from
          the dev build. */}
      {IS_DEV_BUILD && (
      <>
      <button
        type="button"
        className="rpv-devchip"
        aria-expanded={switcherOpen}
        aria-controls="relay-dev-preview-controls"
        aria-label={`${switcherOpen ? 'Collapse' : 'Expand'} DEV PREVIEW controls`}
        onClick={() => setSwitcherOpen((v) => !v)}
      >
        DEV PREVIEW <span aria-hidden="true">{switcherOpen ? '▾' : '▴'}</span>
      </button>
      <nav
        id="relay-dev-preview-controls"
        className={`rpv-switcher${switcherOpen ? ' rpv-switcher--open' : ''}`}
        aria-label="Development preview switcher"
      >
        <button type="button" onClick={() => navigate('/relay')} aria-pressed={route.screen === 'home'}>
          HOME
        </button>
        <button
          type="button"
          onClick={() => navigate(`/relay/project/${demoProjectId}`)}
          aria-pressed={route.screen === 'workspace'}
        >
          WORKSPACE
        </button>
        <button
          type="button"
          onClick={() => navigate('/relay/console')}
          aria-pressed={route.screen === 'console'}
        >
          CONSOLE
        </button>
        <button type="button" onClick={() => setMobileFrame((v) => !v)} aria-pressed={mobileFrame}>
          {mobileFrame ? 'DESKTOP' : 'MOBILE'}
        </button>
        <button
          type="button"
          onClick={() => {
            store.resetAll();
            setSelectedRoute(null);
            setProjectIdeaDraft('');
            setExtraWsMessages([]);
            setNotice('Demo state reset.');
            navigate('/relay');
          }}
        >
          RESET
        </button>
        <RelayDemoSimulationControls
          state={demoSimulation.state}
          onPlay={playDemo}
          onPause={demoSimulation.pause}
          onResume={demoSimulation.resume}
          onNext={demoSimulation.next}
          onRestart={demoSimulation.restart}
          onExit={exitDemo}
          onSpeed={demoSimulation.setSpeed}
        />
        <span className="rpv-appearance" role="group" aria-label="Appearance">
          <span className="rpv-switcher-tag">APPEARANCE</span>
          {RELAY_COLORWAYS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={colorway === c}
              onClick={() => setColorway(c)}
            >
              {COLORWAY_LABEL[c]}
            </button>
          ))}
        </span>
        <span className="rpv-zoom" role="group" aria-label="Preview zoom">
          <span className="rpv-switcher-tag">ZOOM</span>
          {DEV_ZOOM_LEVELS.map((z) => (
            <button
              key={z}
              type="button"
              aria-pressed={zoom === z}
              onClick={() => setZoom(z)}
            >
              {z}%
            </button>
          ))}
        </span>
        {route.screen === 'home' && (
          <button
            type="button"
            onClick={() => setRecentPopulated((v) => !v)}
            aria-pressed={recentPopulated}
          >
            {recentPopulated ? 'RECENT: FIXTURES' : 'RECENT: EMPTY'}
          </button>
        )}
        {route.screen === 'workspace' && route.projectId === 'rly-001' && (
          <span className="rpv-fixture-picker" role="group" aria-label="Workspace fixture state">
            {WORKSPACE_FIXTURE_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={fixtureKey === k}
                onClick={() => {
                  setFixtureKey(k);
                  setExtraWsMessages([]);
                }}
              >
                {k.replace(/_/g, ' ').toUpperCase()}
              </button>
            ))}
          </span>
        )}
      </nav>
      </>
      )}
    </div>
  );
}

/** Safe not-found / redirect state — never exposes a stack trace. */
function SafeNotFound({
  title,
  detail,
  actionLabel,
  onAction,
  onHome,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  onHome: () => void;
}) {
  return (
    <div className="rpv-notfound" role="alert">
      <p className="rpv-notfound-title">{title}</p>
      <p className="rpv-notfound-detail">{detail}</p>
      <div className="rpv-notfound-actions">
        {actionLabel && onAction && (
          <button type="button" className="rpv-notfound-btn rpv-notfound-btn--primary" onClick={onAction}>
            {actionLabel}
          </button>
        )}
        <button type="button" className="rpv-notfound-btn" onClick={onHome}>
          ← RELAY HOME
        </button>
      </div>
    </div>
  );
}
