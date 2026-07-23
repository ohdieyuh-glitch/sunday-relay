import { useCallback, useEffect, useMemo, useState } from 'react';
import { MissionControl } from '../MissionControl';
import { RelayEntryHome } from '../entry-home';
import {
  DEFAULT_CONNECTION_STATUSES,
  FIXTURE_GUIDE_MESSAGES,
  FIXTURE_RECENT_PROJECTS,
  SUGGESTED_QUESTIONS,
  buildEvidenceRecommendation,
  buildProjectBriefDraft,
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
  WORKSPACE_FIXTURES,
  WORKSPACE_FIXTURE_KEYS,
  buildConfiguredWorkspaceState,
} from '../project-workspace';
import type {
  ConfiguredWorkspaceState,
  ProjectMessage,
  WorkspaceFixtureKey,
} from '../project-workspace';
import { AGENT_OPTIONS, RelayProjectSettings } from '../project-settings';
import type { ProjectSettingsDraft } from '../project-settings';
import { configuredStartFromSettingsDraft } from './configured-start';
import { COLORWAY_LABEL, applyRelayColorway, nextColorway } from './colorway';
import type { RelayColorway } from './colorway';
import './relay-preview.css';

/**
 * ISOLATED FRONTEND PREVIEW SHELL — development-only route wiring so the
 * founder can walk the full product flow in a browser:
 *
 *   #/relay                            → Relay Entry Home
 *   #/relay/project-settings           → Project Settings integration boundary
 *   #/relay/project/:projectId         → Active Relay Project Workspace
 *   #/relay/project/:projectId/terminal→ full-screen Live Terminal
 *   #/relay/console                    → execution console (Mission Control)
 *
 * Hash routing keeps this branch's integration narrow (no server rewrites,
 * no main-worktree router changes). The bottom-right DEV PREVIEW switcher —
 * including the workspace fixture selector — is a development tool only and
 * is NOT part of any production component contract. All state lives here in
 * memory; nothing is persisted, no provider is called, and workspace
 * scenarios are clearly-labeled fixtures.
 */

export type PreviewRoute =
  | { screen: 'home' }
  | { screen: 'project-settings' }
  | { screen: 'console' }
  | { screen: 'workspace'; projectId: string; terminal: boolean };

