/**
 * Provider-neutral companion agents.
 *
 * A provider id is an opaque string. This module has no provider catalog,
 * no credential, and no outbound call. An empty registry is a valid
 * registry: the companion route does not need an adapter to answer.
 *
 * Identity on a descriptor is copied from the adapter's verified session.
 * A missing session, a provider-id mismatch, or a thrown adapter does not
 * get a stand-in name. One slot's failure is that slot's connection.
 */

import { randomUUID } from 'node:crypto';

export const AGENT_KINDS = ['single', 'compound'] as const;
export type AgentKind = (typeof AGENT_KINDS)[number];

export const COMPANION_CONNECTIONS = ['connected', 'disconnected', 'unsupported', 'error'] as const;
export type CompanionConnection = (typeof COMPANION_CONNECTIONS)[number];

const AGENT_ID = /^agt_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/**
 * One agent slot on a mission. `providerId` is whatever the caller named;
 * it is not parsed. `displayName` and `kind` are null when no verified
 * session supplied them.
 */
export interface AgentDescriptor {
  readonly agentId: string;
  readonly providerId: string;
  readonly displayName: string | null;
  readonly kind: AgentKind | null;
  readonly adapterVersion: string | null;
  readonly declaredCapabilities: readonly string[];
  readonly authorizedCapabilities: readonly string[];
  readonly connection: CompanionConnection;
}

/** The mission and slot an adapter is asked about. Not a credential. */
export interface CompanionSessionContext {
  readonly wljRunId: string;
  readonly agentId: string;
}

/**
 * What an adapter reports from a provider session it has already verified.
 * `providerSessionRef` stays on this object. It is not copied onto the
 * descriptor the route returns.
 */
export interface CompanionProviderSession {
  readonly providerId: string;
  readonly displayName: string;
  readonly kind: AgentKind;
  readonly providerSessionRef: string;
  readonly declaredCapabilities: readonly string[];
  readonly authorizedCapabilities: readonly string[];
  readonly connection: 'connected' | 'disconnected';
}

/**
 * The authorization boundary for one slot. Credentials are user-owned.
 * `relayFundedFallback` is the literal false: this process does not spend
 * an i.Wonder credential when the user did not bring one.
 */
export interface CompanionAuthorizationBoundary {
  readonly credentialOwner: 'user';
  readonly relayFundedFallback: false;
  readonly session: CompanionSessionContext;
  readonly providerSessionRef: string | null;
  readonly declaredCapabilities: readonly string[];
  readonly authorizedCapabilities: readonly string[];
}

export interface CompanionMessageEnvelope {
  readonly wljRunId: string;
  readonly agentId: string;
  readonly messageId: string;
  readonly role: 'user' | 'agent' | 'system';
  readonly text: string;
  readonly createdAt: string;
}

export interface CompanionTaskParticipationEnvelope {
  readonly wljRunId: string;
  readonly agentId: string;
  readonly taskId: string;
  readonly participation: 'assigned' | 'working' | 'handed_off' | 'done' | 'declined';
}

export interface CompanionHandoffEnvelope {
  readonly wljRunId: string;
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly taskId: string | null;
  readonly summary: string;
}

export interface CompanionSharedContextEnvelope {
  readonly wljRunId: string;
  readonly contextId: string;
  readonly agentIds: readonly string[];
  readonly text: string;
}

export interface CompanionAdapter {
  readonly providerId: string;
  readonly adapterVersion: string;
  readSession(context: CompanionSessionContext): CompanionProviderSession | null;
}

export interface CompanionAgentSource {
  agentsFor(wljRunId: string): readonly AgentDescriptor[];
}

export interface CompanionAdapterRegistry extends CompanionAgentSource {
  register(adapter: CompanionAdapter): void;
  list(): readonly CompanionAdapter[];
  /**
   * Bind a provider id to a mission. An unknown id still returns a slot
   * whose connection is `unsupported`. This does not throw.
   */
  attach(input: { readonly wljRunId: string; readonly providerId: string; readonly agentId?: string }): AgentDescriptor;
}

interface AgentSlot {
  readonly wljRunId: string;
  readonly agentId: string;
  readonly providerId: string;
}

export function clampAuthorizedCapabilities(
  declared: readonly string[],
  authorized: readonly string[],
): { readonly declaredCapabilities: readonly string[]; readonly authorizedCapabilities: readonly string[] } {
  const declaredCapabilities = uniqueStrings(declared);
  const authorizedSet = new Set(uniqueStrings(authorized));
  return {
    declaredCapabilities,
    authorizedCapabilities: declaredCapabilities.filter((capability) => authorizedSet.has(capability)),
  };
}

export function authorizationBoundary(
  context: CompanionSessionContext,
  session: CompanionProviderSession | null,
): CompanionAuthorizationBoundary {
  const capabilities = session === null
    ? { declaredCapabilities: [], authorizedCapabilities: [] }
    : clampAuthorizedCapabilities(session.declaredCapabilities, session.authorizedCapabilities);
  return {
    credentialOwner: 'user',
    relayFundedFallback: false,
    session: context,
    providerSessionRef: session?.providerSessionRef ?? null,
    declaredCapabilities: capabilities.declaredCapabilities,
    authorizedCapabilities: capabilities.authorizedCapabilities,
  };
}

