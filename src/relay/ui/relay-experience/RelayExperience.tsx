import { useCallback } from 'react';
import { AGENT_OPTIONS } from '../project-settings';
import type { AgentOption, WorkforceRole } from '../project-settings';
import { readinessLabel, wonderlandReadiness } from './wonderland-handoff';
import {
  JULIUS, ONBOARDING_STEPS, activate, canActivate, normaliseName,
  type CompoundAgentDraft, type OnboardingStepId,
} from './onboarding';

export type ExperienceAnchor = { x: number; y: number; visible: boolean };

export type RelayExperienceProps = {
  readonly draft: CompoundAgentDraft;
  readonly setDraft: (patch: Partial<CompoundAgentDraft>, react?: boolean) => void;
  readonly step: OnboardingStepId;
  readonly setStep: (step: OnboardingStepId) => void;
  readonly returning: boolean;
  readonly anchors: Readonly<Record<string, ExperienceAnchor>>;
  readonly webgl: boolean;
};

/**
 * THE RELAY EXPERIENCE — what ENTER RELAY now leads to.
 *
 * This replaces the old Entry Home in the onboarding path entirely: no tab bar,
 * no project dashboard, no Live Terminal shell, and above all no 2D WANDERING
 * sprite. The user stands in front of their Compound Agent — a realtime 3D
 * Relay Dog that never unmounts — and configures it from the edges of the
 * viewport, in the same near-black / ivory / gold language as the landing.
 *
 * The Dog is a HARD INVARIANT here. There is no branch in this component that
 * removes it, shrinks it, or substitutes an image for it.
 */

const byRole = (role: WorkforceRole): AgentOption[] => AGENT_OPTIONS.filter((o) => o.role === role);

/** Availability states a user can actually pick today. */
const SELECTABLE = new Set(['connected', 'available', 'recommended']);

/** Uppercase label for the availability chip. Truthful, never softened. */
const AVAILABILITY_LABEL: Readonly<Record<string, string>> = {
  connected: 'CONNECTED',
  recommended: 'RECOMMENDED',
  available: 'AVAILABLE',
  sign_in_required: 'SIGN-IN REQUIRED',
  api_connection_required: 'API KEY REQUIRED',
  not_configured: 'NOT CONFIGURED',
  simulation: 'SIMULATION',
  coming_later: 'COMING LATER',
  unavailable: 'UNAVAILABLE',
};

const MODE_LABEL: Record<string, string> = { guided: 'GUIDED', semi: 'SEMI-AUTONOMOUS', autonomous: 'AUTONOMOUS' };
const NETWORK_LABEL: Record<string, string> = {
  blocked: 'BLOCKED', research_only: 'RESEARCH ONLY', approved_services: 'APPROVED SERVICES', ask_first: 'ASK FIRST',
};
const REVIEW_LABEL: Record<string, string> = {
  none: 'NONE', independent: 'INDEPENDENT', security: 'SECURITY', manual_founder: 'FOUNDER',
};

function optionName(id: string | null): string {
  if (id === null) return '—';
  return AGENT_OPTIONS.find((o) => o.id === id)?.name ?? id;
}

