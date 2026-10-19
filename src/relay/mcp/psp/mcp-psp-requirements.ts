/**
 * PSP AGENT MCP REQUIREMENTS AND TRUST MANIFEST (PURE).
 *
 * A PSP Agent is a portable agent definition. This module is what lets one say
 * "I need a repository reader and a documentation server" WITHOUT saying "and
 * here is the token to use them".
 *
 * THE EXPORT RULE IS ABSOLUTE: **a PSP export never contains a credential.**
 * `exportPspMcpRequirements` strips to a declared allowlist of fields, so a
 * credential cannot ride along in a field nobody remembered to remove — the
 * export is built from a permitted set, not filtered from an arbitrary object.
 * `assertPspExportCarriesNoCredential` re-checks the produced value with the
 * same forbidden-field detector the credential domain uses, and
 * `mcp-psp.test.ts` runs it over an export built from a requirement that was
 * deliberately polluted with every token-shaped field name.
 *
 * WHAT THE IMPORTER MUST SHOW A HUMAN, and why each one is non-negotiable:
 *
 *   write-capable capabilities   a user importing an agent is consenting to
 *                                what it can DO, and "it needs GitHub" hides
 *                                the difference between reading issues and
 *                                merging pull requests;
 *   required human approvals     so the user knows they will be interrupted,
 *                                and knows an unattended run will stop;
 *   missing connections          so the gap is visible BEFORE a mission is
 *                                started and blocked halfway;
 *   the connect-your-own-account requirement, stated plainly. A PSP grants no
 *                                access to anyone else's accounts, ever.
 *
 * This module deliberately implements NO commerce. There is no purchase, no
 * trade, no price and no marketplace here — §17 asks for the PSP MCP contract
 * underneath Ship on Sunday, not Ship on Sunday itself.
 */

import { forbiddenCredentialFieldsIn, type McpCredentialReference } from '../domain/mcp-credential';
import type { McpTransportKind } from '../domain/mcp-protocol';
import { credentialIsUsable, missingScopes } from '../domain/mcp-credential';
import type { McpApprovalPolicy } from '../policy/mcp-approvals';
import type { McpAgentRole } from '../policy/mcp-permissions';
import type { McpRiskClass, McpRiskOverride } from '../policy/mcp-risk';
import { requiresHumanApproval } from '../policy/mcp-risk';
import type { McpRegistryCategory, McpRegistryEntry } from '../registry/mcp-registry-types';
import type { McpConnection } from '../domain/mcp-connection';

/** What a PSP declares it needs from one MCP server class. */
export interface McpPspServerRequirement {
  /** A server CLASS (a registry category), never a specific endpoint. A PSP
   * that could name an endpoint could point an importing user at one. */
  readonly serverClass: McpRegistryCategory;
  readonly required: boolean;
  readonly minimumProtocolRevision: string;
  readonly acceptableTransports: readonly McpTransportKind[];
  readonly requiredTools: readonly string[];
  readonly requiredResources: readonly string[];
  readonly requiredPrompts: readonly string[];
  readonly requiredScopes: readonly string[];
  /** The maximum risk this PSP's agents may reach on this server. */
  readonly maximumRiskClass: McpRiskClass;
  readonly approvalPolicy: McpApprovalPolicy;
  /** Only `registry_verified` is meaningful for a shared agent definition. */
  readonly requiresVerifiedRegistryServer: boolean;
  /**
   * Snapshot fingerprints this PSP was authored against. Advisory: a mismatch
   * is REPORTED to the importer, not silently accepted and not auto-refused —
   * a legitimate server upgrade should not brick an imported agent, and a
   * changed surface should never be invisible.
   */
  readonly knownCapabilityFingerprints: readonly string[];
  readonly requiresHealthyConnection: boolean;
}

export interface McpPspAgentGrant {
  readonly role: McpAgentRole;
  readonly serverClass: McpRegistryCategory;
  readonly capabilityKind: 'tool' | 'resource' | 'prompt';
  readonly capabilityNames: readonly string[];
  readonly maximumRiskClass: McpRiskClass;
  readonly writablePathPrefixes: readonly string[];
}

export interface McpPspRequirementSet {
  readonly pspRequirementVersion: '1.0.0';
  readonly servers: readonly McpPspServerRequirement[];
  readonly grants: readonly McpPspAgentGrant[];
  /** Founder-policy risk overrides carried by the PSP. Never lowering
   * without `founderAuthorized`, which the classifier enforces. */
  readonly riskOverrides: readonly McpRiskOverride[];
}

/* ------------------------------------------------------------------ *
 * Trust manifest — what an importing human is shown.
 * ------------------------------------------------------------------ */

