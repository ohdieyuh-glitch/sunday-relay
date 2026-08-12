import type { ReviewerRouteResult } from './reviewer-routes';
import type { RepositoryCaller } from './repository-routes';
import { validateMissionConfig } from '../src/relay/mission/mission-config';
import type { PspConfigStore, SavedPsp } from '../src/relay/persistence';

/**
 * SAVED PSP PROFILES — the routes a signed-in user manages their configuration
 * through. A PSP is CONFIGURATION (a named {@link RelayMissionConfig}), never a
 * second Mission engine: saving one records a config a later Mission start may
 * carry, and loading one returns that config to fill the form.
 *
 * PARTICIPANT-OWNED. The owner comes from the VERIFIED session, never the body,
 * so a browser can only ever save, list, or load PSPs as itself. The operator
 * has no participant identity here and so manages no PSPs — this surface belongs
 * to beta users. A malformed config is refused (never coerced) so a PSP can
 * never store a spend ceiling that is not a real number.
 */

const ok = (data: unknown): ReviewerRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): ReviewerRouteResult =>
  ({ status, body: { error: { kind, message } } });

const PSP_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isPspRoute(path: string): boolean {
  return path === '/psp' || path.startsWith('/psp/');
}

const summarize = (p: SavedPsp) => ({ pspId: p.pspId, name: p.name, updatedAt: p.updatedAt, mode: p.config.mode });

export interface PspRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  readonly body: unknown;
  /** The server's clock — stamps `updatedAt`. */
  readonly now: string;
  /** Resolved from the verified session; PSPs belong to a participant. */
  readonly caller: RepositoryCaller;
}

export function handlePspRoute(
  request: PspRouteRequest,
  store: PspConfigStore | null,
): ReviewerRouteResult | null {
  if (!isPspRoute(request.path)) return null;

  // A PSP belongs to a participant. The operator holds no PSPs (no participant
  // identity), and an anonymous caller holds none either.
  if (request.caller.kind !== 'participant') {
    return err(401, 'authentication_failed', 'Managing a PSP requires a signed-in participant.');
  }
  if (store === null) {
    return err(503, 'psp_store_unavailable', 'No durable state root is mounted, so no PSP can be saved.');
  }
  const owner = request.caller.participantId;

  /* ----------------------------------------------------------- save a PSP */
  if (request.method === 'POST' && request.path === '/psp') {
    if (request.body === null || typeof request.body !== 'object') {
      return err(422, 'validation_failed', 'A PSP object is required.');
    }
    const body = request.body as { pspId?: unknown; name?: unknown; config?: unknown };
    const pspId = typeof body.pspId === 'string' ? body.pspId.trim() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!PSP_ID.test(pspId)) {
      return err(422, 'validation_failed', 'A PSP needs a pspId matching ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$.');
    }
    if (name === '') {
      return err(422, 'validation_failed', 'A PSP needs a non-empty name.');
    }
    const config = validateMissionConfig(body.config ?? {});
    if (!config.ok) {
      return err(422, 'psp_config_invalid', config.error.message);
    }
    store.save({ pspId, name, ownerParticipant: owner, config: config.value, updatedAt: request.now });
    return ok({ saved: true, pspId, name });
  }

  /* ------------------------------------------------------- list my PSPs */
  if (request.method === 'GET' && request.path === '/psp') {
    return ok({ psps: store.list(owner).map(summarize) });
  }

  /* -------------------------------------------------------- load one PSP */
  if (request.method === 'GET' && request.path.startsWith('/psp/')) {
    const pspId = decodeURIComponent(request.path.slice('/psp/'.length));
    if (!PSP_ID.test(pspId)) {
      return err(404, 'psp_not_found', 'No such PSP.');
    }
    const psp = store.load(owner, pspId);
    if (psp === null) {
      return err(404, 'psp_not_found', 'No such PSP.');
    }
    // The full config, so the caller can start a mission under it.
    return ok({ pspId: psp.pspId, name: psp.name, config: psp.config, updatedAt: psp.updatedAt });
  }

  return err(404, 'unknown_psp_route', 'No such PSP route.');
}
