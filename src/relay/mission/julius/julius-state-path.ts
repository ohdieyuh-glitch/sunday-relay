/**
 * WALKING THE MISSION TRANSITION TABLE, IN ONE PLACE.
 *
 * Two runtimes need to move a run to a state the table does not reach in one
 * step. The run loop observes a run after several things have already happened
 * to it — a single-task run is READY when observed and VERIFYING when
 * computed, and `READY → VERIFYING` is not a transition because a run reaches
 * VERIFYING by EXECUTING first. The lifecycle runtime has the same problem
 * from the other direction: a gated operation must move a READY run to
 * BLOCKED, and `READY → BLOCKED` is not a transition either.
 *
 * Both need the same answer and neither may keep its own copy of the table.
 * These helpers PROBE `transitionMission` rather than reading a table, so the
 * domain's rule stays the only rule; a table copied here would be a second
 * source of truth for the thing the whole state machine rests on.
 */

import { JULIUS_MISSION_STATES, transitionMission, type JuliusMissionState } from './julius-runtime';

/** Whether a move is one `transitionMission` will accept, without taking it. */
export function transitionIsLegal(from: JuliusMissionState, to: JuliusMissionState): boolean {
  if (from === to) return false;
  try {
    transitionMission({
      transitionId: 'probe', missionId: 'probe', current: from, to,
      reasonCode: 'probe', safeSummary: 'probe', evidenceIds: [], occurredAt: '1970-01-01T00:00:00.000Z',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * THE SHORTEST LEGAL PATH FROM ONE STATE TO ANOTHER, OR NOTHING.
 *
 * Breadth-first over the legality check, so the shortest real path wins and no
 * path is invented. Bounded by the state count, which is why there is no
 * visited-set subtlety and no risk of a long walk. An empty result means the
 * target is already true or genuinely unreachable — the caller decides which
 * of those matters, and neither is an error.
 *
 * Every intermediate state on the path really did happen: a run that reached
 * VERIFYING through EXECUTING did execute, so recording the step is more
 * truthful than jumping it, not less.
 */
export function planRunStatePath(
  from: JuliusMissionState,
  to: JuliusMissionState,
): readonly JuliusMissionState[] {
  if (from === to) return [];
  const queue: JuliusMissionState[][] = [[from]];
  const seen = new Set<JuliusMissionState>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const tail = path[path.length - 1]!;
    for (const next of JULIUS_MISSION_STATES) {
      if (seen.has(next) || !transitionIsLegal(tail, next)) continue;
      if (next === to) return [...path.slice(1), next];
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return [];
}
