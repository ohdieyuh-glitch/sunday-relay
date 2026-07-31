import { REVIEWER_STATE_LABEL } from './projections';
import { RelayAgentOperatingInspector } from './RelayAgentOperatingInspector';
import type { RelayAgentOperatingProjection, RelayAgentRole } from '../../mission';
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
  operating,
}: {
  workforce: WorkforceAssignment;
  mode: RelayWorkspaceMode;
  phase: ProjectPhase;
  /**
   * The four canonical operating components per agent role. Optional so a
   * surface that has not yet resolved them renders exactly as before rather
   * than showing an empty inspector — a missing profile is not a blank one.
   */
  operating?: readonly RelayAgentOperatingProjection[];
}) {
  const profileFor = (role: RelayAgentRole) => operating?.find((p) => p.role === role);

  const cell = (
    key: string,
    name: string,
    status: string,
    options: { phaseCell?: boolean; role?: RelayAgentRole } = {},
  ) => {
    const projection = options.role === undefined ? undefined : profileFor(options.role);
    return (
      <div className={`rpw-strip-cell${options.phaseCell ? ' rpw-strip-cell--phase' : ''}`}>
        <span className="rpw-key">{key}</span>
        <span className="rpw-strip-name">
          <span className="rpw-strip-square" aria-hidden="true">
            ■
          </span>{' '}
          {name}
        </span>
        <span className="rpw-strip-status">{status}</span>
        {projection !== undefined && <RelayAgentOperatingInspector projection={projection} />}
      </div>
    );
  };

  return (
    <div className="rpw-strip" role="group" aria-label="Project workforce and mode">
      {cell('PROMPT ARCHITECT', workforce.promptArchitect.name, ARCHITECT_LABEL[workforce.promptArchitect.status], { role: 'prompt_architect' })}
      {cell('CODING AGENT', workforce.codingAgent.name, CODING_LABEL[workforce.codingAgent.status], { role: 'coding_agent' })}
      {cell('REVIEWER', workforce.reviewer.name, REVIEWER_STATE_LABEL[workforce.reviewer.state], { role: 'reviewer' })}
      {cell('MODE', mode.replace(/_/g, ' ').toUpperCase(), 'RELAY')}
      {cell('PHASE', PHASE_LABEL[phase], 'ACTIVE', { phaseCell: true })}
    </div>
  );
}
