import { fail, relayError, type RelayResult } from '../../protocol/errors';
import type { AgentHandoffPackage } from '../../protocol/contracts';
import type { IdFactory, ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';
import type { EventDraft } from '../../protocol/envelopes';
import type { AdapterDescriptor, CodingAgentAdapterPort, CodingAgentDispatch } from '../ports';
import type {
  ClaudeCodeCapabilityProfile, ClaudeLiveLimits, ClaudeToolPolicy,
} from './contracts';
import { DEFAULT_LIVE_LIMITS } from './contracts';
import { buildClaudeEnvironment } from './environment';
import { compileClaudePermissions, toolPolicyArgs } from './permission-compiler';
import { compileClaudePrompt, compileRevisionPrompt, type PromptContext, type RevisionPromptContext } from './prompt-compiler';
import { runClaudeProcess, type ClaudeRunHandle, type ClaudeRunOutcome } from './process-runner';
import { normalizeClaudeRun } from './event-normalizer';
import { recordClaudeObservation } from './run-observation-adapter';
import type { ClaudeObservationSink } from './run-observation-adapter';
import { parseAgentExecutionReport, type AgentExecutionReport } from './report-parser';
import { streamIsStructurallyValid } from './stream-parser';
import { createSessionManager, type SessionAssociation } from './session-manager';

/**
 * Real Claude Code local adapter (Prompt 8). Implements the provider-neutral
 * CodingAgentAdapter port. The port's SYNC `execute` never launches a live
 * process (that must go through the explicit async live path so no test,
 * build, or simulation run silently calls Claude); the real work is the
 * async `invoke`/`resume`, driven only by `relay claude run --confirm-live`.
 *
 * The adapter runs Claude ONLY inside a ready isolated workspace (cwd), with
 * a filtered environment (no provider secrets), tool restrictions (no Bash /
 * network / MCP), settings/MCP isolation (--safe-mode + --strict-mcp-config),
 * bounded runtime/output, cancellation, and hidden-reasoning omission. The
 * agent's report is an unverified claim; Relay inspects the workspace and
 * runs verification independently.
 */

export const CLAUDE_ADAPTER_ID = 'claude-code-local';

export const claudeCodeDescriptor: AdapterDescriptor = {
  adapterId: CLAUDE_ADAPTER_ID,
  roles: ['coding-agent'],
  displayName: 'Claude Code (local subscription)',
  provenance: 'live',
  enforcement: {
    'worktree-isolation': 'enforced',
    'command-execution': 'enforced',
    'protected-paths': 'enforced',
    'edit-path-scoping': 'advisory',
    'settings-isolation': 'enforced',
    'mcp-isolation': 'enforced',
  },
  simulatedPolicies: [],
};

export interface ClaudeInvocationInput {
  executablePath: string;
  capabilities: ClaudeCodeCapabilityProfile;
  association: SessionAssociation;
  pkg: AgentHandoffPackage;
  workspacePath: string;
  toolPolicy: ClaudeToolPolicy;
  prompt: string;
  attempt: 1 | 2;
  /** Present on attempt 2 — the exact captured session id to resume. */
  resumeSessionId?: string;
  /**
   * A model the mission REQUESTED. When set it is really passed to the CLI,
   * so "requested" names an actual request rather than a label on a receipt.
   * The model that ANSWERED is read back off the stream and never assumed to
   * equal this.
   */
  requestedModel?: string | null;
  limits: ClaudeLiveLimits;
  baseEnv?: Record<string, string | undefined>;
  now: string;
}

export interface ClaudeInvocationResult {
  outcome: ClaudeRunOutcome;
  events: EventDraft[];
  sessionId: string | null;
  structurallyValid: boolean;
  structuralReason?: string;
  report: RelayResult<AgentExecutionReport>;
  args: string[];
  grantedEnvKeys: string[];
  strippedEnvKeys: string[];
}

/** Build the Claude argument array for one invocation. */
export function buildClaudeArgs(input: {
  capabilities: ClaudeCodeCapabilityProfile;
  toolPolicy: ClaudeToolPolicy;
  attempt: 1 | 2;
  resumeSessionId?: string;
  requestedModel?: string | null;
}): string[] {
  const { capabilities, toolPolicy, attempt, resumeSessionId, requestedModel } = input;
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  // Settings / MCP isolation: strongest reliable primitive on this CLI.
  if (capabilities.settingsIsolationSupported === 'available') args.push('--safe-mode');
  if (capabilities.mcpIsolationSupported === 'available') args.push('--strict-mcp-config');
  // A requested model is genuinely requested. An alias ('sonnet') is resolved
  // by the runtime into a dated id, which is exactly why the model that
  // answered must be read back rather than inferred from this argument.
  if (typeof requestedModel === 'string' && requestedModel.trim() !== '') {
    args.push('--model', requestedModel.trim());
  }
  args.push(...toolPolicyArgs(toolPolicy, capabilities));
  if (attempt === 2 && resumeSessionId) args.push('--resume', resumeSessionId);
  return args;
}

export interface ClaudeCodeAdapter extends CodingAgentAdapterPort {
  readonly kind: 'claude-code-local';
  invoke(
    input: ClaudeInvocationInput,
    onHandle?: (handle: ClaudeRunHandle) => void,
  ): Promise<ClaudeInvocationResult>;
  readonly sessions: ReturnType<typeof createSessionManager>;
}

export function createClaudeCodeAdapter(deps: {
  now: () => string;
  ids: IdFactory;
  /** Absent means nothing is recorded — see `ClaudeObservationSink`. */
  operations?: ClaudeObservationSink;
  /**
   * Told when an observation could not be stored. Absent means such a failure
   * is genuinely UNOBSERVED — nothing anywhere will mention it — which is a
   * real cost of not passing one, not a detail.
   */
  onObservationFailed?: (reason: string) => void;
}): ClaudeCodeAdapter {
  const sessions = createSessionManager(deps.now);

  const invoke = async (
    input: ClaudeInvocationInput,
    onHandle?: (handle: ClaudeRunHandle) => void,
  ): Promise<ClaudeInvocationResult> => {
    const args = buildClaudeArgs(input);
    const filtered = buildClaudeEnvironment(input.baseEnv ?? process.env);

    const outcome = await runClaudeProcess(
      {
        executablePath: input.executablePath,
        args,
        prompt: input.prompt,
        cwd: input.workspacePath,
        env: filtered.env,
        maxRuntimeMs: input.limits.maxRuntimeMs,
        maxStdoutBytes: input.limits.maxStdoutBytes,
        maxStderrBytes: input.limits.maxStderrBytes,
      },
      deps.now,
      onHandle,
    );

    const structural = streamIsStructurallyValid(outcome.parsed);
    const events = normalizeClaudeRun(
      {
        projectId: input.association.projectId, runId: input.association.runId,
        taskId: input.association.taskId, workspaceId: input.association.workspaceId,
        adapterId: CLAUDE_ADAPTER_ID, attempt: input.attempt, now: deps.now(),
      },
      outcome.parsed,
      outcome,
    );

    // OBSERVE THE RUN, through the one implementation of the guard rather than
    // a copy of it. Deliberately here: after the events are normalised AND
    // after the structural verdict, so the observation sees everything the
    // adapter saw — including that it is about to reject the stream.
    //
    // AWAITED, not fired and forgotten. A floating promise loses the write
    // whenever the process exits first — which is precisely the timeout and
    // cancellation cases, the ones most worth having recorded.
    await recordClaudeObservation(deps, input.association.projectId, outcome, {
      attempt: input.attempt,
      taskId: input.association.taskId,
      // The adapter is about to reject a malformed stream; the observation must
      // see that too, or it records a run the product refused as healthy.
      structurallyValid: structural.ok,
    });

    const report = outcome.parsed.isError || !structural.ok
      ? fail<AgentExecutionReport>(relayError('invalid-report',
          structural.ok ? `Claude reported ${outcome.parsed.resultSubtype ?? 'error'}.` : `Malformed stream: ${structural.reason}.`))
      : parseAgentExecutionReport(outcome.parsed.finalResult, {
          taskId: input.association.taskId, runId: input.association.runId,
        });

    return {
      outcome, events, sessionId: outcome.parsed.sessionId,
      structurallyValid: structural.ok, structuralReason: structural.reason,
      report, args, grantedEnvKeys: filtered.grantedKeys, strippedEnvKeys: filtered.strippedKeys,
    };
  };

  return {
    kind: 'claude-code-local',
    descriptor: claudeCodeDescriptor,
    sessions,
    invoke,
    // Port conformance: the sync path never launches a live process.
    execute(_dispatch: CodingAgentDispatch): RelayResult<never> {
      return fail(relayError('illegal-transition',
        'Live Claude execution is available only through the explicit async live path (relay claude run --confirm-live).'));
    },
  };
}

/* ----------------------- prompt helpers (re-exported) ---------------- */

export function claudePromptFor(ctx: PromptContext): string {
  return compileClaudePrompt(ctx);
}
export function claudeRevisionPromptFor(ctx: RevisionPromptContext): string {
  return compileRevisionPrompt(ctx);
}
export function claudeToolPolicyFor(
  pkg: AgentHandoffPackage,
  capabilities: ClaudeCodeCapabilityProfile,
  requiresFileCreation = false,
): ClaudeToolPolicy {
  return compileClaudePermissions({ pkg, capabilities, requiresFileCreation });
}

export { DEFAULT_LIVE_LIMITS };
export type { SessionAssociation, ProjectId, RunId, TaskId, WorkspaceRefId };