export function RelayExperience({
  draft, setDraft, step, setStep, returning, anchors, webgl,
}: RelayExperienceProps): JSX.Element {
  const update = setDraft;
  const current = ONBOARDING_STEPS.find((s) => s.id === step) ?? ONBOARDING_STEPS[0];
  const goto = useCallback((id: OnboardingStepId) => setStep(id), [setStep]);
  const next = useCallback(() => {
    const i = ONBOARDING_STEPS.findIndex((s) => s.id === step);
    if (i < ONBOARDING_STEPS.length - 1) setStep(ONBOARDING_STEPS[i + 1].id);
  }, [step, setStep]);

  const onActivate = useCallback(() => {
    update({ activatedAt: activate(draft, new Date().toISOString()).activatedAt }, true);
  }, [draft, update]);

  const readiness = wonderlandReadiness(draft.activatedAt !== null);
  const agentLabel = normaliseName(draft.name) || 'UNNAMED';

  const slotPicker = (role: WorkforceRole, field: keyof CompoundAgentDraft) => (
    <ul className="rx-options">
      {byRole(role).map((option) => {
        const selectable = SELECTABLE.has(option.availability);
        const selected = draft[field] === option.id;
        return (
          <li key={option.id}>
            <button
              type="button"
              className="rx-option"
              data-selected={selected ? 'true' : 'false'}
              disabled={!selectable}
              aria-pressed={selected}
              onClick={() => update({ [field]: option.id } as Partial<CompoundAgentDraft>, true)}
            >
              <span className="rx-option-name">{option.name}</span>
              <span className="rx-option-provider">{option.provider}</span>
              <span className="rx-chip">{AVAILABILITY_LABEL[option.availability] ?? option.availability}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );

  const segmented = <T extends string>(
    value: T, options: readonly T[], labels: Record<string, string>, field: keyof CompoundAgentDraft,
  ) => (
    <div className="rx-seg" role="group">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          className="rx-seg-btn"
          data-selected={value === o ? 'true' : 'false'}
          aria-pressed={value === o}
          onClick={() => update({ [field]: o } as Partial<CompoundAgentDraft>, true)}
        >
          {labels[o] ?? o}
        </button>
      ))}
    </div>
  );

  return (
    <div className="rx" data-step={step} data-activated={draft.activatedAt !== null ? 'true' : 'false'}>
      {!webgl && (
        <p className="rx-label rx-nogl" role="status">STATIC MODE · 3D UNAVAILABLE ON THIS DEVICE</p>
      )}

      <header className="rx-brand">
        <span className="rx-mark" aria-hidden="true" />
        <span className="rx-wordmark">SUNDAY RELAY</span>
      </header>

      {/* System nodes placed around the Dog in 3D and projected to the DOM, so
          the compound system reads as spatial without burying the character in
          a node graph. */}
      <div className="rx-nodes" aria-hidden="true">
        {([
          ['architect', 'PROMPT ARCHITECT', optionName(draft.promptArchitectId)],
          ['coding', 'CODING AGENT', optionName(draft.codingAgentId)],
          ['reviewer', 'INDEPENDENT REVIEWER', optionName(draft.reviewerId)],
          ['brain', 'PROJECT BRAIN', draft.activatedAt !== null ? 'CONNECTED' : 'STANDBY'],
          ['card', 'C.A.R.D.', MODE_LABEL[draft.mode]],
        ] as const).map(([key, label, value]) => {
          const a = anchors[key];
          if (!a || !a.visible) return null;
          const filled = value !== '—';
          return (
            <span key={key} className="rx-node" data-filled={filled ? 'true' : 'false'}
              style={{ transform: `translate3d(${a.x}px, ${a.y}px, 0)` }}>
              <span className="rx-node-label">{label}</span>
              <span className="rx-node-value">{value}</span>
            </span>
          );
        })}
      </div>

      {/* Edge-anchored configuration. Never a card over the Dog. */}
      <section className="rx-panel" aria-label={current.title}>
        <p className="rx-label rx-step">{current.eyebrow} · {ONBOARDING_STEPS.length} STEPS</p>
        <h1 className="rx-title">{current.title}</h1>
        <p className="rx-hint">{current.hint}</p>

        {step === 'name' && (
          <label className="rx-field">
            <span className="rx-label">AGENT NAME</span>
            <input
              className="rx-input"
              value={draft.name}
              maxLength={40}
              placeholder="CAESAR"
              onChange={(e) => update({ name: e.target.value })}
              aria-label="Agent name"
            />
          </label>
        )}
        {step === 'architect' && slotPicker('prompt_architect', 'promptArchitectId')}
        {step === 'coding' && slotPicker('coding_agent', 'codingAgentId')}
        {step === 'reviewer' && slotPicker('reviewer', 'reviewerId')}

        {step === 'card' && (
          <div className="rx-group">
            <span className="rx-label">AUTONOMY</span>
            {segmented(draft.mode, ['guided', 'semi', 'autonomous'] as const, MODE_LABEL, 'mode')}
            <span className="rx-label">NETWORK</span>
            {segmented(draft.network, ['blocked', 'research_only', 'approved_services', 'ask_first'] as const, NETWORK_LABEL, 'network')}
            <span className="rx-label">REVIEW</span>
            {segmented(draft.review, ['none', 'independent', 'security', 'manual_founder'] as const, REVIEW_LABEL, 'review')}
          </div>
        )}

        {step === 'settings' && (
          <div className="rx-group">
            <label className="rx-field">
              <span className="rx-label">SPEND LIMIT · USD</span>
              <input className="rx-input" type="number" min={0} max={1000} value={draft.spendUsd}
                onChange={(e) => update({ spendUsd: Number(e.target.value) })} aria-label="Spend limit in USD" />
            </label>
            <label className="rx-field">
              <span className="rx-label">RUNTIME LIMIT · MINUTES</span>
              <input className="rx-input" type="number" min={0} max={600} value={draft.runtimeMinutes}
                onChange={(e) => update({ runtimeMinutes: Number(e.target.value) })} aria-label="Runtime limit in minutes" />
            </label>
          </div>
        )}

        {step === 'review' && (
          <dl className="rx-review">
            <dt>AGENT</dt><dd>{agentLabel}</dd>
            <dt>PROMPT ARCHITECT</dt><dd>{optionName(draft.promptArchitectId)}</dd>
            <dt>CODING AGENT</dt><dd>{optionName(draft.codingAgentId)}</dd>
            <dt>INDEPENDENT REVIEWER</dt><dd>{optionName(draft.reviewerId)}</dd>
            <dt>C.A.R.D.</dt><dd>{MODE_LABEL[draft.mode]} · {NETWORK_LABEL[draft.network]} · {REVIEW_LABEL[draft.review]}</dd>
            <dt>LIMITS</dt><dd>${draft.spendUsd} · {draft.runtimeMinutes} MIN</dd>
          </dl>
        )}

        {step === 'activate' && (
          <div className="rx-group">
            {draft.activatedAt === null ? (
              <button type="button" className="rx-cta" onClick={onActivate} disabled={!canActivate(draft)}>
                ACTIVATE RELAY
              </button>
            ) : (
              <>
                <p className="rx-hint">
                  {agentLabel} is online. {readiness.kind === 'unreachable' ? readiness.reason : ''}
                </p>
                <button type="button" className="rx-cta" data-primary="true"
                  disabled={readiness.kind !== 'ready'}>
                  ENTER WONDERLAND
                </button>
                <button type="button" className="rx-ghost" onClick={() => goto('name')}>RECONFIGURE</button>
              </>
            )}
          </div>
        )}

        {step !== 'activate' && (
          <button type="button" className="rx-cta" onClick={next} disabled={!stepReady(draft, step)}>
            CONTINUE
          </button>
        )}
      </section>

      {/* Telemetry beside the Dog — the agent's state, never a sprite. */}
      <aside className="rx-telemetry rx-label">
        <span>AGENT</span><strong>{agentLabel}</strong>
        {/* The harness, named. Julius surrounds the worker slots; it is never
            one of them, and no single model is ever the orchestrator. */}
        <span>HARNESS</span><strong>{JULIUS.name}</strong>
        <span>STATUS</span>
        <strong>{draft.activatedAt !== null ? 'ACTIVE' : canActivate(draft) ? 'READY' : 'FORMING'}</strong>
        <span>WONDERLAND</span><strong>{readinessLabel(readiness)}</strong>
        {returning && <><span>SESSION</span><strong>RETURNING</strong></>}
      </aside>

      <nav className="rx-steps rx-label" aria-label="Creation steps">
        {ONBOARDING_STEPS.map((s) => (
          <button key={s.id} type="button" className="rx-tick" data-active={s.id === step ? 'true' : 'false'}
            onClick={() => goto(s.id)} aria-current={s.id === step ? 'step' : undefined}>
            {String(s.index + 1).padStart(2, '0')}
          </button>
        ))}
      </nav>
    </div>
  );
}

/** A step may advance once its own requirement is met. */
function stepReady(draft: CompoundAgentDraft, step: OnboardingStepId): boolean {
  switch (step) {
    case 'name': return normaliseName(draft.name).length > 0;
    case 'architect': return draft.promptArchitectId !== null;
    case 'coding': return draft.codingAgentId !== null;
    case 'reviewer': return draft.reviewerId !== null;
    case 'review': return canActivate(draft);
    default: return true;
  }
}
