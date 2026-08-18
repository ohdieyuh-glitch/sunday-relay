import { describe, expect, it } from 'vitest';
import { runRepairLoop, type RepairLoopInput, type RepairLoopPorts } from '../repair/repair-loop-engine';
import type { ReviewerGateInput } from '../reviewer-gate';
import { createFakeLoopAgent } from '../loop/runtime/fake-loop-agent';
import {
  buildDuelTraceLedger,
  createDuelEngineBindings,
  type DuelEngineBindingDeps,
} from './duel-engine-bindings';

/**
 * The engine bindings must be TRUTHFUL adapters: they return what the REAL
 * engine returned (asserted against a separately-run engine invocation), and
 * a missing precondition is a refusal — never a fabricated result.
 */

const NOW = '2026-08-18T00:00:00.000Z';

/* ------------------------------------------------------------ repair plan */

const repairPlan = (verdicts: readonly ('closed' | 'still_open')[], maxCycles: number): {
  ports: RepairLoopPorts;
  input: RepairLoopInput;
} => {
  let verifyCall = 0;
  return {
    ports: {
      async dispatchRepair() {
        return { touchedFiles: ['src/demo.ts'], claimsFixed: true };
      },
      async verify() {
        const finding = verdicts[Math.min(verifyCall, verdicts.length - 1)];
        verifyCall += 1;
        return { finding };
      },
      now: () => NOW,
    },
    input: {
      loopId: 'loop-1',
      findingId: 'F-1',
      claimedFiles: ['src/demo.ts'],
      maxCycles,
    },
  };
};

const gateInput = (overrides: {
  reviewerSameAsImplementer?: boolean;
  verdict?: 'approved' | 'changes_requested';
  verificationPassed?: boolean;
  runStatus?: 'completed' | 'failed';
} = {}): ReviewerGateInput => {
  const verdict = overrides.verdict ?? 'approved';
  const implementer = { agentId: 'impl-1', sessionId: 's2', adapterId: 'impl-adapter', independenceGroup: 'implementers' };
  const reviewer = overrides.reviewerSameAsImplementer
    ? implementer
    : { agentId: 'verifier-1', sessionId: 's1', adapterId: 'verifier-adapter', independenceGroup: 'reviewers' };
  return {
    entitlement: 'pro',
    verificationPassed: overrides.verificationPassed ?? true,
    runStatus: overrides.runStatus ?? 'completed',
    reviewer,
    implementer,
    completionPolicySatisfied: true,
    ledger: {
      missionId: 'm', taskId: 't', reviewerRunId: 'r', missionRevision: 1, taskRevision: 1,
      workspaceRevision: 'rev1', originalClaimedFiles: ['src/demo.ts'], affectedCriterionIds: ['AC-1'],
      reviews: [{
        attempt: 1, verdict, reviewerAgentId: 'verifier-1', requestedReviewerAgentId: 'verifier-1',
        independent: true, provenance: 'live',
        findings: verdict === 'changes_requested'
          ? [{ id: 'x', severity: 'high', title: 't', detail: 'd' }]
          : [],
      }],
      postRepairEvidenceIds: [], repairDispatched: false, maxRepairIterations: 1, now: NOW,
    },
  };
};

const deps = (over: Partial<DuelEngineBindingDeps> = {}): DuelEngineBindingDeps => ({
  traceSource: { eventsForDuel: () => null },
  planRepairPass: () => null,
  gateInputFor: () => null,
  loopAgent: null,
  iterationDeadlineMs: 60_000,
  ...over,
});

/* ------------------------------------------------------------------ TRACE */

