import { RelayProjectHeader } from './RelayProjectHeader';
import { RelayWorkforceStrip } from './RelayWorkforceStrip';
import { RelayConsole } from './RelayConsole';
import { RelayProjectConversation } from './RelayProjectConversation';
import { RelayLiveTerminalPanel } from './RelayLiveTerminalPanel';
import { RelayCodingAgentTerminal } from './RelayCodingAgentTerminal';
import { RelayRoleBilling } from './RelayRoleBilling';
import { RelayProjectPhaseRail } from './RelayProjectPhaseRail';
import { RelayManualTaskPanel } from './RelayManualTaskPanel';
import { RelayReviewerStatus } from './RelayReviewerStatus';
import { RelayVerificationSummary } from './RelayVerificationSummary';
import { RelayResearchStatus } from './RelayResearchStatus';
import { RelayProjectBrainStatus } from './RelayProjectBrainStatus';
import { RelayWorkspaceDog } from './RelayWorkspaceDog';
import { RelayProjectFooter } from './RelayProjectFooter';
import { RelayPspAgentImport } from '../psp-import';
import { OUTPUT_STATE_LABEL, completionDisplay } from './projections';
import type { RelayProjectWorkspaceProps } from './contracts';
import type {
  PSPAgentImportRecord,
  PSPEntitlementServicePort,
  PSPWorkspaceContext,
} from '../../psp';

/**
 * ACTIVE RELAY PROJECT WORKSPACE — the main operating screen for a
 * configured, intentionally started Relay project, drawn to the founder
 * screenshots: one framed system interface — header, continuous workforce
 * strip, the RELAY CONSOLE as the dominant surface, the project
 * conversation docked beneath it, one supporting status rail, and the Pixel
 * Relay Dog on the glowing system floor. This is the deployed BROWSER
 * APPLICATION — not the CLI, not a raw terminal, not a chatbot.
 *
 * Flow: Entry Home → Project Settings → THIS SCREEN.
 *
 * All execution state enters through props. The UI never launches agents,
 * never decides permissions or completion, never validates findings, never
 * generates canonical events, and never mutates Relay Core.
 */
/**
 * Relay Workspace -> Agents -> Import PSP Agent.
 *
 * Declared here rather than in `contracts.ts` and OPTIONAL by design: the
 * Agents panel needs a workspace/actor context and an entitlement service
 * port, and no production entitlement backend exists yet. A surface that can
 * supply them (the preview app, and later the signed-in application) passes
 * this prop; every other caller is unchanged and renders exactly as before.
 */
export interface RelayWorkspaceAgentsPanel {
  workspace: PSPWorkspaceContext;
  service: PSPEntitlementServicePort;
  now: () => string;
  importId: () => string;
  importedAgents?: PSPAgentImportRecord[];
  onImported?: (record: PSPAgentImportRecord) => void;
}

export function RelayProjectWorkspace(
  props: RelayProjectWorkspaceProps & { agentsPanel?: RelayWorkspaceAgentsPanel },
) {
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
        Project {project.name}. State {OUTPUT_STATE_LABEL[outputState]}. Relay Dog{' '}
        {dogState.replace(/_/g, ' ')}.
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
        {/* The Relay Dog sits centered between the workforce strip and the
            Relay Console (founder direction). */}
        <div className="rpw-dogzone">
          <RelayWorkspaceDog state={dogState} reducedMotion={reducedMotion} />
        </div>
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

        <div className="rpw-workspace">
          <div className="rpw-col-primary">
            {props.missionPlayback}
            {props.codingTerminal && (
              <RelayCodingAgentTerminal view={props.codingTerminal} reducedMotion={reducedMotion} />
            )}
            {props.roleBilling && props.roleBilling.length > 0 && (
              <RelayRoleBilling rows={props.roleBilling} />
            )}
            <RelayConsole
              events={terminalEvents}
              handoffNetworkState={handoffNetworkState}
              onOpenTerminal={onOpenTerminal}
            />
            <RelayProjectConversation
              messages={projectMessages}
              onSendProjectMessage={onSendProjectMessage}
              onApproveDecision={onApproveDecision}
              onRejectDecision={onRejectDecision}
            />
          </div>

          <aside className="rpw-status" aria-label="System status">
            <div className="rpw-status-block">
              <RelayProjectPhaseRail
                phase={phase}
                researchEnabled={researchEnabled}
                repairUsed={repairUsed}
                blockingOpen={completion.blockers.length > 0 && !completion.showVerifiedComplete}
                verified={completion.showVerifiedComplete}
              />
            </div>
            <div className="rpw-status-block">
              <RelayVerificationSummary summary={verificationSummary} />
            </div>
            <div className="rpw-status-block">
              <RelayReviewerStatus
                reviewerName={workforce.reviewer.name}
                state={reviewerState}
                findings={findings}
                repairs={repairs}
                onOpenFinding={onOpenFinding}
                onOpenRepair={onOpenRepair}
              />
            </div>
            <div className="rpw-status-block">
              <RelayResearchStatus state={researchState} onRequestResearch={onRequestResearch} />
            </div>
            <div className="rpw-status-block">
              <RelayProjectBrainStatus state={projectBrainState} />
            </div>
            {props.agentsPanel && (
              <div className="rpw-status-block">
                <RelayPspAgentImport
                  workspace={props.agentsPanel.workspace}
                  service={props.agentsPanel.service}
                  now={props.agentsPanel.now}
                  importId={props.agentsPanel.importId}
                  importedAgents={props.agentsPanel.importedAgents}
                  onImported={props.agentsPanel.onImported}
                />
              </div>
            )}
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
            workforce={workforce}
            mode={mode}
            outputState={outputState}
            codingTerminal={props.codingTerminal}
            fullScreen={terminalFullScreen}
            reducedMotion={reducedMotion}
            onClose={onCloseTerminal}
            onSendProjectMessage={onSendProjectMessage}
          />
        </div>
      )}
    </div>
  );
}
