import { classifyCodexAuth, probeCodexCapabilities } from './capability-probe';
import { apiKeyEnvironmentDetected } from './environment';
import { CODEX_AUTH_PROFILE } from './contracts';

/**
 * Codex Reviewer doctor (Prompt 8.3) — truthful capability + auth report.
 * Makes NO provider call. Never prints an account email, API key, OAuth/refresh
 * token, credential path, or billing detail — only coarse readiness labels.
 */

const support = (v: boolean): string => (v ? 'available' : 'unavailable');

export function codexDoctorReport(now: string): { lines: string[]; exitCode: number } {
  const caps = probeCodexCapabilities(now);
  const auth = classifyCodexAuth(now, caps.executablePath);
  const apiEnv = apiKeyEnvironmentDetected(process.env);

  const loginReadiness =
    !caps.executablePath ? 'unverified (no executable)'
      : auth.status === 'api_key' ? 'not ready (API-key source is not permitted)'
        : auth.status === 'ready' ? 'ready (local login)'
          : auth.status === 'not_ready' ? 'not ready (not signed in)'
            : 'unverified';

  const checks: Array<[string, string]> = [
    ['Codex executable', caps.executablePath ? 'found' : 'MISSING'],
    ['Codex version', caps.version ?? 'unknown'],
    ['Non-interactive execution', support(caps.nonInteractiveExecSupported)],
    ['JSON event support', support(caps.jsonEventsSupported)],
    ['Output-schema support', support(caps.outputSchemaSupported)],
    ['Exact-session resume', support(caps.exactResumeSupported)],
    ['Native review support', support(caps.nativeReviewSupported)],
    ['Read-only sandbox', support(caps.readOnlySandboxSupported)],
    ['Configuration isolation', support(caps.ignoreUserConfigSupported && caps.ignoreRulesSupported && caps.strictConfigSupported)],
    ['Selected runtime strategy', caps.selectedRuntimeStrategy],
    ['Local login', loginReadiness],
    ['Explicit API-key environment detected', apiEnv ? 'yes' : 'no'],
    [`Approved auth profile (${CODEX_AUTH_PROFILE})`, auth.approvedForLiveReview ? 'selected' : 'unavailable'],
    ['Live Reviewer', 'requires explicit approval (--confirm-live)'],
    ['Workspace protection', 'available'],
    ['Independent Reviewer gate', 'available'],
    ['Durable Reviewer recovery', 'unavailable'],
    ['Live Claude Implementer', 'available'],
    ['Reviewer fallback', 'prohibited by default'],
  ];

  const exitCode = caps.executablePath ? 0 : 8;
  return {
    lines: ['RELAY CODEX REVIEWER DOCTOR', ...checks.map(([k, v]) => `  ${k.padEnd(38)} ${v}`)],
    exitCode,
  };
}
