/**
 * GET /relay-api/wonderland/julius/missions/{wljRunId}/companion
 *
 * Loopback only, through the same guard as the Wonderland status route.
 * The path id is parsed by scripts/julius-admission-run-id.mjs. A legacy
 * `run:` id, a probe such as `preflight:`, and any other malformed id are
 * the status route's uniform 404. A canonical `wlj_` id with no stored row
 * is that same 404.
 *
 * The route only reads a local store. It does not mount an ingest, and it
 * does not call out. A body that is not 200 has no result. A 200 hard-codes
 * `verified: false`. Nothing in the store can turn that into true.
 *
 * The same 200 adds `traceId`, derived from the admitted `wlj_` id by
 * `scripts/julius-mission-trace.mjs`. The route does not read a trace id
 * from the query, the body, or the row.
 *
 * The same 200 adds `agents`, from the injected registry. An empty registry
 * is the normal case and yields an empty array. The provider id is not part
 * of this path.
 *
 * POST /wonderland/companions/agents creates a slot. GET and DELETE
 * /wonderland/companions/agents/{agentId} read it and disconnect it. The
 * same loopback guard covers all three. A credential field in the create
 * body is refused and not stored. See
 * docs/companion/universal-companion-contract-v0.2.md.
 *
 * Reconciliation with YUJI's #440 at e01a1df8
 * (relay-bridge/julius-companion-evidence.ts): that module is not imported.
 * The row fields and wire states below are the subset this GET serves.
 * #440's read view has no verified flag; this route adds `verified: false`
 * so a 200 cannot be read as a verified result. Join the two stores by
 * `wljRunId` when the in-process writer lands. Do not key this read on a
 * `run:` id.
 */

import { randomUUID } from 'node:crypto';
import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync } from 'node:fs';
import { resolve } from 'node:path';

