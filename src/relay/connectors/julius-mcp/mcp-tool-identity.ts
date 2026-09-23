import type {
  McpCapabilityKind,
  McpCapabilitySnapshot,
  McpRiskClass,
  McpToolDefinition,
} from '../../mcp';
import type { JuliusMcpToolId, JuliusToolDefinition } from '../../mission/julius';
import {
  juliusActionRiskOfMcp,
  juliusToolRiskOf,
  type JuliusActionRisk,
  type JuliusMcpTransport,
} from './mcp-authority-translation';

/**
 * NAMING AN MCP CAPABILITY SO JULIUS CAN GOVERN IT.
 *
 * `JuliusToolController` decides from a REGISTERED `JuliusToolDefinition`.
 * Until an MCP capability has one, the controller cannot reason about it at
 * all, and "route MCP through Julius" has nowhere to start. This is that
 * definition, derived from an APPROVED capability snapshot and from nothing
 * an agent said.
 *
 * THE ID IS DERIVED, NEVER CHOSEN. An agent cannot invent a tool id that
 * resolves: `JuliusToolRegistry.get` answers null for anything unregistered,
 * `invoke` turns that into DENIED before a reservation exists, and the only
 * thing that registers an `mcp:` id is this function running over a snapshot
 * an operator approved. That is the same principle the gateway is built on —
 * an agent passes a connection id and a capability NAME and cannot pass a
 * URL, a command or a transport — carried up to the tool layer instead of
 * re-validated there.
 *
 * THE VERSION IS THE CAPABILITY'S FINGERPRINT, which is the useful part.
 * `registry.get(toolId, version)` requires an EXACT version match, so a server
 * that changes a tool's schema after approval produces a different fingerprint
 * and the old registration stops resolving. The gateway already pauses such a
 * connection as `capability_changed`; this makes the same fact true one layer
 * up, without the two having to agree by convention.
 */

/** A separator that cannot appear in the encoded segments, so the id is injective. */
const SEP = ':';

/**
 * The tool id for one capability of one connection.
 *
 * The capability NAME is percent-encoded. Server-supplied names are not
 * constrained to avoid the separator, and two different capabilities whose
 * ids collided would mean one registration silently shadowing the other —
 * a capability invoked under another's governance.
 */
export const juliusMcpToolId = (input: {
  readonly connectionId: string;
  readonly capabilityKind: McpCapabilityKind;
  readonly capabilityName: string;
}): JuliusMcpToolId =>
  ['mcp', input.connectionId, input.capabilityKind, encodeURIComponent(input.capabilityName)].join(SEP) as JuliusMcpToolId;

/**
 * THE C.A.R.D. CAPABILITY EVERY MCP INVOCATION ASKS FOR.
 *
 * One string, deliberately, rather than one per server. C.A.R.D. answers "may
 * this mission use MCP at all", which is a Relay-level decision; WHICH server
 * and WHICH tool is already decided by the MCP permission grants and the
 * approved snapshot, and duplicating that into the capability list would put
 * the same decision in two places that can disagree. Two authorities for one
 * question is the thing this whole integration exists to remove — building a
 * second copy of MCP's own scoping here would be that mistake in reverse.
 */
export const JULIUS_MCP_CAPABILITY = 'mcp';

/** Ceilings for an MCP invocation, as a tool definition must declare them. */
export interface JuliusMcpToolLimits {
  readonly timeoutCeilingMs: number;
  readonly outputCeilingBytes: number;
}

export const JULIUS_MCP_DEFAULT_LIMITS: JuliusMcpToolLimits = Object.freeze({
  timeoutCeilingMs: 60_000,
  outputCeilingBytes: 256_000,
});

/**
 * What an MCP invocation DOES, in the terms `JuliusToolController` reasons in.
 *
 * `operationFor` in the controller derives its C.A.R.D. questions from these
 * flags, so they have to be true rather than convenient:
 *
 *   a stdio server is a child PROCESS this host spawns; an HTTP server is a
 *   NETWORK call. Declaring the wrong one lets a policy that forbids process
 *   execution authorise a spawn.
 *
 *   `mutatesFilesystem` is true ONLY for `workspace_write`. An `external_write`
 *   changes something real and changes nothing on this filesystem, and
 *   claiming otherwise would route it into workspace-scoped checks that would
 *   pass while saying nothing about the thing that was actually changed. That
 *   an external mutation has no honest `expectedMutation` value today is a
 *   REAL GAP, recorded rather than papered over: see the note on
 *   `julius-tools.ts`'s `expectedMutation` and the unknown-outcome work.
 */
export function juliusMcpToolEffects(input: {
  readonly risk: JuliusActionRisk;
  readonly transport: JuliusMcpTransport;
}): Pick<JuliusToolDefinition, 'readsFilesystem' | 'mutatesFilesystem' | 'accessesNetwork' | 'executesProcess'> {
  return {
    // A capability can read anything the SERVER can reach; it never reads this
    // host's filesystem on Julius's behalf. False is the honest answer, and it
    // keeps `READ_FILESYSTEM` out of a question it cannot answer.
    readsFilesystem: false,
    mutatesFilesystem: input.risk === 'workspace_write',
    accessesNetwork: input.transport === 'http',
    executesProcess: input.transport === 'stdio',
  };
}

/**
 * One approved capability, as a tool Julius can govern.
 *
 * `available` follows the snapshot and the connection, so a capability behind
 * a paused or revoked connection is registered as UNAVAILABLE rather than
 * omitted — the difference matters to an audit reading "why was this denied".
 */
export function juliusMcpToolDefinition(input: {
  readonly snapshot: McpCapabilitySnapshot;
  readonly tool: McpToolDefinition;
  readonly risk: McpRiskClass;
  readonly transport: JuliusMcpTransport;
  readonly available: boolean;
  readonly limits?: JuliusMcpToolLimits;
}): JuliusToolDefinition {
  const risk = juliusActionRiskOfMcp(input.risk);
  const limits = input.limits ?? JULIUS_MCP_DEFAULT_LIMITS;
  return {
    toolId: juliusMcpToolId({
      connectionId: input.snapshot.connectionId,
      capabilityKind: 'tool',
      capabilityName: input.tool.name,
    }),
    // The capability's own fingerprint. A schema change after approval is a
    // different version, and the old registration stops resolving.
    version: input.tool.fingerprint,
    kind: 'MCP',
    capability: JULIUS_MCP_CAPABILITY,
    riskClass: juliusToolRiskOf(risk),
    ...juliusMcpToolEffects({ risk, transport: input.transport }),
    timeoutCeilingMs: limits.timeoutCeilingMs,
    outputCeilingBytes: limits.outputCeilingBytes,
    // Anything that changes state runs SERIAL: two concurrent mutations of one
    // external system are the case nobody can reconcile afterwards.
    concurrency: risk === 'read_only' ? 'PARALLEL' : 'SERIAL',
    available: input.available,
  };
}
