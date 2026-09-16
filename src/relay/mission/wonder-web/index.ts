/**
 * WONDER WEB — the barrel.
 *
 * Wonderland's in-world surface for opening, running and using software that an
 * AI execution system produced, without the user leaving Wonderland. Pure
 * domain: contracts, a lifecycle machine, an execution boundary, a read model
 * and a durable store. No Node, no network, no clock.
 *
 * PROVIDER-INDEPENDENT BY CONSTRUCTION. Nothing in this directory names a coding
 * provider. A creation records WHO produced it (`WonderWebProducer.systemId`) and
 * WHETHER it really happened (`provenance`), and the surface renders both. The
 * Node-side runtime that actually prepares, builds and serves a creation lives in
 * `relay-bridge/wonder-web/`, on the other side of this boundary, so a second
 * execution system is a new producer rather than a rewrite of the viewer.
 *
 * NOT re-exported through `src/relay/mission/index.ts`, deliberately — the same
 * reason `wonderland` is not. That barrel is reachable from the browser entry
 * point, and adding a surface nothing consumes yet is how server-side names end
 * up in the shipped bundle. A surface that needs Wonder Web imports this path,
 * and that edge gets reviewed then.
 */

export {
  SUPPORTED_WONDER_WEB_SCHEMA_VERSIONS,
  WONDER_WEB_CAPABILITIES,
  WONDER_WEB_CREATION_STATUSES,
  WONDER_WEB_CREATION_TYPES,
  WONDER_WEB_RESTING_STATUSES,
  WONDER_WEB_RUNTIME_TYPES,
  WONDER_WEB_SCHEMA_V1,
  WONDER_WEB_SCHEMA_VERSION,
  isOpenableInWonderWeb,
} from './wonder-web-contracts';
export type {
  WonderWebBuildOutcome,
  WonderWebCapability,
  WonderWebCreation,
  WonderWebCreationDraft,
  WonderWebCreationStatus,
  WonderWebCreationType,
  WonderWebError,
  WonderWebFile,
  WonderWebLogLine,
  WonderWebProducer,
  WonderWebRuntimeType,
  WonderWebSchemaVersion,
} from './wonder-web-contracts';

export {
  WONDER_WEB_ALL_STATUSES,
  WONDER_WEB_EDGES,
  WONDER_WEB_MAX_ERRORS,
  WONDER_WEB_MAX_LOG_LINES,
  appendWonderWebLogs,
  beginWonderWebBuild,
  beginWonderWebPreparation,
  completeWonderWebBuild,
  createWonderWebCreation,
  failWonderWebCreation,
  isLegalWonderWebTransition,
  isSafeCreationPath,
  rebuildWonderWebCreation,
  startWonderWebRun,
  stopWonderWebRun,
} from './wonder-web-lifecycle';
export type { CreateWonderWebCreationInput } from './wonder-web-lifecycle';

export {
  WONDER_WEB_CONTROL_ACTIONS,
  WONDER_WEB_ISOLATION_PROFILES,
  WONDER_WEB_NO_CAPABILITIES,
  authorizeWonderWebAction,
  authorizeWonderWebRun,
  decideAllWonderWebCapabilities,
  decideWonderWebCapability,
  wonderWebAccessFor,
} from './wonder-web-sandbox';
export type {
  WonderWebAccess,
  WonderWebCapabilityDecision,
  WonderWebCapabilityGrant,
  WonderWebControlAction,
  WonderWebIsolationProfile,
  WonderWebRunAuthorization,
} from './wonder-web-sandbox';

export {
  readWonderWebCreation,
  sealWonderWebCreation,
  verifyWonderWebChecksum,
  wonderWebDraftFrom,
} from './wonder-web-record';
export type { WonderWebReadResult } from './wonder-web-record';

export { createWonderWebStore } from './wonder-web-store';
export type { WonderWebStorePort, WonderWebWriteResult } from './wonder-web-store';

export {
  WONDER_WEB_DOT_TOKENS,
  WONDER_WEB_IDLE_MARK,
  WONDER_WEB_TERMINAL_PROMPT,
  WONDER_WEB_TITLE,
  projectWonderWebSurface,
  wonderWebDotToken,
} from './wonder-web-surface';
export type {
  WonderWebAddress,
  WonderWebChrome,
  WonderWebPeer,
  WonderWebSurface,
  WonderWebSurfaceInput,
  WonderWebTab,
  WonderWebTerminalLine,
  WonderWebTerminalPanel,
  WonderWebViewport,
} from './wonder-web-surface';
