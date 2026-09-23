import { createHash } from 'node:crypto';

import {
  MCP_FORBIDDEN_ROLES,
  type McpAuditRecord,
  type McpCapabilityKind,
  type McpGatewayOutcome,
  type McpGatewayRequest,
} from '../../mcp';
import type {
  JuliusPolicyDecision,
  JuliusToolAdapter,
  JuliusToolDefinition,
  JuliusToolEvidence,
  JuliusToolExecutionContext,
  JuliusWorkerRole,
  ToolInvocationRequest,
  ToolInvocationResult,
} from '../../mission/julius';
import { mcpRoleForJuliusRole } from './mcp-authority-translation';

/**
 * THE MCP EXECUTION ADAPTER — MCP AS A LIMB, NOT A NEIGHBOUR.
 *
 * This is a `JuliusToolAdapter`, and that is the whole architectural claim.
 * The only caller of a `JuliusToolAdapter` is `JuliusToolController.invoke`,
 * so by the time `execute` runs, Julius has already:
 *
 *   resolved the tool from its own registry, and refused an unregistered id;
 *   checked the mutation contract the caller declared;
 *   evaluated C.A.R.D. for USE_TOOL and for every operation the definition
 *     implies, and refused or escalated on DENY / REQUIRE_APPROVAL;
 *   reserved tool budget, and refused when it was exhausted;
 *   resolved the idempotency key, returning the prior result for a repeat and
 *     refusing a repeat whose request fingerprint disagrees;
 *   written an AUTHORIZED audit row.
 *
 * None of that is re-implemented here and none of it can be skipped, because
 * there is no other door: an agent holds no gateway reference, and the gateway
 * is constructed by composition and handed only to this adapter.
 *
 * WHAT THE GATEWAY KEEPS. Everything protocol-specific and everything MCP
 * knows that Julius does not: the approved snapshot, the capability that must
 * exist in it, role scoping with the Reviewer forbidden by a rule no grant can
 * override, one-shot approvals, result sanitisation, injection labelling,
 * credential projection. Those still run, in order, every time. What the
 * gateway no longer is, is an entry point — its `allow` is necessary and never
 * sufficient, because Julius has already had to allow it first.
 *
 * DENIAL BEFORE CONTACT IS PRESERVED ON THIS SIDE TOO. Every refusal below
 * returns without calling `gateway.invoke`, so a denied invocation makes no
 * process, network or server contact from here either — the property the
 * offline proof asserts as a dispatch count of zero is not weakened by being
 * wrapped.
 */

/** What composition knows about the caller and the request does not carry. */
export interface JuliusMcpCallerIdentity {
  readonly accountId: string;
  readonly workspaceId: string;
  /**
   * The Julius role this worker runs as.
   *
   * `ToolInvocationRequest` carries a `workerId` and no role, and the role is
   * what decides MCP entitlement. Composition holds the worker registry, so it
   * answers. `null` is a refusal, never a default role — a worker nobody can
   * identify is exactly the caller that must not reach a server.
   */
  roleOf(workerId: string): JuliusWorkerRole | null;
  /** The mission this run belongs to, for the audit record. */
  missionIdOf(runId: string): string | null;
  /** The PSP Agent this execution is authorized under, when there is one. */
  pspAgentFingerprintOf?(workerId: string): string | null;
}

export interface JuliusMcpGatewayPort {
  invoke(request: McpGatewayRequest): Promise<McpGatewayOutcome>;
}

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** `mcp:<connectionId>:<kind>:<percent-encoded name>` read back. */
export function parseJuliusMcpToolId(toolId: string): {
  readonly connectionId: string;
  readonly capabilityKind: McpCapabilityKind;
  readonly capabilityName: string;
} | null {
  const parts = toolId.split(':');
  if (parts.length !== 4 || parts[0] !== 'mcp') return null;
  const [, connectionId, kind, encodedName] = parts as [string, string, string, string];
  if (connectionId === '' || encodedName === '') return null;
  if (kind !== 'tool' && kind !== 'resource' && kind !== 'prompt') return null;
  let capabilityName: string;
  try {
    capabilityName = decodeURIComponent(encodedName);
  } catch {
    // A malformed encoding is a name nobody can reconstruct. Refusing beats
    // invoking something adjacent to what was asked for.
    return null;
  }
  return { connectionId, capabilityKind: kind, capabilityName };
}

