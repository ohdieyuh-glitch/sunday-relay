import type { CodexReviewerCapabilityProfile } from './contracts';

/**
 * Codex Reviewer permission compiler (Prompt 8.3) — PURE. Compiles the
 * STRICTEST supported read-only invocation for `codex exec`. The Reviewer may
 * only read; it may never write, run destructive commands, reach the network,
 * enable hooks/plugins/MCP, gain extra writable directories, or bypass the
 * sandbox. A sandbox-bypass flag is NEVER emitted (boundary-tested).
 *
 * The Prompt-7 workspace inspection runs before AND after the review as the
 * enforced control; the flags below are the adapter-level defense in depth.
 */

export interface ReviewerPermissionPlan {
  args: string[];
  readOnly: true;
  networkDisabled: true;
  hooksDisabled: true;
  pluginsDisabled: true;
  mcpDisabled: true;
  additionalWritableDirs: 0;
  /** Config-isolation controls actually applied (truthful for the audit). */
  appliedIsolation: string[];
  /** Config-isolation controls NOT supported by the installed CLI. */
  unsupportedIsolation: string[];
}

/** Flags that must NEVER appear in any Reviewer invocation. */
export const FORBIDDEN_FLAGS = [
  '--dangerously-bypass-approvals-and-sandbox',
  '--dangerously-bypass-hook-trust',
  '--add-dir',
  '--full-auto',
] as const;

export interface CompileReviewerPermissionsInput {
  capabilities: CodexReviewerCapabilityProfile;
  workspacePath: string;
  outputSchemaPath: string | null;
  outputLastMessagePath: string;
  /** Optional exact session id to resume for a re-review. */
  resumeSessionId?: string;
  model?: string | null;
}

export function compileReviewerPermissions(input: CompileReviewerPermissionsInput): ReviewerPermissionPlan {
  const caps = input.capabilities;
  const applied: string[] = [];
  const unsupported: string[] = [];

  const args: string[] = ['exec'];
  // Exact-session re-review resumes by UUID; otherwise a fresh session.
  if (input.resumeSessionId) {
    args.push('resume', input.resumeSessionId);
  }

  // Read-only sandbox (strictest). If unavailable the caller must refuse to
  // launch (see live-runner prerequisites) — we still never request write.
  if (caps.readOnlySandboxSupported) {
    args.push('--sandbox', 'read-only');
    applied.push('read-only sandbox');
  } else {
    unsupported.push('read-only sandbox');
  }

  // Explicit working directory (isolated worktree only).
  args.push('--cd', input.workspacePath);
  applied.push('explicit working directory');

  // Configuration isolation — ignore user config + repo execpolicy rules,
  // strict config validation. Auth still uses CODEX_HOME.
  if (caps.ignoreUserConfigSupported) { args.push('--ignore-user-config'); applied.push('ignore user config'); }
  else unsupported.push('ignore user config');
  if (caps.ignoreRulesSupported) { args.push('--ignore-rules'); applied.push('ignore repository rules'); }
  else unsupported.push('ignore repository rules');
  if (caps.strictConfigSupported) { args.push('--strict-config'); applied.push('strict config validation'); }
  else unsupported.push('strict config validation');

  // Structured output — JSONL events + a schema-constrained final message +
  // the last message written to a file.
  if (caps.jsonEventsSupported) { args.push('--json'); applied.push('json events'); }
  if (caps.outputSchemaSupported && input.outputSchemaPath) {
    args.push('--output-schema', input.outputSchemaPath); applied.push('output schema');
  } else if (input.outputSchemaPath) {
    unsupported.push('output schema');
  }
  if (caps.outputLastMessageSupported) {
    args.push('--output-last-message', input.outputLastMessagePath); applied.push('output last message');
  }
  // No color noise in captured output.
  args.push('--color', 'never');
  if (input.model) args.push('--model', input.model);

  // Never enable network, hooks, plugins, MCP, or extra writable dirs — we do
  // this by OMISSION (default read-only sandbox blocks them) and by never
  // emitting any forbidden or bypass flag.

  return {
    args,
    readOnly: true, networkDisabled: true, hooksDisabled: true, pluginsDisabled: true,
    mcpDisabled: true, additionalWritableDirs: 0,
    appliedIsolation: applied, unsupportedIsolation: unsupported,
  };
}
