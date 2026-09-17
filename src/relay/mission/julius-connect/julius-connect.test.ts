import { describe, expect, it } from 'vitest';

import {
  CONNECT_EDGES,
  CONNECT_STATES,
  DESIGN_SYNC_TEMPLATE,
  SOCIAL_POST_TEMPLATE,
  EMPTY_JULIUS_CONNECT_STATE,
  EXTERNAL_CAPABILITY_REQUIRED,
  JULIUS_CONNECT_REGISTRY,
  advanceConnectTask,
  approveRequest,
  auditAction,
  authorizeCapabilityUse,
  chooseConnectRoute,
  completeAuthorization,
  declineRequest,
  discoverConnectors,
  findConnector,
  grantProjectAccess,
  isLegalConnectTransition,
  latestConnection,
  needsAuthorization,
  projectConnectionsSurface,
  requestCapabilities,
  revokeConnection,
  setConnectionHealth,
  startConnectTask,
  type AuthorizationOutcome,
  type CapabilityRequest,
  type ConnectClock,
  type ConnectTask,
  type JuliusConnectState,
} from './index';

/**
 * THE FOUNDER'S CHAIN, END TO END, WITH NOTHING FAKED:
 *   request capability -> discover connector -> prepare authorization -> user approves -> connection record created
 *   -> capability becomes available -> Julius uses capability -> audit event recorded -> user revokes
 *   -> Julius can no longer use capability
 * plus project scope, the failure states driving Julius's behaviour, every route shape, and no secret anywhere.
 */

const USER = 'founder';
const OTHER = 'someone-else';
let tick = 0;
const clock = (): ConnectClock => ({ at: new Date(Date.UTC(2026, 8, 17, 12, 0, tick++)).toISOString() });

function must<T>(result: { ok: true; value: T } | { ok: false; error: { code: string; message: string } }): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

const devAuthorized = (granted: readonly string[], n = 1): AuthorizationOutcome => ({
  kind: 'authorized', credentialRef: `vault://dev/cred_${n}`, accountLabel: 'founder@design.dev', grantedCapabilities: granted, expiresAt: '2099-01-01T00:00:00.000Z',
});

function ask(state: JuliusConnectState, connectorId: string, capabilities: string[], projectId = 'project-a'): { state: JuliusConnectState; request: CapabilityRequest } {
  const outcome = must(requestCapabilities(state, { userId: USER, projectId, missionId: null, taskId: null, connectorId, capabilities, purpose: 'Testing the connection' }, clock()));
  if (outcome.kind !== 'awaiting_user') throw new Error(`expected awaiting_user, got ${outcome.kind}`);
  return { state: outcome.state, request: outcome.request };
}

function connect(state: JuliusConnectState, connectorId: string, capabilities: string[], projectId = 'project-a'): JuliusConnectState {
  const asked = ask(state, connectorId, capabilities, projectId);
  const approved = must(approveRequest(asked.state, { requestId: asked.request.requestId, userId: USER }, clock()));
  return must(completeAuthorization(approved, { requestId: asked.request.requestId, outcome: devAuthorized(capabilities) }, clock()));
}

function run(state: JuliusConnectState, task: ConnectTask, times: number): { state: JuliusConnectState; task: ConnectTask } {
  let current = { state, task };
  for (let i = 0; i < times; i++) current = advanceConnectTask(current.state, current.task, clock());
  return current;
}

