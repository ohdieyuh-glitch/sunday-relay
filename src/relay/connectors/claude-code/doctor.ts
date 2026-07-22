import { classifyClaudeAuth, probeClaudeCapabilities } from './capability-probe';
import { apiKeyEnvironmentDetected } from './environment';
import { CLAUDE_AUTH_PROFILE } from './contracts';

/**
 * Claude Code doctor (Prompt 8) — truthful, read-only. Reports installed
 * capabilities and a SAFE authentication classification. Makes NO model
 * call and prints NO credential contents, tokens, email, org, or billing.
 * Distinguishes installed from authenticated and supported from unverified.
 */

const support = (v: boolean): string => (v ? 'available' : 'unavailable');

export function claudeDoctorReport(now: string): { lines: string[]; exitCode: number } {
  const caps = probeClaudeCapabilities(now);
  const auth = classifyClaudeAuth(now, caps.executablePath);
  const apiEnv = apiKeyEnvironmentDetected();

  const authReadiness =
    !caps.executablePath ? 'unverified (no executable)'
      : auth.sourceClass === 'not_logged_in' ? 'not ready (not signed in)'
        : auth.approvedForLiveRun ? 'ready (local subscription)'
          : auth.sourceClass === 'api_key' ? 'not ready (API-key source is not permitted)'
            : auth.sourceClass === 'unknown' ? 'unverified'
              : `not ready (${auth.sourceClass} source not permitted)`;

  const checks: Array<[string, string]> = [
    ['Claude executable', caps.executablePath ? 'found' : 'MISSING'],
    ['Claude version', caps.version ?? 'unknown'],
    ['Non-interactive mode', support(caps.nonInteractiveSupported)],
    ['Streaming output', support(caps.streamJsonSupported)],
    ['Explicit session resume', support(caps.explicitResumeSupported)],
    ['Maximum-turn control', caps.maxTurnsSupported ? 'available' : 'unavailable (bounded by runtime/output/calls)'],
    ['Tool permission controls', support(caps.allowedToolsSupported && caps.disallowedToolsSupported && caps.toolsRestrictionSupported)],
    ['Permission mode', support(caps.permissionModeSupported)],
    ['Structured output schema', support(caps.structuredSchemaSupported)],
    ['Settings isolation', caps.settingsIsolationSupported],
    ['MCP isolation', caps.mcpIsolationSupported],
    ['Local isolated workspace', 'available'],
    ['Live Claude authentication', authReadiness],
    ['API-key environment detected', apiEnv ? 'yes' : 'no'],
    ['Relay permits API-key auth', 'no (by default)'],
    [`Auth profile (${CLAUDE_AUTH_PROFILE})`, auth.approvedForLiveRun ? `selected (${auth.subscriptionLabel})` : 'unavailable'],
    ['Live coding run', 'requires explicit approval (--confirm-live)'],
    ['Codex reviewer', 'unavailable'],
    ['Hermes execution', 'unavailable'],
    ['Durable resume', 'unavailable'],
  ];

  // Doctor is informational: exit 0 unless the executable is missing.
  const exitCode = caps.executablePath ? 0 : 8;
  return {
    lines: ['RELAY CLAUDE CODE DOCTOR', ...checks.map(([k, v]) => `  ${k.padEnd(30)} ${v}`)],
    exitCode,
  };
}