describe('TRACE binding — the real Aquala ledger', () => {
  it('returns the ledger\'s REAL events: genesis plus hash-chained command events', async () => {
    const ledger = buildDuelTraceLedger({
      duelId: 'duel-1',
      createdByActorId: 'relay',
      createdAt: NOW,
      entries: [
        { eventId: 'evt-1', summary: 'TRACE opened', occurredAt: NOW, actorId: 'agent-a' },
        { eventId: 'evt-2', summary: 'SB pass ran', occurredAt: NOW, actorId: 'agent-a' },
      ],
    });
    if (!ledger.ok) throw new Error(`ledger refused: ${ledger.reason}`);
    // The real ledger computed a real hash chain.
    expect(ledger.events[0].previousEventHash).toBeNull();
    expect(ledger.events[1].previousEventHash).toBe(ledger.events[0].eventHash);
    expect(ledger.events[2].previousEventHash).toBe(ledger.events[1].eventHash);

    const ports = createDuelEngineBindings(deps({
      traceSource: { eventsForDuel: (id) => (id === 'duel-1' ? ledger.events : null) },
    }));
    const entries = await ports.trace!.readEntries('duel-1');
    expect(entries.map((e) => e.entryId)).toEqual(['trace-duel-duel-1-genesis', 'evt-1', 'evt-2']);
    expect(entries[0].summary).toBe('trace_created');
    expect(entries[1].summary).toBe('command_executed: TRACE opened');
    expect(entries[1].at).toBe(NOW);
  });

  it('a duel with no trace ledger is a refusal, not an empty ledger', async () => {
    const ports = createDuelEngineBindings(deps());
    await expect(ports.trace!.readEntries('duel-x')).rejects.toThrow(/TRACE refused: no trace ledger exists/u);
  });

  it('a ledger refusal is returned verbatim (duplicate event id)', () => {
    const result = buildDuelTraceLedger({
      duelId: 'duel-1',
      createdByActorId: 'relay',
      createdAt: NOW,
      entries: [
        { eventId: 'evt-1', summary: 'a', occurredAt: NOW, actorId: 'agent-a' },
        { eventId: 'evt-1', summary: 'b', occurredAt: NOW, actorId: 'agent-a' },
      ],
    });
    expect(result.ok).toBe(false);
  });
});

/* --------------------------------------------------------------------- SB */

describe('SB binding — the real bounded repair loop', () => {
  it('a verifier-closed finding is repaired, and the summary is the ENGINE\'s own reason', async () => {
    const ports = createDuelEngineBindings(deps({ planRepairPass: () => repairPlan(['closed'], 2) }));
    const result = await ports.sandboxRepair!.runRepairPass({
      duelId: 'duel-1', sandboxCopyId: 'sb-1', objective: 'close F-1',
    });
    // The known deterministic engine run, executed independently.
    const reference = await runRepairLoop(repairPlan(['closed'], 2).ports, repairPlan(['closed'], 2).input);
    expect(reference.loop.outcome).toBe('converged');
    expect(result.outcome).toBe('repaired');
    expect(result.summary).toBe(reference.reason);
  });

  it('limit_reached is NOT repaired — an unfixed defect and a bill', async () => {
    const ports = createDuelEngineBindings(deps({ planRepairPass: () => repairPlan(['still_open'], 1) }));
    const result = await ports.sandboxRepair!.runRepairPass({
      duelId: 'duel-1', sandboxCopyId: 'sb-1', objective: 'close F-1',
    });
    expect(result.outcome).toBe('not_repaired');
  });

  it('an abandoned loop (invalid bound, nothing dispatched) stays unknown', async () => {
    const ports = createDuelEngineBindings(deps({ planRepairPass: () => repairPlan(['closed'], 0) }));
    const result = await ports.sandboxRepair!.runRepairPass({
      duelId: 'duel-1', sandboxCopyId: 'sb-1', objective: 'close F-1',
    });
    expect(result.outcome).toBe('unknown');
    expect(result.summary).toMatch(/maxCycles/u);
  });

  it('no repair plan is a refusal, never a fabricated pass', async () => {
    const ports = createDuelEngineBindings(deps());
    await expect(
      ports.sandboxRepair!.runRepairPass({ duelId: 'duel-1', sandboxCopyId: 'sb-1', objective: 'x' }),
    ).rejects.toThrow(/SB refused: no repair plan/u);
  });
});

/* ------------------------------------------------------------------ VERIFY */

