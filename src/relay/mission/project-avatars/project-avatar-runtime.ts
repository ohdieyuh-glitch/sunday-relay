import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import {
  PROVISIONAL_GROWTH_POLICY,
  figureNameFor,
  nextStage,
  stageIndex,
  type AvatarActivity,
  type GrowthEvent,
  type GrowthPolicy,
  type ProjectAvatar,
  type ProjectAvatarSkin,
  type ProjectAvatarStage,
  type ProjectAvatarView,
  type SpawnState,
} from './project-avatar-contracts';

/**
 * THE PROJECT AVATAR RULES — pure, and the authority over what stage a project's avatar has reached.
 *
 * Progress unlocks a form. An EVOLUTION puts it on. Those are two things on purpose: the founder asked that a stage
 * change feel like an event rather than a mesh appearing, so nothing here ever changes currentForm as a side effect of
 * growth -- something has to ask for the evolution, and the avatar passes through EVOLVING on the way.
 */

export interface AvatarClock {
  readonly at: string;
  readonly policy?: GrowthPolicy;
}

/** A new project's avatar: SMALL, unspawned, and nothing pretended about its progress. */
export function createProjectAvatar(
  input: { projectAvatarId: string; projectId: string; ownerId: string; skin: ProjectAvatarSkin; nickname?: string | null },
  clock: AvatarClock,
): ProjectAvatar {
  return {
    projectAvatarId: input.projectAvatarId,
    projectId: input.projectId,
    ownerId: input.ownerId,
    skin: input.skin,
    // EVERY AVATAR BEGINS SMALL. The reference sheets are the mature form and are not where a project starts.
    currentForm: 'SMALL',
    unlockedForm: 'SMALL',
    progress: 0,
    spawnState: 'NOT_SPAWNED',
    activity: 'IDLE',
    nickname: input.nickname ?? null,
    createdAt: clock.at,
    updatedAt: clock.at,
    history: [{ stage: 'SMALL', at: clock.at, why: 'The project was created.' }],
  };
}

/** Everything earned so far, in policy units, from the project's own signals. */
export function scoreOf(events: readonly GrowthEvent[], policy: GrowthPolicy = PROVISIONAL_GROWTH_POLICY): number {
  return events.reduce((total, event) => total + (policy.weights[event.signal] ?? 0), 0);
}

/**
 * WHAT THE PROJECT HAS EARNED. Returns the furthest unlocked stage and how far along it is toward the next one -- and
 * never changes what the avatar is wearing.
 */
export function earnedFrom(events: readonly GrowthEvent[], policy: GrowthPolicy = PROVISIONAL_GROWTH_POLICY): { stage: ProjectAvatarStage; progress: number } {
  const score = scoreOf(events, policy);
  const toMedium = policy.toNextStage.MEDIUM;
  const toLarge = policy.toNextStage.LARGE;
  if (score >= toLarge) {
    return { stage: 'LARGE', progress: 1 };
  }
  if (score >= toMedium) {
    return { stage: 'MEDIUM', progress: (score - toMedium) / Math.max(toLarge - toMedium, 1) };
  }
  return { stage: 'SMALL', progress: score / Math.max(toMedium, 1) };
}

/**
 * GROWTH ARRIVES. The avatar's unlocked form may move up; what it is WEARING does not change here, because that is an
 * event the world has to show.
 */
export function applyGrowth(avatar: ProjectAvatar, events: readonly GrowthEvent[], clock: AvatarClock): ProjectAvatar {
  const policy = clock.policy ?? PROVISIONAL_GROWTH_POLICY;
  const earned = earnedFrom(events, policy);
  // NEVER BACKWARDS. A policy change or a withdrawn signal does not take a form away from a project that earned it.
  const unlocked = stageIndex(earned.stage) > stageIndex(avatar.unlockedForm) ? earned.stage : avatar.unlockedForm;
  return {
    ...avatar,
    unlockedForm: unlocked,
    progress: Math.max(0, Math.min(1, earned.progress)),
    updatedAt: clock.at,
  };
}

/**
 * BEGIN AN EVOLUTION. Refused unless a further form has actually been earned. The avatar goes to EVOLVING; the world
 * plays the moment; `completeEvolution` then puts the new form on. Nothing skips a stage.
 */
