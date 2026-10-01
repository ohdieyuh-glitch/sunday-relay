import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BrowserSessionStore } from './browser-session/grants';
import { sessionTokenFrom } from './browser-session/routes';
import { waitForProjectBrainWake, type ProjectBrainWakeups } from './project-brain/brain-wakeups';
import {
  decodeProjectBrainCursor,
  encodeProjectBrainCursor,
  parseProjectBrainMutation,
  parseProjectBrainRef,
  projectBrainCapabilitiesFor,
  type ProjectBrainCapability,
  type ProjectBrainCursor,
  type ProjectBrainMutationCommand,
  type ProjectBrainProvenance,
} from '../src/relay/mission/project-brain/project-brain';
import type { PbSlotRow } from '../src/relay/mission/project-brain/project-brain-document';
import {
  projectBrainCompanionContext,
  projectWonderlandBrainView,
  wonderlandProposeDomainFor,
  wonderlandSurfaceIsReviewable,
} from '../src/relay/mission/project-brain/project-brain-views';
import type { ProjectBrainMutationOutcome, ProjectBrainPostgresStore } from '../src/relay/persistence/project-brain-postgres';

/**
 * THE PROJECT BRAIN OVER HTTP: ONE BRAIN, TWO DOORS.
 *
 *   /project-brain/projects/<projectId>[/...]   the OPERATOR door: bearer credential
 *       plus `x-relay-tenant`, whose membership row in the project decides what
 *       it may do. The companion channel is here too (`x-relay-companion`).
 *   /wonderland/brain[/...]                      the WONDERLAND door: a signed-in
 *       player's session; the player's membership row decides.
 *
 * Both read and write the same store Julius reads during a mission. Neither door
 * holds state of its own, and neither believes a client about who it is: the
 * author of a change comes from the credential, the deliverer from the door.
 *
 * NOT FOUND AND NOT YOURS LOOK THE SAME. A project the caller is not a member of
 * answers exactly like one that does not exist, so a guessed id learns nothing.
 *
 * WITHOUT A DATABASE, BOTH DOORS ANSWER 503 and name the variable. There is no
 * in-memory Project Brain to fall back to, on purpose.
 */

export interface ProjectBrainRouteResult {
  readonly status: number;
  readonly body: unknown;
}

