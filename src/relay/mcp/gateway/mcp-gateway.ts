/**
 * THE RELAY MCP GATEWAY — the only path from an agent to an MCP server.
 *
 * WHAT AN AGENT CAN AND CANNOT SAY.
 *
 * A model hands the gateway a Relay `connectionId` and a capability NAME that
 * must already exist in an APPROVED snapshot. It cannot pass a URL, a command,
 * a server definition, a transport, a header, a credential, or a registry
 * entry. There is no parameter on `McpGatewayRequest` through which any of
 * those could travel, which is the point: §13 says no model may pass arbitrary
 * server ids or URLs to the transport, and the way to guarantee that is to
 * make it unrepresentable rather than to validate it away.
 *
 * SEVENTEEN STEPS, IN ORDER, EVERY TIME. The sequence in §13 is implemented as
 * a straight line with no early success. Each step can only refuse or continue;
 * none of them can approve. In particular:
 *
 *   step 5   the capability is looked up in the APPROVED SNAPSHOT, never on the
 *            live connection. A server that grew a tool after approval cannot
 *            serve it, because the gateway does not know it exists.
 *   step 8   permission evaluation happens BEFORE any transport call, so a
 *            denied invocation makes no network or process contact at all.
 *            The offline proof asserts a dispatch COUNT of zero for every
 *            denied scenario — "was refused" and "was refused before it did
 *            anything" are different claims and only the second one matters.
 *   step 12  the gateway races its OWN deadline against the client call. A
 *            transport that ignores its timeout still cannot hang a mission,
 *            because the gateway is not relying on the transport to be correct.
 *   step 13  `settleInvocation` decides the terminal state. A timeout, a
 *            cancellation or a crash cannot be recorded as completion even if
 *            partial content arrived (§24, scenarios 14–16).
 *
 * THE AUDIT RECORD IS WRITTEN ON EVERY PATH, including refusals. A gateway
 * that only audits what it allowed cannot answer "what did this agent try to
 * do?", which is the question that matters after an incident.
 */

import type { IdFactory } from '../../protocol/ids';
import type { McpApprovalRecordId, McpConnectionId, McpInvocationId } from '../../protocol/ids';
import {
  findPrompt, findResource, findTool,
  type McpCapabilityKind, type McpCapabilitySnapshot,
} from '../domain/mcp-capabilities';
import { canInvoke, connectionUsableBy, type McpConnection } from '../domain/mcp-connection';
import { mcpFailure, type McpFailure } from '../domain/mcp-failure';
import type { McpCapabilityFingerprint } from '../domain/mcp-fingerprint';
import {
  argumentFingerprint, settleInvocation, summarizeArguments,
  type McpAuditRecord, type McpInvocationResult, type McpSanitizedContentBlock,
} from '../domain/mcp-invocation';
import type {
  McpClientPort, McpEvidenceStorePort, McpRawToolResult,
} from '../domain/mcp-ports';
import {
  consumeApproval, findCoveringApproval, type McpApprovalRecord,
} from '../policy/mcp-approvals';
import {
  evaluatePermission, MCP_FORBIDDEN_ROLES,
  type McpPermissionDecision, type McpPermissionGrant,
} from '../policy/mcp-permissions';
import { classifyRisk, type McpRiskAssessment, type McpRiskOverride } from '../policy/mcp-risk';
import {
  MCP_DEFAULT_RESULT_LIMITS, sanitizeResult, type McpResultLimits,
} from '../policy/mcp-sanitize';
import type { McpRegistryEntry } from '../registry/mcp-registry-types';

/** What an agent may ask for. Deliberately minimal — see the docstring. */
export interface McpGatewayRequest {
  readonly connectionId: McpConnectionId;
  readonly capabilityKind: McpCapabilityKind;
  readonly capabilityName: string;
  readonly arguments: Record<string, unknown>;

