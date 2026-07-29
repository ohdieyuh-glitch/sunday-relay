/**
 * Resolves the Claude Code runtime for the coding leg.
 *
 * - 'live': probe the installed `claude` CLI, classify its auth, and run the
 *   real prerequisite gate. Live only proceeds for a logged-in first-party
 *   subscription with an explicit confirm — otherwise it returns a safe
 *   blocker the mission surfaces (never a fabricated success).
 * - 'fake': write the repo's own contract-harness fake executable (no model
 *   call, no spend) that produces the reference implementation. Used to prove
 *   the whole bridge pipeline end-to-end offline.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  probeClaudeCapabilities,
  classifyClaudeAuth,
  checkLivePrerequisites,
} from '../src/relay/connectors/claude-code';
import type { ClaudeCodeCapabilityProfile } from '../src/relay/connectors/claude-code/contracts';
import { writeFakeClaude } from '../src/relay/connectors/claude-code/fake-executable';
import { CLAIMED_FILE, REFERENCE_IMPLEMENTATION } from '../src/relay/connectors/claude-code/fixture';

export interface ClaudeRuntime {
  executablePath: string;
  capabilities: ClaudeCodeCapabilityProfile;
  provenance: 'live' | 'fake';
}

export type ClaudeRuntimeResolution =
  | { ok: true; runtime: ClaudeRuntime }
  | { ok: false; code: string; safeMessage: string };

function syntheticCapabilities(executablePath: string, now: string): ClaudeCodeCapabilityProfile {
  return {
    executablePath,
    version: 'fake-0',
    nonInteractiveSupported: true,
    streamJsonSupported: true,
    explicitResumeSupported: true,
    maxTurnsSupported: false,
    allowedToolsSupported: true,
    disallowedToolsSupported: true,
    toolsRestrictionSupported: true,
    permissionModeSupported: true,
    systemPromptSupported: true,
    appendSystemPromptSupported: true,
    structuredSchemaSupported: true,
    mcpIsolationSupported: 'available',
    settingsIsolationSupported: 'available',
    cancellationSupported: true,
    probedAt: now,
    provenance: 'live',
  };
}

export function resolveClaudeRuntime(
  mode: 'live' | 'fake',
  now: () => string,
  approvalGranted: boolean,
): ClaudeRuntimeResolution {
  if (mode === 'fake') {
    const dir = mkdtempSync(join(tmpdir(), 'relay-bridge-fake-'));
    const exe = writeFakeClaude(dir, {
      scenario: 'success',
      sessionId: 'bridge-fake-session',
      taskId: 'tsk',
      runId: 'run',
      editPath: CLAIMED_FILE,
      editContent: REFERENCE_IMPLEMENTATION,
    });
    return { ok: true, runtime: { executablePath: exe, capabilities: syntheticCapabilities(exe, now()), provenance: 'fake' } };
  }

  const caps = probeClaudeCapabilities(now());
  const auth = classifyClaudeAuth(now(), caps.executablePath);
  const prereq = checkLivePrerequisites({
    capabilities: caps,
    authApproved: auth.approvedForLiveRun,
    authLoggedIn: auth.loggedIn,
    authSourceClass: auth.sourceClass,
    settingsRisk: 'clean', // the coding leg runs against a fresh throwaway fixture, not a user repo
    approvalGranted,
  });
  if (!prereq.ready) {
    return { ok: false, code: 'live_not_ready', safeMessage: `${prereq.manualTitle}: ${prereq.manualReason}` };
  }
  return {
    ok: true,
    runtime: { executablePath: caps.executablePath as string, capabilities: caps, provenance: 'live' },
  };
}
