import {
  CONNECT_ROUTE_LABELS,
  CONNECT_STATE_LABELS,
  connectionKindLabel,
  isLegalConnectTransition,
  type CapabilityRisk,
  type ConnectAuditEvent,
  type ConnectState,
  type ConnectorDescriptor,
  type JuliusConnectState,
} from './connect-contracts';
import { authorizeCapabilityUse, isSecretShaped, latestConnection, type ConnectClock } from './connect-lifecycle';
import type { ConnectTask } from './connect-mission';
import { chooseConnectRoute, JULIUS_CONNECT_REGISTRY } from './connect-registry';

/**
 * JULIUS CONNECT — THE CONNECTIONS SURFACE, as a read model.
 *
 * What Wonder Web's CONNECTIONS workspace draws, projected for ONE viewer and ONE project from the actual connection
 * state: every service with its state, route, account, granted and denied capabilities, this project's scope, the
 * missions using it, health, last activity, and whether reconnect and revoke are live; the authorization Julius is waiting
 * on; Julius's tasks; and the audit trail. It decides nothing -- the gate does -- and it carries no credential material:
 * `assertConnectionsSurfaceIsSafe` proves it before anything is sent.
 */

export const CONNECTIONS_SURFACE_SCHEMA = 'relay-julius-connect-surface.v1' as const;

export interface ConnectionsSurfaceCapability {
  readonly capabilityId: string;
  readonly label: string;
  readonly risk: CapabilityRisk;
}

export interface ConnectionsSurfaceService {
  readonly connectorId: string;
  readonly displayName: string;
  readonly kind: 'DEVELOPMENT CONNECTOR' | 'REAL SERVICE';
  readonly connectionId: string | null;
  readonly state: ConnectState;
  readonly stateLabel: string;
  /** False when this build cannot reach the service at all; then `unavailableReason` says why. */
  readonly reachable: boolean;
  readonly unavailableReason: string | null;
  readonly routeLabel: string;
  readonly accountLabel: string | null;
  readonly granted: readonly string[];
  readonly denied: readonly string[];
  /** What THIS project may use right now, as the gate answers it. */
  readonly projectScope: readonly string[];
  readonly missions: readonly string[];
  readonly healthDetail: string;
  readonly lastActivityAt: string | null;
  readonly canRevoke: boolean;
  /** The user may ask Julius to connect (or reconnect) it now: `connectLabel` says which. */
  readonly canConnect: boolean;
  readonly connectLabel: 'CONNECT' | 'RECONNECT';
  /** Julius is already waiting on the user for this service. */
  readonly awaitingUser: boolean;
}

export interface ConnectionsSurfacePrompt {
  readonly requestId: string;
  /** `EXTERNAL CAPABILITY REQUIRED` when a mission is waiting on it. */
  readonly banner: string;
  readonly headline: string;
  readonly kind: 'DEVELOPMENT CONNECTOR' | 'REAL CONNECTION';
  readonly connectorId: string;
  readonly displayName: string;
  readonly routeLabel: string;
  readonly neededFor: string;
  readonly missionId: string | null;
  readonly requested: readonly ConnectionsSurfaceCapability[];
  readonly notRequested: readonly ConnectionsSurfaceCapability[];
  readonly juliusDid: readonly string[];
  readonly humanStep: string;
  readonly credentialFlow: boolean;
}

/** One line of CONNECTION SETUP: everything Julius is waiting on the user for, when it is connecting several at once. */
export interface ConnectionsSurfaceSetupRow {
  readonly requestId: string;
  readonly connectorId: string;
  readonly displayName: string;
  readonly kind: 'DEVELOPMENT CONNECTOR' | 'REAL CONNECTION';
  readonly routeLabel: string;
  readonly humanStep: string;
}

export interface ConnectionsSurfaceTask {
  readonly taskId: string;
  readonly missionId: string;
  readonly title: string;
  readonly runState: string;
  readonly stepLabel: string;
  readonly progress: number;
  readonly total: number;
  readonly blockedReason: string | null;
  readonly blockedOn: readonly string[];
  /** Julius's own account of the run, newest last: the run state machine's transitions. */
  readonly timeline: readonly { readonly at: string; readonly state: string; readonly summary: string }[];
}

