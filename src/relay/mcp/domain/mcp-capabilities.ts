/**
 * MCP CAPABILITY SNAPSHOTS (PURE).
 *
 * A snapshot is the answer to "what was this server able to do at the moment a
 * Mission Contract approved it?" — captured once, fingerprinted, and then
 * treated as immutable. Missions bind to a snapshot id, not to a connection,
 * because a connection's capabilities can change underneath it and a mission
 * that binds to the live surface has approved whatever the server decides to
 * become.
 *
 * NORMALIZATION IS RELAY'S, NOT THE SDK'S. Everything here is a Relay-owned
 * record built FROM a decoded MCP payload. No SDK class, no `Tool` object and
 * no live handle is stored, so nothing in a snapshot can hold a socket, a
 * child process, or a schema validator that behaves differently across SDK
 * versions.
 *
 * ANNOTATIONS ARE EVIDENCE, NOT AUTHORITY. `readOnlyHint`, `destructiveHint`
 * and friends are recorded verbatim — and `../policy/mcp-risk.ts` classifies
 * risk without consulting them as authority. A server that wants write access
 * only has to claim `readOnlyHint: true`, so a host that trusts the hint has
 * delegated its security policy to the thing it is defending against. They are
 * kept because they are useful *corroboration* and useful *evidence when they
 * disagree with Relay's classification*.
 *
 * CHANGE CLASSIFICATION (§9) distinguishes ten kinds of difference, because
 * "the capabilities changed" is not a decision anyone can make. A description
 * edit and a new input field with a filesystem path in it are both "changed",
 * and exactly one of them should pause a mission.
 */

import type { McpCapabilitySnapshotId, McpConnectionId } from '../../protocol/ids';
import { fingerprintValue, type McpCapabilityFingerprint } from './mcp-fingerprint';

export const MCP_CAPABILITY_KINDS = ['tool', 'resource', 'prompt'] as const;
export type McpCapabilityKind = (typeof MCP_CAPABILITY_KINDS)[number];

/**
 * Server-supplied behavioural hints, stored verbatim as EVIDENCE. `null` means
 * the server said nothing, which is different from saying `false` — a server
 * that omits `destructiveHint` has not promised anything.
 */
export interface McpToolAnnotations {
  readonly title: string | null;
  readonly readOnlyHint: boolean | null;
  readonly destructiveHint: boolean | null;
  readonly idempotentHint: boolean | null;
  readonly openWorldHint: boolean | null;
}

export const EMPTY_ANNOTATIONS: McpToolAnnotations = Object.freeze({
  title: null, readOnlyHint: null, destructiveHint: null, idempotentHint: null, openWorldHint: null,
});

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  /** The declared JSON Schema, normalized but not interpreted. */
  readonly inputSchema: Record<string, unknown>;
  /** Present only when the server declares one. */
  readonly outputSchema: Record<string, unknown> | null;
  readonly annotations: McpToolAnnotations;
  readonly fingerprint: McpCapabilityFingerprint;
  /** Separate fingerprints so a change can be attributed to a PART. */
  readonly inputSchemaFingerprint: McpCapabilityFingerprint;
  readonly outputSchemaFingerprint: McpCapabilityFingerprint;
  readonly annotationsFingerprint: McpCapabilityFingerprint;
}

export interface McpResourceDefinition {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string | null;
  readonly fingerprint: McpCapabilityFingerprint;
}

export interface McpPromptArgumentDefinition {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
}

export interface McpPromptDefinition {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly McpPromptArgumentDefinition[];
  readonly fingerprint: McpCapabilityFingerprint;
}

/** What the server advertised it supports in its `initialize` result. */
export interface McpServerCapabilityFlags {
  readonly tools: boolean;
  readonly resources: boolean;
  readonly prompts: boolean;
  readonly logging: boolean;
  readonly completions: boolean;
}

export interface McpCapabilitySnapshot {
  readonly snapshotId: McpCapabilitySnapshotId;
  readonly connectionId: McpConnectionId;
  /** The revision negotiated when this snapshot was taken. */
  readonly negotiatedProtocolVersion: string;
  readonly serverName: string;
  readonly serverVersion: string | null;
  readonly flags: McpServerCapabilityFlags;
  readonly tools: readonly McpToolDefinition[];
  readonly resources: readonly McpResourceDefinition[];
  readonly prompts: readonly McpPromptDefinition[];
  /** Digest over the whole surface. This is what a mission binds to. */
  readonly fingerprint: McpCapabilityFingerprint;
  readonly capturedAt: string;
}

