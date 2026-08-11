import { useCallback, useMemo, useState } from 'react';

import { RelayProjectHeader } from './RelayProjectHeader';
import { RelayWorkforceStrip } from './RelayWorkforceStrip';
import { RelayConsole } from './RelayConsole';
import { RelayProjectConversation } from './RelayProjectConversation';
import { RelayLoopSurfaceHost, type RelayLoopSurface } from '../loop/RelayLoopSurface';
import { RelayLiveTerminalPanel } from './RelayLiveTerminalPanel';
import { RelayCodingAgentTerminal } from './RelayCodingAgentTerminal';
import { RelayRoleBilling } from './RelayRoleBilling';
import { RelayManualTaskPanel } from './RelayManualTaskPanel';
import { RelayReviewerStatus } from './RelayReviewerStatus';
import { RelayVerificationSummary } from './RelayVerificationSummary';
import { RelayResearchStatus } from './RelayResearchStatus';
import { RelayProjectBrainStatus } from './RelayProjectBrainStatus';
import { RelayProjectBrainOrb } from './RelayProjectBrainOrb';
import { chakraAccent as chakraAccentFor } from '../../shared/relay-chakra';
import { RelayChakraTierPicker } from './RelayChakraTierPicker';
import { RelayRoleSelector } from './RelayRoleSelector';
import type { WorkforceRole } from '../project-settings';
import { RelayOperationsPanel } from './RelayOperationsPanel';
import { RelayWorkspaceDog } from './RelayWorkspaceDog';
import {
  RelayStage, RelayStageBackdrop, RelayStageBackdropPicker,
  type RelayBackdropId,
} from '../relay-stage';
import {
  projectWorkspaceCast, type CastRoleInput,
} from '../../shared/relay-stage-cast';
import { useViewportWidth } from './use-viewport-width';

/** The width assumed only when there is no window to ask. */
const DEFAULT_VIEWPORT_WIDTH_PX = 1440;

/**
 * WHO IS ON THE WORKSPACE STAGE.
 *
 * THE DOG IS NOT CONDITIONAL. It is this product's avatar and is drawn whenever
 * the workspace is — INCLUDING BEFORE THE FIRST MISSION, because
 * `configured-state.ts` builds this screen for a configured project and
 * fabricates an "Awaiting first mission" record. Its STATE, not its presence,
 * says what is happening. An earlier version of this comment justified the same
 * conclusion with "this screen exists only for a project with a mission", which
 * that file refutes.
 *
 * Two failed attempts say why it must not be derived from activity. A literal
 * `working: true` was a constant input replacing a constant cast. Deriving
 * `dogState !== 'wandering'` was worse in a quieter way: `verified_complete`
 * maps to `complete`, so it claimed the coding agent was working after the
 * mission had finished, and `architect_working` maps to `trotting`, so it
 * claimed the coding agent was working when the architect was. It also deleted
 * the Dog from an idle workspace — and `wandering` is the Dog's IDLE
 * ANIMATION, which exists precisely to be shown.
 *
 * The Relay Dog is the mission's avatar. This screen exists only for a project
 * with a mission, so the Dog belongs on the stage whenever this screen renders,
 * and its state — not its presence — is what says what it is doing.
 *
 * THE OTHER TWO ROLES HAVE NO IDLE PRESENCE, so for them the question really
 * is "is it running", read from the workforce assignment this screen displays.
 *
 * EXHAUSTIVE RECORDS, NOT `===` CHAINS. Three commits in a row read a status
 * NAME as activity and got it wrong — `verified_complete` for the coder,
 * `dogState !== wandering`, then `preparing_handoff` for the architect, which
 * `relay-bridge/mission.ts` assigns AFTER that role's ledger reads `complete`
 * and its event carries `done: true`. It is the architect FINISHED, not
 * finishing. A chain of comparisons let each of those through silently and
 * would let a fourth through when a state is added to either union. A `Record`
 * over the whole union fails the build until someone decides, which is the only
 * fix that outlives the next state.
 */
const ARCHITECT_RUNNING: Readonly<Record<ArchitectStatus, boolean>> = Object.freeze({
  planning: true,
  researching: true,
  // FINISHED, not finishing: the bridge sets this after the ledger is complete.
  preparing_handoff: false,
  waiting: false,
});

