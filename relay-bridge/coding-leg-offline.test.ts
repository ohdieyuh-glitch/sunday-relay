import { describe, it, expect } from 'vitest';
import { runCodingMission } from './coding';
import { resolveClaudeRuntime } from './claude-runtime';
import { createRandomIdFactory } from '../src/relay/protocol/ids';
import type { BridgeEventInput, CodingTerminalState } from './types';
import { actorMatches, isPaidApiCall } from './attestation';
import { findOccupant, type RoleOccupant } from '../src/relay/mission/role-slots';

/**
 * CODING LEG — OFFLINE END-TO-END.
 *
 * Runs the entire coding leg against the repo's own fake Claude executable:
 * a real child process, a real isolated Git worktree, a real file edit, a
 * real Relay inspection, a real `node --test` verification, and a real
 * captured diff — with NO model provider, no network, and no spend.
 *
 * This is the proof that the terminal shows the same single execution that
 * did the work: one process, one stream, and every terminal fact traceable
 * to something that actually happened in this run.
 */

const runOffline = async (over: Partial<Parameters<typeof runCodingMission>[0]> = {}) => {
  const now = () => new Date().toISOString();
  const runtime = resolveClaudeRuntime('fake', now, true);
  expect(runtime.ok).toBe(true);
  if (!runtime.ok) throw new Error('fake runtime unavailable');

  const events: BridgeEventInput[] = [];
  const snapshots: CodingTerminalState[] = [];

  const outcome = await runCodingMission({
    handoff: {
      objective: 'Implement normalizeProjectName so the existing tests pass.',
      instructions: ['Trim, lowercase, and collapse separators.'],
      acceptanceCriteria: ['The existing test suite passes when Relay runs it.'],
      constraints: ['Edit only the claimed file.'],
    },
    executablePath: runtime.runtime.executablePath,
    capabilities: runtime.runtime.capabilities,
    now,
    ids: createRandomIdFactory(),
    emit: (e) => events.push(e),
    publishTerminal: (t) => snapshots.push(t),
    projectLabel: 'Relay controlled fixture (throwaway repository)',
    ...over,
  });

  return { outcome, events, snapshots, final: snapshots[snapshots.length - 1] };
};

