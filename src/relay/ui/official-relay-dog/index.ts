/**
 * OFFICIAL RELAY DOG — shared identity surface.
 *
 * Sunday Relay has ONE official Relay Dog: the compact front-facing voxel
 * companion with upright ears, a dark charcoal visor band, two square amber
 * eyes, a cream/bone-white body and short block legs. This barrel is the
 * WEBSITE'S VIEW of that identity — the modules themselves live in
 * src/relay/shared, the browser-safe seam, and the CLI/terminal imports the
 * very same files. There is one copy, so the two surfaces cannot drift.
 *
 * The website's canonical RENDERER remains src/relay/ui/pixel-dog and its
 * canonical MOTION SYSTEM remains src/relay/ui/relay-dog-motion (Milestone
 * 4.5). This module does not replace either: it is the shared asset + shared
 * semantics both surfaces agree on.
 */

export {
  OFFICIAL_RELAY_DOG_IDENTITY_VERSION,
  OFFICIAL_RELAY_DOG_WIDTH,
  OFFICIAL_RELAY_DOG_HEIGHT,
  OFFICIAL_RELAY_DOG_ASPECT,
  OFFICIAL_RELAY_DOG_PALETTE,
  OFFICIAL_RELAY_DOG_TERMINAL_TONE,
  OFFICIAL_RELAY_DOG_POSES,
  OFFICIAL_RELAY_DOG_POSE_NAMES,
  OFFICIAL_RELAY_DOG_SPRITE,
  officialRelayDogGrid,
  type OfficialRelayDogPixel,
  type OfficialRelayDogPose,
} from '../../shared/official-relay-dog-sprite';

export {
  OFFICIAL_RELAY_DOG_ACTIVITIES,
  OFFICIAL_RELAY_DOG_ACTIVITY_PRIORITY,
  OFFICIAL_RELAY_DOG_REDUCED_MOTION_FALLBACK,
  OFFICIAL_WORKSPACE_DOG_STATES,
  OFFICIAL_HOME_DOG_STATES,
  OFFICIAL_WORKSPACE_STATE_ACTIVITY,
  OFFICIAL_HOME_STATE_ACTIVITY,
  OFFICIAL_RELAY_DOG_STATE_PRESENTATION,
  OFFICIAL_RELAY_DOG_ACTIVITY_POSE,
  OFFICIAL_RELAY_DOG_ACTIVITY_MARKER,
  OFFICIAL_RELAY_DOG_ACTIVITY_MOTION,
  OFFICIAL_RELAY_DOG_TRAVELLING_MOTIONS,
  officialRelayDogBehavior,
  officialRelayDogView,
  officialRelayDogViewForState,
  projectOfficialRelayDogActivity,
  projectOfficialRelayDogBehavior,
  resolveOfficialRelayDogActivity,
  type OfficialRelayDogActivity,
  type OfficialRelayDogBehavior,
  type OfficialRelayDogMarker,
  type OfficialRelayDogMotion,
  type OfficialRelayDogPresentation,
  type OfficialRelayDogView,
  type OfficialWorkspaceDogState,
  type OfficialHomeDogState,
} from '../../shared/official-relay-dog-states';

export {
  OFFICIAL_RELAY_DOG_MANIFEST_VERSION,
  RETIRED_SIDE_PROFILE_DOG_MARKERS,
} from '../../shared/official-relay-dog-parity';
