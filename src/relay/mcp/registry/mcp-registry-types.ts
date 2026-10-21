/**
 * THE CURATED RELAY MCP REGISTRY — types and policy (PURE).
 *
 * PRIVATE-BETA POLICY, stated plainly: **a user cannot install an arbitrary
 * MCP server.** Every connection Relay will open must correspond to an entry
 * that a human curated, reviewed and approved in this repository. There is no
 * "add server by URL" path and no "add server by command" path, and the
 * absence is deliberate: §6 forbids arbitrary user-provided commands during
 * private beta, and an allowlist with a bypass is a denylist.
 *
 * This is NOT a marketplace and Relay does not claim to have one. There is no
 * publishing flow, no third-party submission, and no discovery service. The
 * fixture entries in `mcp-registry-fixtures.ts` are exactly that — fixtures,
 * marked `simulation: true`, representing the CATEGORIES a future curated
 * catalogue would cover. None of them connects to a live external service.
 *
 * WHY ENTRY STATE IS SIX VALUES. `approved` is not the opposite of `draft`.
 * A `revoked` entry is one that was approved and must now be actively refused
 * — including for connections already configured against it — and that is a
 * different operational fact from `deprecated` (still works, do not add new
 * ones) or `blocked` (never approved, and known-bad). Collapsing them loses
 * the ability to withdraw a server after a security finding, which is the one
 * registry operation that has to work under pressure.
 */

import type { McpRegistryEntryId, McpServerDefinitionId } from '../../protocol/ids';
import type { McpTransportKind } from '../domain/mcp-protocol';
import type { McpRiskClass } from '../policy/mcp-risk';

export const MCP_REGISTRY_ENTRY_STATES = [
  /** Authored, not reviewed. Never connectable. */
  'draft',
  /** Security review complete, approval pending. Never connectable. */
  'reviewed',
  /** Connectable. */
  'approved',
  /** Connectable, but no new connections should be created. */
  'deprecated',
  /** Was approved and has been withdrawn. Refused, including existing uses. */
  'revoked',
  /** Known-bad. Refused permanently. */
  'blocked',
] as const;
export type McpRegistryEntryState = (typeof MCP_REGISTRY_ENTRY_STATES)[number];

/** The only states from which Relay will open a connection. */
export const connectableStates: readonly McpRegistryEntryState[] = Object.freeze(['approved', 'deprecated']);

export const isConnectableState = (state: McpRegistryEntryState): boolean =>
  connectableStates.includes(state);

export const MCP_REGISTRY_CATEGORIES = [
  'filesystem_repository',
  'git_hosting',
  'documentation_context',
  'database_readonly',
  'browser_testing',
] as const;
export type McpRegistryCategory = (typeof MCP_REGISTRY_CATEGORIES)[number];

/**
 * A stdio launch definition. Note what is NOT here: a command STRING. The
 * executable and its arguments are separate fields and stay separate all the
 * way to `spawn`, so there is no point at which a shell could interpret them
 * (§6). `argumentAllowlist` bounds what a caller may add to `fixedArguments`.
 */
export interface McpStdioLaunchDefinition {
  /** Exact executable name. Resolved against an allowlist, never a path. */
  readonly executable: string;
  /** Arguments Relay always passes, in order. */
  readonly fixedArguments: readonly string[];
  /**
   * Additional arguments a connection MAY supply. An argument not matching one
   * of these patterns is refused — the connection fails rather than launching
   * with an unreviewed flag.
   */
  readonly argumentAllowlist: readonly string[];
  /** Environment variable NAMES the child may receive. Never values. */
  readonly environmentAllowlist: readonly string[];
  /** Whether the child is given the workspace root as its cwd. */
  readonly workspaceRootBehavior: 'isolated_temp' | 'workspace_root' | 'workspace_subdirectory';
  /** Package identity, when the executable is a package runner. */
  readonly packageIdentity: string | null;
  /** Integrity evidence, where practical. Null is honest, not a placeholder. */
  readonly artifactChecksumSha256: string | null;
}

