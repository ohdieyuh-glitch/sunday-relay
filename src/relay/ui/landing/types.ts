export type RelaySetupMode = 'guided' | 'semi' | 'autonomous';

export type AgentChoice = 'sunday-architect' | 'claude-code' | 'codex';
export type ReviewerChoice = 'none' | 'codex-reviewer' | 'claude-reviewer';

export interface RelayProjectSetup {
  projectName: string;
  description: string;
  objective: string;
  scope: string;
  protectedAreas: string;
  projectSource: string;
  memorySources: string;
  evidenceRequirements: string;
  promptArchitect: AgentChoice;
  codingAgent: AgentChoice;
  reviewer: ReviewerChoice;
  mode: RelaySetupMode;
  maxRuntimeMinutes: number;
  maxSpendUsd: number;
  maxAgentCalls: number;
  maxReviews: number;
  maxRepairCycles: number;
  notifications: 'terminal' | 'milestones' | 'attention-only' | 'none';
}

export interface RelayLandingProps {
  initialSetup?: Partial<RelayProjectSetup>;
  onConnectProject?: () => void;
  onStart?: (setup: RelayProjectSetup) => void;
  onOpenTerminal?: () => void;
  onSetupChange?: (setup: RelayProjectSetup) => void;
}

export const defaultRelayProjectSetup: RelayProjectSetup = {
  projectName: '',
  description: '',
  objective: '',
  scope: '',
  protectedAreas: '',
  projectSource: '',
  memorySources: '',
  evidenceRequirements: 'Typecheck and relevant automated tests pass; provide a concise change summary.',
  promptArchitect: 'sunday-architect',
  codingAgent: 'claude-code',
  reviewer: 'codex-reviewer',
  mode: 'guided',
  maxRuntimeMinutes: 30,
  maxSpendUsd: 5,
  maxAgentCalls: 12,
  maxReviews: 2,
  maxRepairCycles: 2,
  notifications: 'attention-only',
};