describe('julius connect: the founder chain', () => {
  it('requests, prepares, waits on the user, connects, uses, audits, revokes and then refuses', () => {
    let state = EMPTY_JULIUS_CONNECT_STATE;
    let task = startConnectTask(DESIGN_SYNC_TEMPLATE, { taskId: 'task-1', missionId: 'mission-1', projectId: 'project-a', userId: USER }, clock().at);
    expect(task.runState).toBe('EXECUTING');

    // 1. Julius reaches for files.read, the gate refuses, and Julius asks for exactly what the rest of the task needs.
    ({ state, task } = advanceConnectTask(state, task, clock()));
    expect(task.runState).toBe('BLOCKED');
    expect(task.transitions[task.transitions.length - 1].reasonCode).toBe(EXTERNAL_CAPABILITY_REQUIRED);
    expect(task.blocked?.denial).toBe('NOT_CONNECTED');
    expect(task.cursor).toBe(0);
    const request = state.requests[0];
    expect(request.state).toBe('AWAITING_USER');
    expect(request.route).toBe('oauth_api');
    expect(request.requested).toEqual(['files.read', 'design.write']);
    expect(request.notRequested).toEqual(expect.arrayContaining(['comments.write', 'team.admin', 'files.delete']));
    expect(request.prepared.filter((p) => p.done).length).toBeGreaterThanOrEqual(3);
    const pending = latestConnection(state, USER, 'dev-figma');
    expect(pending?.state).toBe('AUTHORIZATION_REQUIRED');
    expect(pending?.credentialRef).toBeNull();
    expect(pending?.development).toBe(true);
    expect(pending?.provenance).toBe('simulated');
    expect(auditAction(state, 'capability.denied')).toHaveLength(1);
    expect(auditAction(state, 'mission.blocked')).toHaveLength(1);

    // The prompt Wonder Web draws, from the model.
    const waitingSurface = projectConnectionsSurface(state, { viewerUserId: USER, projectId: 'project-a', tasks: [task] }, clock());
    expect(waitingSurface.prompt?.banner).toBe('EXTERNAL CAPABILITY REQUIRED');
    expect(waitingSurface.prompt?.headline).toBe('JULIUS WANTS TO CONNECT DESIGN TOOL (DEVELOPMENT)');
    expect(waitingSurface.prompt?.kind).toBe('DEVELOPMENT CONNECTOR');
    expect(waitingSurface.prompt?.requested.map((c) => c.capabilityId)).toEqual(['files.read', 'design.write']);
    expect(waitingSurface.tasks[0].blockedReason).toBe(EXTERNAL_CAPABILITY_REQUIRED);

    // 2. Waiting does not spam the user: advancing a blocked task asks nothing new.
    ({ state, task } = run(state, task, 3));
    expect(state.requests).toHaveLength(1);
    expect(task.runState).toBe('BLOCKED');

    // 3. The user approves; Julius finishes the connection.
    state = must(approveRequest(state, { requestId: request.requestId, userId: USER }, clock()));
    expect(latestConnection(state, USER, 'dev-figma')?.state).toBe('CONNECTING');
    expect(needsAuthorization(state, request.requestId)).toBe(true);
    // Still not usable while connecting.
    expect(authorizeCapabilityUse(state, { userId: USER, projectId: 'project-a', connectorId: 'dev-figma', capability: 'files.read' }, clock()))
      .toMatchObject({ allowed: false, denial: 'CONNECTING' });
    // The service tried to grant admin as well; the connection never holds more than was requested.
    state = must(completeAuthorization(state, { requestId: request.requestId, outcome: devAuthorized(['files.read', 'design.write', 'team.admin']) }, clock()));
    const connected = latestConnection(state, USER, 'dev-figma');
    expect(connected?.state).toBe('CONNECTED');
    expect(connected?.grantedCapabilities).toEqual(['files.read', 'design.write']);
    expect(connected?.deniedCapabilities).toEqual(expect.arrayContaining(['team.admin', 'files.delete', 'comments.write']));
    expect(state.requests[0].state).toBe('SATISFIED');
    expect(state.connections).toHaveLength(1);

    // 4. The capability is available; Julius resumes (through the run state machine) and uses it.
    expect(authorizeCapabilityUse(state, { userId: USER, projectId: 'project-a', connectorId: 'dev-figma', capability: 'files.read' }, clock()).allowed).toBe(true);
    const usedBefore = auditAction(state, 'capability.used').length;
    ({ state, task } = advanceConnectTask(state, task, clock()));
    expect(task.runState).toBe('EXECUTING');
    expect(task.transitions.slice(-2).map((t) => t.to)).toEqual(['READY', 'EXECUTING']);
    expect(auditAction(state, 'capability.used')).toHaveLength(usedBefore);
    expect(auditAction(state, 'mission.resumed')).toHaveLength(1);
    ({ state, task } = advanceConnectTask(state, task, clock()));
    expect(task.cursor).toBe(1);

    // 5. The use is audited: who, project, mission, connection, capability, outcome.
    const used = auditAction(state, 'capability.used');
    expect(used).toHaveLength(1);
    expect(used[0]).toMatchObject({ actor: 'julius', projectId: 'project-a', missionId: 'mission-1', connectionId: connected?.connectionId, capability: 'files.read', outcome: 'success' });
    expect(latestConnection(state, USER, 'dev-figma')?.lastUsedAt).toBe(used[0].at);

    // 6. The user revokes. The very next step is refused, and Julius does not ask again behind the user's back.
    state = must(revokeConnection(state, { connectionId: connected!.connectionId, userId: USER }, clock()));
    const revoked = latestConnection(state, USER, 'dev-figma');
    expect(revoked?.state).toBe('REVOKED');
    expect(revoked?.credentialRef).toBeNull();
    expect(revoked?.grantedCapabilities).toEqual([]);
    expect(state.grants.every((g) => g.revokedAt !== null)).toBe(true);
    expect(authorizeCapabilityUse(state, { userId: USER, projectId: 'project-a', connectorId: 'dev-figma', capability: 'files.read' }, clock()))
      .toMatchObject({ allowed: false, denial: 'REVOKED' });
    ({ state, task } = advanceConnectTask(state, task, clock()));
    expect(task.runState).toBe('BLOCKED');
    expect(task.cursor).toBe(1);
    expect(task.blocked?.denial).toBe('REVOKED');
    expect(state.requests.filter((r) => r.state === 'AWAITING_USER')).toHaveLength(0);

    const revokedSurface = projectConnectionsSurface(state, { viewerUserId: USER, projectId: 'project-a', tasks: [task] }, clock());
    const row = revokedSurface.services.find((s) => s.connectorId === 'dev-figma')!;
    expect(row).toMatchObject({ state: 'REVOKED', canRevoke: false, canConnect: true, connectLabel: 'RECONNECT', projectScope: [] });
    expect(revokedSurface.prompt).toBeNull();

    // 7. The user reconnects; the fresh authorization holds only what it grants, and the task finishes.
    const again = must(requestCapabilities(state, { userId: USER, projectId: 'project-a', missionId: 'mission-1', taskId: 'task-1', connectorId: 'dev-figma', capabilities: task.blocked!.capabilities, purpose: task.purpose }, clock()));
    expect(again.kind).toBe('awaiting_user');
    if (again.kind !== 'awaiting_user') return;
    state = again.state;
    expect(latestConnection(state, USER, 'dev-figma')).toMatchObject({ state: 'AUTHORIZATION_REQUIRED', grantedCapabilities: [], connectionId: connected!.connectionId });
    state = must(approveRequest(state, { requestId: again.request.requestId, userId: USER }, clock()));
    state = must(completeAuthorization(state, { requestId: again.request.requestId, outcome: devAuthorized(['files.read', 'design.write'], 2) }, clock()));
    ({ state, task } = run(state, task, 12));
    expect(task.runState).toBe('COMPLETED');
    expect(task.cursor).toBe(DESIGN_SYNC_TEMPLATE.steps.length);
    expect(auditAction(state, 'capability.used')).toHaveLength(DESIGN_SYNC_TEMPLATE.steps.length);
    expect(state.connections).toHaveLength(1);
  });

  it('a declined request stands: nothing connects and the task waits without asking again', () => {
    let state = EMPTY_JULIUS_CONNECT_STATE;
    let task = startConnectTask(DESIGN_SYNC_TEMPLATE, { taskId: 'task-d', missionId: 'mission-d', projectId: 'project-a', userId: USER }, clock().at);
    ({ state, task } = advanceConnectTask(state, task, clock()));
    const request = state.requests[0];
    expect(approveRequest(state, { requestId: request.requestId, userId: OTHER }, clock()).ok).toBe(false);
    state = must(declineRequest(state, { requestId: request.requestId, userId: USER }, clock()));
    expect(latestConnection(state, USER, 'dev-figma')?.state).toBe('NOT_CONNECTED');
    expect(approveRequest(state, { requestId: request.requestId, userId: USER }, clock()).ok).toBe(false);
    ({ state, task } = run(state, task, 3));
    expect(task.runState).toBe('BLOCKED');
    expect(state.requests.filter((r) => r.state === 'AWAITING_USER')).toHaveLength(0);
    const surface = projectConnectionsSurface(state, { viewerUserId: USER, projectId: 'project-a', tasks: [task] }, clock());
    expect(surface.prompt).toBeNull();
    expect(surface.services.find((s) => s.connectorId === 'dev-figma')).toMatchObject({ state: 'NOT_CONNECTED', canConnect: true, connectLabel: 'CONNECT' });
  });

  it('a failed authorization fails the connection and the request, and can be retried', () => {
    const asked = ask(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read']);
    let state = must(approveRequest(asked.state, { requestId: asked.request.requestId, userId: USER }, clock()));
    state = must(completeAuthorization(state, { requestId: asked.request.requestId, outcome: { kind: 'failed', reason: 'The development authorization was cancelled.' } }, clock()));
    expect(latestConnection(state, USER, 'dev-figma')?.state).toBe('FAILED');
    expect(state.requests[0].state).toBe('FAILED');
    expect(authorizeCapabilityUse(state, { userId: USER, projectId: 'project-a', connectorId: 'dev-figma', capability: 'files.read' }, clock())).toMatchObject({ allowed: false, denial: 'FAILED' });
    state = connect(state, 'dev-figma', ['files.read']);
    expect(latestConnection(state, USER, 'dev-figma')?.state).toBe('CONNECTED');
  });
});

describe('julius connect: project scope', () => {
  it('project A reads and writes, project B only reads, project C has nothing', () => {
    let state = connect(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read', 'design.write'], 'project-a');
    const connection = latestConnection(state, USER, 'dev-figma')!;
    state = must(grantProjectAccess(state, { userId: USER, projectId: 'project-b', connectionId: connection.connectionId, capabilities: ['files.read'], expiresAt: '2099-01-01T00:00:00.000Z' }, clock()));
    const use = (projectId: string, capability: string) => authorizeCapabilityUse(state, { userId: USER, projectId, connectorId: 'dev-figma', capability }, clock());
    expect(use('project-a', 'files.read').allowed).toBe(true);
    expect(use('project-a', 'design.write').allowed).toBe(true);
    expect(use('project-b', 'files.read').allowed).toBe(true);
    expect(use('project-b', 'design.write')).toMatchObject({ allowed: false, denial: 'NOT_GRANTED_FOR_PROJECT' });
    expect(use('project-c', 'files.read')).toMatchObject({ allowed: false, denial: 'NOT_GRANTED_FOR_PROJECT' });
    expect(use('project-a', 'team.admin')).toMatchObject({ allowed: false, denial: 'CAPABILITY_NOT_GRANTED' });

    // A project cannot be granted more than the connection holds, and only the owner grants.
    expect(grantProjectAccess(state, { userId: USER, projectId: 'project-c', connectionId: connection.connectionId, capabilities: ['team.admin'], expiresAt: '2099-01-01T00:00:00.000Z' }, clock()).ok).toBe(false);
    expect(grantProjectAccess(state, { userId: OTHER, projectId: 'project-c', connectionId: connection.connectionId, capabilities: ['files.read'], expiresAt: '2099-01-01T00:00:00.000Z' }, clock()).ok).toBe(false);

    const scopes = (projectId: string) => projectConnectionsSurface(state, { viewerUserId: USER, projectId, tasks: [] }, clock()).services.find((s) => s.connectorId === 'dev-figma')!.projectScope;
    expect(scopes('project-a')).toEqual(['files.read', 'design.write']);
    expect(scopes('project-b')).toEqual(['files.read']);
    expect(scopes('project-c')).toEqual([]);
  });

  it('a project asking for what the connection already holds needs only the project grant, not a new authorization', () => {
    let state = connect(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read', 'design.write'], 'project-a');
    const asked = ask(state, 'dev-figma', ['files.read'], 'project-b');
    expect(asked.request.humanStep).toContain('existing');
    expect(latestConnection(asked.state, USER, 'dev-figma')?.state).toBe('CONNECTED');
    state = must(approveRequest(asked.state, { requestId: asked.request.requestId, userId: USER }, clock()));
    expect(state.requests.find((r) => r.requestId === asked.request.requestId)?.state).toBe('SATISFIED');
    expect(needsAuthorization(state, asked.request.requestId)).toBe(false);
    expect(authorizeCapabilityUse(state, { userId: USER, projectId: 'project-b', connectorId: 'dev-figma', capability: 'files.read' }, clock()).allowed).toBe(true);
    expect(authorizeCapabilityUse(state, { userId: USER, projectId: 'project-b', connectorId: 'dev-figma', capability: 'design.write' }, clock()).allowed).toBe(false);
    expect(state.connections).toHaveLength(1);
  });

  it('revoking the connection revokes every project grant hanging from it', () => {
    let state = connect(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read'], 'project-a');
    const connection = latestConnection(state, USER, 'dev-figma')!;
    state = must(grantProjectAccess(state, { userId: USER, projectId: 'project-b', connectionId: connection.connectionId, capabilities: ['files.read'], expiresAt: '2099-01-01T00:00:00.000Z' }, clock()));
    expect(revokeConnection(state, { connectionId: connection.connectionId, userId: OTHER }, clock()).ok).toBe(false);
    state = must(revokeConnection(state, { connectionId: connection.connectionId, userId: USER }, clock()));
    for (const projectId of ['project-a', 'project-b']) {
      expect(authorizeCapabilityUse(state, { userId: USER, projectId, connectorId: 'dev-figma', capability: 'files.read' }, clock()).allowed).toBe(false);
    }
  });
});

describe('julius connect: failure states drive behaviour', () => {
  it('rate limited or unavailable: Julius waits without re-authorizing, and resumes when the connection comes back', () => {
    let state = connect(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read', 'design.write']);
    const connection = latestConnection(state, USER, 'dev-figma')!;
    let task = startConnectTask(DESIGN_SYNC_TEMPLATE, { taskId: 'task-r', missionId: 'mission-r', projectId: 'project-a', userId: USER }, clock().at);
    ({ state, task } = advanceConnectTask(state, task, clock()));
    expect(task.cursor).toBe(1);

    state = must(setConnectionHealth(state, { connectionId: connection.connectionId, to: 'RATE_LIMITED', detail: 'Development rate limit.' }, clock()));
    ({ state, task } = advanceConnectTask(state, task, clock()));
    expect(task).toMatchObject({ runState: 'BLOCKED', cursor: 1 });
    expect(task.blocked?.denial).toBe('RATE_LIMITED');
    expect(state.requests.filter((r) => r.state === 'AWAITING_USER')).toHaveLength(0);

    state = must(setConnectionHealth(state, { connectionId: connection.connectionId, to: 'UNAVAILABLE', detail: 'Development outage.' }, clock()));
    ({ state, task } = run(state, task, 2));
    expect(task.runState).toBe('BLOCKED');

    state = must(setConnectionHealth(state, { connectionId: connection.connectionId, to: 'CONNECTED', detail: 'Back.' }, clock()));
    ({ state, task } = run(state, task, 2));
    expect(task.runState).toBe('EXECUTING');
    expect(task.cursor).toBe(2);
  });

  it('expired: the gate refuses and Julius asks to reconnect the same connection', () => {
    let state = connect(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read']);
    const connection = latestConnection(state, USER, 'dev-figma')!;
    state = must(setConnectionHealth(state, { connectionId: connection.connectionId, to: 'EXPIRED', detail: 'The development token expired.' }, clock()));
    expect(authorizeCapabilityUse(state, { userId: USER, projectId: 'project-a', connectorId: 'dev-figma', capability: 'files.read' }, clock())).toMatchObject({ allowed: false, denial: 'EXPIRED' });
    const asked = ask(state, 'dev-figma', ['files.read']);
    expect(latestConnection(asked.state, USER, 'dev-figma')).toMatchObject({ connectionId: connection.connectionId, state: 'AUTHORIZATION_REQUIRED' });
    expect(asked.state.connections).toHaveLength(1);
  });

  it('a project grant that has expired is refused even while the connection is connected', () => {
    let state = connect(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read']);
    const connection = latestConnection(state, USER, 'dev-figma')!;
    state = must(grantProjectAccess(state, { userId: USER, projectId: 'project-b', connectionId: connection.connectionId, capabilities: ['files.read'], expiresAt: '2026-01-01T00:00:00.000Z' }, clock()));
    expect(authorizeCapabilityUse(state, { userId: USER, projectId: 'project-b', connectorId: 'dev-figma', capability: 'files.read' }, clock())).toMatchObject({ allowed: false, denial: 'EXPIRED' });
  });

  it('only legal edges exist, and every state has its edges declared', () => {
    for (const s of CONNECT_STATES) expect(CONNECT_EDGES[s]).toBeDefined();
    expect(isLegalConnectTransition('NOT_CONNECTED', 'CONNECTED')).toBe(false);
    expect(isLegalConnectTransition('REVOKED', 'CONNECTED')).toBe(false);
    const state = connect(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read']);
    const connection = latestConnection(state, USER, 'dev-figma')!;
    const expired = must(setConnectionHealth(state, { connectionId: connection.connectionId, to: 'EXPIRED', detail: 'x' }, clock()));
    expect(setConnectionHealth(expired, { connectionId: connection.connectionId, to: 'CONNECTED', detail: 'x' }, clock()).ok).toBe(false);
  });
});

describe('julius connect: registry and routes', () => {
  it('every route shape has a development connector, labelled and chosen correctly', () => {
    const shapes = [
      ['dev-figma', 'oauth_api', 'AUTHORIZATION_REQUIRED', ['files.read']],
      ['dev-insight-mcp', 'mcp', 'AUTHORIZATION_REQUIRED', ['insight.query']],
      ['dev-postgres', 'api_credential', 'CREDENTIAL_REQUIRED', ['db.read', 'db.write']],
      ['dev-legacy-portal', 'browser_computer', 'AUTHORIZATION_REQUIRED', ['portal.read']],
    ] as const;
    for (const [connectorId, route, waitState, capabilities] of shapes) {
      const connector = findConnector(connectorId)!;
      expect(connector.development).toBe(true);
      expect(chooseConnectRoute(connector)?.route).toBe(route);
      const asked = ask(EMPTY_JULIUS_CONNECT_STATE, connectorId, [...capabilities]);
      expect(asked.request.route).toBe(route);
      expect(latestConnection(asked.state, USER, connectorId)?.state).toBe(waitState);
      const surface = projectConnectionsSurface(asked.state, { viewerUserId: USER, projectId: 'project-a', tasks: [] }, clock());
      expect(surface.prompt?.kind).toBe('DEVELOPMENT CONNECTOR');
      if (route === 'api_credential') {
        expect(surface.prompt?.headline).toBe('EXTERNAL CREDENTIAL REQUIRED: PROJECT DATABASE (DEVELOPMENT)');
        expect(surface.prompt?.credentialFlow).toBe(true);
      }
      if (route === 'mcp') expect(asked.request.prepared.some((p) => p.label.includes('dev-insight-mcp'))).toBe(true);
      const connected = connect(EMPTY_JULIUS_CONNECT_STATE, connectorId, [...capabilities]);
      for (const capability of capabilities) {
        expect(authorizeCapabilityUse(connected, { userId: USER, projectId: 'project-a', connectorId, capability }, clock()).allowed).toBe(true);
      }
    }
  });

  it('real services are described truthfully and never claimed connected', () => {
    for (const id of ['github', 'figma', 'slack', 'google-drive', 'linear', 'vercel']) {
      const connector = findConnector(id)!;
      expect(connector.development).toBe(false);
      expect(chooseConnectRoute(connector)).toBeNull();
      const outcome = must(requestCapabilities(EMPTY_JULIUS_CONNECT_STATE, { userId: USER, projectId: 'project-a', missionId: null, taskId: null, connectorId: id, capabilities: [connector.capabilities[0].capabilityId], purpose: 'x' }, clock()));
      expect(outcome.kind).toBe('no_route');
      expect(outcome.state.connections).toHaveLength(0);
    }
    const surface = projectConnectionsSurface(EMPTY_JULIUS_CONNECT_STATE, { viewerUserId: USER, projectId: 'project-a', tasks: [] }, clock());
    const github = surface.services.find((s) => s.connectorId === 'github')!;
    expect(github).toMatchObject({ kind: 'REAL SERVICE', stateLabel: 'INTEGRATION NOT BUILT', reachable: false, canConnect: false });
    expect(github.unavailableReason).toContain('not built');
    expect(surface.services.length).toBe(JULIUS_CONNECT_REGISTRY.length);
  });

  it('the social app is reached through the governed browser, and only read and write capabilities are asked for', () => {
    const connector = findConnector('dev-social')!;
    expect(connector.development).toBe(true);
    expect(chooseConnectRoute(connector)?.route).toBe('browser_computer');
    const asked = ask(EMPTY_JULIUS_CONNECT_STATE, 'dev-social', ['profile.read', 'posts.read', 'posts.create']);
    expect(asked.request.requested).toEqual(['profile.read', 'posts.read', 'posts.create']);
    expect(asked.request.notRequested).toEqual(expect.arrayContaining(['account.settings', 'posts.delete']));
    expect(asked.request.humanStep).toContain('governed browser');
  });

  it('nothing is published until the browser connection is authorized', () => {
    let state = EMPTY_JULIUS_CONNECT_STATE;
    let task = startConnectTask(SOCIAL_POST_TEMPLATE, { taskId: 'task-s', missionId: 'mission-s', projectId: 'project-a', userId: USER }, clock().at);
    ({ state, task } = advanceConnectTask(state, task, clock()));
    expect(task.runState).toBe('BLOCKED');
    expect(task.blocked?.capabilities).toEqual(['profile.read', 'posts.read', 'posts.create']);
    expect(auditAction(state, 'capability.used')).toHaveLength(0);
    const request = state.requests[0];
    state = must(approveRequest(state, { requestId: request.requestId, userId: USER }, clock()));
    state = must(completeAuthorization(state, { requestId: request.requestId, outcome: devAuthorized(['profile.read', 'posts.read', 'posts.create']) }, clock()));
    ({ state, task } = run(state, task, 12));
    expect(task.runState).toBe('COMPLETED');
    // The publish step ran twice through the gate (the caption and the post itself), each use recorded.
    expect(auditAction(state, 'capability.used').filter((e) => e.capability === 'posts.create')).toHaveLength(2);
  });

  it('discovers by what the user says, and never requests admin or destructive capabilities on their behalf', () => {
    expect(discoverConnectors('design')[0]?.connectorId).toBe('dev-figma');
    expect(discoverConnectors('database').map((c) => c.connectorId)).toContain('dev-postgres');
    expect(discoverConnectors('')).toEqual([]);
    const adminOnly = requestCapabilities(EMPTY_JULIUS_CONNECT_STATE, { userId: USER, projectId: 'project-a', missionId: null, taskId: null, connectorId: 'dev-figma', capabilities: ['team.admin', 'files.delete'], purpose: 'x' }, clock());
    expect(adminOnly.ok).toBe(false);
    const mixed = ask(EMPTY_JULIUS_CONNECT_STATE, 'dev-figma', ['files.read', 'files.delete']);
    expect(mixed.request.requested).toEqual(['files.read']);
    expect(mixed.request.notRequested).toContain('files.delete');
    expect(requestCapabilities(EMPTY_JULIUS_CONNECT_STATE, { userId: USER, projectId: 'project-a', missionId: null, taskId: null, connectorId: 'dev-figma', capabilities: ['nope.read'], purpose: 'x' }, clock()).ok).toBe(false);
  });

  it('connects several services at once: one setup row per service Julius is waiting on', () => {
    let state = EMPTY_JULIUS_CONNECT_STATE;
    for (const [connectorId, capability] of [['dev-figma', 'files.read'], ['dev-insight-mcp', 'insight.query'], ['dev-postgres', 'db.read'], ['dev-legacy-portal', 'portal.read']] as const) {
      state = ask(state, connectorId, [capability]).state;
    }
    const surface = projectConnectionsSurface(state, { viewerUserId: USER, projectId: 'project-a', tasks: [] }, clock());
    expect(surface.setup.map((r) => r.connectorId)).toEqual(['dev-figma', 'dev-insight-mcp', 'dev-postgres', 'dev-legacy-portal']);
    expect(surface.services.filter((s) => s.awaitingUser)).toHaveLength(4);
    // Asking again for the same service returns the same request rather than a second prompt.
    const again = ask(state, 'dev-figma', ['files.read']);
    expect(again.state.requests).toHaveLength(4);
  });
});

describe('julius connect: no secret material anywhere', () => {
  it('refuses secret-shaped authorization outcomes and withholds secret-shaped text from the record', () => {
    const asked = ask(EMPTY_JULIUS_CONNECT_STATE, 'dev-postgres', ['db.read']);
    const approved = must(approveRequest(asked.state, { requestId: asked.request.requestId, userId: USER }, clock()));
    const leaked = completeAuthorization(approved, { requestId: asked.request.requestId, outcome: { kind: 'authorized', credentialRef: 'sk-abcdefghijklmnop', accountLabel: 'db', grantedCapabilities: ['db.read'], expiresAt: '2099-01-01T00:00:00.000Z' } }, clock());
    expect(leaked.ok).toBe(false);

    const sneaky = must(requestCapabilities(EMPTY_JULIUS_CONNECT_STATE, { userId: USER, projectId: 'project-a', missionId: null, taskId: null, connectorId: 'dev-figma', capabilities: ['files.read'], purpose: 'use api_key: hunter2hunter2' }, clock()));
    expect(JSON.stringify(sneaky.state)).not.toContain('hunter2');
  });

  it('the surface never carries a credential reference, even when every connection is connected', () => {
    let state = EMPTY_JULIUS_CONNECT_STATE;
    state = connect(state, 'dev-figma', ['files.read', 'design.write']);
    state = connect(state, 'dev-postgres', ['db.read']);
    state = connect(state, 'dev-insight-mcp', ['insight.query']);
    expect(state.connections.every((c) => c.credentialRef?.startsWith('vault://'))).toBe(true);
    const surface = projectConnectionsSurface(state, { viewerUserId: USER, projectId: 'project-a', tasks: [] }, clock());
    const text = JSON.stringify(surface);
    expect(text).not.toContain('vault://');
    expect(text).not.toContain('credentialRef');
    expect(surface.audit.length).toBeGreaterThan(0);
    for (const event of state.audit) expect(event.detail).not.toContain('vault://');
  });
});
