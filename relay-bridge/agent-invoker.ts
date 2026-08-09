import type { AgentHandoffPackage } from '../src/relay/protocol/contracts';
import type { EventDraft } from '../src/relay/protocol/envelopes';
import type { RelayResult } from '../src/relay/protocol/errors';
import type { IdFactory } from '../src/relay/protocol/ids';
import {
  CLAUDE_ADAPTER_ID, createClaudeCodeAdapter,
} from '../src/relay/connectors/claude-code/adapter';
import type {
  ClaudeCodeCapabilityProfile, ClaudeLiveLimits, ClaudeToolPolicy,
} from '../src/relay/connectors/claude-code/contracts';
import type { AgentExecutionReport } from '../src/relay/connectors/claude-code/report-parser';
import type { SessionAssociation } from '../src/relay/connectors/claude-code/session-manager';

/**
 * ONE CODING-AGENT INVOCATION, WHICHEVER SURFACE PERFORMS IT.
 *
 * The coding leg does eight things: build a throwaway fixture, prepare an
 * isolated worktree, compile a handoff, compile a prompt, RUN AN AGENT, inspect
 * the resulting workspace with git, run the tests itself, and evaluate a
 * completion policy. Exactly one of those eight depends on which agent holds
 * the role. This seam is that one.
 *
 * IT EXISTS SO THERE IS NO SECOND PIPELINE. A hosted coding path that
 * re-implemented inspection, verification and policy would be a second copy of
 * the logic deciding whether work is done — and this repository's own rule,
 * written where the two process runners might have diverged, is that two copies
 * of safety logic drift and the drifted one is always the one in production. A
 * second surface swaps out the agent call and inherits every other guarantee
 * unchanged.
 *
 * WHAT AN INVOCATION MUST REPORT, AND WHY THE FIELDS STAY SEPARATE.
 * `structurallyValid` is about the STREAM; `report` is about the agent's CLAIM;
 * neither is evidence the work is correct — Relay's own inspection decides that
 * afterwards. `actualActor` and `actualRuntimeId` are OBSERVED: they say what
 * really ran, and are never copied from what the mission requested, because the
 * whole point of requested-versus-actual is that the two can differ and a
 * founder must be able to see it.
 */

/** Cancellation handle exposed to the mission so a Stop can abort a live run. */
export interface CancelHandle {
  cancel(): boolean;
}

export interface AgentInvocationOutcome {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly cancelled: boolean;
  readonly timedOut: boolean;
  /**
   * The agent never started. Distinct from every other failure: nothing ran, so
   * there is no output to distrust and nothing in the workspace to inspect.
   */
  readonly launchFailed: boolean;
}

export interface AgentInvocationResult {
  readonly outcome: AgentInvocationOutcome;
  /** Normalized lifecycle events — the terminal body. Never raw provider text. */
  readonly events: readonly EventDraft[];
  readonly sessionId: string | null;
  readonly structurallyValid: boolean;
  readonly structuralReason?: string;
  readonly report: RelayResult<AgentExecutionReport>;
  /** OBSERVED: the actor that answered, in the adapter's own vocabulary. */
  readonly actualActor: string;
  /** OBSERVED: the adapter that really executed. */
  readonly actualRuntimeId: string;
}

export interface AgentInvocationRequest {
  readonly association: SessionAssociation;
  readonly pkg: AgentHandoffPackage;
  readonly workspacePath: string;
  readonly toolPolicy: ClaudeToolPolicy;
  readonly prompt: string;
  readonly limits: ClaudeLiveLimits;
  readonly baseEnv?: Record<string, string | undefined>;
  readonly registerHandle?: (handle: CancelHandle) => void;
  readonly now: () => string;
  readonly ids: IdFactory;
  /** A model the mission requests. What answers is read back, never assumed. */
  readonly requestedModel: string | null;
}

export type AgentInvoker = (request: AgentInvocationRequest) => Promise<AgentInvocationResult>;

/**
 * The local surface: an installed Claude Code CLI, spawned by this process.
 *
 * Byte-identical to what `runCodingMission` did inline before the seam existed
 * — the adapter is constructed here, the session is captured here, and the
 * observed identity is the adapter's own constant rather than anything the
 * caller asked for.
 */
export function createLocalClaudeInvoker(input: {
  readonly executablePath: string;
  readonly capabilities: ClaudeCodeCapabilityProfile;
}): AgentInvoker {
  return async (request) => {
    const adapter = createClaudeCodeAdapter({ now: request.now, ids: request.ids });
    const invocation = await adapter.invoke(
      {
        executablePath: input.executablePath,
        capabilities: input.capabilities,
        association: request.association,
        pkg: request.pkg,
        workspacePath: request.workspacePath,
        toolPolicy: request.toolPolicy,
        prompt: request.prompt,
        attempt: 1,
        requestedModel: request.requestedModel,
        limits: request.limits,
        baseEnv: request.baseEnv,
        now: request.now(),
      },
      (handle) => request.registerHandle?.(handle),
    );

    if (invocation.sessionId) {
      adapter.sessions.capture(request.association, invocation.sessionId);
    }

    return {
      outcome: {
        startedAt: invocation.outcome.startedAt,
        completedAt: invocation.outcome.completedAt,
        cancelled: invocation.outcome.cancelled,
        timedOut: invocation.outcome.timedOut,
        // `spawnError` carries a REASON string; the seam carries the fact.
        // The reason is host layout (a path, an errno) and the coding leg's
        // message is deliberately fixed, so it stops here.
        launchFailed: invocation.outcome.spawnError !== undefined
          && invocation.outcome.spawnError !== '',
      },
      events: invocation.events,
      sessionId: invocation.sessionId,
      structurallyValid: invocation.structurallyValid,
      structuralReason: invocation.structuralReason,
      report: invocation.report,
      actualActor: 'Claude Code',
      actualRuntimeId: CLAUDE_ADAPTER_ID,
    };
  };
}
