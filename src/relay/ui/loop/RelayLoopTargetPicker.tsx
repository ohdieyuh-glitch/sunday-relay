import './relay-loop.css';
import {
  RELAY_LOOP_CANONICAL_ALIAS,
  RELAY_LOOP_TARGETABLE_ROLES,
  type RelayAgentRole,
  type RelayRoleAvailability,
} from '../../mission';

/**
 * TARGET SELECTION.
 *
 * The picker emits the SAME canonical target expressions the parser accepts —
 * `all`, `architect`, `architect,coding` — and nothing else. There are no
 * UI-only role semantics: choosing "Coding Agent" here and typing
 * `/loop coder …` produce the identical command, because the picker's output
 * goes back through `parseSlashCommand` like any other input.
 *
 * That is why it emits a STRING rather than a resolved role list. A picker
 * that shortcut the parser would be a second command interpretation system
 * wearing checkboxes.
 *
 * WHAT IT WILL NOT DO. A role the registry cannot staff is shown, labelled
 * with why, and selectable — because the user is entitled to ask for it and
 * hear a truthful refusal, rather than have the option quietly vanish. What it
 * never does is imply an unavailable agent will execute.
 */

const AVAILABILITY_LABEL: Readonly<Record<RelayRoleAvailability, string>> = Object.freeze({
  available: 'available',
  not_configured: 'not configured',
  not_connected: 'not connected',
  entitlement_locked: 'not in plan',
  unknown: 'availability unknown',
});

export type RelayLoopTargetChoice =
  | { readonly kind: 'active_compound_agent' }
  | { readonly kind: 'all_eligible_agents' }
  | { readonly kind: 'exact_roles'; readonly roles: readonly RelayAgentRole[] };

/** The canonical expression a choice becomes. This is the ONLY place a choice
 *  turns into text, and the text goes straight back through the parser. */
export function targetChoiceExpression(choice: RelayLoopTargetChoice): string | null {
  switch (choice.kind) {
    case 'active_compound_agent':
      return null; // no target word — the default
    case 'all_eligible_agents':
      return 'all';
    case 'exact_roles':
      return choice.roles.map((role) => RELAY_LOOP_CANONICAL_ALIAS[role]).join(',');
  }
}

/** Build the full command text a choice + objective produce. */
export function targetChoiceCommand(
  choice: RelayLoopTargetChoice,
  objective: string,
  family: 'loop' | 'sloop' = 'loop',
): string {
  const expression = targetChoiceExpression(choice);
  const target = expression === null || expression === '' ? '' : `${expression} `;
  return `/${family} ${target}${objective}`.replace(/\s+/g, ' ').trim();
}

export function RelayLoopTargetPicker({
  choice,
  availability,
  activeCompoundAgentRoles,
  onChange,
}: {
  choice: RelayLoopTargetChoice;
  /** What the server observed. A role absent here is `unknown`, never absent
   *  from the list — hiding a role would hide the reason it cannot work. */
  availability: Readonly<Partial<Record<RelayAgentRole, RelayRoleAvailability>>>;
  activeCompoundAgentRoles: readonly RelayAgentRole[];
  onChange: (choice: RelayLoopTargetChoice) => void;
}) {
  const selectedRoles = choice.kind === 'exact_roles' ? choice.roles : [];

  const toggleRole = (role: RelayAgentRole) => {
    const next = selectedRoles.includes(role)
      ? selectedRoles.filter((r) => r !== role)
      : [...selectedRoles, role];
    onChange(next.length === 0 ? { kind: 'active_compound_agent' } : { kind: 'exact_roles', roles: next });
  };

  return (
    <fieldset className="rlt">
      <legend className="rlc-section-title">TARGET</legend>

      <div className="rlt-modes" role="radiogroup" aria-label="Which agents this Loop targets">
        <label className="rlt-mode">
          <input
            type="radio"
            name="rlt-mode"
            checked={choice.kind === 'active_compound_agent'}
            onChange={() => onChange({ kind: 'active_compound_agent' })}
          />
          <span className="rlt-mode-label">Active compound agent</span>
          <span className="rlt-mode-detail">
            {activeCompoundAgentRoles.length > 0
              ? `Currently ${activeCompoundAgentRoles.map((r) => RELAY_LOOP_CANONICAL_ALIAS[r]).join(', ')}.`
              : 'Relay cannot read which roles are configured, so this is Unknown.'}
          </span>
        </label>

        <label className="rlt-mode">
          <input
            type="radio"
            name="rlt-mode"
            checked={choice.kind === 'all_eligible_agents'}
            onChange={() => onChange({ kind: 'all_eligible_agents' })}
          />
          <span className="rlt-mode-label">All eligible agents</span>
          <span className="rlt-mode-detail">
            Every role the account could staff, which may be more than the compound agent above.
          </span>
        </label>

        <label className="rlt-mode">
          <input
            type="radio"
            name="rlt-mode"
            checked={choice.kind === 'exact_roles'}
            onChange={() =>
              onChange({ kind: 'exact_roles', roles: selectedRoles.length > 0 ? selectedRoles : ['coding_agent'] })
            }
          />
          <span className="rlt-mode-label">Specific roles</span>
          <span className="rlt-mode-detail">Choose one or more roles below.</span>
        </label>
      </div>

      <ul className="rlt-roles" aria-label="Roles">
        {RELAY_LOOP_TARGETABLE_ROLES.map((role) => {
          const state = availability[role] ?? 'unknown';
          const assignable = state === 'available';
          return (
            <li className="rlt-role" key={role}>
              <label>
                <input
                  type="checkbox"
                  checked={selectedRoles.includes(role)}
                  disabled={choice.kind !== 'exact_roles'}
                  onChange={() => toggleRole(role)}
                />
                <span className="rlt-role-name">{RELAY_LOOP_CANONICAL_ALIAS[role]}</span>
                <span className={`rlt-role-state${assignable ? '' : ' rlt-role-state--blocked'}`}>
                  {AVAILABILITY_LABEL[state]}
                </span>
              </label>
              {!assignable ? (
                <span className="rlt-role-note">
                  This role cannot take work right now. Requesting it will report a blocker rather
                  than run.
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}
