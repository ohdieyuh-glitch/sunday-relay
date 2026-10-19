import { classifyClaudeAuth, probeClaudeCapabilities } from '../connectors/claude-code';
import { availabilityFromProbe, type CodingAgentAvailability } from '../mission';

/**
 * THE COMPOSITION ROOT for "what can this machine actually run?".
 *
 * It lives in the CLI because the CLI is where Relay is allowed to compose
 * an ADAPTER (which may not import the mission layer) with the CANONICAL
 * mission contracts (which may not import an adapter). It calls no model:
 * the probe reads `--version` and `--help`, and the auth classifier reads a
 * status line and keeps only a safe class — never an email, org or token.
 */
export function inspectClaudeRuntime(now: string, explicitPath?: string): CodingAgentAvailability {
  const profile = probeClaudeCapabilities(now, explicitPath);
  const auth = classifyClaudeAuth(now, profile.executablePath);
  return availabilityFromProbe({
    probe: {
      executablePath: profile.executablePath,
      version: profile.version,
      nonInteractiveSupported: profile.nonInteractiveSupported,
      streamJsonSupported: profile.streamJsonSupported,
      explicitResumeSupported: profile.explicitResumeSupported,
      structuredSchemaSupported: profile.structuredSchemaSupported,
      cancellationSupported: profile.cancellationSupported,
    },
    authLoggedIn: auth.loggedIn,
    authClass: auth.sourceClass,
    authApprovedForLiveRun: auth.approvedForLiveRun,
  });
}
