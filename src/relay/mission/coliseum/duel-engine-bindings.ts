/**
 * WONDERLAND COLISEUM — ENGINE BINDINGS (PURE factory).
 *
 * Builds a real `DuelEnginePorts` from the REAL sibling engines this domain's
 * command table declares as `bound`:
 *
 *  TRACE  → mission/trace           (the tamper-evident Aquala ledger)
 *  SB     → repair/repair-loop-engine `runRepairLoop`
 *  VERIFY → mission/reviewer-gate     `evaluateReviewerGate`
 *  loop   → the `RelayLoopAgentPort` seam of mission/loop/runtime
 *
 * The engines are imported here (barrel-internal sibling imports, the same
 * pattern `duel-store` uses for the shared trace redactor); everything ELSE —
 * which trace a duel reads, what a repair pass may touch, who the reviewer
 * identities are, which loop agent answers — arrives INJECTED, because those
 * are composition-root facts this pure module cannot know.
 *
 * Every adapter is truthful:
 *  - it reports what the engine ACTUALLY returned, mapped without invention;
 *  - a missing precondition (no trace, no repair plan, no gate input) is a
 *    REFUSAL — a rejected promise carrying the reason — never a fabricated
 *    result;
 *  - an engine answer that does not prove the port's claim maps to the port's
 *    honest middle value (`unknown`), never upgraded to success.
 */

import {
  appendTraceEvent,
  createTrace,
  InMemoryTraceRepository,
  type AqualaTraceEvent,
} from '../trace';
import {
  runRepairLoop,
  type RepairLoopInput,
  type RepairLoopPorts,
} from '../repair/repair-loop-engine';
import { evaluateReviewerGate, type ReviewerGateInput } from '../reviewer-gate';
import type { RelayLoopAgentPort } from '../loop/runtime/loop-agent-port';
import type {
  DuelAutomationLoopPort,
  DuelEnginePorts,
  DuelSandboxRepairPort,
  DuelTracePort,
  DuelVerifyPort,
} from './duel-commands';

/* --------------------------------------------------------- injected deps */

/** Where a duel's REAL trace events come from. `null` = no ledger exists for
    that duel — the trace port refuses rather than showing an empty ledger
    that was never written. */
export interface DuelTraceSource {
  eventsForDuel(duelId: string): readonly AqualaTraceEvent[] | null;
}

/** One planned sandbox repair pass: the REAL `runRepairLoop` inputs. `null`
    = the composition root has no repair plan for this request — refused. */
export interface DuelRepairPlan {
  readonly ports: RepairLoopPorts;
  readonly input: RepairLoopInput;
}

export interface DuelEngineBindingDeps {
  readonly traceSource: DuelTraceSource;
  planRepairPass(request: {
    readonly duelId: string;
    readonly sandboxCopyId: string;
    readonly objective: string;
  }): DuelRepairPlan | null;
  /** The REAL reviewer-gate input for one verification request, or `null`
      when the root has no gate evidence for it — refused, never guessed. */
  gateInputFor(request: {
    readonly duelId: string;
    readonly entryId: string;
    readonly submitterId: string;
  }): ReviewerGateInput | null;
  /** The loop agent behind the automation port. `null` = none wired; the
      port answers `adapter_unavailable` truthfully (that outcome exists for
      exactly this: nothing was dispatched). */
  readonly loopAgent: RelayLoopAgentPort | null;
  /** Per-iteration wall-clock bound handed to the agent. */
  readonly iterationDeadlineMs: number;
}

/* ------------------------------------------------------------- the ports */