/**
 * The descriptor the route is willing to publish. Capabilities are clamped.
 * `unsupported` and `error` do not carry an identity or a capability.
 * A `connected` slot with no identity is published as `error` instead.
 */
export function publishAgentDescriptor(value: AgentDescriptor): AgentDescriptor | null {
  if (typeof value.agentId !== 'string' || !AGENT_ID.test(value.agentId)) return null;
  if (typeof value.providerId !== 'string') return null;
  const connection = isConnection(value.connection) ? value.connection : 'error';
  const kind = value.kind === 'single' || value.kind === 'compound' ? value.kind : null;
  const displayName = typeof value.displayName === 'string' && value.displayName.trim() !== '' ? value.displayName : null;
  const adapterVersion = typeof value.adapterVersion === 'string' && value.adapterVersion.trim() !== ''
    ? value.adapterVersion
    : null;
  const hide = connection === 'unsupported' || connection === 'error';
  const connectedWithoutIdentity = connection === 'connected' && (displayName === null || kind === null);
  const publishedConnection = connectedWithoutIdentity ? 'error' : connection;
  const capabilities = hide || connectedWithoutIdentity
    ? { declaredCapabilities: [], authorizedCapabilities: [] }
    : clampAuthorizedCapabilities(value.declaredCapabilities ?? [], value.authorizedCapabilities ?? []);
  return {
    agentId: value.agentId,
    providerId: value.providerId,
    displayName: publishedConnection === 'unsupported' || publishedConnection === 'error' ? null : displayName,
    kind: publishedConnection === 'unsupported' || publishedConnection === 'error' ? null : kind,
    adapterVersion: publishedConnection === 'unsupported' ? null : adapterVersion,
    declaredCapabilities: capabilities.declaredCapabilities,
    authorizedCapabilities: capabilities.authorizedCapabilities,
    connection: publishedConnection,
  };
}

export function createCompanionAdapterRegistry(): CompanionAdapterRegistry {
  const adapters = new Map<string, CompanionAdapter>();
  const slots = new Map<string, AgentSlot[]>();
  const describe = (slot: AgentSlot): AgentDescriptor => {
    const adapter = adapters.get(slot.providerId);
    if (adapter === undefined) {
      return blank(slot, 'unsupported', null);
    }
    try {
      const session = adapter.readSession({ wljRunId: slot.wljRunId, agentId: slot.agentId });
      return descriptorFromSession(slot, adapter, session);
    } catch {
      return blank(slot, 'error', adapter.adapterVersion);
    }
  };
  return {
    register(adapter) {
      if (typeof adapter.providerId !== 'string' || adapter.providerId.trim() === '') return;
      adapters.set(adapter.providerId, adapter);
    },
    list() {
      return [...adapters.values()];
    },
    attach(input) {
      const providerId = typeof input.providerId === 'string' ? input.providerId : '';
      const requested = typeof input.agentId === 'string' && AGENT_ID.test(input.agentId) ? input.agentId : mintAgentId();
      const mission = typeof input.wljRunId === 'string' ? input.wljRunId : '';
      const existing = slots.get(mission) ?? [];
      const slot: AgentSlot = { wljRunId: mission, agentId: requested, providerId };
      const index = existing.findIndex((item) => item.agentId === requested);
      const next = existing.slice();
      if (index >= 0) next[index] = slot;
      else next.push(slot);
      slots.set(mission, next);
      return describe(slot);
    },
    agentsFor(wljRunId) {
      const mission = slots.get(wljRunId) ?? [];
      const published: AgentDescriptor[] = [];
      for (const slot of mission) {
        try {
          const descriptor = publishAgentDescriptor(describe(slot));
          if (descriptor !== null) published.push(descriptor);
        } catch {
          const fallback = publishAgentDescriptor(blank(slot, 'error', null));
          if (fallback !== null) published.push(fallback);
        }
      }
      return published;
    },
  };
}

function descriptorFromSession(
  slot: AgentSlot,
  adapter: CompanionAdapter,
  session: CompanionProviderSession | null,
): AgentDescriptor {
  if (session === null || session.providerId !== adapter.providerId || session.providerId !== slot.providerId) {
    return blank(slot, session === null ? 'disconnected' : 'error', adapter.adapterVersion);
  }
  const candidate: AgentDescriptor = {
    agentId: slot.agentId,
    providerId: slot.providerId,
    displayName: session.displayName,
    kind: session.kind,
    adapterVersion: adapter.adapterVersion,
    declaredCapabilities: session.declaredCapabilities,
    authorizedCapabilities: session.authorizedCapabilities,
    connection: session.connection,
  };
  return publishAgentDescriptor(candidate) ?? blank(slot, 'error', adapter.adapterVersion);
}

function blank(slot: AgentSlot, connection: 'unsupported' | 'disconnected' | 'error', adapterVersion: string | null): AgentDescriptor {
  return {
    agentId: slot.agentId,
    providerId: slot.providerId,
    displayName: null,
    kind: null,
    adapterVersion: connection === 'unsupported' ? null : adapterVersion,
    declaredCapabilities: [],
    authorizedCapabilities: [],
    connection,
  };
}

function mintAgentId(): string {
  return `agt_${randomUUID()}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || value === '' || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function isConnection(value: unknown): value is CompanionConnection {
  return typeof value === 'string' && COMPANION_CONNECTIONS.includes(value as CompanionConnection);
}
