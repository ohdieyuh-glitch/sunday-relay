/**
 * GET /relay-api/wonderland/julius/missions/{wljRunId}/result
 * GET /relay-api/wonderland/julius/missions/{wljRunId}/progress
 *
 * Loopback only, same guard as admission and status. The id is the shared
 * `wlj_` parser. A legacy `run:` id, a `preflight:` id, a malformed id, and
 * an unknown id are one 404.
 *
 * With no {@link JuliusMissionEvidenceReader} wired, both routes report the
 * admission status and nothing past it. `dispatched` is the furthest state
 * that status route can show. Neither route reports `completed` unless YUJI's
 * reader returns the completion evidence shape. A null read stays on that
 * ceiling. `phases: null` and `projectBrainRevision: null` are returned as
 * null on both routes: absent, not an empty list and not a substituted 0.
 * A reader `projectBrainRevision` of 0 is that integer and is rendered as 0.
 * A phase list is the three-slot projection, or null. An in-progress or
 * failed read does not gain a fabricated phase list. A dispatch record is
 * not completion. YUJI owns the reader; this route does not match workflow
 * runs.
 */

import { juliusMissionTraceId } from '../scripts/julius-mission-trace.mjs';
import { parseJuliusAdmissionRunId } from '../src/relay/integration/wonderland-admission/admission-run-id';
import {
  acceptJuliusMissionEvidence,
  type JuliusMissionCompletionEvidence,
  type JuliusMissionEvidenceReader,
  type JuliusMissionPhaseEvidence,
} from './julius-mission-evidence';
import {
  guardPassed,
  juliusLoopbackGuard,
  readAdmittedWonderlandStatus,
  wonderlandAdmissionPathname,
  wonderlandAdmissionRequestFrom,
  type WonderlandAdmissionRoutePorts,
  type WonderlandAdmissionRouteRequest,
} from './wonderland-admission-route';

const MISSION_READ = /^\/wonderland\/julius\/missions\/([^/]+)\/(result|progress)$/;

const STATUS_CEILING = new Set([
  'held',
  'reserved',
  'awaiting_operator',
  'ledger_unwritten',
  'interrupted',
  'failed',
  'dispatched',
  'dispatch_failed',
  'already_spent',
  'unknown',
]);

const NOT_FOUND = {
  status: 404,
  body: { error: { kind: 'not_found', message: 'Not found.' } },
} as const;

const err = (status: number, kind: string, message: string) => ({ status, body: { error: { kind, message } } });

export interface WonderlandMissionRead {
  readonly kind: 'result' | 'progress';
  readonly runId: string;
}

export function wonderlandMissionRead(path: string): WonderlandMissionRead | null {
  const pathname = wonderlandAdmissionPathname(path);
  const match = MISSION_READ.exec(pathname);
  if (match === null) return null;
  let runId = match[1] ?? '';
  try {
    runId = decodeURIComponent(runId);
  } catch {
    return { kind: match[2] === 'progress' ? 'progress' : 'result', runId };
  }
  return { kind: match[2] === 'progress' ? 'progress' : 'result', runId };
}

export function isWonderlandMissionReadRoute(path: string): boolean {
  return wonderlandMissionRead(path) !== null;
}

export function isWonderlandMissionResultRoute(path: string): boolean {
  return wonderlandMissionRead(path)?.kind === 'result';
}

export function isWonderlandMissionProgressRoute(path: string): boolean {
  return wonderlandMissionRead(path)?.kind === 'progress';
}

export function createWonderlandMissionReadBridge(
  ports: WonderlandAdmissionRoutePorts,
  evidenceReader?: JuliusMissionEvidenceReader,
): {
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
    matches: (path) => isWonderlandMissionReadRoute(path),
    handle: (request) => handleWonderlandMissionReadRoute(
      wonderlandAdmissionRequestFrom(request),
      ports,
      evidenceReader,
    ),
  };
}

export function handleWonderlandMissionReadRoute(
  request: WonderlandAdmissionRouteRequest,
  ports: WonderlandAdmissionRoutePorts,
  evidenceReader?: JuliusMissionEvidenceReader,
): Promise<{ status: number; body: unknown } | null> {
  const target = wonderlandMissionRead(request.path);
  if (target === null) return Promise.resolve(null);
  const guarded = juliusLoopbackGuard(request, ports);
  if (!guardPassed(guarded)) return Promise.resolve(guarded);
  if (request.method !== 'GET') {
    const which = target.kind === 'result' ? 'Result' : 'Progress';
    return Promise.resolve(err(405, 'method_not_allowed', `${which} is a GET.`));
  }
  const parsed = parseJuliusAdmissionRunId(target.runId);
  if (!parsed.ok || parsed.form !== 'wlj') return Promise.resolve(NOT_FOUND);
  return readAdmittedWonderlandStatus(request, ports, parsed.runId, guarded.native.playerId).then(async (status) => {
    if (status.status !== 200) return status;
    const admission = record(status.body);
    if (admission === null) return { status: 500, body: {} };
    // NO COMPLETION BEFORE DISPATCH. A run the operator never dispatched cannot have run, so
    // evidence (a completion, phases, a verdict) is read only once the admission row records
    // `dispatched`. Every other state keeps the status ceiling and a NOT_RUN verdict.
    const evidence = admission.state === 'dispatched'
      ? await readEvidence(evidenceReader, parsed.runId)
      : { completion: null, phases: null };
    const state = evidence.completion === null ? ceilingState(admission.state) : 'completed';
    // Null from the reader is the ceiling. A null phase list stays null.
    // A revision of 0 is kept; only a missing revision is null.
    const projectBrainRevision = evidence.completion === null ? null : evidence.completion.projectBrainRevision;
    const shared = {
      wljRunId: textOrNull(admission.wljRunId),
      serverRunId: textOrNull(admission.serverRunId),
      legacyRunId: textOrNull(admission.legacyRunId),
      traceId: juliusMissionTraceId(parsed.runId),
      state,
      updatedAt: textOrNull(admission.updatedAt),
      phases: evidence.phases,
      projectBrainRevision,
    };
    if (target.kind === 'progress') {
      return {
        status: 200,
        body: shared,
      };
    }
    const cause = textOrNull(admission.cause);
    return {
      status: 200,
      body: {
        ...shared,
        dispatchedAt: textOrNull(admission.dispatchedAt),
        ...(state === 'completed' || cause === null ? {} : { cause }),
        // Top level, for the client: only PASS is a verified completion.
        checkerVerdict: evidence.completion === null ? 'NOT_RUN' : evidence.completion.checkerVerdict,
        completion: evidence.completion,
      },
    };
  });
}

/**
 * No reader means no evidence. A reader that throws, or that returns a value
 * the evidence check refuses, also means no evidence: the route stays on the
 * status ceiling.
 */
async function readEvidence(
  reader: JuliusMissionEvidenceReader | undefined,
  wljRunId: string,
): Promise<{
  readonly completion: JuliusMissionCompletionEvidence | null;
  readonly phases: readonly JuliusMissionPhaseEvidence[] | null;
}> {
  if (reader === undefined) return { completion: null, phases: null };
  try {
    return acceptJuliusMissionEvidence(wljRunId, await reader.read(wljRunId));
  } catch {
    return { completion: null, phases: null };
  }
}

function ceilingState(state: unknown): string {
  return typeof state === 'string' && STATUS_CEILING.has(state) ? state : 'unknown';
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
