/**
 * WONDERLAND — the barrel.
 *
 * Pure domain. Relay is authoritative; Unreal is presentational. Everything here
 * projects state Relay already owns into one versioned world-state document, and
 * nothing here decides anything. See docs/relay/WONDERLAND.md.
 *
 * NOT re-exported through `src/relay/mission/index.ts`, deliberately. Nothing on
 * the website or the CLI consumes this module yet, and the mission barrel is
 * reachable from the browser entry point — adding an unused surface to that
 * import graph is how `role-slots` put server configuration names into the
 * bundle. When a surface needs Wonderland, it imports this path, and that edge
 * gets reviewed then.
 */

export {
  SUPPORTED_WONDERLAND_WORLD_SCHEMA_VERSIONS,
  WONDERLAND_AGENT_FIELDS,
  WONDERLAND_ATTESTATION_FIELDS,
  WONDERLAND_AUTHORITY,
  WONDERLAND_BADGE_FIELDS,
  WONDERLAND_BRAIN_WEATHER_FIELDS,
  WONDERLAND_CLASS_STANDING_FIELDS,
  WONDERLAND_CLIENT_ROLE,
  WONDERLAND_CONNECTION_STATES,
  WONDERLAND_CPP_ENUM_PARITY,
  WONDERLAND_CPP_NULLABLE_CARRIERS,
  WONDERLAND_CPP_STRUCT_PARITY,
  WONDERLAND_CPP_UNOBSERVED_MEMBER,
  WONDERLAND_DOG_ANIMATIONS,
  WONDERLAND_DOG_MOTIONS,
  WONDERLAND_DOG_OVERLAYS,
  WONDERLAND_DOG_SKIN_FIELDS,
  WONDERLAND_ENGINEER_CLASSES,
  WONDERLAND_ENTITY_FORMS,
  WONDERLAND_FIGURE_FIELDS,
  WONDERLAND_GVE_CLASSES,
  WONDERLAND_GVE_FIELDS,
  WONDERLAND_GVE_IDS,
  WONDERLAND_GVE_PHASES,
  WONDERLAND_LOOP_SIGNAL_FIELDS,
  WONDERLAND_MISSION_FIELDS,
  WONDERLAND_MISSION_REQUEST_FIELDS,
  WONDERLAND_MOTION_ANIMATION,
  WONDERLAND_NULLABLE_FIELDS,
  WONDERLAND_OWNER_ONLY_SECTIONS,
  WONDERLAND_PROJECT_CATEGORIES,
  WONDERLAND_PROJECT_ENTITY_FIELDS,
  WONDERLAND_RECOMMENDATION_FIELDS,
  WONDERLAND_REPLICATION_FIELDS,
  WONDERLAND_REQUEST_AUTHORITY,
  WONDERLAND_TERMINAL_LINE_FIELDS,
  WONDERLAND_TERMINAL_PANEL_FIELDS,
  WONDERLAND_TERMINAL_PROVENANCES,
  WONDERLAND_WORLD_FIELDS,
  WONDERLAND_WORLD_SCHEMA_V1,
  WONDERLAND_WORLD_SCHEMA_VERSION,
  WONDERLAND_WORLD_VISIBLE_SECTIONS,
  exactKeys,
  nullableKeys,
  wonderlandAnimationFor,
  wonderlandFigure,
} from './wonderland-contracts';
export type {
  WonderlandAgent,
  WonderlandAttestation,
  WonderlandBadge,
  WonderlandBrainWeather,
  WonderlandClassStanding,
  WonderlandDogAnimation,
  WonderlandDogOverlay,
  WonderlandDogSkin,
  WonderlandEngineerClass,
  WonderlandEntityForm,
  WonderlandFigure,
  WonderlandGve,
  WonderlandGveClass,
  WonderlandGveId,
  WonderlandGvePhase,
  WonderlandLoopSignal,
  WonderlandMission,
  WonderlandMissionRequest,
  WonderlandProjectCategory,
  WonderlandProjectEntity,
  WonderlandRecommendation,
  WonderlandReplication,
  WonderlandTerminalLine,
  WonderlandTerminalPanel,
  WonderlandWorld,
  WonderlandWorldSchemaVersion,
} from './wonderland-contracts';

export {
  WONDERLAND_DEFAULT_SKIN_REQUEST,
  WONDERLAND_TERMINAL_MAX_LINES,
  projectWonderlandAgent,
  projectWonderlandAttestation,
  projectWonderlandBrain,
  projectWonderlandLoopSignal,
  projectWonderlandMission,
  projectWonderlandReplication,
  projectWonderlandTerminal,
  projectWonderlandWorld,
  resolveWonderlandDogSkin,
  wonderlandSkinTierLabel,
} from './wonderland-projection';
export type {
  WonderlandAgentObservation,
  WonderlandLoopObservation,
  WonderlandMissionObservation,
  WonderlandSkinRequest,
  WonderlandWorldInput,
} from './wonderland-projection';

export {
  WONDERLAND_CATEGORY_FORM,
  WONDERLAND_STAGE_THRESHOLDS,
  evidenceQualifiesForEvolution,
  isWonderlandProjectCategory,
  projectWonderlandEntity,
  wonderlandFormFor,
} from './wonderland-entities';
export type {
  WonderlandEvolutionInput,
  WonderlandMissionEvidence,
} from './wonderland-entities';

export {
  RUNAWAY_DOG_GVE_CLASS,
  RUNAWAY_DOG_GVE_ID,
  WONDERLAND_WITHHELD_HEADLINE,
  chaseCaptureBlockedReason,
  projectWonderlandChase,
  projectWonderlandMissionRequest,
  projectWonderlandRecommendation,
} from './wonderland-gve';
export type {
  WonderlandChaseInput,
  WonderlandMissionRequestCandidate,
  WonderlandRecommendationCandidate,
} from './wonderland-gve';

export {
  WONDERLAND_KNOWN_SKILL_IDS,
  projectWonderlandClassStandings,
} from './wonderland-classes';
export type {
  WonderlandBadgeCandidate,
  WonderlandClassInput,
  WonderlandClassProjection,
} from './wonderland-classes';
