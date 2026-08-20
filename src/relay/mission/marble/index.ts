/**
 * MARBLE — the barrel.
 *
 * World Labs Marble as an OPTIONAL environment generator for Wonderland. Relay
 * stays authoritative, Unreal stays the interactive runtime, Marble supplies
 * appearance around authored structure.
 *
 * NOT re-exported through `src/relay/mission/index.ts`, for the same reason
 * `wonderland` is not: the mission barrel is reachable from the browser entry
 * point, and this module names credential-adjacent concepts. A surface that
 * needs Marble imports this path, and that edge gets reviewed then.
 */

export type {
  MarbleAssetManifest,
  MarbleAssurance,
  MarbleEvent,
  MarbleEventType,
  MarbleGenerationOperation,
  MarbleGenerationRequest,
  MarbleImageRef,
  MarbleImportResult,
  MarbleModel,
  MarbleOperationState,
  MarbleProgressStatus,
  MarblePromptType,
  MarbleSplatResolution,
  MarbleWorldRegion,
  MarbleWorldResult,
  WorldLabsOperation,
  WorldLabsWorld,
  WorldLabsWorldAssets,
} from './marble-contracts';

export {
  MARBLE_ASSURANCE,
  MARBLE_EVENT_TYPES,
  MARBLE_EXPORT_ASSET_TYPES,
  MARBLE_EXPORT_FORMATS,
  MARBLE_MODELS,
  MARBLE_OPERATION_STATES,
  MARBLE_PROGRESS_STATUS,
  MARBLE_PROMPT_TYPES,
  MARBLE_SPLAT_RESOLUTIONS,
} from './marble-contracts';

export type { MarbleValidation } from './marble-operations';
export {
  applyProviderOperation,
  canTransition,
  isSubmittable,
  manifestReadiness,
  marbleDedupeKey,
  markSubmitted,
  newMarbleOperation,
  readMarbleManifest,
  validateMarbleRequest,
} from './marble-operations';

export type { MarbleApprovalAsk, MarbleConfig, MarbleGateDecision } from './marble-gate';
export {
  MARBLE_SERVER_ONLY_FIELDS,
  approveMarbleGeneration,
  decideMarbleGate,
  leaksMarbleSecret,
  marbleEvent,
  readMarbleConfig,
  redactMarbleSecrets,
  requestMarbleApproval,
} from './marble-gate';

export type { MarbleProvider, MockMarbleOptions } from './marble-provider';
export { MockMarbleProvider, toWorldLabsGenerateBody } from './marble-provider';

export type { RegionBindingDecision, SplatRendererCandidate } from './marble-region';
export {
  RENDERER_BLOCKING_CRITERIA,
  decideRegionBinding,
  rendererIsUsable,
  stagedImport,
  unevaluatedRenderer,
} from './marble-region';
