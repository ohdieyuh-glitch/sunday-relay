import { fail, ok, relayError, type RelayResult } from '../../protocol/errors';
import { createCredentialHandle, evaluateHandleAccess, revokeHandle, type CredentialHandle } from '../credential-handle';
import {
  CONNECT_ROUTE_LABELS,
  JULIUS_CONNECT_SCHEMA_V1,
  isLegalConnectTransition,
  type CapabilityDecision,
  type CapabilityDenial,
  type CapabilityRequest,
  type ConnectAuditAction,
  type ConnectAuditEvent,
  type ConnectState,
  type Connection,
  type ConnectorDescriptor,
  type JuliusConnectState,
  type PreparedStep,
} from './connect-contracts';
import { chooseConnectRoute, findConnector, JULIUS_CONNECT_REGISTRY, planCapabilityAsk } from './connect-registry';

/**
 * JULIUS CONNECT — THE LIFECYCLE.
 *
 *   request capabilities  ->  discover the connector  ->  choose the route  ->  prepare authorization
 *   ->  (the user crosses the trust boundary)  ->  the adapter completes authorization  ->  CONNECTED + project grant
 *   ->  Julius uses a capability through the gate  ->  audit  ->  revoke  ->  the gate refuses
 *
 * Every function is pure: state in, state out, errors as values, time as an ISO string. The adapter that actually
 * completes an authorization (and the vault that holds the credential) live on the runtime side; this layer only ever
 * sees the OUTCOME -- a credential reference, an account label, the capabilities the service granted.
 */

export interface ConnectClock {
  readonly at: string;
  readonly registry?: readonly ConnectorDescriptor[];
}

/* ------------------------------------------------------------------ safety */

/**
 * NO SECRET TEXT IN THE RECORD. The same shapes credential-handle.ts refuses in a handle definition are refused in any
 * free text that reaches audit or a surface.
 */
const SECRET_VALUE = /(sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{10,}\.|gh[pousr]_[A-Za-z0-9]{20,}|xox[abpr]-[A-Za-z0-9-]{10,})/;
const SECRET_WORD = /\b(password|passwd|api[_-]?key|secret|bearer|private[_-]?key|recovery[_-]?code)\s*[:=]/i;

export function isSecretShaped(text: string): boolean {
  return SECRET_VALUE.test(text) || SECRET_WORD.test(text);
}

function safeText(text: string): string {
  return isSecretShaped(text) ? '[withheld: secret-shaped text is never recorded]' : text;
}

/* ------------------------------------------------------------------- ids */

function nextId(state: JuliusConnectState, prefix: string): { id: string; state: JuliusConnectState } {
  const sequence = state.sequence + 1;
  return { id: `${prefix}_${String(sequence).padStart(4, '0')}`, state: { ...state, sequence } };
}

function audit(state: JuliusConnectState, at: string, event: Omit<ConnectAuditEvent, 'eventId' | 'at' | 'detail'> & { detail: string }): JuliusConnectState {
  const { id, state: next } = nextId(state, 'caud');
  return { ...next, audit: [...next.audit, { ...event, eventId: id, at, detail: safeText(event.detail) }] };
}

function registryOf(clock: ConnectClock): readonly ConnectorDescriptor[] {
  return clock.registry ?? JULIUS_CONNECT_REGISTRY;
}

function replaceConnection(state: JuliusConnectState, connection: Connection): JuliusConnectState {
  return { ...state, connections: state.connections.map((c) => (c.connectionId === connection.connectionId ? connection : c)) };
}

function replaceRequest(state: JuliusConnectState, request: CapabilityRequest): JuliusConnectState {
  return { ...state, requests: state.requests.map((r) => (r.requestId === request.requestId ? request : r)) };
}

function moveConnection(connection: Connection, to: ConnectState, at: string, detail: string, patch: Partial<Connection> = {}): RelayResult<Connection> {
  if (connection.state !== to && !isLegalConnectTransition(connection.state, to)) {
    return fail(relayError('illegal-transition', `A ${connection.state} connection cannot become ${to}.`, { entityIds: { connectionId: connection.connectionId } }));
  }
  return ok({ ...connection, ...patch, state: to, updatedAt: at, version: connection.version + 1, health: { checkedAt: at, detail: safeText(detail) } });
}

