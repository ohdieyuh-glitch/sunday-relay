import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createWonderlandAdmissionService,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import {
  createFileCompanionResultStore,
  createMemoryCompanionResultStore,
  handleWonderlandCompanionAgentRoute,
  handleWonderlandCompanionRoute,
  type CompanionResultRecord,
} from './wonderland-companion-route';
import {
  createCompanionAdapterRegistry,
  type CompanionAdapter,
  type CompanionProviderSession,
} from './wonderland-companion-registry';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const AGENT_MISSING = 'agt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const WHEN = '2026-10-23T17:18:00.000Z';
const PROJECT = 'project-1';
const SHA = 'ab'.repeat(32);
const SECRET = 'super-secret-value-should-not-be-stored';
const AGENTS = '/wonderland/companions/agents';
const NOT_FOUND = { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };

function missionPath(runId: string): string {
  return `/wonderland/julius/missions/${encodeURIComponent(runId)}/companion`;
}

function env(storePath: string): Record<string, string | undefined> {
  return {
    JULIUS_WONDERLAND_ADMISSION: '1',
    JULIUS_J1_PROJECT_ID: PROJECT,
    JULIUS_J1_FOUNDER_PLAYER_ID: 'founder',
    JULIUS_WONDERLAND_MISSION: 'julius-inworld-data-1',
    JULIUS_WONDERLAND_ADMISSION_STORE: storePath,
  };
}

function storedRow(): CompanionResultRecord {
  return {
    wljRunId: RUN,
    legacyRunId: null,
    taskId: 'cmp_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d',
    state: 'result_received',
    summary: 'a local note',
    contentSha256: SHA,
    artifactKind: 'text',
    byteLength: 12,
    provenance: { source: 'simulated', wakeId: null, bodyDigest: null, contentSha256: SHA },
    updatedAt: WHEN,
  };
}