export function beginEvolution(avatar: ProjectAvatar, clock: AvatarClock): RelayResult<ProjectAvatar> {
  const wanted = nextStage(avatar.currentForm);
  if (wanted === null) {
    return fail(relayError('illegal-transition', 'This avatar is already at its mature form.'));
  }
  if (stageIndex(avatar.unlockedForm) < stageIndex(wanted)) {
    return fail(relayError('permission-denied', `The project has not earned ${wanted} yet, so nothing was changed.`));
  }
  if (avatar.spawnState === 'EVOLVING') {
    return fail(relayError('illegal-transition', 'It is already evolving.'));
  }
  return ok({ ...avatar, spawnState: 'EVOLVING', activity: 'EVOLVE', updatedAt: clock.at });
}

/** The moment is over: the avatar wears the next form, and its history records when and why. */
export function completeEvolution(avatar: ProjectAvatar, clock: AvatarClock): RelayResult<ProjectAvatar> {
  if (avatar.spawnState !== 'EVOLVING') {
    return fail(relayError('illegal-transition', 'Nothing is evolving.'));
  }
  const wanted = nextStage(avatar.currentForm);
  if (wanted === null) {
    return fail(relayError('illegal-transition', 'There is no further form.'));
  }
  return ok({
    ...avatar,
    currentForm: wanted,
    spawnState: 'PRESENT',
    activity: 'CELEBRATION',
    updatedAt: clock.at,
    history: [...avatar.history, { stage: wanted, at: clock.at, why: 'The project earned it.' }],
  });
}

/** Summon, rest, despawn. One legal-move table, so a client cannot talk an avatar into a state it cannot be in. */
const SPAWN_EDGES: ReadonlyArray<readonly [SpawnState, SpawnState]> = Object.freeze([
  ['NOT_SPAWNED', 'SUMMONING'],
  ['SUMMONING', 'PRESENT'],
  ['SUMMONING', 'NOT_SPAWNED'],
  ['PRESENT', 'RESTING'],
  ['PRESENT', 'DESPAWNING'],
  ['PRESENT', 'EVOLVING'],
  ['RESTING', 'PRESENT'],
  ['RESTING', 'DESPAWNING'],
  ['EVOLVING', 'PRESENT'],
  ['DESPAWNING', 'NOT_SPAWNED'],
]);

export function isLegalSpawnMove(from: SpawnState, to: SpawnState): boolean {
  return SPAWN_EDGES.some(([a, b]) => a === from && b === to);
}

export function setSpawnState(avatar: ProjectAvatar, to: SpawnState, clock: AvatarClock): RelayResult<ProjectAvatar> {
  if (!isLegalSpawnMove(avatar.spawnState, to)) {
    return fail(relayError('illegal-transition', `An avatar cannot go from ${avatar.spawnState} to ${to}.`));
  }
  const activity: AvatarActivity =
    to === 'SUMMONING' ? 'SUMMON' : to === 'DESPAWNING' ? 'DESPAWN' : to === 'RESTING' ? 'REST' : to === 'EVOLVING' ? 'EVOLVE' : 'IDLE';
  return ok({ ...avatar, spawnState: to, activity, updatedAt: clock.at });
}

/** What the body is doing, when the project or the player gives it something to do. */
export function setActivity(avatar: ProjectAvatar, activity: AvatarActivity, clock: AvatarClock): RelayResult<ProjectAvatar> {
  if (avatar.spawnState !== 'PRESENT' && activity !== 'IDLE' && activity !== 'REST') {
    return fail(relayError('illegal-transition', 'It is not in the world to do anything.'));
  }
  return ok({ ...avatar, activity, updatedAt: clock.at });
}

/** What a client and other players are told: enough to draw it, and none of the arithmetic. */
export function projectAvatarView(avatar: ProjectAvatar, policy: GrowthPolicy = PROVISIONAL_GROWTH_POLICY): ProjectAvatarView {
  return {
    projectAvatarId: avatar.projectAvatarId,
    projectId: avatar.projectId,
    ownerId: avatar.ownerId,
    skin: avatar.skin,
    currentForm: avatar.currentForm,
    unlockedForm: avatar.unlockedForm,
    spawnState: avatar.spawnState,
    activity: avatar.activity,
    nickname: avatar.nickname,
    progressPercent: Math.round(Math.max(0, Math.min(1, avatar.progress)) * 100),
    provisionalProgress: policy.provisional,
  };
}

/** The figure a client should draw for this avatar right now. Skin and stage in, a file name out. */
export function figureForAvatar(avatar: ProjectAvatar): string {
  return figureNameFor(avatar.skin, avatar.currentForm);
}
