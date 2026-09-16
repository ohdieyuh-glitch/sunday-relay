/**
 * WONDERLAND MULTIPLAYER — the barrel.
 *
 * The smallest serious multiplayer slice: a session people join with a spoken
 * code, replicated presence and movement, honest reconnect, and a hard line
 * between what a peer may SEE and what a peer may CHANGE.
 *
 * Not re-exported through the mission barrel, for the reason the other
 * Wonderland modules are not.
 */

export {
  NEVER_REPLICATED_CONCERNS,
  SHARED_PARTICIPANT_FIELDS,
  SUPPORTED_WONDERLAND_SESSION_SCHEMA_VERSIONS,
  WONDERLAND_CONNECTION_STATES,
  WONDERLAND_ORIGIN_TRANSFORM,
  WONDERLAND_RECONNECT_WINDOW_MS,
  WONDERLAND_SESSION_MAX_PARTICIPANTS,
  WONDERLAND_SESSION_SCHEMA_V1,
  WONDERLAND_SESSION_SCHEMA_VERSION,
  WONDERLAND_SESSION_STATUSES,
} from './multiplayer-contracts';
export type {
  SharedParticipantField,
  WonderlandConnectionState,
  WonderlandParticipant,
  WonderlandParticipantView,
  WonderlandSession,
  WonderlandSessionDraft,
  WonderlandSessionSchemaVersion,
  WonderlandSessionStatus,
  WonderlandSessionView,
  WonderlandTransform,
} from './multiplayer-contracts';

export {
  closeWonderlandSession,
  createWonderlandSession,
  expireWonderlandReconnects,
  joinCodeFor,
  joinWonderlandSession,
  leaveWonderlandSession,
  markWonderlandDisconnected,
  mayActOnBehalfOf,
  moveWonderlandParticipant,
  reconnectToWonderlandSession,
  sealWonderlandSessionToJoins,
  viewParticipant,
  viewWonderlandSession,
} from './multiplayer-session';

export {
  createWonderlandSessionStore,
  readWonderlandSession,
  sealWonderlandSession,
  wonderlandSessionDraftFrom,
} from './multiplayer-store';
export type {
  WonderlandSessionReadResult,
  WonderlandSessionStorePort,
} from './multiplayer-store';