export interface McpPspTrustManifest {
  readonly requiresGitHosting: boolean;
  readonly readOnly: boolean;
  readonly modifiesWorkspace: boolean;
  readonly createsExternalRecords: boolean;
  readonly deploymentCapable: boolean;
  readonly accessesCredentials: boolean;
  readonly hasDestructiveCapabilities: boolean;
  readonly humanApprovalRequired: boolean;
  readonly requiresVerifiedRegistryServers: boolean;
  /** Every capability that can change something, named. */
  readonly writeCapableCapabilities: readonly string[];
  /** Every operation that will interrupt a run for a human decision. */
  readonly operationsRequiringApproval: readonly string[];
  readonly serverClasses: readonly McpRegistryCategory[];
  /** Always true in this milestone. Ship on Sunday commerce is not here. */
  readonly commerceImplemented: false;
}

export function buildPspTrustManifest(requirements: McpPspRequirementSet): McpPspTrustManifest {
  const writeCapable: string[] = [];
  const approvalOperations: string[] = [];
  let modifiesWorkspace = false;
  let createsExternalRecords = false;
  let deploymentCapable = false;
  let accessesCredentials = false;
  let destructive = false;

  for (const grant of requirements.grants) {
    const risk = grant.maximumRiskClass;
    if (risk !== 'read_only') writeCapable.push(...grant.capabilityNames);
    if (risk === 'workspace_write') modifiesWorkspace = true;
    if (risk === 'external_write') createsExternalRecords = true;
    if (risk === 'deployment') deploymentCapable = true;
    if (risk === 'credential_access') accessesCredentials = true;
    if (risk === 'destructive') destructive = true;
    if (requiresHumanApproval(risk)) approvalOperations.push(...grant.capabilityNames);
  }

  const serverClasses = [...new Set(requirements.servers.map((server) => server.serverClass))].sort();

  return {
    requiresGitHosting: serverClasses.includes('git_hosting'),
    readOnly: writeCapable.length === 0,
    modifiesWorkspace,
    createsExternalRecords,
    deploymentCapable,
    accessesCredentials,
    hasDestructiveCapabilities: destructive,
    humanApprovalRequired: approvalOperations.length > 0,
    requiresVerifiedRegistryServers: requirements.servers.some((server) => server.requiresVerifiedRegistryServer),
    writeCapableCapabilities: [...new Set(writeCapable)].sort(),
    operationsRequiringApproval: [...new Set(approvalOperations)].sort(),
    serverClasses,
    commerceImplemented: false,
  };
}

/* ------------------------------------------------------------------ *
 * Export — built from an allowlist, never filtered from an object.
 * ------------------------------------------------------------------ */

export interface McpPspExport {
  readonly pspRequirementVersion: '1.0.0';
  readonly servers: readonly Omit<McpPspServerRequirement, never>[];
  readonly grants: readonly McpPspAgentGrant[];
  readonly riskOverrides: readonly McpRiskOverride[];
  readonly trustManifest: McpPspTrustManifest;
}

/**
 * Rebuilds each record field by field. A field added to
 * `McpPspServerRequirement` tomorrow does NOT automatically appear in the
 * export — it has to be added here, deliberately, which is the review gate
 * that a spread operator would remove.
 */
export function exportPspMcpRequirements(requirements: McpPspRequirementSet): McpPspExport {
  return {
    pspRequirementVersion: '1.0.0',
    servers: requirements.servers.map((server) => ({
      serverClass: server.serverClass,
      required: server.required,
      minimumProtocolRevision: server.minimumProtocolRevision,
      acceptableTransports: [...server.acceptableTransports],
      requiredTools: [...server.requiredTools],
      requiredResources: [...server.requiredResources],
      requiredPrompts: [...server.requiredPrompts],
      requiredScopes: [...server.requiredScopes],
      maximumRiskClass: server.maximumRiskClass,
      approvalPolicy: server.approvalPolicy,
      requiresVerifiedRegistryServer: server.requiresVerifiedRegistryServer,
      knownCapabilityFingerprints: [...server.knownCapabilityFingerprints],
      requiresHealthyConnection: server.requiresHealthyConnection,
    })),
    grants: requirements.grants.map((grant) => ({
      role: grant.role,
      serverClass: grant.serverClass,
      capabilityKind: grant.capabilityKind,
      capabilityNames: [...grant.capabilityNames],
      maximumRiskClass: grant.maximumRiskClass,
      writablePathPrefixes: [...grant.writablePathPrefixes],
    })),
    riskOverrides: requirements.riskOverrides.map((override) => ({
      toolName: override.toolName,
      riskClass: override.riskClass,
      founderAuthorized: override.founderAuthorized,
      reason: override.reason,
    })),
    trustManifest: buildPspTrustManifest(requirements),
  };
}