describe('the terminal is powered by the one process that did the work', () => {
  it('captures a complete, truthful terminal from a single offline invocation', async () => {
    const { outcome, final } = await runOffline();

    expect(outcome.stopped).toBe(false);
    expect(outcome.verificationPassed).toBe(true);
    expect(final).toBeDefined();

    // ---- one process, one stream
    const sessionLines = final.lines.filter((l) => l.kind === 'session' && /session started/i.test(l.text));
    expect(sessionLines.length).toBeGreaterThanOrEqual(1);
    const processLines = final.lines.filter((l) => l.kind === 'process');
    expect(processLines).toHaveLength(1);
    expect(final.status).toBe('complete');

    // ---- ordering is monotonic and gapless (this is what survives refresh)
    expect(final.lines.map((l) => l.sequence)).toEqual(final.lines.map((_, i) => i));

    // ---- real timing
    expect(final.startedAt).toBeTruthy();
    expect(final.endedAt).toBeTruthy();
    expect(Date.parse(final.endedAt as string)).toBeGreaterThanOrEqual(Date.parse(final.startedAt as string));

    // ---- REAL changed file from Relay inspection (not the claim)
    expect(final.changedFiles).toEqual(['src/normalize.js']);

    // ---- REAL captured diff, read from the isolated worktree
    expect(final.diff).toBeTruthy();
    expect(final.diff).toContain('src/normalize.js');
    expect(final.diff).toContain('normalizeProjectName');

    // ---- REAL verification Relay ran itself
    expect(final.test?.command).toBe('node --test test/normalize.test.js');
    expect(final.test?.status).toBe('passed');
    expect(final.test?.exitCode).toBe(0);
    expect(final.test?.output).toBeTruthy();

    // ---- the agent's report is stored as a CLAIM
    expect(final.claim).not.toBeNull();
    expect(final.lines.some((l) => l.kind === 'claim' && l.truth === 'agent_claim')).toBe(true);

    // ---- Relay's own findings are stored as EVIDENCE
    expect(final.lines.some((l) => l.kind === 'inspection' && l.truth === 'relay_evidence')).toBe(true);
    expect(final.lines.some((l) => l.kind === 'verification' && l.truth === 'relay_evidence')).toBe(true);

    // ---- attestation reflects the process that actually ran
    expect(final.attestation?.launchVerified).toBe(true);
    expect(final.attestation?.completionVerified).toBe(true);
    expect(final.attestation?.fallbackOccurred).toBe(false);
    expect(final.attestation?.billingPath).toBe('subscription');

    // ---- permissions are the compiled envelope, not a description
    expect(final.permissions.allowedFiles).toEqual(['src/normalize.js']);
    expect(final.permissions.protectedPaths).toContain('package.json');
    expect(final.permissions.deniedCapabilities).toContain('Bash');
    // From the attestation, not a literal beside it: the local CLI runs on the
    // founder's subscription, and a hosted API-billed run would say so instead.
    expect(final.billing).toBe('subscription');
    expect(final.billing).toBe(final.attestation?.billingPath);
  }, 120_000);

  it('leaks no secret, absolute path, or full session id into the captured terminal', async () => {
    const { final } = await runOffline();
    const serialized = JSON.stringify(final);
    expect(serialized).not.toContain('/home/');
    expect(serialized).not.toContain('/tmp/relay-claude-fixture');
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9_-]{16,}/);
    expect(serialized).not.toContain(String.fromCharCode(27));
    // The provider session id is only ever present as a redacted tail.
    expect(serialized).not.toContain('bridge-fake-session');
    expect(final.externalSessionRedacted).toMatch(/^…/);
  }, 120_000);

  it('publishes progressively, so a poll mid-run sees a live terminal', async () => {
    const { snapshots } = await runOffline();
    expect(snapshots.length).toBeGreaterThan(3);
    // The first published snapshot is already an honest live state.
    const firstLive = snapshots.find((s) => s.status === 'live');
    expect(firstLive).toBeDefined();
    expect(firstLive?.test).toBeNull();
    expect(firstLive?.diff).toBeNull();
    // Snapshots only ever grow — no line is ever rewritten or removed.
    const lengths = snapshots.map((s) => s.lines.length);
    for (let i = 1; i < lengths.length; i++) expect(lengths[i]).toBeGreaterThanOrEqual(lengths[i - 1]);
  }, 120_000);
});

describe('cancellation stops the run without claiming anything', () => {
  it('a cancel requested before the agent starts never launches a process', async () => {
    const { outcome, final, snapshots } = await runOffline({ isCancelRequested: () => true });
    expect(outcome.cancelled).toBe(true);
    expect(outcome.stopped).toBe(true);
    expect(outcome.verifiedComplete).toBe(false);
    expect(outcome.claim).toBeNull();
    // Nothing was captured because nothing ran — no fabricated terminal.
    expect(snapshots).toHaveLength(0);
    expect(final).toBeUndefined();
  }, 120_000);
});

/**
 * REQUESTED AND ACTUAL ARE TWO FIELDS BECAUSE THEY CAN DIFFER.
 *
 * The attestation used to write `requestedActor: 'Claude Code'`,
 * `actualActor: 'Claude Code'` and `billingPath: 'subscription'` as literals
 * three lines apart. That was merely redundant while one runtime could ever
 * hold the slot, and a misreport the moment a second one could: a hosted
 * Agent-SDK run is API-billed, so `subscription` names the wrong payer.
 *
 * The REQUESTED half now comes from the occupant the mission bound. The ACTUAL
 * half stays what this leg observed — the adapter it really drove.
 */
