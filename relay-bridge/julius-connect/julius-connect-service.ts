import {
  CONNECT_TASK_TEMPLATES,
  EMPTY_JULIUS_CONNECT_STATE,
  advanceConnectTask,
  approveRequest,
  authorizeCapabilityUse,
  completeAuthorization,
  declineRequest,
  discoverConnectors,
  findConnector,
  needsAuthorization,
  projectConnectionsSurface,
  recordCapabilityUse,
  requestCapabilities,
  revokeConnection,
  setConnectionHealth,
  startConnectTask,
  type ConnectClock,
  type ConnectTask,
  type ConnectionsSurface,
  type JuliusConnectState,
} from '../../src/relay/mission/julius-connect';
import { fail, ok, relayError, type RelayResult } from '../../src/relay/protocol/errors';
import { createDevelopmentAuthorizer, createDevelopmentStepExecutor, type DevelopmentAuthorizer } from './development-connectors';
import type { LiveBrowser } from './live-browser';
import { createWebStepExecutor } from './web-step-executor';
import { createDevelopmentCredentialVault, type DevelopmentCredentialVault } from './development-vault';

/**
 * JULIUS CONNECT — THE DEVELOPMENT SERVICE.
 *
 * One Julius, one connection model, running live: the pure domain holds the truth, this service owns the clock, the
 * vault, the development connector runtime and Julius's task ticker, and every client -- each Wonder Web window in
 * Wonderland -- is a VIEW of it. Windows read the same surface and send intents; none of them holds authority, so two
 * windows can never disagree about what Julius may do.
 *
 * Intents are the user's decisions and requests (start a task, approve, not now, revoke, connect) plus DEVELOPMENT
 * controls that push a connection into a failure state, so the failure behaviour can be seen. Every decision still
 * goes through the domain: this file adds timing, not rules.
 */

export const JULIUS_CONNECT_SERVICE_SCHEMA = 'relay-julius-connect-service.v1' as const;

export interface JuliusConnectServiceOptions {
  readonly userId: string;
  readonly projectId: string;
  readonly now?: () => Date;
  /** How long the development authorization takes after approval, so CONNECTING is a state you can see. */
  readonly authorizationMs?: number;
  /** The pace of Julius's development task steps. */
  readonly stepMs?: number;
  /**
   * The real browser, when this service has one. With it, the `open-web` connector's steps are real work on real sites;
   * without it, a task that needs it fails honestly rather than pretending to have browsed.
   */
  readonly browser?: LiveBrowser;
}

export interface JuliusConnectServiceView {
  readonly schema: typeof JULIUS_CONNECT_SERVICE_SCHEMA;
  readonly mode: 'DEVELOPMENT';
  /** Bumps on every change, so a client can skip an identical redraw. */
  readonly revision: number;
  readonly surface: ConnectionsSurface;
}

export interface JuliusConnectService {
  view(): JuliusConnectServiceView;
  intent(body: unknown): RelayResult<JuliusConnectServiceView>;
  tick(): void;
  /** For proof only: counts, never material. */
  vaultResolutions(): number;
}

const TOKEN = /^[A-Za-z0-9_.:-]{1,80}$/;
const HEALTH_TARGETS = ['CONNECTED', 'EXPIRED', 'RATE_LIMITED', 'UNAVAILABLE', 'FAILED', 'RECONNECT_REQUIRED'] as const;
type HealthTarget = (typeof HEALTH_TARGETS)[number];

function field(body: Record<string, unknown>, name: string): string | null {
  const value = body[name];
  return typeof value === 'string' && TOKEN.test(value) ? value : null;
}

