import { describe, expect, it } from 'vitest';

import {
  handleExecutionProfileRoute,
  isExecutionProfileRoute,
} from './wonderland-execution-profile-routes';
import type {
  ExecutionProfileRouteRequest,
  WonderlandExecutionProfileRecord,
  WonderlandExecutionProfileStore,
} from './wonderland-execution-profile-routes';

/**
 * THE OPERATOR'S PROFILE ROUTES. Operator only, read and write; every write
 * attributed and appended; a player -- or anyone without the operator credential
 * -- reaches nothing, not even a read, because a profile names the executor's
 * workspace and the command it runs.
 */

const PROFILE = {
  tenantId: 'tenant-alpha',
  enabled: true,
  markerNamespacePrefix: 'wl-alpha',
  workspacePath: '/srv/julius/workspaces/alpha',
  testCommand: 'npm test',
  limits: { spendUsd: 2.5, repairCycles: 1, architectMaxOutputTokens: 4000 },
  research: null,
};

/** Append-only, like the Postgres store: every write a new version, the current one the highest. */
function memoryStore(): WonderlandExecutionProfileStore & { rows: Array<WonderlandExecutionProfileRecord & { projectId: string }> } {
  const rows: Array<WonderlandExecutionProfileRecord & { projectId: string }> = [];
  return {
    rows,
    async current(projectId) {
      const mine = rows.filter((row) => row.projectId === projectId);
      return mine.length === 0 ? null : mine[mine.length - 1];
    },
    async append({ projectId, body, writtenBy }) {
      const version = rows.filter((row) => row.projectId === projectId).length + 1;
      rows.push({ projectId, version, body, writtenBy, writtenAt: '2026-09-27T12:00:00.000Z' });
      return { ok: true, version };
    },
  };
}

const request = (over: Partial<ExecutionProfileRouteRequest> = {}): ExecutionProfileRouteRequest => ({
  method: 'PUT',
  path: '/julius/projects/prj-alpha/execution-profile',
  operator: true,
  actor: 'ops-kaisi',
  body: JSON.stringify(PROFILE),
  ...over,
});

const kindOf = (result: { body: unknown } | null) => (result?.body as { error?: { kind: string } }).error?.kind;
const dataOf = (result: { body: unknown } | null) => (result?.body as { data: Record<string, unknown> }).data;

describe('the route claims only its own path', () => {
  it('matches the profile path and nothing near it', () => {
    expect(isExecutionProfileRoute('/julius/projects/prj-alpha/execution-profile')).toBe(true);
    for (const path of ['/julius/projects/prj-alpha', '/julius/missions', '/julius/runs/r/result', '/julius/projects//execution-profile']) {
      expect(isExecutionProfileRoute(path), path).toBe(false);
    }
  });
});

describe('OPERATOR ONLY -- reading included', () => {
  it('refuses a write and a READ without the operator credential, and writes nothing', async () => {
    const store = memoryStore();
    expect(kindOf(await handleExecutionProfileRoute(request({ operator: false }), store))).toBe('operator_required');
    expect(kindOf(await handleExecutionProfileRoute(request({ method: 'GET', operator: false, body: undefined }), store))).toBe('operator_required');
    expect(store.rows).toHaveLength(0);
    // CONTROL: the operator writes.
    expect((await handleExecutionProfileRoute(request(), store))?.status).toBe(200);
  });

  it('a write names who made it, or is refused', async () => {
    const store = memoryStore();
    for (const actor of [undefined, '', '   ', 'has spaces in it']) {
      expect(kindOf(await handleExecutionProfileRoute(request({ actor }), store)), String(actor)).toBe('actor_required');
    }
    expect(store.rows).toHaveLength(0);
    await handleExecutionProfileRoute(request(), store);
    expect(store.rows[0].writtenBy).toBe('operator:ops-kaisi');
  });

  it('fails closed with no store: 503, never an empty profile', async () => {
    expect(kindOf(await handleExecutionProfileRoute(request(), null))).toBe('execution_profile_store_unavailable');
    expect(kindOf(await handleExecutionProfileRoute(request({ method: 'GET', body: undefined }), null))).toBe('execution_profile_store_unavailable');
  });
});

describe('writes are validated, appended, and never overwrite', () => {
  it('an invalid profile is refused in the validator\'s words, and stores nothing', async () => {
    const store = memoryStore();
    const bad = await handleExecutionProfileRoute(request({ body: JSON.stringify({ ...PROFILE, spendUSD: 5 }) }), store);
    expect(bad?.status).toBe(400);
    expect(kindOf(bad)).toBe('invalid_execution_profile');
    expect(JSON.stringify(bad?.body)).toContain('spendUSD');
    expect((await handleExecutionProfileRoute(request({ body: '{not json' }), store))?.status).toBe(400);
    expect(store.rows).toHaveLength(0);
  });

  it('each write is the NEXT version, and the read is the current one with who wrote it', async () => {
    const store = memoryStore();
    expect(dataOf(await handleExecutionProfileRoute(request(), store))).toMatchObject({ projectId: 'prj-alpha', version: 1, enabled: true });
    expect(dataOf(await handleExecutionProfileRoute(request({ body: JSON.stringify({ ...PROFILE, enabled: false }), actor: 'ops-other' }), store)))
      .toMatchObject({ version: 2, enabled: false });
    const read = dataOf(await handleExecutionProfileRoute(request({ method: 'GET', body: undefined }), store));
    expect(read).toMatchObject({ projectId: 'prj-alpha', version: 2, writtenBy: 'operator:ops-other' });
    expect(read.profile).toMatchObject({ enabled: false, workspacePath: '/srv/julius/workspaces/alpha' });
    // THE HISTORY SURVIVES: version 1 is still there, as written.
    expect(store.rows.map((row) => [row.version, row.writtenBy])).toEqual([[1, 'operator:ops-kaisi'], [2, 'operator:ops-other']]);
  });

  it('a concurrent write that loses is told so -- 409, not a silent overwrite', async () => {
    const store: WonderlandExecutionProfileStore = { current: async () => null, append: async () => ({ ok: false, reason: 'conflict' }) };
    expect(kindOf(await handleExecutionProfileRoute(request(), store))).toBe('execution_profile_write_conflict');
  });

  it('a project with no profile is 404 to the operator', async () => {
    expect(kindOf(await handleExecutionProfileRoute(request({ method: 'GET', body: undefined }), memoryStore()))).toBe('execution_profile_not_found');
  });

  it('only GET and PUT', async () => {
    expect((await handleExecutionProfileRoute(request({ method: 'DELETE' }), memoryStore()))?.status).toBe(405);
  });
});
