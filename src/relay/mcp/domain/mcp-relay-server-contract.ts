/**
 * FUTURE: RELAY AS AN MCP SERVER — ARCHITECTURAL CONTRACT ONLY (§27).
 *
 * NOTHING IN THIS FILE IS IMPLEMENTED, AND NOTHING IN THIS FILE IS REACHABLE.
 *
 * This milestone makes Relay an MCP *host* — it consumes MCP servers under
 * policy. The mirror image, Relay exposing ITSELF as an MCP server so other
 * agents can drive missions, is a genuinely different security problem and is
 * deliberately not built here. What this file provides is the shape that work
 * would take, recorded now so the design decisions are reviewable before any
 * code exists to argue with.
 *
 * `MCP_RELAY_SERVER_STATUS` is `not_implemented` and
 * `relayMcpServerIsAvailable()` returns false unconditionally. There is no
 * flag, no environment variable and no configuration that changes either —
 * `mcp-relay-server-contract.test.ts` asserts both, so this cannot quietly
 * become half-live.
 *
 * THE HARD PART, STATED NOW SO IT IS NOT DISCOVERED LATER: as a host, Relay
 * decides what an agent may reach. As a SERVER, Relay becomes the thing
 * somebody else's policy has to constrain — and every resource below is a
 * window into a customer's project. The exposure list is therefore a DENY list
 * first and an offer list second.
 */

/** Always this value in this milestone. */
export const MCP_RELAY_SERVER_STATUS = 'not_implemented' as const;

export const relayMcpServerIsAvailable = (): false => false;

/**
 * Resources Relay MIGHT expose one day. Each is read-only by intent, scoped to
 * a single project or mission, and would require the caller to hold an
 * entitlement to that specific project — never a blanket token.
 */
export const FUTURE_RELAY_MCP_RESOURCES: readonly { readonly uri: string; readonly intent: string }[] = Object.freeze([
  { uri: 'relay://projects/{id}/brain', intent: 'read-only Project Brain for ONE project the caller is entitled to' },
  { uri: 'relay://missions/{id}/status', intent: 'read-only mission status' },
  { uri: 'relay://missions/{id}/evidence', intent: 'read-only, already-redacted mission evidence references' },
  { uri: 'relay://agents/{id}/capabilities', intent: 'read-only declared capabilities of one agent' },
]);

/**
 * Tools Relay MIGHT expose. Note that every one of them is a MISSION-LEVEL
 * operation with a human-visible consequence, and none is a primitive.
 * `relay.approval.respond` in particular would have to prove an authenticated
 * HUMAN — an agent answering its own approval request is the failure mode the
 * entire approval broker exists to prevent.
 */
export const FUTURE_RELAY_MCP_TOOLS: readonly { readonly name: string; readonly intent: string; readonly gate: string }[] = Object.freeze([
  { name: 'relay.mission.create', intent: 'create a mission from a contract', gate: 'entitlement to the project + mission budget policy' },
  { name: 'relay.mission.pause', intent: 'pause a running mission', gate: 'entitlement to the mission' },
  { name: 'relay.mission.resume', intent: 'resume a paused mission', gate: 'entitlement to the mission' },
  { name: 'relay.mission.inspect', intent: 'read mission state', gate: 'entitlement to the mission' },
  { name: 'relay.approval.respond', intent: 'answer a pending approval', gate: 'AUTHENTICATED HUMAN ONLY — never an agent' },
]);

/**
 * What Relay-as-a-server would NEVER expose. This list is the load-bearing
 * half of the contract: an MCP server is judged by what it refuses.
 */
export const FUTURE_RELAY_MCP_NEVER_EXPOSED: readonly string[] = Object.freeze([
  'arbitrary terminal or shell execution',
  'provider credentials of any kind',
  'unrestricted Project Brain across projects',
  'workspace data belonging to another project or account',
  'mission mutation without an entitlement check',
  'raw agent transcripts or hidden reasoning',
  'the Independent Reviewer surface, which stays MCP-free in both directions',
]);
