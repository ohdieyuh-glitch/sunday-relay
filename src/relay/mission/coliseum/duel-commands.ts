/**
 * WONDERLAND COLISEUM — THE DUEL COMMAND CONSOLE (PURE).
 *
 * Nine commands, each with a named ENGINE PORT declared BY THIS DOMAIN and
 * wired later at a composition root — adapters are never imported here
 * ("adapters cannot own mission verdicts", and the inverse holds too).
 *
 * Every command declares its binding TRUTHFULLY. 'bound' means a real engine
 * exists on main today that a composition root can wire to the port; 'unbound'
 * means no such engine exists, and executing the command returns a refusal,
 * never a simulated result. SPECIFIED is not IMPLEMENTED, and this table says
 * which is which:
 *
 *  TRACE    → bound   — mission/trace (trace-ledger + trace-event-factory)
 *  SB       → bound   — repair/repair-loop-engine `runRepairLoop`
 *  VERIFY   → bound   — mission/reviewer-gate `evaluateReviewerGate`
 *  RED      → unbound — no red-team engine exists on main
 *  FORK     → unbound — worktree-manager is Node-only infrastructure, not a
 *                       duel fork engine; no domain engine exists
 *  GUARD    → unbound — no guard/invariant-watch engine exists on main
 *  ROLLBACK → unbound — no domain rollback engine exists on main
 *  DEEP     → unbound — no deep-evaluation engine exists on main
 *  SWARM    → unbound — swarm VOCABULARY and command grammar exist in
 *                       mission/loop, but no multi-agent swarm execution
 *                       engine exists on main
 *
 * The autonomous loop port (Automation Fight) is bound: the loop runtime
 * engine exists at mission/loop/runtime (with a fake-loop-agent for tests).
 */

import type { RelayMoney } from '../economics/money';
import type { DuelRecord } from './duel-contracts';
import { isSandboxProvisioned, type SandboxProvisioned } from './duel-sandbox';

/* ----------------------------------------------------------- command table */

export const DUEL_COMMAND_NAMES = [
  'TRACE', 'SB', 'RED', 'VERIFY', 'FORK', 'GUARD', 'ROLLBACK', 'DEEP', 'SWARM',
] as const;
export type DuelCommandName = (typeof DUEL_COMMAND_NAMES)[number];

export type DuelCommandBindingState = 'bound' | 'unbound';

export interface DuelCommandSpec {
  readonly name: DuelCommandName;
  readonly binding: DuelCommandBindingState;
  /** Honest, user-visible. An unbound command SAYS it has no engine. */
  readonly description: string;
  /** The named port a composition root wires, when one is bound. */
  readonly enginePort: keyof DuelEnginePorts | null;
}

export const DUEL_COMMANDS: readonly DuelCommandSpec[] = [
  {
    name: 'TRACE',
    binding: 'bound',
    description: 'Inspect the tamper-evident trace ledger for this duel (mission/trace).',
    enginePort: 'trace',
  },
  {
    name: 'SB',
    binding: 'bound',
    description: 'Run a bounded repair loop in the sandbox (repair/repair-loop-engine).',
    enginePort: 'sandboxRepair',
  },
  {
    name: 'RED',
    binding: 'unbound',
    description: 'Red-team probe — SPECIFIED only; no red-team engine exists on main yet.',
    enginePort: null,
  },
  {
    name: 'VERIFY',
    binding: 'bound',
    description: 'Independent verification through the reviewer gate (mission/reviewer-gate).',
    enginePort: 'verify',
  },
  {
    name: 'FORK',
    binding: 'unbound',
    description:
      'Fork the sandbox into a variant — SPECIFIED only; no duel fork engine exists on main (worktree-manager is Node infrastructure, not a fork engine).',
    enginePort: null,
  },
  {
    name: 'GUARD',
    binding: 'unbound',
    description: 'Stand a guard on an invariant — SPECIFIED only; no guard engine exists on main yet.',
    enginePort: null,
  },
  {
    name: 'ROLLBACK',
    binding: 'unbound',
    description: 'Roll the sandbox back to a checkpoint — SPECIFIED only; no rollback engine exists on main yet.',
    enginePort: null,
  },
  {
    name: 'DEEP',
    binding: 'unbound',
    description: 'Deep evaluation pass — SPECIFIED only; no deep-evaluation engine exists on main yet.',
    enginePort: null,
  },
  {
    name: 'SWARM',
    binding: 'unbound',
    description:
      'Multi-agent swarm — SPECIFIED only; swarm vocabulary exists in mission/loop but no swarm execution engine exists on main.',
    enginePort: null,
  },
];

export function commandSpec(name: DuelCommandName): DuelCommandSpec {
  // The table enumerates every DuelCommandName, so this lookup always hits.
  return DUEL_COMMANDS.find((c) => c.name === name) as DuelCommandSpec;
}

/* ------------------------------------------------------------ engine ports */

/** TRACE — read-only view over the duel's trace ledger. */
export interface DuelTracePort {
  readEntries(duelId: string): Promise<readonly DuelTraceEntryView[]>;
}
export interface DuelTraceEntryView {
  readonly entryId: string;
  readonly summary: string;
  readonly at: string;
}

/** SB — one bounded sandbox repair pass. Mirrors runRepairLoop's honesty:
    the result reports what was CONFIRMED, never what was intended. */
export interface DuelSandboxRepairPort {
  runRepairPass(input: {
    readonly duelId: string;
    readonly sandboxCopyId: string;
    readonly objective: string;
  }): Promise<{ readonly outcome: 'repaired' | 'not_repaired' | 'unknown'; readonly summary: string }>;
}

/** VERIFY — independent verification. Independence is the port's contract:
    the verifier must be a different identity from the submitter. */
