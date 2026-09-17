import type { Provenance } from '../../protocol/enums';
import type { CredentialHandle } from '../credential-handle';

/**
 * JULIUS CONNECT — the vocabulary of a connection.
 *
 * THE PRODUCT RULE (founder, 2026-09-17). The user says WHAT they want connected ("connect Figma", "connect everything
 * this project needs"); Julius works out HOW. OAuth, an API credential, MCP and governed browser/computer interaction are
 * ROUTES underneath Julius, never things the user has to understand. The user only handles the genuine trust boundaries:
 * signing in, MFA, consent, creating or approving a credential, CAPTCHA, payment, identity, administrator approval.
 *
 * CAPABILITY-BASED AUTHORITY. A connection never means "Julius owns GitHub". It means Julius holds exactly the capabilities
 * the user granted, for exactly the projects they were granted to. Julius controls mission authority; an external tool
 * provides capabilities and gains no authority of its own.
 *
 * WHAT THIS FILE BUILDS ON, rather than beside:
 *   - a project's grant IS a `CredentialHandle` (mission/credential-handle.ts): scope + allowed / prohibited actions +
 *     expiry + revocation, and it already refuses any secret-shaped field. Julius Connect adds the account-level
 *     connection the handles hang from and the lifecycle that creates and revokes them.
 *   - the MCP route is backed by the MCP registry and connection machine (src/relay/mcp); a connector names the registry
 *     entry, and MCP's transport states map onto the states below rather than being re-invented.
 *   - a mission blocked on a missing capability is a Julius run transitioned to BLOCKED with the reason code
 *     EXTERNAL_CAPABILITY_REQUIRED (mission/julius/julius-runtime.ts), not a second state machine.
 *
 * PURE: no Node, no clock (time arrives as an ISO string), no network. Secrets never enter this layer at all -- a
 * connection carries a credential REFERENCE, resolved only by the connector runtime at the moment an authorized
 * capability executes.
 */

export const JULIUS_CONNECT_SCHEMA_V1 = 'relay-julius-connect.v1' as const;

/* ------------------------------------------------------------------ routes */

/** HOW a service is reached. Julius picks; the user never has to. */
export const CONNECT_ROUTES = ['oauth_api', 'mcp', 'api_credential', 'browser_computer'] as const;
export type ConnectRoute = (typeof CONNECT_ROUTES)[number];

export const CONNECT_ROUTE_LABELS: Readonly<Record<ConnectRoute, string>> = Object.freeze({
  oauth_api: 'OAuth / API',
  mcp: 'MCP',
  api_credential: 'API credential',
  browser_computer: 'Governed browser',
});

/* ------------------------------------------------------------------ states */

/**
 * THE CONNECTION'S TRUTH, as Julius acts on it. Only CONNECTED lets a capability through; every other state is a reason
 * the gate refuses, and each says which reason.
 */
export const CONNECT_STATES = [
  'NOT_CONNECTED',
  'CONNECTING',
  'AUTHORIZATION_REQUIRED',
  'CREDENTIAL_REQUIRED',
  'CONNECTED',
  'EXPIRED',
  'REVOKED',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'FAILED',
  'RECONNECT_REQUIRED',
] as const;
export type ConnectState = (typeof CONNECT_STATES)[number];

/** The legal edges, as a table: a state the lifecycle cannot reach is a state nobody can claim. */
export const CONNECT_EDGES: Readonly<Record<ConnectState, readonly ConnectState[]>> = Object.freeze({
  NOT_CONNECTED: ['CONNECTING'],
  CONNECTING: ['AUTHORIZATION_REQUIRED', 'CREDENTIAL_REQUIRED', 'CONNECTED', 'FAILED', 'UNAVAILABLE'],
  AUTHORIZATION_REQUIRED: ['CONNECTING', 'NOT_CONNECTED', 'FAILED'],
  CREDENTIAL_REQUIRED: ['CONNECTING', 'NOT_CONNECTED', 'FAILED'],
  CONNECTED: ['EXPIRED', 'REVOKED', 'RATE_LIMITED', 'UNAVAILABLE', 'FAILED', 'RECONNECT_REQUIRED'],
  EXPIRED: ['RECONNECT_REQUIRED', 'REVOKED'],
  REVOKED: ['CONNECTING'],
  RATE_LIMITED: ['CONNECTED', 'UNAVAILABLE', 'REVOKED'],
  UNAVAILABLE: ['CONNECTED', 'FAILED', 'REVOKED'],
  FAILED: ['CONNECTING', 'REVOKED'],
  RECONNECT_REQUIRED: ['CONNECTING', 'REVOKED'],
});

