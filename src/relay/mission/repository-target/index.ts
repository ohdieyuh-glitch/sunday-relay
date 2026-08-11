/**
 * REPOSITORY TARGETS — the public surface.
 *
 * The barrel is the import path for everything outside this directory,
 * including the CLI (which may import `../mission` but never a deep path into
 * it). Nothing here re-exports an internal helper: `patternCoveredBy`,
 * `normalizeScopeSide` and the refusal constructors stay private, because a
 * caller that can reach a scope-widening helper directly can widen a scope
 * without going through the check that refuses it.
 */

export {
  ALWAYS_PROTECTED_PATHS,
  DEFAULT_CHANGE_CEILINGS,
  DEFAULT_PROTECTED_PATHS,
  HIGH_CONSEQUENCE_PERMISSIONS,
  IMPLEMENTED_REPOSITORY_PROVIDERS,
  PERMISSION_PREREQUISITES,
  REPOSITORY_PERMISSIONS,
  REPOSITORY_PROVIDERS,
  REPOSITORY_REFUSALS,
} from './repository-contracts';
export type {
  ChangeCeilings,
  CredentialBoundary,
  MissionRepositoryTarget,
  PermissionGrant,
  ProtectedPathConfig,
  RepositoryIdentity,
  RepositoryLocation,
  RepositoryPermission,
  RepositoryProblem,
  RepositoryProvenance,
  RepositoryProviderId,
  RepositoryRefusal,
  RepositoryRegistration,
  RepositoryScope,
  RepositoryTargetAttestation,
} from './repository-contracts';

export {
  buildRepositoryTargetAttestation,
  isRepositoryProviderId,
  repositoryKey,
  repositoryProviderSupported,
  validRepositoryBranchName,
  validateRepositoryIdentity,
  validateRepositoryLocation,
} from './repository-identity';

export {
  classifyObservedChanges,
  narrowScope,
  pathInScope,
  protectedPathMatches,
  resolveProtectedPaths,
  scopeMatches,
  validateRepositoryScope,
} from './repository-scope';
export type { ScopeVerdict } from './repository-scope';

export {
  authorizeRepositoryAction,
  hasHighConsequencePermission,
  isRepositoryPermission,
  livePermissions,
  narrowPermissions,
  renderPermissionLine,
  requiresCredential,
  validatePermissionGrants,
} from './repository-authorization';
export type { AuthorizationDecision } from './repository-authorization';

export {
  resolveProtectedBranches,
  resolveRepositoryTarget,
  revalidateRepositoryTarget,
} from './repository-resolution';
export type { RepositoryResolution, RepositoryTargetRequest } from './repository-resolution';

export {
  createRepositoryRegistration,
  createRepositoryRegistry,
  revokeRepositoryRegistration,
} from './repository-registry';
export type { RepositoryRegistrationDraft, RepositoryRegistry } from './repository-registry';

export {
  DEPLOY_ENVIRONMENTS,
  SHIP_STAGES,
  SHIP_STAGE_REQUIREMENTS,
  advanceShipStage,
  decideShipped,
  deployPermissionFor,
  deriveShipStage,
} from './repository-lifecycle';
export type {
  DeployEnvironment,
  LiveProbeResult,
  ShipStage,
  ShipStageEvidence,
  ShipTransitionDecision,
  ShipTransitionRequest,
  ShipVerdict,
} from './repository-lifecycle';

export {
  baseMovedUnderMission,
  enforceChangeCeilings,
  judgeObservedDiff,
} from './repository-observation';
export type {
  CeilingVerdict,
  DiffJudgement,
  ObservedDiff,
  ObservedFileChange,
} from './repository-observation';

export { providerSupportsEnvironment } from './deployment-provider';
export type {
  DeployObservation,
  DeployRequest,
  DeploymentProvider,
  DeploymentProviderDescriptor,
} from './deployment-provider';

export {
  REPOSITORY_KNOWLEDGE_KINDS,
  REPOSITORY_MEMORY_SOURCE,
  REPOSITORY_OBSERVED_BY,
  observeDeployment,
  observeJudgedDiff,
  observeRepair,
  observeShipHistory,
  observeShipVerdict,
  proposeRepositoryKnowledge,
} from './repository-brain-feed';
export type { RepositoryKnowledgeKind, RepositoryKnowledgeRefusal } from './repository-brain-feed';