export function createJuliusConnectService(options: JuliusConnectServiceOptions): JuliusConnectService {
  const now = options.now ?? (() => new Date());
  const authorizationMs = options.authorizationMs ?? 1400;
  const stepMs = options.stepMs ?? 2400;
  const vault: DevelopmentCredentialVault = createDevelopmentCredentialVault();
  const authorizer: DevelopmentAuthorizer = createDevelopmentAuthorizer(vault);
  const executeDevelopment = createDevelopmentStepExecutor(vault);
  const executeWeb = options.browser ? createWebStepExecutor(options.browser) : null;
  // ONE RUNNER PER KIND OF WORK, chosen by the connector: the development connectors contact nothing, and `open-web` is
  // a real browser on real sites. Nothing routes a development step into the real browser, or the other way about.
  const execute: typeof executeDevelopment = (input) => {
    if (input.step.connectorId !== 'open-web') {
      return executeDevelopment(input);
    }
    return executeWeb
      ? executeWeb(input)
      : { outcome: 'failed', detail: 'This service was started without the real browser, so Julius cannot browse.' };
  };

  let state: JuliusConnectState = EMPTY_JULIUS_CONNECT_STATE;
  let tasks: ConnectTask[] = [];
  let authorizing: { requestId: string; dueAt: number }[] = [];
  const lastStepAt = new Map<string, number>();
  let revision = 1;
  let taskCounter = 0;

  const clock = (): ConnectClock => ({ at: now().toISOString() });
  const changed = () => {
    revision += 1;
  };
  const view = (): JuliusConnectServiceView => ({
    schema: JULIUS_CONNECT_SERVICE_SCHEMA,
    mode: 'DEVELOPMENT',
    revision,
    surface: projectConnectionsSurface(state, { viewerUserId: options.userId, projectId: options.projectId, tasks }, clock()),
  });
  const apply = (result: RelayResult<JuliusConnectState>): RelayResult<JuliusConnectServiceView> => {
    if (!result.ok) return result;
    state = result.value;
    changed();
    return ok(view());
  };

  /** The capabilities to ask for when the user says "connect X": what a waiting task needs, else the connector's everyday set. */
  const neededFor = (connectorId: string): { capabilities: string[]; task: ConnectTask | null } => {
    const task = tasks.find((t) => t.runState === 'BLOCKED' && t.blocked?.connectorId === connectorId) ?? null;
    if (task?.blocked) return { capabilities: [...task.blocked.capabilities], task };
    const connector = findConnector(connectorId);
    return { capabilities: connector ? connector.capabilities.filter((c) => c.risk === 'read' || c.risk === 'write').map((c) => c.capabilityId) : [], task: null };
  };

  const intents: Record<string, (body: Record<string, unknown>) => RelayResult<JuliusConnectServiceView>> = {
    start_task(body) {
      const templateId = field(body, 'templateId') ?? 'design-sync';
      const template = CONNECT_TASK_TEMPLATES.find((t) => t.templateId === templateId);
      if (!template) return fail(relayError('not-found', `No task template ${templateId}.`));
      if (tasks.some((t) => t.templateId === templateId && t.runState !== 'COMPLETED' && t.runState !== 'FAILED' && t.runState !== 'CANCELLED')) {
        return fail(relayError('duplicate-task', 'Julius is already running that task.'));
      }
      taskCounter += 1;
      const task = startConnectTask(template, {
        taskId: `task-${taskCounter}`, missionId: `mission-connect-${taskCounter}`, projectId: options.projectId, userId: options.userId,
      }, clock().at);
      tasks = [...tasks.slice(-3), task];
      lastStepAt.set(task.taskId, now().getTime());
      changed();
      return ok(view());
    },
    approve(body) {
      const requestId = field(body, 'requestId');
      if (!requestId) return fail(relayError('validation-failed', 'approve needs a requestId.'));
      const result = approveRequest(state, { requestId, userId: options.userId }, clock());
      if (!result.ok) return result;
      state = result.value;
      if (needsAuthorization(state, requestId)) authorizing = [...authorizing, { requestId, dueAt: now().getTime() + authorizationMs }];
      changed();
      return ok(view());
    },
    decline(body) {
      const requestId = field(body, 'requestId');
      if (!requestId) return fail(relayError('validation-failed', 'decline needs a requestId.'));
      return apply(declineRequest(state, { requestId, userId: options.userId }, clock()));
    },
    revoke(body) {
      const connectionId = field(body, 'connectionId');
      if (!connectionId) return fail(relayError('validation-failed', 'revoke needs a connectionId.'));
      const connection = state.connections.find((c) => c.connectionId === connectionId);
      const result = revokeConnection(state, { connectionId, userId: options.userId }, clock());
      // The record drops the reference; the vault destroys what it named.
      if (result.ok && connection?.credentialRef) vault.revoke(connection.credentialRef);
      return apply(result);
    },
    /** "Connect X": by connector id, or by what the user calls it -- Julius works out which connector that is. */
    connect(body) {
      let connectorId = field(body, 'connectorId');
      const name = typeof body.name === 'string' && /^[A-Za-z0-9 ._-]{1,60}$/.test(body.name) ? body.name : null;
      if (!connectorId && name) {
        const found = discoverConnectors(name);
        if (found.length === 0) return fail(relayError('not-found', `Julius knows no service called "${name}".`));
        connectorId = found[0].connectorId;
      }
      if (!connectorId) return fail(relayError('validation-failed', 'connect needs a connectorId or a name.'));
      const { capabilities, task } = neededFor(connectorId);
      const result = requestCapabilities(state, {
        userId: options.userId, projectId: options.projectId, missionId: task?.missionId ?? null, taskId: task?.taskId ?? null, connectorId, capabilities,
        purpose: task ? task.purpose : 'You asked Julius to connect it',
      }, clock());
      if (!result.ok) return result;
      state = result.value.state;
      changed();
      return ok(view());
    },
    /** Ask the gate, on the record, whether Julius may use a capability right now -- the visible proof after a revoke. */
    probe(body) {
      const connectorId = field(body, 'connectorId');
      const capability = field(body, 'capability');
      if (!connectorId || !capability) return fail(relayError('validation-failed', 'probe needs a connectorId and a capability.'));
      const decision = authorizeCapabilityUse(state, { userId: options.userId, projectId: options.projectId, connectorId, capability }, clock());
      let outcome: 'success' | 'failed' = 'success';
      let detail = `Access check: ${capability} is available to Julius.`;
      if (decision.allowed) {
        const credential = vault.resolveForExecution({ credentialRef: decision.credentialRef, connectionId: decision.connectionId, capability });
        if (credential === null) {
          outcome = 'failed';
          detail = `Access check: the credential for ${capability} no longer resolves.`;
        }
      } else {
        detail = `Access check: Julius cannot use ${capability}`;
      }
      state = recordCapabilityUse(state, { userId: options.userId, projectId: options.projectId, missionId: null, connectorId, capability, decision, outcome, detail }, clock());
      changed();
      return ok(view());
    },
    /** DEVELOPMENT CONTROL: push a connection into a health state so its effect on Julius can be seen. */
    dev_set_health(body) {
      const connectionId = field(body, 'connectionId');
      const to = field(body, 'to');
      if (!connectionId || !to || !(HEALTH_TARGETS as readonly string[]).includes(to)) {
        return fail(relayError('validation-failed', `dev_set_health needs a connectionId and one of ${HEALTH_TARGETS.join(', ')}.`));
      }
      return apply(setConnectionHealth(state, { connectionId, to: to as HealthTarget, detail: 'Development control.' }, clock()));
    },
    /** DEVELOPMENT CONTROL: the next authorization fails. */
    dev_fail_next_authorization() {
      authorizer.failNext('The development authorization was refused (development control).');
      return ok(view());
    },
    reset() {
      for (const connection of state.connections) if (connection.credentialRef) vault.revoke(connection.credentialRef);
      state = EMPTY_JULIUS_CONNECT_STATE;
      tasks = [];
      authorizing = [];
      lastStepAt.clear();
      changed();
      return ok(view());
    },
  };

  return {
    view,
    vaultResolutions: () => vault.resolutions(),
    intent(body) {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return fail(relayError('validation-failed', 'An intent is a JSON object.'));
      const record = body as Record<string, unknown>;
      const name = field(record, 'intent');
      const handler = name !== null && Object.prototype.hasOwnProperty.call(intents, name) ? intents[name] : undefined;
      if (!handler) return fail(relayError('validation-failed', `Unknown intent. Known: ${Object.keys(intents).join(', ')}.`));
      return handler(record);
    },
    tick() {
      const t = now().getTime();
      // Authorizations the user approved complete when due.
      const due = authorizing.filter((a) => a.dueAt <= t);
      if (due.length > 0) {
        authorizing = authorizing.filter((a) => a.dueAt > t);
        for (const { requestId } of due) {
          const request = state.requests.find((r) => r.requestId === requestId);
          const connector = request ? findConnector(request.connectorId) : null;
          if (!request || !connector || request.state !== 'APPROVED') continue;
          const outcome = authorizer.authorize({ connector, request, at: clock().at });
          const completed = completeAuthorization(state, { requestId, outcome }, clock());
          if (completed.ok) state = completed.value;
          changed();
        }
      }
      // Julius works: each running task takes a step when its pace allows.
      tasks = tasks.map((task) => {
        if (task.runState === 'COMPLETED' || task.runState === 'FAILED' || task.runState === 'CANCELLED') return task;
        const last = lastStepAt.get(task.taskId) ?? 0;
        if (t - last < stepMs) return task;
        lastStepAt.set(task.taskId, t);
        const before = { state, task };
        const advanced = advanceConnectTask(state, task, clock(), execute);
        state = advanced.state;
        if (advanced.state !== before.state || advanced.task !== before.task) changed();
        return advanced.task;
      });
    },
  };
}
