/**
 * PER-AGENT MCP PERMISSIONS (PURE).
 *
 * THE REVIEWER RULE IS ABSOLUTE AND IS ENFORCED FIRST.
 *
 * The Independent Reviewer receives NO MCP connections, NO tools, NO resources
 * and NO prompts — and the check for that is the first branch of
 * `evaluatePermission`, before roles, grants, risk, approvals or anything else
 * can be consulted. It is not a default that a grant can override: there is no
 * code path in which a reviewer-role request returns anything but `deny`, and
 * `mcp-permissions.test.ts` proves it by attempting the denial with a
 * maximally-permissive grant, an explicit approval, and a `read_only` class.
 *
 * This mirrors, in the permission layer, what
 * `relay-bridge/reviewer-harness/hermes/isolated-profile.ts` already enforces
 * in the process layer with `mcp_servers: {}`. Two independent mechanisms, the
 * same answer, and neither is weakened by this milestone. The Reviewer's
 * independence is the product's core claim; an MCP tool in its hands is a
 * channel through which the thing being reviewed could reach the reviewer.
 *
 * EVERYTHING ELSE FAILS CLOSED. The default for an unrecognised role, an
 * unrecognised risk class, or an `unknown` classification is `deny`. A
 * permission model whose gaps default to "allow" has no gaps — it has one
 * enormous one.
 *
 * A DECISION IS NOT AN APPROVAL. `requires_approval` means policy would permit
 * this operation IF a human approves it. The approval broker
 * (`mcp-approvals.ts`) is a separate, later gate, and the gateway must pass
 * both. Collapsing the two would let a role default stand in for a human.
 */

import type { McpCapabilityKind } from '../domain/mcp-capabilities';
import type { McpServerIdentity } from '../domain/mcp-identity';
import type { McpPermissionGrantId } from '../../protocol/ids';
import { MCP_RISK_CLASSES, requiresHumanApproval, type McpRiskClass } from './mcp-risk';

/** Relay roles as the MCP layer sees them. Values match `protocol/enums.ts`. */
export const MCP_AGENT_ROLES = [
  'architect',
  'coding-agent',
  'reviewer',
  'security-reviewer',
  'operations',
  'verification',
] as const;
export type McpAgentRole = (typeof MCP_AGENT_ROLES)[number];

/**
 * Roles that receive NO MCP access under any configuration.
 *
 * `security-reviewer` is included for the same reason as `reviewer`: it is a
 * reviewing role, and a reviewing role with tool access is no longer
 * independent of what it reviews.
 */
export const MCP_FORBIDDEN_ROLES: readonly McpAgentRole[] = Object.freeze([
  'reviewer',
  'security-reviewer',
]);

export const MCP_PERMISSION_DECISIONS = ['allow', 'requires_approval', 'deny'] as const;
export type McpPermissionDecisionKind = (typeof MCP_PERMISSION_DECISIONS)[number];

export interface McpPermissionDecision {
  readonly decision: McpPermissionDecisionKind;
  /** A safe, specific reason. Rendered identically by the CLI and website. */
  readonly reason: string;
  /** Ordered evidence for how the decision was reached. */
  readonly evidence: readonly string[];
  /** The grant that permitted it, when one did. */
  readonly grantId: McpPermissionGrantId | null;
}

const deny = (reason: string, evidence: readonly string[] = []): McpPermissionDecision =>
  ({ decision: 'deny', reason, evidence, grantId: null });

/* ------------------------------------------------------------------ *
 * Role defaults (§11).
 * ------------------------------------------------------------------ */

export interface McpRoleDefaults {
  /** Risk classes this role may use WITHOUT a human in the loop. */
  readonly allowedRiskClasses: readonly McpRiskClass[];
  /** Risk classes this role may use WITH explicit human approval. */
  readonly approvableRiskClasses: readonly McpRiskClass[];
  /** Capability kinds this role may touch at all. */
  readonly allowedCapabilityKinds: readonly McpCapabilityKind[];
  readonly summary: string;
}