/** The user's most recent connection to a connector, whatever its state. */
export function latestConnection(state: JuliusConnectState, userId: string, connectorId: string): Connection | null {
  const mine = state.connections.filter((c) => c.userId === userId && c.connectorId === connectorId);
  return mine.length > 0 ? mine[mine.length - 1] : null;
}

function grantFor(state: JuliusConnectState, projectId: string, connectionId: string): CredentialHandle | null {
  // A handle's service field carries the connection it hangs from; the newest unrevoked one is the project's grant.
  const handles = state.grants.filter((g) => g.projectId === projectId && g.service === connectionId);
  const live = handles.filter((g) => !g.revokedAt);
  return live.length > 0 ? live[live.length - 1] : handles.length > 0 ? handles[handles.length - 1] : null;
}

/* -------------------------------------------------------------------- gate */

/**
 * MAY JULIUS USE THIS CAPABILITY, FOR THIS PROJECT, NOW? Only when the connection is CONNECTED, the service granted the
 * capability, the project holds a live grant that allows it, and a credential reference exists. Every other answer is a
 * named refusal.
 */
export function authorizeCapabilityUse(
  state: JuliusConnectState,
  input: { userId: string; projectId: string; connectorId: string; capability: string },
  clock: ConnectClock,
): CapabilityDecision {
  const connector = findConnector(input.connectorId, registryOf(clock));
  if (connector === null) return { allowed: false, denial: 'UNKNOWN_CONNECTOR', connectionId: null };
  if (!connector.capabilities.some((c) => c.capabilityId === input.capability)) return { allowed: false, denial: 'UNKNOWN_CAPABILITY', connectionId: null };
  const connection = latestConnection(state, input.userId, input.connectorId);
  if (connection === null) return { allowed: false, denial: 'NOT_CONNECTED', connectionId: null };
  if (connection.state !== 'CONNECTED') {
    return { allowed: false, denial: connection.state as CapabilityDenial, connectionId: connection.connectionId };
  }
  if (!connection.grantedCapabilities.includes(input.capability)) {
    return { allowed: false, denial: 'CAPABILITY_NOT_GRANTED', connectionId: connection.connectionId };
  }
  const grant = grantFor(state, input.projectId, connection.connectionId);
  if (grant === null) return { allowed: false, denial: 'NOT_GRANTED_FOR_PROJECT', connectionId: connection.connectionId };
  switch (evaluateHandleAccess(grant, input.capability, clock.at)) {
    case 'allowed':
      break;
    case 'revoked':
      return { allowed: false, denial: 'REVOKED', connectionId: connection.connectionId };
    case 'expired':
      return { allowed: false, denial: 'EXPIRED', connectionId: connection.connectionId };
    case 'requires_manual_task':
      return { allowed: false, denial: 'AUTHORIZATION_REQUIRED', connectionId: connection.connectionId };
    default:
      return { allowed: false, denial: 'NOT_GRANTED_FOR_PROJECT', connectionId: connection.connectionId };
  }
  if (connection.credentialRef === null) return { allowed: false, denial: 'CREDENTIAL_REQUIRED', connectionId: connection.connectionId };
  return { allowed: true, connectionId: connection.connectionId, grantId: grant.credentialHandleId, credentialRef: connection.credentialRef };
}

/** Record that Julius used -- or was refused -- a capability. Attributable, and free of secret material. */
export function recordCapabilityUse(
  state: JuliusConnectState,
  input: { userId: string; projectId: string; missionId: string | null; connectorId: string; capability: string; decision: CapabilityDecision; outcome: 'success' | 'failed'; detail: string },
  clock: ConnectClock,
): JuliusConnectState {
  const connectionId = input.decision.connectionId;
  let next = state;
  if (input.decision.allowed) {
    const connection = next.connections.find((c) => c.connectionId === connectionId);
    if (connection) next = replaceConnection(next, { ...connection, lastUsedAt: clock.at });
  }
  return audit(next, clock.at, {
    actor: 'julius',
    action: input.decision.allowed ? 'capability.used' : 'capability.denied',
    projectId: input.projectId,
    missionId: input.missionId,
    connectionId,
    connectorId: input.connectorId,
    capability: input.capability,
    outcome: input.decision.allowed ? input.outcome : 'denied',
    detail: input.decision.allowed ? input.detail : `${input.detail} -- refused: ${input.decision.denial}`,
  });
}

/* ----------------------------------------------------------------- request */