import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
import { parseJuliusAdmissionRunId } from '../src/relay/integration/wonderland-admission/admission-run-id';
import { isLocalStorePath } from '../src/relay/integration/wonderland-admission/admission-file';
import {
  juliusLoopbackGuard,
  wonderlandAdmissionPathname,
  wonderlandAdmissionRequestFrom,
  type WonderlandAdmissionRoutePorts,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';
import {
  isCompanionAgentId,
  publishAgentDescriptor,
  type AgentDescriptor,
  type CompanionAdapterRegistry,
  type CompanionAgentRecord,
  type CompanionAgentSource,
  type CompanionAgentStore,
} from './wonderland-companion-registry';

const COMPANION_PATH = /^\/wonderland\/julius\/missions\/([^/]+)\/companion$/;
const COMPANION_AGENTS_PATH = '/wonderland/companions/agents';
const COMPANION_AGENT_PATH = /^\/wonderland\/companions\/agents\/([^/]+)$/;
const CREDENTIAL_KEY = /^(apikey|token|password)$/i;
const DISPLAY_NAME_MAX = 200;
const PROVIDER_ID_MAX = 200;

export const COMPANION_RESULT_SCHEMA_VERSION = 1 as const;

/** Wire states copied from #440's COMPANION_WIRE_STATES. Not imported. */
export const COMPANION_WIRE_STATES = [
  'none',
  'invited',
  'delivered',
  'delivery_failed',
  'result_received',
  'integrated',
  'rejected',
  'timed_out',
  'no_result',
  'cancelled',
] as const;

export type CompanionWireState = (typeof COMPANION_WIRE_STATES)[number];

export const COMPANION_ARTIFACT_KINDS = ['text', 'patch', 'json'] as const;
export type CompanionArtifactKind = (typeof COMPANION_ARTIFACT_KINDS)[number];

const RESULT_STATES: ReadonlySet<CompanionWireState> = new Set(['result_received', 'integrated', 'rejected']);
const CMP_TASK_ID = /^cmp_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const SUMMARY_MAX_BYTES = 4096;

const NOT_FOUND = {
  status: 404,
  body: { error: { kind: 'not_found', message: 'Not found.' } },
} as const;

const err = (status: number, kind: string, message: string) => ({ status, body: { error: { kind, message } } });

export class CompanionResultStoreClosedError extends Error {
  constructor() {
    super('companion_store_closed');
    this.name = 'CompanionResultStoreClosedError';
  }
}

export function isCompanionResultStoreClosed(error: unknown): error is CompanionResultStoreClosedError {
  return error instanceof CompanionResultStoreClosedError;
}

/** At most this many agent slots per companion store. A new slot past it is refused. */
export const COMPANION_AGENT_SLOT_MAX = 32;

export class CompanionAgentSlotsFullError extends Error {
  constructor() {
    super('companion_agent_slots_full');
    this.name = 'CompanionAgentSlotsFullError';
  }
}

/** How long a companion writer waits for `<store>.lock` before the store is closed. */
const COMPANION_LOCK_WAIT_MS = 2_000;

export interface CompanionResultProvenance {
  readonly source: 'companion_port' | 'simulated';
  readonly wakeId: string | null;
  readonly bodyDigest: string | null;
  readonly contentSha256: string;
}

/**
 * One local row, keyed by `wljRunId`. There is no verified field. A writer
 * that puts one on the object is ignored by the route.
 */
export interface CompanionResultRecord {
  readonly wljRunId: string;
  readonly legacyRunId: string | null;
  readonly taskId: string | null;
  readonly state: CompanionWireState;
  readonly summary: string | null;
  readonly contentSha256: string | null;
  readonly artifactKind: CompanionArtifactKind | null;
  readonly byteLength: number | null;
  readonly provenance: CompanionResultProvenance | null;
  readonly updatedAt: string;
}

export interface CompanionResultStore {
  read(wljRunId: string): CompanionResultRecord | null;
}

export interface WonderlandCompanionRoutePorts extends WonderlandAdmissionRoutePorts {
  readonly companionResults: CompanionResultStore;
  /** Absent or empty: the route still answers. No adapter is required. */
  readonly companionAgents?: CompanionAgentSource;
}

export function isWonderlandCompanionRoute(path: string): boolean {
  return companionRunId(path) !== null;
}

export function isWonderlandCompanionAgentRoute(path: string): boolean {
  const pathname = wonderlandAdmissionPathname(path);
  return pathname === COMPANION_AGENTS_PATH || COMPANION_AGENT_PATH.test(pathname);
}

export function companionRunId(path: string): string | null {
  const match = COMPANION_PATH.exec(wonderlandAdmissionPathname(path));
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1] ?? '');
  } catch {
    return null;
  }
}

function guardPassed(
  result: { readonly native: unknown } | { readonly status: number; readonly body: unknown },
): result is { readonly native: unknown } {
  return 'native' in result;
}