export const MCP_ROLE_DEFAULTS: Readonly<Record<McpAgentRole, McpRoleDefaults>> = Object.freeze({
  /**
   * PROMPT ARCHITECT — reads, and only reads. It designs work; it does not
   * perform it. Everything that changes state is denied by default and is not
   * even approvable for this role, because an architect that can write is a
   * coding agent with a different name.
   */
  architect: {
    allowedRiskClasses: ['read_only'],
    approvableRiskClasses: [],
    allowedCapabilityKinds: ['tool', 'resource', 'prompt'],
    summary: 'read-only research, documentation and repository reading; no writes, messages, deployment, credentials or destructive tools',
  },

  /**
   * CODING AGENT — may write INSIDE the workspace when a mission scopes it.
   * `workspace_write` is allowed without a per-call human approval because the
   * mission contract already scoped the paths (see `pathWithinMissionScope`);
   * everything that leaves the workspace requires a human.
   */
  'coding-agent': {
    allowedRiskClasses: ['read_only', 'workspace_write'],
    approvableRiskClasses: ['external_write'],
    allowedCapabilityKinds: ['tool', 'resource', 'prompt'],
    summary: 'repository reads and mission-scoped workspace writes; external writes need human approval; deployment, secrets, financial and destructive operations are denied',
  },

  /** INDEPENDENT REVIEWER — no MCP. Ever. See the module docstring. */
  reviewer: {
    allowedRiskClasses: [],
    approvableRiskClasses: [],
    allowedCapabilityKinds: [],
    summary: 'no MCP connections, tools, resources or prompts — the Reviewer receives Relay-curated immutable evidence only',
  },
  'security-reviewer': {
    allowedRiskClasses: [],
    approvableRiskClasses: [],
    allowedCapabilityKinds: [],
    summary: 'no MCP access — a reviewing role with tool access is not independent of what it reviews',
  },

  /** Not wired to MCP in this milestone. Denied rather than left undefined. */
  operations: {
    allowedRiskClasses: [],
    approvableRiskClasses: [],
    allowedCapabilityKinds: [],
    summary: 'no MCP access in this milestone',
  },
  verification: {
    allowedRiskClasses: [],
    approvableRiskClasses: [],
    allowedCapabilityKinds: [],
    summary: 'no MCP access in this milestone',
  },
});

/* ------------------------------------------------------------------ *
 * Grants.
 * ------------------------------------------------------------------ */

export interface McpPermissionGrant {
  readonly grantId: McpPermissionGrantId;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly missionId: string | null;
  /** The PSP Agent this grant was issued for, when it came from a PSP. */
  readonly pspAgentFingerprint: string | null;
  readonly role: McpAgentRole;
  readonly registryEntryId: string;
  readonly capabilityKind: McpCapabilityKind;
  /** Exact capability names/URIs. `*` is deliberately NOT supported. */
  readonly capabilityNames: readonly string[];
  readonly maximumRiskClass: McpRiskClass;
  /** Workspace-relative path prefixes a write may touch. Empty = none. */
  readonly writablePathPrefixes: readonly string[];
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface McpPermissionEvaluationInput {
  /* identity */
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly missionId: string | null;
  readonly pspAgentFingerprint: string | null;
  readonly actualAgentId: string;
  readonly role: string;

  /* target */
  readonly serverIdentity: McpServerIdentity;
  readonly registryEntryId: string;
  readonly capabilitySnapshotIsApproved: boolean;
  readonly capabilityExistsInSnapshot: boolean;
  readonly capabilityKind: McpCapabilityKind;
  readonly capabilityName: string;
  readonly normalizedArguments: Record<string, unknown>;

  /* policy inputs */
  readonly riskClass: McpRiskClass;
  readonly missingCredentialScopes: readonly string[];
  readonly networkPolicyAllows: boolean;
  readonly grants: readonly McpPermissionGrant[];
  /** Paths a mission scopes a workspace write to. Empty = no write scope. */
  readonly missionWritablePathPrefixes: readonly string[];
  readonly now: string;
}

/** Normalizes a workspace path for prefix comparison. */
export function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

/**
 * Whether a write target sits inside an allowed prefix.
 *
 * Rejects absolute paths and any `..` segment OUTRIGHT rather than trying to
 * resolve them: a prefix check performed on an unresolved path is how
 * `src/../../etc/passwd` passes a `src/` filter. Relay's answer to a path it
 * would have to normalize before trusting is to refuse it.
 */
export function pathWithinScope(target: string, prefixes: readonly string[]): boolean {
  const path = normalizeWorkspacePath(target);
  if (path.startsWith('/') || /^[A-Za-z]:/.test(path)) return false;
  if (path.split('/').includes('..')) return false;
  if (prefixes.length === 0) return false;
  return prefixes.some((prefix) => {
    const normalized = normalizeWorkspacePath(prefix);
    const bounded = normalized.endsWith('/') ? normalized : `${normalized}/`;
    return path === normalized || path.startsWith(bounded);
  });
}

/** Argument keys that name a write target, checked against the mission scope. */
const WRITE_TARGET_KEYS = ['path', 'file', 'filepath', 'file_path', 'filename', 'directory', 'dir', 'target', 'destination'];

function writeTargets(args: Record<string, unknown>): string[] {
  const targets: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && WRITE_TARGET_KEYS.includes(key.toLowerCase())) targets.push(value);
  }
  return targets;
}

