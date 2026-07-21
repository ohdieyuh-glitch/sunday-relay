import { useState } from 'react';
import { useRelayStore } from './state/store';
import { PipelineRail } from './PipelineRail';
import { StagePanel } from './StagePanel';
import { currentStage, RELAY_STAGES } from './domain/stages';
import type { RelayMission } from './domain/types';

function MissionForm() {
  const createMission = useRelayStore((s) => s.createMission);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [context, setContext] = useState('');
  const [constraints, setConstraints] = useState('');
  const [criteria, setCriteria] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  const submit = () => {
    const result = createMission({
      title,
      objective,
      context,
      constraints: constraints.split('\n'),
      acceptanceCriteria: criteria.split('\n'),
    });
    if (!result.ok) setErrors(result.errors);
    else setErrors([]);
  };

  return (
    <section className="relay-card relay-form">
      <h2>New mission</h2>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Anonymous spend banner" />
      </label>
      <label>
        Objective
        <textarea
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={3}
          placeholder="What the implementer must achieve, in one or two sentences."
        />
      </label>
      <label>
        Context <span className="relay-dim">(optional)</span>
        <textarea
          value={context}
          onChange={(e) => setContext(e.target.value)}
          rows={2}
          placeholder="Repo, branch, prior work — anything the implementer needs."
        />
      </label>
      <label>
        Constraints <span className="relay-dim">(one per line)</span>
        <textarea
          value={constraints}
          onChange={(e) => setConstraints(e.target.value)}
          rows={2}
          placeholder={'npm only — no yarn\nno provider keys in frontend'}
        />
      </label>
      <label>
        Acceptance criteria <span className="relay-dim">(one per line — the gate's meaning)</span>
        <textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          rows={3}
          placeholder={'banner visible for anonymous users\nfull vitest suite green'}
        />
      </label>
      {errors.length > 0 && (
        <ul className="relay-errors" role="alert">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}
      <button type="button" className="relay-btn primary" onClick={submit}>
        Create mission
      </button>
    </section>
  );
}

function Ledger({ mission }: { mission: RelayMission }) {
  return (
    <aside className="relay-ledger" aria-label="Chain of custody">
      <h2>Chain of custody</h2>
      <ol>
        {[...mission.ledger].reverse().map((event, i) => (
          <li key={`${event.at}-${i}`}>
            <span className="relay-ledger-stage">{event.stage}</span>
            <p>{event.summary}</p>
            <time dateTime={event.at}>{new Date(event.at).toLocaleString()}</time>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function MissionView({ mission }: { mission: RelayMission }) {
  const stage = RELAY_STAGES.find((s) => s.id === currentStage(mission));
  return (
    <div className="relay-mission">
      <header className="relay-mission-head">
        <div>
          <h2>
            {mission.title}
            {mission.recorded && <span className="relay-badge">Recorded</span>}
            {mission.verification && <span className="relay-badge verified">Verified</span>}
          </h2>
          <p className="relay-dim">{mission.objective}</p>
        </div>
        <p className="relay-stage-now">{stage?.description}</p>
      </header>
      <PipelineRail mission={mission} />
      <div className="relay-workarea">
        <StagePanel mission={mission} />
        <Ledger mission={mission} />
      </div>
    </div>
  );
}

export function RelayApp() {
  const missions = useRelayStore((s) => s.missions);
  const activeMissionId = useRelayStore((s) => s.activeMissionId);
  const selectMission = useRelayStore((s) => s.selectMission);
  const active = missions.find((m) => m.id === activeMissionId) ?? null;

  return (
    <div className="relay-app">
      <header className="relay-header">
        <div className="relay-brand">
          <span className="relay-wordmark">SUNDAY RELAY</span>
          <span className="relay-tagline">One mission. Two agents. A verified result.</span>
        </div>
        <nav className="relay-nav">
          {missions.length > 0 && (
            <select
              aria-label="Select mission"
              value={activeMissionId ?? ''}
              onChange={(e) => selectMission(e.target.value || null)}
            >
              <option value="">— missions —</option>
              {missions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                  {m.verification ? ' ✓' : ''}
                </option>
              ))}
            </select>
          )}
          {active && (
            <button type="button" className="relay-btn ghost" onClick={() => selectMission(null)}>
              New mission
            </button>
          )}
        </nav>
      </header>
      <main className="relay-main">{active ? <MissionView mission={active} /> : <MissionForm />}</main>
    </div>
  );
}
