import { AVAILABILITY_LABEL, REVIEWER_POLICY_CHOICES, SELECTABLE_AVAILABILITY } from './options';
import { reviewerIndependentFromCodingAgent } from './validation';
import { SettingsField, Segmented } from './SettingsControls';
import type { AgentOption, RelayWorkforceSelection, WorkforceRole } from './contracts';

/**
 * 05 — WORKFORCE. The developer chooses each role by CLICKING a visible
 * option — never by typing an agent name. Every option shows its provider,
 * truthful availability, role description, strengths, and recommendation
 * reason. Unavailable options are disabled with honest labels; the
 * independence warning explains conflicts without deciding policy.
 */

function AgentPicker({
  role,
  legend,
  description,
  options,
  selectedId,
  onSelect,
}: {
  role: WorkforceRole;
  legend: string;
  description?: string;
  options: AgentOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const roleOptions = options.filter((o) => o.role === role);
  return (
    <SettingsField legend={legend} hint={description}>
      <div className="rps-agents" role="presentation">
        {roleOptions.map((o) => {
          const selectable = SELECTABLE_AVAILABILITY.has(o.availability);
          return (
            <label
              key={o.id}
              className={`rps-agent${selectedId === o.id ? ' is-selected' : ''}${selectable ? '' : ' is-unavailable'}`}
            >
              <input
                type="radio"
                name={`rps-agent-${role}`}
                value={o.id}
                checked={selectedId === o.id}
                disabled={!selectable}
                onChange={() => onSelect(o.id)}
              />
              <span className="rps-agent-main">
                <span className="rps-agent-name">{o.name}</span>
                <span className="rps-agent-provider">{o.provider}</span>
                <span className={`rps-agent-status rps-agent-status--${o.availability}`}>
                  {AVAILABILITY_LABEL[o.availability]}
                </span>
                {o.planRequirement && (
                  <span className="rps-agent-plan">{o.planRequirement.toUpperCase()}</span>
                )}
                {o.recommended && <span className="rps-rec">RELAY RECOMMENDS</span>}
              </span>
              <span className="rps-agent-desc">{o.description}</span>
              {o.strengths.length > 0 && (
                <span className="rps-agent-strengths">
                  {o.strengths.map((s) => (
                    <span key={s}>· {s}</span>
                  ))}
                </span>
              )}
              {o.recommended && o.recommendationReason && (
                <span className="rps-agent-why">WHY — {o.recommendationReason}</span>
              )}
            </label>
          );
        })}
      </div>
    </SettingsField>
  );
}

export function SettingsWorkforce({
  agentOptions,
  selection,
  onChange,
}: {
  agentOptions: AgentOption[];
  selection: RelayWorkforceSelection;
  onChange: (selection: RelayWorkforceSelection) => void;
}) {
  const byId = (id: string | null) => (id ? agentOptions.find((o) => o.id === id) ?? null : null);
  const architect = byId(selection.promptArchitectId);
  const coding = byId(selection.codingAgentId);
  const reviewer = byId(selection.reviewerId);
  const independent = reviewerIndependentFromCodingAgent(reviewer, coding);

  return (
    <div className="rps-workforce">
      <AgentPicker
        role="prompt_architect"
        legend="CHOOSE PROMPT ARCHITECT"
        description="Plans the mission, continuously researches the project, expands the Project Brain, and prepares every Coding Agent handoff."
        options={agentOptions}
        selectedId={selection.promptArchitectId}
        onSelect={(id) => onChange({ ...selection, promptArchitectId: id })}
      />

      <AgentPicker
        role="coding_agent"
        legend="CHOOSE CODING AGENT"
        description="Implements bounded tasks and produces evidence Relay can verify. Coding availability is separate from Reviewer availability."
        options={agentOptions}
        selectedId={selection.codingAgentId}
        onSelect={(id) => onChange({ ...selection, codingAgentId: id })}
      />

      <AgentPicker
        role="reviewer"
        legend="CHOOSE REVIEWER"
        options={agentOptions}
        selectedId={selection.reviewerId}
        onSelect={(id) => onChange({ ...selection, reviewerId: id })}
      />

      <SettingsField legend="REVIEWER REQUIRED">
        <Segmented
          name="rps-reviewer-policy"
          choices={REVIEWER_POLICY_CHOICES}
          value={selection.reviewerPolicy}
          onChange={(reviewerPolicy) => onChange({ ...selection, reviewerPolicy })}
        />
      </SettingsField>

      <p
        className={`rps-independence${independent ? ' rps-independence--ok' : ' rps-independence--warn'}`}
        role="status"
      >
        {independent
          ? '■ INDEPENDENT FROM CODING AGENT — the selected Reviewer is independent.'
          : '! REVIEWER NOT INDEPENDENT — the selected Reviewer shares a provider with the Coding Agent. Independent review is strongly recommended; Relay will not silently change this.'}
      </p>

      <div className="rps-wf-preview" aria-label="Workforce preview">
        <div className="rps-wf-step">
          <span className="rps-key">PROMPT ARCHITECT</span>
          <span className="rps-wf-name">{architect?.name ?? '—'}</span>
        </div>
        <span className="rps-wf-arrow" aria-hidden="true">
          ↓ RESEARCH + MISSION + HANDOFF
        </span>
        <div className="rps-wf-step">
          <span className="rps-key">CODING AGENT</span>
          <span className="rps-wf-name">{coding?.name ?? '—'}</span>
        </div>
        <span className="rps-wf-arrow" aria-hidden="true">
          ↓ IMPLEMENTATION + TESTS
        </span>
        <div className="rps-wf-step">
          <span className="rps-key">REVIEWER</span>
          <span className="rps-wf-name">
            {selection.reviewerPolicy === 'never' ? 'Not required' : reviewer?.name ?? '—'}
          </span>
        </div>
        <span className="rps-wf-arrow" aria-hidden="true">
          {selection.reviewerPolicy === 'never' ? '↓ RELAY VERIFICATION ONLY' : '↓ INDEPENDENT REVIEW'}
        </span>
        <div className="rps-wf-step">
          <span className="rps-key">RELAY</span>
          <span className="rps-wf-name">Verified Result</span>
        </div>
      </div>
    </div>
  );
}
