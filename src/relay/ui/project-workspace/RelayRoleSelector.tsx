import {
  AGENT_OPTIONS,
  AVAILABILITY_LABEL,
  SELECTABLE_AVAILABILITY,
  reviewerIndependentFromCodingAgent,
  type AgentOption,
  type RelayWorkforceSelection,
  type WorkforceRole,
} from '../project-settings';
import { dispatchForAgentOption, type DeploymentKind } from './role-occupant-map';

/**
 * CHOOSING WHO HOLDS A ROLE, FROM THE WORKSPACE.
 *
 * A compact selector over the SAME agent catalog the 15-step Project Settings
 * writes, producing the SAME workforce selection. There is one project
 * configuration and this surface is a second door to it, not a second copy of
 * it — a workspace that kept its own idea of the stack would be exactly the
 * duplicate store this direction forbids.
 *
 * WHAT THIS SURFACE MAY AND MAY NOT CLAIM.
 *
 * The direction asks for READY on genuinely available integrations. The
 * browser cannot honestly say READY: whether a credential is set, whether an
 * SDK resolves, whether a CLI is installed are all facts about the SERVER, and
 * the browser has never seen that machine. So each option carries two labels,
 * and neither is a guess:
 *
 *   its catalog availability   AVAILABLE / NOT CONFIGURED / COMING LATER …,
 *                              the same words Project Settings shows.
 *   what the registry knows    whether Relay registers an occupant that can
 *                              run this choice on THIS kind of deployment, and
 *                              which server variables that occupant reads.
 *
 * An option Relay cannot dispatch is still shown and still says why, because
 * hiding it would answer a question the founder is entitled to ask.
 *
 * FAIL CLOSED ON INVALID COMBINATIONS. Reviewer independence is a real rule in
 * this codebase, not a slogan: a reviewer that shares a provider with the
 * coding agent is not independent. This selector refuses that pair in BOTH
 * directions — you cannot pick a dependent reviewer, and you cannot pick a
 * coding agent that would make the reviewer already chosen dependent. It says
 * which pairing is the problem instead of silently reordering the choice.
 */

export type RoleOptionState =
  /** Choosable, and Relay registers an occupant that runs on this deployment. */
  | 'selectable_dispatchable'
  /** Choosable as configuration; no registered occupant runs it here. */
  | 'selectable_not_dispatchable'
  /** Choosable; where it would run is unknown because no bridge is connected. */
  | 'selectable_host_unknown'
  /** The catalog says this cannot be chosen yet. */
  | 'not_selectable'
  /** Choosing it would break Reviewer independence. */
  | 'conflicts';

export interface RoleOptionView {
  readonly option: AgentOption;
  readonly state: RoleOptionState;
  readonly selected: boolean;
  /** Server-side variable NAMES this choice reads. Never values. */
  readonly requiredConfig: readonly string[];
  /** Why it cannot be chosen, when it cannot. */
  readonly blockedReason: string | null;
}

const ROLE_TITLE: Readonly<Record<WorkforceRole, string>> = Object.freeze({
  prompt_architect: 'PROMPT ARCHITECT',
  coding_agent: 'CODING AGENT',
  reviewer: 'REVIEWER',
});

const findOption = (options: readonly AgentOption[], id: string | null): AgentOption | null =>
  id === null ? null : options.find((o) => o.id === id) ?? null;

/**
 * Every option for one role, with the reason it can or cannot be chosen.
 *
 * Exported so the refusal rules can be tested without a renderer: they are the
 * part that has to stay true.
 */
export function roleOptionViews(input: {
  role: WorkforceRole;
  selection: RelayWorkforceSelection;
  deployment: DeploymentKind;
  options?: readonly AgentOption[];
}): readonly RoleOptionView[] {
  const options = input.options ?? AGENT_OPTIONS;
  const coding = findOption(options, input.selection.codingAgentId);
  const reviewer = findOption(options, input.selection.reviewerId);
  const selectedId =
    input.role === 'prompt_architect' ? input.selection.promptArchitectId
      : input.role === 'coding_agent' ? input.selection.codingAgentId
        : input.selection.reviewerId;

  return options
    .filter((option) => option.role === input.role)
    .map((option) => {
      const dispatch = dispatchForAgentOption(option, input.role, input.deployment);
      const selected = option.id === selectedId;

      if (!SELECTABLE_AVAILABILITY.has(option.availability)) {
        return {
          option,
          state: 'not_selectable' as const,
          selected,
          requiredConfig: dispatch.requiredConfig,
          blockedReason: `${AVAILABILITY_LABEL[option.availability]} — this cannot be selected yet.`,
        };
      }

      // INDEPENDENCE, BOTH DIRECTIONS. Picking the reviewer is the obvious
      // case; picking a coding agent that collides with the reviewer already
      // chosen is the same defect arriving from the other side, and letting it
      // through would leave the project holding a pair Relay must refuse.
      if (input.role === 'reviewer' && !reviewerIndependentFromCodingAgent(option, coding)) {
        return {
          option,
          state: 'conflicts' as const,
          selected,
          requiredConfig: dispatch.requiredConfig,
          blockedReason: `Not independent from the Coding Agent (${coding?.name ?? 'unknown'}).`,
        };
      }
      if (input.role === 'coding_agent' && !reviewerIndependentFromCodingAgent(reviewer, option)) {
        return {
          option,
          state: 'conflicts' as const,
          selected,
          requiredConfig: dispatch.requiredConfig,
          blockedReason: `The Reviewer already chosen (${reviewer?.name ?? 'unknown'}) would not be independent from it.`,
        };
      }

      return {
        option,
        state: dispatch.runsHere === null
          ? ('selectable_host_unknown' as const)
          : dispatch.runsHere
            ? ('selectable_dispatchable' as const)
            : ('selectable_not_dispatchable' as const),
        selected,
        requiredConfig: dispatch.requiredConfig,
        blockedReason: null,
      };
    });
}