export interface ProjectBrainRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` stripped. */
  readonly path: string;
  /** Path and query with `/relay-api` stripped. */
  readonly url: string;
  readonly authorization: string | undefined;
  readonly origin: string | undefined;
  /** True only when the bearer credential matched the operator token. */
  readonly operator: boolean;
  readonly tenantId: string | undefined;
  readonly companionId: string | undefined;
  readonly lastEventId: string | undefined;
  /** The raw body, parsed here so a malformed one is a clean 400. */
  readonly rawBody: string | undefined;
  readonly now: number;
}

/** A native (desktop) Wonderland session, when this bridge can verify one. */
export type NativeWonderlandSessionVerifier = (input: { readonly token: string; readonly now: number }) =>
  { readonly playerId: string; readonly projectId: string; readonly sessionId: string } | null;

export interface ProjectBrainRoutePorts {
  readonly store: ProjectBrainPostgresStore | null;
  readonly wakeups: ProjectBrainWakeups | null;
  readonly missingConfig: readonly string[];
  readonly sessions: BrowserSessionStore;
  /** Absent on a bridge with no native pairing: an originless Wonderland call is then refused. */
  readonly verifyNativeSession?: NativeWonderlandSessionVerifier;
  /** Per-role served-model topology for a project's newest missions. */
  readonly slots?: (projectId: string, tenantId: string, runIds: readonly string[]) => Promise<readonly PbSlotRow[]>;
  readonly heartbeatMs?: number;
  readonly maxWaitMs?: number;
}

export interface ProjectBrainStreamIo {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly headers: Readonly<Record<string, string>>;
}

const ok = (data: unknown, status = 200): ProjectBrainRouteResult => ({ status, body: { data } });
const err = (status: number, kind: string, message: string, extra: Record<string, unknown> = {}): ProjectBrainRouteResult =>
  ({ status, body: { error: { kind, message, ...extra } } });

const NOT_FOUND = () => err(404, 'project_not_found', 'No such project.');
const PROJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/u;
const ACTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/u;

const OPERATOR_PATH = /^\/project-brain\/projects\/([^/]+)(?:\/([a-z-]+))?$/u;
const LEGACY_WONDERLAND_BRAIN = /^\/wonderland\/projects\/([^/]+)\/brain$/u;

export function isProjectBrainRoute(path: string): boolean {
  return path === '/project-brain' || path.startsWith('/project-brain/')
    || path === '/wonderland/brain' || path.startsWith('/wonderland/brain/')
    || LEGACY_WONDERLAND_BRAIN.test(path);
}

const decode = (segment: string): string | null => {
  try { return decodeURIComponent(segment); } catch { return null; }
};

function parseJson(raw: string | undefined): { ok: true; value: unknown } | { ok: false } {
  if (raw === undefined || raw.trim() === '') return { ok: true, value: undefined };
  try { return { ok: true, value: JSON.parse(raw) as unknown }; } catch { return { ok: false }; }
}

function mutationAnswer(outcome: ProjectBrainMutationOutcome): ProjectBrainRouteResult {
  if (outcome.ok) return ok({ durable: true, replayed: outcome.replayed, ...outcome.result }, outcome.replayed ? 200 : 201);
  return err(outcome.status, outcome.code, outcome.message, { durable: outcome.durable, ...(outcome.details ?? {}) });
}

/* ------------------------------------------------------------- callers */

interface Caller {
  readonly projectId: string;
  readonly provenance: ProjectBrainProvenance;
  readonly capabilities: readonly ProjectBrainCapability[];
  /** The member whose identity scopes reads that go through Julius's API. */
  readonly tenantId: string;
}

async function membershipCapabilities(store: ProjectBrainPostgresStore, projectId: string, playerId: string): Promise<readonly ProjectBrainCapability[]> {
  return projectBrainCapabilitiesFor(await store.membershipRole({ projectId, playerId }));
}

/** A signed-in player: a browser control session (with Origin) or a native session (without). */
type WonderlandIdentity =
  | { readonly kind: 'player'; readonly playerId: string; readonly sessionId: string; readonly boundProjectId: string | null }
  | { readonly kind: 'refused'; readonly result: ProjectBrainRouteResult };

function wonderlandIdentity(request: ProjectBrainRouteRequest, ports: ProjectBrainRoutePorts): WonderlandIdentity {
  const refused = (result: ProjectBrainRouteResult): WonderlandIdentity => ({ kind: 'refused', result });
  const token = sessionTokenFrom(request.authorization);
  if (token === null) return refused(err(401, 'sign_in_required', 'Sign in to Wonderland to read or change its Project Brain.'));
  if (request.origin !== undefined) {
    const verified = ports.sessions.verifySession({ token, origin: request.origin, now: request.now });
    if (!verified.ok || verified.scope !== 'browser_control' || verified.participantId === null) {
      return refused(err(401, 'sign_in_required', 'This session does not act as a signed-in player.'));
    }
    return { kind: 'player', playerId: verified.participantId, sessionId: verified.sessionId, boundProjectId: null };
  }
  if (ports.verifyNativeSession === undefined) {
    return refused(err(401, 'native_session_unavailable', 'This bridge does not pair desktop clients; use a signed-in browser session.'));
  }
  const native = ports.verifyNativeSession({ token, now: request.now });
  if (native === null) return refused(err(401, 'sign_in_required', 'This desktop session is not valid. Pair again from the Wonderland website.'));
  return { kind: 'player', playerId: native.playerId, sessionId: native.sessionId, boundProjectId: native.projectId };
}

async function wonderlandCaller(request: ProjectBrainRouteRequest, ports: ProjectBrainRoutePorts, store: ProjectBrainPostgresStore, projectId: string):
  Promise<{ ok: true; caller: Caller } | { ok: false; result: ProjectBrainRouteResult }> {
  const identity = wonderlandIdentity(request, ports);
  if (identity.kind === 'refused') return { ok: false, result: identity.result };
  // A desktop session is bound to the project it was paired for and to nothing else.
  if (identity.boundProjectId !== null && identity.boundProjectId !== projectId) return { ok: false, result: NOT_FOUND() };
  const capabilities = await membershipCapabilities(store, projectId, identity.playerId);
  if (!capabilities.includes('brain:read')) return { ok: false, result: NOT_FOUND() };
  return {
    ok: true,
    caller: {
      projectId, capabilities, tenantId: identity.playerId,
      provenance: {
        author: { kind: 'WONDERLAND_PLAYER', id: identity.playerId },
        deliverer: { kind: 'WONDERLAND_CLIENT', id: `wonderland-session:${identity.sessionId}` },
      },
    },
  };
}

async function operatorCaller(request: ProjectBrainRouteRequest, store: ProjectBrainPostgresStore, projectId: string, companion: boolean):
  Promise<{ ok: true; caller: Caller } | { ok: false; result: ProjectBrainRouteResult }> {
  if (!request.operator) return { ok: false, result: err(401, 'operator_required', 'The Project Brain operator surface requires operator authentication.') };
  const tenantId = request.tenantId;
  if (tenantId === undefined || !ACTOR_ID.test(tenantId)) {
    return { ok: false, result: err(400, 'tenant_required', 'Name the tenant (x-relay-tenant) whose membership this request acts under.') };
  }
  const capabilities = await membershipCapabilities(store, projectId, tenantId);
  if (!capabilities.includes('brain:read')) return { ok: false, result: NOT_FOUND() };
  if (companion) {
    const companionId = request.companionId;
    if (companionId === undefined || !ACTOR_ID.test(companionId)) {
      return { ok: false, result: err(400, 'companion_required', 'Name the companion (x-relay-companion) this result comes from.') };
    }
    return {
      ok: true,
      caller: {
        projectId, capabilities, tenantId,
        provenance: { author: { kind: 'COMPANION', id: companionId }, deliverer: { kind: 'COMPANION_CHANNEL', id: 'relay-bridge:companion-channel' } },
      },
    };
  }
  return {
    ok: true,
    caller: {
      projectId, capabilities, tenantId,
      provenance: { author: { kind: 'FOUNDER', id: tenantId }, deliverer: { kind: 'OPERATOR_API', id: 'relay-bridge:operator' } },
    },
  };
}

/* ---------------------------------------------------------------- feed */

function cursorFrom(request: ProjectBrainRouteRequest, query: URLSearchParams, store: ProjectBrainPostgresStore, projectId: string):
  Promise<ProjectBrainCursor | null> {
  const stated = query.get('cursor') ?? request.lastEventId ?? null;
  if (stated === 'head') return store.head(projectId);
  return Promise.resolve(decodeProjectBrainCursor(stated));
}

async function pageFeed(input: {
  store: ProjectBrainPostgresStore; wakeups: ProjectBrainWakeups | null; projectId: string; cursor: ProjectBrainCursor;
  runId: string | null; waitMs: number;
}): Promise<ProjectBrainRouteResult> {
  let page = await input.store.eventsAfter({ projectId: input.projectId, cursor: input.cursor, runId: input.runId });
  if (page.events.length === 0 && input.waitMs > 0) {
    await waitForProjectBrainWake(input.wakeups, input.projectId, input.waitMs);
    page = await input.store.eventsAfter({ projectId: input.projectId, cursor: page.cursor, runId: input.runId });
  }
  return ok({
    events: page.events,
    cursor: encodeProjectBrainCursor(page.cursor),
    listening: input.wakeups?.listening ?? false,
  });
}

/**
 * SERVER-SENT EVENTS. Replays from the cursor, then follows: each wake-up is a
 * re-read of the durable log, and each event's SSE id IS the cursor after it, so
 * a browser's automatic reconnect (`Last-Event-ID`) resumes exactly there.
 * A store error does not end the stream; it is announced and retried.
 */
async function streamFeed(io: ProjectBrainStreamIo, input: {
  store: ProjectBrainPostgresStore; wakeups: ProjectBrainWakeups | null; projectId: string; cursor: ProjectBrainCursor;
  runId: string | null; heartbeatMs: number;
}): Promise<void> {
  const { response, request } = io;
  response.writeHead(200, {
    ...io.headers, 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no',
  });
  const abort = new AbortController();
  const close = () => abort.abort();
  request.once('close', close);
  response.once('close', close);
  const write = (chunk: string) => { if (!response.writableEnded && !abort.signal.aborted) response.write(chunk); };
  let cursor = input.cursor;
  write(`retry: 3000\nevent: project_brain.ready\ndata: ${JSON.stringify({ cursor: encodeProjectBrainCursor(cursor), listening: input.wakeups?.listening ?? false })}\n\n`);
  while (!abort.signal.aborted) {
    try {
      const page = await input.store.eventsAfter({ projectId: input.projectId, cursor, runId: input.runId });
      for (const event of page.events) write(`id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      cursor = page.cursor;
      if (page.events.length > 0) continue;
    } catch {
      write(`event: project_brain.unavailable\ndata: ${JSON.stringify({ cursor: encodeProjectBrainCursor(cursor) })}\n\n`);
    }
    const how = await waitForProjectBrainWake(input.wakeups, input.projectId, input.heartbeatMs, abort.signal);
    if (how === 'timeout') write(': heartbeat\n\n');
  }
  request.off('close', close);
  if (!response.writableEnded) response.end();
}

