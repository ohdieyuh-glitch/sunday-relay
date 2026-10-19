/**
 * WONDER WEB — the Node-side barrel.
 *
 * The runtime that materializes, builds, serves and stops a creation. Everything
 * here is Node: disk, processes, sockets. The decisions all live on the other
 * side of the boundary, in `src/relay/mission/wonder-web`, and this side drives
 * them rather than duplicating them — which is why a READY cannot be minted
 * here even by accident.
 */

export {
  WONDER_WEB_BIND_HOST,
  WONDER_WEB_CONTENT_SECURITY_POLICY,
  WONDER_WEB_PERMISSIONS_POLICY,
  resolveWithinRoot,
  serveWonderWebCreation,
  wonderWebMediaType,
} from './creation-sandbox-server';
export type {
  WonderWebRunningServer,
  WonderWebServedCreation,
} from './creation-sandbox-server';

export {
  WONDER_WEB_BUILD_TIMEOUT_MS,
  WONDER_WEB_OUTPUT_LIMIT_BYTES,
  WONDER_WEB_ROOT_DIRNAME,
  buildWonderWebCreation,
  closeWonderWebCreation,
  discardWonderWebFiles,
  materializeWonderWebSources,
  openWonderWebCreation,
  resolveWonderWebPaths,
  runWonderWebBuild,
} from './wonder-web-runtime';
export type {
  WonderWebBuildPlan,
  WonderWebRunHandle,
  WonderWebRuntimePaths,
} from './wonder-web-runtime';
