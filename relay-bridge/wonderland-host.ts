import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WonderlandEvent } from '../src/relay/wonderland';
import { WonderlandDomainError, WonderlandService } from '../src/relay/wonderland';
import type { WonderlandCompetitionOrchestrator } from '../src/relay/wonderland';

export const WONDERLAND_PREFIX = '/relay-api/wonderland';
export interface WonderlandPrincipal { playerId: string; projectRoles: Readonly<Record<string, 'OWNER' | 'MEMBER' | 'SPECTATOR'>>; agentIds: readonly string[]; cardIds: readonly string[]; }
export interface WonderlandAuthorizer { authenticate(authorization: string | undefined, origin: string | undefined): WonderlandPrincipal | null; }
export interface WonderlandHostMetrics { activeSubscriptions: number; reconnects: number; replayedEvents: number; backpressureDisconnects: number; authorizationDenials: number; malformedCursors: number; }
export interface WonderlandHost { service: WonderlandService; authorizer: WonderlandAuthorizer; orchestrator?: WonderlandCompetitionOrchestrator; metrics: WonderlandHostMetrics; maxSubscriptionsPerPlayer: number; }

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string>) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
const member = (principal: WonderlandPrincipal, projectId: string) => principal.projectRoles[projectId] ?? null;
const visible = (event: WonderlandEvent, principal: WonderlandPrincipal, service: WonderlandService): boolean => {
  const role = member(principal, event.projectId); if (role === null) return false;
  if (event.visibility === 'PUBLIC') return true;
  if (event.visibility === 'PARTICIPANTS') { if (event.battleId === null) return role === 'OWNER' || role === 'MEMBER'; const battle = service.state().battles[event.battleId]; return battle !== undefined && [battle.challengerId, battle.opponentId].includes(principal.playerId); }
  return event.playerId === principal.playerId;
};

function cursorFrom(url: URL): number | null { const raw = url.searchParams.get('after') ?? '0'; if (!/^\d+$/.test(raw)) return null; const value = Number(raw); return Number.isSafeInteger(value) ? value : null; }
function bodyObject(body: unknown): Record<string, unknown> { return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}; }

