import { REVIEWER_STATE_LABEL } from './projections';
import type {
  ArchitectStatus,
  CodingAgentStatus,
  ProjectPhase,
  RelayWorkspaceMode,
  WorkforceAssignment,
} from './contracts';

/**
 * Project command strip — one continuous horizontal system strip with thin
 * dividers, compact labels, gold status squares (never large rounded cards),
 * per the founder screenshots. Architect · Coding Agent · Reviewer · Mode ·
 * Phase.
 */

const ARCHITECT_LABEL: Record<ArchitectStatus, string> = {
  planning: 'PLANNING',
  researching: 'RESEARCHING',
  preparing_handoff: 'PREPARING HANDOFF',
  waiting: 'WAITING',
};

const CODING_LABEL: Record<CodingAgentStatus, string> = {
  ready: 'READY',
  implementing: 'IMPLEMENTING',
  verifying: 'VERIFYING',
  repairing: 'REPAIRING',
  waiting: 'WAITING',
};

const PHASE_LABEL: Record<ProjectPhase, string> = {
  plan: 'PLAN',
  research: 'RESEARCH',
  build: 'BUILD',
  verify: 'VERIFY',
  review: 'REVIEW',
  repair: 'REPAIR',
  complete: 'COMPLETE',
};

export function RelayWorkforceStrip({
  workforce,
  mode,
  phase,
}: {
  workforce: WorkforceAssignment;
  mode: RelayWorkspaceMode;
  phase: ProjectPhase;
}) {
  const cell = (key: string, name: string, status: string, phaseCell = false) => (
    <div className={`rpw-strip-cell${phaseCell ? ' rpw-strip-cell--phase' : ''}`}>
      <span className="rpw-key">{key}</span>
      <span className="rpw-strip-name">
        <span className="rpw-strip-square" aria-hidden="true">
          ■
        </span>{' '}
        {name}
      </span>
      <span className="rpw-strip-status">{status}</span>
    </div>
  );

  return (
    <div className="rpw-strip" role="group" aria-label="Project workforce and mode">
      {cell('PROMPT ARCHITECT', workforce.promptArchitect.name, ARCHITECT_LABEL[workforce.promptArchitect.status])}
      {cell('CODING AGENT', workforce.codingAgent.name, CODING_LABEL[workforce.codingAgent.status])}
      {cell('REVIEWER', workforce.reviewer.name, REVIEWER_STATE_LABEL[workforce.reviewer.state])}
      {cell('MODE', mode.replace(/_/g, ' ').toUpperCase(), 'RELAY')}
      {cell('PHASE', PHASE_LABEL[phase], 'ACTIVE', true)}
    </div>
  );
}