/* ------------------------------------------------------------------ *
 * Normalization — decoded JSON-RPC payload → Relay records.
 * Every input is UNTRUSTED. Nothing here throws; a malformed entry is
 * dropped and reported, because one bad tool must not make a server's
 * entire surface undiscoverable.
 * ------------------------------------------------------------------ */

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asBool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

export function normalizeAnnotations(raw: unknown): McpToolAnnotations {
  const record = asRecord(raw);
  if (record === null) return EMPTY_ANNOTATIONS;
  return {
    title: asString(record.title),
    readOnlyHint: asBool(record.readOnlyHint),
    destructiveHint: asBool(record.destructiveHint),
    idempotentHint: asBool(record.idempotentHint),
    openWorldHint: asBool(record.openWorldHint),
  };
}

export function normalizeTool(raw: unknown): McpToolDefinition | null {
  const record = asRecord(raw);
  const name = record ? asString(record.name) : null;
  if (record === null || name === null || name.trim() === '') return null;

  const inputSchema = asRecord(record.inputSchema) ?? {};
  const outputSchema = asRecord(record.outputSchema);
  const annotations = normalizeAnnotations(record.annotations);
  const description = asString(record.description) ?? asString(record.title) ?? '';

  const core = { name, description, inputSchema, outputSchema, annotations };
  return {
    name,
    description,
    inputSchema,
    outputSchema,
    annotations,
    fingerprint: fingerprintValue('mcp.tool', core),
    inputSchemaFingerprint: fingerprintValue('mcp.tool.inputSchema', inputSchema),
    outputSchemaFingerprint: fingerprintValue('mcp.tool.outputSchema', outputSchema),
    annotationsFingerprint: fingerprintValue('mcp.tool.annotations', annotations),
  };
}

export function normalizeResource(raw: unknown): McpResourceDefinition | null {
  const record = asRecord(raw);
  const uri = record ? asString(record.uri) : null;
  if (record === null || uri === null || uri.trim() === '') return null;
  const name = asString(record.name) ?? uri;
  const description = asString(record.description) ?? '';
  const mimeType = asString(record.mimeType);
  return {
    uri, name, description, mimeType,
    fingerprint: fingerprintValue('mcp.resource', { uri, name, description, mimeType }),
  };
}

export function normalizePrompt(raw: unknown): McpPromptDefinition | null {
  const record = asRecord(raw);
  const name = record ? asString(record.name) : null;
  if (record === null || name === null || name.trim() === '') return null;
  const description = asString(record.description) ?? '';
  const rawArgs = Array.isArray(record.arguments) ? record.arguments : [];
  const args: McpPromptArgumentDefinition[] = [];
  for (const entry of rawArgs) {
    const argRecord = asRecord(entry);
    const argName = argRecord ? asString(argRecord.name) : null;
    if (argRecord === null || argName === null) continue;
    args.push({
      name: argName,
      description: asString(argRecord.description) ?? '',
      required: asBool(argRecord.required) ?? false,
    });
  }
  return {
    name, description, arguments: args,
    fingerprint: fingerprintValue('mcp.prompt', { name, description, arguments: args }),
  };
}

export function normalizeCapabilityFlags(raw: unknown): McpServerCapabilityFlags {
  const record = asRecord(raw) ?? {};
  return {
    tools: asRecord(record.tools) !== null,
    resources: asRecord(record.resources) !== null,
    prompts: asRecord(record.prompts) !== null,
    logging: asRecord(record.logging) !== null,
    completions: asRecord(record.completions) !== null,
  };
}

/**
 * Builds the snapshot digest. Lists are sorted BY NAME/URI first: a server is
 * free to return `tools/list` in any order, and a snapshot whose fingerprint
 * changed because a server reordered its reply would pause missions for no
 * reason. Order is not meaning here; the SET of capabilities is.
 */