  /* caller identity, supplied by Relay Core — never by the model */
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string | null;
  readonly missionId: string | null;
  readonly pspAgentFingerprint: string | null;
  readonly actualAgentId: string;
  readonly agentRole: string;

  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface McpGatewayDependencies {
  readonly ids: IdFactory;
  readonly now: () => string;
  readonly connections: { get(connectionId: string): McpConnection | null };
  readonly snapshots: { get(snapshotId: string): McpCapabilitySnapshot | null };
  readonly registry: { get(registryEntryId: string): McpRegistryEntry | null };
  readonly clients: { get(connectionId: string): McpClientPort | null };
  readonly grants: { forAgent(agentId: string): readonly McpPermissionGrant[] };
  readonly approvals: {
    forOperation(input: { connectionId: string; capabilityName: string }): readonly McpApprovalRecord[];
    record(updated: McpApprovalRecord): void;
  };
  readonly evidence: McpEvidenceStorePort;
  readonly audit: { append(record: McpAuditRecord): void };
  /** Path prefixes a mission scopes workspace writes to. */
  readonly missionWritablePathPrefixes: (missionId: string | null) => readonly string[];
  readonly riskOverrides?: readonly McpRiskOverride[];
  readonly limits?: McpResultLimits;
  readonly defaultTimeoutMs?: number;
}

export interface McpGatewayOutcome {
  readonly result: McpInvocationResult;
  readonly audit: McpAuditRecord;
  readonly permission: McpPermissionDecision | null;
  readonly risk: McpRiskAssessment | null;
  /** True only when a transport call was actually made. The offline proof
   * asserts this is false for every refusal scenario. */
  readonly dispatched: boolean;
}

const NO_ARGUMENTS: Record<string, unknown> = Object.freeze({});

export class McpGateway {
  constructor(private readonly deps: McpGatewayDependencies) {}

  async invoke(request: McpGatewayRequest): Promise<McpGatewayOutcome> {
    const invocationId = this.deps.ids.next('mci');
    const requestedAt = this.deps.now();
    const args = request.arguments ?? NO_ARGUMENTS;
    const safeArguments = summarizeArguments(args);
    const argsFingerprint = argumentFingerprint(request.capabilityName, args);

    /**
     * STEP 0 — THE REVIEWER RULE, BEFORE ANYTHING ELSE IS LOADED.
     *
     * `evaluatePermission` also denies these roles as its own first branch, and
     * that is the authoritative rule. This check exists because every step
     * between here and there can refuse for a DIFFERENT reason first — an
     * unknown connection, a capability absent from the snapshot — and a
     * reviewer denial that arrives as `capability_missing` is a weaker,
     * incidental guarantee than one that arrives because it is the Reviewer.
     * The Reviewer's MCP isolation must not depend on a lookup succeeding.
     */
    if ((MCP_FORBIDDEN_ROLES as readonly string[]).includes(request.agentRole)) {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint,
        failure: mcpFailure(
          'permission_denied',
          `the ${request.agentRole} role has no MCP access by design — it receives Relay-curated immutable evidence only`,
        ),
      });
    }