export function createDuelEngineBindings(deps: DuelEngineBindingDeps): DuelEnginePorts {
  const trace: DuelTracePort = {
    async readEntries(duelId) {
      const events = deps.traceSource.eventsForDuel(duelId);
      if (events === null) {
        throw new Error(
          `TRACE refused: no trace ledger exists for duel '${duelId}' — nothing is shown in its place`,
        );
      }
      // What the ledger actually holds — id, occurred-at, and the event's own
      // type plus its metadata summary when one was recorded. Never invented.
      return events.map((event) => ({
        entryId: event.eventId,
        summary:
          typeof event.metadata['summary'] === 'string'
            ? `${event.eventType}: ${event.metadata['summary'] as string}`
            : event.eventType,
        at: event.occurredAt,
      }));
    },
  };

  const sandboxRepair: DuelSandboxRepairPort = {
    async runRepairPass(input) {
      const plan = deps.planRepairPass(input);
      if (plan === null) {
        throw new Error(
          `SB refused: no repair plan exists for duel '${input.duelId}' sandbox '${input.sandboxCopyId}' — a repair pass needs a real finding, claimed files and a bound`,
        );
      }
      const result = await runRepairLoop(plan.ports, plan.input);
      // The engine's own doctrine, carried through: only `converged` (the
      // VERIFIER closed the finding) is repaired; `limit_reached` is an unfixed
      // defect AND a bill; `abandoned` means the loop refused to run at all,
      // which proves nothing either way — unknown stays unknown.
      const outcome =
        result.loop.outcome === 'converged'
          ? ('repaired' as const)
          : result.loop.outcome === 'limit_reached'
            ? ('not_repaired' as const)
            : ('unknown' as const);
      return { outcome, summary: result.reason };
    },
  };

  const verify: DuelVerifyPort = {
    async verify(input) {
      const gateInput = deps.gateInputFor(input);
      if (gateInput === null) {
        throw new Error(
          `VERIFY refused: no reviewer-gate evidence exists for entry '${input.entryId}' of duel '${input.duelId}'`,
        );
      }
      const gate = evaluateReviewerGate(gateInput);
      // Independence is derived from the gate's REAL identity evidence.
      // A non-independent review verifies nothing: unknown, not a verdict.
      //
      // Only a DEFINITIVE gate answer becomes a verdict. Positive: approved
      // for release / released with no blocking finding open. Negative: an
      // open blocking finding, `revision_required`, or `blocked` (the run
      // itself failed or was cancelled). Everything else — `working`,
      // `held_for_verification`, `held_for_review` — means verification has
      // NOT CONCLUDED, and an unfinished check is `unknown`, never a verdict.
      const verdict = !gate.independent
        ? ('unknown' as const)
        : gate.blockingFindingsOpen === 0 &&
            (gate.visibility === 'approved_for_release' || gate.visibility === 'released')
          ? ('verified-true' as const)
          : gate.blockingFindingsOpen > 0 ||
              gate.visibility === 'revision_required' ||
              gate.visibility === 'blocked'
            ? ('verified-false' as const)
            : ('unknown' as const);
      return { verdict, verifierId: gateInput.reviewer.agentId };
    },
  };

  const automationLoop: DuelAutomationLoopPort = {
    async runIteration(input) {
      const agent = deps.loopAgent;
      if (agent === null) {
        return {
          outcome: 'adapter_unavailable',
          summary: 'no autonomous loop agent was wired at this composition root — nothing was dispatched',
          costMicros: null,
        };
      }
      const role = agent.supportedRoles[0];
      if (role === undefined) {
        return {
          outcome: 'adapter_unavailable',
          summary: `loop agent '${agent.adapterId}' declares no staffable role — nothing was dispatched`,
          costMicros: null,
        };
      }
      const iterationId = `${input.duelId}:${input.participantId}:turn-${input.turn}`;
      const result = await agent.begin({
        runId: `duel-${input.duelId}`,
        iterationId,
        ordinal: input.turn,
        idempotencyKey: iterationId,
        requestedRole: role,
        resolvedRole: role,
        requestedAdapterId: agent.adapterId,
        requestedModel: null,
        inputRefs: [input.sandboxCopyId],
        deadlineMs: deps.iterationDeadlineMs,
      });
      // The agent's REAL classified outcome, folded to the duel port's three
      // values without optimism: only `completed` is completed; a genuinely
      // undelivered dispatch stays `adapter_unavailable`; every other ending
      // (refused, malformed, timeout, cancelled, crashed, unknown) is failed.
      const outcome =
        result.outcome === 'completed'
          ? ('completed' as const)
          : result.outcome === 'adapter_unavailable'
            ? ('adapter_unavailable' as const)
            : ('failed' as const);
      const summary =
        result.failureSummary ??
        (result.findings.length > 0
          ? result.findings.map((f) => `[${f.trust}] ${f.summary}`).join(' ')
          : `agent outcome: ${result.outcome}`);
      // Unknown cost stays null. Never zero, never inferred.
      const costMicros = result.usage.known ? result.usage.costMicros : null;
      return { outcome, summary, costMicros };
    },
  };

  return { trace, sandboxRepair, verify, automationLoop };
}

/* -------------------------------------------------- real duel trace ledger */

export interface DuelTraceSeedEntry {
  readonly eventId: string;
  readonly summary: string;
  readonly occurredAt: string;
  readonly actorId: string;
}

export type DuelTraceLedgerResult =
  | { readonly ok: true; readonly events: readonly AqualaTraceEvent[] }
  | { readonly ok: false; readonly reason: string };

/**
 * Builds a REAL Aquala trace for one duel — genesis plus one registered
 * `command_executed` event per seed entry — through the real ledger, so every
 * entry carries a real hash chain. Any ledger refusal is returned verbatim;
 * nothing is substituted for a failed append.
 */
export function buildDuelTraceLedger(input: {
  readonly duelId: string;
  readonly createdByActorId: string;
  readonly createdAt: string;
  readonly entries: readonly DuelTraceSeedEntry[];
}): DuelTraceLedgerResult {
  const repository = new InMemoryTraceRepository();
  const traceId = `trace-duel-${input.duelId}`;
  const created = createTrace(repository, {
    traceId,
    projectId: `coliseum-duel-${input.duelId}`,
    createdByActorId: input.createdByActorId,
    createdAt: input.createdAt,
    genesisEventId: `${traceId}-genesis`,
    retentionClassification: 'standard',
    sourceProduct: 'sunday_relay',
    sourceService: 'wonderland-coliseum',
  });
  if (!created.ok) return { ok: false, reason: `${created.error.code}: ${created.error.reason}` };
  const events: AqualaTraceEvent[] = [created.value.genesis];
  for (const entry of input.entries) {
    const appended = appendTraceEvent(repository, {
      traceId,
      draft: {
        eventId: entry.eventId,
        traceId,
        projectId: `coliseum-duel-${input.duelId}`,
        eventFamily: 'command',
        eventType: 'command_executed',
        sourceProduct: 'sunday_relay',
        sourceService: 'wonderland-coliseum',
        actorId: entry.actorId,
        actorType: 'agent',
        // An agent reporting on its own work may self-assign only 'claim' —
        // the source-trust engine refuses a self-attested 'observed'.
        sourceTrust: 'claim',
        occurredAt: entry.occurredAt,
        metadata: { summary: entry.summary, duelId: input.duelId },
      },
    });
    if (!appended.ok) return { ok: false, reason: `${appended.error.code}: ${appended.error.reason}` };
    events.push(appended.value);
  }
  return { ok: true, events };
}
