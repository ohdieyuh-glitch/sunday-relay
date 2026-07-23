import { useMemo, useState } from 'react';
import type { AgentConnectionStatuses, RelayProjectDraft } from './contracts';
import { RelayAgentSelector } from './RelayAgentSelector';
import { RelayModeSelector } from './RelayModeSelector';
import { Field, RelaySettingsSection, Toggle } from './RelaySettingsSection';
import { projectReadiness } from './recommendations';

const memoryOptions = ['Repository context', 'Uploaded files', 'Project notes', 'Sunday Alcatraz context', 'Existing Relay Project Brain', 'Obsidian', 'OpenKnowledge'];
const notifications = [
  ['needs-user', 'Notify when Relay needs the user'], ['review-blocker', 'Notify when a review finds a blocker'],
  ['stopped-safely', 'Notify when a mission stops safely'], ['spending-threshold', 'Notify when spending reaches a threshold'],
  ['verified-complete', 'Notify when the mission is verified complete'],
] as const;

export function RelayProjectSettings({ draft, statuses, onSave, onCancel }: {
  draft: RelayProjectDraft; statuses: AgentConnectionStatuses; onSave: (draft: RelayProjectDraft) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState(draft);
  const readiness = useMemo(() => projectReadiness(form), [form]);
  const patch = <K extends keyof RelayProjectDraft>(key: K, value: RelayProjectDraft[K]) => setForm((current) => ({ ...current, [key]: value }));
  const toggleArray = (key: 'memory' | 'notifications', value: string, checked: boolean) =>
    patch(key, checked ? [...form[key], value] : form[key].filter((item) => item !== value));

  return <div className="rh-settings-overlay" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <form className="rh-settings" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
      <header className="rh-settings-head"><div><p className="rh-kicker">PROJECT CONFIGURATION / LOCAL DRAFT</p><h2 id="settings-title">PROJECT SETTINGS</h2></div>
        <button type="button" onClick={onCancel} aria-label="Close Project Settings">CLOSE ×</button></header>
      <div className="rh-validation" role="status"><strong>VALIDATION SUMMARY</strong>
        <span>{readiness.ready ? 'READY TO START' : `CONFIGURATION REQUIRED · ${readiness.missing.join(', ')}`}</span></div>

      <RelaySettingsSection number="01" title="PROJECT IDENTITY">
        <Field label="Project name"><input value={form.name} onChange={(e) => patch('name', e.target.value)} /></Field>
        <Field label="Project category"><input value={form.category} onChange={(e) => patch('category', e.target.value)} /></Field>
        <Field label="Project description" wide><textarea value={form.description} onChange={(e) => patch('description', e.target.value)} /></Field>
        <Field label="Main objective" wide><textarea value={form.objective} onChange={(e) => patch('objective', e.target.value)} /></Field>
        <Field label="Project origin"><select value={form.kind} onChange={(e) => patch('kind', e.target.value as 'new' | 'existing')}><option value="new">New project</option><option value="existing">Existing project</option></select></Field>
        <Field label="Repository or project source"><input value={form.source} onChange={(e) => patch('source', e.target.value)} placeholder="Repository URL or local project reference" /></Field>
      </RelaySettingsSection>

      <RelaySettingsSection number="02" title="PROJECT SCOPE">
        <Field label="Files and systems in scope" wide><textarea value={form.filesInScope} onChange={(e) => patch('filesInScope', e.target.value)} /></Field>
        <Field label="Files and systems out of scope" wide><textarea value={form.filesOutOfScope} onChange={(e) => patch('filesOutOfScope', e.target.value)} /></Field>
        <Field label="Protected areas" wide><textarea value={form.protectedAreas} onChange={(e) => patch('protectedAreas', e.target.value)} /></Field>
        <Toggle label="Production environment present" checked={form.productionPresent} onChange={(v) => patch('productionPresent', v)} />
        <Toggle label="Deployment allowed" checked={form.deploymentAllowed} onChange={(v) => patch('deploymentAllowed', v)} />
        <Toggle label="Destructive actions allowed" checked={form.destructiveActionsAllowed} onChange={(v) => patch('destructiveActionsAllowed', v)} />
        <Toggle label="Dependency installation allowed" checked={form.dependencyInstallationAllowed} onChange={(v) => patch('dependencyInstallationAllowed', v)} />
        <Toggle label="I have defined and confirmed project boundaries" checked={form.boundariesConfirmed} onChange={(v) => patch('boundariesConfirmed', v)} />
      </RelaySettingsSection>

      <RelaySettingsSection number="03" title="PROMPT ARCHITECT">
        <RelayAgentSelector label="Prompt Architect" value={form.architect} options={['Sunday Alcatraz', 'Manual Architect', 'External Architect', 'None']} statuses={statuses.architect} onChange={(v) => patch('architect', v)} />
      </RelaySettingsSection>
      <RelaySettingsSection number="04" title="CODING AGENT">
        <RelayAgentSelector label="Coding Agent" value={form.codingAgent} options={['Claude Code', 'Codex', 'Hermes', 'OpenClaw', 'Ophiuchus', 'Manual worker']} statuses={statuses.coding} onChange={(v) => patch('codingAgent', v)} />
      </RelaySettingsSection>
      <RelaySettingsSection number="05" title="REVIEWER">
        <RelayAgentSelector label="Reviewer" value={form.reviewer} options={['No Reviewer', 'Codex Independent Reviewer', 'Security Reviewer', 'Specialist Reviewer']} statuses={statuses.reviewer} onChange={(v) => patch('reviewer', v)} />
        <Toggle label="Reviewer required for substantive work" checked={form.reviewerRequired} onChange={(v) => patch('reviewerRequired', v)} />
        <p className="rh-field-note">Independent and specialist reviewers may require Pro or Max. Availability is shown per option.</p>
      </RelaySettingsSection>
      <RelaySettingsSection number="06" title="RELAY MODE">
        <RelayModeSelector value={form.mode} onChange={(v) => patch('mode', v)} />
      </RelaySettingsSection>

      <RelaySettingsSection number="07" title="ACCESS AND PERMISSIONS">
        <p className="rh-field-note rh-field--wide">Approve named tools, services, and authenticated session references only. Never enter passwords, credentials, or recovery material.</p>
        <Field label="Approved tools"><input value={form.approvedTools} onChange={(e) => patch('approvedTools', e.target.value)} placeholder="Named tools and exact scope" /></Field>
        <Field label="Approved services"><input value={form.approvedServices} onChange={(e) => patch('approvedServices', e.target.value)} placeholder="Named services and exact scope" /></Field>
        <Field label="Approved authenticated sessions"><input value={form.approvedSessions} onChange={(e) => patch('approvedSessions', e.target.value)} placeholder="Opaque session references only" /></Field>
        <Field label="Runtime limit (minutes)"><input type="number" min="1" value={form.runtimeLimitMinutes} onChange={(e) => patch('runtimeLimitMinutes', Number(e.target.value))} /></Field>
        <Field label="Spending limit (USD)"><input type="number" min="0" step="0.5" value={form.spendingLimitUsd} onChange={(e) => patch('spendingLimitUsd', Number(e.target.value))} /></Field>
        <Field label="Consent expiration"><select value={form.consentExpiration} onChange={(e) => patch('consentExpiration', e.target.value)}><option>End of mission</option><option>30 minutes</option><option>1 hour</option></select></Field>
      </RelaySettingsSection>

      <RelaySettingsSection number="08" title="PROJECT MEMORY">
        <div className="rh-check-grid rh-field--wide">{memoryOptions.map((option) => <label key={option}><input type="checkbox" checked={form.memory.includes(option)}
          disabled={option === 'Obsidian' || option === 'OpenKnowledge'} onChange={(e) => toggleArray('memory', option, e.target.checked)} />{option}
          {(option === 'Obsidian' || option === 'OpenKnowledge') && <small>COMING LATER</small>}</label>)}</div>
      </RelaySettingsSection>
      <RelaySettingsSection number="09" title="COMPLETION REQUIREMENTS">
        <Toggle label="Required tests" checked={form.requiredTests} onChange={(v) => patch('requiredTests', v)} />
        <Toggle label="Required build" checked={form.requiredBuild} onChange={(v) => patch('requiredBuild', v)} />
        <Toggle label="Required independent review" checked={form.requiredIndependentReview} onChange={(v) => patch('requiredIndependentReview', v)} />
        <Toggle label="Required security review" checked={form.requiredSecurityReview} onChange={(v) => patch('requiredSecurityReview', v)} />
        <Toggle label="Required manual approval" checked={form.requiredManualApproval} onChange={(v) => patch('requiredManualApproval', v)} />
        <Field label="Evidence required before completion" wide><textarea value={form.evidenceRequired} onChange={(e) => patch('evidenceRequired', e.target.value)} /></Field>
        <Field label="Completion rule" wide><textarea value={form.completionRule} onChange={(e) => patch('completionRule', e.target.value)} /></Field>
      </RelaySettingsSection>
      <RelaySettingsSection number="10" title="LIMITS">
        <Field label="Maximum runtime (minutes)"><input type="number" min="1" value={form.runtimeLimitMinutes} onChange={(e) => patch('runtimeLimitMinutes', Number(e.target.value))} /></Field>
        <Field label="Maximum agent calls"><input type="number" min="1" value={form.maximumAgentCalls} onChange={(e) => patch('maximumAgentCalls', Number(e.target.value))} /></Field>
        <Field label="Spending limit (USD)"><input type="number" min="0" value={form.spendingLimitUsd} onChange={(e) => patch('spendingLimitUsd', Number(e.target.value))} /></Field>
        <Field label="Maximum review cycles"><input type="number" min="0" value={form.maximumReviewCycles} onChange={(e) => patch('maximumReviewCycles', Number(e.target.value))} /></Field>
        <Field label="Maximum repair cycles"><input type="number" min="0" value={form.maximumRepairCycles} onChange={(e) => patch('maximumRepairCycles', Number(e.target.value))} /></Field>
        <Toggle label="Stop when no progress is detected" checked={form.stopOnNoProgress} onChange={(v) => patch('stopOnNoProgress', v)} />
      </RelaySettingsSection>
      <RelaySettingsSection number="11" title="NOTIFICATIONS">
        <p className="rh-field-note rh-field--wide">Preferences only. Notification delivery infrastructure is not active in this phase.</p>
        {notifications.map(([key, label]) => <Toggle key={key} label={label} checked={form.notifications.includes(key)} onChange={(v) => toggleArray('notifications', key, v)} />)}
      </RelaySettingsSection>
      <footer className="rh-settings-actions"><button type="button" onClick={onCancel}>CANCEL</button><button className="rh-primary" type="submit">SAVE PROJECT SETTINGS</button></footer>
    </form>
  </div>;
}