/** Returns offending field names; empty means the export is clean. */
export const assertPspExportCarriesNoCredential = (value: McpPspExport): readonly string[] =>
  forbiddenCredentialFieldsIn(value);

/* ------------------------------------------------------------------ *
 * Import readiness.
 * ------------------------------------------------------------------ */

export const MCP_PSP_IMPORT_ISSUE_KINDS = [
  'connection_missing',
  'credential_missing',
  'insufficient_scope',
  'server_unverified',
  'protocol_unsupported',
  'transport_unsupported',
  'capability_fingerprint_drift',
  'connection_unhealthy',
] as const;
export type McpPspImportIssueKind = (typeof MCP_PSP_IMPORT_ISSUE_KINDS)[number];

export interface McpPspImportIssue {
  readonly kind: McpPspImportIssueKind;
  readonly serverClass: McpRegistryCategory;
  readonly detail: string;
  readonly blocking: boolean;
}

export interface McpPspImportReadiness {
  readonly ready: boolean;
  readonly degraded: boolean;
  readonly issues: readonly McpPspImportIssue[];
  readonly trustManifest: McpPspTrustManifest;
  /** Always present, always shown: a PSP never carries anyone's account. */
  readonly connectYourOwnAccountsNotice: string;
}

export const CONNECT_YOUR_OWN_ACCOUNTS_NOTICE =
  'This agent definition carries no credentials. Every MCP server it needs must be connected with your own account, in your own workspace, before a mission can use it.';

export function evaluatePspMcpImport(input: {
  readonly requirements: McpPspRequirementSet;
  readonly registry: readonly McpRegistryEntry[];
  readonly connections: readonly McpConnection[];
  readonly credentials: readonly McpCredentialReference[];
}): McpPspImportReadiness {
  const issues: McpPspImportIssue[] = [];

  for (const server of input.requirements.servers) {
    const entries = input.registry.filter((entry) => entry.category === server.serverClass);
    const connection = input.connections.find((candidate) =>
      entries.some((entry) => entry.registryEntryId === candidate.definition.registryEntryId)) ?? null;

    const add = (kind: McpPspImportIssueKind, detail: string): void => {
      issues.push({ kind, serverClass: server.serverClass, detail, blocking: server.required });
    };

    if (connection === null) {
      add('connection_missing', `no ${server.serverClass.replace(/_/g, ' ')} connection is configured in this workspace`);
      continue;
    }
    if (!server.acceptableTransports.includes(connection.definition.transport)) {
      add('transport_unsupported', `the configured connection uses ${connection.definition.transport}, which this agent does not accept`);
      continue;
    }
    if (server.requiresVerifiedRegistryServer && connection.identity.trust !== 'registry_verified') {
      add('server_unverified', 'this agent requires a registry-verified server and the configured one is not verified');
    }
    if (server.requiresHealthyConnection && connection.state !== 'ready') {
      add('connection_unhealthy', `the configured connection is ${connection.state}`);
    }
    const negotiated = connection.protocol?.negotiatedProtocolVersion ?? null;
    if (negotiated !== null && negotiated < server.minimumProtocolRevision) {
      add('protocol_unsupported', `the server negotiated ${negotiated}; this agent requires at least ${server.minimumProtocolRevision}`);
    }
    if (server.requiredScopes.length > 0) {
      const reference = connection.definition.credentialReferenceId === null
        ? null
        : input.credentials.find((candidate) => candidate.credentialReferenceId === connection.definition.credentialReferenceId) ?? null;
      if (reference === null || !credentialIsUsable(reference)) {
        add('credential_missing', `connect an account that grants: ${server.requiredScopes.join(', ')}`);
      } else {
        const absent = missingScopes(reference, server.requiredScopes);
        if (absent.length > 0) add('insufficient_scope', `the connected account is missing scope(s): ${absent.join(', ')}`);
      }
    }
    if (server.knownCapabilityFingerprints.length > 0 && connection.capabilitySnapshotId !== null) {
      // Advisory only — reported so the importer can see the agent was
      // authored against a different surface, never used to auto-refuse.
      issues.push({
        kind: 'capability_fingerprint_drift',
        serverClass: server.serverClass,
        detail: 'this agent was authored against specific capability fingerprints; verify the current surface before running an unattended mission',
        blocking: false,
      });
    }
  }

  const blocking = issues.some((issue) => issue.blocking);
  return {
    ready: !blocking,
    degraded: !blocking && issues.length > 0,
    issues,
    trustManifest: buildPspTrustManifest(input.requirements),
    connectYourOwnAccountsNotice: CONNECT_YOUR_OWN_ACCOUNTS_NOTICE,
  };
}
