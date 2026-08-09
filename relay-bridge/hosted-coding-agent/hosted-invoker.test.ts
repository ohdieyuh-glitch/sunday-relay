import { describe, expect, it } from 'vitest';
import { runCodingMission } from '../coding';
import { createRandomIdFactory } from '../../src/relay/protocol/ids';
import { REFERENCE_IMPLEMENTATION, CLAIMED_FILE } from '../../src/relay/connectors/claude-code/fixture';
import type { BridgeEventInput, CodingTerminalState } from '../types';
import { createHostedClaudeInvoker } from './hosted-invoker';
import { HOSTED_ADAPTER_ID } from './hosted-readiness';
import { REPORT_MARKER } from '../../src/relay/connectors/claude-code/prompt-compiler';

/**
 * THE HOSTED CODING SURFACE, END TO END, WITH NO PAID CALL.
 *
 * `runHostedCodingAgent` reaches the Agent SDK through an injected `query`, so
 * a fake yielding REAL SDK message shapes drives the entire leg: a real
 * isolated git worktree, a real file edit, Relay's own inspection, a real
 * `node --test`, and the real completion policy. What is proven here is that
 * the hosted surface plugs into the ONE seam and inherits every other
 * guarantee — not a second pipeline that happens to agree.
 */

const workspaceOf = (options: Record<string, unknown>): string =>
  typeof options.cwd === 'string' ? options.cwd : '';

/**
 * A fake SDK stream that writes the reference implementation into the claimed
 * file and reports the envelope it was granted, exactly as the runtime does.
 */
const fakeQuery = (over: { report?: string; tools?: string[]; cwd?: string } = {}) =>
  async function* fake(params: { prompt: string; options: Record<string, unknown> }) {
    const cwd = over.cwd ?? workspaceOf(params.options);
    // The agent's edit — the same one the local fake executable makes.
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const target = join(cwd, CLAIMED_FILE);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, REFERENCE_IMPLEMENTATION);

    yield {
      type: 'system',
      subtype: 'init',
      // The model the RUNTIME names — deliberately not one Relay requested.
      model: 'claude-sonnet-5-20260114',
      cwd,
      tools: over.tools ?? ['Read', 'Glob', 'Grep', 'Edit'],
    };
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      // The SAME report contract the local surface uses — marker on its own
      // line, then one JSON object. Parsed by the SAME strict parser, which is
      // the point: one report contract, not a second one specified alongside.
      result: over.report ?? `Done.\n${REPORT_MARKER}\n${JSON.stringify({
        attempt: 1,
        status: 'completed',
        summary: 'Implemented normalizeProjectName.',
        filesRead: [CLAIMED_FILE],
        filesChanged: [CLAIMED_FILE],
        commandsClaimed: [],
        testsClaimed: [],
        remainingIssues: [],
      })}`,
      total_cost_usd: 0.01,
      num_turns: 2,
      duration_ms: 1200,
    };
  };

const runHosted = async (over: Parameters<typeof fakeQuery>[0] = {}) => {
  const events: BridgeEventInput[] = [];
  const snapshots: CodingTerminalState[] = [];
  const outcome = await runCodingMission({
    handoff: {
      objective: 'Implement normalizeProjectName so the existing tests pass.',
      instructions: ['Trim, lowercase, and collapse separators.'],
      acceptanceCriteria: ['The existing test suite passes when Relay runs it.'],
      constraints: ['Edit only the claimed file.'],
    },
    // Unused by the hosted surface: the seam replaces the spawn entirely.
    executablePath: '/nonexistent/claude',
    capabilities: {
      executablePath: '/nonexistent/claude', version: 'hosted', nonInteractiveSupported: true,
      streamJsonSupported: true, explicitResumeSupported: false, maxTurnsSupported: true,
      allowedToolsSupported: true, disallowedToolsSupported: true, toolsRestrictionSupported: true,
      permissionModeSupported: true, systemPromptSupported: true, appendSystemPromptSupported: true,
      structuredSchemaSupported: true, mcpIsolationSupported: 'available',
      settingsIsolationSupported: 'available', cancellationSupported: true,
      probedAt: new Date().toISOString(), provenance: 'live',
    },
    now: () => new Date().toISOString(),
    ids: createRandomIdFactory(),
    emit: (e) => events.push(e),
    publishTerminal: (t) => snapshots.push(t),
    runtimeLabel: 'Claude Agent SDK (hosted)',
    requestedOccupant: {
      actorName: 'Claude Agent SDK',
      adapterId: HOSTED_ADAPTER_ID,
      billingPath: 'api',
    },
    invokeAgent: createHostedClaudeInvoker({
      apiKey: 'sk-ant-FAKETESTNOTREAL-never-served', // relay-boundary:allow-fixture — synthetic
      requestedModel: 'claude-sonnet-5',
      queryFn: fakeQuery(over) as never,
    }),
  });
  return { outcome, events, snapshots };
};

describe('the hosted Coding Agent runs through the one existing pipeline', () => {
  it('edits the claimed file, and Relay verifies it independently', async () => {
    const { outcome } = await runHosted();
    expect(outcome.stopped).toBe(false);
    // Relay's OWN inspection and test run — not the agent's claim.
    expect(outcome.filesChanged).toEqual([CLAIMED_FILE]);
    expect(outcome.protectedChanges).toEqual([]);
    expect(outcome.sourceUnchanged).toBe(true);
    expect(outcome.verificationPassed).toBe(true);
    expect(outcome.deterministicPassed).toBe(true);
    expect(outcome.evidence?.testPassed).toBe(true);
  }, 60_000);

  it('attests the hosted surface as what actually ran, and the API as who paid', async () => {
    const { outcome } = await runHosted();
    expect(outcome.attestation?.requestedActor).toBe('Claude Agent SDK');
    expect(outcome.attestation?.actualActor).toBe('Claude Agent SDK');
    expect(outcome.attestation?.actualRuntime).toBe(HOSTED_ADAPTER_ID);
    // The hosted surface is API-billed; the local one is a subscription. This
    // is the distinction the old `billingPath: 'subscription'` literal erased.
    expect(outcome.attestation?.billingPath).toBe('api_billed');
  }, 60_000);

  /**
   * The containment gate compares the envelope Relay COMPILED with the one the
   * runtime reported GRANTING. A clean result message does not certify that a
   * run stayed inside its boundary.
   */
  it('refuses a run whose granted tools exceed the compiled envelope', async () => {
    const { outcome } = await runHosted({ tools: ['Read', 'Edit', 'Bash'] });
    expect(outcome.stopped).toBe(true);
    expect(outcome.stopReason).toMatch(/not usable|envelope|honour/i);
    expect(outcome.verifiedComplete).toBe(false);
  }, 60_000);

  it('refuses a run that returns no parseable Relay report', async () => {
    const { outcome } = await runHosted({ report: 'I finished, looks good to me.' });
    expect(outcome.stopped).toBe(true);
    expect(outcome.verifiedComplete).toBe(false);
  }, 60_000);
});