export async function handleWonderlandRequest(input: { req: IncomingMessage; res: ServerResponse; method: string; url: URL; body?: unknown; origin?: string; cors: Record<string, string>; host: WonderlandHost; principal?: WonderlandPrincipal }): Promise<boolean> {
  const { req, res, method, url, host } = input; if (!url.pathname.startsWith(WONDERLAND_PREFIX)) return false;
  const principal = input.principal ?? host.authorizer.authenticate(typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined, input.origin);
  if (principal === null) { host.metrics.authorizationDenials++; json(res, 401, { kind: 'authentication_failed' }, input.cors); return true; }

  if (method === 'GET' && url.pathname === `${WONDERLAND_PREFIX}/events`) {
    const projectId = url.searchParams.get('projectId') ?? ''; const cursor = cursorFrom(url);
    if (cursor === null) { host.metrics.malformedCursors++; json(res, 400, { kind: 'invalid_cursor' }, input.cors); return true; }
    if (member(principal, projectId) === null) { host.metrics.authorizationDenials++; json(res, 403, { kind: 'project_access_denied' }, input.cors); return true; }
    if (host.metrics.activeSubscriptions >= host.maxSubscriptionsPerPlayer) { json(res, 429, { kind: 'subscription_rate_limited' }, input.cors); return true; }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no', ...input.cors });
    res.write(`event: connected\ndata: ${JSON.stringify({ schemaVersion: 1, after: cursor, heartbeatSeconds: 15 })}\n\n`);
    host.metrics.activeSubscriptions++; if (cursor > 0) host.metrics.reconnects++;
    let last = cursor; let closed = false; const replayCeiling = host.service.state().sequence;
    let subscription: { close(): void } | null = null;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    const close = () => { if (closed) return; closed = true; subscription?.close(); if (heartbeat !== null) clearInterval(heartbeat); host.metrics.activeSubscriptions--; };
    subscription = host.service.events.subscribe(cursor, (event) => {
      if (event.projectId !== projectId || !visible(event, principal, host.service) || event.sequence <= last || closed) return;
      const replay = event.sequence <= replayCeiling; last = event.sequence;
      if (replay) host.metrics.replayedEvents++;
      if (!res.write(`id: ${event.sequence}\nevent: wonderland\ndata: ${JSON.stringify(event)}\n\n`)) { host.metrics.backpressureDisconnects++; close(); res.destroy(); }
    });
    // Transport liveness only: this timer never reads or refreshes domain state.
    heartbeat = setInterval(() => { if (!res.write(`event: heartbeat\ndata: ${JSON.stringify({ at: new Date().toISOString(), sequence: last })}\n\n`)) { host.metrics.backpressureDisconnects++; close(); res.destroy(); } }, 15_000);
    heartbeat.unref();
    req.once('aborted', close); res.once('close', close); return true;
  }

  const body = bodyObject(input.body); const projectId = typeof body.projectId === 'string' ? body.projectId : '';
  if (member(principal, projectId) === null) { host.metrics.authorizationDenials++; json(res, 403, { kind: 'project_access_denied' }, input.cors); return true; }
  const key = typeof body.idempotencyKey === 'string' && body.idempotencyKey.length <= 200 ? `${principal.playerId}:${body.idempotencyKey}` : null;
  if (method === 'POST' && key === null) { json(res, 422, { kind: 'idempotency_key_required' }, input.cors); return true; }
  try {
    if (method === 'POST' && url.pathname === `${WONDERLAND_PREFIX}/challenges`) {
      const opponentId = typeof body.opponentId === 'string' ? body.opponentId : ''; const mode = body.mode === 'GOAL' ? 'GOAL' : body.mode === 'EVAL' ? 'EVAL' : null;
      if (!opponentId || mode === null || opponentId === principal.playerId) throw new WonderlandDomainError('Invalid challenge.');
      const agentId = typeof body.agentId === 'string' ? body.agentId : ''; const cardVersionId = typeof body.cardVersionId === 'string' ? body.cardVersionId : '';
      if (!principal.agentIds.includes(agentId) || !principal.cardIds.includes(cardVersionId)) { host.metrics.authorizationDenials++; json(res, 403, { kind: 'selection_not_owned' }, input.cors); return true; }
      const objective = typeof body.objective === 'string' ? body.objective : ''; if (mode === 'GOAL' && !objective) throw new WonderlandDomainError('Goal objective is required.');
      const battle = host.service.createBattle(key!, mode, projectId, principal.playerId, opponentId, { agentId, cardVersionId }, mode === 'GOAL' ? { objective, acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? body.acceptanceCriteria.filter((item): item is string => typeof item === 'string') : [], constraints: Array.isArray(body.constraints) ? body.constraints.filter((item): item is string => typeof item === 'string') : [], verificationRequirements: Array.isArray(body.verificationRequirements) ? body.verificationRequirements.filter((item): item is string => typeof item === 'string') : [] } : null); json(res, 201, { battle }, input.cors); return true;
    }
    const battleMatch = /^\/relay-api\/wonderland\/battles\/([^/]+)(?:\/(accept|decline|cancel|swarm|result))?$/.exec(url.pathname);
    if (battleMatch !== null) {
      const battleId = decodeURIComponent(battleMatch[1]); const action = battleMatch[2] ?? 'inspect'; const battle = host.service.state().battles[battleId]; if (!battle || ![battle.challengerId, battle.opponentId].includes(principal.playerId)) { host.metrics.authorizationDenials++; json(res, 403, { kind: 'battle_access_denied' }, input.cors); return true; }
      if (method === 'GET' && action === 'inspect') { json(res, 200, { battle }, input.cors); return true; }
      if (method === 'GET' && action === 'result') { if (!battle.result) { json(res, 409, { kind: 'result_not_ready' }, input.cors); return true; } json(res, 200, { result: battle.result }, input.cors); return true; }
      if (method === 'POST' && action === 'decline') { json(res, 200, { battle: host.service.declineBattle(key!, battleId, principal.playerId) }, input.cors); return true; }
      if (method === 'POST' && action === 'cancel') { json(res, 200, { battle: host.service.cancelBattle(key!, battleId, principal.playerId) }, input.cors); return true; }
      if (method === 'POST' && action === 'accept') { if (!host.orchestrator) { json(res, 503, { kind: 'orchestrator_unavailable' }, input.cors); return true; } const agentId = typeof body.agentId === 'string' ? body.agentId : ''; const cardVersionId = typeof body.cardVersionId === 'string' ? body.cardVersionId : ''; if (!principal.agentIds.includes(agentId) || !principal.cardIds.includes(cardVersionId)) { json(res, 403, { kind: 'selection_not_owned' }, input.cors); return true; } const accepted = battle.mode === 'GOAL' ? await host.orchestrator.acceptGoal(key!, battleId, principal.playerId, { agentId, cardVersionId }) : await host.orchestrator.acceptEval(key!, battleId, principal.playerId, { agentId, cardVersionId }); json(res, 200, accepted, input.cors); return true; }
      if (method === 'POST' && action === 'swarm') { if (!host.orchestrator) { json(res, 503, { kind: 'orchestrator_unavailable' }, input.cors); return true; } const roles = Array.isArray(body.roles) ? body.roles.filter((item): item is string => typeof item === 'string') : []; const results = await host.orchestrator.activateRealSwarm(key!, battleId, principal.playerId, roles, battle.challengeSpec?.objective ?? 'Evaluate the opposing C.A.R.D.'); json(res, 200, { results }, input.cors); return true; }
    }
    if (method === 'POST' && url.pathname === `${WONDERLAND_PREFIX}/presence/heartbeat`) {
      const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''; const session = host.service.heartbeatPresence(key!, sessionId, principal.playerId, 45_000); json(res, 200, { session }, input.cors); return true;
    }
    if (method === 'GET' && url.pathname === `${WONDERLAND_PREFIX}/brain`) { const brain = host.service.state().brains[projectId]; if (!brain) { json(res, 404, { kind: 'not_found' }, input.cors); return true; } json(res, 200, { brain }, input.cors); return true; }
    json(res, 404, { kind: 'unknown_wonderland_route' }, input.cors); return true;
  } catch (error) { json(res, error instanceof WonderlandDomainError ? 409 : 500, { kind: 'wonderland_command_refused', error: error instanceof WonderlandDomainError ? error.message : 'Wonderland command failed.' }, input.cors); return true; }
}

export function createWonderlandHost(service: WonderlandService, authorizer: WonderlandAuthorizer): WonderlandHost { return { service, authorizer, maxSubscriptionsPerPlayer: 32, metrics: { activeSubscriptions: 0, reconnects: 0, replayedEvents: 0, backpressureDisconnects: 0, authorizationDenials: 0, malformedCursors: 0 } }; }