export function handleWonderlandCompanionRoute(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandCompanionRoutePorts,
): Promise<{ status: number; body: unknown } | null> {
  if (!isWonderlandCompanionRoute(request.path)) return Promise.resolve(null);
  const guarded = juliusLoopbackGuard(request, ports);
  if (!guardPassed(guarded)) return Promise.resolve(guarded);
  if (request.method !== 'GET') return Promise.resolve(err(405, 'method_not_allowed', 'Companion status is a GET.'));
  const runId = companionRunId(request.path);
  const parsed = parseJuliusAdmissionRunId(runId);
  if (!parsed.ok || parsed.form !== 'wlj') return Promise.resolve(NOT_FOUND);
  let row: CompanionResultRecord | null;
  try {
    row = ports.companionResults.read(parsed.runId);
  } catch (error) {
    if (isCompanionResultStoreClosed(error)) {
      return Promise.resolve(err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.'));
    }
    return Promise.resolve({ status: 500, body: {} });
  }
  if (row === null || row.wljRunId !== parsed.runId) return Promise.resolve(NOT_FOUND);
  return Promise.resolve({ status: 200, body: companionBody(row, readAgents(ports, parsed.runId)) });
}

/**
 * Agents are read after the row is known. A thrown source becomes an empty
 * list, so one broken registry cannot turn this GET into a 5xx. The
 * registry itself isolates one adapter from the next.
 */
function readAgents(ports: WonderlandCompanionRoutePorts, wljRunId: string): readonly AgentDescriptor[] {
  if (ports.companionAgents === undefined) return [];
  try {
    const published: AgentDescriptor[] = [];
    for (const agent of ports.companionAgents.agentsFor(wljRunId)) {
      const descriptor = publishAgentDescriptor(agent);
      if (descriptor !== null) published.push(descriptor);
    }
    return published;
  } catch {
    return [];
  }
}

/**
 * `verified` is a literal. The row is not consulted for it.
 * `traceId` is derived from `row.wljRunId`. A `traceId` property on the row
 * is not read.
 */
export function companionBody(row: CompanionResultRecord, agents: readonly AgentDescriptor[] = []): {
  readonly wljRunId: string;
  readonly legacyRunId: string | null;
  readonly taskId: string | null;
  readonly companion: { readonly state: CompanionWireState };
  readonly result: null | {
    readonly untrusted: true;
    readonly summary: string;
    readonly artifact: { readonly kind: CompanionArtifactKind; readonly sha256: string; readonly byteLength: number };
  };
  readonly provenance: CompanionResultProvenance | null;
  readonly updatedAt: string;
  readonly agents: readonly AgentDescriptor[];
  readonly verified: false;
  readonly traceId: string | null;
} {
  const showResult = RESULT_STATES.has(row.state)
    && row.summary !== null
    && row.contentSha256 !== null
    && row.artifactKind !== null
    && row.byteLength !== null;
  return {
    wljRunId: row.wljRunId,
    legacyRunId: row.legacyRunId,
    taskId: row.taskId,
    companion: { state: row.state },
    result: showResult ? {
      untrusted: true,
      summary: row.summary as string,
      artifact: {
        kind: row.artifactKind as CompanionArtifactKind,
        sha256: row.contentSha256 as string,
        byteLength: row.byteLength as number,
      },
    } : null,
    provenance: showResult ? row.provenance : null,
    updatedAt: row.updatedAt,
    agents,
    verified: false,
    traceId: juliusMissionTraceId(row.wljRunId),
  };
}

export function handleWonderlandCompanionAgentRoute(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandCompanionRoutePorts,
): Promise<{ status: number; body: unknown } | null> {
  if (!isWonderlandCompanionAgentRoute(request.path)) return Promise.resolve(null);
  const guarded = juliusLoopbackGuard(request, ports);
  if (!guardPassed(guarded)) return Promise.resolve(guarded);
  const pathname = wonderlandAdmissionPathname(request.path);
  if (pathname === COMPANION_AGENTS_PATH) return Promise.resolve(createCompanionAgent(request, ports));
  const match = COMPANION_AGENT_PATH.exec(pathname);
  let agentId = '';
  try {
    agentId = decodeURIComponent(match?.[1] ?? '');
  } catch {
    return Promise.resolve(NOT_FOUND);
  }
  if (!isCompanionAgentId(agentId)) return Promise.resolve(NOT_FOUND);
  if (request.method === 'GET') return Promise.resolve(readCompanionAgent(agentId, ports));
  if (request.method === 'DELETE') return Promise.resolve(disconnectCompanionAgent(agentId, ports));
  return Promise.resolve(err(405, 'method_not_allowed', 'An agent slot is read with GET and disconnected with DELETE.'));
}

function createCompanionAgent(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandCompanionRoutePorts,
): { status: number; body: unknown } {
  if (request.method !== 'POST') {
    return err(405, 'method_not_allowed', 'An agent slot is created with POST.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.rawBody ?? '');
  } catch {
    return err(400, 'companion_request_invalid', 'Companion agent requests need a JSON object.');
  }
  if (containsCredentialField(parsed)) {
    return err(400, 'companion_credentials_rejected', 'Provider credentials are not accepted on this route.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return err(400, 'companion_request_invalid', 'Companion agent requests need a JSON object.');
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.providerId !== 'string' || body.providerId.trim() === '' || body.providerId.length > PROVIDER_ID_MAX) {
    return err(400, 'companion_request_invalid', 'Companion agent requests need a providerId string.');
  }
  let displayName: string | null = null;
  if (body.displayName !== undefined && body.displayName !== null) {
    if (typeof body.displayName !== 'string' || body.displayName.length > DISPLAY_NAME_MAX) {
      return err(400, 'companion_request_invalid', 'displayName must be a short string.');
    }
    displayName = body.displayName.trim() === '' ? null : body.displayName;
  }
  let wljRunId: string | null = null;
  if (body.wljRunId !== undefined && body.wljRunId !== null) {
    const run = parseJuliusAdmissionRunId(body.wljRunId);
    if (!run.ok || run.form !== 'wlj') {
      return err(400, 'julius_dispatch_run_invalid', 'wljRunId must be a wlj_ id.');
    }
    wljRunId = run.runId;
  }
  const directory = agentDirectory(ports);
  if (directory === null) {
    return err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.');
  }
  try {
    const descriptor = directory.attach({ providerId: body.providerId, wljRunId, displayName });
    return { status: 201, body: descriptor };
  } catch (error) {
    return agentStoreFailure(error);
  }
}

function readCompanionAgent(agentId: string, ports: WonderlandCompanionRoutePorts): { status: number; body: unknown } {
  const directory = agentDirectory(ports);
  if (directory === null) {
    return err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.');
  }
  try {
    const descriptor = directory.get(agentId);
    if (descriptor === null) return NOT_FOUND;
    return { status: 200, body: descriptor };
  } catch (error) {
    return agentStoreFailure(error);
  }
}

function disconnectCompanionAgent(agentId: string, ports: WonderlandCompanionRoutePorts): { status: number; body: unknown } {
  const directory = agentDirectory(ports);
  if (directory === null) {
    return err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.');
  }
  try {
    const descriptor = directory.disconnect(agentId);
    if (descriptor === null) return NOT_FOUND;
    return { status: 200, body: descriptor };
  } catch (error) {
    return agentStoreFailure(error);
  }
}

function agentDirectory(ports: WonderlandCompanionRoutePorts): CompanionAdapterRegistry | null {
  const source = ports.companionAgents;
  if (source === undefined) return null;
  if (!('attach' in source) || !('get' in source) || !('disconnect' in source)) return null;
  return source as CompanionAdapterRegistry;
}

function agentStoreFailure(error: unknown): { status: number; body: unknown } {
  if (error instanceof CompanionAgentSlotsFullError) {
    return err(409, 'companion_agent_slots_full', `At most ${COMPANION_AGENT_SLOT_MAX} agent slots are kept. Nothing was created.`);
  }
  if (isCompanionResultStoreClosed(error)) {
    return err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.');
  }
  return err(503, 'julius_dispatch_unavailable', 'Wonderland admission store is not available. Nothing was reserved.');
}

function containsCredentialField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => containsCredentialField(item));
  if (value === null || typeof value !== 'object') return false;
  for (const [key, child] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) return true;
    if (containsCredentialField(child)) return true;
  }
  return false;
}

