import type { Provenance } from '../protocol/enums';
import type { RelayMode } from './modes';

/**
 * Relay Dog activity engine (Prompt 8.2) — PURE, deterministic. The dog
 * reflects ACTUAL workflow state derived from normalized Relay events + run
 * state — never decorative random motion, never token-stream speed, never an
 * adapter- or UI-set value. Speed does not imply correctness. Mode changes
 * visual range and interruption frequency, never speed.
 */

export const DOG_STATES = [
  'asleep', 'idle', 'wandering', 'waiting_for_user', 'walking', 'trotting',
  'running', 'sprinting', 'carrying_handoff', 'verifying', 'reviewing',
  'repairing', 'blocked', 'stopped_safely', 'complete', 'failed',
] as const;
export type DogState = (typeof DOG_STATES)[number];

export interface RelayDogActivity {
  state: DogState;
  activityLevel: number;        // 0..100 (bounded)
  synchronizationLevel: number; // 0..100 (coordination health)
  activeRoles: string[];
  mode: RelayMode;
  statusLabel: string;
  reason: string;
  lastMeaningfulSequence: number;
  calculatedAt: string;
  reducedMotion: boolean;
  provenance: Provenance;
}

export interface DogEventInput {
  sequence: number;
  kind: string;
  source: string;
  provenance: Provenance;
}

export interface DogComputeInput {
  events: readonly DogEventInput[];
  runStatus: string;             // created|active|checkpoint_required|completed|failed|cancelled
  phase: string;                 // blueprint|handoff|implementation|verification|review|repair|...
  mode: RelayMode;
  manualTaskActive: boolean;
  checkpointActive: boolean;
  missionVerdict: string;        // verified_complete | ... | none
  reducedMotion: boolean;
  now: string;
  provenance: Provenance;
  /** Bounded recent-event window size (default 8). */
  windowSize?: number;
}

const LABEL: Partial<Record<DogState, string>> = {
  sprinting: 'SYNC HIGH', running: 'ACTIVE WORK', trotting: 'ROUTINE WORK',
  walking: 'LIGHT WORK', carrying_handoff: 'HANDOFF', waiting_for_user: 'WAITING FOR YOU',
  verifying: 'VERIFYING', reviewing: 'REVIEWING', repairing: 'REPAIRING',
  wandering: 'IDLE', stopped_safely: 'STOPPED SAFELY', complete: 'COMPLETE', failed: 'FAILED',
  idle: 'IDLE', asleep: 'ASLEEP', blocked: 'BLOCKED',
};

const MEANINGFUL = (kind: string): boolean =>
  !kind.startsWith('ledger.') && !kind.startsWith('file_claim.') && !kind.startsWith('usage.') && kind !== 'run.phase_changed';

const ROLE_OF = (source: string): string | null =>
  source === 'architect' ? 'architect'
    : source === 'coding-agent' ? 'coding-agent'
      : source === 'reviewer' ? 'reviewer'
        : source === 'verification' ? 'verification' : null;

export function computeDogActivity(input: DogComputeInput): RelayDogActivity {
  const windowSize = input.windowSize ?? 8;
  const window = input.events.slice(-windowSize);
  const meaningful = window.filter((e) => MEANINGFUL(e.kind));
  const lastMeaningful = [...input.events].reverse().find((e) => MEANINGFUL(e.kind));
  const lastMeaningfulSequence = lastMeaningful?.sequence ?? 0;

  const roles = [...new Set(window.map((e) => ROLE_OF(e.source)).filter((r): r is string => r !== null))];
  const handoffs = input.events.filter((e) => e.kind === 'handoff.dispatched' || e.kind === 'handoff.created').length;
  const recentHandoff = window.some((e) => e.kind.startsWith('handoff.'));
  const activityLevel = Math.min(100, meaningful.length * 14);
  const architectAndCoding = roles.includes('architect') && roles.includes('coding-agent');
  const synchronizationLevel = Math.min(100, handoffs * 25 + roles.length * 15 + (architectAndCoding ? 20 : 0));

  const make = (state: DogState, reason: string): RelayDogActivity => ({
    state, activityLevel, synchronizationLevel, activeRoles: roles, mode: input.mode,
    statusLabel: LABEL[state] ?? state.toUpperCase().replace(/_/g, ' '),
    reason, lastMeaningfulSequence, calculatedAt: input.now,
    reducedMotion: input.reducedMotion, provenance: input.provenance,
  });

  /* terminal + boundary states take precedence (never decorative) */
  if (input.missionVerdict === 'verified_complete' || input.runStatus === 'completed') {
    return make('complete', 'Mission reached verified completion.');
  }
  if (input.runStatus === 'failed') return make('failed', 'Terminal failure.');
  if (input.runStatus === 'cancelled') return make('stopped_safely', 'Run cancelled — stopped safely.');
  if (input.manualTaskActive || input.checkpointActive) return make('waiting_for_user', 'Relay needs you.');
  if (input.runStatus === 'checkpoint_required') return make('stopped_safely', 'A policy boundary stopped execution.');

  /* active-phase states */
  if (input.phase === 'repair') return make('repairing', 'An approved repair is executing.');
  if (input.phase === 'review' || input.phase === 'final_review') return make('reviewing', 'The independent Reviewer is examining the work.');
  if (input.phase === 'verification' || input.phase === 'final_verification') return make('verifying', 'Relay is running verification.');
  if (recentHandoff) return make('carrying_handoff', 'Responsibility is moving between roles.');

  /* not started / idle */
  if (input.runStatus === 'created' || input.events.length === 0) return make('wandering', 'Run has not started.');
  if (meaningful.length === 0) return make('idle', 'No recent meaningful activity.');

  /* speed reflects sustained coordination + activity, never token stream */
  if (architectAndCoding && activityLevel >= 70 && synchronizationLevel >= 60) {
    return make('sprinting', 'Architect and Coding Agent are coordinating with sustained, healthy cadence.');
  }
  if (activityLevel >= 55) return make('running', 'Meaningful active work with steady events.');
  if (activityLevel >= 30) return make('trotting', 'Routine implementation activity.');
  return make('walking', 'Light, low-frequency work.');
}

/** Static ASCII frames for the terminal dog (bounded, motion-optional). */
export const DOG_FRAME: Record<DogState, string[]> = {
  asleep: [' (-.-) z', ' /|_|\\'],
  idle: [' (o.o)', ' /|_|\\'],
  wandering: [' (o.o)~', ' /|_|\\'],
  waiting_for_user: [' (O.O)!', ' /|_|\\'],
  walking: [' (o.o)>', ' /|_|\\'],
  trotting: [' (o.o)>>', ' /|_|\\'],
  running: [' (o.o)>>>', ' /|_|\\'],
  sprinting: [' (o.o)>>>>', ' /|_|\\'],
  carrying_handoff: [' (o.o)=[]', ' /|_|\\'],
  verifying: [' (o.o)?', ' /|_|\\'],
  reviewing: [' (o.o)??', ' /|_|\\'],
  repairing: [' (o.o)+', ' /|_|\\'],
  blocked: [' (x.x)', ' /|_|\\'],
  stopped_safely: [' (o.o).', ' /|_|\\'],
  complete: [' (^.^)*', ' /|_|\\'],
  failed: [' (x.x)!', ' /|_|\\'],
};

export function renderDogFrames(activity: RelayDogActivity): string[] {
  const frames = DOG_FRAME[activity.state] ?? DOG_FRAME.idle;
  return [...frames, ` RELAY DOG — ${activity.statusLabel}`];
}
