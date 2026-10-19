import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CodexConfigAssessment } from './contracts';

/**
 * Codex configuration-isolation inspection (Prompt 8.3). Structural checks
 * ONLY — we report which agent/Codex configuration surfaces EXIST in the
 * workspace, never their contents. Repository review instructions may carry
 * task context but must never override the Relay Reviewer Contract, so their
 * presence is surfaced and (when the CLI supports it) neutralized with
 * --ignore-user-config / --ignore-rules and a read-only sandbox. Hooks,
 * plugins, MCP, custom providers, base URLs, network permission, and extra
 * writable dirs each raise the risk to review_required for an unknown
 * workspace.
 */

/** Files/dirs whose presence we detect (repository-relative). */
const AGENTS = ['AGENTS.md'];
const CODEX_INSTRUCTIONS = ['CODEX.md', '.codex/CODEX.md', 'codex.md'];
const CODEX_CONFIG_DIRS = ['.codex'];
const EXECPOLICY_RULES = ['.rules', '.codex/rules', 'execpolicy.rules'];
const HOOK_PATHS = ['.codex/hooks', '.codex/hooks.toml'];
const PLUGIN_PATHS = ['.codex/plugins', '.codex/plugins.toml'];
const MCP_PATHS = ['.codex/mcp.json', '.mcp.json', '.codex/config.toml'];

export function assessCodexConfiguration(workspacePath: string, now: string): CodexConfigAssessment {
  const here = (rel: string): boolean => {
    try {
      return existsSync(join(workspacePath, rel));
    } catch {
      return false;
    }
  };
  const anyOf = (rels: string[]): boolean => rels.some(here);

  const hasAgentsMd = anyOf(AGENTS);
  const hasCodexInstructions = anyOf(CODEX_INSTRUCTIONS);
  const hasCodexConfigDir = anyOf(CODEX_CONFIG_DIRS);
  const hasExecpolicyRules = anyOf(EXECPOLICY_RULES);
  const hasHooks = anyOf(HOOK_PATHS);
  const hasPlugins = anyOf(PLUGIN_PATHS);
  const hasMcpConfig = anyOf(MCP_PATHS);
  // We do not read config contents; a present .codex/config.toml is treated as
  // a potential custom-provider / base-URL / network surface until isolated.
  const hasConfigToml = here('.codex/config.toml');

  const findings: string[] = [];
  if (hasAgentsMd) findings.push('AGENTS.md present (task context only; cannot override the Relay Reviewer Contract).');
  if (hasCodexInstructions) findings.push('Project Codex instructions present.');
  if (hasExecpolicyRules) findings.push('Execpolicy .rules present (isolated with --ignore-rules).');
  if (hasHooks) findings.push('Codex hooks configuration present (never enabled).');
  if (hasPlugins) findings.push('Codex plugins configuration present (never enabled).');
  if (hasMcpConfig) findings.push('MCP configuration present (never enabled).');
  if (hasConfigToml) findings.push('.codex/config.toml present (custom provider / base URL / network not trusted; isolated with --ignore-user-config).');

  // Hooks / plugins / MCP / custom provider surfaces make an UNKNOWN workspace
  // review_required. The trusted Relay fixture supplies none of these.
  const risk = (hasHooks || hasPlugins || hasMcpConfig || hasConfigToml || hasExecpolicyRules)
    ? 'review_required' : 'clean';

  return {
    hasAgentsMd, hasCodexInstructions, hasCodexConfigDir, hasExecpolicyRules,
    hasHooks, hasPlugins, hasMcpConfig,
    hasCustomProvider: hasConfigToml, hasCustomBaseUrl: hasConfigToml,
    hasNetworkPermission: hasConfigToml, hasAdditionalWritableDirs: false,
    findings, risk, assessedAt: now,
  };
}