export type CapabilityRequestOutcome =
  | { readonly kind: 'already_available'; readonly state: JuliusConnectState }
  | { readonly kind: 'temporarily_unavailable'; readonly state: JuliusConnectState; readonly connectionState: ConnectState }
  | { readonly kind: 'awaiting_user'; readonly state: JuliusConnectState; readonly request: CapabilityRequest }
  | { readonly kind: 'no_route'; readonly state: JuliusConnectState; readonly reasons: readonly string[] };

/**
 * JULIUS ASKS FOR WHAT THE WORK NEEDS. It discovers the connector, chooses the route, plans the capabilities (never admin
 * or destructive on the user's behalf), readies the connection and prepares authorization -- everything short of the
 * trust boundary -- and then waits for the user.
 */
export function requestCapabilities(
  state: JuliusConnectState,
  input: { userId: string; projectId: string; missionId: string | null; taskId: string | null; connectorId: string; capabilities: readonly string[]; purpose: string },
  clock: ConnectClock,
): RelayResult<CapabilityRequestOutcome> {
  const connector = findConnector(input.connectorId, registryOf(clock));
  if (connector === null) {
    return fail(relayError('not-found', `No connector named ${input.connectorId} is registered.`, { entityIds: { connectorId: input.connectorId } }));
  }
  const plan = planCapabilityAsk(connector, input.capabilities);
  if (plan.unknown.length > 0) {
    return fail(relayError('validation-failed', `${connector.displayName} has no capability named ${plan.unknown.join(', ')}.`, { details: plan.unknown }));
  }
  if (plan.requested.length === 0) {
    return fail(relayError('permission-denied', `Julius does not request administrative or destructive ${connector.displayName} capabilities on your behalf.`, { details: [...input.capabilities] }));
  }

  // Already there for this project? Then nothing to ask.
  const covered = plan.requested.every((capability) =>
    authorizeCapabilityUse(state, { userId: input.userId, projectId: input.projectId, connectorId: connector.connectorId, capability }, clock).allowed);
  if (covered) return ok({ kind: 'already_available', state });

  // Already asked and waiting? Then that is the prompt.
  const waiting = state.requests.find((r) => r.state === 'AWAITING_USER' && r.userId === input.userId && r.projectId === input.projectId && r.connectorId === connector.connectorId);
  if (waiting) return ok({ kind: 'awaiting_user', state, request: waiting });

  const chosen = chooseConnectRoute(connector);
  if (chosen === null) {
    const reasons = connector.routes.map((r) => `${CONNECT_ROUTE_LABELS[r.route]}: ${r.unavailableReason ?? 'unavailable'}`);
    const refused = audit(state, clock.at, {
      actor: 'julius', action: 'capability.requested', projectId: input.projectId, missionId: input.missionId, connectionId: null,
      connectorId: connector.connectorId, capability: plan.requested.join(','), outcome: 'failed', detail: `No usable route to ${connector.displayName}: ${reasons.join(' | ')}`,
    });
    return ok({ kind: 'no_route', state: refused, reasons });
  }

  // ONE CONNECTION PER ACCOUNT AND CONNECTOR. The request completes the user's existing connection -- a connected one
  // stays connected while it is asked for more, or for a project grant; a revoked, failed, expired or declined one goes
  // back through connecting -- and only when there is none is a connection created.
  let next = state;
  const existing = latestConnection(next, input.userId, connector.connectorId);
  const waitState: ConnectState = chosen.route === 'api_credential' ? 'CREDENTIAL_REQUIRED' : 'AUTHORIZATION_REQUIRED';
  let connection: Connection;
  if (existing !== null && (existing.state === 'RATE_LIMITED' || existing.state === 'UNAVAILABLE' || existing.state === 'CONNECTING')) {
    // A live connection that is only momentarily unusable is not re-authorized; Julius waits for it.
    return ok({ kind: 'temporarily_unavailable', state, connectionState: existing.state });
  }
  if (existing !== null && existing.state === 'CONNECTED') {
    connection = existing;
  } else if (existing !== null) {
    let from = existing;
    if (from.state === 'EXPIRED') {
      const renew = moveConnection(from, 'RECONNECT_REQUIRED', clock.at, 'Expired. Julius is reconnecting it.');
      if (!renew.ok) return renew;
      from = renew.value;
    }
    // Whatever it held before is gone: a fresh authorization grants exactly what it grants.
    const connecting = moveConnection(from, 'CONNECTING', clock.at, 'Julius is preparing the connection.', { route: chosen.route, grantedCapabilities: [], deniedCapabilities: [], credentialRef: null });
    if (!connecting.ok) return connecting;
    const waiting2 = moveConnection(connecting.value, waitState, clock.at, `Waiting on you: ${chosen.humanStep}`);
    if (!waiting2.ok) return waiting2;
    connection = waiting2.value;
    next = replaceConnection(next, connection);
  } else {
    const { id, state: withId } = nextId(next, 'cxn');
    next = withId;
    connection = {
      schemaVersion: JULIUS_CONNECT_SCHEMA_V1, connectionId: id, connectorId: connector.connectorId, userId: input.userId,
      route: chosen.route, state: waitState, accountLabel: null, credentialRef: null, grantedCapabilities: [], deniedCapabilities: [],
      health: { checkedAt: clock.at, detail: `Waiting on you: ${chosen.humanStep}` }, createdAt: clock.at, updatedAt: clock.at, lastUsedAt: null,
      version: 1, provenance: connector.development ? 'simulated' : 'live', development: connector.development,
    };
    next = { ...next, connections: [...next.connections, connection] };
  }

  const projectOnly = connection.state === 'CONNECTED' && plan.requested.every((c) => connection.grantedCapabilities.includes(c));
  const humanStep = projectOnly
    ? `Allow project ${input.projectId} to use your existing ${connector.displayName} connection for these capabilities`
    : chosen.humanStep;
  const prepared: PreparedStep[] = [
    { label: `Found the ${connector.displayName} connector (${connector.version})`, done: true },
    { label: `Chose the ${CONNECT_ROUTE_LABELS[chosen.route]} route`, done: true },
    { label: `Prepared a request for ${plan.requested.length} capabilit${plan.requested.length === 1 ? 'y' : 'ies'}, nothing more`, done: true },
    chosen.route === 'oauth_api'
      ? { label: 'Prepared the authorization and the callback into Wonderland', done: true }
      : chosen.route === 'mcp'
        ? { label: `Registered the MCP server ${chosen.mcpRegistryEntryId ?? connector.connectorId} for this connection`, done: true }
        : chosen.route === 'api_credential'
          ? { label: 'Prepared a secure credential slot -- Julius will only ever hold a reference to it', done: true }
          : { label: 'Prepared a governed browser session limited to the approved actions', done: true },
    { label: 'Waiting on you for the one step only you can do', done: false },
  ];
  const { id: requestId, state: withRequestId } = nextId(next, 'creq');
  next = withRequestId;
  const request: CapabilityRequest = {
    requestId, userId: input.userId, projectId: input.projectId, missionId: input.missionId, taskId: input.taskId,
    connectorId: connector.connectorId, route: chosen.route, requested: plan.requested, notRequested: plan.notRequested,
    purpose: safeText(input.purpose), prepared, humanStep, connectionId: connection.connectionId,
    state: 'AWAITING_USER', createdAt: clock.at, decidedAt: null, failureReason: null,
  };
  next = { ...next, requests: [...next.requests, request] };
  next = audit(next, clock.at, {
    actor: 'julius', action: 'capability.requested', projectId: input.projectId, missionId: input.missionId, connectionId: connection.connectionId,
    connectorId: connector.connectorId, capability: plan.requested.join(','), outcome: 'pending', detail: input.purpose,
  });
  next = audit(next, clock.at, {
    actor: 'julius', action: 'authorization.prepared', projectId: input.projectId, missionId: input.missionId, connectionId: connection.connectionId,
    connectorId: connector.connectorId, capability: null, outcome: 'pending', detail: `${CONNECT_ROUTE_LABELS[chosen.route]} route prepared; waiting on: ${humanStep}`,
  });
  return ok({ kind: 'awaiting_user', state: next, request });
}