function openPorts(dir: string, registry: ReturnType<typeof createCompanionAdapterRegistry>, results = createMemoryCompanionResultStore()) {
  results.record(storedRow());
  const admission = createWonderlandAdmissionService({
    env: env(join(dir, 'admission.json')),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => {
      if (token === 'native-token') return { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' };
      return null;
    },
    readWorkflowText: () => null,
  });
  return { ...admission, companionResults: results, companionAgents: registry };
}

function request(path: string, over: Partial<WonderlandAdmissionRouteRequest> = {}): WonderlandAdmissionRouteRequest {
  return {
    method: 'GET',
    path,
    url: `${path}?projectId=${PROJECT}`,
    authorization: 'Relay-Session native-token',
    origin: undefined,
    rawBody: undefined,
    idempotencyKey: undefined,
    remoteAddress: '127.0.0.1',
    host: 'localhost',
    forwarded: false,
    nowIso: WHEN,
    nowMs: Date.parse(WHEN),
    ...over,
  };
}

function session(providerId: string, over: Partial<CompanionProviderSession> = {}): CompanionProviderSession {
  return {
    providerId,
    displayName: `${providerId} session`,
    kind: 'single',
    providerSessionRef: `sess-${providerId}`,
    declaredCapabilities: ['read', 'write'],
    authorizedCapabilities: ['read'],
    connection: 'connected',
    ...over,
  };
}

function adapter(providerId: string, readSession: CompanionAdapter['readSession']): CompanionAdapter {
  return { providerId, adapterVersion: '0.test', readSession };
}

describe('companion agent routes', () => {
  it('creates an unsupported slot with zero adapters and lists it on the mission', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-agents-'));
    const store = createMemoryCompanionResultStore();
    const registry = createCompanionAdapterRegistry(store);
    const ports = openPorts(dir, registry, store);
    try {
      expect(registry.list()).toEqual([]);
      const created = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
        method: 'POST',
        rawBody: JSON.stringify({
          providerId: 'no-such-provider',
          wljRunId: RUN,
          displayName: 'Desk label',
          agentId: 'caller-picked',
          traceId: 'f'.repeat(32),
        }),
      }), ports);
      expect(created?.status).toBe(201);
      const body = created?.body as {
        agentId: string;
        providerId: string;
        displayName: string | null;
        kind: string | null;
        connection: string;
        declaredCapabilities: string[];
        authorizedCapabilities: string[];
      };
      expect(body.agentId).toMatch(/^agt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      expect(body.agentId).not.toBe('caller-picked');
      expect(body).not.toHaveProperty('traceId');
      expect(body).toMatchObject({
        providerId: 'no-such-provider',
        displayName: 'Desk label',
        kind: null,
        connection: 'unsupported',
        declaredCapabilities: [],
        authorizedCapabilities: [],
      });
      const mission = await handleWonderlandCompanionRoute(request(missionPath(RUN)), ports);
      expect(mission?.status).toBe(200);
      const missionBody = mission?.body as { verified?: boolean; traceId?: string; agents?: Array<{ agentId: string }> };
      expect(missionBody.verified).toBe(false);
      expect(missionBody.traceId).toBe('0ef34f0df7cf2cf89b844dcfa5fe084f');
      expect(JSON.stringify(mission?.body)).not.toContain('f'.repeat(32));
      expect(missionBody.agents?.map((agent) => agent.agentId)).toEqual([body.agentId]);
    } finally {
      ports.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('attaches two providers to one mission and isolates a throwing adapter', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-agents-'));
    const store = createMemoryCompanionResultStore();
    const registry = createCompanionAdapterRegistry(store);
    registry.register(adapter('alpha-lab', () => session('alpha-lab', {
      displayName: 'Alpha session',
      declaredCapabilities: ['read', 'write', 'admin'],
      authorizedCapabilities: ['admin', 'billing', 'read'],
    })));
    registry.register(adapter('beta-lab', () => session('beta-lab', { displayName: 'Beta session', kind: 'compound' })));
    registry.register(adapter('gamma-lab', () => {
      throw new Error('adapter failed');
    }));
    const ports = openPorts(dir, registry, store);
    try {
      const alpha = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
        method: 'POST',
        rawBody: JSON.stringify({ providerId: 'alpha-lab', wljRunId: RUN, displayName: 'not the session' }),
      }), ports);
      const beta = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
        method: 'POST',
        rawBody: JSON.stringify({ providerId: 'beta-lab', wljRunId: RUN }),
      }), ports);
      const gamma = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
        method: 'POST',
        rawBody: JSON.stringify({ providerId: 'gamma-lab', wljRunId: RUN }),
      }), ports);
      expect(alpha?.status).toBe(201);
      expect(beta?.status).toBe(201);
      expect(gamma?.status).toBe(201);
      expect(gamma?.status).toBeLessThan(500);
      const alphaBody = alpha?.body as { displayName: string; authorizedCapabilities: string[]; connection: string };
      expect(alphaBody.displayName).toBe('Alpha session');
      expect(alphaBody.connection).toBe('connected');
      expect(alphaBody.authorizedCapabilities).toEqual(['read', 'admin']);
      expect((gamma?.body as { connection: string; displayName: string | null }).connection).toBe('error');
      const mission = await handleWonderlandCompanionRoute(request(missionPath(RUN)), ports);
      const agents = (mission?.body as { agents: Array<{ providerId: string; connection: string }> }).agents;
      expect(agents.map((agent) => [agent.providerId, agent.connection])).toEqual([
        ['alpha-lab', 'connected'],
        ['beta-lab', 'connected'],
        ['gamma-lab', 'error'],
      ]);
    } finally {
      ports.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns 404 for an unknown agent id and 403 for a peer that is not loopback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-agents-'));
    const registry = createCompanionAdapterRegistry();
    const ports = openPorts(dir, registry);
    try {
      expect(await handleWonderlandCompanionAgentRoute(request(`${AGENTS}/${AGENT_MISSING}`), ports)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionAgentRoute(request(`${AGENTS}/chatgpt`), ports)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionAgentRoute(request(`${AGENTS}/${AGENT_MISSING}`, { method: 'DELETE' }), ports)).toEqual(NOT_FOUND);
      const forwarded = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
        method: 'POST',
        rawBody: JSON.stringify({ providerId: 'alpha-lab', wljRunId: RUN }),
        forwarded: true,
      }), ports);
      const remote = await handleWonderlandCompanionAgentRoute(request(`${AGENTS}/${AGENT_MISSING}`, {
        remoteAddress: '10.0.0.8',
      }), ports);
      for (const refused of [forwarded, remote]) {
        expect(refused).toEqual({
          status: 403,
          body: {
            error: {
              kind: 'julius_dispatch_not_loopback',
              message: 'Mission dispatch is only served to the same machine.',
            },
          },
        });
      }
      expect(registry.agentsFor(RUN)).toEqual([]);
    } finally {
      ports.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects credential fields with 400 and does not store them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-agents-'));
    const store = createMemoryCompanionResultStore();
    const registry = createCompanionAdapterRegistry(store);
    const ports = openPorts(dir, registry, store);
    try {
      for (const field of ['apiKey', 'token', 'password']) {
        const refused = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
          method: 'POST',
          rawBody: JSON.stringify({ providerId: 'alpha-lab', wljRunId: RUN, [field]: SECRET }),
        }), ports);
        expect(refused?.status, field).toBe(400);
        expect(refused?.body).toEqual({
          error: {
            kind: 'companion_credentials_rejected',
            message: 'Provider credentials are not accepted on this route.',
          },
        });
        expect(JSON.stringify(refused?.body), field).not.toContain(SECRET);
      }
      const nested = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
        method: 'POST',
        rawBody: JSON.stringify({ providerId: 'alpha-lab', wljRunId: RUN, nested: { token: SECRET } }),
      }), ports);
      expect(nested?.status).toBe(400);
      expect(store.listAgents()).toEqual([]);
      expect(JSON.stringify(store.listAgents())).not.toContain(SECRET);
    } finally {
      ports.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('disconnects one slot and leaves the other connected, in the same local file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-agents-'));
    const file = join(dir, 'companion.json');
    writeFileSync(file, JSON.stringify({ schemaVersion: 1, results: { [RUN]: storedRow() } }));
    const store = createFileCompanionResultStore(file);
    const registry = createCompanionAdapterRegistry(store);
    registry.register(adapter('alpha-lab', () => session('alpha-lab', { displayName: 'Alpha session' })));
    registry.register(adapter('beta-lab', () => session('beta-lab', { displayName: 'Beta session' })));
    const admission = createWonderlandAdmissionService({
      env: env(join(dir, 'admission.json')),
      operatorToken: 'operator-token',
      verifyNativeSession: ({ token }) => {
        if (token === 'native-token') return { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' };
        return null;
      },
      readWorkflowText: () => null,
    });
    const ports = { ...admission, companionResults: store, companionAgents: registry };
    try {
      const alpha = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
        method: 'POST',
        rawBody: JSON.stringify({ providerId: 'alpha-lab', wljRunId: RUN }),
      }), ports);
      const beta = await handleWonderlandCompanionAgentRoute(request(AGENTS, {
        method: 'POST',
        rawBody: JSON.stringify({ providerId: 'beta-lab', wljRunId: RUN }),
      }), ports);
      const alphaId = (alpha?.body as { agentId: string }).agentId;
      const betaId = (beta?.body as { agentId: string }).agentId;
      const disconnected = await handleWonderlandCompanionAgentRoute(request(`${AGENTS}/${alphaId}`, { method: 'DELETE' }), ports);
      expect(disconnected?.status).toBe(200);
      expect((disconnected?.body as { connection: string }).connection).toBe('disconnected');
      const still = await handleWonderlandCompanionAgentRoute(request(`${AGENTS}/${betaId}`), ports);
      expect((still?.body as { connection: string; displayName: string }).connection).toBe('connected');
      expect((still?.body as { displayName: string }).displayName).toBe('Beta session');
      const mission = await handleWonderlandCompanionRoute(request(missionPath(RUN)), ports);
      const agents = (mission?.body as { verified: boolean; agents: Array<{ agentId: string; connection: string }> });
      expect(agents.verified).toBe(false);
      expect(agents.agents.map((agent) => [agent.agentId, agent.connection])).toEqual([
        [alphaId, 'disconnected'],
        [betaId, 'connected'],
      ]);
      const saved = readFileSync(file, 'utf8');
      expect(saved).toContain(alphaId);
      expect(saved).toContain('a local note');
      expect(saved).not.toContain(SECRET);
    } finally {
      admission.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
