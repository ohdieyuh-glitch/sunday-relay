/**
 * MISSION -> PROJECT PROMOTION.
 *
 * A Mission Contract stays LIGHTWEIGHT. Most tasks are one task: a user asks for
 * something, it happens, they move on, and forcing a project around that would
 * make the cheap thing expensive. But some work grows — it becomes file-heavy,
 * it stacks mission on mission, it produces creations the user will come back
 * to — and at that point the mission is the wrong container.
 *
 * This module answers one question: SHOULD WONDERLAND SUGGEST A PROJECT? It
 * suggests; it never promotes. The decision is the user's, and the shape of this
 * module enforces that — nothing here mutates anything, and the result is a
 * suggestion object a surface may render or ignore.
 *
 * WHY THRESHOLDS AND NOT A MODEL. The signals are counts a caller already has,
 * compared against named constants. A user should be able to be told exactly why
 * Wonderland asked, and "three missions have stacked on this work" is an answer;
 * a score is not.
 */

/** The counts that make work look like a project rather than a task. */
export interface PromotionSignals {
  /** Missions that have run against this same body of work. */
  readonly stackedMissionCount: number;
  /** Files the work has produced or touched. */
  readonly fileCount: number;
  /** Creations produced. Any creation at all is durable output. */
  readonly creationCount: number;
  /** True when the user has already returned to this work in a later session. */
  readonly resumedAfterLeaving: boolean;
  /** Already inside a project — then there is nothing to suggest. */
  readonly alreadyInProject: boolean;
}

export const PROMOTION_STACKED_MISSIONS = 3;
export const PROMOTION_FILE_COUNT = 8;
export const PROMOTION_CREATION_COUNT = 2;

/**
 * Why Wonderland asked. A closed vocabulary, so a surface can render each reason
 * in the user's language rather than echoing a sentence the domain wrote.
 */
export const PROMOTION_REASONS = [
  'missions_stacked',
  'file_heavy',
  'creations_produced',
  'work_resumed',
] as const;
export type PromotionReason = (typeof PROMOTION_REASONS)[number];

export type PromotionSuggestion =
  | { readonly suggest: false; readonly because: 'already_in_project' | 'still_a_single_task' }
  | {
    readonly suggest: true;
    /** Every reason that fired, so the surface may show the strongest. */
    readonly reasons: readonly PromotionReason[];
    /** What the surface offers. Never performed automatically. */
    readonly action: 'create_or_move_into_project';
  };

/**
 * Decide whether to SUGGEST a project. Pure, total, and never a mutation.
 *
 * Any single signal is enough. These are not scored or weighted: a user who has
 * produced two creations is doing project-shaped work whether or not they also
 * have eight files, and requiring a combination would mean saying nothing in the
 * cases where the suggestion is most obviously right.
 */
export function suggestProjectPromotion(signals: PromotionSignals): PromotionSuggestion {
  // Already promoted. Asking again would be noise, and noise is how a prompt
  // gets trained away.
  if (signals.alreadyInProject) {
    return { suggest: false, because: 'already_in_project' };
  }

  const reasons: PromotionReason[] = [];
  if (signals.stackedMissionCount >= PROMOTION_STACKED_MISSIONS) reasons.push('missions_stacked');
  if (signals.fileCount >= PROMOTION_FILE_COUNT) reasons.push('file_heavy');
  if (signals.creationCount >= PROMOTION_CREATION_COUNT) reasons.push('creations_produced');
  // Returning to work after leaving is the strongest signal there is: it is the
  // user demonstrating the exact behaviour a project exists to serve.
  if (signals.resumedAfterLeaving) reasons.push('work_resumed');

  return reasons.length === 0
    ? { suggest: false, because: 'still_a_single_task' }
    : { suggest: true, reasons, action: 'create_or_move_into_project' };
}

/**
 * The hook a mission surface calls. Named so its contract is obvious at the call
 * site: this returns something to SHOW, and the caller does the showing.
 */
export interface ProjectPromotionHook {
  (signals: PromotionSignals): PromotionSuggestion;
}

export const projectPromotionHook: ProjectPromotionHook = suggestProjectPromotion;