const isRole = (value: string): value is McpAgentRole =>
  (MCP_AGENT_ROLES as readonly string[]).includes(value);

const isRiskClass = (value: string): value is McpRiskClass =>
  (MCP_RISK_CLASSES as readonly string[]).includes(value);

const grantActive = (grant: McpPermissionGrant, now: string): boolean => {
  if (grant.revokedAt !== null) return false;
  if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= Date.parse(now)) return false;
  return true;
};

/**
 * THE EVALUATION. Order matters and is deliberate: the checks that can never be
 * overridden come first, so no later branch can reach past them.
 */
export function evaluatePermission(input: McpPermissionEvaluationInput): McpPermissionDecision {
  const evidence: string[] = [];

  /* 1. REVIEWER ISOLATION — first, unconditional, unoverridable. */
  if (!isRole(input.role)) {
    return deny(`the role "${input.role}" is not a recognised Relay role — MCP access fails closed`, evidence);
  }
  if (MCP_FORBIDDEN_ROLES.includes(input.role)) {
    return deny(
      `the ${input.role} role has no MCP access by design — it receives Relay-curated immutable evidence only`,
      [`${input.role} is on the permanent MCP denial list; no grant, approval or risk class can change this`],
    );
  }

  const defaults = MCP_ROLE_DEFAULTS[input.role];
  evidence.push(`role ${input.role}: ${defaults.summary}`);

  /* 2. Capability kind the role may touch at all. */
  if (!defaults.allowedCapabilityKinds.includes(input.capabilityKind)) {
    return deny(`the ${input.role} role may not use MCP ${input.capabilityKind}s`, evidence);
  }

  /* 3. Trust and snapshot integrity. */
  if (input.serverIdentity.trust === 'untrusted') {
    return deny('the server is untrusted — its identity did not match its curated registry entry', evidence);
  }
  if (!input.capabilitySnapshotIsApproved) {
    return deny('the capability snapshot in use has not been approved for this mission', evidence);
  }
  if (!input.capabilityExistsInSnapshot) {
    return deny(
      `"${input.capabilityName}" does not exist in the approved capability snapshot`,
      [...evidence, 'a capability absent from the approved snapshot cannot be invoked even if the live server offers it'],
    );
  }

  /* 4. Network policy. */
  if (!input.networkPolicyAllows) {
    return deny('the network policy does not permit this connection', evidence);
  }

  /* 5. Credentials. */
  if (input.missingCredentialScopes.length > 0) {
    return deny(
      `the resolved credential is missing required scope(s): ${input.missingCredentialScopes.join(', ')}`,
      evidence,
    );
  }

  /* 6. Risk class — `unknown` fails closed for every role. */
  if (!isRiskClass(input.riskClass) || input.riskClass === 'unknown') {
    return deny(
      'Relay could not classify this operation — an unclassified MCP operation is refused',
      [...evidence, 'unknown risk fails closed by policy (§10)'],
    );
  }

  /* 7. Grants. A grant may only narrow or confirm; it never widens past the
   *    role's approvable ceiling. */
  const applicable = input.grants.filter((grant) =>
    grantActive(grant, input.now)
    && grant.accountId === input.accountId
    && grant.workspaceId === input.workspaceId
    && (grant.projectId === null || grant.projectId === input.projectId)
    && (grant.missionId === null || grant.missionId === input.missionId)
    && grant.role === input.role
    && grant.registryEntryId === input.registryEntryId
    && grant.capabilityKind === input.capabilityKind
    && grant.capabilityNames.includes(input.capabilityName));

  const roleAllows = defaults.allowedRiskClasses.includes(input.riskClass);
  const roleApprovable = defaults.approvableRiskClasses.includes(input.riskClass);

  if (!roleAllows && !roleApprovable) {
    return deny(
      `the ${input.role} role may not perform ${input.riskClass} operations`,
      [...evidence, `${input.riskClass} is neither allowed nor approvable for this role`],
    );
  }

  const grant = applicable.find((entry) =>
    (MCP_RISK_CLASSES.indexOf(entry.maximumRiskClass) >= 0)
    && riskWithinGrant(input.riskClass, entry.maximumRiskClass));

  if (applicable.length === 0) {
    return deny(
      `no permission grant covers "${input.capabilityName}" for this agent`,
      [...evidence, 'grants name exact capabilities; there is deliberately no wildcard grant'],
    );
  }
  if (!grant) {
    return deny(
      `the available grant does not extend to ${input.riskClass} operations`,
      evidence,
    );
  }
  evidence.push(`grant ${grant.grantId} covers "${input.capabilityName}" up to ${grant.maximumRiskClass}`);

  /* 8. Workspace writes must be PATH-SCOPED (§12). */
  if (input.riskClass === 'workspace_write') {
    const targets = writeTargets(input.normalizedArguments);
    const allowedPrefixes = grant.writablePathPrefixes.length > 0
      ? grant.writablePathPrefixes
      : input.missionWritablePathPrefixes;
    if (allowedPrefixes.length === 0) {
      return deny('no writable path scope is defined for this mission or grant', evidence);
    }
    for (const target of targets) {
      if (!pathWithinScope(target, allowedPrefixes)) {
        return deny(
          `the write target "${target}" is outside the approved path scope`,
          [...evidence, `approved prefixes: ${allowedPrefixes.join(', ')}`],
        );
      }
    }
    if (targets.length === 0) {
      return deny(
        'a workspace write must name its target path so the path scope can be checked',
        evidence,
      );
    }
    evidence.push(`write target(s) are within the approved path scope`);
  }

  /* 9. Human approval. */
  if (requiresHumanApproval(input.riskClass)) {
    return {
      decision: 'requires_approval',
      reason: `${input.riskClass} operations require explicit human approval`,
      evidence,
      grantId: grant.grantId,
    };
  }
  if (!roleAllows) {
    return {
      decision: 'requires_approval',
      reason: `the ${input.role} role may perform ${input.riskClass} operations only with human approval`,
      evidence,
      grantId: grant.grantId,
    };
  }

  return { decision: 'allow', reason: `permitted: ${input.riskClass} for ${input.role}`, evidence, grantId: grant.grantId };
}

const RISK_ORDER: readonly McpRiskClass[] = [
  'read_only', 'workspace_write', 'external_write', 'deployment', 'financial', 'credential_access', 'destructive', 'unknown',
];

/** A grant covers a class only when that class is at or below its ceiling. */
function riskWithinGrant(riskClass: McpRiskClass, ceiling: McpRiskClass): boolean {
  // `unknown` is never within any grant — it is not a level, it is the absence
  // of one, and a ceiling of `unknown` would otherwise read as "everything".
  if (riskClass === 'unknown' || ceiling === 'unknown') return false;
  return RISK_ORDER.indexOf(riskClass) <= RISK_ORDER.indexOf(ceiling);
}