function findRequest(state: JuliusConnectState, requestId: string): RelayResult<CapabilityRequest> {
  const request = state.requests.find((r) => r.requestId === requestId);
  return request ? ok(request) : fail(relayError('not-found', `No capability request ${requestId}.`, { entityIds: { requestId } }));
}

/** THE USER CROSSES THE TRUST BOUNDARY. Only the requesting user may; the connection moves into connecting. */
export function approveRequest(state: JuliusConnectState, input: { requestId: string; userId: string }, clock: ConnectClock): RelayResult<JuliusConnectState> {
  const found = findRequest(state, input.requestId);
  if (!found.ok) return found;
  const request = found.value;
  if (request.userId !== input.userId) return fail(relayError('permission-denied', 'Only the person Julius asked can approve this connection.'));
  if (request.state !== 'AWAITING_USER') return fail(relayError('illegal-transition', `This request is already ${request.state}.`));
  const connection = state.connections.find((c) => c.connectionId === request.connectionId);
  if (!connection) return fail(relayError('not-found', 'The connection this request completes is gone.'));
  let next = state;
  if (connection.state !== 'CONNECTED') {
    const connecting = moveConnection(connection, 'CONNECTING', clock.at, 'Approved. Julius is finishing the connection.');
    if (!connecting.ok) return connecting;
    next = replaceConnection(next, connecting.value);
  }
  next = replaceRequest(next, { ...request, state: 'APPROVED', decidedAt: clock.at });
  next = audit(next, clock.at, {
    actor: 'user', action: 'authorization.approved', projectId: request.projectId, missionId: request.missionId, connectionId: request.connectionId,
    connectorId: request.connectorId, capability: request.requested.join(','), outcome: 'success', detail: `Approved: ${request.requested.join(', ')}`,
  });
  // A project asking to use capabilities the connection already holds needs no new authorization: the grant is made here.
  if (connection.state === 'CONNECTED' && request.requested.every((c) => connection.grantedCapabilities.includes(c))) {
    const previous = grantFor(next, request.projectId, connection.connectionId);
    const granted = grantProjectAccess(next, {
      userId: request.userId, projectId: request.projectId, connectionId: connection.connectionId,
      capabilities: [...new Set([...(previous && !previous.revokedAt ? previous.allowedActions : []), ...request.requested])].filter((c) => connection.grantedCapabilities.includes(c)),
      expiresAt: previous?.expiresAt ?? PROJECT_GRANT_DEFAULT_EXPIRY,
    }, clock);
    if (!granted.ok) return granted;
    const satisfied = granted.value.requests.find((r) => r.requestId === request.requestId);
    return ok(satisfied ? replaceRequest(granted.value, { ...satisfied, state: 'SATISFIED' }) : granted.value);
  }
  return ok(next);
}