export interface ConnectionsSurfaceAuditRow {
  readonly at: string;
  readonly actor: ConnectAuditEvent['actor'];
  readonly action: ConnectAuditEvent['action'];
  readonly service: string;
  readonly capability: string | null;
  readonly outcome: ConnectAuditEvent['outcome'];
  readonly detail: string;
  readonly projectId: string | null;
  readonly missionId: string | null;
  readonly connectionId: string | null;
}

export interface ConnectionsSurface {
  readonly schema: typeof CONNECTIONS_SURFACE_SCHEMA;
  readonly title: 'JULIUS CONNECT';
  readonly observedAt: string;
  readonly viewerUserId: string;
  readonly projectId: string;
  readonly notice: string;
  readonly services: readonly ConnectionsSurfaceService[];
  readonly prompt: ConnectionsSurfacePrompt | null;
  readonly setup: readonly ConnectionsSurfaceSetupRow[];
  readonly tasks: readonly ConnectionsSurfaceTask[];
  readonly audit: readonly ConnectionsSurfaceAuditRow[];
}

const RECONNECTABLE: ReadonlySet<ConnectState> = new Set(['NOT_CONNECTED', 'REVOKED', 'FAILED', 'EXPIRED', 'RECONNECT_REQUIRED']);

function capabilityRows(connector: ConnectorDescriptor, ids: readonly string[]): ConnectionsSurfaceCapability[] {
  return ids.map((id) => {
    const found = connector.capabilities.find((c) => c.capabilityId === id);
    return { capabilityId: id, label: found?.label ?? id, risk: found?.risk ?? 'read' };
  });
}

