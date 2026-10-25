import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createWonderlandAdmissionService,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import { classifyWonderlandDispatchPath, isWonderlandRoute } from './wonderland-routes';
import {
  createFileCompanionResultStore,
  handleWonderlandCompanionRoute,
  isWonderlandCompanionAgentRoute,
  isWonderlandCompanionRoute,
  type CompanionResultRecord,
  type CompanionResultStore,
  type WonderlandCompanionRoutePorts,
} from './wonderland-companion-route';
import {
  authorizationBoundary,
  createCompanionAdapterRegistry,
  type CompanionAdapter,
  type CompanionProviderSession,
} from './wonderland-companion-registry';

const RUN = 'wlj_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const TRACE_ID = '0ef34f0df7cf2cf89b844dcfa5fe084f';
const AGENT_A = 'agt_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d';
const AGENT_B = 'agt_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const AGENT_C = 'agt_11111111-2222-4333-8444-555555555555';
const UNKNOWN = 'wlj_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LEGACY = `run:${'ab'.repeat(12)}`;
const WHEN = '2026-10-23T17:18:00.000Z';
const PROJECT = 'project-1';
const SHA = 'ab'.repeat(32);
const NOT_FOUND = { status: 404, body: { error: { kind: 'not_found', message: 'Not found.' } } };

