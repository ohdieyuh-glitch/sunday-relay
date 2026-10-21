import { completedStages, currentStage, RELAY_STAGES } from './domain/stages';
import type { RelayMission, RelayStageId } from './domain/types';

/**
 * The custody rail — the relay track. Zones above the track say which ROLE
 * holds the baton for each leg (Relay itself, the implementer, the
 * independent reviewer, the gate). Actual agent identities are data from the
 * ingested artifacts, never asserted here.
 */

const CUSTODY: Record<RelayStageId, string> = {
  mission: 'relay',
  handoff: 'relay',
  implementation: 'implementer',
  review: 'reviewer',
  'repair-task': 'relay',
  repair: 'implementer',
  evidence: 'implementer',
  verified: 'gate',
};

export function PipelineRail({ mission }: { mission: RelayMission }) {
  const done = completedStages(mission);
  const current = currentStage(mission);
  const verified = Boolean(mission.verification);

  return (
    <ol className="relay-rail" aria-label="Golden path progress">
      {RELAY_STAGES.map((stage) => {
        const isDone = done.has(stage.id);
        const isCurrent = stage.id === current && !verified;
        const state = isDone ? 'done' : isCurrent ? 'current' : 'ahead';
        return (
          <li
            key={stage.id}
            className={`relay-rail-stage is-${state} zone-${CUSTODY[stage.id]}`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className="relay-rail-zone">{CUSTODY[stage.id]}</span>
            <span className={`relay-rail-node ${stage.id === 'verified' ? 'is-gate' : ''}`} aria-hidden>
              {isDone ? '✓' : ''}
            </span>
            <span className="relay-rail-label">{stage.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
