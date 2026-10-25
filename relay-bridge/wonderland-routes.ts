import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BrowserSessionStore } from './browser-session/grants';
import { sessionTokenFrom } from './browser-session/routes';
import { WonderlandBackend, type WonderlandExecutor } from '../src/relay/mission/wonderland/wonderland-backend';
import { isWonderlandCompanionAgentRoute, isWonderlandCompanionRoute } from './wonderland-companion-route';
import {
  WONDERLAND_ADMISSION_PATH,
  WONDERLAND_STATUS_PATH,
  isWonderlandAdmissionRoute,
  isWonderlandStatusRoute,
  wonderlandAdmissionPathname,
} from './wonderland-admission-route';
import { isWonderlandMissionReadRoute, wonderlandMissionRead } from './wonderland-mission-result-route';
import { isWonderlandMissionEventsRoute } from './wonderland-mission-events-route';
import { isWonderlandMissionStartRoute } from './wonderland-mission-start-route';

export interface WonderlandRouteRequest {
  readonly method: string; readonly path: string; readonly url: string;
  readonly authorization: string | undefined; readonly origin: string | undefined;
  readonly body: unknown; readonly now: number;
}

const asRecord = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (body: Record<string, unknown>, key: string): string => { const value = body[key]; if (typeof value !== 'string' || value.trim() === '') throw new Error(`invalid_${key}`); return value; };

/**
 * Every `/wonderland/` path except the Julius admission, status, result,
 * progress, companion, and companion-agent pathnames. A query on an exact
 * pathname stays on that route, because the handler reads `projectId` from
 * it. A trailing slash, a child segment, or a different case stays here. This
 * catch-all refuses a native session before it reads the path, so those
 * Julius reads cannot be served from inside it.
 */
export function isWonderlandRoute(path: string): boolean {
  const pathname = wonderlandAdmissionPathname(path);
  if (pathname === WONDERLAND_ADMISSION_PATH || pathname === WONDERLAND_STATUS_PATH) return false;
  if (isWonderlandMissionReadRoute(pathname)) return false;
  if (isWonderlandMissionEventsRoute(pathname)) return false;
  if (isWonderlandMissionStartRoute(pathname)) return false;
  if (isWonderlandCompanionRoute(pathname)) return false;
  if (isWonderlandCompanionAgentRoute(pathname)) return false;
  if (pathname === '/wonderland' || pathname.startsWith('/wonderland/')) return true;
  const folded = pathname.toLowerCase();
  if (isWonderlandCompanionRoute(folded)) return true;
  if (isWonderlandCompanionAgentRoute(folded)) return true;
  return folded === WONDERLAND_ADMISSION_PATH || folded.startsWith(`${WONDERLAND_ADMISSION_PATH}/`)
    || folded === WONDERLAND_STATUS_PATH || folded.startsWith(`${WONDERLAND_STATUS_PATH}/`)
    || /^\/wonderland\/julius\/missions\/[^/]+\/(result|progress|events|start)(\/.*)?$/.test(folded);
}

/**
 * Which path the catch-all should see.
 *
 * `bridgePath` is the bridge's normalized path: `/relay-api` removed, the
 * query removed, trailing slashes removed. `rawPath` keeps case, the query,
 * and trailing slashes. Admission matches the raw pathname, so a query is
 * admission and a trailing slash is not. Comparing the normalized bridge
 * path would turn that slash into the admission URL.
 */
export function classifyWonderlandDispatchPath(bridgePath: string, rawPath: string): {
  readonly catchAllPath: string | null;
  readonly exactAdmission: boolean;
  readonly exactStatus: boolean;
  readonly exactMissionResult: boolean;
  readonly exactMissionProgress: boolean;
  readonly exactMissionEvents: boolean;
  readonly exactMissionStart: boolean;
  readonly exactCompanion: boolean;
} {
  const classified = (
    over: {
      readonly catchAllPath?: string | null;
      readonly exactAdmission?: boolean;
      readonly exactStatus?: boolean;
      readonly exactMissionResult?: boolean;
      readonly exactMissionProgress?: boolean;
      readonly exactMissionEvents?: boolean;
      readonly exactMissionStart?: boolean;
      readonly exactCompanion?: boolean;
    } = {},
  ) => ({
    catchAllPath: over.catchAllPath ?? null,
    exactAdmission: over.exactAdmission ?? false,
    exactStatus: over.exactStatus ?? false,
    exactMissionResult: over.exactMissionResult ?? false,
    exactMissionProgress: over.exactMissionProgress ?? false,
    exactMissionEvents: over.exactMissionEvents ?? false,
    exactMissionStart: over.exactMissionStart ?? false,
    exactCompanion: over.exactCompanion ?? false,
  });
  if (isWonderlandAdmissionRoute(rawPath)) return classified({ exactAdmission: true });
  if (isWonderlandStatusRoute(rawPath)) return classified({ exactStatus: true });
  const missionRead = wonderlandMissionRead(rawPath);
  if (missionRead?.kind === 'result') return classified({ exactMissionResult: true });
  if (missionRead?.kind === 'progress') return classified({ exactMissionProgress: true });
  if (isWonderlandMissionEventsRoute(rawPath)) return classified({ exactMissionEvents: true });
  if (isWonderlandMissionStartRoute(rawPath)) return classified({ exactMissionStart: true });
  if (isWonderlandCompanionRoute(rawPath) || isWonderlandCompanionAgentRoute(rawPath)) {
    return classified({ exactCompanion: true });
  }
  const candidate = bridgePath === WONDERLAND_ADMISSION_PATH || bridgePath === WONDERLAND_STATUS_PATH
    || (!isWonderlandRoute(bridgePath) && isWonderlandRoute(rawPath))
    ? rawPath
    : bridgePath;
  return isWonderlandRoute(candidate)
    ? classified({ catchAllPath: candidate })
    : classified();
}

