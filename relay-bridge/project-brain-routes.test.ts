import { describe, expect, it } from 'vitest';

import { createBrowserSessionStore } from './browser-session/grants';
import { handleProjectBrainRoute, type ProjectBrainRoutePorts, type ProjectBrainRouteRequest } from './project-brain-routes';
import type { ProjectBrainWakeups } from './project-brain/brain-wakeups';
import { encodeProjectBrainCursor } from '../src/relay/mission/project-brain/project-brain';

/**
 * THE PROJECT BRAIN DOORS, WITHOUT A DATABASE: the decisions the routes make
 * before and around the store. The store here is a recording fake; what the
 * store itself guarantees is proven against PostgreSQL in the real-postgres
 * suites.
 */

const NOW = 1_790_000_000_000;
const OPERATOR_REQUEST = (over: Partial<ProjectBrainRouteRequest> = {}): ProjectBrainRouteRequest => ({
  method: 'GET', path: '/project-brain/projects/prj-1', url: '/project-brain/projects/prj-1',
  authorization: 'Bearer op', origin: undefined, operator: true, tenantId: 'owner-1', companionId: undefined,
  lastEventId: undefined, rawBody: undefined, now: NOW, ...over,
});
const io = { request: {} as never, response: {} as never, headers: {} };

/** A wake-up source the test drives: `fire` wakes every follower of a project. */
function drivenWakeups() {
  const followers = new Map<string, Set<() => void>>();
  const wakeups: ProjectBrainWakeups & { fire(projectId: string): void } = {
    subscribe(projectId, wake) {
      const set = followers.get(projectId) ?? new Set();
      set.add(wake);
      followers.set(projectId, set);
      return () => { set.delete(wake); };
    },
    get listening() { return true; },
    close: async () => undefined,
    fire(projectId) { for (const wake of [...(followers.get(projectId) ?? [])]) wake(); },
  };
  return wakeups;
}

function fakeStore(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const store = {
    membershipRole: async ({ playerId }: { playerId: string }) => (playerId === 'owner-1' ? 'OWNER' : null),
    readDocument: async ({ projectId }: { projectId: string }) => ({ projectId }),
    head: async () => ({ 'run:a': 3 }),
    eventsAfter: async () => ({ events: [], cursor: { 'run:a': 3 } }),
    mutate: async () => ({ ok: true, durable: true, replayed: false, result: { mutationId: 'pbm:1' } }),
    contextEntriesForRun: async () => [],
    calls,
    ...over,
  };
  return store;
}

const ports = (store: unknown, wakeups: ProjectBrainWakeups | null = null): ProjectBrainRoutePorts => ({
  store: store as never, wakeups, missingConfig: [], sessions: createBrowserSessionStore(), maxWaitMs: 2_000,
});