export function projectConnectionsSurface(
  state: JuliusConnectState,
  input: { viewerUserId: string; projectId: string; tasks: readonly ConnectTask[] },
  clock: ConnectClock,
): ConnectionsSurface {
  const registry = clock.registry ?? JULIUS_CONNECT_REGISTRY;
  const displayName = (connectorId: string) => registry.find((c) => c.connectorId === connectorId)?.displayName ?? connectorId;

  const services: ConnectionsSurfaceService[] = registry.map((connector) => {
    const connection = latestConnection(state, input.viewerUserId, connector.connectorId);
    const route = chooseConnectRoute(connector);
    const preferred = connector.routes[0];
    const projectScope = connection === null ? [] : connection.grantedCapabilities.filter((capability) =>
      authorizeCapabilityUse(state, { userId: input.viewerUserId, projectId: input.projectId, connectorId: connector.connectorId, capability }, clock).allowed);
    const missions = [...new Set(state.audit.filter((e) => e.connectorId === connector.connectorId && e.missionId !== null).map((e) => e.missionId as string))];
    const connectionState: ConnectState = connection?.state ?? 'NOT_CONNECTED';
    const awaitingUser = state.requests.some((r) => r.state === 'AWAITING_USER' && r.userId === input.viewerUserId && r.connectorId === connector.connectorId);
    return {
      connectorId: connector.connectorId,
      displayName: connector.displayName,
      kind: connector.development ? 'DEVELOPMENT CONNECTOR' : 'REAL SERVICE',
      connectionId: connection?.connectionId ?? null,
      state: connectionState,
      stateLabel: route === null && connection === null ? 'INTEGRATION NOT BUILT' : CONNECT_STATE_LABELS[connectionState],
      reachable: route !== null,
      unavailableReason: route === null ? (preferred?.unavailableReason ?? 'No route is available.') : null,
      routeLabel: CONNECT_ROUTE_LABELS[(connection?.route ?? route?.route ?? preferred?.route) ?? 'oauth_api'],
      accountLabel: connection?.accountLabel ?? null,
      granted: connection?.grantedCapabilities ?? [],
      denied: connection?.deniedCapabilities ?? [],
      projectScope,
      missions,
      healthDetail: connection?.health.detail ?? (route === null ? (preferred?.unavailableReason ?? '') : 'Not connected.'),
      lastActivityAt: connection?.lastUsedAt ?? connection?.updatedAt ?? null,
      canRevoke: connection !== null && isLegalConnectTransition(connection.state, 'REVOKED'),
      canConnect: route !== null && !awaitingUser && (connection === null || RECONNECTABLE.has(connection.state)),
      connectLabel: connection === null || connection.state === 'NOT_CONNECTED' ? 'CONNECT' : 'RECONNECT',
      awaitingUser,
    };
  });

  const waiting = state.requests.filter((r) => r.state === 'AWAITING_USER' && r.userId === input.viewerUserId && r.projectId === input.projectId);
  const request = waiting.length > 0 ? waiting[0] : null;
  const connector = request ? registry.find((c) => c.connectorId === request.connectorId) ?? null : null;
  const prompt: ConnectionsSurfacePrompt | null = request && connector ? {
    requestId: request.requestId,
    banner: request.missionId ? 'EXTERNAL CAPABILITY REQUIRED' : 'CONNECTION REQUESTED',
    headline: request.route === 'api_credential' ? `EXTERNAL CREDENTIAL REQUIRED: ${connector.displayName.toUpperCase()}` : `JULIUS WANTS TO CONNECT ${connector.displayName.toUpperCase()}`,
    kind: connectionKindLabel(connector.development),
    connectorId: connector.connectorId,
    displayName: connector.displayName,
    routeLabel: CONNECT_ROUTE_LABELS[request.route],
    neededFor: request.purpose,
    missionId: request.missionId,
    requested: capabilityRows(connector, request.requested),
    notRequested: capabilityRows(connector, request.notRequested),
    juliusDid: request.prepared.filter((p) => p.done).map((p) => p.label),
    humanStep: request.humanStep,
    credentialFlow: request.route === 'api_credential',
  } : null;

  const setup: ConnectionsSurfaceSetupRow[] = waiting.map((r) => {
    const c = registry.find((d) => d.connectorId === r.connectorId);
    return { requestId: r.requestId, connectorId: r.connectorId, displayName: c?.displayName ?? r.connectorId, kind: connectionKindLabel(c?.development ?? false), routeLabel: CONNECT_ROUTE_LABELS[r.route], humanStep: r.humanStep };
  });

  const tasks: ConnectionsSurfaceTask[] = input.tasks.map((task) => ({
    taskId: task.taskId,
    missionId: task.missionId,
    title: task.title,
    runState: task.runState,
    stepLabel: task.steps[Math.min(task.cursor, task.steps.length - 1)]?.label ?? '',
    progress: task.cursor,
    total: task.steps.length,
    blockedReason: task.runState === 'BLOCKED' ? (task.transitions[task.transitions.length - 1]?.reasonCode ?? 'BLOCKED') : null,
    blockedOn: task.blocked?.capabilities ?? [],
    timeline: task.transitions.slice(-6).map((t) => ({ at: t.occurredAt, state: t.to, summary: t.safeSummary })),
  }));

  const audit: ConnectionsSurfaceAuditRow[] = [...state.audit].reverse().slice(0, 16).map((e) => ({
    at: e.at, actor: e.actor, action: e.action, service: displayName(e.connectorId), capability: e.capability, outcome: e.outcome, detail: e.detail,
    projectId: e.projectId, missionId: e.missionId, connectionId: e.connectionId,
  }));

  const surface: ConnectionsSurface = {
    schema: CONNECTIONS_SURFACE_SCHEMA,
    title: 'JULIUS CONNECT',
    observedAt: clock.at,
    viewerUserId: input.viewerUserId,
    projectId: input.projectId,
    notice: 'DEVELOPMENT CONNECTORS ARE PROVIDER-FREE: NO EXTERNAL SERVICE IS CONTACTED. REAL SERVICES SHOW WHERE THEIR INTEGRATION IS NOT BUILT.',
    services,
    prompt,
    setup,
    tasks,
    audit,
  };
  assertConnectionsSurfaceIsSafe(surface);
  return surface;
}

/** Nothing credential-shaped, and no credential reference, ever leaves in a surface. */
export function assertConnectionsSurfaceIsSafe(surface: ConnectionsSurface): void {
  const text = JSON.stringify(surface);
  if (isSecretShaped(text)) throw new Error('connections_surface_carries_secret_shaped_text');
  if (/credentialRef|vault:\/\//.test(text)) throw new Error('connections_surface_carries_a_credential_reference');
}
