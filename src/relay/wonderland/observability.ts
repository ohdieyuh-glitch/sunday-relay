import type { WonderlandState } from './types';

/** Low-cardinality operational measurements derivable from the durable event log. */
export interface WonderlandDiagnostics {
  latestSequence: number; activeBattles: number; failedBattles: number; failedMissions: number;
  verificationFailures: number; subagentFailures: number; permissionDenials: number;
  duplicateCommandsRejected: number; rewardGrants: number; avatarProgressions: number;
  swarmCount: number; swarmTokenBudget: number;
}

export function projectWonderlandDiagnostics(state: WonderlandState): WonderlandDiagnostics {
  const count = (type: string) => state.events.filter((event) => event.eventType === type).length;
  return {
    latestSequence: state.sequence,
    activeBattles: Object.values(state.battles).filter((battle) => battle.status === 'RUNNING').length,
    failedBattles: Object.values(state.battles).filter((battle) => battle.status === 'FAILED').length,
    failedMissions: count('mission.failed'), verificationFailures: count('verification.failed'),
    subagentFailures: count('subagent.failed'),
    permissionDenials: 0, // Denied commands mutate nothing; the host records thrown domain errors in its request logger.
    duplicateCommandsRejected: 0, // Command-result cardinality is available to the host; duplicates deliberately emit nothing.
    rewardGrants: state.rewards.length,
    avatarProgressions: count('project_avatar.progress') + count('project_avatar.stage_changed'),
    swarmCount: Object.keys(state.swarms).length,
    swarmTokenBudget: Object.values(state.swarms).reduce((sum, swarm) => sum + swarm.tokenBudget, 0),
  };
}
