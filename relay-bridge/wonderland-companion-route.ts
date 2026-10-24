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
 * The same 200 adds `agents`, from the injected registry. An empty registry
 * is the normal case and yields an empty array. The provider id is not part
 * of this path. See docs/companion/universal-companion-contract-v0.2.md.
 *
 * Reconciliation with YUJI's #440 at e01a1df8
 * (relay-bridge/julius-companion-evidence.ts): that module is not imported.
 * The row fields and wire states below are the subset this GET serves.
 * #440's read view has no verified flag; this route adds `verified: false`
 * so a 200 cannot be read as a verified result. Join the two stores by
 * `wljRunId` when the in-process writer lands. Do not key this read on a
 * `run:` id.
 */

import { readFileSync } from 'node:fs';

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
  publishAgentDescriptor,
  type AgentDescriptor,
  type CompanionAgentSource,
} from './wonderland-companion-registry';

const COMPANION_PATH = /^\/wonderland\/julius\/missions\/([^/]+)\/companion$/;

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
  };
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
    matches: (path) => isWonderlandCompanionRoute(path),
    handle: (request) => handleWonderlandCompanionRoute(wonderlandAdmissionRequestFrom(request), ports),
  };
}

export function createMemoryCompanionResultStore(): CompanionResultStore & {
  record(row: CompanionResultRecord): boolean;
} {
  const rows = new Map<string, CompanionResultRecord>();
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
  };
}

/**
 * A JSON file on this machine. Missing file: no rows. A URL, a relative
 * path, a bad schema, or unreadable JSON closes the store. The route does
 * not write the file.
 */
export function createFileCompanionResultStore(storePath: string): CompanionResultStore {
  return {
    read(wljRunId) {
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
      const document = parsed as { schemaVersion?: unknown; results?: unknown };
      if (document.schemaVersion !== COMPANION_RESULT_SCHEMA_VERSION) throw new CompanionResultStoreClosedError();
      if (document.results === null || typeof document.results !== 'object' || Array.isArray(document.results)) {
        throw new CompanionResultStoreClosedError();
      }
      const raw = (document.results as Record<string, unknown>)[wljRunId];
      if (raw === undefined) return null;
      return validateCompanionResult(raw);
    },
  };
}

export function createCompanionResultStore(storePath: string | undefined): CompanionResultStore {
  const trimmed = (storePath ?? '').trim();
  if (trimmed === '') return createMemoryCompanionResultStore();
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