export function createJuliusMcpExecutionAdapter(input: {
  readonly gateway: JuliusMcpGatewayPort;
  readonly identity: JuliusMcpCallerIdentity;
  readonly now?: () => string;
}): JuliusToolAdapter {
  const now = input.now ?? (() => new Date().toISOString());

  const refused = (
    request: ToolInvocationRequest,
    decision: JuliusPolicyDecision,
    reasonCode: string,
    safeSummary: string,
  ): ToolInvocationResult => ({
    invocationId: request.invocationId,
    status: 'DENIED',
    exitCode: null,
    safeSummary,
    stdout: '', stderr: '', stdoutRef: null, stderrRef: null,
    artifacts: [],
    evidence: [],
    durationMs: 0,
    resourceUsage: { toolCalls: 0, runtimeMs: 0, outputBytes: 0 },
    policyDecisionRef: `${decision.policyRevision}:${reasonCode}`,
    mutations: [],
  });

  return {
    async execute(
      definition: JuliusToolDefinition,
      request: ToolInvocationRequest,
      _context: JuliusToolExecutionContext,
      decision: JuliusPolicyDecision,
    ): Promise<ToolInvocationResult> {
      /**
       * THIS ADAPTER RUNS MCP AND NOTHING ELSE. A builtin routed here by a
       * composition mistake must fail rather than be improvised into a
       * gateway call against a connection id that is really `fs.read`.
       */
      if (definition.kind !== 'MCP') {
        return refused(request, decision, 'MCP_ADAPTER_WRONG_KIND',
          'This adapter serves MCP capabilities only; the tool it was handed is not one.');
      }
      const capability = parseJuliusMcpToolId(request.toolId);
      if (capability === null) {
        return refused(request, decision, 'MCP_TOOL_ID_UNREADABLE',
          'The tool id does not name an MCP capability; nothing was contacted.');
      }

      const role = input.identity.roleOf(request.workerId);
      if (role === null) {
        return refused(request, decision, 'MCP_WORKER_ROLE_UNKNOWN',
          'The worker making this request has no known role; MCP entitlement is decided by role, so the request is refused before any contact.');
      }
      const translated = mcpRoleForJuliusRole(role);
      if (!translated.translated) {
        return refused(request, decision, translated.reasonCode, translated.safeRationale);
      }
      /**
       * A ROLE MCP FORBIDS IS REFUSED HERE TOO, AND FROM MCP'S OWN LIST.
       *
       * The gateway denies these as its first branch, deliberately before any
       * lookup, so that the Reviewer's isolation never depends on a connection
       * resolving. The same reasoning applies one layer up: it should not
       * depend on the gateway being the one composition handed us either. A
       * reviewing role with tool access is not independent of what it reviews,
       * and that must hold however this adapter is wired.
       *
       * This is NOT a second rule. It reads `MCP_FORBIDDEN_ROLES` — the same
       * constant the gateway enforces — so a role added there is refused here
       * too, automatically. A restated literal is what would drift.
       */
      if ((MCP_FORBIDDEN_ROLES as readonly string[]).includes(translated.role)) {
        return refused(request, decision, 'MCP_ROLE_FORBIDDEN',
          `The ${role} role has no MCP access by design; it receives Relay-curated evidence only. Nothing was contacted.`);
      }

      const startedAtMs = Date.now();
      const outcome = await input.gateway.invoke({
        connectionId: capability.connectionId as McpGatewayRequest['connectionId'],
        capabilityKind: capability.capabilityKind,
        capabilityName: capability.capabilityName,
        arguments: { ...request.arguments },
        accountId: input.identity.accountId,
        workspaceId: input.identity.workspaceId,
        projectId: request.projectId,
        missionId: input.identity.missionIdOf(request.runId),
        pspAgentFingerprint: input.identity.pspAgentFingerprintOf?.(request.workerId) ?? null,
        actualAgentId: request.workerId,
        agentRole: translated.role,
        timeoutMs: request.timeoutMs ?? definition.timeoutCeilingMs,
      });

      return juliusResultFromGateway({
        request, decision, outcome, definition,
        durationMs: Date.now() - startedAtMs,
        occurredAt: now(),
      });
    },
  };
}

/**
 * A GATEWAY OUTCOME AS A JULIUS TOOL RESULT.
 *
 * The two vocabularies do not line up perfectly, and the places they do not
 * are recorded here rather than smoothed over:
 *
 *   `awaiting_approval` has no Julius status. It becomes DENIED, which is true
 *   about what happened — the work did not run and the caller must not treat
 *   it as done — and loses WHY, which the safe summary carries instead. A
 *   status vocabulary with an approval-pending arm is owed.
 *
 *   `timed_out` becomes TIMED_OUT, and for a MUTATING capability that is not
 *   the whole truth: the call may or may not have taken effect on the far
 *   side. Julius has no UNKNOWN outcome to record and this does not invent
 *   one; it is the unknown-outcome work, and until it exists a mutating
 *   timeout must not be retried on the strength of this status.
 *
 *   a non-terminal state arriving here is a gateway contract violation, not
 *   a case to interpret. FAILED, named.
 */
