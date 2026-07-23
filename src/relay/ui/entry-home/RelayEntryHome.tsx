import { RelayEntryHeader } from './RelayEntryHeader';
import { RelayProjectStarter } from './RelayProjectStarter';
import { RelayHomeDog } from './RelayHomeDog';
import { RelayProjectRoutes } from './RelayProjectRoutes';
import { RelayGuideChat } from './RelayGuideChat';
import { RelayRecentProjects } from './RelayRecentProjects';
import { RelayEntryFooter } from './RelayEntryFooter';
import type { RelayEntryHomeProps } from './contracts';

/**
 * RELAY ENTRY HOME — the authenticated in-product screen shown immediately
 * after switching from Sunday Alcatraz into Sunday Relay, BEFORE Project
 * Settings and BEFORE the Active Project Workspace.
 *
 * Flow: Sunday Alcatraz → Relay Home → Project Settings → workspace.
 *
 * Deliberately calm and spacious: three immediate choices (start from an
 * idea, choose a route, connect an existing project), the Ask Relay guide
 * available without dominating, recent projects compact. Workforce and
 * research configuration live in Project Settings, not here. This screen
 * never starts execution, never fabricates activity, and never decides
 * policy — state in via props, intent out via callbacks. Browser-safe.
 */
export function RelayEntryHome(props: RelayEntryHomeProps) {
  const {
    productState,
    recentProjects,
    projectIdeaDraft,
    projectBriefDraft,
    selectedRoute,
    guideMessages,
    guideStatus,
    suggestedQuestions,
    dogState,
    handoffNetworkState,
    reducedMotion = false,
    onReturnToSunday,
    onSelectProjectRoute,
    onUpdateProjectIdea,
    onBuildProjectBrief,
    onConnectExistingProject,
    onAskRelay,
    onSelectSuggestedQuestion,
    onUpdateProjectBriefDraft,
    onCopyProjectBrief,
    onClearProjectBrief,
    onContinueToProjectSettings,
    onOpenRecentProject,
    onOpenProjectSettings,
    onOpenTerminal,
  } = props;

  return (
    <div className="reh">
      <div className="reh-grid-bg" aria-hidden="true" />
      <div className="reh-scanlines" aria-hidden="true" />

      <RelayEntryHeader
        productState={productState}
        handoffNetworkState={handoffNetworkState}
        onReturnToSunday={onReturnToSunday}
        onOpenProjectSettings={onOpenProjectSettings}
        onOpenTerminal={onOpenTerminal}
      />

      <main className="reh-main">
        <div className="reh-start-zone">
          <RelayHomeDog state={dogState} reducedMotion={reducedMotion} />
          <RelayProjectStarter
            projectIdeaDraft={projectIdeaDraft}
            projectBriefDraft={projectBriefDraft}
            onUpdateProjectIdea={onUpdateProjectIdea}
            onBuildProjectBrief={onBuildProjectBrief}
            onConnectExistingProject={onConnectExistingProject}
            onOpenProjectSettings={onOpenProjectSettings}
          />
        </div>

        <RelayProjectRoutes
          selectedRoute={selectedRoute}
          onSelectProjectRoute={onSelectProjectRoute}
        />

        <RelayGuideChat
          messages={guideMessages}
          status={guideStatus}
          suggestedQuestions={suggestedQuestions}
          projectBriefDraft={projectBriefDraft}
          onSendMessage={onAskRelay}
          onSelectSuggestedQuestion={onSelectSuggestedQuestion}
          onUpdateProjectBriefDraft={onUpdateProjectBriefDraft}
          onCopyProjectBrief={onCopyProjectBrief}
          onClearProjectBrief={onClearProjectBrief}
          onContinueToProjectSettings={onContinueToProjectSettings}
        />

        <RelayRecentProjects projects={recentProjects} onOpenRecentProject={onOpenRecentProject} />
      </main>

      <RelayEntryFooter handoffNetworkState={handoffNetworkState} productState={productState} />
    </div>
  );
}