export function createWonderlandCompanionBridge(ports: WonderlandCompanionRoutePorts): {
  matches(path: string): boolean;
  handle(request: {
    readonly method: string;
    readonly path: string;
    readonly url?: string | undefined;
    readonly authorization?: string | undefined;
    readonly origin?: string | undefined;
    readonly body?: string | undefined;
    readonly idempotencyKey?: string | undefined;
    readonly remoteAddress?: string | undefined;
    readonly host?: string | undefined;
    readonly forwarded?: boolean | undefined;
    readonly nowIso?: string | undefined;
    readonly nowMs?: number | undefined;
  }): Promise<{ status: number; body: unknown } | null>;
} {
  return {
    matches: (path) => isWonderlandCompanionRoute(path) || isWonderlandCompanionAgentRoute(path),
    handle: (request) => {
      const mapped = wonderlandAdmissionRequestFrom(request);
      if (isWonderlandCompanionAgentRoute(request.path)) return handleWonderlandCompanionAgentRoute(mapped, ports);
      return handleWonderlandCompanionRoute(mapped, ports);
    },
  };
}

export interface CompanionLocalStore extends CompanionResultStore, CompanionAgentStore {
  record?(row: CompanionResultRecord): boolean;
}

export function createMemoryCompanionResultStore(): CompanionLocalStore & {
  record(row: CompanionResultRecord): boolean;
} {
  const rows = new Map<string, CompanionResultRecord>();
  const agents = new Map<string, CompanionAgentRecord>();
  return {
    record(row) {
      const stored = validateCompanionResult(row);
      if (stored === null) return false;
      rows.set(stored.wljRunId, stored);
      return true;
    },
    read(wljRunId) {
      return rows.get(wljRunId) ?? null;
    },
    putAgent(record) {
      if (!agents.has(record.agentId) && agents.size >= COMPANION_AGENT_SLOT_MAX) throw new CompanionAgentSlotsFullError();
      agents.set(record.agentId, record);
    },
    readAgent(agentId) {
      return agents.get(agentId) ?? null;
    },
    listAgents() {
      return [...agents.values()];
    },
  };
}