describe('VERIFY binding — the real reviewer gate', () => {
  it('an independent approved review verifies true, with the REAL verifier id', async () => {
    const ports = createDuelEngineBindings(deps({ gateInputFor: () => gateInput() }));
    const result = await ports.verify!.verify({ duelId: 'duel-1', entryId: 'p-1', submitterId: 'impl-1' });
    expect(result).toEqual({ verdict: 'verified-true', verifierId: 'verifier-1' });
  });

  it('a non-independent reviewer verifies NOTHING — unknown, never independence', async () => {
    const ports = createDuelEngineBindings(deps({
      gateInputFor: () => gateInput({ reviewerSameAsImplementer: true }),
    }));
    const result = await ports.verify!.verify({ duelId: 'duel-1', entryId: 'p-1', submitterId: 'impl-1' });
    expect(result.verdict).toBe('unknown');
  });

  it('an independent changes_requested review verifies false', async () => {
    const ports = createDuelEngineBindings(deps({
      gateInputFor: () => gateInput({ verdict: 'changes_requested' }),
    }));
    const result = await ports.verify!.verify({ duelId: 'duel-1', entryId: 'p-1', submitterId: 'impl-1' });
    expect(result.verdict).toBe('verified-false');
  });

  it('a HELD gate (verification not yet run) is unknown — an unfinished check is never a verdict', async () => {
    // visibility = 'held_for_verification': no blocking finding is open and
    // nothing negative was proven; verification simply has not concluded.
    const ports = createDuelEngineBindings(deps({
      gateInputFor: () => gateInput({ verificationPassed: false }),
    }));
    const result = await ports.verify!.verify({ duelId: 'duel-1', entryId: 'p-1', submitterId: 'impl-1' });
    expect(result.verdict).toBe('unknown');
  });

  it('a definitively NEGATIVE gate (blocked: the run failed) verifies false', async () => {
    const ports = createDuelEngineBindings(deps({
      gateInputFor: () => gateInput({ runStatus: 'failed' }),
    }));
    const result = await ports.verify!.verify({ duelId: 'duel-1', entryId: 'p-1', submitterId: 'impl-1' });
    expect(result.verdict).toBe('verified-false');
  });

  it('missing gate evidence is a refusal', async () => {
    const ports = createDuelEngineBindings(deps());
    await expect(
      ports.verify!.verify({ duelId: 'duel-1', entryId: 'p-1', submitterId: 'impl-1' }),
    ).rejects.toThrow(/VERIFY refused: no reviewer-gate evidence/u);
  });
});

/* ------------------------------------------------------------- automation */

describe('automation loop binding — the real loop agent port', () => {
  it('reports the agent\'s REAL outcome, findings and cost', async () => {
    const agent = createFakeLoopAgent([{ kind: 'verified_evidence' }]);
    const ports = createDuelEngineBindings(deps({ loopAgent: agent }));
    const result = await ports.automationLoop!.runIteration({
      duelId: 'duel-1', participantId: 'auto-red', sandboxCopyId: 'sb-red', turn: 1,
    });
    expect(result.outcome).toBe('completed');
    expect(result.costMicros).toBe('1000'); // the fake's real reported usage
    expect(result.summary).toContain('Relay ran the check itself.');
    expect(agent.invocations).toHaveLength(1);
    expect(agent.invocations[0].idempotencyKey).toBe('duel-1:auto-red:turn-1');
  });

  it('unknown usage stays null — never zero', async () => {
    const agent = createFakeLoopAgent([{ kind: 'unknown_usage' }]);
    const ports = createDuelEngineBindings(deps({ loopAgent: agent }));
    const result = await ports.automationLoop!.runIteration({
      duelId: 'duel-1', participantId: 'auto-red', sandboxCopyId: 'sb-red', turn: 1,
    });
    expect(result.costMicros).toBeNull();
  });

  it('a crashed agent is failed, never completed', async () => {
    const agent = createFakeLoopAgent([{ kind: 'crash' }]);
    const ports = createDuelEngineBindings(deps({ loopAgent: agent }));
    const result = await ports.automationLoop!.runIteration({
      duelId: 'duel-1', participantId: 'auto-red', sandboxCopyId: 'sb-red', turn: 1,
    });
    expect(result.outcome).toBe('failed');
  });

  it('no agent wired = adapter_unavailable, nothing dispatched, cost null', async () => {
    const ports = createDuelEngineBindings(deps());
    const result = await ports.automationLoop!.runIteration({
      duelId: 'duel-1', participantId: 'auto-red', sandboxCopyId: 'sb-red', turn: 1,
    });
    expect(result).toEqual({
      outcome: 'adapter_unavailable',
      summary: 'no autonomous loop agent was wired at this composition root — nothing was dispatched',
      costMicros: null,
    });
  });

  it('the same turn dispatched twice reuses ONE idempotency key and one scripted step', async () => {
    const agent = createFakeLoopAgent([{ kind: 'verified_evidence' }]);
    const ports = createDuelEngineBindings(deps({ loopAgent: agent }));
    const first = await ports.automationLoop!.runIteration({
      duelId: 'duel-1', participantId: 'auto-red', sandboxCopyId: 'sb-red', turn: 1,
    });
    const second = await ports.automationLoop!.runIteration({
      duelId: 'duel-1', participantId: 'auto-red', sandboxCopyId: 'sb-red', turn: 1,
    });
    expect(second).toEqual(first);
    // The fake did NOT work twice: a redelivered key returns the remembered
    // answer without recording a second dispatch or consuming another step.
    expect(agent.invocations).toHaveLength(1);
    expect(agent.callsFor('duel-1:auto-red:turn-1')).toBe(1);
  });
});