export interface McpHttpEndpointDefinition {
  /** The exact endpoint URL. Parsed and policy-checked before every connect. */
  readonly url: string;
  /** The origin responses must come from. */
  readonly expectedOrigin: string;
  /** Whether this endpoint is permitted to be plain HTTP (loopback/private). */
  readonly allowsPlainHttp: boolean;
}

export interface McpRegistryEntry {
  readonly registryEntryId: McpRegistryEntryId;
  readonly serverDefinitionId: McpServerDefinitionId;
  readonly displayName: string;
  readonly category: McpRegistryCategory;
  readonly state: McpRegistryEntryState;

  /** Server identity the running server must declare to be trusted. */
  readonly expectedServerName: string;
  readonly expectedServerVersion: string | null;
  readonly publisher: string;

  readonly transport: McpTransportKind;
  readonly stdio: McpStdioLaunchDefinition | null;
  readonly http: McpHttpEndpointDefinition | null;

  /** Minimum MCP revision this entry is certified against. */
  readonly minimumProtocolRevision: string;

  /** Tools the curator expects, with the class Relay should treat as a FLOOR. */
  readonly declaredToolRisk: Readonly<Record<string, McpRiskClass>>;
  /** The highest class any capability on this server may reach. */
  readonly maximumRiskClass: McpRiskClass;

  readonly requiredCredentialClass: string | null;
  readonly requiredCredentialScopes: readonly string[];

  readonly securityReviewedAt: string | null;
  readonly securityReviewer: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;

  /**
   * TRUE for every entry in this milestone. A fixture entry is a shape, not a
   * working integration, and the CLI and website both render this flag so a
   * user is never shown a simulated connector as though it were live (§22).
   */
  readonly simulation: boolean;
  readonly notes: readonly string[];
}

export interface McpRegistryRefusal {
  readonly refused: true;
  readonly reason: string;
  readonly category: 'registry_untrusted' | 'unsupported_transport' | 'protocol_mismatch';
}

export type McpRegistryLookup =
  | { readonly refused: false; readonly entry: McpRegistryEntry }
  | McpRegistryRefusal;

/**
 * The ONE approved way to obtain a connectable entry. Every refusal names the
 * state, because "server not available" tells an operator nothing about
 * whether to wait, upgrade, or stop.
 */
export function resolveRegistryEntry(
  entries: readonly McpRegistryEntry[],
  registryEntryId: string,
): McpRegistryLookup {
  const entry = entries.find((candidate) => candidate.registryEntryId === registryEntryId);
  if (!entry) {
    return {
      refused: true,
      category: 'registry_untrusted',
      reason: `no curated registry entry ${registryEntryId} exists — Relay does not connect to uncurated MCP servers`,
    };
  }
  if (!isConnectableState(entry.state)) {
    return {
      refused: true,
      category: 'registry_untrusted',
      reason: entry.state === 'revoked'
        ? `registry entry ${entry.displayName} was revoked${entry.revocationReason ? `: ${entry.revocationReason}` : ''}`
        : `registry entry ${entry.displayName} is ${entry.state} and is not connectable`,
    };
  }
  return { refused: false, entry };
}

/** Validates a proposed argument list against the entry's allowlist. */
export function validateStdioArguments(
  definition: McpStdioLaunchDefinition,
  additional: readonly string[],
): { readonly ok: true; readonly args: readonly string[] } | { readonly ok: false; readonly reason: string } {
  for (const argument of additional) {
    const permitted = definition.argumentAllowlist.some((pattern) => {
      if (pattern.endsWith('=*')) return argument.startsWith(pattern.slice(0, -1));
      return pattern === argument;
    });
    if (!permitted) {
      return { ok: false, reason: `argument "${argument}" is not on this registry entry's argument allowlist` };
    }
  }
  return { ok: true, args: [...definition.fixedArguments, ...additional] };
}
