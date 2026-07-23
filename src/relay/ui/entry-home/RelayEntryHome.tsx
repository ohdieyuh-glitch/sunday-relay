import { RelayEntryHeader } from './RelayEntryHeader';
import { RelayProjectStarter } from './RelayProjectStarter';
import { RelayHomeDog } from './RelayHomeDog';
import { RelayProjectRoutes } from './RelayProjectRoutes';
import { RelayGuideChat } from './RelayGuideChat';
import { RelayWorkforceRecommendation } from './RelayWorkforceRecommendation';
import { RelayResearchPreview } from './RelayResearchPreview';
import { RelayRecentProjects } from './RelayRecentProjects';
import { RelayEntryFooter } from './RelayEntryFooter';
import type { RelayEntryHomeProps } from './contracts';

/**
 * RELAY ENTRY HOME — the authenticated in-product screen shown immediately
 * after switching from Sunday Alcatraz into Sunday Relay, BEFORE Project
 * Settings and BEFORE the Relay execution console.
 *
 * Flow: Sunday Alcatraz → Relay Home → Project Settings → execution console.
 *
 * This screen never starts execution, never fabricates activity, and never
 * decides policy — all state enters through props and all intent leaves
 * through callbacks. Browser-safe: no Node, no providers, no credentials.
 */
export function RelayEntryHome(props: RelayEntryHomeProps) {
  const {
    productState,
    recentProjects,
    projectIdeaDraft,
    projectBriefDraft,
    selectedRoute,
    workforceRecommendation,
    researchRecommendation,
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
          <div className="reh-start-left">
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

          <div className="reh-start-right">
            <RelayWorkforceRecommendation recommendation={workforceRecommendation} />
            <RelayResearchPreview recommendation={researchRecommendation} />
            <section className="reh-nextstep" aria-labelledby="reh-nextstep-heading">
              <h2 id="reh-nextstep-heading" className="reh-section-title">
                NEXT STEP
              </h2>
              <p>
                Review your project details, select your AI workforce, configure research, set
                permissions, and define what Relay must prove before completion.
              </p>
              <button
                type="button"
                className="reh-btn reh-btn--primary"
                disabled={!projectBriefDraft}
                onClick={() => projectBriefDraft && onContinueToProjectSettings(projectBriefDraft)}
              >
                CONTINUE TO PROJECT SETTINGS
              </button>
            </section>
          </div>
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