describe('the operator door', () => {
  it('answers 503 by name when there is no durable Project Brain -- never an empty one', async () => {
    const result = await handleProjectBrainRoute(OPERATOR_REQUEST(), { store: null, wakeups: null, missingConfig: ['JULIUS_DATABASE_URL', 'DATABASE_URL'], sessions: createBrowserSessionStore() }, io);
    expect(result).toMatchObject({ status: 503, body: { error: { kind: 'project_brain_unavailable' } } });
    expect(JSON.stringify(result)).toContain('JULIUS_DATABASE_URL, DATABASE_URL is not set');
  });

  it('demands the operator credential and a tenant, and treats a non-member tenant like a missing project', async () => {
    expect(await handleProjectBrainRoute(OPERATOR_REQUEST({ operator: false }), ports(fakeStore()), io)).toMatchObject({ status: 401 });
    expect(await handleProjectBrainRoute(OPERATOR_REQUEST({ tenantId: undefined }), ports(fakeStore()), io)).toMatchObject({ status: 400 });
    expect(await handleProjectBrainRoute(OPERATOR_REQUEST({ tenantId: 'stranger' }), ports(fakeStore()), io)).toMatchObject({ status: 404, body: { error: { kind: 'project_not_found' } } });
    expect(await handleProjectBrainRoute(OPERATOR_REQUEST(), ports(fakeStore()), io)).toMatchObject({ status: 200, body: { data: { projectId: 'prj-1' } } });
  });

  it('refuses a malformed body, a forged cursor and an unknown view by name', async () => {
    expect(await handleProjectBrainRoute(OPERATOR_REQUEST({ method: 'POST', path: '/project-brain/projects/prj-1/mutations', rawBody: '{not json' }), ports(fakeStore()), io))
      .toMatchObject({ status: 400, body: { error: { kind: 'body_invalid' } } });
    expect(await handleProjectBrainRoute(OPERATOR_REQUEST({ path: '/project-brain/projects/prj-1/events', url: '/project-brain/projects/prj-1/events?cursor=pbc1.forged!' }), ports(fakeStore()), io))
      .toMatchObject({ status: 400, body: { error: { kind: 'cursor_invalid' } } });
    expect(await handleProjectBrainRoute(OPERATOR_REQUEST({ path: '/project-brain/projects/prj-1/nothing' }), ports(fakeStore()), io))
      .toMatchObject({ status: 404, body: { error: { kind: 'unknown_project_brain_route' } } });
  });

  it('a mutation is parsed before the store sees it: a credential never reaches the database', async () => {
    let mutated = 0;
    const store = fakeStore({ mutate: async () => { mutated += 1; return { ok: true, durable: true, replayed: false, result: {} }; } });
    const result = await handleProjectBrainRoute(OPERATOR_REQUEST({
      method: 'POST', path: '/project-brain/projects/prj-1/mutations',
      rawBody: JSON.stringify({ operation: 'CREATE', idempotencyKey: 'key-12345678', domain: 'USER_FACT', title: 'key', body: 'sk-ant-api03-FAKETESTNOTREAL' }),
    }), ports(store), io);
    expect(result).toMatchObject({ status: 422, body: { error: { kind: 'credential_in_content', durable: false } } });
    expect(mutated).toBe(0);
  });

  it('a store that cannot answer a write says nothing was saved', async () => {
    const store = fakeStore({ membershipRole: async () => { throw new Error('connection refused'); } });
    const result = await handleProjectBrainRoute(OPERATOR_REQUEST({
      method: 'POST', path: '/project-brain/projects/prj-1/mutations',
      rawBody: JSON.stringify({ operation: 'CREATE', idempotencyKey: 'key-12345678', domain: 'USER_FACT', title: 'x' }),
    }), ports(store), io);
    expect(result).toMatchObject({ status: 503, body: { error: { kind: 'project_brain_unavailable', durable: false } } });
    const read = await handleProjectBrainRoute(OPERATOR_REQUEST(), ports(store), io);
    expect(read).toMatchObject({ status: 503, body: { error: { kind: 'project_brain_read_failed' } } });
  });
});

describe('the long poll answers with events or at its deadline -- never on an empty wake', () => {
  const feedRequest = (waitMs: number) => OPERATOR_REQUEST({
    path: '/project-brain/projects/prj-1/events',
    url: `/project-brain/projects/prj-1/events?cursor=${encodeURIComponent(encodeProjectBrainCursor({ 'run:a': 3 }))}&waitMs=${waitMs}`,
  });

  it('a wake that brought nothing (the listener coming up, another write) does not end the page', async () => {
    const wakeups = drivenWakeups();
    let reads = 0;
    let written = false;
    const store = fakeStore({
      eventsAfter: async () => {
        reads += 1;
        return written
          ? { events: [{ eventId: 'e1', type: 'project_brain.record.created', cursor: 'pbc1.x' }], cursor: { 'run:a': 3, 'project-brain:prj-1': 1 } }
          : { events: [], cursor: { 'run:a': 3 } };
      },
    });
    const answer = handleProjectBrainRoute(feedRequest(1_500), ports(store, wakeups), io);
    await new Promise((resolve) => setTimeout(resolve, 50));
    wakeups.fire('prj-1'); // spurious: nothing new yet
    await new Promise((resolve) => setTimeout(resolve, 50));
    written = true;
    wakeups.fire('prj-1'); // the real change
    const result = await answer as { status: number; body: { data: { events: unknown[]; cursor: string } } };
    expect(result.status).toBe(200);
    expect(result.body.data.events).toHaveLength(1);
    expect(reads, 'read once at the start, once per wake').toBe(3);
  });

  it('with nothing at all, the page ends at its deadline with no events and the same cursor', async () => {
    const started = Date.now();
    const result = await handleProjectBrainRoute(feedRequest(300), ports(fakeStore(), drivenWakeups()), io) as { status: number; body: { data: { events: unknown[]; cursor: string } } };
    expect(result.body.data.events).toEqual([]);
    expect(result.body.data.cursor).toBe(encodeProjectBrainCursor({ 'run:a': 3 }));
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
  });

  it('the wait is capped by the bridge, whatever the client asks', async () => {
    const started = Date.now();
    const capped = { ...ports(fakeStore(), drivenWakeups()), maxWaitMs: 200 };
    await handleProjectBrainRoute(feedRequest(60_000), capped, io);
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
