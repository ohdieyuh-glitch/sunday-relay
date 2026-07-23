import { useState } from 'react';
import type { RelayHomePageProps, RelayProjectDraft } from './contracts';
import { PROJECT_ROUTES } from './fixtures';
import { applyRecommendedSetup, applyRoute, projectReadiness } from './recommendations';
import { RelayHomeDog } from './RelayHomeDog';
import { RelayHomeHeader } from './RelayHomeHeader';
import { RelayProjectComposer } from './RelayProjectComposer';
import { RelayProjectRoutes } from './RelayProjectRoutes';
import { RelayQuickStart } from './RelayQuickStart';
import { RelayRecentProjects } from './RelayRecentProjects';
import { RelayRecommendations } from './RelayRecommendations';
import { RelayProjectReadiness } from './RelayProjectReadiness';
import { RelayProjectSettings } from './RelayProjectSettings';
import { RelayWorkforcePreview } from './RelayWorkforcePreview';
import './relay-home.css';

export function RelayHomePage(props: RelayHomePageProps) {
  const [draft, setDraft] = useState(props.projectDraft);
  const [selectedRoute, setSelectedRoute] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const readiness = projectReadiness(draft);
  const update = (next: RelayProjectDraft) => { setDraft(next); props.onUpdateProjectDraft(next); };
  const openSettings = () => { setSettingsOpen(true); props.onOpenProjectSettings(); };

  return <div className="relay-home">
    <a className="rh-skip" href="#relay-home-main">Skip to project setup</a>
    <RelayHomeHeader mode={draft.mode} terminalState={props.terminalState} onMode={(mode) => update({ ...draft, mode })}
      onSettings={openSettings} onTerminal={props.onOpenTerminal} />
    <main id="relay-home-main">
      <div className="rh-ambient" aria-hidden="true"><span /><span /><span /></div>
      <div className="rh-intro-grid">
        <RelayProjectComposer draft={draft} ready={readiness.ready} missing={readiness.missing} onChange={update}
          onStart={() => readiness.ready && props.onCreateProject(draft)} onConnect={props.onConnectProject} onSettings={openSettings} />
        <RelayHomeDog state={props.dogState} />
      </div>
      <RelayProjectReadiness draft={draft} />
      <RelayQuickStart onNew={() => document.getElementById('relay-objective')?.focus()} onConnect={props.onConnectProject} onSettings={openSettings} />
      <div className="rh-system-grid">
        <RelayProjectRoutes selected={selectedRoute} onSelect={(id) => {
          const route = PROJECT_ROUTES.find((item) => item.id === id);
          if (route) { setSelectedRoute(id); update(applyRoute(draft, route)); }
        }} />
        <div className="rh-system-side">
          <RelayWorkforcePreview draft={draft} statuses={props.connectionStatuses} />
          <RelayRecommendations draft={draft} onApply={() => {
            const next = applyRecommendedSetup(draft); update(next); props.onApplyRecommendation(next);
          }} onSettings={openSettings} />
        </div>
      </div>
      <RelayRecentProjects projects={props.recentProjects} onOpen={props.onOpenProject} />
      <section className="rh-terminal-empty"><div><span>[ &gt;_ ]</span><div><strong>LIVE TERMINAL</strong><p>No mission is running. Relay activity will appear here after the project starts.</p></div></div>
        <button type="button" onClick={props.onOpenTerminal}>OPEN LIVE TERMINAL →</button></section>
    </main>
    <div className="rh-mobile-start"><span>{readiness.ready ? 'READY TO START' : `${readiness.missing.length} ITEMS MISSING`}</span>
      <button className="rh-primary" type="button" disabled={!readiness.ready} onClick={() => props.onCreateProject(draft)}>START PROJECT</button></div>
    {settingsOpen && <RelayProjectSettings draft={draft} statuses={props.connectionStatuses}
      onSave={(next) => { update(next); props.onSaveProjectSettings?.(next); setSettingsOpen(false); }}
      onCancel={() => { setSettingsOpen(false); props.onCancelProjectSettings?.(); }} />}
  </div>;
}