/**
 * A JSON file on this machine. Missing file: no rows. A URL, a relative
 * path, a bad schema, or unreadable JSON closes the store. Result rows and
 * agent slots share this document. The route does not call out to write it.
 */
export function createFileCompanionResultStore(storePath: string): CompanionLocalStore {
  return {
    read(wljRunId) {
      const document = loadCompanionDocument(storePath);
      if (document === null) return null;
      const raw = document.results[wljRunId];
      if (raw === undefined) return null;
      return validateCompanionResult(raw);
    },
    putAgent(record) {
      // One read-modify-write under `<store>.lock`, so two writers never
      // interleave and a slot written by one is not lost by the other.
      withCompanionLock(storePath, () => {
        const document = loadCompanionDocument(storePath) ?? emptyCompanionDocument();
        if (!Object.hasOwn(document.agents, record.agentId) && Object.keys(document.agents).length >= COMPANION_AGENT_SLOT_MAX) {
          throw new CompanionAgentSlotsFullError();
        }
        document.agents[record.agentId] = record;
        saveCompanionDocument(storePath, document);
      });
    },
    readAgent(agentId) {
      const document = loadCompanionDocument(storePath);
      if (document === null) return null;
      return document.agents[agentId] ?? null;
    },
    listAgents() {
      const document = loadCompanionDocument(storePath);
      if (document === null) return [];
      return Object.values(document.agents);
    },
  };
}

interface CompanionDocument {
  schemaVersion: typeof COMPANION_RESULT_SCHEMA_VERSION;
  results: Record<string, unknown>;
  agents: Record<string, CompanionAgentRecord>;
}

function emptyCompanionDocument(): CompanionDocument {
  return { schemaVersion: COMPANION_RESULT_SCHEMA_VERSION, results: {}, agents: {} };
}

function loadCompanionDocument(storePath: string): CompanionDocument | null {
  if (!isLocalStorePath(storePath)) throw new CompanionResultStoreClosedError();
  let text: string;
  try {
    text = readFileSync(storePath, 'utf8');
  } catch (error) {
    const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'ENOENT') return null;
    throw new CompanionResultStoreClosedError();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new CompanionResultStoreClosedError();
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CompanionResultStoreClosedError();
  const document = parsed as { schemaVersion?: unknown; results?: unknown; agents?: unknown };
  if (document.schemaVersion !== COMPANION_RESULT_SCHEMA_VERSION) throw new CompanionResultStoreClosedError();
  if (document.results === null || typeof document.results !== 'object' || Array.isArray(document.results)) {
    throw new CompanionResultStoreClosedError();
  }
  if (document.agents !== undefined && (document.agents === null || typeof document.agents !== 'object' || Array.isArray(document.agents))) {
    throw new CompanionResultStoreClosedError();
  }
  const agents: Record<string, CompanionAgentRecord> = {};
  for (const value of Object.values(document.agents ?? {})) {
    const record = validateStoredAgent(value);
    if (record !== null) agents[record.agentId] = record;
  }
  return { schemaVersion: COMPANION_RESULT_SCHEMA_VERSION, results: document.results as Record<string, unknown>, agents };
}