export function juliusResultFromGateway(input: {
  readonly request: ToolInvocationRequest;
  readonly decision: JuliusPolicyDecision;
  readonly outcome: McpGatewayOutcome;
  readonly definition: JuliusToolDefinition;
  readonly durationMs: number;
  readonly occurredAt: string;
}): ToolInvocationResult {
  const { outcome, request, decision } = input;
  const result = outcome.result;

  const status = ((): ToolInvocationResult['status'] => {
    switch (result.state) {
      case 'completed': return 'SUCCEEDED';
      case 'denied': return 'DENIED';
      case 'awaiting_approval': return 'DENIED';
      case 'timed_out': return 'TIMED_OUT';
      case 'cancelled': return 'CANCELLED';
      case 'failed': return 'FAILED';
      default: return 'FAILED';
    }
  })();

  /* The sanitized blocks the gateway decided an agent may see, bounded again
     by the tool definition's own ceiling. Two bounds, because the ceilings are
     set by different people for different reasons and neither should be able
     to raise the other's. */
  const text = result.agentFacingContent.map((block) => block.text).join('\n');
  const stdout = text.slice(0, input.definition.outputCeilingBytes);

  return {
    invocationId: request.invocationId,
    status,
    exitCode: null,
    safeSummary: safeSummaryOf(outcome, status),
    stdout,
    stderr: '',
    stdoutRef: null,
    stderrRef: null,
    artifacts: [],
    evidence: [provenanceEvidence(outcome.audit, result.invocationId, input.occurredAt)],
    durationMs: input.durationMs,
    resourceUsage: {
      // A call that was refused before contact cost no tool call, and saying
      // it did would bill a mission for work no server was asked to do.
      toolCalls: outcome.dispatched ? 1 : 0,
      runtimeMs: input.durationMs,
      outputBytes: Buffer.byteLength(stdout, 'utf8'),
    },
    policyDecisionRef: `${decision.policyRevision}:${result.failure?.category ?? result.state}`,
    // An MCP capability changes nothing on THIS filesystem. An external effect
    // is real and is not a path, and listing one here would be a mutation
    // record nobody could verify against a workspace.
    mutations: [],
  };
}

const safeSummaryOf = (outcome: McpGatewayOutcome, status: ToolInvocationResult['status']): string => {
  const audit = outcome.audit;
  const where = `${audit.serverName}/${audit.capabilityName}`;
  if (outcome.result.state === 'awaiting_approval') {
    return `MCP ${where} requires an explicit human approval and was not executed.`;
  }
  const failure = outcome.result.failure;
  return failure === null
    ? `MCP ${where} ${status.toLowerCase()} (invocation ${outcome.result.invocationId}).`
    : `MCP ${where} ${status.toLowerCase()}: ${failure.category} (invocation ${outcome.result.invocationId}).`;
};

/**
 * WHICH SERVER, WHICH CAPABILITY, WHICH INVOCATION — as durable evidence.
 *
 * The provenance is the point. A result whose origin a later reader cannot
 * establish is a result that cannot be reasoned about after an incident, and
 * "an agent produced this" is not an origin.
 *
 * `integrityHash` digests the PROVENANCE this row asserts, and deliberately
 * not the content: the agent-facing payload is sanitized for one agent and
 * never persisted, so a digest of it would name bytes no reader can fetch —
 * the dangling reference the artifact work exists to remove.
 */
function provenanceEvidence(audit: McpAuditRecord, invocationId: string, occurredAt: string): JuliusToolEvidence {
  const facts: Record<string, string | number | boolean | null> = {
    mcpInvocationId: invocationId,
    mcpConnectionId: audit.connectionId,
    mcpServerName: audit.serverName,
    mcpServerTrust: audit.serverTrust,
    mcpCapabilityKind: audit.capabilityKind,
    mcpCapabilityName: audit.capabilityName,
    mcpCapabilityFingerprint: audit.capabilityFingerprint,
    mcpCapabilitySnapshotId: audit.capabilitySnapshotId,
    mcpAgentRole: audit.agentRole,
    mcpAuditRecordId: audit.auditRecordId,
    occurredAt,
  };
  return {
    evidenceId: `evidence:mcp:${invocationId}`,
    type: 'ARTIFACT',
    integrityHash: sha256(JSON.stringify(facts)),
    facts,
  };
}
