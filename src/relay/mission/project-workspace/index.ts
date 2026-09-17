/**
 * THE WONDERLAND PROJECT WORKSPACE — the barrel.
 *
 * The user's durable workspace: files, assets, creations, mission references,
 * collaborators and a Project Avatar. Pure domain; the durable backing is
 * injected. Distinct from `RelayProject` (which scopes a run) and from the
 * Project Brain (which another lane owns and which appears here only as an
 * opaque reference).
 *
 * NOT re-exported through `src/relay/mission/index.ts`, for the same reason
 * `wonderland` and `wonder-web` are not: that barrel is reachable from the
 * browser entry point, and a surface that needs this imports the path directly.
 */

export {
  SUPPORTED_WONDERLAND_PROJECT_SCHEMA_VERSIONS,
  WONDERLAND_AVATAR_MANIFESTATIONS,
  WONDERLAND_PROJECT_CAPABILITIES,
  WONDERLAND_PROJECT_MAX_COLLABORATORS,
  WONDERLAND_PROJECT_ROLES,
  WONDERLAND_PROJECT_SCHEMA_V1,
  WONDERLAND_PROJECT_SCHEMA_VERSION,
  WONDERLAND_PROJECT_STATUSES,
  WONDERLAND_ROLE_CAPABILITIES,
  capabilitiesFor,
  collaboratorCount,
  hasCapability,
} from './project-contracts';
export type {
  WonderlandAvatarManifestation,
  WonderlandProject,
  WonderlandProjectAsset,
  WonderlandProjectAvatar,
  WonderlandProjectCapability,
  WonderlandProjectDraft,
  WonderlandProjectFile,
  WonderlandProjectMember,
  WonderlandProjectRole,
  WonderlandProjectSchemaVersion,
  WonderlandProjectStatus,
} from './project-contracts';

export {
  addProjectCollaborator,
  archiveWonderlandProject,
  attachCreationToProject,
  attachMissionToProject,
  avatarFormHint,
  changeCollaboratorRole,
  createWonderlandProject,
  duplicateWonderlandProject,
  isSafeProjectPath,
  openWonderlandProject,
  removeProjectCollaborator,
  removeProjectFile,
  renameWonderlandProject,
  reopenWonderlandProject,
  saveProjectAsset,
  saveProjectFile,
} from './project-lifecycle';
export type { CreateProjectInput, ProjectOpenResult } from './project-lifecycle';

export {
  readWonderlandProject,
  sealWonderlandProject,
  verifyWonderlandProjectChecksum,
  wonderlandProjectDraftFrom,
} from './project-record';
export type { WonderlandProjectReadResult } from './project-record';

export { createWonderlandProjectStore } from './project-store';
export type {
  WonderlandProjectStorePort,
  WonderlandProjectWriteResult,
} from './project-store';

export {
  PROMOTION_CREATION_COUNT,
  PROMOTION_FILE_COUNT,
  PROMOTION_REASONS,
  PROMOTION_STACKED_MISSIONS,
  projectPromotionHook,
  suggestProjectPromotion,
} from './project-promotion';
export type {
  ProjectPromotionHook,
  PromotionReason,
  PromotionSignals,
  PromotionSuggestion,
} from './project-promotion';