const lockSleeper = new Int32Array(new SharedArrayBuffer(4));

/**
 * Create `<store>.lock` exclusively, run `job`, delete it. A held lock is
 * retried for COMPANION_LOCK_WAIT_MS and then closes the store. It is never
 * stolen, whatever pid it names.
 */
function withCompanionLock<T>(storePath: string, job: () => T): T {
  if (!isLocalStorePath(storePath)) throw new CompanionResultStoreClosedError();
  const lockPath = `${storePath}.lock`;
  const deadline = Date.now() + COMPANION_LOCK_WAIT_MS;
  let fd: number;
  for (;;) {
    try {
      fd = openSync(lockPath, 'wx', 0o600);
      break;
    } catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : '';
      const left = deadline - Date.now();
      if (code !== 'EEXIST' || left <= 0) throw new CompanionResultStoreClosedError();
      Atomics.wait(lockSleeper, 0, 0, Math.min(25, left));
    }
  }
  try {
    writeSync(fd, JSON.stringify({ pid: process.pid, purpose: 'wonderland-companion' }), null, 'utf8');
    fsyncSync(fd);
  } catch {
    try { closeSync(fd); } catch { /* closing */ }
    try { unlinkSync(lockPath); } catch { /* lock may be absent */ }
    throw new CompanionResultStoreClosedError();
  }
  closeSync(fd);
  try {
    return job();
  } finally {
    try { unlinkSync(lockPath); } catch { /* already released */ }
  }
}

/** Temp file in the same directory, fsync, rename onto the store. */
function saveCompanionDocument(storePath: string, document: CompanionDocument): void {
  if (!isLocalStorePath(storePath)) throw new CompanionResultStoreClosedError();
  const temporary = `${storePath}.${randomUUID()}.tmp`;
  try {
    const fd = openSync(temporary, 'wx', 0o600);
    try {
      writeSync(fd, `${JSON.stringify(document)}\n`, null, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, storePath);
  } catch {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may not exist. The store is still closed.
    }
    throw new CompanionResultStoreClosedError();
  }
}

function validateStoredAgent(value: unknown): CompanionAgentRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.agentId !== 'string' || !isCompanionAgentId(row.agentId)) return null;
  if (typeof row.providerId !== 'string') return null;
  let wljRunId: string | null = null;
  if (row.wljRunId !== null && row.wljRunId !== undefined) {
    const parsed = parseJuliusAdmissionRunId(row.wljRunId);
    if (!parsed.ok || parsed.form !== 'wlj') return null;
    wljRunId = parsed.runId;
  }
  if (row.requestedDisplayName !== null && row.requestedDisplayName !== undefined && typeof row.requestedDisplayName !== 'string') {
    return null;
  }
  if (typeof row.disconnected !== 'boolean') return null;
  return {
    agentId: row.agentId,
    providerId: row.providerId,
    wljRunId,
    requestedDisplayName: typeof row.requestedDisplayName === 'string' ? row.requestedDisplayName : null,
    disconnected: row.disconnected,
  };
}

/**
 * The companion file must not be the admission store or any file the
 * admission store owns (its operator journal and its locks). A collision is a
 * closed store: every read and write fails, and nothing is written there.
 */