export function isLegalConnectTransition(from: ConnectState, to: ConnectState): boolean {
  return CONNECT_EDGES[from].includes(to);
}

/* ------------------------------------------------------------ capabilities */

/** How much a capability can do. Admin and destructive capabilities are never requested on the user's behalf. */
export const CAPABILITY_RISKS = ['read', 'write', 'admin', 'destructive'] as const;
export type CapabilityRisk = (typeof CAPABILITY_RISKS)[number];

export interface ConnectorCapability {
  /** Dotted, service-local: `files.read`, `messages.send`, `repo.delete`. */
  readonly capabilityId: string;
  readonly label: string;
  readonly risk: CapabilityRisk;
}

/* --------------------------------------------------------------- registry */

export interface ConnectorRouteOption {
  readonly route: ConnectRoute;
  /**
   * Whether this build can actually reach the service this way. A real SaaS route that has no provider integration yet
   * is listed and marked unavailable with its reason -- the registry describes the world truthfully, it does not pretend.
   */
  readonly available: boolean;
  readonly unavailableReason: string | null;
  /** The trust boundary the user crosses on this route, stated for the prompt. */
  readonly humanStep: string;
  /** MCP route only: the MCP registry entry that backs it. */
  readonly mcpRegistryEntryId: string | null;
}

export interface ConnectorDescriptor {
  readonly connectorId: string;
  readonly serviceId: string;
  readonly displayName: string;
  readonly aliases: readonly string[];
  readonly version: string;
  /** In preference order. Julius takes the first available. */
  readonly routes: readonly ConnectorRouteOption[];
  readonly capabilities: readonly ConnectorCapability[];
  /**
   * A DEVELOPMENT CONNECTOR is a deterministic, provider-free stand-in shaped like a real integration, for proving the
   * architecture. It is labelled everywhere it appears and never presented as the real service.
   */
  readonly development: boolean;
}

/* ------------------------------------------------------------- connection */

export interface ConnectHealth {
  readonly checkedAt: string;
  readonly detail: string;
}

/**
 * ONE ACCOUNT CONNECTION -- the user's, not a project's. Projects get capabilities from it through their own grants
 * (credential handles); a connection existing grants no project anything.
 */
export interface Connection {
  readonly schemaVersion: typeof JULIUS_CONNECT_SCHEMA_V1;
  readonly connectionId: string;
  readonly connectorId: string;
  readonly userId: string;
  readonly route: ConnectRoute;
  readonly state: ConnectState;
  /** Display only: the account or workspace the service reports. Never a secret. */
  readonly accountLabel: string | null;
  /** An opaque vault reference. The secret it names never enters this layer. */
  readonly credentialRef: string | null;
  /** What the service authorized, and what the connection deliberately does not hold. */
  readonly grantedCapabilities: readonly string[];
  readonly deniedCapabilities: readonly string[];
  readonly health: ConnectHealth;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastUsedAt: string | null;
  readonly version: number;
  readonly provenance: Provenance;
  readonly development: boolean;
}

/* ----------------------------------------------------------------- request */

export const CAPABILITY_REQUEST_STATES = ['AWAITING_USER', 'APPROVED', 'DECLINED', 'SATISFIED', 'FAILED'] as const;
export type CapabilityRequestState = (typeof CAPABILITY_REQUEST_STATES)[number];

/** What Julius did on its own before reaching the trust boundary, so the prompt can say it. */
export interface PreparedStep {
  readonly label: string;
  readonly done: boolean;
}

export interface CapabilityRequest {
  readonly requestId: string;
  readonly userId: string;
  readonly projectId: string;
  readonly missionId: string | null;
  readonly taskId: string | null;
  readonly connectorId: string;
  readonly route: ConnectRoute;
  /** What Julius asks for -- only what the work needs. */
  readonly requested: readonly string[];
  /** What the service offers that Julius deliberately does NOT ask for (admin, destructive, unneeded). */
  readonly notRequested: readonly string[];
  readonly purpose: string;
  readonly prepared: readonly PreparedStep[];
  /** The one step the user must do themselves. */
  readonly humanStep: string;
  /** The connection this request completes. */
  readonly connectionId: string;
  readonly state: CapabilityRequestState;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly failureReason: string | null;
}

