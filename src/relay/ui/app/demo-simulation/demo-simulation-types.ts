export type RelayDemoRole =
  | 'founder'
  | 'prompt_architect'
  | 'alcatraz'
  | 'coding_agent'
  | 'relay_verifier'
  | 'reviewer'
  | 'repair'
  | 'complete';

export type RelayDemoStatus = 'idle' | 'playing' | 'paused' | 'complete';

export interface RelayDemoEvent {
  id: string;
  sequence: number;
  category: string;
  role: RelayDemoRole;
  title: string;
  summary: string;
  truthClass: 'simulated_demo';
  simulatedAtMs: number;
  visualState: string;
  relatedFile?: string;
  command?: string;
  result?: string;
}

export interface RelayDemoStep {
  id: string;
  label: string;
  activeRole: RelayDemoRole;
  durationMs: number;
  headline: string;
  summary: string;
  details: readonly string[];
  event: RelayDemoEvent;
}

export interface RelayDemoSimulationState {
  mode: 'demo_simulation';
  scenarioId: string;
  instanceId: string;
  active: boolean;
  status: RelayDemoStatus;
  currentStepIndex: number;
  activeRole: RelayDemoRole | null;
  startedAt?: number;
  pausedAt?: number;
  elapsedBeforePauseMs: number;
  speed: 1 | 2;
  events: RelayDemoEvent[];
}

export type RelayDemoAction =
  | { type: 'play'; now: number; instanceId: string }
  | { type: 'advance' }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'restart'; now: number }
  | { type: 'exit' }
  | { type: 'speed'; speed: 1 | 2 };
