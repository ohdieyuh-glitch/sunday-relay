/**
 * INDEPENDENT RISK CLASSIFICATION (PURE).
 *
 * THE CENTRAL RULE (§10): **MCP server annotations are evidence, not
 * authority.**
 *
 * A server that wants to be trusted only has to set `readOnlyHint: true`. If
 * Relay classified risk from annotations, its entire permission model would be
 * a suggestion box that the least trustworthy party in the system gets to fill
 * in. So the classifier below never READS an annotation to decide a class. It
 * reads them only to record CORROBORATION or CONTRADICTION — and a server
 * whose `readOnlyHint` disagrees with Relay's own finding produces a recorded
 * `annotation_contradiction`, which is a security signal worth more than the
 * hint ever was.
 *
 * WHAT THE CLASSIFIER ACTUALLY USES, in precedence order:
 *
 *   1. an explicit, founder-authorized policy override for this exact tool;
 *   2. the curated REGISTRY manifest's declared class for the tool;
 *   3. Relay's own analysis of the normalized name, the description, the input
 *      schema, and — where it changes the answer — the ARGUMENT VALUES;
 *   4. `unknown`.
 *
 * `unknown` FAILS CLOSED, and this is the property most worth protecting.
 * `unknown` is not a middle ground between safe and dangerous: it is the state
 * of not knowing, and `../policy/mcp-permissions.ts` denies it for every role
 * and requires explicit human approval to proceed. A tool Relay cannot
 * classify is more dangerous than one it classifies as destructive, because
 * the destructive one is at least understood.
 *
 * AN OVERRIDE CANNOT QUIETLY LOWER RISK. Raising is always allowed. Lowering
 * requires `founderAuthorized: true` AND is recorded in the evidence trail, so
 * "someone turned the classifier off for this tool" is visible in the audit
 * record rather than discoverable only by reading configuration.
 */

import type { McpToolAnnotations } from '../domain/mcp-capabilities';

export const MCP_RISK_CLASSES = [
  'read_only',
  'workspace_write',
  'external_write',
  'financial',
  'deployment',
  'credential_access',
  'destructive',
  'unknown',
] as const;
export type McpRiskClass = (typeof MCP_RISK_CLASSES)[number];

/**
 * Severity ORDER, used when several signals fire. `unknown` sits at the TOP,
 * above `destructive`: when Relay both recognises a destructive pattern and
 * fails to understand part of the call, the honest answer is that it does not
 * know what this does.
 */
const SEVERITY: Readonly<Record<McpRiskClass, number>> = Object.freeze({
  read_only: 0,
  workspace_write: 1,
  external_write: 2,
  deployment: 3,
  financial: 4,
  credential_access: 5,
  destructive: 6,
  unknown: 7,
});

export const riskSeverity = (riskClass: McpRiskClass): number => SEVERITY[riskClass];
export const higherRisk = (a: McpRiskClass, b: McpRiskClass): McpRiskClass =>
  SEVERITY[a] >= SEVERITY[b] ? a : b;

/** Classes that ALWAYS require an explicit human approval (§12). */
export const MCP_HUMAN_APPROVAL_RISK_CLASSES: readonly McpRiskClass[] = Object.freeze([
  'external_write', 'deployment', 'financial', 'credential_access', 'destructive', 'unknown',
]);

export const requiresHumanApproval = (riskClass: McpRiskClass): boolean =>
  MCP_HUMAN_APPROVAL_RISK_CLASSES.includes(riskClass);

/**
 * Normalizes a tool name into `snake_case` words so `mergePullRequest`,
 * `merge-pull-request` and `MERGE_PULL_REQUEST` all match the same rule. A
 * classifier that can be defeated by camelCase is not a classifier.
 */
export function normalizeToolName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

const words = (normalized: string): string[] => normalized.split('_').filter(Boolean);

/** A rule fires when EVERY term in `all` is present, or ANY term in `any` is. */
interface RiskRule {
  readonly riskClass: McpRiskClass;
  readonly why: string;
  readonly any?: readonly string[];
  readonly all?: readonly string[];
}

/**
 * Ordered most-severe-first. The examples named in §10 are each covered, and
 * each is a TEST CASE in `mcp-risk.test.ts` rather than a comment here.
 */