export function snapshotFingerprint(input: {
  readonly negotiatedProtocolVersion: string;
  readonly serverName: string;
  readonly serverVersion: string | null;
  readonly flags: McpServerCapabilityFlags;
  readonly tools: readonly McpToolDefinition[];
  readonly resources: readonly McpResourceDefinition[];
  readonly prompts: readonly McpPromptDefinition[];
}): McpCapabilityFingerprint {
  const sorted = <T>(items: readonly T[], key: (item: T) => string): string[] =>
    [...items].map((item) => `${key(item)}`).sort();
  return fingerprintValue('mcp.snapshot', {
    negotiatedProtocolVersion: input.negotiatedProtocolVersion,
    serverName: input.serverName,
    serverVersion: input.serverVersion,
    flags: input.flags,
    tools: sorted(input.tools, (t) => `${t.name} ${t.fingerprint}`),
    resources: sorted(input.resources, (r) => `${r.uri} ${r.fingerprint}`),
    prompts: sorted(input.prompts, (p) => `${p.name} ${p.fingerprint}`),
  });
}

/* ------------------------------------------------------------------ *
 * Lookup — the ONLY approved way to answer "does this capability exist
 * in the approved snapshot?". The gateway calls these; it never
 * searches the live connection.
 * ------------------------------------------------------------------ */

export const findTool = (snapshot: McpCapabilitySnapshot, name: string): McpToolDefinition | null =>
  snapshot.tools.find((tool) => tool.name === name) ?? null;

export const findResource = (snapshot: McpCapabilitySnapshot, uri: string): McpResourceDefinition | null =>
  snapshot.resources.find((resource) => resource.uri === uri) ?? null;

export const findPrompt = (snapshot: McpCapabilitySnapshot, name: string): McpPromptDefinition | null =>
  snapshot.prompts.find((prompt) => prompt.name === name) ?? null;

/* ------------------------------------------------------------------ *
 * Change classification (§9).
 * ------------------------------------------------------------------ */

export const MCP_CAPABILITY_CHANGE_KINDS = [
  'tool_added',
  'tool_removed',
  'tool_description_changed',
  'tool_input_schema_changed',
  'tool_output_schema_changed',
  'tool_annotations_changed',
  'resource_added',
  'resource_removed',
  'resource_changed',
  'prompt_added',
  'prompt_removed',
  'prompt_changed',
  'protocol_version_changed',
  'server_identity_changed',
] as const;
export type McpCapabilityChangeKind = (typeof MCP_CAPABILITY_CHANGE_KINDS)[number];

export interface McpCapabilityChange {
  readonly kind: McpCapabilityChangeKind;
  readonly capabilityKind: McpCapabilityKind | 'connection';
  /** Tool/prompt name or resource URI. */
  readonly target: string;
  readonly previousFingerprint: McpCapabilityFingerprint | null;
  readonly currentFingerprint: McpCapabilityFingerprint | null;
  /**
   * Whether this change, on its own, requires fresh human approval before the
   * affected capability may be used again. A description edit does not; a new
   * tool, a removed tool, or a changed input schema does.
   */
  readonly requiresReapproval: boolean;
}

export interface McpCapabilityDiff {
  readonly previousSnapshotFingerprint: McpCapabilityFingerprint;
  readonly currentSnapshotFingerprint: McpCapabilityFingerprint;
  readonly changed: boolean;
  readonly changes: readonly McpCapabilityChange[];
  /** Names/URIs whose approvals must be discarded. */
  readonly reapprovalRequiredFor: readonly string[];
}

/**
 * Changes that are DESCRIPTION-ONLY. These are the only ones that do not force
 * reapproval, and the list is deliberately short: a description is the one part
 * of a tool that cannot change what the tool does.
 *
 * Note that a description change is still RECORDED. Prompt-injection commonly
 * arrives as a rewritten description, so "harmless enough not to pause the
 * mission" is not the same as "not worth evidence".
 */
const DESCRIPTION_ONLY_CHANGES = new Set<McpCapabilityChangeKind>([
  'tool_description_changed',
]);

const requiresReapproval = (kind: McpCapabilityChangeKind): boolean =>
  !DESCRIPTION_ONLY_CHANGES.has(kind);