/* ------------------------------------------------------------------- audit */

export const CONNECT_AUDIT_ACTIONS = [
  'capability.requested',
  'authorization.prepared',
  'authorization.approved',
  'authorization.declined',
  'connection.connected',
  'connection.failed',
  'connection.health_changed',
  'connection.revoked',
  'connection.reconnect_requested',
  'project.granted',
  'capability.used',
  'capability.denied',
  'mission.blocked',
  'mission.resumed',
] as const;
export type ConnectAuditAction = (typeof CONNECT_AUDIT_ACTIONS)[number];

/**
 * ATTRIBUTABLE AND SAFE. Every capability use and every decision is recorded with who, which project, which mission,
 * which connection, which capability and the outcome -- and no secret material, ever: `detail` is checked for secret
 * shapes on the way in.
 */
export interface ConnectAuditEvent {
  readonly eventId: string;
  readonly at: string;
  readonly actor: 'julius' | 'user' | 'system';
  readonly action: ConnectAuditAction;
  readonly projectId: string | null;
  readonly missionId: string | null;
  readonly connectionId: string | null;
  readonly connectorId: string;
  readonly capability: string | null;
  readonly outcome: 'success' | 'denied' | 'failed' | 'pending';
  readonly detail: string;
}

/* ------------------------------------------------------------------- state */

export interface JuliusConnectState {
  readonly connections: readonly Connection[];
  /** Project grants. One handle per (project, connection); revocation and expiry are the handle's. */
  readonly grants: readonly CredentialHandle[];
  readonly requests: readonly CapabilityRequest[];
  readonly audit: readonly ConnectAuditEvent[];
  /** A monotonic counter for deterministic ids. */
  readonly sequence: number;
}

export const EMPTY_JULIUS_CONNECT_STATE: JuliusConnectState = Object.freeze({
  connections: [],
  grants: [],
  requests: [],
  audit: [],
  sequence: 0,
});

/* ----------------------------------------------------------------- gating */

/** Why the gate refused, as a closed vocabulary Julius can act on. */
export const CAPABILITY_DENIALS = [
  'UNKNOWN_CONNECTOR',
  'UNKNOWN_CAPABILITY',
  'NOT_CONNECTED',
  'AUTHORIZATION_REQUIRED',
  'CREDENTIAL_REQUIRED',
  'CONNECTING',
  'EXPIRED',
  'REVOKED',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'FAILED',
  'RECONNECT_REQUIRED',
  'NOT_GRANTED_FOR_PROJECT',
  'CAPABILITY_NOT_GRANTED',
] as const;
export type CapabilityDenial = (typeof CAPABILITY_DENIALS)[number];

export type CapabilityDecision =
  | { readonly allowed: true; readonly connectionId: string; readonly grantId: string; readonly credentialRef: string }
  | { readonly allowed: false; readonly denial: CapabilityDenial; readonly connectionId: string | null };

/** The reason code a Julius run blocks with when the gate refuses a capability the mission needs. */
export const EXTERNAL_CAPABILITY_REQUIRED = 'EXTERNAL_CAPABILITY_REQUIRED' as const;

/* ------------------------------------------------------------------ labels */

export const CONNECT_STATE_LABELS: Readonly<Record<ConnectState, string>> = Object.freeze({
  NOT_CONNECTED: 'NOT CONNECTED',
  CONNECTING: 'CONNECTING',
  AUTHORIZATION_REQUIRED: 'APPROVAL REQUIRED',
  CREDENTIAL_REQUIRED: 'CREDENTIAL REQUIRED',
  CONNECTED: 'CONNECTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  RATE_LIMITED: 'RATE LIMITED',
  UNAVAILABLE: 'UNAVAILABLE',
  FAILED: 'FAILED',
  RECONNECT_REQUIRED: 'RECONNECT REQUIRED',
});

/** A real connection and a development one are never shown the same way. */
export function connectionKindLabel(development: boolean): 'DEVELOPMENT CONNECTOR' | 'REAL CONNECTION' {
  return development ? 'DEVELOPMENT CONNECTOR' : 'REAL CONNECTION';
}
