import { useMemo, useState } from 'react';
import { RelayDogMark } from '../pixel-dog';
import { createDefaultSettingsDraft } from './defaults';
import { validateSettingsDraft } from './validation';
import {
  SectionMemory,
  SectionMode,
  SectionPlatform,
  SectionProject,
  SectionProjectType,
  SectionResearch,
  SectionTechnology,
} from './SettingsSections';
import {
  SectionLimits,
  SectionNotifications,
  SectionPermissions,
  SectionScope,
  SectionVerification,
} from './SettingsPolicySections';
import { SettingsWorkforce } from './SettingsWorkforce';
import { SectionMcp } from './SettingsMcp';
import { SettingsReview } from './SettingsReview';
import type {
  ProjectSettingsDraft,
  RelayProjectSettingsProps,
  SettingsSectionId,
  SetupMode,
} from './contracts';

/**
 * PROJECT SETTINGS — RLY / CONFIG. The click-first project configurator
 * between the Relay Entry Home and the Active Project Workspace. A normal
 * project is configured entirely by clicking; freeform inputs exist only
 * behind explicit CUSTOM actions. One focused section at a time, a numbered
 * section rail (desktop) or stepped flow (mobile), a persistent compact
 * summary, and a final REVIEW AND START gate. The UI never starts execution
 * by itself — START PROJECT invokes the host callback and stays disabled
 * while required configuration is missing.
 */

const SECTIONS: Array<{ id: SettingsSectionId; number: string; label: string }> = [
  { id: 'project', number: '01', label: 'PROJECT' },
  { id: 'project_type', number: '02', label: 'PROJECT TYPE' },
  { id: 'platform', number: '03', label: 'PLATFORM' },
  { id: 'technology', number: '04', label: 'TECHNOLOGY' },
  { id: 'workforce', number: '05', label: 'WORKFORCE' },
  { id: 'mode', number: '06', label: 'MODE' },
  { id: 'research', number: '07', label: 'RESEARCH' },
  { id: 'memory', number: '08', label: 'PROJECT MEMORY' },
  { id: 'scope', number: '09', label: 'SCOPE' },
  { id: 'permissions', number: '10', label: 'PERMISSIONS' },
  { id: 'verification', number: '11', label: 'VERIFICATION' },
  { id: 'limits', number: '12', label: 'LIMITS' },
  { id: 'notifications', number: '13', label: 'NOTIFICATIONS' },
  // MCP CONNECTIONS sits after the policy sections and before REVIEW because
  // it is the last thing an operator inspects before starting: which curated
  // connectors exist, what is actually connected, and what a mission's MCP
  // preflight would say. It is READ AND REVIEW, not draft configuration —
  // nothing in this section writes to the settings draft.
  { id: 'mcp', number: '14', label: 'MCP CONNECTIONS' },
  { id: 'review', number: '15', label: 'REVIEW AND START' },
];

