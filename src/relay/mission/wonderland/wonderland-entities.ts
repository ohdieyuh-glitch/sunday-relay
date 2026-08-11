/**
 * SUNDAY RELAY — WONDERLAND: PROJECT → WORLD ENTITY.
 *
 * A project becomes a thing in the world. WHAT it becomes is chosen by its
 * CATEGORY — a 3D shooter is a war creature, a database platform is an enormous
 * data vessel, an AI system is an intelligent mythical organism, a devtool is a
 * clockwork entity, a cloud system is a floating carrier-continent. Repositories
 * are not all skyscrapers, and the way they become skyscrapers anyway is a
 * silent fallback to one shape, so `unknown` maps to a FOGGED form and nothing
 * else does.
 *
 * HOW IT GROWS, and the one rule that matters:
 *
 *   EVOLUTION IS DRIVEN BY VERIFIED MEANINGFUL DEVELOPMENT, NEVER BY VOLUME.
 *
 * There is no commit count in this module's input, its output, or its
 * arithmetic. That is structural rather than policed: a field that existed would
 * eventually be read by something that needed a number to go up. What moves a
 * stage is a mission that reached `verified_complete` WITH an execution
 * attestation, an approved independent review, and at least one evidence
 * reference — the same four facts Relay's own verdict engine requires before it
 * will say a mission is done.
 *
 * PURE. No clock; qualification is a property of the evidence, not of when this
 * function ran.
 */

import type { MissionVerdict } from '../contracts';
import {
  WONDERLAND_PROJECT_CATEGORIES,
  type WonderlandEntityForm,
  type WonderlandProjectCategory,
  type WonderlandProjectEntity,
} from './wonderland-contracts';

/* ------------------------------------------------------- category → form */

/**
 * The form table. TOTAL over `WonderlandProjectCategory`, so adding a category
 * without deciding what it looks like fails `tsc` rather than quietly inheriting
 * a neighbour's silhouette.
 */
export const WONDERLAND_CATEGORY_FORM: Readonly<
  Record<WonderlandProjectCategory, WonderlandEntityForm>
> = Object.freeze({
  unknown: 'fogged_unknown',
  game_3d_shooter: 'war_creature',
  database_platform: 'data_vessel',
  ai_system: 'mythic_organism',
  devtool: 'clockwork_entity',
  cloud_system: 'sky_carrier',
  web_application: 'glass_pavilion',
  mobile_application: 'wanderer_caravan',
  research_codebase: 'library_landmark',
});

/**
 * The form for a category Relay established, or the fogged form when it has not.
 *
 * `null` and `'unknown'` deliberately reach the same form by different routes,
 * and the routes matter to the caller: a project with no category record at all
 * is `observed: false` with `stage: null`, while a project Relay looked at and
 * could not categorise is observed with a real stage.
 */
export function wonderlandFormFor(
  category: WonderlandProjectCategory | null,
): WonderlandEntityForm {
  return category === null ? 'fogged_unknown' : WONDERLAND_CATEGORY_FORM[category];
}

/** Narrow an untrusted value to a category. Anything else is not one. */
export function isWonderlandProjectCategory(
  value: unknown,
): value is WonderlandProjectCategory {
  return (
    typeof value === 'string' &&
    (WONDERLAND_PROJECT_CATEGORIES as readonly string[]).includes(value)
  );
}

/* ------------------------------------------------------------- evolution */

/**
 * One mission offered as evolution evidence.
 *
 * All four facts are required, and none of them is a claim. `verdict` is Relay's
 * own; `attested` means an execution attestation exists; `reviewApproved` means
 * the required independent review approved the reviewed state; `evidenceIds`
 * must resolve to real evidence records. The implementer's own report is
 * deliberately not a field here — it is a claim, and `evaluateMissionVerdict`
 * already refuses to treat one as proof.
 */
export interface WonderlandMissionEvidence {
  readonly missionId: string;
  readonly verdict: MissionVerdict;
  readonly attested: boolean;
  readonly reviewApproved: boolean;
  readonly evidenceIds: readonly string[];
}

/**
 * Does this mission move the world?
 *
 * Exported so the test can drive it directly and so a surface can explain a
 * refusal, rather than users discovering the rule by watching nothing happen.
 */
export function evidenceQualifiesForEvolution(
  evidence: WonderlandMissionEvidence,
): boolean {
  return (
    evidence.verdict === 'verified_complete' &&
    evidence.attested &&
    evidence.reviewApproved &&
    evidence.evidenceIds.length > 0
  );
}

/**
 * How many qualifying missions each stage costs, cumulatively.
 *
 * Small and shallow on purpose: this is a foundation, and a deep ladder would be
 * a balance decision made before anything has been played. The thresholds are
 * cumulative COUNTS of qualifying missions and nothing else — no time decay, no
 * streaks, no volume.
 */
export const WONDERLAND_STAGE_THRESHOLDS: readonly number[] = [1, 3, 6, 10];

export interface WonderlandEvolutionInput {
  readonly projectId: string;
  /** Null when Relay has not established a category. */
  readonly category?: WonderlandProjectCategory | null;
  /**
   * True when Relay has a record of this project at all. False produces
   * `stage: null` — an unobserved project has no stage, and stage 0 is a real
   * measurement reserved for a project Relay watched that verified nothing.
   */
  readonly observed: boolean;
  readonly missionEvidence?: readonly WonderlandMissionEvidence[];
  /**
   * Activity Relay saw and did NOT verify: unverified claims, unattested runs,
   * reviews that did not approve. Reported so a surface can say the work exists,
   * and structurally unable to reach `stage`.
   */
  readonly unverifiedActivityCount?: number;
}

/**
 * Project one project into its world entity.
 *
 * The only arithmetic is `filter(qualifies).length`, and `unverifiedActivityCount`
 * appears nowhere in it. That is the test's target: any change that lets
 * unverified activity reach `stage` makes
 * `wonderland-entities.test.ts` fail on the 500-unverified case.
 */
export function projectWonderlandEntity(
  input: WonderlandEvolutionInput,
): WonderlandProjectEntity {
  const category = input.category ?? null;
  const evidence = input.missionEvidence ?? [];
  const qualifying = evidence.filter(evidenceQualifiesForEvolution);
  const unverifiedActivityCount = input.unverifiedActivityCount ?? 0;

  const stage = input.observed
    ? WONDERLAND_STAGE_THRESHOLDS.filter((threshold) => qualifying.length >= threshold).length
    : null;

  const nextThreshold = WONDERLAND_STAGE_THRESHOLDS.find(
    (threshold) => qualifying.length < threshold,
  );

  const nextStageRequirement = !input.observed
    ? 'Relay has no record of this project. The world shows it fogged until there is one.'
    : nextThreshold === undefined
      ? 'This entity has reached its final declared stage. Later stages are not built.'
      : `${nextThreshold - qualifying.length} more verified mission(s) — verified_complete, attested, independently approved, with evidence. Commits do not count.`;

  return {
    projectId: input.projectId,
    observed: input.observed,
    category,
    form: wonderlandFormFor(category),
    stage,
    evolutionEvidenceCount: qualifying.length,
    unverifiedActivityCount,
    nextStageRequirement,
  };
}
