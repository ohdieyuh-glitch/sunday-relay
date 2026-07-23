import type { RelayProjectDraft } from './contracts';

export function RelayProjectComposer({ draft, ready, missing, onChange, onStart, onConnect, onSettings }: {
  draft: RelayProjectDraft; ready: boolean; missing: string[]; onChange: (draft: RelayProjectDraft) => void;
  onStart: () => void; onConnect: () => void; onSettings: () => void;
}) {
  return <section className="rh-composer" aria-labelledby="build-heading">
    <p className="rh-kicker">PROJECT ZERO / OBJECTIVE</p>
    <h1 id="build-heading">What are we building?</h1>
    <p className="rh-lede">Start a new project, connect an existing one, or choose a Relay starting route.</p>
    <label htmlFor="relay-objective">MAIN PROJECT OBJECTIVE</label>
    <textarea id="relay-objective" value={draft.objective} onChange={(event) => onChange({ ...draft, objective: event.target.value })}
      placeholder="Build a secure dashboard for managing AI model usage and spending." />
    <div className="rh-composer-actions">
      <button type="button" className="rh-primary" disabled={!ready} onClick={onStart}>START PROJECT <span>→</span></button>
      <button type="button" onClick={onConnect}>CONNECT EXISTING PROJECT</button>
      <button type="button" onClick={onSettings}>OPEN PROJECT SETTINGS</button>
    </div>
    {!ready && <p className="rh-inline-status" role="status">CONFIGURATION REQUIRED · Missing: {missing.join(', ')}</p>}
  </section>;
}