/* -------------------------------------------------------------- handler */

export async function handleProjectBrainRoute(
  request: ProjectBrainRouteRequest,
  ports: ProjectBrainRoutePorts,
  io: ProjectBrainStreamIo,
): Promise<ProjectBrainRouteResult | 'streaming' | null> {
  if (!isProjectBrainRoute(request.path)) return null;
  const store = ports.store;
  if (store === null) {
    return err(503, 'project_brain_unavailable',
      `No durable Project Brain is reachable from this process: ${ports.missingConfig.join(', ')} is not set. This is not an empty brain -- nothing was read.`);
  }
  const url = new URL(request.url, 'http://relay.invalid');
  const query = url.searchParams;
  const heartbeatMs = ports.heartbeatMs ?? 15_000;
  const maxWaitMs = ports.maxWaitMs ?? 25_000;
  const waitMs = Math.max(0, Math.min(Number(query.get('waitMs') ?? '0') || 0, maxWaitMs));
  const runIdQuery = query.get('runId');
  if (runIdQuery !== null && !RUN_ID.test(runIdQuery)) return err(400, 'run_invalid', 'runId is not a run id.');
  const runId = runIdQuery;
  const body = parseJson(request.rawBody);
  if (!body.ok) return err(400, 'body_invalid', 'The body is not valid JSON.');

  try {
    /* ------------------------------------------ the operator door */
    const operatorMatch = OPERATOR_PATH.exec(request.path);
    if (operatorMatch !== null) {
      const projectId = decode(operatorMatch[1] ?? '');
      if (projectId === null || !PROJECT_ID.test(projectId)) return NOT_FOUND();
      const view = operatorMatch[2] ?? '';
      const companion = view === 'companion-results' || (view === 'companion-context' && request.companionId !== undefined);
      const resolved = await operatorCaller(request, store, projectId, companion);
      if (!resolved.ok) return resolved.result;
      const caller = resolved.caller;
      const slots = ports.slots === undefined ? undefined : (runIds: readonly string[]) => ports.slots!(projectId, caller.tenantId, runIds);

      if (view === '' && request.method === 'GET') {
        const document = await store.readDocument({ projectId, runId, slots });
        return document === null ? NOT_FOUND() : ok(document);
      }
      if (view === 'events' && request.method === 'GET') {
        const cursor = await cursorFrom(request, query, store, projectId);
        if (cursor === null) return err(400, 'cursor_invalid', 'The cursor is not one this feed issued.');
        if (query.get('mode') === 'sse') {
          await streamFeed(io, { store, wakeups: ports.wakeups, projectId, cursor, runId, heartbeatMs });
          return 'streaming';
        }
        return pageFeed({ store, wakeups: ports.wakeups, projectId, cursor, runId, waitMs });
      }
      if (view === 'mutations' && request.method === 'POST') {
        const parsed = parseProjectBrainMutation(body.value);
        if (!parsed.ok) return err(parsed.status, parsed.code, parsed.message, { durable: false });
        return mutationAnswer(await store.mutate({ projectId, provenance: caller.provenance, capabilities: caller.capabilities, command: parsed.command }));
      }
      if (view === 'companion-context' && request.method === 'GET') {
        if (runId === null) return err(400, 'run_required', 'A companion receives one mission\'s context: name its runId.');
        const document = await store.readDocument({ projectId, runId });
        const context = document === null ? null : projectBrainCompanionContext(document, runId);
        return context === null ? err(404, 'run_not_found', 'No such mission in this project.') : ok(context);
      }
      if (view === 'companion-results' && request.method === 'POST') {
        const raw = body.value !== null && typeof body.value === 'object' && !Array.isArray(body.value) ? body.value as Record<string, unknown> : null;
        if (raw === null) return err(400, 'body_invalid', 'A companion result is a JSON object.');
        const allowed = ['idempotencyKey', 'runId', 'title', 'body', 'links'];
        const unknown = Object.keys(raw).filter((key) => !allowed.includes(key));
        if (unknown.length > 0) return err(422, 'unknown_field', `Unknown field(s): ${unknown.sort().join(', ')}.`, { durable: false });
        const parsed = parseProjectBrainMutation({ operation: 'CREATE', domain: 'COMPANION_RESULT', scope: 'MISSION', ...raw });
        if (!parsed.ok) return err(parsed.status, parsed.code, parsed.message, { durable: false });
        return mutationAnswer(await store.mutate({ projectId, provenance: caller.provenance, capabilities: caller.capabilities, command: parsed.command }));
      }
      if (view === 'julius-context' && request.method === 'GET') {
        if (runId === null) return err(400, 'run_required', 'Julius reads Project Brain per mission: name its runId.');
        const document = await store.readDocument({ projectId, runId });
        if (document === null) return err(404, 'run_not_found', 'No such mission in this project.');
        return ok({ projectId, runId, entries: await store.contextEntriesForRun(runId, projectId) });
      }
      return err(404, 'unknown_project_brain_route',
        'The operator Project Brain serves GET /project-brain/projects/<id>[/events|/companion-context|/julius-context] and POST [/mutations|/companion-results].');
    }

    /* ----------------------------------------- the Wonderland door */
    const legacy = LEGACY_WONDERLAND_BRAIN.exec(request.path);
    const bodyRecord = body.value !== null && typeof body.value === 'object' && !Array.isArray(body.value) ? body.value as Record<string, unknown> : {};
    const projectIdRaw = legacy !== null ? decode(legacy[1] ?? '') : (query.get('projectId') ?? (typeof bodyRecord.projectId === 'string' ? bodyRecord.projectId : null));
    if (projectIdRaw === null || !PROJECT_ID.test(projectIdRaw)) return err(400, 'project_required', 'Name the projectId whose Project Brain this is.');
    const projectId = projectIdRaw;
    const resolved = await wonderlandCaller(request, ports, store, projectId);
    if (!resolved.ok) return resolved.result;
    const caller = resolved.caller;
    const slots = ports.slots === undefined ? undefined : (runIds: readonly string[]) => ports.slots!(projectId, caller.tenantId, runIds);

    // The old in-memory route, now answered by the one Project Brain.
    if (legacy !== null) {
      if (request.method !== 'GET') return err(405, 'method_not_allowed', 'The Project Brain document is read with GET.');
      const document = await store.readDocument({ projectId, slots });
      return document === null ? NOT_FOUND() : ok(document);
    }
    const sub = request.path.slice('/wonderland/brain'.length);
    if (sub === '' && request.method === 'GET') {
      const document = await store.readDocument({ projectId, runId, slots });
      if (document === null) return NOT_FOUND();
      return ok(query.get('view') === 'document' ? document : projectWonderlandBrainView(document));
    }
    if (sub === '/events' && request.method === 'GET') {
      const cursor = await cursorFrom(request, query, store, projectId);
      if (cursor === null) return err(400, 'cursor_invalid', 'The cursor is not one this feed issued.');
      if (query.get('mode') === 'sse') {
        await streamFeed(io, { store, wakeups: ports.wakeups, projectId, cursor, runId, heartbeatMs });
        return 'streaming';
      }
      return pageFeed({ store, wakeups: ports.wakeups, projectId, cursor, runId, waitMs });
    }
    if (request.method !== 'POST') return err(404, 'unknown_project_brain_route', 'Wonderland reads /wonderland/brain and /wonderland/brain/events.');

    let command: ProjectBrainMutationCommand;
    if (sub === '/proposals') {
      const surfaceId = typeof bodyRecord.surfaceId === 'string' ? bodyRecord.surfaceId : '';
      const domain = wonderlandProposeDomainFor(surfaceId);
      if (domain === null) return err(403, 'surface_not_yours', 'Nothing may be proposed on that surface.', { durable: false });
      const text = typeof bodyRecord.text === 'string' ? bodyRecord.text.trim() : '';
      const firstLine = text.split('\n')[0]?.trim() ?? '';
      const title = firstLine.length > 200 ? `${firstLine.slice(0, 199)}…` : firstLine;
      const proposalRun = typeof bodyRecord.runId === 'string' ? bodyRecord.runId : null;
      const parsed = parseProjectBrainMutation({
        operation: 'CREATE', idempotencyKey: bodyRecord.idempotencyKey, domain,
        scope: proposalRun === null ? 'PROJECT' : 'MISSION', runId: proposalRun,
        title, body: title === text ? '' : text,
      });
      if (!parsed.ok) return err(parsed.status, parsed.code, parsed.message, { durable: false });
      command = parsed.command;
    } else if (sub === '/reviews') {
      const surfaceId = typeof bodyRecord.surfaceId === 'string' ? bodyRecord.surfaceId : '';
      if (!wonderlandSurfaceIsReviewable(surfaceId)) return err(403, 'surface_not_reviewable', 'Nothing on that surface is reviewed.', { durable: false });
      const entryRef = bodyRecord.entryRef;
      const ref = parseProjectBrainRef(entryRef);
      if (ref === null || (ref.type !== 'entry' && ref.type !== 'claim')) {
        return err(422, 'ref_invalid', 'A review names the memory it reviews (entry:<id> or claim:<id>).', { durable: false });
      }
      const verdict = bodyRecord.verdict === 'ACCEPT' ? 'ACCEPTED' : bodyRecord.verdict === 'DECLINE' ? 'DECLINED' : null;
      if (verdict === null) return err(422, 'verdict_required', 'verdict is ACCEPT or DECLINE.', { durable: false });
      const parsed = parseProjectBrainMutation({
        operation: 'CREATE', idempotencyKey: bodyRecord.idempotencyKey, domain: 'MEMORY_REVIEW', scope: 'PROJECT',
        title: `${verdict} ${String(entryRef)}`.slice(0, 200), body: '', subjectRef: entryRef, verdict,
        links: [{ relation: 'REVIEWS', toRef: entryRef }],
      });
      if (!parsed.ok) return err(parsed.status, parsed.code, parsed.message, { durable: false });
      command = parsed.command;
    } else if (sub === '/mutations') {
      // The project is the door's (query string), never a field of the change.
      const parsed = parseProjectBrainMutation(Object.fromEntries(Object.entries(bodyRecord).filter(([key]) => key !== 'projectId')));
      if (!parsed.ok) return err(parsed.status, parsed.code, parsed.message, { durable: false });
      command = parsed.command;
    } else {
      return err(404, 'unknown_project_brain_route', 'Wonderland writes to /wonderland/brain/proposals, /reviews and /mutations.');
    }
    return mutationAnswer(await store.mutate({ projectId, provenance: caller.provenance, capabilities: caller.capabilities, command }));
  } catch {
    // The database could not answer. A read says so -- never as an empty brain --
    // and a write says nothing was saved, because nothing was.
    if (request.method === 'POST') {
      return err(503, 'project_brain_unavailable', 'The Project Brain could not be reached. Nothing was saved; retry with the same idempotency key.', { durable: false });
    }
    return err(503, 'project_brain_read_failed', 'The Project Brain could not be read just now. Nothing is wrong with your request; retry.');
  }
}