export interface DuelVerifyPort {
  verify(input: {
    readonly duelId: string;
    readonly entryId: string;
    readonly submitterId: string;
  }): Promise<{
    readonly verdict: 'verified-true' | 'verified-false' | 'unknown';
    readonly verifierId: string;
  }>;
}

/** The autonomous loop port for Automation Fight — the loop runtime engine
    (mission/loop/runtime) behind a duel-shaped seam; the fake-loop-agent
    satisfies it in tests. */
export interface DuelAutomationLoopPort {
  runIteration(input: {
    readonly duelId: string;
    readonly participantId: string;
    readonly sandboxCopyId: string;
    readonly turn: number;
  }): Promise<{
    readonly outcome: 'completed' | 'failed' | 'adapter_unavailable';
    readonly summary: string;
    /** null = the runtime did not report cost. Unknown stays unknown. */
    readonly costMicros: string | null;
  }>;
}

/** All ports a composition root may wire. Only bound commands have one. */
export interface DuelEnginePorts {
  readonly trace?: DuelTracePort;
  readonly sandboxRepair?: DuelSandboxRepairPort;
  readonly verify?: DuelVerifyPort;
  readonly automationLoop?: DuelAutomationLoopPort;
}

/* ---------------------------------------------------------------- execution */

export interface DuelCommandRefusal {
  readonly executed: false;
  readonly refusal: string;
}
export interface DuelCommandDispatch {
  readonly executed: true;
  readonly enginePort: keyof DuelEnginePorts;
}
export type DuelCommandExecution = DuelCommandRefusal | DuelCommandDispatch;

/**
 * Resolves a command against the wired ports. An unbound command is a
 * truthful refusal; a bound command whose port was not wired is ALSO a
 * refusal — "bound on main" never becomes "connected here".
 */
export function resolveCommand(
  name: DuelCommandName,
  ports: DuelEnginePorts,
): DuelCommandExecution {
  const spec = commandSpec(name);
  if (spec.binding === 'unbound' || spec.enginePort === null) {
    return {
      executed: false,
      refusal: `${name} has no engine on main — ${spec.description}`,
    };
  }
  if (ports[spec.enginePort] === undefined) {
    return {
      executed: false,
      refusal: `${name} is bound to '${spec.enginePort}' but no engine was wired at this composition root`,
    };
  }
  return { executed: true, enginePort: spec.enginePort };
}

/* --------------------------------------------------------- automation fight */

/** Explicit duel limits. Budget caps REUSE the economics money type
    (read-only) — never a bare number pretending to be money. */
export interface AutomationFightLimits {
  readonly turnCap: number;
  /** null = no budget was configured. Disclosed, never treated as unlimited
      silently — callers must show 'not configured'. */
  readonly budgetCap: RelayMoney | null;
}

export interface AutomationFightPlan {
  readonly ok: true;
  readonly duelId: string;
  readonly limits: AutomationFightLimits;
  /** One lane per participant; both run the SAME loop port under the SAME limits. */
  readonly lanes: readonly [AutomationFightLane, AutomationFightLane];
}
export interface AutomationFightLane {
  readonly participantId: string;
  readonly sandboxCopyId: string;
}
export interface AutomationFightRefused {
  readonly ok: false;
  readonly reason: string;
}

/**
 * Plans an automation fight. The `freshSandboxes` argument is THE sandbox
 * guarantee at the execution seam: a persisted `DuelRecord` carries only
 * sandbox FACTS (serializable strings anyone could forge), so the planner
 * additionally requires registry-checked `SandboxProvisioned` records minted
 * by `provisionSandbox` IN THIS PROCESS, whose copy ids match the record's
 * facts. A duel reloaded from durable storage — or a forged 'active' record —
 * is refused here until a composition root RE-PROVISIONS its sandboxes.
 */
export function planAutomationFight(
  duel: DuelRecord,
  freshSandboxes: readonly [SandboxProvisioned, SandboxProvisioned],
  limits: AutomationFightLimits,
  ports: DuelEnginePorts,
): AutomationFightPlan | AutomationFightRefused {
  if (duel.mode !== 'automation-fight') {
    return { ok: false, reason: 'this duel is not an automation fight' };
  }
  if (duel.status !== 'active' || duel.sandboxes === null) {
    return { ok: false, reason: 'an automation fight runs only in an active, sandboxed duel' };
  }
  for (const sandbox of freshSandboxes) {
    if (!isSandboxProvisioned(sandbox)) {
      return {
        ok: false,
        reason:
          'sandboxes were not provisioned in this process — a resumed or reloaded duel must be re-provisioned before a fight can run',
      };
    }
  }
  if (
    freshSandboxes[0].sandboxCopyId !== duel.sandboxes[0].sandboxCopyId ||
    freshSandboxes[1].sandboxCopyId !== duel.sandboxes[1].sandboxCopyId
  ) {
    return {
      ok: false,
      reason: "the provisioned sandboxes do not match this duel's recorded sandbox facts",
    };
  }
  if (!Number.isInteger(limits.turnCap) || limits.turnCap < 1) {
    return { ok: false, reason: 'an automation fight requires an explicit turn cap of at least 1' };
  }
  if (ports.automationLoop === undefined) {
    return { ok: false, reason: 'no autonomous loop engine was wired — the fight cannot run' };
  }
  return {
    ok: true,
    duelId: duel.duelId,
    limits,
    lanes: [
      {
        participantId: duel.participants[0].participantId,
        sandboxCopyId: duel.sandboxes[0].sandboxCopyId,
      },
      {
        participantId: duel.participants[1].participantId,
        sandboxCopyId: duel.sandboxes[1].sandboxCopyId,
      },
    ],
  };
}
