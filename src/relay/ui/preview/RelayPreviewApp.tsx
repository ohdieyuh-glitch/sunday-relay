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
import './relay-preview.css';

/**
 * ISOLATED FRONTEND PREVIEW SHELL — development-only route wiring so the
 * founder can walk the product flow in a browser:
 *
 *   #/relay                        → Relay Entry Home
 *   #/relay/project-settings       → Project Settings integration boundary
 *   #/relay/console                → existing execution console (Mission Control)
 *
 * Hash routing keeps this branch's integration narrow (no server rewrites,
 * no main-worktree router changes). The preview switcher at the bottom is a
 * DEV TOOL ONLY and is not part of any production component contract.
 * State lives here (in memory only) — the Entry Home itself is a controlled,
 * browser-safe component. Nothing is persisted; no provider is called.
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

  /* ---------------- entry-home state (preview host, memory only) ------ */
  const [projectIdeaDraft, setProjectIdeaDraft] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<ProjectRouteDefinition | null>(null);
  const [projectBriefDraft, setProjectBriefDraft] = useState<ProjectBriefDraft | null>(null);
  const [guideMessages, setGuideMessages] = useState<GuideMessage[]>(FIXTURE_GUIDE_MESSAGES);
  const [recentPopulated, setRecentPopulated] = useState(true);
  const [handoffDraft, setHandoffDraft] = useState<ProjectBriefDraft | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);

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
      onClearProjectBrief={() => setProjectBriefDraft(null)}
      onContinueToProjectSettings={continueToProjectSettings}
      onOpenRecentProject={(projectId) => navigate(`/relay/project/${projectId}`)}
      onOpenProjectSettings={() => navigate('/relay/project-settings')}
      onOpenTerminal={() => navigate('/relay/project/rly-001/terminal')}
    />
  );

  const projectSettings = (
    <div className="rpv-settings">
      <p className="rpv-settings-label">PROJECT SETTINGS / INTEGRATION BOUNDARY</p>
      <h1>Project Settings</h1>
      <p className="rpv-settings-copy">
        This screen is the next step after the Relay Entry Home. In this isolated frontend branch it
        is an explicit integration boundary: the full Project Settings experience is built
        separately. The structured Project Brief Draft below was received through
        <code> onContinueToProjectSettings(projectBriefDraft)</code>.
      </p>
      {handoffDraft ? (
        <pre className="rpv-settings-draft" aria-label="Received Project Brief Draft">
          {JSON.stringify(handoffDraft, null, 2)}
        </pre>
      ) : (
        <p className="rpv-settings-empty">
          No draft received yet. Build a Project Brief on the Relay Home first.
        </p>
      )}
      <button type="button" className="reh-btn" onClick={() => navigate('/relay')}>
        ← BACK TO RELAY HOME
      </button>
    </div>
  );

  const workspacePlaceholder = (
    <div className="rpv-settings">
      <p className="rpv-settings-label">ACTIVE PROJECT WORKSPACE</p>
      <h1>Relay Project Workspace</h1>
      <p className="rpv-settings-copy">
        The active workspace opens after Project Settings is confirmed and a mission begins.
      </p>
      <button type="button" className="reh-btn" onClick={() => navigate('/relay')}>
        ← BACK TO RELAY HOME
      </button>
    </div>
  );

  let screen: JSX.Element;
  if (route.screen === 'console') screen = <MissionControl />;
  else if (route.screen === 'project-settings') screen = projectSettings;
  else if (route.screen === 'workspace') screen = workspacePlaceholder;
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
          onClick={() => navigate('/relay/console')}
          aria-pressed={route.screen === 'console'}
        >
          CONSOLE
        </button>
        <button type="button" onClick={() => setMobileFrame((v) => !v)} aria-pressed={mobileFrame}>
          {mobileFrame ? 'DESKTOP' : 'MOBILE'}
        </button>
        <button type="button" onClick={() => setRecentPopulated((v) => !v)} aria-pressed={recentPopulated}>
          {recentPopulated ? 'RECENT: FIXTURES' : 'RECENT: EMPTY'}
        </button>
      </nav>
    </div>
  );
}
