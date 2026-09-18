/**
 * PROJECT AVATARS — the living representation of a PROJECT inside Wonderland.
 *
 * FOUNDER DIRECTIVE (2026-09-17): "A Project Avatar is the physical living representation of a PROJECT inside
 * Wonderland. It is NOT: Julius, the Relay Dog, Jhinn, an LLM Companion, an NPC. It belongs to the project itself."
 *
 *   USER -> PROJECT -> PROJECT AVATAR
 *
 * AND IT GROWS. A new project's avatar begins SMALL and matures through MEDIUM to LARGE -- the form the founder's
 * reference sheets show. That is the whole point of it: a project you can look at and see how far it has come.
 *
 * WHAT THIS FILE IS FOR. The authority over which stage an avatar has reached does not belong to Unreal -- the founder
 * was explicit that progression must not live only in the client. So the record and the rules live here, in the same
 * typed domain as everything else Wonderland reads, and Unreal renders what it is told.
 *
 * WHAT IT DELIBERATELY DOES NOT DECIDE. Not which project signals count for how much: the founder said not to tie
 * stages to an arbitrary level number yet, so the threshold policy is a value that can be replaced when the real
 * signals exist (milestones, completed missions, verified accomplishments, sustained development). The STAGE
 * ARCHITECTURE is what is being fixed now, not the growth curve.
 */

/* ==================================================================== what it is */

/** The canonical skins. Two to begin with, both from the founder's own reference sheets. */
export const PROJECT_AVATAR_SKINS = ['TEN_TAILS', 'CHERUBIM'] as const;
export type ProjectAvatarSkin = (typeof PROJECT_AVATAR_SKINS)[number];

/** The canonical stages. Three, in order: a form is never skipped on the way up. */
export const PROJECT_AVATAR_STAGES = ['SMALL', 'MEDIUM', 'LARGE'] as const;
export type ProjectAvatarStage = (typeof PROJECT_AVATAR_STAGES)[number];

export function stageIndex(stage: ProjectAvatarStage): number {
  return PROJECT_AVATAR_STAGES.indexOf(stage);
}

export function nextStage(stage: ProjectAvatarStage): ProjectAvatarStage | null {
  const at = stageIndex(stage);
  return at >= 0 && at < PROJECT_AVATAR_STAGES.length - 1 ? PROJECT_AVATAR_STAGES[at + 1] : null;
}

/**
 * WHETHER THE AVATAR IS IN THE WORLD, which is a different question from what stage it has reached. A project whose
 * avatar is asleep has not lost its progress.
 */
export const SPAWN_STATES = ['NOT_SPAWNED', 'SUMMONING', 'PRESENT', 'RESTING', 'EVOLVING', 'DESPAWNING'] as const;
export type SpawnState = (typeof SPAWN_STATES)[number];

/**
 * WHAT THE BODY IS DOING. Driven by what the project and the avatar are actually doing -- never by a timer, the same
 * rule the companions follow.
 */
export const AVATAR_ACTIVITIES = [
  'IDLE',
  'FOLLOW',
  'PROJECT_ACTIVE',
  'PROJECT_PROGRESS',
  'CELEBRATION',
  'REST',
  'SUMMON',
  'DESPAWN',
  'EVOLVE',
] as const;
export type AvatarActivity = (typeof AVATAR_ACTIVITIES)[number];

/* ==================================================================== the record */

/**
 * ONE PROJECT'S AVATAR. Persistent, because it belongs to the project: leave Wonderland and come back and the project
 * still knows its skin, its stage and how far it has come.
 *
 * CurrentForm and UnlockedForm are deliberately separate. Reaching a stage is progress; WEARING it is an event -- the
 * founder asked that SMALL -> MEDIUM and MEDIUM -> LARGE feel like something rather than a mesh swapping in front of
 * the player. So progress unlocks a form, and an evolution moment puts it on.
 */
export interface ProjectAvatar {
  readonly projectAvatarId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly skin: ProjectAvatarSkin;
  /** The form it is wearing now. */
  readonly currentForm: ProjectAvatarStage;
  /** The furthest form its progress has earned. Never below currentForm. */
  readonly unlockedForm: ProjectAvatarStage;
  /** 0..1 toward the next stage, or 1 at LARGE. Progress, not a level: a number to fill a ring with. */
  readonly progress: number;
  readonly spawnState: SpawnState;
  readonly activity: AvatarActivity;
  /** A name the owner gave it, if any. Never required: the project's name is enough. */
  readonly nickname: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Every stage this avatar has worn, with when -- a project's own history, which is worth keeping. */
  readonly history: readonly { readonly stage: ProjectAvatarStage; readonly at: string; readonly why: string }[];
}

