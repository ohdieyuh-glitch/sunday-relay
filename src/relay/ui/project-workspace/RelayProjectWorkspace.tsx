import { RelayProjectHeader } from './RelayProjectHeader';
import { RelayWorkforceStrip } from './RelayWorkforceStrip';
import { RelayProjectConversation } from './RelayProjectConversation';
import { RelayLiveTerminalPanel } from './RelayLiveTerminalPanel';
import { RelayProjectPhaseRail } from './RelayProjectPhaseRail';
import { RelayManualTaskPanel } from './RelayManualTaskPanel';
import { RelayReviewerStatus } from './RelayReviewerStatus';
import { RelayVerificationSummary } from './RelayVerificationSummary';
import { RelayResearchStatus } from './RelayResearchStatus';
import { RelayProjectBrainStatus } from './RelayProjectBrainStatus';
import { RelayWorkspaceDog } from './RelayWorkspaceDog';
import { RelayProjectFooter } from './RelayProjectFooter';
import { OUTPUT_STATE_LABEL, completionDisplay } from './projections';
import type { RelayProjectWorkspaceProps } from './contracts';

/**
 * ACTIVE RELAY PROJECT WORKSPACE — the main operating screen for a
 * configured, intentionally started Relay project. The deployed browser
 * application projection of safe normalized Relay activity — NOT the CLI,
 * not a raw terminal, not a chatbot, not an analytics dashboard.
 *
 * Flow: Entry Home → Project Settings → THIS SCREEN.
 *
 * All execution state enters through props. The UI never launches agents,
 * never decides permissions or completion, never validates findings, never
 * generates canonical events, and never mutates Relay Core.
 */
export function RelayProjectWorkspace(props: RelayProjectWorkspaceProps) {
  const {
    project,
    mission,
    workforce,
    mode,
    phase,
    outputState,
    dogState,
    handoffNetworkState,
    projectMessages,
    terminalEvents,
    manualTasks,
    verificationSummary,
    reviewerState,
    findings,
    repairs,
    researchState,
    projectBrainState,
    completionState,
    researchEnabled,
    repairUsed,
    terminalOpen,
    terminalFullScreen = false,
    reducedMotion = false,
    onSendProjectMessage,
    onApproveDecision,
    onRejectDecision,
    onOpenTerminal,
    onCloseTerminal,
    onOpenProjectSettings,
    onOpenManualTask,
    onApproveManualTask,
    onRejectManualTask,
    onRequestResearch,
    onOpenFinding,
    onOpenRepair,
    onReturnHome,
  } = props;

  const completion = completionDisplay({ completionState, reviewerState, findings, repairs });
  const openTasks = manualTasks.filter((t) => t.status === 'open').length;

  return (
    <div className="rpw">
      <div className="rpw-grid-bg" aria-hidden="true" />
      <div className="rpw-scanlines" aria-hidden="true" />

      <p className="rpw-visually-hidden" role="status" aria-live="polite">
        Project {project.name}. State {OUTPUT_STATE_LABEL[outputState]}. Relay Dog {dogState.replace(/_/g, ' ')}.
      </p>

      <RelayProjectHeader
        project={project}
        outputState={outputState}
        openManualTasks={openTasks}
        onReturnHome={onReturnHome}
        onOpenProjectSettings={onOpenProjectSettings}
        onOpenTerminal={onOpenTerminal}
      />

      <RelayWorkforceStrip workforce={workforce} mode={mode} phase={phase} />

      <main className="rpw-main">
        <div className="rpw-workspace">
          <div className="rpw-col-primary">
            <section className="rpw-mission" aria-labelledby="rpw-mission-heading">
              <p className="rpw-syslabel">{project.reference} / ACTIVE MISSION</p>
              <h1 id="rpw-mission-heading" className="rpw-h1">
                {mission.title}
              </h1>
              <p className="rpw-mission-summary">{mission.summary}</p>
            </section>

            {completion.showVerifiedComplete ? (
              <section className="rpw-completion rpw-completion--verified" aria-label="Mission verdict">
                <p className="rpw-completion-verdict">
                  MISSION VERDICT — <strong>VERIFIED COMPLETE</strong>
                </p>
                <ul className="rpw-completion-evidence">
                  {completionState.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </section>
            ) : (
              completionState.verdict === 'verified_complete' && (
                <section className="rpw-completion rpw-completion--held" aria-label="Mission verdict held">
                  <p className="rpw-completion-verdict">COMPLETION HELD</p>
                  <ul className="rpw-completion-evidence">
                    {completion.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </section>
              )
            )}

            <RelayManualTaskPanel
              tasks={manualTasks}
              onOpenManualTask={onOpenManualTask}
              onApproveManualTask={onApproveManualTask}
              onRejectManualTask={onRejectManualTask}
            />

            <RelayProjectConversation
              messages={projectMessages}
              onSendProjectMessage={onSendProjectMessage}
              onApproveDecision={onApproveDecision}
              onRejectDecision={onRejectDecision}
            />
          </div>

          <aside className="rpw-col-side">
            <section className="rpw-dogpanel" aria-label="Relay Dog state">
              <RelayWorkspaceDog state={dogState} reducedMotion={reducedMotion} />
            </section>

            <RelayProjectPhaseRail
              phase={phase}
              researchEnabled={researchEnabled}
              repairUsed={repairUsed}
              blockingOpen={completion.blockers.length > 0 && !completion.showVerifiedComplete}
              verified={completion.showVerifiedComplete}
            />

            <RelayVerificationSummary summary={verificationSummary} />

            <RelayReviewerStatus
              reviewerName={workforce.reviewer.name}
              state={reviewerState}
              findings={findings}
              repairs={repairs}
              onOpenFinding={onOpenFinding}
              onOpenRepair={onOpenRepair}
            />

            <RelayResearchStatus state={researchState} onRequestResearch={onRequestResearch} />
            <RelayProjectBrainStatus state={projectBrainState} />
          </aside>
        </div>
      </main>

      <RelayProjectFooter handoffNetworkState={handoffNetworkState} outputState={outputState} />

      {terminalOpen && (
        <div className="rpw-terminal-overlay">
          <RelayLiveTerminalPanel
            project={project}
            mission={mission}
            events={terminalEvents}
            handoffNetworkState={handoffNetworkState}
            fullScreen={terminalFullScreen}
            onClose={onCloseTerminal}
          />
        </div>
      )}
    </div>
  );
}