function companionPath(runId: string): string {
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

function admission(storePath: string) {
  return createWonderlandAdmissionService({
    env: env(storePath),
    operatorToken: 'operator-token',
    verifyNativeSession: ({ token }) => {
      if (token === 'native-token') return { playerId: 'founder', projectId: PROJECT, sessionId: 'sess-1' };
      return null;
    },
    readWorkflowText: () => null,
  });
}

function request(runId: string, over: Partial<WonderlandAdmissionRouteRequest> = {}): WonderlandAdmissionRouteRequest {
  const path = companionPath(runId);
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

function storedRow(over: Partial<CompanionResultRecord> = {}): CompanionResultRecord {
  return {
    wljRunId: RUN,
    legacyRunId: null,
    taskId: 'cmp_0b7a1c2e-4f3d-4a6b-8c2d-3e4f5a6b7c8d',
    state: 'result_received',
    summary: 'a local note',
    contentSha256: SHA,
    artifactKind: 'text',
    byteLength: 12,
    provenance: {
      source: 'simulated',
      wakeId: null,
      bodyDigest: null,
      contentSha256: SHA,
    },
    updatedAt: WHEN,
    ...over,
  };
}

function ports(storePath: string, companionResults: CompanionResultStore): WonderlandCompanionRoutePorts {
  return { ...admission(storePath), companionResults };
}

describe('wonderland companion read', () => {
  it('a queried companion pathname is the companion route, and a slash or other case is the catch-all', () => {
    const path = companionPath(RUN);
    const queried = `${path}?projectId=${PROJECT}`;
    expect(isWonderlandCompanionRoute(queried)).toBe(true);
    expect(isWonderlandRoute(queried)).toBe(false);
    expect(classifyWonderlandDispatchPath(path, queried)).toEqual({
      catchAllPath: null,
      exactAdmission: false,
      exactStatus: false,
      exactMissionResult: false,
      exactMissionProgress: false,
      exactMissionEvents: false,
      exactMissionStart: false,
      exactCompanion: true,
    });
    for (const raw of [
      `${path}/?projectId=${PROJECT}`,
      `/Wonderland/Julius/Missions/${RUN}/Companion?projectId=${PROJECT}`,
      `${path}/extra?projectId=${PROJECT}`,
    ]) {
      const classified = classifyWonderlandDispatchPath(raw.split('?')[0].replace(/\/+$/, '') || '/', raw);
      expect(classified.exactCompanion, raw).toBe(false);
      expect(classified.catchAllPath, raw).not.toBeNull();
    }
  });

  it('returns a stored result with verified hard-coded false', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    const open = ports(join(dir, 'admission.json'), {
      read: () => ({ ...storedRow(), verified: true, traceId: 'f'.repeat(32) }) as CompanionResultRecord,
    });
    try {
      const result = await handleWonderlandCompanionRoute(request(RUN, {
        url: `${companionPath(RUN)}?projectId=${PROJECT}&traceId=${'a'.repeat(32)}`,
      }), open);
      expect(result?.status).toBe(200);
      const body = result?.body as { verified?: boolean; agents?: unknown[]; traceId?: string; result?: { summary?: string; untrusted?: boolean } };
      expect(body.verified).toBe(false);
      expect(body.traceId).toBe(TRACE_ID);
      expect(body.agents).toEqual([]);
      expect(body.result).toEqual({
        untrusted: true,
        summary: 'a local note',
        artifact: { kind: 'text', sha256: SHA, byteLength: 12 },
      });
      expect(JSON.stringify(result?.body)).not.toContain('"verified":true');
      expect(JSON.stringify(result?.body)).not.toContain('f'.repeat(32));
      expect(JSON.stringify(result?.body)).not.toContain('a'.repeat(32));
    } finally {
      open.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses the status 404 for an unknown wlj id, a legacy id, and a malformed id', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    try {
      const store: CompanionResultStore = { read: () => storedRow() };
      const open = ports(join(dir, 'admission.json'), store);
      expect(await handleWonderlandCompanionRoute(request(UNKNOWN), open)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionRoute(request(LEGACY), open)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionRoute(request('preflight:probe'), open)).toEqual(NOT_FOUND);
      expect(JSON.stringify(NOT_FOUND)).not.toContain('traceId');
      expect(await handleWonderlandCompanionRoute(request('not-a-run'), open)).toEqual(NOT_FOUND);
      expect(await handleWonderlandCompanionRoute(request(RUN.toUpperCase()), open)).toEqual(NOT_FOUND);
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a peer that is not loopback, and that refusal is not a result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    try {
      const store: CompanionResultStore = { read: () => storedRow() };
      const open = ports(join(dir, 'admission.json'), store);
      const forwarded = await handleWonderlandCompanionRoute(request(RUN, { forwarded: true }), open);
      const remote = await handleWonderlandCompanionRoute(request(RUN, { remoteAddress: '10.0.0.8' }), open);
      expect(forwarded).toEqual({
        status: 403,
        body: {
          error: {
            kind: 'julius_dispatch_not_loopback',
            message: 'Mission dispatch is only served to the same machine.',
          },
        },
      });
      expect(remote?.status).toBe(403);
      for (const refused of [forwarded, remote]) {
        expect(refused?.body).not.toHaveProperty('result');
        expect(refused?.body).not.toHaveProperty('verified');
        expect(JSON.stringify(refused?.body)).not.toContain('a local note');
      }
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POST is not an ingest', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    try {
      const store: CompanionResultStore = { read: () => storedRow() };
      const open = ports(join(dir, 'admission.json'), store);
      const posted = await handleWonderlandCompanionRoute(request(RUN, {
        method: 'POST',
        rawBody: JSON.stringify({ summary: 'ignore' }),
      }), open);
      expect(posted).toEqual({
        status: 405,
        body: { error: { kind: 'method_not_allowed', message: 'Companion status is a GET.' } },
      });
      expect(posted?.body).not.toHaveProperty('verified');
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reads a local file and closes a URL store without returning a result', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    const file = join(dir, 'companion.json');
    const admitted = admission(join(dir, 'admission.json'));
    try {
      writeFileSync(file, JSON.stringify({ schemaVersion: 1, results: { [RUN]: storedRow() } }));
      const open = { ...admitted, companionResults: createFileCompanionResultStore(file) };
      const found = await handleWonderlandCompanionRoute(request(RUN), open);
      expect(found?.status).toBe(200);
      expect((found?.body as { verified?: boolean }).verified).toBe(false);
      const missing = await handleWonderlandCompanionRoute(request(UNKNOWN), {
        ...admitted,
        companionResults: createFileCompanionResultStore(join(dir, 'absent.json')),
      });
      expect(missing).toEqual(NOT_FOUND);
      const closed = await handleWonderlandCompanionRoute(request(RUN), {
        ...admitted,
        companionResults: createFileCompanionResultStore('https://example.test/companion.json'),
      });
      expect(closed?.status).toBe(503);
      expect(closed?.body).toEqual({
        error: {
          kind: 'julius_dispatch_unavailable',
          message: 'Wonderland admission store is not available. Nothing was reserved.',
        },
      });
      expect(closed?.body).not.toHaveProperty('result');
      expect(closed?.body).not.toHaveProperty('verified');
    } finally {
      admitted.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not call out or mount an ingest', () => {
    const source = readFileSync(join(__dirname, 'wonderland-companion-route.ts'), 'utf8');
    const registry = readFileSync(join(__dirname, 'wonderland-companion-registry.ts'), 'utf8');
    const mission = readFileSync(join(__dirname, 'julius-mission-routes.ts'), 'utf8');
    for (const text of [source, registry]) {
      expect(text).not.toContain('child_process');
      expect(text).not.toContain('fetch(');
      expect(text).not.toContain('operator-claim');
      expect(text).not.toMatch(/\bgh\b/);
      expect(text).not.toContain('http.request');
      for (const word of ['grok', 'chatgpt', 'openai', 'claude', 'anthropic', 'gemini', 'gpt-']) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
    expect(mission).not.toContain('wonderland-companion-route');
    expect(mission).not.toContain('wonderland-admission-route');
  });

  it('does not treat a provider segment or the agent-id prefix as this route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    try {
      const open = ports(join(dir, 'admission.json'), { read: () => storedRow() });
      expect(isWonderlandCompanionRoute(`/wonderland/julius/missions/${RUN}/companion/grok`)).toBe(false);
      expect(isWonderlandCompanionRoute('/wonderland/companions/agents')).toBe(false);
      expect(isWonderlandCompanionAgentRoute('/wonderland/companions/agents')).toBe(true);
      expect(isWonderlandRoute('/wonderland/companions/agents')).toBe(false);
      expect(classifyWonderlandDispatchPath(
        '/wonderland/companions/agents',
        `/wonderland/companions/agents?projectId=${PROJECT}`,
      )).toEqual({
        catchAllPath: null,
        exactAdmission: false,
        exactStatus: false,
        exactMissionResult: false,
        exactMissionProgress: false,
        exactMissionEvents: false,
        exactMissionStart: false,
        exactCompanion: true,
      });
      expect(isWonderlandCompanionRoute(`/wonderland/companions/agents/${AGENT_A}`)).toBe(false);
      expect(isWonderlandCompanionAgentRoute(`/wonderland/companions/agents/${AGENT_A}`)).toBe(true);
      const posted = await handleWonderlandCompanionRoute(request(RUN, {
        method: 'POST',
        path: '/wonderland/companions/agents',
        url: '/wonderland/companions/agents',
        rawBody: JSON.stringify({ providerId: 'alpha-lab', wljRunId: RUN }),
      }), open);
      expect(posted).toBeNull();
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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

function adapter(providerId: string, readSession: CompanionAdapter['readSession'], adapterVersion = '0.test'): CompanionAdapter {
  return { providerId, adapterVersion, readSession };
}

describe('provider-neutral companion agents', () => {
  it('answers with an empty agents array when no adapter is registered', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    const registry = createCompanionAdapterRegistry();
    try {
      expect(registry.list()).toEqual([]);
      const open = ports(join(dir, 'admission.json'), { read: () => storedRow() });
      const result = await handleWonderlandCompanionRoute(request(RUN), { ...open, companionAgents: registry });
      expect(result?.status).toBe(200);
      const body = result?.body as { agents?: unknown[]; verified?: boolean; companion?: { state?: string } };
      expect(body.agents).toEqual([]);
      expect(body.verified).toBe(false);
      expect(body.companion).toEqual({ state: 'result_received' });
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('attaches two providers to one mission and keeps a thrown or disconnected adapter off the other', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    const registry = createCompanionAdapterRegistry();
    registry.register(adapter('alpha-lab', () => session('alpha-lab', {
      displayName: 'Alpha session',
      kind: 'single',
      declaredCapabilities: ['read', 'write'],
      authorizedCapabilities: ['read', 'billing'],
    })));
    registry.register(adapter('beta-lab', () => session('beta-lab', {
      displayName: 'Beta session',
      kind: 'compound',
      connection: 'disconnected',
      declaredCapabilities: ['listen'],
      authorizedCapabilities: ['listen'],
    })));
    registry.register(adapter('gamma-lab', () => {
      throw new Error('adapter failed');
    }));
    registry.attach({ wljRunId: RUN, providerId: 'alpha-lab', agentId: AGENT_A });
    registry.attach({ wljRunId: RUN, providerId: 'beta-lab', agentId: AGENT_B });
    registry.attach({ wljRunId: RUN, providerId: 'gamma-lab', agentId: AGENT_C });
    try {
      const open = ports(join(dir, 'admission.json'), { read: () => storedRow() });
      const result = await handleWonderlandCompanionRoute(request(RUN), { ...open, companionAgents: registry });
      expect(result?.status).toBe(200);
      const body = result?.body as {
        verified?: boolean;
        result?: { summary?: string };
        agents?: Array<{
          agentId: string;
          providerId: string;
          displayName: string | null;
          kind: string | null;
          connection: string;
          declaredCapabilities: string[];
          authorizedCapabilities: string[];
        }>;
      };
      expect(body.verified).toBe(false);
      expect(body.result?.summary).toBe('a local note');
      expect(body.agents?.map((agent) => agent.providerId)).toEqual(['alpha-lab', 'beta-lab', 'gamma-lab']);
      expect(body.agents?.[0]).toMatchObject({
        agentId: AGENT_A,
        displayName: 'Alpha session',
        kind: 'single',
        connection: 'connected',
        declaredCapabilities: ['read', 'write'],
        authorizedCapabilities: ['read'],
      });
      expect(body.agents?.[1]).toMatchObject({
        agentId: AGENT_B,
        displayName: 'Beta session',
        kind: 'compound',
        connection: 'disconnected',
      });
      expect(body.agents?.[2]).toMatchObject({
        agentId: AGENT_C,
        providerId: 'gamma-lab',
        displayName: null,
        kind: null,
        connection: 'error',
        declaredCapabilities: [],
        authorizedCapabilities: [],
      });
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports an unknown provider id as unsupported and does not fail the read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    const registry = createCompanionAdapterRegistry();
    registry.register(adapter('alpha-lab', () => session('alpha-lab', { displayName: 'Alpha session' })));
    const unknown = registry.attach({ wljRunId: RUN, providerId: 'not-a-registered-provider', agentId: AGENT_B });
    registry.attach({ wljRunId: RUN, providerId: 'alpha-lab', agentId: AGENT_A });
    try {
      expect(unknown.connection).toBe('unsupported');
      expect(unknown.displayName).toBeNull();
      const open = ports(join(dir, 'admission.json'), { read: () => storedRow() });
      const result = await handleWonderlandCompanionRoute(request(RUN), { ...open, companionAgents: registry });
      expect(result?.status).toBe(200);
      const agents = (result?.body as { agents?: Array<{ providerId: string; connection: string; displayName: string | null }> }).agents;
      expect(agents?.find((agent) => agent.providerId === 'not-a-registered-provider')).toEqual({
        agentId: AGENT_B,
        providerId: 'not-a-registered-provider',
        displayName: null,
        kind: null,
        adapterVersion: null,
        declaredCapabilities: [],
        authorizedCapabilities: [],
        connection: 'unsupported',
      });
      expect(agents?.find((agent) => agent.providerId === 'alpha-lab')?.connection).toBe('connected');
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('drops authorized capabilities that were not declared, including from a lying source', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    try {
      const open = ports(join(dir, 'admission.json'), { read: () => storedRow() });
      const result = await handleWonderlandCompanionRoute(request(RUN), {
        ...open,
        companionAgents: {
          agentsFor: () => [{
            agentId: AGENT_A,
            providerId: 'alpha-lab',
            displayName: 'Alpha session',
            kind: 'single',
            adapterVersion: '0.test',
            declaredCapabilities: ['read', 'write', 'admin'],
            authorizedCapabilities: ['admin', 'billing', 'read'],
            connection: 'connected',
          }],
        },
      });
      expect(result?.status).toBe(200);
      const agent = (result?.body as { agents: Array<{ declaredCapabilities: string[]; authorizedCapabilities: string[] }> }).agents[0];
      expect(agent?.declaredCapabilities).toEqual(['read', 'write', 'admin']);
      expect(agent?.authorizedCapabilities).toEqual(['read', 'admin']);
      for (const capability of agent?.authorizedCapabilities ?? []) {
        expect(agent?.declaredCapabilities).toContain(capability);
      }
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not keep a substituted identity, and a thrown agent source still returns the row', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wlj-companion-'));
    const registry = createCompanionAdapterRegistry();
    registry.register(adapter('alpha-lab', () => session('other-lab', { displayName: 'Substituted model' })));
    const substituted = registry.attach({ wljRunId: RUN, providerId: 'alpha-lab', agentId: AGENT_A });
    const minted = registry.attach({ wljRunId: RUN, providerId: 'alpha-lab', agentId: 'chatgpt' });
    const boundary = authorizationBoundary(
      { wljRunId: RUN, agentId: AGENT_A },
      session('alpha-lab', { authorizedCapabilities: ['read', 'billing'] }),
    );
    try {
      expect(substituted.connection).toBe('error');
      expect(substituted.displayName).toBeNull();
      expect(JSON.stringify(substituted)).not.toContain('Substituted model');
      expect(minted.agentId).toMatch(/^agt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
      expect(minted.agentId).not.toBe('chatgpt');
      expect(boundary.credentialOwner).toBe('user');
      expect(boundary.relayFundedFallback).toBe(false);
      expect(boundary.authorizedCapabilities).toEqual(['read']);
      const open = ports(join(dir, 'admission.json'), { read: () => storedRow() });
      const thrown = await handleWonderlandCompanionRoute(request(RUN), {
        ...open,
        companionAgents: {
          agentsFor() {
            throw new Error('registry failed');
          },
        },
      });
      expect(thrown?.status).toBe(200);
      expect((thrown?.body as { agents?: unknown[]; verified?: boolean }).agents).toEqual([]);
      expect((thrown?.body as { verified?: boolean }).verified).toBe(false);
      expect((thrown?.body as { result?: { summary?: string } }).result?.summary).toBe('a local note');
      open.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
