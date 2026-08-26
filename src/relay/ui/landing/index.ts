export { RelayLanding } from './RelayLanding';
export {
  LANDING_SCENES, SCENE_COUNT, sceneAt, sampleTrack, sampleVec3, smoothstep,
  clamp01, dogBeatAt, DOG_BEATS, CAMERA_POSITION, CAMERA_TARGET, CAMERA_FOV,
  AQUALA_PRESENCE, DOG_PRESENCE,
} from './choreography';
export type { LandingScene, ScenePosition, Keyframe, Vec3, DogBeat } from './choreography';
export { useLandingRuntime, usePrefersReducedMotion, snapToBeat } from './useLandingRuntime';
export type { LandingTelemetry, LandingRuntime } from './useLandingRuntime';
