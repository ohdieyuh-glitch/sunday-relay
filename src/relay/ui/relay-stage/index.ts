/**
 * SUNDAY RELAY — THE RELAY STAGE (barrel).
 *
 * The space the Relay Dog, a wider Leopard, cubs, vehicles and effects act in.
 * Frameless by construction, layered, and pure of animation — the actors bring
 * their own.
 */

export { RelayStage } from './RelayStage';
export { RelayStageBackdrop } from './RelayStageBackdrop';
export { RelayStageBackdropPicker } from './RelayStageBackdropPicker';
export {
  RELAY_BACKDROPS,
  RELAY_BACKDROP_IDS,
  isKnownBackdrop,
  projectBackdropChoices,
  resolveBackdrop,
} from './stage-backdrop';
export type {
  RelayBackdropChoice,
  RelayBackdropEntry,
  RelayBackdropId,
} from './stage-backdrop';
export type { RelayStageProps } from './RelayStage';
export {
  CLIPPING_LAYERS,
  FAR_SCALE,
  GROUND_HORIZON,
  RELAY_STAGE_LAYERS,
  RELAY_STAGE_NARROW,
  RELAY_STAGE_NARROW_BELOW_PX,
  RELAY_STAGE_WIDE,
  layerClips,
  layoutStage,
  placeActor,
  stageCapacity,
  stageShapeFor,
} from './stage-layout';
export type {
  RelayStageActor,
  RelayStageLayer,
  RelayStageLayout,
  RelayStagePlacement,
  RelayStageShape,
} from './stage-layout';
