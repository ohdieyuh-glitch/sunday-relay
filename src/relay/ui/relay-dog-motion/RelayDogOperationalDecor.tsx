/**
 * SUNDAY RELAY — Relay Dog OPERATIONAL DECOR.
 *
 * The scenery that makes the operational states readable without the label:
 * drifting Z marks while a review runs, and a disturbed patch and flying dirt
 * while a repair digs. Implementing draws no scenery — the dog's own typing
 * pose carries the state.
 *
 * Rules this component keeps:
 *
 *   - It is DECORATION. Every node is `aria-hidden`; the accessible meaning
 *     lives on the dog figure's own label and on the motion boundary's status
 *     text. A screen reader hears the state once, in words.
 *   - It NEVER decides or reports state. It receives an activity and draws.
 *     Nothing here marks a review approved, a verification passed, a repair
 *     successful, coding complete or a release eligible.
 *   - There is ONE official Relay Dog. This adds scenery AROUND the existing
 *     sprite; it draws no dog, and it never replaces the mascot per state.
 *   - Motion is CSS only — transform/opacity keyframes on a fixed, small number
 *     of nodes. No timers, no React state, no re-render per frame, no canvas.
 *     Under reduced motion the same nodes are held still, so the scene is still
 *     legible.
 */

import type { RelayDogActivityKind } from './dog-behavior';

/** Fixed particle counts — restrained on purpose, and the same every render. */
const SLEEP_MARKS = 3;
const DIRT_CLODS = 5;

export interface RelayDogOperationalDecorProps {
  activity: RelayDogActivityKind;
  /** Holds every loop still and shows one static composition. */
  reducedMotion?: boolean;
}

/** REVIEWING — drifting Z marks and a resting review page. */
function ReviewDecor({ reducedMotion }: { reducedMotion: boolean }) {
  // Under reduced motion exactly ONE mark is drawn, held still.
  const marks = reducedMotion ? 1 : SLEEP_MARKS;
  return (
    <div className="rdo rdo--sleep" aria-hidden="true">
      <span className="rdo-page" />
      {Array.from({ length: marks }, (_, i) => (
        <span key={i} className={`rdo-z rdo-z--${i + 1}`}>
          z
        </span>
      ))}
    </div>
  );
}

/** REPAIRING — a shallow hole, a dirt mound and a few clods thrown back. */
function RepairDecor({ reducedMotion }: { reducedMotion: boolean }) {
  const clods = reducedMotion ? 0 : DIRT_CLODS;
  return (
    <div className="rdo rdo--dig" aria-hidden="true">
      <span className="rdo-hole" />
      <span className="rdo-mound" />
      {Array.from({ length: clods }, (_, i) => (
        <span key={i} className={`rdo-clod rdo-clod--${i + 1}`} />
      ))}
    </div>
  );
}

export function RelayDogOperationalDecor({
  activity,
  reducedMotion = false,
}: RelayDogOperationalDecorProps) {
  if (activity === 'reviewing') return <ReviewDecor reducedMotion={reducedMotion} />;
  if (activity === 'repairing') return <RepairDecor reducedMotion={reducedMotion} />;
  // Every other activity, IMPLEMENTING included, keeps exactly the scenery it
  // had before: none.
  return null;
}

/**
 * The accessible sentence for an operational activity. The dog figure already
 * announces the canonical uppercase label; this is the plain-language
 * description the boundary exposes for the three animated states.
 *
 * Each sentence describes what the DOG is doing — never an outcome. "under
 * review" is not "reviewed"; "digging into" is not "repaired"; "writing" is not
 * "complete".
 */
export const OPERATIONAL_ACTIVITY_DESCRIPTION: Partial<Record<RelayDogActivityKind, string>> = {
  reviewing: 'Relay Dog is snoozing while the mission is under review.',
  repairing: 'Relay Dog is digging into the project to repair an issue.',
  implementing: 'Relay Dog is writing and implementing code.',
};

export function operationalActivityDescription(activity: RelayDogActivityKind): string | null {
  return OPERATIONAL_ACTIVITY_DESCRIPTION[activity] ?? null;
}
