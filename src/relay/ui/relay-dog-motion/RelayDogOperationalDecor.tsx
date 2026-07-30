/**
 * SUNDAY RELAY — Relay Dog OPERATIONAL DECOR.
 *
 * The scenery that makes the operational states readable without the label:
 * drifting Z marks and a settled rest patch while a review runs, a disturbed
 * patch and flying dirt while a repair digs, a newspaper riding the dog's back
 * while it researches, and the sweep marks of a tail going back and forth while
 * verification runs. Implementing draws no scenery — the dog's own tippy-toe
 * stance carries the state.
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
/** One sweep mark per side: the tail's travel, left and right. */
const TAIL_SWEEPS = 2;

export interface RelayDogOperationalDecorProps {
  activity: RelayDogActivityKind;
  /** Holds every loop still and shows one static composition. */
  reducedMotion?: boolean;
}

/**
 * REVIEWING — the dog is lying down asleep: a rest patch on the ground under
 * the settled body, a resting review page beside it, and drifting Z marks.
 */
function ReviewDecor({ reducedMotion }: { reducedMotion: boolean }) {
  // Under reduced motion exactly ONE mark is drawn, held still.
  const marks = reducedMotion ? 1 : SLEEP_MARKS;
  return (
    <div className="rdo rdo--sleep" aria-hidden="true">
      {/* The ground the dog has settled onto — static in both modes, because
          it is what makes the lying-down read survive with no motion at all. */}
      <span className="rdo-rest" />
      <span className="rdo-page" />
      {Array.from({ length: marks }, (_, i) => (
        <span key={i} className={`rdo-z rdo-z--${i + 1}`}>
          z
        </span>
      ))}
    </div>
  );
}

/**
 * RESEARCHING — a folded newspaper riding on the dog's back while it reads up.
 *
 * Deliberately NOT the handoff: `handoff` is a delivery and draws the carried
 * block in the mouth, in gold, in the sprite itself. This is newsprint grey,
 * ruled with print lines, angled across the back, and the dog stays put.
 */
function ResearchDecor({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className={`rdo rdo--news${reducedMotion ? ' rdo--held' : ''}`} aria-hidden="true">
      <span className="rdo-news" />
    </div>
  );
}

/**
 * VERIFYING — the dog's tail going back and forth. The tail is part of the
 * artwork, so the sweep it travels through is drawn here: one mark on each side
 * of it, alternating, in time with the sprite's own swing.
 */
function VerifyDecor({ reducedMotion }: { reducedMotion: boolean }) {
  // Under reduced motion ONE sweep is held, so the tail still reads as
  // mid-travel rather than as a dog standing still.
  const sweeps = reducedMotion ? 1 : TAIL_SWEEPS;
  return (
    <div className="rdo rdo--wag" aria-hidden="true">
      {Array.from({ length: sweeps }, (_, i) => (
        <span key={i} className={`rdo-wag rdo-wag--${i + 1}`} />
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
  if (activity === 'researching') return <ResearchDecor reducedMotion={reducedMotion} />;
  if (activity === 'verifying') return <VerifyDecor reducedMotion={reducedMotion} />;
  // Every other activity, IMPLEMENTING included, keeps exactly the scenery it
  // had before: none. The tippy-toe stance is the whole implementing state.
  return null;
}

/**
 * The accessible sentence for an operational activity. The dog figure already
 * announces the canonical uppercase label; this is the plain-language
 * description the boundary exposes for the five animated states.
 *
 * Each sentence describes what the DOG is doing — never an outcome. "under
 * review" is not "reviewed"; "digging into" is not "repaired"; "implementing"
 * is not "complete"; "verification runs" is not "verified".
 */
export const OPERATIONAL_ACTIVITY_DESCRIPTION: Partial<Record<RelayDogActivityKind, string>> = {
  reviewing: 'Relay Dog is lying down asleep while the mission is under review.',
  repairing: 'Relay Dog is digging into the project to repair an issue.',
  implementing: 'Relay Dog is up on its toes, paws raised, implementing the work.',
  researching: 'Relay Dog is reading up on the mission with a newspaper on its back.',
  verifying: 'Relay Dog is waiting with its tail wagging while verification runs.',
};

export function operationalActivityDescription(activity: RelayDogActivityKind): string | null {
  return OPERATIONAL_ACTIVITY_DESCRIPTION[activity] ?? null;
}
