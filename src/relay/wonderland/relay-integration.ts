import type { BridgeEventInput, LiveMissionUpdate, MissionPhase } from '../../../relay-bridge/types';
import type { WonderlandEventType } from './types';
import { WonderlandService } from './service';

const phaseEvent: Partial<Record<MissionPhase, WonderlandEventType>> = {
  prompt_architect_working: 'agent.planning', coding_agent_starting: 'agent.implementing', coding: 'agent.implementing',
  reviewer_starting: 'agent.reviewing', reviewer_working: 'agent.reviewing', relay_verifying: 'agent.verifying',
  verified_complete: 'mission.completed', verification_failed: 'verification.failed', budget_exhausted: 'agent.error',
};

/** Maps persisted, real Relay Mission updates—not timers—into Wonderland v1. */
export class RelayWonderlandPublisher {
  private readonly phases = new Map<string, MissionPhase>(); private readonly eventSequences = new Map<string, number>();
  constructor(private readonly wonderland: WonderlandService) {}
  publishMission(projectId: string, missionId: string, update: LiveMissionUpdate, playerId?: string): void {
    const phase = update.phase ?? 'ready';
    const previous = this.phases.get(missionId);
    if (previous !== phase) {
      this.phases.set(missionId, phase);
      const type = phaseEvent[phase] ?? (previous === undefined ? 'mission.started' : 'mission.stage_changed');
      this.wonderland.ingestRelayEvent(`relay:${missionId}:phase:${phase}`, { projectId, missionId, playerId, eventType: type, payload: { phase, state: update.state } });
    }
    const cursor = this.eventSequences.get(missionId) ?? 0;
    for (const event of update.events.filter((item) => item.sequence > cursor)) this.publishTerminal(projectId, missionId, event, playerId);
    this.eventSequences.set(missionId, Math.max(cursor, ...update.events.map((event) => event.sequence), 0));
  }
  private publishTerminal(projectId: string, missionId: string, event: LiveMissionUpdate['events'][number], playerId?: string): void {
    this.wonderland.ingestRelayEvent(`relay:${missionId}:terminal:${event.sequence}`, { projectId, missionId, playerId, eventType: 'battle.telemetry', visibility: 'OWNER', payload: { kind: terminalKind(event), role: event.role, truth: event.truth, headline: event.headline, detail: event.detail, artifactRef: event.artifactRef, executionRef: event.executionRef } });
  }
}

function terminalKind(event: BridgeEventInput): string {
  if (event.category === 'verification') return event.done ? 'test.completed' : 'test.started';
  if (event.category === 'reviewer') return 'review.started';
  if (event.category === 'repair') return 'repair.started';
  if (event.artifactRef) return 'artifact.generated';
  return `${event.category}.activity`;
}
