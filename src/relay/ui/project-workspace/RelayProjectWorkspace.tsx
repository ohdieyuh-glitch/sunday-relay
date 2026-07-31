import { useCallback, useRef, useState } from 'react';

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
import {
  RelayFocusBackdrop,
  RelayFocusedPanel,
  RelayPanelExpandButton,
  type RelayFocusablePanel,
} from './RelayPanelFocus';
import { RelayAgentOperatingInspector } from './RelayAgentOperatingInspector';
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

  /**
   * WHICH PANEL IS FOCUSED — view state, and only view state.
   *
   * No mission, terminal or agent state lives here, and nothing is copied into
   * a fullscreen-only store: focusing a panel changes one string. The panels
   * themselves never leave the tree, so expanding one cannot restart an agent,
   * duplicate a terminal or lose output.
   */
  const [requestedFocus, setRequestedFocus] = useState<RelayFocusablePanel | null>(null);
  /**
   * A PANEL THAT IS NOT RENDERED CANNOT BE FOCUSED. The Coding Agent panel
   * exists only while there is a terminal view; if that goes away while it is
   * focused, the stored id would leave a backdrop over an empty workspace with
   * nothing to close. Focus is therefore derived, not merely stored.
   */
  const focusedPanel: RelayFocusablePanel | null =
    requestedFocus === 'coding_agent' && props.codingTerminal === undefined ? null : requestedFocus;
  const setFocusedPanel = setRequestedFocus;
  const expandRefs = useRef<Partial<Record<RelayFocusablePanel, HTMLButtonElement | null>>>({});

  const toggleFocus = useCallback((panel: RelayFocusablePanel) => {
    setFocusedPanel((current) => (current === panel ? null : panel));
  }, []);
  const closeFocus = useCallback(() => setFocusedPanel(null), []);

  /**
   * Wraps a panel IN PLACE with the canonical expand control and focused
   * shell. `agent` adds the four operating components to the focused view, so
   * a focused agent shows what is running it without the workforce strip.
   */
  const focusable = (
    panel: RelayFocusablePanel,
    content: React.ReactNode,
    agentRole?: 'prompt_architect' | 'coding_agent' | 'reviewer',
  ) => {
    const focused = focusedPanel === panel;
    const profile = agentRole === undefined
      ? undefined
      : props.operatingProfiles?.find((p) => p.role === agentRole);
    return (
      <RelayFocusedPanel
        panel={panel}
        focused={focused}
        onClose={closeFocus}
        returnFocusTo={expandRefs.current[panel] ?? null}
      >
        <RelayPanelExpandButton
          panel={panel}
          focused={focused}
          onToggle={toggleFocus}
          buttonRef={(node) => { expandRefs.current[panel] = node; }}
        />
        {content}
        {focused && profile !== undefined && (
          <RelayAgentOperatingInspector projection={profile} />
        )}
      </RelayFocusedPanel>
    );
  };

  return (
    <div className="rpw" data-panel-focused={focusedPanel !== null ? 'true' : 'false'}>
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

      {/* The four canonical operating components per Relay Dog, from the SAME
          projection `relay agent profile` prints. Simulated until a runtime is
          actually attached, and the inspector says so. */}
      <RelayWorkforceStrip
        workforce={workforce}
        mode={mode}
        phase={phase}
        operating={props.operatingProfiles}
      />

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

        {focusable('manual_tasks', (
          <RelayManualTaskPanel
            tasks={manualTasks}
            onOpenManualTask={onOpenManualTask}
            onApproveManualTask={onApproveManualTask}
            onRejectManualTask={onRejectManualTask}
          />
        ))}

        <div className="rpw-workspace">
          <div className="rpw-col-primary">
            {props.missionPlayback}
            {props.codingTerminal && focusable(
              'coding_agent',
              <RelayCodingAgentTerminal view={props.codingTerminal} reducedMotion={reducedMotion} />,
              'coding_agent',
            )}
            {props.roleBilling && props.roleBilling.length > 0 && (
              <RelayRoleBilling rows={props.roleBilling} />
            )}
            {focusable('console', (
              <RelayConsole
                events={terminalEvents}
                handoffNetworkState={handoffNetworkState}
                onOpenTerminal={onOpenTerminal}
              />
            ))}
            {focusable('conversation', (
              <RelayProjectConversation
                messages={projectMessages}
                onSendProjectMessage={onSendProjectMessage}
                onApproveDecision={onApproveDecision}
                onRejectDecision={onRejectDecision}
              />
            ))}
          </div>

          <aside className="rpw-status" aria-label="System status">
            <div className="rpw-status-block">
              {focusable('phase', (
                <RelayProjectPhaseRail
                  phase={phase}
                  researchEnabled={researchEnabled}
                  repairUsed={repairUsed}
                  blockingOpen={completion.blockers.length > 0 && !completion.showVerifiedComplete}
                  verified={completion.showVerifiedComplete}
                />
              ))}
            </div>
            <div className="rpw-status-block">
              {focusable('verification', <RelayVerificationSummary summary={verificationSummary} />)}
            </div>
            <div className="rpw-status-block">
              {focusable('reviewer', (
                <RelayReviewerStatus
                  reviewerName={workforce.reviewer.name}
                  state={reviewerState}
                  findings={findings}
                  repairs={repairs}
                  onOpenFinding={onOpenFinding}
                  onOpenRepair={onOpenRepair}
                />
              ), 'reviewer')}
            </div>
            <div className="rpw-status-block">
              {focusable('prompt_architect', (
                <RelayResearchStatus state={researchState} onRequestResearch={onRequestResearch} />
              ), 'prompt_architect')}
            </div>
            <div className="rpw-status-block">
              {focusable('project_brain', <RelayProjectBrainStatus state={projectBrainState} />)}
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

      {/* Makes the workspace inert to the pointer while a panel is focused.
          `aria-modal` on the focused panel does the same for assistive tech. */}
      <RelayFocusBackdrop focused={focusedPanel !== null} />

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