    /* --- steps 1–3: mission/agent identity, connection --- */
    const connection = this.deps.connections.get(request.connectionId);
    if (connection === null) {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint,
        failure: mcpFailure('capability_missing', `no MCP connection ${request.connectionId} exists`),
      });
    }

    const scope = connectionUsableBy(connection, {
      accountId: request.accountId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
    });
    if (!scope.usable) {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint, connection,
        failure: mcpFailure('permission_denied', `this connection is not usable here — ${scope.reason}`),
      });
    }

    if (!canInvoke(connection.state)) {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint, connection,
        failure: connection.state === 'capability_changed'
          ? mcpFailure('capability_changed', 'the server capability surface changed after approval — invocation is paused until it is re-approved')
          : mcpFailure('server_unreachable', `the connection is ${connection.state}, not ready`),
      });
    }

    /* --- step 4: the APPROVED snapshot, not the live one --- */
    if (connection.approvedSnapshotId === null) {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint, connection,
        failure: mcpFailure('capability_missing', 'no approved capability snapshot is bound to this connection'),
      });
    }
    const snapshot = this.deps.snapshots.get(connection.approvedSnapshotId);
    if (snapshot === null) {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint, connection,
        failure: mcpFailure('capability_missing', 'the approved capability snapshot could not be loaded'),
      });
    }

    /* --- step 5: the capability must exist in THAT snapshot --- */
    const capability = lookupCapability(snapshot, request.capabilityKind, request.capabilityName);
    if (capability === null) {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint, connection, snapshot,
        failure: mcpFailure(
          'capability_missing',
          `"${request.capabilityName}" is not present in the approved capability snapshot`,
        ),
      });
    }

    /* --- resource URI policy (§15), before anything is classified --- */
    if (request.capabilityKind === 'resource') {
      const uriRefusal = resourceUriRefusal(request.capabilityName);
      if (uriRefusal !== null) {
        return this.refuse({
          invocationId, request, requestedAt, safeArguments, argsFingerprint, connection, snapshot,
          capabilityFingerprint: capability.fingerprint,
          failure: mcpFailure('permission_denied', uriRefusal),
        });
      }
    }

    /* --- steps 6–7: normalize and classify --- */
    const entry = this.deps.registry.get(connection.definition.registryEntryId);
    // A TOOL is classified. A RESOURCE READ and a PROMPT FETCH are not: they
    // are `resources/read` and `prompts/get`, which retrieve and cannot act.
    // Running the tool-name rules over a resource URI would classify
    // `file:///fixture/readme.md` as `unknown` — the URI is not a verb — and
    // fail closed on a plain read, which is wrong rather than safe.
    const risk: McpRiskAssessment = request.capabilityKind === 'tool'
      ? classifyRisk({
        toolName: request.capabilityName,
        description: capability.description,
        inputSchema: capability.inputSchema,
        annotations: capability.annotations,
        registryDeclaredClass: entry?.declaredToolRisk[request.capabilityName] ?? null,
        serverIdentityVerified: connection.identity.trust === 'registry_verified',
        argumentValues: args,
        overrides: this.deps.riskOverrides,
      })
      : {
        riskClass: 'read_only',
        evidence: [`an MCP ${request.capabilityKind} is a retrieval operation and cannot modify state`],
        annotationContradiction: false,
        overrideApplied: false,
        requiresHumanApproval: false,
        reversible: true,
        crossesWorkspaceBoundary: false,
      };

    /* --- step 8: permissions --- */
    const permission = evaluatePermission({
      accountId: request.accountId,
      workspaceId: request.workspaceId,
      projectId: request.projectId,
      missionId: request.missionId,
      pspAgentFingerprint: request.pspAgentFingerprint,
      actualAgentId: request.actualAgentId,
      role: request.agentRole,
      serverIdentity: connection.identity,
      registryEntryId: connection.definition.registryEntryId,
      capabilitySnapshotIsApproved: connection.approvedSnapshotId === snapshot.snapshotId,
      capabilityExistsInSnapshot: true,
      capabilityKind: request.capabilityKind,
      capabilityName: request.capabilityName,
      normalizedArguments: args,
      riskClass: risk.riskClass,
      missingCredentialScopes: [],
      networkPolicyAllows: true,
      grants: this.deps.grants.forAgent(request.actualAgentId),
      missionWritablePathPrefixes: this.deps.missionWritablePathPrefixes(request.missionId),
      now: requestedAt,
    });

    if (permission.decision === 'deny') {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint, connection, snapshot,
        capabilityFingerprint: capability.fingerprint, risk, permission,
        failure: mcpFailure('permission_denied', permission.reason, { details: permission.evidence }),
      });
    }

    /* --- step 9: approval --- */
    let approvalRecordId: McpApprovalRecordId | null = null;
    if (permission.decision === 'requires_approval') {
      const verdict = findCoveringApproval(
        this.deps.approvals.forOperation({
          connectionId: request.connectionId,
          capabilityName: request.capabilityName,
        }),
        {
          accountId: request.accountId,
          workspaceId: request.workspaceId,
          projectId: request.projectId,
          missionId: request.missionId,
          actualAgentId: request.actualAgentId,
          agentRole: request.agentRole,
          serverName: connection.identity.configuredName,
          capabilitySnapshotFingerprint: snapshot.fingerprint,
          capabilityKind: request.capabilityKind,
          capabilityName: request.capabilityName,
          argumentFingerprint: argsFingerprint,
          riskClass: risk.riskClass,
          now: requestedAt,
        },
      );
      if (!verdict.covered) {
        return this.refuse({
          invocationId, request, requestedAt, safeArguments, argsFingerprint, connection, snapshot,
          capabilityFingerprint: capability.fingerprint, risk, permission,
          failure: mcpFailure('approval_required', verdict.reason, { details: permission.evidence }),
        });
      }
      approvalRecordId = verdict.record.approvalRecordId;
      // Consume BEFORE dispatching. A single-use approval consumed after the
      // call would be reusable by a concurrent invocation that started while
      // the first was in flight.
      this.deps.approvals.record(consumeApproval(verdict.record));
    }

    /* --- steps 10–12: dispatch, bounded --- */
    const client = this.deps.clients.get(request.connectionId);
    if (client === null) {
      return this.refuse({
        invocationId, request, requestedAt, safeArguments, argsFingerprint, connection, snapshot,
        capabilityFingerprint: capability.fingerprint, risk, permission, approvalRecordId,
        failure: mcpFailure('server_unreachable', 'the connection has no live client session'),
      });
    }

    const timeoutMs = request.timeoutMs ?? this.deps.defaultTimeoutMs ?? 30_000;
    const startedAt = this.deps.now();
    const dispatch = await this.dispatch(client, request, timeoutMs);
    const completedAt = this.deps.now();

    if (!dispatch.ok) {
      return this.settle({
        invocationId, request, requestedAt, startedAt, completedAt, safeArguments, argsFingerprint,
        connection, snapshot, capabilityFingerprint: capability.fingerprint, risk, permission,
        approvalRecordId, failure: dispatch.failure, dispatched: true,
        blocks: [], summary: null, evidenceReferences: [],
      });
    }

    /* --- steps 13–15: validate, redact, bound, store --- */
    const sanitized = sanitizeResult({
      blocks: dispatch.value.content,
      isError: dispatch.value.isError,
      sourceServerName: connection.identity.configuredName,
      capabilityFingerprint: capability.fingerprint,
      retrievedAt: completedAt,
      limits: this.deps.limits ?? MCP_DEFAULT_RESULT_LIMITS,
      evidenceReferenceFor: (blockIndex) => this.deps.evidence.store({
        connectionId: request.connectionId,
        invocationId,
        blockIndex,
        mimeType: null,
        bytes: 0,
        digest: capability.fingerprint,
      }),
    });

    if (sanitized.refusedReason !== null) {
      return this.settle({
        invocationId, request, requestedAt, startedAt, completedAt, safeArguments, argsFingerprint,
        connection, snapshot, capabilityFingerprint: capability.fingerprint, risk, permission,
        approvalRecordId, dispatched: true, blocks: [], summary: null, evidenceReferences: [],
        failure: mcpFailure('result_rejected', sanitized.refusedReason),
      });
    }

    // A tool that reports its own error is a FAILED invocation, not a
    // completed one that happens to contain an error message.
    const failure: McpFailure | null = dispatch.value.isError
      ? mcpFailure('tool_execution_error', 'the MCP server reported a tool execution error')
      : null;

    return this.settle({
      invocationId, request, requestedAt, startedAt, completedAt, safeArguments, argsFingerprint,
      connection, snapshot, capabilityFingerprint: capability.fingerprint, risk, permission,
      approvalRecordId, dispatched: true,
      blocks: sanitized.blocks, summary: sanitized.summary,
      evidenceReferences: sanitized.evidenceReferences, failure,
    });
  }

  /**
   * The gateway's OWN deadline, raced against the client call.
   *
   * Relying on the transport's timeout would mean a bug in one transport can
   * hang every mission that uses it. This race is the backstop, and it is why
   * `timed_out` is reachable even from a client that never returns.
   */
  private async dispatch(
    client: McpClientPort,
    request: McpGatewayRequest,
    timeoutMs: number,
  ): Promise<{ ok: true; value: McpRawToolResult } | { ok: false; failure: McpFailure }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<{ ok: false; failure: McpFailure }>((resolve) => {
      timer = setTimeout(
        () => resolve({ ok: false, failure: mcpFailure('timed_out', `the MCP call exceeded its ${timeoutMs}ms budget`) }),
        timeoutMs,
      );
    });

    const call = (async (): Promise<{ ok: true; value: McpRawToolResult } | { ok: false; failure: McpFailure }> => {
      const options = { timeoutMs, signal: request.signal };
      try {
        if (request.capabilityKind === 'tool') {
          const outcome = await client.callTool(request.capabilityName, request.arguments, options);
          return outcome.ok ? { ok: true, value: outcome.value } : { ok: false, failure: outcome.failure };
        }
        if (request.capabilityKind === 'resource') {
          const outcome = await client.readResource(request.capabilityName, options);
          return outcome.ok
            ? { ok: true, value: { content: outcome.value.contents, isError: false, structuredContent: null } }
            : { ok: false, failure: outcome.failure };
        }
        const promptArgs: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.arguments)) {
          if (typeof value === 'string') promptArgs[key] = value;
        }
        const outcome = await client.getPrompt(request.capabilityName, promptArgs, options);
        if (!outcome.ok) return { ok: false, failure: outcome.failure };
        return {
          ok: true,
          value: {
            content: outcome.value.messages.flatMap((message) => extractPromptBlocks(message)),
            isError: false,
            structuredContent: null,
          },
        };
      } catch (error) {
        // A transport that THROWS has already violated its contract. Catching
        // here keeps a raw error message — which may carry a path or a header
        // — from escaping as an exception.
        return {
          ok: false,
          failure: mcpFailure('internal_error', `the MCP client raised an unexpected error (${errorKind(error)})`),
        };
      }
    })();

    try {
      return await Promise.race([call, deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /* ---------------------------------------------------------------- *
   * Record construction. Both paths go through `settle`, so no refusal
   * can skip the audit record.
   * ---------------------------------------------------------------- */

  private refuse(input: RefusalInput): McpGatewayOutcome {
    return this.settle({
      ...input,
      startedAt: null,
      completedAt: null,
      dispatched: false,
      blocks: [],
      summary: null,
      evidenceReferences: [],
      approvalRecordId: input.approvalRecordId ?? null,
    });
  }

  private settle(input: SettleInput): McpGatewayOutcome {
    const result = settleInvocation({
      invocationId: input.invocationId,
      intendedState: input.failure === null ? 'completed' : 'failed',
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      summary: input.summary,
      evidenceReferences: input.evidenceReferences,
      failure: input.failure,
      agentFacingContent: input.blocks,
    });

    const audit: McpAuditRecord = {
      auditRecordId: this.deps.ids.next('mcu'),
      invocationId: input.invocationId,
      accountId: input.request.accountId,
      workspaceId: input.request.workspaceId,
      projectId: input.request.projectId,
      missionId: input.request.missionId,
      pspAgentFingerprint: input.request.pspAgentFingerprint,
      actualAgentId: input.request.actualAgentId,
      agentRole: input.request.agentRole,
      connectionId: input.request.connectionId,
      serverName: input.connection?.identity.configuredName ?? 'unknown',
      serverTrust: input.connection?.identity.trust ?? 'untrusted',
      capabilitySnapshotId: (input.snapshot?.snapshotId ?? 'mcs_none') as McpAuditRecord['capabilitySnapshotId'],
      capabilityFingerprint: input.capabilityFingerprint ?? ('mcpfp1:none' as McpCapabilityFingerprint),
      capabilityKind: input.request.capabilityKind,
      capabilityName: input.request.capabilityName,
      safeArgumentSummary: input.safeArguments,
      argumentFingerprint: input.argsFingerprint,
      riskClass: input.risk?.riskClass ?? 'unknown',
      permissionDecision: input.permission?.decision ?? 'deny',
      permissionReason: input.permission?.reason ?? (input.failure?.message ?? 'refused before policy evaluation'),
      approvalRecordId: input.approvalRecordId ?? null,
      requestedAt: input.requestedAt,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      invocationState: result.state,
      cancelled: result.state === 'cancelled',
      timedOut: result.state === 'timed_out',
      safeResultSummary: result.summary,
      evidenceReferences: result.evidenceReferences,
      failureCategory: input.failure?.category ?? null,
      transport: input.connection?.definition.transport ?? 'unknown',
      negotiatedProtocolVersion: input.connection?.protocol?.negotiatedProtocolVersion ?? null,
    };

    this.deps.audit.append(audit);
    return {
      result,
      audit,
      permission: input.permission ?? null,
      risk: input.risk ?? null,
      dispatched: input.dispatched,
    };
  }
}

/* ------------------------------------------------------------------ */

interface RefusalInput {
  readonly invocationId: McpInvocationId;
  readonly request: McpGatewayRequest;
  readonly requestedAt: string;
  readonly safeArguments: Readonly<Record<string, string>>;
  readonly argsFingerprint: McpCapabilityFingerprint;
  readonly connection?: McpConnection;
  readonly snapshot?: McpCapabilitySnapshot;
  readonly capabilityFingerprint?: McpCapabilityFingerprint;
  readonly risk?: McpRiskAssessment;
  readonly permission?: McpPermissionDecision;
  readonly approvalRecordId?: McpApprovalRecordId | null;
  readonly failure: McpFailure;
}

interface SettleInput extends Omit<RefusalInput, 'failure'> {
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly dispatched: boolean;
  readonly blocks: readonly McpSanitizedContentBlock[];
  readonly summary: McpInvocationResult['summary'];
  readonly evidenceReferences: readonly string[];
  readonly failure: McpFailure | null;
}

interface LookedUpCapability {
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations: Parameters<typeof classifyRisk>[0]['annotations'];
  readonly fingerprint: McpCapabilityFingerprint;
}

function lookupCapability(
  snapshot: McpCapabilitySnapshot,
  kind: McpCapabilityKind,
  name: string,
): LookedUpCapability | null {
  if (kind === 'tool') {
    const tool = findTool(snapshot, name);
    return tool === null ? null : {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
      fingerprint: tool.fingerprint,
    };
  }
  if (kind === 'resource') {
    const resource = findResource(snapshot, name);
    return resource === null ? null : {
      description: resource.description,
      inputSchema: {},
      annotations: { title: null, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: null },
      fingerprint: resource.fingerprint,
    };
  }
  const prompt = findPrompt(snapshot, name);
  return prompt === null ? null : {
    description: prompt.description,
    inputSchema: {},
    annotations: { title: null, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: null },
    fingerprint: prompt.fingerprint,
  };
}

/** Extracts content blocks from a prompt message without trusting its shape. */
function extractPromptBlocks(message: unknown): Parameters<typeof sanitizeResult>[0]['blocks'][number][] {
  if (typeof message !== 'object' || message === null) return [];
  const content = (message as { content?: unknown }).content;
  if (Array.isArray(content)) return content as Parameters<typeof sanitizeResult>[0]['blocks'][number][];
  if (typeof content === 'object' && content !== null) {
    return [content as Parameters<typeof sanitizeResult>[0]['blocks'][number]];
  }
  return [];
}

/** A safe description of a thrown value — never its message. */
function errorKind(error: unknown): string {
  if (error instanceof Error) return error.name;
  return typeof error;
}

/**
 * RESOURCE URI POLICY (§15).
 *
 * A resource URI must not become a second way to reach the filesystem or the
 * network. The capability must already exist in the approved snapshot — which
 * is the primary control — but a snapshot entry is server-supplied, so the URI
 * is checked on its own merits too.
 *
 * Returns a refusal reason, or null when the URI is acceptable.
 */
function resourceUriRefusal(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return 'the resource URI is not a parsable absolute URI';
  }
  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  // `file:` is permitted because an MCP server's own filesystem resources are
  // read THROUGH the server, never by Relay — Relay opens no file here. What
  // is refused is a scheme that would make Relay itself fetch something.
  const allowed = ['file', 'https', 'resource', 'mcp'];
  if (!allowed.includes(scheme)) {
    return `the resource URI scheme "${scheme}" is not permitted`;
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return 'the resource URI embeds credentials';
  }
  if (uri.includes('..')) {
    // Refused rather than resolved, for the same reason `pathWithinScope`
    // refuses traversal: a path normalized before it is trusted is a path
    // whose normalization is now part of the security boundary.
    return 'the resource URI contains a traversal segment';
  }
  return null;
}
