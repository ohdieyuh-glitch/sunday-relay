import { REVIEWER_STATE_LABEL } from './projections';
import type {
  ArchitectStatus,
  CodingAgentStatus,
  ProjectPhase,
  RelayWorkspaceMode,
  WorkforceAssignment,
} from './contracts';

/**
 * Project command strip — Architect / Coding Agent / Reviewer / Mode /
 * Phase, expanding the screenshot's Architect · Coding Agent · Mode row
 * without crowding it. Horizontal on desktop; compact scrollable system
 * strip on mobile.
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
  plan: 'PLANNING',
  research: 'RESEARCH',
  build: 'IMPLEMENTATION',
  verify: 'VERIFICATION',
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
  return (
    <div className="rpw-strip" role="group" aria-label="Project workforce and mode">
      <div className="rpw-strip-cell">
        <span className="rpw-key">PROMPT ARCHITECT</span>
        <span className="rpw-strip-name">{workforce.promptArchitect.name}</span>
        <span className="rpw-strip-status">{ARCHITECT_LABEL[workforce.promptArchitect.status]}</span>
      </div>
      <div className="rpw-strip-cell">
        <span className="rpw-key">CODING AGENT</span>
        <span className="rpw-strip-name">{workforce.codingAgent.name}</span>
        <span className="rpw-strip-status">{CODING_LABEL[workforce.codingAgent.status]}</span>
      </div>
      <div className="rpw-strip-cell">
        <span className="rpw-key">REVIEWER</span>
        <span className="rpw-strip-name">{workforce.reviewer.name}</span>
        <span className="rpw-strip-status">{REVIEWER_STATE_LABEL[workforce.reviewer.state]}</span>
      </div>
      <div className="rpw-strip-cell">
        <span className="rpw-key">MODE</span>
        <span className="rpw-strip-name">{mode.toUpperCase()}</span>
        <span className="rpw-strip-status">RELAY</span>
      </div>
      <div className="rpw-strip-cell rpw-strip-cell--phase">
        <span className="rpw-key">PROJECT PHASE</span>
        <span className="rpw-strip-name">{PHASE_LABEL[phase]}</span>
        <span className="rpw-strip-status">ACTIVE</span>
      </div>
    </div>
  );
}