describe('the coding attestation separates who was asked for from what ran', () => {
  it('takes the requested identity from the bound occupant', async () => {
    const { outcome } = await runOffline({
      requestedOccupant: {
        actorName: 'Claude Agent SDK',
        adapterId: 'claude-agent-sdk-hosted',
        billingPath: 'api',
      },
    });
    const attestation = outcome.attestation;
    expect(attestation).not.toBeNull();
    expect(attestation?.requestedActor).toBe('Claude Agent SDK');
    expect(attestation?.requestedRuntime).toBe('claude-agent-sdk-hosted');
    // `api` in the registry's vocabulary is `api_billed` in the attestation's,
    // which is the value `isPaidApiCall` tests for.
    expect(attestation?.billingPath).toBe('api_billed');

    // AND THE ACTUAL HALF DOES NOT FOLLOW IT. This leg drove the Claude Code
    // adapter, so that is what it attests — which is exactly the mismatch a
    // founder must be able to see. (The mission refuses this combination
    // before it can happen; the fields still have to tell the truth if it did.)
    expect(attestation?.actualActor).toBe('Claude Code');
    expect(attestation?.actualRuntime).toBe('claude-code-local');
  }, 30_000);

  /**
   * THE REGRESSION BARRIER. The vocabulary split — `requestedActor` from the
   * registry's UI label, `actualActor` from the adapter — made `actorMatches`
   * false on every ordinary local mission, and a whole bridge suite stayed
   * green with the defect present. This binds the two halves through the REAL
   * registry occupant, so a wrong `actorName` fails here rather than shipping.
   */
  it('reports the shipped local occupant as the actor that actually ran', async () => {
    const local = findOccupant('coding_agent', 'claude_code_local') as RoleOccupant;
    const { outcome } = await runOffline({
      requestedOccupant: {
        actorName: local.actorName,
        adapterId: local.adapterId,
        billingPath: local.billingPath as 'subscription',
      },
    });
    expect(outcome.attestation).not.toBeNull();
    expect(actorMatches(outcome.attestation ?? undefined)).toBe(true);
  }, 30_000);

  /** A run that spends nothing is `simulated`, never a payer. */
  it('attests the offline pipeline as simulated rather than subscription-paid', async () => {
    const fake = findOccupant('coding_agent', 'claude_code_fake') as RoleOccupant;
    expect(fake.billingPath).toBe('none');
    const { outcome } = await runOffline({
      requestedOccupant: {
        actorName: fake.actorName,
        adapterId: fake.adapterId,
        billingPath: fake.billingPath as 'none',
      },
    });
    expect(outcome.attestation?.billingPath).toBe('simulated');
    expect(isPaidApiCall(outcome.attestation ?? undefined)).toBe(false);
  }, 30_000);

  /**
   * `launchVerified` IS OBSERVED, NOT INFERRED. It was `!launchFailed` — the
   * absence of an error — so a run that never started was attested as launched
   * and the website then rendered it API PAID.
   */
  it('does not attest a launch the surface never observed', async () => {
    const { outcome } = await runOffline({
      invokeAgent: async () => ({
        outcome: {
          startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z',
          cancelled: true, timedOut: false, launchFailed: false, launchObserved: false,
        },
        events: [], sessionId: null,
        structurallyValid: false, structuralReason: 'cancelled during startup',
        report: { ok: false, error: { code: 'invalid-report', message: 'x' } } as never,
        actualActor: 'Claude Agent SDK', actualRuntimeId: 'claude-agent-sdk-hosted',
        actualModel: null,
      }),
      requestedOccupant: {
        actorName: 'Claude Agent SDK', adapterId: 'claude-agent-sdk-hosted', billingPath: 'api',
      },
    });
    expect(outcome.attestation?.launchVerified).toBe(false);
    // And therefore not a paid call, which is what the browser reads.
    expect(isPaidApiCall(outcome.attestation ?? undefined)).toBe(false);
  }, 30_000);

  it('falls back to the local identity when no occupant is supplied', async () => {
    // Every caller that predates role slots drove this same adapter, so that
    // is what it was requesting.
    const { outcome } = await runOffline();
    expect(outcome.attestation?.requestedActor).toBe('Claude Code');
    expect(outcome.attestation?.requestedRuntime).toBe('claude-code-local');
    expect(outcome.attestation?.billingPath).toBe('subscription');
  }, 30_000);
});
