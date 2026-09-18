/**
 * PROJECT AVATARS — a project's own living representation, and the authority over how grown it is.
 *
 * Julius, the Relay Dog, Jhinn and the LLM Companion are all elsewhere: an avatar belongs to a PROJECT.
 */
export {
  AVATAR_ACTIVITIES,
  GROWTH_SIGNALS,
  LARGE_FORM_CLEARANCE_METRES,
  PROJECT_AVATAR_SKINS,
  PROJECT_AVATAR_STAGES,
  PROVISIONAL_GROWTH_POLICY,
  SPAWN_STATES,
  STAGE_METRES,
  figureNameFor,
  nextStage,
  stageIndex,
  type AvatarActivity,
  type GrowthEvent,
  type GrowthPolicy,
  type GrowthSignal,
  type ProjectAvatar,
  type ProjectAvatarSkin,
  type ProjectAvatarStage,
  type ProjectAvatarView,
  type SpawnState,
} from './project-avatar-contracts';

export {
  applyGrowth,
  beginEvolution,
  completeEvolution,
  createProjectAvatar,
  earnedFrom,
  figureForAvatar,
  isLegalSpawnMove,
  projectAvatarView,
  scoreOf,
  setActivity,
  setSpawnState,
  type AvatarClock,
} from './project-avatar-runtime';
