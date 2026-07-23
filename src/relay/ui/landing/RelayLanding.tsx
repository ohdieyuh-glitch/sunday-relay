import { useMemo, useState, type ChangeEvent, type ReactNode } from 'react';
import { getRelayPolicyRecommendations } from './policy';
import { defaultRelayProjectSetup, type RelayLandingProps, type RelayProjectSetup } from './types';
import './relay-landing.css';

const ROUTES = [
  ['01', 'Ship a feature', 'Plan, implement, review, and prove a bounded product change.'],
  ['02', 'Review a repository', 'Map risks and return evidence without changing the project.'],
  ['03', 'Fix a failing build', 'Trace the failure, repair it, and rerun the relevant checks.'],
  ['04', 'Harden authentication', 'Audit trust boundaries and propose verified fixes.'],
  ['05', 'Build a landing page', 'Turn a product brief into an accessible responsive surface.'],
  ['06', 'Create an API', 'Define contracts, implement endpoints, and verify behavior.'],
] as const;

const AGENTS = {
  'sunday-architect': 'Sunday Prompt Architect',
  'claude-code': 'Claude Code',
  codex: 'Codex',
  'codex-reviewer': 'Codex Reviewer',
  'claude-reviewer': 'Claude Reviewer',
  none: 'No reviewer',
} as const;

function PixelRelayDog() {
  return (
    <div className="rl-dog" role="img" aria-label="Pixel Relay Dog standing by">
      <div className="rl-dog-sprite" aria-hidden="true">
        <i className="ear a"/><i className="ear b"/><i className="head"/><i className="eye a"/><i className="eye b"/>
        <i className="muzzle"/><i className="body"/><i className="leg a"/><i className="leg b"/><i className="tail"/>
      </div>
      <span>RLY-DOG / STANDBY</span>
    </div>
  );
}

function Station({ number, role, agent, optional }: { number: string; role: string; agent: string; optional?: boolean }) {
  return <div className="rl-station"><span>{number}</span><b>{role}</b><small>{agent}{optional ? ' / OPTIONAL' : ' / AVAILABLE TO SELECT'}</small></div>;
}