export function companionStoreCollides(companionPath: string, admissionStorePath: string | undefined): boolean {
  const admission = (admissionStorePath ?? '').trim();
  if (admission === '') return false;
  const key = (value: string): string => {
    const resolved = resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const companion = key(companionPath);
  const base = resolve(admission);
  return [base, `${base}.operator.json`, `${base}.lock`, `${base}.bridge`, `${base}.bridge.lock`].some((owned) => key(owned) === companion);
}

function closedCompanionStore(): CompanionLocalStore {
  const closed = (): never => { throw new CompanionResultStoreClosedError(); };
  return { read: closed, putAgent: closed, readAgent: closed, listAgents: closed };
}

export function createCompanionResultStore(storePath: string | undefined, admissionStorePath?: string): CompanionLocalStore {
  const trimmed = (storePath ?? '').trim();
  if (trimmed === '') return createMemoryCompanionResultStore();
  if (companionStoreCollides(trimmed, admissionStorePath)) return closedCompanionStore();
  return createFileCompanionResultStore(trimmed);
}

export function validateCompanionResult(value: unknown): CompanionResultRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const parsed = parseJuliusAdmissionRunId(row.wljRunId);
  if (!parsed.ok || parsed.form !== 'wlj') return null;
  if (row.legacyRunId !== null) {
    const legacy = parseJuliusAdmissionRunId(row.legacyRunId);
    if (!legacy.ok || legacy.form !== 'legacy') return null;
  }
  if (row.taskId !== null && (typeof row.taskId !== 'string' || !CMP_TASK_ID.test(row.taskId))) return null;
  if (typeof row.state !== 'string' || !COMPANION_WIRE_STATES.includes(row.state as CompanionWireState)) return null;
  if (row.summary !== null && typeof row.summary !== 'string') return null;
  if (typeof row.summary === 'string' && Buffer.byteLength(row.summary, 'utf8') > SUMMARY_MAX_BYTES) return null;
  if (row.contentSha256 !== null && (typeof row.contentSha256 !== 'string' || !SHA256_HEX.test(row.contentSha256))) return null;
  if (row.artifactKind !== null && (typeof row.artifactKind !== 'string' || !COMPANION_ARTIFACT_KINDS.includes(row.artifactKind as CompanionArtifactKind))) {
    return null;
  }
  if (row.byteLength !== null && (typeof row.byteLength !== 'number' || !Number.isSafeInteger(row.byteLength) || row.byteLength < 0)) {
    return null;
  }
  if (typeof row.updatedAt !== 'string' || !UTC_ISO.test(row.updatedAt)) return null;
  const provenance = provenanceOf(row.provenance, typeof row.contentSha256 === 'string' ? row.contentSha256 : null);
  if (provenance === undefined) return null;
  return {
    wljRunId: parsed.runId,
    legacyRunId: row.legacyRunId === null ? null : row.legacyRunId as string,
    taskId: row.taskId === null ? null : row.taskId as string,
    state: row.state as CompanionWireState,
    summary: row.summary === null ? null : row.summary,
    contentSha256: row.contentSha256 === null ? null : row.contentSha256 as string,
    artifactKind: row.artifactKind === null ? null : row.artifactKind as CompanionArtifactKind,
    byteLength: row.byteLength === null ? null : row.byteLength,
    provenance,
    updatedAt: row.updatedAt,
  };
}

function provenanceOf(value: unknown, contentSha256: string | null): CompanionResultProvenance | null | undefined {
  if (value === null) return null;
  if (value === undefined || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const provenance = value as Record<string, unknown>;
  if (provenance.source !== 'companion_port' && provenance.source !== 'simulated') return undefined;
  if (provenance.wakeId !== null && typeof provenance.wakeId !== 'string') return undefined;
  if (provenance.bodyDigest !== null && (typeof provenance.bodyDigest !== 'string' || !SHA256_HEX.test(provenance.bodyDigest))) {
    return undefined;
  }
  if (typeof provenance.contentSha256 !== 'string' || !SHA256_HEX.test(provenance.contentSha256)) return undefined;
  if (contentSha256 !== null && provenance.contentSha256 !== contentSha256) return undefined;
  if ('verifiedBy' in provenance || 'verified' in provenance) return undefined;
  return {
    source: provenance.source,
    wakeId: provenance.wakeId === null ? null : provenance.wakeId as string,
    bodyDigest: provenance.bodyDigest === null ? null : provenance.bodyDigest as string,
    contentSha256: provenance.contentSha256,
  };
}
