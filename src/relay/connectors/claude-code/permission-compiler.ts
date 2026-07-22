import type { AgentHandoffPackage } from '../../protocol/contracts';
import type { ClaudeCodeCapabilityProfile, ClaudeToolPolicy } from './contracts';

/**
 * Permission compiler (Prompt 8) — PURE. Compiles the provider-neutral
 * handoff into a Claude tool policy. The initial safe-edit fixture needs
 * NO Claude-controlled Bash: Read/Glob/Grep/Edit only (Write added only
 * when the task claims a file that must be created). Generic Bash, network,
 * MCP, deployment, and Git-mutation tools are never allowed.
 *
 * The permission-skip flag is never emitted (asserted by boundary tests).
 * Path-scoped Edit rules are treated as ADVISORY on this CLI: the
 * authoritative control is Relay's post-execution workspace inspection.
 */

const READ_TOOLS = ['Read', 'Glob', 'Grep'] as const;
const EDIT_TOOL = 'Edit';
const WRITE_TOOL = 'Write';

/** Tools that must never be offered to the coding agent this phase. */
export const FORBIDDEN_TOOLS = [
  'Bash', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Task',
  'KillShell', 'BashOutput', 'SlashCommand',
] as const;

export interface PermissionCompileInput {
  pkg: AgentHandoffPackage;
  capabilities: ClaudeCodeCapabilityProfile;
  /** True when the task requires creating a named new file (adds Write). */
  requiresFileCreation?: boolean;
}

export function compileClaudePermissions(input: PermissionCompileInput): ClaudeToolPolicy {
  const { capabilities, requiresFileCreation } = input;

  const availableTools = [...READ_TOOLS, EDIT_TOOL];
  if (requiresFileCreation) availableTools.push(WRITE_TOOL);

  // Path-scoped allow rules would be compiled from pkg.permittedFiles, but
  // this CLI version cannot enforce them reliably — enforcement is the
  // post-execution inspection gate, so the allow-list stays tool-level.
  const allowedTools = [...READ_TOOLS, EDIT_TOOL, ...(requiresFileCreation ? [WRITE_TOOL] : [])];

  const disallowedTools = [...FORBIDDEN_TOOLS];

  return {
    availableTools,
    allowedTools,
    disallowedTools,
    // acceptEdits lets the non-interactive session apply edits without a
    // prompt; the tool restriction (no Bash) is the real containment, plus
    // the isolated worktree and the inspection gate.
    permissionMode: 'acceptEdits',
    // We do NOT claim path-scoped Edit is enforced on this CLI version.
    editPathScopingEnforced: false && capabilities.allowedToolsSupported,
  };
}

/** The exact tool-restriction CLI arguments for the compiled policy. */
export function toolPolicyArgs(policy: ClaudeToolPolicy, capabilities: ClaudeCodeCapabilityProfile): string[] {
  const args: string[] = [];
  if (capabilities.toolsRestrictionSupported) {
    args.push('--tools', policy.availableTools.join(','));
  }
  if (capabilities.allowedToolsSupported) {
    args.push('--allowedTools', policy.allowedTools.join(' '));
  }
  if (capabilities.disallowedToolsSupported) {
    args.push('--disallowedTools', policy.disallowedTools.join(' '));
  }
  if (capabilities.permissionModeSupported) {
    args.push('--permission-mode', policy.permissionMode);
  }
  return args;
}