/** A project grant made against an existing connection lasts as long as a fresh one would, unless the connection says otherwise. */
export const PROJECT_GRANT_DEFAULT_EXPIRY = '2099-01-01T00:00:00.000Z';

/** True when an approved request still needs the connector runtime to complete authorization. */
export function needsAuthorization(state: JuliusConnectState, requestId: string): boolean {
  const request = state.requests.find((r) => r.requestId === requestId);
  return request !== undefined && request.state === 'APPROVED';
}

export function declineRequest(state: JuliusConnectState, input: { requestId: string; userId: string }, clock: ConnectClock): RelayResult<JuliusConnectState> {
  const found = findRequest(state, input.requestId);
  if (!found.ok) return found;
  const request = found.value;
  if (request.userId !== input.userId) return fail(relayError('permission-denied', 'Only the person Julius asked can decline this connection.'));
  if (request.state !== 'AWAITING_USER') return fail(relayError('illegal-transition', `This request is already ${request.state}.`));
  let next = replaceRequest(state, { ...request, state: 'DECLINED', decidedAt: clock.at });
  const connection = next.connections.find((c) => c.connectionId === request.connectionId);
  if (connection && (connection.state === 'AUTHORIZATION_REQUIRED' || connection.state === 'CREDENTIAL_REQUIRED')) {
    const back = moveConnection(connection, 'NOT_CONNECTED', clock.at, 'Not now. Nothing was connected.');
    if (back.ok) next = replaceConnection(next, back.value);
  }
  return ok(audit(next, clock.at, {
    actor: 'user', action: 'authorization.declined', projectId: request.projectId, missionId: request.missionId, connectionId: request.connectionId,
    connectorId: request.connectorId, capability: request.requested.join(','), outcome: 'denied', detail: 'Not now.',
  }));
}

/** What the connector runtime reports after the user approved: authorized (with a credential REFERENCE) or failed. */
export type AuthorizationOutcome =
  | { readonly kind: 'authorized'; readonly credentialRef: string; readonly accountLabel: string; readonly grantedCapabilities: readonly string[]; readonly expiresAt: string }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * JULIUS FINISHES THE CONNECTION. The connection becomes CONNECTED holding what the service granted -- never more than was
 * requested -- and the project the request came from receives its grant, as a credential handle.
 */