const REVIEWER_RUNNING: Readonly<Record<ReviewerStateKind, boolean>> = Object.freeze({
  not_configured: false,
  not_required: false,
  waiting: false,
  reviewing: true,
  // Verdicts already delivered, not work in progress.
  changes_required: false,
  re_reviewing: true,
  approved: false,
  unavailable: false,
  // Caught by this Record the moment it was written: the `===` chain it
  // replaced would have swallowed this state silently. Nobody is reviewing
  // while Relay waits for a human to sign in.
  sign_in_required: false,
});

/** What a human calls each role. The stage names them; it never draws them. */
const ROLE_LABEL: Readonly<Record<CastRoleInput['role'], string>> = Object.freeze({
  prompt_architect: 'Prompt Architect',
  coding_agent: 'Coding Agent',
  reviewer: 'Reviewer',
});

function workspaceCastRoles(workforce: WorkforceAssignment): readonly CastRoleInput[] {
  return [
    { role: 'prompt_architect', onStage: ARCHITECT_RUNNING[workforce.promptArchitect.status] },
    { role: 'coding_agent', onStage: true },
    { role: 'reviewer', onStage: REVIEWER_RUNNING[workforce.reviewer.state] },
  ];
}
import { RelayProjectFooter } from './RelayProjectFooter';
import { RelayPspAgentImport } from '../psp-import';
import type { RelayWorkspaceUsage } from '../usage';
import type { RelayFocusablePanel } from './RelayPanelFocus';
import type { MissionWorktreeView } from '../../mission/worktree';
import type { CodingAgentView } from '../../mission/coding-agent';
import type { PromptArchitectView } from '../../mission/prompt-architect';
import { projectHarnessCatalog, type ReviewerHarnessView } from '../../mission/reviewer-harness';
import { OUTPUT_STATE_LABEL, completionDisplay } from './projections';
import type {
  ArchitectStatus, RelayProjectWorkspaceProps, ReviewerStateKind, WorkforceAssignment,
} from './contracts';
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
  props: RelayProjectWorkspaceProps & {
    agentsPanel?: RelayWorkspaceAgentsPanel;
    /**
     * Optional Usage Bar surface (view + open intent), passed through to the
     * header and echoed compactly inside focused fullscreen panels. Optional
     * for the same reason as `agentsPanel`: callers without a usage source
     * render exactly as before.
     */
    usage?: RelayWorkspaceUsage;
    /**
     * Optional Loop surface. Present only once a host wires the Loop
     * commands; absent, the workspace renders exactly as it did before and
     * slash input stays with the conversation. Additive on purpose — this
     * is an approved screen and Loops must not rebuild it.
     */
    loopSurface?: RelayLoopSurface;
    /**
     * Isolated-worktree state for the Coding Agent's Environment. Optional:
     * a caller that cannot know (the static deployment has no Node bridge)
     * passes the offline view rather than nothing pretending to be nothing.
     */
    worktree?: MissionWorktreeView;
    /** Coding Agent runtime state for the Environment inspector. */
    codingRuntime?: CodingAgentView;
    /** Prompt Architect runtime state for the Environment inspector. */
    architectRuntime?: PromptArchitectView;
    /** Reviewer harness state for the Environment inspector. */
    reviewerHarness?: ReviewerHarnessView;
    /**
     * Lets the Reviewer Harness catalog reach the ONE application
     * notification host. Optional: without it the catalog explains every
     * unavailable harness inline and publishes nothing.
     */
    onHarnessUnavailable?: (harnessName: string) => void;
    /** The console's truthful empty state — reason and retry. Optional. */
    consoleIdle?: import('./RelayConsole').RelayConsoleIdleState;
  },
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
    terminalOpen,
    terminalFullScreen = false,
    reducedMotion = false,
    // No default: absent means "measure it", not "assume a desktop".
    viewportWidthPx,
    // Absent means no scene, which is a choice rather than a fallback.
    stageBackdrop,
    onSendProjectMessage,
    onApproveDecision,
    onRejectDecision,
    onOpenTerminal,
    onCloseTerminal,
    onOpenProjectSettings,
    onOpenProjectBrain,
    onSelectRoleOccupant,
    workforceSelection,
    deployment = null,
    chakraTier = null,
    onSelectChakraTier,
    onOpenManualTask,
    onApproveManualTask,
    onRejectManualTask,
    onRequestResearch,
    onOpenFinding,
    onOpenRepair,
    onReturnHome,
    onSelectStageBackdrop,
    operationsView,
    projectBrainDocument,
  } = props;

  const completion = completionDisplay({ completionState, reviewerState, findings, repairs });
  const openTasks = manualTasks.filter((t) => t.status === 'open').length;

  /**
   * THE VIEWPORT, MEASURED. `viewportWidthPx` remains an explicit override so a
   * test or a non-browser host can state the width; when it is absent the host
   * observes one instead of assuming a desktop.
   */
  const measuredWidthPx = useViewportWidth(DEFAULT_VIEWPORT_WIDTH_PX);
  const observedViewportWidthPx = viewportWidthPx ?? measuredWidthPx;

  // Derived once per render from a frozen input, so the identity is stable and
  // the stage does not re-place actors because React re-rendered.
  // The deps are honest even though the memo almost never hits: `workforce` is
  // rebuilt as a fresh literal by the projection on every call, so this
  // recomputes each render. Kept because a correct dep list that rarely helps
  // is better than an empty one that pins a stale cast — and said plainly,
  // because the two previous comments here each claimed a benefit it did not
  // have.
  const workspaceCast = useMemo(() => projectWorkspaceCast({
    roles: workspaceCastRoles(workforce),
  }), [workforce]);

  /**
   * THE BACKDROP CHOICE, with EXACTLY ONE SOURCE OF TRUTH at a time.
   *
   * A host that wants the choice remembered passes `onSelectStageBackdrop` and
   * stores it; without one the local state keeps the picker genuinely operable,
   * and the scene simply does not survive a reload.
   *
   * WHEN A HOST OWNS THE VALUE, THE HOST OWNS IT. The first version read
   * `localBackdrop ?? stageBackdrop` unconditionally, which was harmless while
   * `stageBackdrop` was always absent and became a second source the moment a
   * host started supplying one — and the local one won permanently, because
   * nothing ever cleared it. Review proved the three consequences: a host that
   * re-asserted a different value was ignored; a reset that cleared the store
   * left the old scene on screen; and a host that took the callback and
   * REJECTED the write still had the scene drawn as though it had been stored.
   * That last one is the rule about announcing facts rather than intentions,
   * broken by a `??`.
   */
  const [localBackdrop, setLocalBackdrop] = useState<RelayBackdropId | null>(null);
  /** Which role's selector is open, if any. Local to the surface: it is a
   *  disclosure state, not a fact about the project. */
  const [roleBeingChosen, setRoleBeingChosen] = useState<WorkforceRole | null>(null);
  /**
   * A workspace whose host supplies no selection cannot offer to change one:
   * there would be nothing to write into, and a selector over an invented
   * default would be the second configuration store this must not become.
   */
  const roleSwitchingAvailable =
    onSelectRoleOccupant !== undefined && workforceSelection !== undefined;
  const selectedBackdrop = onSelectStageBackdrop ? stageBackdrop : (localBackdrop ?? stageBackdrop);
  const handleSelectBackdrop = useCallback((id: RelayBackdropId) => {
    setLocalBackdrop(id);
    onSelectStageBackdrop?.(id);
  }, [onSelectStageBackdrop]);

  /**
   * THE REVIEWER HARNESS CATALOG — projected from the canonical domain, never
   * composed here, and always available: with no reviewer view every identity
   * row is independently `Unknown`, which is the truth this deployment has.
   * It is not gated on a mode, a flag or a build, because the catalog is a
   * truthful product surface in production too.
   */
  const harnessCatalog = useMemo(
    () => projectHarnessCatalog(props.reviewerHarness ?? null),
    [props.reviewerHarness],
  );


  /**
   * THE WORKSPACE HAS NO PER-PANEL FULLSCREEN CONTROL.
   *
   * Expanding a box is a LIVE TERMINAL affordance (founder direction): the
   * terminal's role boxes carry the control, and the workspace stays a plain
   * reading surface. This helper therefore renders the panel exactly as it is
   * — kept as a seam so the call sites stay readable and a future surface can
   * reintroduce a wrapper in one place rather than nine.
   */
  const focusable = (_panel: RelayFocusablePanel, content: React.ReactNode) => content;

  return (
    <div className="rpw" data-panel-focused="false">
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
        usage={props.usage}
        onReturnHome={onReturnHome}
        onOpenProjectSettings={onOpenProjectSettings}
        onOpenTerminal={onOpenTerminal}
      />


      {/* THE CONTINUOUS WORKFORCE STRIP. The workspace's own docstring has
          promised this since the founder screenshots, and the founder's #6
          removed the status-rail phase list on the stated basis that "the
          workforce strip's PHASE cell already carries the live phase" — but the
          strip was exported and mounted by NOTHING, so that sentence was about
          a component only tests ever rendered. Mounting it is what makes the
          strip the single phase surface, which is also why `phase` is
          destructured above. */}
      {/* The strip and its selector share one positioned zone, so the selector
          opens UNDER THE CELL IT BELONGS TO. Anchoring it to the page instead
          would put a floating panel somewhere near the strip, which is how a
          selector turns into the sidebar this direction forbids. */}
      <div className="rpw-stripzone">
        <RelayWorkforceStrip
          workforce={workforce}
          mode={mode}
          phase={phase}
            {...(roleSwitchingAvailable ? { onSelectRole: setRoleBeingChosen } : {})}
        />
        {/* THE SELECTOR, mounted beside the strip it belongs to rather than in a
            new right-hand sidebar. It is a small dialog over the registry, and
            it closes on choice. */}
        {roleBeingChosen !== null && workforceSelection !== undefined && (
          <RelayRoleSelector
            role={roleBeingChosen}
            selection={workforceSelection}
            deployment={deployment}
            {...(onSelectRoleOccupant === undefined
              ? {}
              : {
                onSelect: (role: WorkforceRole, agentId: string) => {
                  onSelectRoleOccupant(role, agentId);
                  setRoleBeingChosen(null);
                },
              })}
            onDismiss={() => setRoleBeingChosen(null)}
          />
        )}
      </div>

      <main
        className="rpw-main"
        /* ONE ACCENT FOR THE WHOLE COLUMN. The Brain, the threads between the
           objects and the Dog all read from here, so the three things a
           founder is looking at are lit by one source rather than decorated
           separately. Untiered resolves to the shipped colours. */
        style={{
          ['--rpb-accent' as string]: chakraAccentFor(chakraTier).accent,
          ['--rpb-glow' as string]: chakraAccentFor(chakraTier).glow,
        }}
      >
        {/* THE PROJECT BRAIN, ABOVE THE DOG, ABOVE THE MISSION BOX.
            It lived in the right-hand rail as a definition list — a status
            panel beside the workspace rather than part of it. The composition
            the product is trying to communicate is vertical: what the agent
            KNOWS, the agent ITSELF, and what you ASK it. So the Brain sits
            here, the stage follows immediately below, and a single faint
            column of light joins them rather than an arrow or a label.
            The counts and the document did not move — they are what the Brain
            view shows when it is opened. */}
        <div className="rpw-brainstage">
          {/* A CONTROL ONLY WHERE THERE IS SOMETHING TO OPEN. A host without
              the Brain view renders the object and no button, rather than a
              button that looks like it opens something and does not. */}
          {onOpenProjectBrain === undefined ? (
            <RelayProjectBrainOrb
              reducedMotion={reducedMotion}
              populated={projectBrainState.entries > 0}
            />
          ) : (
            <button
              type="button"
              className="rpw-brainstage-open"
              onClick={onOpenProjectBrain}
              aria-label="Open the Project Brain"
            >
              <RelayProjectBrainOrb
                reducedMotion={reducedMotion}
                populated={projectBrainState.entries > 0}
              />
            </button>
          )}
          <span className="rpw-brainstage-link" aria-hidden="true" />
          <p className="rpw-brainstage-caption">
            {/* Announce facts. A Brain with nothing recorded says so rather
                than showing a zero that reads like a measurement. */}
            {projectBrainState.entries > 0
              ? `PROJECT BRAIN · ${String(projectBrainState.entries)} APPROVED`
              : 'PROJECT BRAIN · NOTHING RECORDED YET'}
          </p>
        </div>

        {/* THE RELAY STAGE, between the workforce strip and the Relay Console.
            It replaces `.rpw-dogzone` + the motion boundary's full-width band:
            a frameless region with layers and depth, rather than ninety pixels
            of clipped strip with room for exactly one occupant. The Dog is its
            first actor; a wider Leopard, cubs, vehicles and effects have slots
            waiting rather than a rectangle to be squeezed into. */}
        <div className="rpw-stage-bounds">
          <RelayStage
            className="rpw-stage"
            actors={workspaceCast.actors}
            {...(workspaceCast.emptyReason === null
              ? {}
              : { emptyReason: workspaceCast.emptyReason })}
            viewportWidthPx={observedViewportWidthPx}
            reducedMotion={reducedMotion}
            label="Relay stage"
            backdrop={(
              <RelayStageBackdrop backdrop={selectedBackdrop} reducedMotion={reducedMotion} />
            )}
            render={(id) => (id === 'relay-dog'
              ? <RelayWorkspaceDog state={dogState} reducedMotion={reducedMotion} tier={chakraTier} />
              : null)}
          />
          {/* WHO IS WORKING AND CANNOT BE DRAWN. Computing this and showing it
              to nobody is the defect it was built to prevent: a working
              reviewer would still be indistinguishable from no reviewer. It
              names roles, never invents one — the list is empty whenever they
              are idle, and the element is not rendered at all. */}
          {workspaceCast.workingWithoutSprite.length > 0 && (
            <p className="rpw-stage-offstage" role="status">
              {`Working, with no sprite on this stage yet: ${workspaceCast.workingWithoutSprite
                .map((r) => ROLE_LABEL[r]).join(', ')}.`}
            </p>
          )}
          {/* THE SECOND HALF OF THE CONNECTION. Brain → Dog → Mission, joined
              by the same thread of light rather than by an arrow or a label.
              Decorative and hidden from assistive technology: the
              relationship it draws is stated in words by the surfaces
              themselves, and a screen reader gains nothing from a line. */}
          <span className="rpw-stagelink" aria-hidden="true" />
        </div>
        {/* The picker is MOUNTED, so "two selectable backdrops" is a fact about
            the shipped website and not only about the catalog. Selection is
            local to this screen; a host that wants it remembered passes
            `onSelectStageBackdrop` and stores it. */}
        <RelayStageBackdropPicker
          selected={selectedBackdrop}
          reducedMotion={reducedMotion}
          onSelect={handleSelectBackdrop}
        />
        {/* The tier sits beside the backdrop because it is the same kind of
            setting: how this browser looks, changing nothing Relay reports.
            A host that cannot store it passes no handler and the control
            renders read-only rather than silently forgetting a choice. */}
        <RelayChakraTierPicker
          selected={chakraTier}
          {...(onSelectChakraTier === undefined ? {} : { onSelect: onSelectChakraTier })}
        />
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
            )}
            {props.roleBilling && props.roleBilling.length > 0 && (
              <RelayRoleBilling rows={props.roleBilling} />
            )}
            {focusable('console', (
              <RelayConsole
                events={terminalEvents}
                handoffNetworkState={handoffNetworkState}
                onOpenTerminal={onOpenTerminal}
                idle={props.consoleIdle}
              />
            ))}
            {focusable('conversation', (
              <RelayProjectConversation
                messages={projectMessages}
                onSendProjectMessage={onSendProjectMessage}
                onSendSlashCommand={props.loopSurface?.onSlashCommand}
                onApproveDecision={onApproveDecision}
                onRejectDecision={onRejectDecision}
              />
            ))}
            {props.loopSurface !== undefined ? (
              <RelayLoopSurfaceHost surface={props.loopSurface} />
            ) : null}
          </div>

          <aside className="rpw-status" aria-label="System status">
            {/* The phase list that used to sit here is gone (founder direction):
                the workforce strip's PHASE cell already carries the live phase,
                so the rail starts at verification. */}
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
                  harnessCatalog={harnessCatalog}
                  onHarnessUnavailable={props.onHarnessUnavailable}
                  onOpenFinding={onOpenFinding}
                  onOpenRepair={onOpenRepair}
                />
              ))}
            </div>
            <div className="rpw-status-block">
              {focusable('prompt_architect', (
                <RelayResearchStatus state={researchState} onRequestResearch={onRequestResearch} />
              ))}
            </div>
            <div className="rpw-status-block">
              {focusable('project_brain', <RelayProjectBrainStatus state={projectBrainState} document={projectBrainDocument} />)}
              {/* The operational half of the Brain. Mounted unconditionally: a
                  deployment with no operations source says so, which is a
                  different fact from a project with nothing to report, and
                  neither is drawn as a wall of zeroes. */}
              <RelayOperationsPanel view={operationsView ?? null} />
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