const RULES: readonly RiskRule[] = Object.freeze([
  /* destructive */
  { riskClass: 'destructive', why: 'drops or truncates a database object', any: ['drop', 'truncate'] },
  { riskClass: 'destructive', why: 'deletes or destroys a resource', any: ['delete', 'destroy', 'purge', 'wipe', 'erase', 'rm', 'rmdir', 'unlink'] },
  { riskClass: 'destructive', why: 'force-pushes or rewrites history', all: ['force', 'push'] },
  { riskClass: 'destructive', why: 'resets or reverts state irreversibly', any: ['reset', 'rollback', 'revert', 'restore'] },
  { riskClass: 'destructive', why: 'merges a pull request — irreversible on a shared branch', all: ['merge', 'pull', 'request'] },
  { riskClass: 'destructive', why: 'merges a branch', all: ['merge', 'branch'] },

  /* credential access */
  { riskClass: 'credential_access', why: 'reads or writes secret material', any: ['secret', 'credential', 'token', 'apikey', 'password', 'keypair', 'vault'] },

  /* financial */
  { riskClass: 'financial', why: 'moves money', any: ['charge', 'payment', 'payout', 'invoice', 'refund', 'subscription', 'billing', 'purchase', 'checkout'] },

  /* deployment */
  { riskClass: 'deployment', why: 'deploys or releases', any: ['deploy', 'release', 'rollout', 'publish', 'promote', 'provision'] },
  { riskClass: 'deployment', why: 'restarts or scales infrastructure', any: ['restart', 'scale', 'terminate', 'reboot'] },

  /* external write */
  { riskClass: 'external_write', why: 'creates or modifies a record outside the workspace', all: ['create', 'issue'] },
  { riskClass: 'external_write', why: 'creates or modifies a pull request', all: ['create', 'pull'] },
  { riskClass: 'external_write', why: 'sends a message to a third party', any: ['send', 'post', 'notify', 'email', 'sms', 'webhook', 'comment'] },
  { riskClass: 'external_write', why: 'modifies a remote tracker record', any: ['assign', 'label', 'milestone', 'close', 'reopen'] },

  /* workspace write */
  { riskClass: 'workspace_write', why: 'writes to the workspace filesystem', any: ['write', 'edit', 'patch', 'apply', 'mkdir', 'move', 'rename', 'copy', 'format'] },
  { riskClass: 'workspace_write', why: 'creates a branch or commit in the workspace', any: ['commit', 'stage', 'checkout', 'branch'] },
  { riskClass: 'workspace_write', why: 'inserts or updates rows', any: ['insert', 'update', 'upsert', 'migrate'] },
  { riskClass: 'workspace_write', why: 'runs a build or test that writes artifacts', any: ['build', 'test', 'compile', 'install', 'run', 'exec'] },

  /* read only */
  { riskClass: 'read_only', why: 'reads without modifying', any: ['read', 'get', 'list', 'search', 'find', 'query', 'describe', 'inspect', 'show', 'view', 'fetch', 'lookup', 'diff', 'status', 'log', 'grep'] },
]);

export interface McpRiskOverride {
  readonly toolName: string;
  readonly riskClass: McpRiskClass;
  /** Lowering risk requires this to be true. Raising never does. */
  readonly founderAuthorized: boolean;
  readonly reason: string;
}

export interface McpRiskClassificationInput {
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: McpToolAnnotations;
  /** The curated registry's declared class for this tool, when it declares one. */
  readonly registryDeclaredClass: McpRiskClass | null;
  /** Whether the running server's identity was independently verified. */
  readonly serverIdentityVerified: boolean;
  /** Actual argument values, when the call is being classified (not discovery). */
  readonly argumentValues?: Record<string, unknown>;
  readonly overrides?: readonly McpRiskOverride[];
}

export interface McpRiskAssessment {
  readonly riskClass: McpRiskClass;
  /** Ordered, human-readable evidence for the classification. */
  readonly evidence: readonly string[];
  /** True when the server's own hints disagree with Relay's finding. */
  readonly annotationContradiction: boolean;
  /** True when an override changed the outcome. */
  readonly overrideApplied: boolean;
  readonly requiresHumanApproval: boolean;
  /** True when the operation is believed reversible. Advisory, recorded. */
  readonly reversible: boolean;
  /** True when the operation crosses out of the workspace boundary. */
  readonly crossesWorkspaceBoundary: boolean;
}

/** Schema property names that indicate a filesystem write target. */
const PATH_PROPERTIES = new Set(['path', 'file', 'filepath', 'file_path', 'filename', 'directory', 'dir', 'target', 'destination']);
/** Schema property names that indicate a remote destination. */
const REMOTE_PROPERTIES = new Set(['url', 'endpoint', 'host', 'origin', 'repository', 'repo', 'owner', 'channel', 'recipient', 'to']);

function schemaPropertyNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) return [];
  return Object.keys(properties as Record<string, unknown>).map((key) => key.toLowerCase());
}