export function completeAuthorization(state: JuliusConnectState, input: { requestId: string; outcome: AuthorizationOutcome }, clock: ConnectClock): RelayResult<JuliusConnectState> {
  const found = findRequest(state, input.requestId);
  if (!found.ok) return found;
  const request = found.value;
  if (request.state !== 'APPROVED') return fail(relayError('illegal-transition', `Authorization can only complete an APPROVED request; this one is ${request.state}.`));
  const connection = state.connections.find((c) => c.connectionId === request.connectionId);
  if (!connection) return fail(relayError('not-found', 'The connection this request completes is gone.'));
  const connector = findConnector(request.connectorId, registryOf(clock));
  if (!connector) return fail(relayError('not-found', `No connector named ${request.connectorId} is registered.`));

  if (input.outcome.kind === 'failed') {
    const failed = moveConnection(connection, 'FAILED', clock.at, input.outcome.reason);
    if (!failed.ok) return failed;
    let next = replaceConnection(state, failed.value);
    next = replaceRequest(next, { ...request, state: 'FAILED', failureReason: safeText(input.outcome.reason) });
    return ok(audit(next, clock.at, {
      actor: 'system', action: 'connection.failed', projectId: request.projectId, missionId: request.missionId, connectionId: connection.connectionId,
      connectorId: request.connectorId, capability: null, outcome: 'failed', detail: input.outcome.reason,
    }));
  }

  if (isSecretShaped(input.outcome.credentialRef) || isSecretShaped(input.outcome.accountLabel)) {
    return fail(relayError('validation-failed', 'An authorization outcome carried secret-shaped material; only references are accepted.'));
  }
  const granted = input.outcome.grantedCapabilities.filter((c) => request.requested.includes(c));
  const holding = connection.state === 'CONNECTED' ? [...new Set([...connection.grantedCapabilities, ...granted])] : granted;
  const denied = connector.capabilities.map((c) => c.capabilityId).filter((c) => !holding.includes(c));
  const connected = moveConnection(connection, 'CONNECTED', clock.at, `Connected as ${input.outcome.accountLabel}.`, {
    credentialRef: input.outcome.credentialRef, accountLabel: input.outcome.accountLabel,
    // Incremental on a connection that stayed connected; a fresh authorization holds exactly what it was granted.
    grantedCapabilities: holding,
    deniedCapabilities: denied,
  });
  if (!connected.ok) return connected;
  let next = replaceConnection(state, connected.value);
  next = replaceRequest(next, { ...request, state: 'SATISFIED' });
  next = audit(next, clock.at, {
    actor: 'system', action: 'connection.connected', projectId: request.projectId, missionId: request.missionId, connectionId: connection.connectionId,
    connectorId: request.connectorId, capability: granted.join(','), outcome: 'success', detail: `${connector.displayName} connected as ${input.outcome.accountLabel}; granted ${granted.join(', ')}.`,
  });
  const previous = grantFor(next, request.projectId, connection.connectionId);
  const projectCapabilities = [...new Set([...(previous && !previous.revokedAt ? previous.allowedActions : []), ...granted])]
    .filter((c) => connected.value.grantedCapabilities.includes(c));
  return grantProjectAccess(next, { userId: request.userId, projectId: request.projectId, connectionId: connection.connectionId, capabilities: projectCapabilities, expiresAt: input.outcome.expiresAt }, clock);
}

/**
 * PROJECT SCOPE. A connection existing gives no project anything: a project uses exactly the capabilities granted to it,
 * a subset of what the connection holds, through its own credential handle.
 */