export interface RelayRoleSelectorProps {
  role: WorkforceRole;
  /** The project's WHOLE workforce selection — independence needs the pair. */
  selection: RelayWorkforceSelection;
  /**
   * Which machine this workspace is talking to. An input, for the reason given
   * above, and `null` — no bridge connected — is a real answer rather than a
   * default.
   */
  deployment: DeploymentKind;
  /** Absent means this surface reports the stack and may not change it. */
  onSelect?: (role: WorkforceRole, agentId: string) => void;
  onDismiss: () => void;
  options?: readonly AgentOption[];
}

export function RelayRoleSelector({
  role,
  selection,
  deployment,
  onSelect,
  onDismiss,
  options,
}: RelayRoleSelectorProps) {
  const views = roleOptionViews({
    role,
    selection,
    deployment,
    ...(options === undefined ? {} : { options }),
  });

  return (
    <div className="rpw-roleselect" role="dialog" aria-label={`Choose the ${ROLE_TITLE[role]}`}>
      <div className="rpw-roleselect-head">
        <span className="rpw-roleselect-title">{ROLE_TITLE[role]}</span>
        <button type="button" className="rpw-roleselect-close" onClick={onDismiss}>
          CLOSE
        </button>
      </div>

      <ul className="rpw-roleselect-list">
        {views.map((view) => {
          const choosable = onSelect !== undefined && view.blockedReason === null;
          return (
            <li key={view.option.id} className="rpw-roleselect-item">
              <button
                type="button"
                className={`rpw-roleselect-option${view.selected ? ' is-selected' : ''}`}
                disabled={!choosable}
                aria-current={view.selected}
                onClick={() => onSelect?.(role, view.option.id)}
              >
                <span className="rpw-roleselect-name">
                  {view.option.name}
                  <span className="rpw-roleselect-provider">{view.option.provider}</span>
                </span>
                <span
                  className={`rpw-roleselect-state rpw-roleselect-state--${view.option.availability}`}
                >
                  {AVAILABILITY_LABEL[view.option.availability]}
                </span>
              </button>

              {view.blockedReason !== null && (
                <p className="rpw-roleselect-note">{view.blockedReason}</p>
              )}

              {/* WHAT THE REGISTRY KNOWS, said only where it adds something.
                  A choice Relay cannot dispatch on this deployment is the
                  difference between a saved preference and a mission that can
                  run, and the founder should not discover it at dispatch. */}
              {view.state === 'selectable_not_dispatchable' && (
                <p className="rpw-roleselect-note">
                  Relay registers no occupant that runs this on
                  {deployment === 'hosted' ? ' a hosted bridge' : ' this machine'} — a Mission
                  naming it is refused rather than dispatched.
                </p>
              )}
              {/* UNKNOWN IS NOT "NOWHERE". With no bridge connected there is no
                  machine to ask, and saying the choice cannot run would be a
                  claim about a computer this browser has never seen. */}
              {view.state === 'selectable_host_unknown' && view.option.id !== 'reviewer-none' && (
                <p className="rpw-roleselect-note">
                  No Relay bridge is connected, so where this would run is unknown.
                </p>
              )}
              {view.state === 'selectable_dispatchable' && view.requiredConfig.length > 0 && (
                <p className="rpw-roleselect-note">
                  {/* NAMES ONLY. */}
                  {`Reads ${view.requiredConfig.join(', ')} on the server.`}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <p className="rpw-roleselect-foot">
        {/* The honest limit of this surface, stated where it is relevant
            rather than buried. */}
        This saves the project&apos;s configuration. Whether a choice can actually run is
        decided on the server when a Mission starts, and Relay refuses there rather than
        guessing here.
      </p>
    </div>
  );
}