export function RelayLanding({ initialSetup, onConnectProject, onStart, onOpenTerminal, onSetupChange }: RelayLandingProps) {
  const [setup, setSetup] = useState<RelayProjectSetup>({ ...defaultRelayProjectSetup, ...initialSetup });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const recommendations = useMemo(() => getRelayPolicyRecommendations(setup), [setup]);

  const update = <K extends keyof RelayProjectSetup>(key: K, value: RelayProjectSetup[K]) => {
    const next = { ...setup, [key]: value };
    setSetup(next);
    onSetupChange?.(next);
  };
  const text = (key: keyof RelayProjectSetup) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => update(key, event.target.value as never);
  const number = (key: keyof RelayProjectSetup) => (event: ChangeEvent<HTMLInputElement>) => update(key, Number(event.target.value) as never);
  const chooseRoute = (objective: string) => { update('objective', objective); setSettingsOpen(true); };

  return (
    <div className="rl-shell">
      <a className="rl-skip" href="#relay-mission">Skip to mission input</a>
      <header className="rl-header">
        <a className="rl-brand" href="#relay-home" aria-label="Sunday Relay home"><i/> SUNDAY RELAY</a>
        <div className="rl-header-readout" aria-label="Project status">
          <span>PROJECT / <b>UNCONFIGURED</b></span><span>MODE / <b>{setup.mode.toUpperCase()}</b></span><span>STATUS / <b>READY</b></span>
        </div>
        <button className="rl-terminal" type="button" onClick={onOpenTerminal} aria-label="Enter Live Terminal">&gt;_ <span>TERMINAL</span></button>
      </header>

      <main id="relay-home">
        <section className="rl-stage" aria-labelledby="relay-title">
          <div className="rl-stage-grid" aria-hidden="true"/>
          <div className="rl-stage-label"><span>RELAY NETWORK / 00</span><b>PRE-PROJECT READY STATE</b></div>
          <div className="rl-stations">
            <Station number="A1" role="PROMPT ARCHITECT" agent={AGENTS[setup.promptArchitect]} />
            <div className="rl-handoff" aria-hidden="true"><i/><i/><i/></div>
            <Station number="B2" role="CODING AGENT" agent={AGENTS[setup.codingAgent]} />
            <div className="rl-handoff" aria-hidden="true"><i/><i/><i/></div>
            <Station number="C3" role="REVIEWER" agent={AGENTS[setup.reviewer]} optional />
          </div>
          <PixelRelayDog />
          <p className="rl-dog-message"><b>RELAY:</b> Connect a project or describe what you want to build.</p>
        </section>

        <section className="rl-intro" aria-labelledby="relay-title">
          <p className="rl-kicker">YOU ASK. RELAY COORDINATES.</p>
          <h1 id="relay-title">Build the workforce.<br/><em>Keep the context.</em></h1>
          <p>Define the objective, boundaries, agents, and proof once. Relay keeps the mission legible from first handoff to verified completion.</p>
        </section>

        <section className="rl-mission" id="relay-mission" aria-labelledby="mission-label">
          <div className="rl-section-code">RLY / INPUT 001</div>
          <label id="mission-label" htmlFor="relay-objective">What do you want Relay to accomplish?</label>
          <textarea id="relay-objective" value={setup.objective} onChange={text('objective')} placeholder="Describe a concrete outcome, constraint, or problem…" rows={3}/>
          <div className="rl-actions">
            <button type="button" onClick={onConnectProject}>Connect project</button>
            <button type="button" onClick={() => setSettingsOpen(true)}>Describe objective</button>
            <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen} aria-controls="relay-settings">Project settings</button>
            <button className="signal" type="button" onClick={() => onStart?.(setup)}>Start with Relay <span>→</span></button>
          </div>
          <p className="rl-truth">Configuration only. No project is connected and no agent runs until the host application confirms setup.</p>
        </section>

        <section className="rl-recommends" aria-labelledby="recommend-title">
          <div><p className="rl-kicker">RELAY RECOMMENDS</p><h2 id="recommend-title">Choose the shortest route to useful context.</h2></div>
          <ol><li><b>01 /</b> Connect an existing project</li><li><b>02 /</b> Start from an objective</li><li><b>03 /</b> Use recommended workforce</li></ol>
        </section>

        <section className="rl-routes" aria-labelledby="routes-title">
          <div className="rl-section-head"><p className="rl-kicker">BUILDER ROUTES</p><h2 id="routes-title">Start with a known mission shape.</h2></div>
          <div className="rl-route-grid">{ROUTES.map(([n, title, detail]) => <button type="button" key={n} onClick={() => chooseRoute(title)}><span>{n}</span><b>{title}</b><small>{detail}</small><i aria-hidden="true">↗</i></button>)}</div>
        </section>

        <section className={`rl-settings${settingsOpen ? ' is-open' : ''}`} id="relay-settings" aria-labelledby="settings-title" hidden={!settingsOpen}>
          <div className="rl-settings-head"><div><p className="rl-kicker">RLY / CONFIG 001</p><h2 id="settings-title">Project Settings</h2></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close project settings">CLOSE ×</button></div>
          <form onSubmit={(event) => { event.preventDefault(); onStart?.(setup); }}>
            <ConfigSection number="01" title="Project identity"><Field label="Project name"><input value={setup.projectName} onChange={text('projectName')} placeholder="Untitled project"/></Field><Field label="Project description"><textarea value={setup.description} onChange={text('description')} rows={3}/></Field><Field label="Project objective"><textarea value={setup.objective} onChange={text('objective')} rows={4} required/></Field></ConfigSection>
            <ConfigSection number="02" title="Project boundaries"><Field label="In scope"><textarea value={setup.scope} onChange={text('scope')} placeholder="Features, directories, systems…" rows={3}/></Field><Field label="Protected areas"><textarea value={setup.protectedAreas} onChange={text('protectedAreas')} placeholder="Do not modify…" rows={3}/></Field><Field label="Repository or project source" hint="Reference only; connection happens outside this UI."><input value={setup.projectSource} onChange={text('projectSource')} placeholder="Repository URL or local project label"/></Field></ConfigSection>
            <ConfigSection number="03" title="Prompt Architect"><AgentSelect label="Selection" value={setup.promptArchitect} onChange={text('promptArchitect')} options={[['sunday-architect','Sunday Prompt Architect — available to select'],['codex','Codex — availability confirmed by host']]}/></ConfigSection>
            <ConfigSection number="04" title="Coding Agent"><AgentSelect label="Selection" value={setup.codingAgent} onChange={text('codingAgent')} options={[['claude-code','Claude Code — requires host connection'],['codex','Codex — requires host connection']]}/></ConfigSection>
            <ConfigSection number="05" title="Reviewer"><AgentSelect label="Optional selection" value={setup.reviewer} onChange={text('reviewer')} options={[['codex-reviewer','Codex Reviewer — requires host connection'],['claude-reviewer','Claude Reviewer — requires host connection'],['none','No reviewer — completion remains unverified']]}/></ConfigSection>
            <ConfigSection number="06" title="Relay mode"><div className="rl-mode-group" role="radiogroup" aria-label="Relay operating mode">{(['guided','semi','autonomous'] as const).map((mode) => <label key={mode}><input type="radio" name="relay-mode" checked={setup.mode === mode} onChange={() => update('mode', mode)}/><b>{mode}</b><span>{mode === 'guided' ? 'Approval at major handoffs' : mode === 'semi' ? 'Pause at risk and review gates' : 'Run within explicit limits'}</span></label>)}</div></ConfigSection>
            <ConfigSection number="07" title="Access and limits"><div className="rl-limit-grid"><NumberField label="Runtime / min" value={setup.maxRuntimeMinutes} onChange={number('maxRuntimeMinutes')}/><NumberField label="Spend / USD" value={setup.maxSpendUsd} onChange={number('maxSpendUsd')} step="0.5"/><NumberField label="Agent calls" value={setup.maxAgentCalls} onChange={number('maxAgentCalls')}/><NumberField label="Reviews" value={setup.maxReviews} onChange={number('maxReviews')}/><NumberField label="Repair cycles" value={setup.maxRepairCycles} onChange={number('maxRepairCycles')}/></div><p className="rl-truth">Limits are configuration requests for the host. This screen does not authorize spending, credentials, destructive actions, or deployment.</p></ConfigSection>
            <ConfigSection number="08" title="Project memory"><Field label="Knowledge and project-memory sources" hint="Names and locations only. Never enter secrets."><textarea value={setup.memorySources} onChange={text('memorySources')} placeholder="README, architecture docs, design system, issue brief…" rows={4}/></Field></ConfigSection>
            <ConfigSection number="09" title="Completion proof"><Field label="Evidence and completion requirements"><textarea value={setup.evidenceRequirements} onChange={text('evidenceRequirements')} rows={4}/></Field></ConfigSection>
            <ConfigSection number="10" title="Notifications"><AgentSelect label="Notify me" value={setup.notifications} onChange={text('notifications')} options={[['attention-only','Only when attention is required'],['milestones','At mission milestones'],['terminal','In Live Terminal'],['none','No notifications']]}/></ConfigSection>
            <ConfigSection number="REC" title="Relay policy recommendations"><div className="rl-policy-list">{recommendations.map((item) => <article key={item.code} data-level={item.level}><span>{item.code}</span><div><b>{item.label}</b><p>{item.detail}</p></div></article>)}</div></ConfigSection>
            <ConfigSection number="MAP" title="Workforce preview"><div className="rl-workforce"><p><span>01</span><b>ARCHITECT</b>{AGENTS[setup.promptArchitect]}</p><i>→</i><p><span>02</span><b>BUILD</b>{AGENTS[setup.codingAgent]}</p><i>→</i><p><span>03</span><b>REVIEW</b>{AGENTS[setup.reviewer]}</p></div><p className="rl-truth">Agents shown are selections, not active connections. Availability and authorization must be confirmed by the host before a mission begins.</p><div className="rl-submit"><button type="button" onClick={onOpenTerminal}>Enter Live Terminal</button><button className="signal" type="submit">Confirm setup <span>→</span></button></div></ConfigSection>
          </form>
        </section>
      </main>
      <footer className="rl-footer"><b>SUNDAY RELAY</b><span>PRE-PROJECT SYSTEM / READY</span><span>© AQUALA TECHNOLOGIES</span></footer>
    </div>
  );
}

function ConfigSection({ number, title, children }: { number: string; title: string; children: ReactNode }) { return <fieldset className="rl-config"><legend><span>{number}</span>{title}</legend><div className="rl-config-body">{children}</div></fieldset>; }
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <label className="rl-field"><b>{label}</b>{hint && <small>{hint}</small>}{children}</label>; }
function AgentSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (e: ChangeEvent<HTMLSelectElement>) => void; options: readonly (readonly [string,string])[] }) { return <Field label={label}><select value={value} onChange={onChange}>{options.map(([v,l]) => <option key={v} value={v}>{l}</option>)}</select></Field>; }
function NumberField({ label, value, onChange, step = '1' }: { label: string; value: number; onChange: (e: ChangeEvent<HTMLInputElement>) => void; step?: string }) { return <Field label={label}><input type="number" min="0" step={step} value={value} onChange={onChange}/></Field>; }