export function grantProjectAccess(
  state: JuliusConnectState,
  input: { userId: string; projectId: string; connectionId: string; capabilities: readonly string[]; expiresAt: string },
  clock: ConnectClock,
): RelayResult<JuliusConnectState> {
  const connection = state.connections.find((c) => c.connectionId === input.connectionId);
  if (!connection) return fail(relayError('not-found', 'No such connection.', { entityIds: { connectionId: input.connectionId } }));
  if (connection.userId !== input.userId) return fail(relayError('permission-denied', 'Only the connection’s owner can grant a project access to it.'));
  const beyond = input.capabilities.filter((c) => !connection.grantedCapabilities.includes(c));
  if (beyond.length > 0) return fail(relayError('permission-denied', `The connection does not hold ${beyond.join(', ')}; a project cannot be granted more than the connection has.`));
  const connector = findConnector(connection.connectorId, registryOf(clock));
  const { id, state: withId } = nextId(state, 'cgr');
  const existing = grantFor(withId, input.projectId, connection.connectionId);
  let next = withId;
  if (existing && !existing.revokedAt) {
    next = { ...next, grants: next.grants.map((g) => (g.credentialHandleId === existing.credentialHandleId ? revokeHandle(g, clock.at) : g)) };
  }
  const handle = createCredentialHandle({
    credentialHandleId: id, userId: input.userId, projectId: input.projectId, service: connection.connectionId,
    accountLabel: connection.accountLabel ?? connector?.displayName ?? connection.connectorId, capability: 'scoped_api',
    allowedActions: [...input.capabilities], prohibitedActions: connection.deniedCapabilities.filter((c) => !input.capabilities.includes(c)),
    scope: input.capabilities.length > 0 ? [...input.capabilities] : ['none'], createdAt: clock.at, expiresAt: input.expiresAt,
    provenance: connection.provenance,
  });
  if (!handle.ok) return handle;
  next = { ...next, grants: [...next.grants, handle.value] };
  return ok(audit(next, clock.at, {
    actor: 'user', action: 'project.granted', projectId: input.projectId, missionId: null, connectionId: connection.connectionId,
    connectorId: connection.connectorId, capability: input.capabilities.join(','), outcome: 'success',
    detail: `Project ${input.projectId} may use ${input.capabilities.length > 0 ? input.capabilities.join(', ') : 'nothing'}.`,
  }));
}

/* ------------------------------------------------------------------ revoke */

/**
 * REVOKE. The connection is REVOKED, every project grant hanging from it is revoked, and its credential reference is
 * dropped -- the runtime destroys the vault entry it named. From this moment the gate refuses every capability.
 */
export function revokeConnection(state: JuliusConnectState, input: { connectionId: string; userId: string }, clock: ConnectClock): RelayResult<JuliusConnectState> {
  const connection = state.connections.find((c) => c.connectionId === input.connectionId);
  if (!connection) return fail(relayError('not-found', 'No such connection.', { entityIds: { connectionId: input.connectionId } }));
  if (connection.userId !== input.userId) return fail(relayError('permission-denied', 'Only the connection’s owner can revoke it.'));
  if (connection.state === 'REVOKED') return ok(state);
  const revoked = moveConnection(connection, 'REVOKED', clock.at, 'Revoked by you. Julius can no longer use it.', { credentialRef: null });
  if (!revoked.ok) return revoked;
  let next = replaceConnection(state, revoked.value);
  next = { ...next, grants: next.grants.map((g) => (g.service === connection.connectionId && !g.revokedAt ? revokeHandle(g, clock.at) : g)) };
  return ok(audit(next, clock.at, {
    actor: 'user', action: 'connection.revoked', projectId: null, missionId: null, connectionId: connection.connectionId,
    connectorId: connection.connectorId, capability: connection.grantedCapabilities.join(','), outcome: 'success', detail: 'Revoked. Every project grant from this connection is revoked with it.',
  }));
}

/* ------------------------------------------------------------------ health */

/** The runtime's view of a live connection changed: expired, rate limited, unavailable, failed, back, or needing reconnect. */
export function setConnectionHealth(
  state: JuliusConnectState,
  input: { connectionId: string; to: 'CONNECTED' | 'EXPIRED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'FAILED' | 'RECONNECT_REQUIRED'; detail: string },
  clock: ConnectClock,
): RelayResult<JuliusConnectState> {
  const connection = state.connections.find((c) => c.connectionId === input.connectionId);
  if (!connection) return fail(relayError('not-found', 'No such connection.', { entityIds: { connectionId: input.connectionId } }));
  const moved = moveConnection(connection, input.to, clock.at, input.detail);
  if (!moved.ok) return moved;
  return ok(audit(replaceConnection(state, moved.value), clock.at, {
    actor: 'system', action: 'connection.health_changed', projectId: null, missionId: null, connectionId: connection.connectionId,
    connectorId: connection.connectorId, capability: null, outcome: input.to === 'CONNECTED' ? 'success' : 'failed', detail: `${connection.state} -> ${input.to}: ${input.detail}`,
  }));
}

export function auditAction(state: JuliusConnectState, action: ConnectAuditAction): readonly ConnectAuditEvent[] {
  return state.audit.filter((e) => e.action === action);
}