export async function handleWonderlandRoute(input: WonderlandRouteRequest, deps: {
  backend: WonderlandBackend; sessions: BrowserSessionStore; response: ServerResponse; request: IncomingMessage;
  executor?: WonderlandExecutor; heartbeatMs?: number;
}): Promise<{ status: number; body: unknown } | null> {
  if (!isWonderlandRoute(input.path)) return null;
  const token = sessionTokenFrom(input.authorization);
  const verified = token === null ? null : deps.sessions.verifySession({ token, origin: input.origin, now: input.now });
  if (verified === null || !verified.ok || verified.participantId === null) return { status: 401, body: { error: 'authenticated player identity required' } };
  // A NATIVE session's scope is the Julius world stream and nothing else (founder
  // decision, 2026-09-27). These routes WRITE -- challenges and presence -- so a
  // native client is refused here rather than admitted by accident. Letting the
  // desktop client post presence may well be wanted later; that is a decision to
  // widen `native_world` on purpose, not a default this route should grant.
  if (verified.scope === 'native_world') return { status: 403, body: { error: 'a native Wonderland session reaches only the Julius world stream' } };
  const playerId = verified.participantId;
  const body = asRecord(input.body);
  try {
    if (input.method === 'GET' && input.path === '/wonderland/events') {
      const url = new URL(input.url, 'http://relay.invalid'); const projectId = text(Object.fromEntries(url.searchParams), 'projectId'); const cursorText = url.searchParams.get('cursor'); const cursor = cursorText === null ? 0 : Number(cursorText); const battleId = url.searchParams.get('battleId') ?? undefined;
      const replay = deps.backend.eventsFor({ projectId, playerId, cursor, battleId });
      deps.response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      for (const event of replay) deps.response.write(`id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`);
      const unsubscribe = deps.backend.subscribe({ projectId, playerId, cursor: replay.at(-1)?.sequence ?? cursor, battleId }, event => { if (!deps.response.writableEnded) deps.response.write(`id: ${event.sequence}\nevent: ${event.eventType}\ndata: ${JSON.stringify(event)}\n\n`); });
      // A transport heartbeat keeps intermediaries from closing an otherwise
      // healthy SSE stream. It never reads state and is not polling.
      const heartbeat = setInterval(() => { if (!deps.response.writableEnded) deps.response.write(': heartbeat\n\n'); }, deps.heartbeatMs ?? 15_000);
      const close = () => { clearInterval(heartbeat); unsubscribe(); if (!deps.response.writableEnded) deps.response.end(); };
      input.method; deps.request.once('close', close); deps.response.once('close', close); return null;
    }
    if (input.method === 'POST' && input.path === '/wonderland/presence/join') return { status: 200, body: { data: deps.backend.joinPresence(playerId, text(body, 'commandId'), { projectId: text(body, 'projectId'), sessionId: verified.sessionId, nowMs: input.now, challengeAvailable: body.challengeAvailable !== false }) } };
    if (input.method === 'POST' && input.path === '/wonderland/presence/heartbeat') return { status: 200, body: { data: deps.backend.heartbeatPresence(playerId, verified.sessionId, input.now) } };
    if (input.method === 'POST' && input.path === '/wonderland/presence/leave') { deps.backend.leavePresence(playerId, verified.sessionId); return { status: 200, body: { data: { left: true } } }; }
    if (input.method === 'POST' && input.path === '/wonderland/challenges') return { status: 201, body: { data: deps.backend.createChallenge(playerId, text(body, 'commandId'), { projectId: text(body, 'projectId'), challengedId: text(body, 'challengedId'), challengerAgentId: text(body, 'challengerAgentId'), challengedAgentId: text(body, 'challengedAgentId'), challengerCardVersionId: text(body, 'challengerCardVersionId'), challengedCardVersionId: text(body, 'challengedCardVersionId'), mode: body.mode === 'EVAL' ? 'EVAL' : 'GOAL', objective: text(body, 'objective') }) } };
    const accept = input.path.match(/^\/wonderland\/challenges\/([^/]+)\/accept$/); if (input.method === 'POST' && accept) return { status: 200, body: { data: deps.backend.acceptChallenge(playerId, text(body, 'commandId'), decodeURIComponent(accept[1])) } };
    const swarm = input.path.match(/^\/wonderland\/battles\/([^/]+)\/swarm$/); if (input.method === 'POST' && swarm) { if (!deps.executor) return { status: 503, body: { error: 'execution port unavailable' } }; return { status: 200, body: { data: await deps.backend.activateSwarm(playerId, text(body, 'commandId'), decodeURIComponent(swarm[1]), deps.executor) } }; }
    const result = input.path.match(/^\/wonderland\/battles\/([^/]+)\/result$/); if (input.method === 'GET' && result) { const battle = deps.backend.snapshot().battles[decodeURIComponent(result[1])]; if (!battle || !battle.participantIds.includes(playerId)) return { status: 403, body: { error: 'permission denied' } }; return { status: 200, body: { data: battle.result } }; }
    const brain = input.path.match(/^\/wonderland\/projects\/([^/]+)\/brain$/); if (input.method === 'GET' && brain) { const projectId = decodeURIComponent(brain[1]); deps.backend.eventsFor({ projectId, playerId, cursor: Number.MAX_SAFE_INTEGER }); return { status: 200, body: { data: deps.backend.snapshot().brains[projectId] ?? null } }; }
    return { status: 404, body: { error: 'Wonderland route not found' } };
  } catch (error) { const message = error instanceof Error ? error.message : 'request_failed'; const denied = /permission|owned|foreign|stale/.test(message); return { status: denied ? 403 : 422, body: { error: message } }; }
}