export function diffSnapshots(
  previous: McpCapabilitySnapshot,
  current: McpCapabilitySnapshot,
): McpCapabilityDiff {
  const changes: McpCapabilityChange[] = [];
  const push = (
    kind: McpCapabilityChangeKind,
    capabilityKind: McpCapabilityKind | 'connection',
    target: string,
    previousFingerprint: McpCapabilityFingerprint | null,
    currentFingerprint: McpCapabilityFingerprint | null,
  ): void => {
    changes.push({ kind, capabilityKind, target, previousFingerprint, currentFingerprint, requiresReapproval: requiresReapproval(kind) });
  };

  if (previous.negotiatedProtocolVersion !== current.negotiatedProtocolVersion) {
    push('protocol_version_changed', 'connection', current.negotiatedProtocolVersion, null, null);
  }
  if (previous.serverName !== current.serverName || previous.serverVersion !== current.serverVersion) {
    push('server_identity_changed', 'connection', current.serverName, null, null);
  }

  /* tools */
  const previousTools = new Map(previous.tools.map((tool) => [tool.name, tool]));
  const currentTools = new Map(current.tools.map((tool) => [tool.name, tool]));
  for (const [name, tool] of currentTools) {
    const before = previousTools.get(name);
    if (!before) { push('tool_added', 'tool', name, null, tool.fingerprint); continue; }
    if (before.fingerprint === tool.fingerprint) continue;
    // Attribute the change to the PART that moved. A tool whose input schema
    // and description both changed reports both, and the schema change is what
    // forces reapproval.
    if (before.inputSchemaFingerprint !== tool.inputSchemaFingerprint) {
      push('tool_input_schema_changed', 'tool', name, before.inputSchemaFingerprint, tool.inputSchemaFingerprint);
    }
    if (before.outputSchemaFingerprint !== tool.outputSchemaFingerprint) {
      push('tool_output_schema_changed', 'tool', name, before.outputSchemaFingerprint, tool.outputSchemaFingerprint);
    }
    if (before.annotationsFingerprint !== tool.annotationsFingerprint) {
      push('tool_annotations_changed', 'tool', name, before.annotationsFingerprint, tool.annotationsFingerprint);
    }
    if (before.description !== tool.description) {
      push('tool_description_changed', 'tool', name, before.fingerprint, tool.fingerprint);
    }
  }
  for (const [name, tool] of previousTools) {
    if (!currentTools.has(name)) push('tool_removed', 'tool', name, tool.fingerprint, null);
  }

  /* resources */
  const previousResources = new Map(previous.resources.map((r) => [r.uri, r]));
  const currentResources = new Map(current.resources.map((r) => [r.uri, r]));
  for (const [uri, resource] of currentResources) {
    const before = previousResources.get(uri);
    if (!before) { push('resource_added', 'resource', uri, null, resource.fingerprint); continue; }
    if (before.fingerprint !== resource.fingerprint) {
      push('resource_changed', 'resource', uri, before.fingerprint, resource.fingerprint);
    }
  }
  for (const [uri, resource] of previousResources) {
    if (!currentResources.has(uri)) push('resource_removed', 'resource', uri, resource.fingerprint, null);
  }

  /* prompts */
  const previousPrompts = new Map(previous.prompts.map((p) => [p.name, p]));
  const currentPrompts = new Map(current.prompts.map((p) => [p.name, p]));
  for (const [name, prompt] of currentPrompts) {
    const before = previousPrompts.get(name);
    if (!before) { push('prompt_added', 'prompt', name, null, prompt.fingerprint); continue; }
    if (before.fingerprint !== prompt.fingerprint) {
      push('prompt_changed', 'prompt', name, before.fingerprint, prompt.fingerprint);
    }
  }
  for (const [name, prompt] of previousPrompts) {
    if (!currentPrompts.has(name)) push('prompt_removed', 'prompt', name, prompt.fingerprint, null);
  }

  const reapprovalRequiredFor = [
    ...new Set(changes.filter((change) => change.requiresReapproval).map((change) => change.target)),
  ].sort();

  return {
    previousSnapshotFingerprint: previous.fingerprint,
    currentSnapshotFingerprint: current.fingerprint,
    changed: changes.length > 0,
    changes,
    reapprovalRequiredFor,
  };
}