/* ==================================================================== how it grows */

/**
 * THE SIGNALS THAT MIGHT MATTER, named so the shape exists before the policy does. The founder listed project
 * milestones, completed missions, creation progress, verified accomplishments and sustained development; each is a
 * thing the rest of the system already knows about, and none of them is wired to a number here yet.
 */
export const GROWTH_SIGNALS = [
  'MILESTONE_REACHED',
  'MISSION_COMPLETED',
  'CREATION_PROGRESS',
  'VERIFIED_ACCOMPLISHMENT',
  'SUSTAINED_DEVELOPMENT',
] as const;
export type GrowthSignal = (typeof GROWTH_SIGNALS)[number];

export interface GrowthEvent {
  readonly signal: GrowthSignal;
  readonly at: string;
  /** What in the project caused it, for provenance. Never a number pulled out of the air. */
  readonly evidenceId: string | null;
  readonly detail: string;
}

/**
 * THE POLICY, WHICH IS A VALUE. How much each signal is worth and how much is needed for the next stage. Replaceable
 * in one place when the real project signals arrive, which is the founder's instruction: build the stage architecture
 * first, not the growth curve.
 *
 * THIS ONE IS A PLACEHOLDER AND SAYS SO. `provisional: true` travels with it, so no surface can present a stage earned
 * under it as though it had been earned under the real thing.
 */
export interface GrowthPolicy {
  readonly policyId: string;
  readonly provisional: boolean;
  /** What one of each signal contributes, in the same units as `toNextStage`. */
  readonly weights: Readonly<Record<GrowthSignal, number>>;
  /** How much is needed to unlock each stage from the one before it. */
  readonly toNextStage: Readonly<Record<'MEDIUM' | 'LARGE', number>>;
}

export const PROVISIONAL_GROWTH_POLICY: GrowthPolicy = Object.freeze({
  policyId: 'provisional-2026-09',
  provisional: true,
  weights: Object.freeze({
    MILESTONE_REACHED: 3,
    MISSION_COMPLETED: 2,
    CREATION_PROGRESS: 1,
    VERIFIED_ACCOMPLISHMENT: 4,
    SUSTAINED_DEVELOPMENT: 1,
  }),
  toNextStage: Object.freeze({ MEDIUM: 12, LARGE: 40 }),
});

/* ==================================================================== what a client may know */

/**
 * WHAT IS SENT TO A CLIENT, and to other players. The founder: "Do not replicate unnecessary backend internals." So
 * this carries identity, skin, stage, spawn and activity -- enough to draw the right creature doing the right thing --
 * and no growth arithmetic, no evidence ids, no owner internals beyond who owns it.
 */
export interface ProjectAvatarView {
  readonly projectAvatarId: string;
  readonly projectId: string;
  readonly ownerId: string;
  readonly skin: ProjectAvatarSkin;
  readonly currentForm: ProjectAvatarStage;
  readonly unlockedForm: ProjectAvatarStage;
  readonly spawnState: SpawnState;
  readonly activity: AvatarActivity;
  readonly nickname: string | null;
  /** Rounded to whole percent: a ring to fill, not a figure to audit. */
  readonly progressPercent: number;
  /** True while the stage was earned under a placeholder policy, so a surface can say so. */
  readonly provisionalProgress: boolean;
}

/** The figure file each form is drawn from. The client resolves the file; the domain only ever names skin and stage. */
export function figureNameFor(skin: ProjectAvatarSkin, stage: ProjectAvatarStage): string {
  const family = skin === 'TEN_TAILS' ? 'TenTails' : 'Cherubim';
  const form = `${stage.charAt(0)}${stage.slice(1).toLowerCase()}`;
  return `${family}_${form}.wlvox`;
}

/**
 * HOW BIG EACH STAGE STANDS, in metres. The same three figures the generator solves for, kept here so the domain and
 * the art cannot drift apart, and so a surface can say how big a creature is without measuring one.
 */
export const STAGE_METRES: Readonly<Record<ProjectAvatarStage, number>> = Object.freeze({
  SMALL: 1.15,
  MEDIUM: 2.7,
  LARGE: 5.6,
});

/**
 * WHERE A LARGE FORM FITS. Measured in the built world, not guessed: a 5.6 m avatar is about two storeys, passes the
 * Icarus gatehouse (8 m clear) and does NOT pass the garden arches (about 3 m). So the mature form belongs in the wide
 * places, and that is a rule about where it may roam rather than a reason to shrink it.
 */
export const LARGE_FORM_CLEARANCE_METRES = 6.2;
