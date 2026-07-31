/**
 * SUNDAY RELAY — MILESTONE 4.5
 * Relay Dog motion and state animation system — public surface.
 *
 * Visual behavior only. Mission state drives the dog; the dog never drives
 * mission state, never appends a trace event, and never touches a capsule.
 * See docs/relay/RELAY_DOG_MOTION_SYSTEM.md.
 */

export {
  RELAY_DOG_ACTIVITIES,
  DOG_ACTIVITY_PRIORITY,
  resolveDogActivity,
  projectRelayStateToDogBehavior,
  projectWorkspaceDogBehavior,
  projectHomeDogBehavior,
  type RelayDogActivityKind,
  type RelayDogBehavior,
} from './dog-behavior';
export {
  DEFAULT_PATROL_CONFIG,
  MIN_PATROL_TRACK_PX,
  clampToBounds,
  createPatrolState,
  measurePatrolBounds,
  refitToBounds,
  stepPatrol,
  type PatrolBounds,
  type PatrolConfig,
  type PatrolDirection,
  type PatrolPhase,
  type PatrolState,
} from './patrol-engine';
export {
  useRelayDogPatrol,
  type RelayDogPatrolOptions,
  type RelayDogPatrolResult,
} from './useRelayDogPatrol';
export {
  RelayDogMotionBoundary,
  type RelayDogMotionBoundaryProps,
} from './RelayDogMotionBoundary';
export {
  RelayDogOperationalDecor,
  OPERATIONAL_ACTIVITY_DESCRIPTION,
  operationalActivityDescription,
  type RelayDogOperationalDecorProps,
} from './RelayDogOperationalDecor';