export function RelayProjectSettings({
  brief,
  agentOptions,
  entitlement,
  initialDraft,
  mcp,
  onSaveDraft,
  onStartProject,
  onConnectRepository,
  onBack,
  backLabel = '← RELAY HOME',
  initialSetupMode = 'quick',
}: RelayProjectSettingsProps) {
  /**
   * ONE DRAFT, TWO DOORS.
   *
   * Quick Setup and the fifteen-section flow are two views of THIS state and
   * they save through the same callbacks. That is the whole design: a second
   * component with its own draft would be the duplicate configuration system
   * the direction forbids, and the two would drift the first time a field was
   * added to one of them.
   */
  const [draft, setDraft] = useState<ProjectSettingsDraft>(
    () => initialDraft ?? createDefaultSettingsDraft(brief),
  );
  const [setupMode, setSetupMode] = useState<SetupMode>(initialSetupMode);
  const [active, setActive] = useState<SettingsSectionId>('project');

  const patch = (p: Partial<ProjectSettingsDraft>) => setDraft((d) => ({ ...d, ...p }));
  const validation = useMemo(() => validateSettingsDraft(draft, agentOptions), [draft, agentOptions]);

  const index = SECTIONS.findIndex((s) => s.id === active);
  const activeMeta = SECTIONS[index];
  const agentName = (id: string | null) => agentOptions.find((o) => o.id === id)?.name ?? '—';

  const body = (() => {
    switch (active) {
      case 'project':
        return (
          <SectionProject draft={draft} brief={brief} patch={patch} onConnectRepository={onConnectRepository} />
        );
      case 'project_type':
        return <SectionProjectType draft={draft} patch={patch} />;
      case 'platform':
        return <SectionPlatform draft={draft} patch={patch} />;
      case 'technology':
        return <SectionTechnology draft={draft} patch={patch} />;
      case 'workforce':
        return (
          <SettingsWorkforce
            agentOptions={agentOptions}
            selection={draft.workforce}
            onChange={(workforce) => patch({ workforce })}
          />
        );
      case 'mode':
        return <SectionMode draft={draft} patch={patch} />;
      case 'research':
        return <SectionResearch draft={draft} patch={patch} />;
      case 'memory':
        return <SectionMemory draft={draft} patch={patch} />;
      case 'scope':
        return <SectionScope draft={draft} patch={patch} />;
      case 'permissions':
        return <SectionPermissions draft={draft} patch={patch} />;
      case 'verification':
        return <SectionVerification draft={draft} patch={patch} />;
      case 'limits':
        return <SectionLimits draft={draft} patch={patch} />;
      case 'notifications':
        return <SectionNotifications draft={draft} patch={patch} />;
      case 'mcp':
        return <SectionMcp mcp={mcp} />;
      case 'review':
        return (
          <SettingsReview
            draft={draft}
            validation={validation}
            agentOptions={agentOptions}
            onBack={() => setActive('mcp')}
            onSaveDraft={() => onSaveDraft(draft)}
            onStartProject={() => onStartProject(draft)}
          />
        );
    }
  })();

  /**
   * QUICK SETUP — the four decisions a project cannot start without, plus the
   * action that starts it.
   *
   * Every group here is the SAME component the long flow uses, patching the
   * SAME draft. Nothing was re-implemented in a smaller form, so a control
   * cannot behave differently depending on which door a founder came through.
   * What Quick leaves out is not hidden: the note names it and the switch to
   * the full flow is one click away, with the draft carried across untouched.
   */
  const quickBody = (
    <div className="rps-quick">
      <p className="rps-quick-note">
        The four decisions a project cannot start without. Everything else keeps its
        recommended default and stays editable in Advanced Setup — this writes the same
        configuration, not a simplified copy of it.
      </p>

      <section className="rps-quick-group" aria-label="Agent stack">
        <h2 className="rps-quick-heading">01 — AGENT STACK</h2>
        <SettingsWorkforce
          agentOptions={agentOptions}
          selection={draft.workforce}
          onChange={(workforce) => patch({ workforce })}
        />
      </section>

      <section className="rps-quick-group" aria-label="Mode">
        <h2 className="rps-quick-heading">02 — MODE</h2>
        <SectionMode draft={draft} patch={patch} />
      </section>

      <section className="rps-quick-group" aria-label="Permissions">
        <h2 className="rps-quick-heading">03 — PERMISSIONS</h2>
        <SectionPermissions draft={draft} patch={patch} />
      </section>

      <section className="rps-quick-group" aria-label="Compute and limits">
        <h2 className="rps-quick-heading">04 — COMPUTE AND LIMITS</h2>
        <SectionLimits draft={draft} patch={patch} />
      </section>

      <section className="rps-quick-group" aria-label="Create">
        <h2 className="rps-quick-heading">05 — CREATE</h2>
        {/* THE SAME GATE. Blockers are the validator's, not a shorter list:
            a project that Quick Setup would start must be one the long flow
            would start too. */}
        {validation.blockers.length > 0 && (
          <ul className="rps-quick-blockers">
            {validation.blockers.map((b) => <li key={b.id}>{b.message}</li>)}
          </ul>
        )}
        <div className="rps-quick-actions">
          <button type="button" className="rps-btn rps-btn--ghost" onClick={() => onSaveDraft(draft)}>
            SAVE DRAFT
          </button>
          <button
            type="button"
            className="rps-btn rps-btn--primary"
            disabled={validation.blockers.length > 0}
            onClick={() => onStartProject(draft)}
          >
            CREATE PROJECT
          </button>
        </div>
      </section>
    </div>
  );

  return (
    <div className="rps">
      <div className="rps-grid-bg" aria-hidden="true" />
      <header className="rps-header">
        <div className="rps-header-left">
          <RelayDogMark unit={2} />
          <span className="rps-wordmark" aria-label="SUNDAY RELAY">
            <span className="rps-wordmark-sunday" aria-hidden="true">SUNDAY</span>{' '}
            <span className="rps-wordmark-relay" aria-hidden="true">RELAY</span>
          </span>
          <span className="rps-ref-chip">RLY / CONFIG</span>
        </div>
        <h1 className="rps-title">PROJECT SETTINGS</h1>
        {/* TWO DOORS INTO ONE CONFIGURATION. Switching carries the draft
            across untouched — it is the same object — so nothing a founder
            chose in one view is lost by looking at the other. */}
        <div className="rps-modeswitch" role="group" aria-label="Setup depth">
          <button
            type="button"
            className={`rps-modeswitch-btn${setupMode === 'quick' ? ' is-active' : ''}`}
            aria-pressed={setupMode === 'quick'}
            onClick={() => setSetupMode('quick')}
          >
            QUICK SETUP
          </button>
          <button
            type="button"
            className={`rps-modeswitch-btn${setupMode === 'advanced' ? ' is-active' : ''}`}
            aria-pressed={setupMode === 'advanced'}
            onClick={() => setSetupMode('advanced')}
          >
            ADVANCED SETUP
          </button>
        </div>
        <div className="rps-header-right">
          <span className="rps-plan">PLAN / {entitlement.toUpperCase()}</span>
          {/* THE EXIT SAYS WHERE IT GOES.

              This was the literal "← RELAY HOME", and it is the only way out
              of Settings. Opening Settings from inside a project therefore
              offered exactly one exit, labelled with the homepage — so a
              founder pressing it lost the project, and the control had told
              them it would. The label follows the destination now. */}
          <button type="button" className="rps-btn" onClick={onBack}>
            {backLabel}
          </button>
        </div>
      </header>

      {setupMode === 'quick' ? quickBody : (
      <div className="rps-layout">
        <nav className="rps-rail" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`rps-rail-item${s.id === active ? ' is-active' : ''}`}
              aria-current={s.id === active ? 'step' : undefined}
              onClick={() => setActive(s.id)}
            >
              <span className="rps-rail-number">{s.number}</span>
              <span className="rps-rail-label">{s.label}</span>
            </button>
          ))}
        </nav>

        <main className="rps-content">
          <p className="rps-section-eyebrow" role="status">
            {activeMeta.number} / {SECTIONS.length} — {activeMeta.label}
          </p>
          {body}

          <div className="rps-nav-actions">
            <button
              type="button"
              className="rps-btn"
              disabled={index === 0}
              onClick={() => setActive(SECTIONS[Math.max(0, index - 1)].id)}
            >
              ← BACK
            </button>
            <button type="button" className="rps-btn rps-btn--ghost" onClick={() => onSaveDraft(draft)}>
              SAVE DRAFT
            </button>
            {active !== 'review' ? (
              <button
                type="button"
                className="rps-btn rps-btn--primary"
                onClick={() => setActive(SECTIONS[Math.min(SECTIONS.length - 1, index + 1)].id)}
              >
                NEXT →
              </button>
            ) : null}
          </div>
        </main>

        <aside className="rps-summary" aria-label="Configuration summary">
          <p className="rps-summary-title">CONFIGURATION</p>
          <dl className="rps-summary-rows">
            <div>
              <dt>PROJECT</dt>
              <dd>{draft.projectName ?? '—'}</dd>
            </div>
            <div>
              <dt>MODE</dt>
              <dd>{draft.mode.toUpperCase()}</dd>
            </div>
            <div>
              <dt>ARCHITECT</dt>
              <dd>{agentName(draft.workforce.promptArchitectId)}</dd>
            </div>
            <div>
              <dt>CODING AGENT</dt>
              <dd>{agentName(draft.workforce.codingAgentId)}</dd>
            </div>
            <div>
              <dt>REVIEWER</dt>
              <dd>
                {draft.workforce.reviewerPolicy === 'never'
                  ? 'Not required'
                  : agentName(draft.workforce.reviewerId)}
              </dd>
            </div>
            <div>
              <dt>RESEARCH</dt>
              <dd>{draft.research.mode.replace(/_/g, ' ').toUpperCase()}</dd>
            </div>
            <div>
              <dt>SPEND</dt>
              <dd>${draft.limits.spendUsd}</dd>
            </div>
            <div>
              <dt>READY</dt>
              <dd>{validation.blockers.length === 0 ? 'YES' : `${validation.blockers.length} BLOCKED`}</dd>
            </div>
          </dl>
          <button type="button" className="rps-btn rps-btn--primary rps-summary-review" onClick={() => setActive('review')}>
            REVIEW SETUP
          </button>
        </aside>
      </div>
      )}
    </div>
  );
}