export function classifyRisk(input: McpRiskClassificationInput): McpRiskAssessment {
  const evidence: string[] = [];
  const normalized = normalizeToolName(input.toolName);
  const nameWords = new Set(words(normalized));
  const descriptionWords = new Set(words(normalizeToolName(input.description)));
  const properties = schemaPropertyNames(input.inputSchema);
  const propertySet = new Set(properties);

  /* ---- 1. Relay's own analysis of the NAME ---- */
  let derived: McpRiskClass = 'unknown';
  for (const rule of RULES) {
    const matchesAny = rule.any?.some((term) => nameWords.has(term)) ?? false;
    const matchesAll = rule.all?.every((term) => nameWords.has(term)) ?? false;
    if (matchesAny || matchesAll) {
      derived = rule.riskClass;
      evidence.push(`name "${normalized}" ${rule.why}`);
      break;
    }
  }

  /* ---- 2. The DESCRIPTION can only raise, never lower ---- */
  if (input.description.trim() !== '') {
    for (const rule of RULES) {
      if (rule.riskClass === 'read_only') break; // a read-only word in prose proves nothing
      const matchesAny = rule.any?.some((term) => descriptionWords.has(term)) ?? false;
      const matchesAll = rule.all?.every((term) => descriptionWords.has(term)) ?? false;
      if (matchesAny || matchesAll) {
        if (derived === 'unknown' || SEVERITY[rule.riskClass] > SEVERITY[derived]) {
          evidence.push(`description ${rule.why}`);
          derived = derived === 'unknown' ? rule.riskClass : higherRisk(derived, rule.riskClass);
        }
        break;
      }
    }
  }

  /* ---- 3. SCHEMA signals ---- */
  const hasPathProperty = properties.some((name) => PATH_PROPERTIES.has(name));
  const hasRemoteProperty = properties.some((name) => REMOTE_PROPERTIES.has(name));
  const hasContentProperty = propertySet.has('content') || propertySet.has('contents') || propertySet.has('body') || propertySet.has('text') || propertySet.has('data');

  if (derived === 'read_only' && hasPathProperty && hasContentProperty) {
    // "read" in the name plus a path AND a content payload is a write wearing
    // a read's name. The schema is the stronger evidence.
    evidence.push('input schema accepts both a path and a content payload — this writes');
    derived = 'workspace_write';
  }
  if (derived === 'workspace_write' && hasRemoteProperty && !hasPathProperty) {
    evidence.push('input schema targets a remote destination rather than a workspace path');
    derived = 'external_write';
  }

  /* ---- 4. ARGUMENT VALUES, when present ---- */
  let crossesWorkspaceBoundary = hasRemoteProperty;
  if (input.argumentValues) {
    for (const [key, value] of Object.entries(input.argumentValues)) {
      if (typeof value !== 'string') continue;
      const lowered = key.toLowerCase();
      if (REMOTE_PROPERTIES.has(lowered) && /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
        crossesWorkspaceBoundary = true;
        evidence.push(`argument "${key}" names an absolute remote destination`);
      }
      if (PATH_PROPERTIES.has(lowered) && (value.startsWith('/') || value.includes('..'))) {
        crossesWorkspaceBoundary = true;
        evidence.push(`argument "${key}" escapes the workspace root`);
        derived = higherRisk(derived, 'workspace_write');
      }
    }
  }

  /* ---- 5. REGISTRY manifest — a FLOOR, never a ceiling ---- */
  if (input.registryDeclaredClass !== null) {
    if (SEVERITY[input.registryDeclaredClass] > SEVERITY[derived]) {
      evidence.push(`the curated registry declares this tool ${input.registryDeclaredClass}`);
      derived = input.registryDeclaredClass;
    } else if (derived === 'unknown') {
      evidence.push(`the curated registry declares this tool ${input.registryDeclaredClass}`);
      derived = input.registryDeclaredClass;
    }
  }

  /* ---- 6. Unverified identity cannot hold a low classification ---- */
  if (!input.serverIdentityVerified && derived !== 'unknown' && SEVERITY[derived] < SEVERITY.external_write) {
    evidence.push('the running server identity was not independently verified, so a low classification cannot be relied on');
    derived = 'unknown';
  }

  if (derived === 'unknown' && evidence.length === 0) {
    evidence.push('no rule, registry declaration or schema signal identified this operation');
  }

  /* ---- 7. OVERRIDES ---- */
  let overrideApplied = false;
  const override = input.overrides?.find((entry) => entry.toolName === input.toolName);
  if (override) {
    const lowering = SEVERITY[override.riskClass] < SEVERITY[derived];
    if (!lowering) {
      evidence.push(`policy override raises the class to ${override.riskClass}: ${override.reason}`);
      derived = override.riskClass;
      overrideApplied = true;
    } else if (override.founderAuthorized) {
      evidence.push(`FOUNDER-AUTHORIZED override lowers the class from ${derived} to ${override.riskClass}: ${override.reason}`);
      derived = override.riskClass;
      overrideApplied = true;
    } else {
      evidence.push(`policy override to ${override.riskClass} was REFUSED — lowering risk requires founder authorization`);
    }
  }

  /* ---- 8. ANNOTATIONS: corroboration only ---- */
  const claimsReadOnly = input.annotations.readOnlyHint === true;
  const claimsNonDestructive = input.annotations.destructiveHint === false;
  const annotationContradiction =
    (claimsReadOnly && derived !== 'read_only')
    || (claimsNonDestructive && derived === 'destructive');
  if (annotationContradiction) {
    evidence.push(
      `the server's own annotations claim a safer operation than Relay's classification (${derived}) — recorded as evidence, not honoured`,
    );
  }

  return {
    riskClass: derived,
    evidence,
    annotationContradiction,
    overrideApplied,
    requiresHumanApproval: requiresHumanApproval(derived),
    reversible: derived === 'read_only' || derived === 'workspace_write',
    crossesWorkspaceBoundary,
  };
}