export function parsePreviewHash(hash: string): PreviewRoute {
  const clean = hash.replace(/^#/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts[0] !== 'relay') return { screen: 'home' };
  if (parts[1] === 'project-settings') return { screen: 'project-settings' };
  if (parts[1] === 'console') return { screen: 'console' };
  if (parts[1] === 'project' && parts[2]) {
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

export function RelayPreviewApp() {
  const [route, navigate] = useHashRoute();
  const [mobileFrame, setMobileFrame] = useState(false);
  // Colorway: OBSIDIAN (original) / MIDNIGHT (founder website photo).
  const [colorway, setColorway] = useState<RelayColorway>('obsidian');
  useEffect(() => {
    applyRelayColorway(colorway, document.documentElement);
  }, [colorway]);

  /* ---------------- entry-home state (preview host, memory only) ------ */
  const [projectIdeaDraft, setProjectIdeaDraft] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<ProjectRouteDefinition | null>(null);
  const [projectBriefDraft, setProjectBriefDraft] = useState<ProjectBriefDraft | null>(null);
  const [guideMessages, setGuideMessages] = useState<GuideMessage[]>(FIXTURE_GUIDE_MESSAGES);
  const [recentPopulated, setRecentPopulated] = useState(true);
  const [handoffDraft, setHandoffDraft] = useState<ProjectBriefDraft | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);
  // Recorded by Project Settings callbacks and restored on return (memory only).
  const [savedSettingsDraft, setSavedSettingsDraft] = useState<ProjectSettingsDraft | null>(null);

  /* ---------------- workspace preview state (fixtures only) ----------- */
  const [fixtureKey, setFixtureKey] = useState<WorkspaceFixtureKey>('implementing');
  const [extraWsMessages, setExtraWsMessages] = useState<ProjectMessage[]>([]);
  // The honest configured-but-idle workspace built from the founder's
  // actual START PROJECT draft (memory only; no mission runs).
  const [startedProject, setStartedProject] = useState<ConfiguredWorkspaceState | null>(null);

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

  const continueToProjectSettings = (draft: ProjectBriefDraft) => {
    setHandoffDraft(draft);
    navigate('/relay/project-settings');
  };

  const copyBrief = (formatted: string) => {
    // Preview-only convenience; the component itself never touches the clipboard.
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(formatted).catch(() => undefined);
    }
    setCopiedNotice(true);
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

  const home = (
    <RelayEntryHome
      productState={projectBriefDraft ? 'draft' : 'unconfigured'}
      currentProject={null}
      recentProjects={recentPopulated ? FIXTURE_RECENT_PROJECTS : []}
      projectIdeaDraft={projectIdeaDraft}
      projectBriefDraft={projectBriefDraft}
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
      onReturnToSunday={() => {
        window.location.href = '/';
      }}
      onSelectProjectRoute={(r) => {
        setSelectedRoute(r);
        setProjectIdeaDraft(r.objectiveTemplate);
      }}
      onUpdateProjectIdea={setProjectIdeaDraft}
      onBuildProjectBrief={(objective) =>
        setProjectBriefDraft(buildProjectBriefDraft(objective, selectedRoute))
      }
      onConnectExistingProject={() => {
        // Future integration callback: repository/project source selection.
        askRelay('Connect an existing project');
      }}
      onAskRelay={askRelay}
      onSelectSuggestedQuestion={askRelay}
      onUpdateProjectBriefDraft={(patch) =>
        setProjectBriefDraft((d) => (d ? { ...d, ...patch } : d))
      }
      onCopyProjectBrief={copyBrief}
      onClearProjectBrief={() => {
        setProjectBriefDraft(null);
        setHandoffDraft(null); // never prefill Settings from a cleared brief
      }}
      onContinueToProjectSettings={continueToProjectSettings}
      onOpenRecentProject={(projectId) => navigate(`/relay/project/${projectId}`)}
      onOpenProjectSettings={() => navigate('/relay/project-settings')}
      onOpenTerminal={() => navigate('/relay/project/rly-001/terminal')}
    />
  );

  const projectSettings = (
    <RelayProjectSettings
      brief={handoffDraft ?? projectBriefDraft}
      agentOptions={AGENT_OPTIONS}
      entitlement="pro"
      initialDraft={savedSettingsDraft ?? undefined}
      onSaveDraft={(d: ProjectSettingsDraft) => setSavedSettingsDraft(d)}
      onStartProject={(d: ProjectSettingsDraft) => {
        // Preview only: the callback records the typed draft and opens the
        // honest configured-but-idle workspace built from it. No mission
        // actually starts — the console stays empty on STANDBY.
        setSavedSettingsDraft(d);
        setStartedProject(
          buildConfiguredWorkspaceState(configuredStartFromSettingsDraft(d, 'rly-002', 'RLY / 002')),
        );
        setExtraWsMessages([]);
        navigate('/relay/project/rly-002');
      }}
      onConnectRepository={() => {
        // Future integration callback: repository/source selection.
      }}
      onBack={() => navigate('/relay')}
    />
  );

  // The started project (from the founder's actual draft) takes its own
  // route; every other project id shows the labeled fixture scenarios.
  const onStartedProject =
    route.screen === 'workspace' &&
    startedProject !== null &&
    route.projectId === startedProject.project.projectId;
  const wsState = onStartedProject ? startedProject : WORKSPACE_FIXTURES[fixtureKey];
  // The `>_` control always switches into full Terminal Mode (founder direction).
  const terminalOpen = route.screen === 'workspace' && route.terminal;
  const workspace = (
    <RelayProjectWorkspace
      {...wsState}
      projectMessages={[...wsState.projectMessages, ...extraWsMessages]}
      terminalOpen={terminalOpen}
      terminalFullScreen
      onSendProjectMessage={(text) => {
        pushWsMessage('developer', text);
        pushWsMessage(
          'relay',
          'Preview response: in the live product Relay answers from the mission state. No mission is actually running.',
        );
      }}
      onApproveDecision={(decisionId) =>
        pushWsMessage('relay', `Preview: decision ${decisionId} approval recorded (fixture only — nothing executed).`)
      }
      onRejectDecision={(decisionId) =>
        pushWsMessage('relay', `Preview: decision ${decisionId} rejection recorded (fixture only — nothing executed).`)
      }
      onOpenTerminal={() => {
        if (route.screen === 'workspace') navigate(`/relay/project/${route.projectId}/terminal`);
      }}
      onCloseTerminal={() => {
        if (route.screen === 'workspace') navigate(`/relay/project/${route.projectId}`);
      }}
      onOpenProjectSettings={() => navigate('/relay/project-settings')}
      onOpenManualTask={(taskId) =>
        pushWsMessage('relay', `Preview: opened Manual Task ${taskId} details (fixture only).`)
      }
      onApproveManualTask={(taskId) =>
        pushWsMessage('relay', `Preview: Manual Task ${taskId} approval recorded (fixture only — nothing executed).`)
      }
      onRejectManualTask={(taskId) =>
        pushWsMessage('relay', `Preview: Manual Task ${taskId} kept blocked (fixture only).`)
      }
      onRequestResearch={(topic) =>
        pushWsMessage('relay', `Preview: research request "${topic}" recorded (fixture only — no research runs).`)
      }
      onOpenFinding={(findingId) =>
        pushWsMessage('relay', `Preview: opened finding ${findingId} (fixture only).`)
      }
      onOpenRepair={(repairId) =>
        pushWsMessage('relay', `Preview: opened repair ${repairId} (fixture only).`)
      }
      onReturnHome={() => navigate('/relay')}
    />
  );

  let screen: JSX.Element;
  if (route.screen === 'console') screen = <MissionControl />;
  else if (route.screen === 'project-settings') screen = projectSettings;
  else if (route.screen === 'workspace') screen = workspace;
  else screen = home;

  return (
    <div className="rpv">
      {mobileFrame && route.screen !== 'console' ? (
        <div className="rpv-mobile-frame">
          <div className="rpv-mobile-viewport">{screen}</div>
        </div>
      ) : (
        screen
      )}

      {copiedNotice && (
        <p className="rpv-notice" role="status">
          Draft copied (preview clipboard).{' '}
          <button type="button" onClick={() => setCopiedNotice(false)}>
            dismiss
          </button>
        </p>
      )}

      <nav className="rpv-switcher" aria-label="Development preview switcher">
        <span className="rpv-switcher-tag">DEV PREVIEW</span>
        <button type="button" onClick={() => navigate('/relay')} aria-pressed={route.screen === 'home'}>
          HOME
        </button>
        <button
          type="button"
          onClick={() => navigate('/relay/project-settings')}
          aria-pressed={route.screen === 'project-settings'}
        >
          SETTINGS
        </button>
        <button
          type="button"
          onClick={() => navigate('/relay/project/rly-001')}
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
          onClick={() => setColorway((c) => nextColorway(c))}
          aria-pressed={colorway !== 'obsidian'}
        >
          {COLORWAY_LABEL[colorway]}
        </button>
        {route.screen === 'home' && (
          <button type="button" onClick={() => setRecentPopulated((v) => !v)} aria-pressed={recentPopulated}>
            {recentPopulated ? 'RECENT: FIXTURES' : 'RECENT: EMPTY'}
          </button>
        )}
        {route.screen === 'workspace' && !onStartedProject && (
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
        {route.screen === 'workspace' && onStartedProject && (
          <span className="rpv-switcher-tag">CONFIGURED FROM SETTINGS</span>
        )}
      </nav>
    </div>
  );
}
