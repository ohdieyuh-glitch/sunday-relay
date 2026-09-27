import type { Pool } from 'pg';

import {
  JuliusRuntimeApi,
  type JuliusApiIdentity,
  type JuliusApiResult,
} from '../src/relay/mission/julius';
// BY MODULE PATH, NOT THROUGH THE BARREL. The persistence barrel re-exports
// every store Relay has; importing it here would make this read surface a
// dependant of all of them, and the harness manifest would be right to object.
import { JuliusLifecyclePostgresRepository } from '../src/relay/persistence/julius-lifecycle-postgres';
import { JuliusSubagentPostgresRepository } from '../src/relay/persistence/julius-subagent-postgres';
import { createJuliusPostgresRuntimeStore } from './julius/postgres-store';

/**
 * JULIUS'S DURABLE STATE, REACHABLE OVER HTTP, FOR WONDERLAND TO DRAW.
 *
 * THE GAP THIS CLOSES. `JuliusRuntimeApi` is the one surface anything outside the
 * runtime may read, and nothing mounted it: no route, no CLI action, only its own
 * tests. So a client had two options — invent per-role state from task names, or
 * re-derive the runtime's conclusions in UI code — and both make the UI a second
 * authority on Julius, which is exactly what must not happen.
 *
 * AND THE REAL REASON IT WAS NOT MOUNTED was not a credential question.
 * `relay-bridge/server.ts` has no database: no pool, no `DATABASE_URL`, no `pg`.
 * The only process holding durable Julius state was the mission job. This gives
 * the bridge a READ connection to the same store the job writes, so there is
 * still exactly ONE state authority — Julius's own durable rows, read through
 * Julius's own API.
 *
 * WHAT IT DELIBERATELY IS NOT:
 *
 *   - **Not a second authority.** Every answer is `JuliusRuntimeApi`'s, verbatim.
 *     This module maps a path to a method and a refusal to a status code. It
 *     computes nothing about a mission, and a projection it disagreed with would
 *     be impossible rather than merely wrong.
 *   - **Not a control surface.** Reads only. Pause, resume, cancel and approval
 *     decisions exist on the API and are not mounted here: they change a run, and
 *     a run is changed by the process that owns it. `approvers` therefore refuses
 *     every approval, which is the honest wiring for a read-only mount rather
 *     than a stub that would answer yes if anything ever called it.
 *   - **Not a database the bridge assumes it has.** With no `DATABASE_URL` the
 *     family answers 503 and says which variable is missing. It never answers an
 *     empty run, because "no durable state is reachable from this process" and
 *     "this run has nothing in it" are different facts and a client that confused
 *     them would tell a founder their mission had done nothing.
 */

/**
 * THE SHAPE THE SERVER SENDS. Structurally the same as every other route family's
 * result, and deliberately NOT imported from one of them: a type import is still a
 * dependency edge, and this read surface must not become a dependant of the
 * reviewer routes and the harness catalogue behind them.
 */
export interface JuliusStateRouteResult {
  readonly status: number;
  readonly body: unknown;
}

const ok = (data: unknown): JuliusStateRouteResult => ({ status: 200, body: { data } });
const err = (status: number, kind: string, message: string): JuliusStateRouteResult =>
  ({ status, body: { error: { kind, message } } });

/** `/julius/...`, with `/relay-api` already stripped. */
export function isJuliusStateRoute(path: string): boolean {
  return path === '/julius' || path.startsWith('/julius/');
}

/**
 * HOW A REFUSAL BECOMES A STATUS CODE.
 *
 * The API's refusals are values with reason codes, and they mean different things
 * to a client: an unauthorized read is the caller's problem, a missing run is the
 * request's, and a project mismatch is deliberately NOT distinguished from a
 * missing run — telling a caller "that run exists but is not yours" is how a
 * client enumerates other tenants' run ids.
 */
const REFUSAL_STATUS: Readonly<Record<string, number>> = {
  scope_missing: 403,
  run_not_found: 404,
  project_mismatch: 404,
};

const answer = <T>(result: JuliusApiResult<T>): JuliusStateRouteResult => {
  if (result.ok) return ok(result.value);
  return err(REFUSAL_STATUS[result.reason] ?? 400, result.reason, result.safeMessage);
};

export interface JuliusStateRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  /** True only for a verified OPERATOR credential. Nothing else may read here yet. */
  readonly operator: boolean;
  /** The project the read is scoped to. Never taken from the path. */
  readonly projectId: string | undefined;
  readonly tenantId: string | undefined;
}

/**
 * THE DEPENDENCY THIS FAMILY NEEDS, AND THE ONE IT REFUSES WITHOUT.
 *
 * `api` is null when the process has no database. The family then answers 503
 * with the missing variable named — the same fail-closed shape the rest of the
 * bridge uses for an unconfigured capability, and never an empty success.
 */
export interface JuliusStateRoutePorts {
  readonly api: JuliusRuntimeApi | null;
  /** Named so the refusal can say what to set. */
  readonly missingConfig: readonly string[];
}

/** `/julius/runs/<runId>/<view>` — the only shape this family serves. */
const RUN_VIEW = /^\/julius\/runs\/([A-Za-z0-9:_-]{1,128})\/([a-z]+)$/u;

/** Every segment decoded, or null when one is not a valid percent-encoding. */
const decodePathSegments = (path: string): string | null => {
  try {
    return path.split('/').map((segment) => decodeURIComponent(segment)).join('/');
  } catch {
    return null;
  }
};

export async function handleJuliusStateRoute(
  request: JuliusStateRouteRequest,
  ports: JuliusStateRoutePorts,
): Promise<JuliusStateRouteResult | null> {
  if (!isJuliusStateRoute(request.path)) return null;
  if (request.method !== 'GET') return err(405, 'method_not_allowed', 'Julius state is read-only.');

  // OPERATOR ONLY, FOR NOW. A browser session may eventually read a mission's
  // state, and which fields it may see — `providerId` among them — is a product
  // decision. Until it is made, the credential that already governs everything
  // that spends money governs this too.
  if (!request.operator) {
    return err(401, 'operator_required', 'Reading Julius state requires operator authentication.');
  }
  if (ports.api === null) {
    return err(503, 'julius_state_unavailable',
      `No durable Julius state is reachable from this process: ${ports.missingConfig.join(', ')} is not set. `
      + 'This is not an empty mission — nothing was read.');
  }
  if (request.projectId === undefined || request.tenantId === undefined) {
    return err(400, 'project_required', 'A Julius state read names its tenant and project.');
  }

  /**
   * A CLIENT MAY PERCENT-ENCODE THE COLON. Run ids carry one (`run:abc…`);
   * RFC 3986 allows it raw in a path segment, and a standards-correct client —
   * Unreal's UrlEncode among them — encodes it anyway. Matching the raw path
   * turned that client's read into `unknown_julius_route`, which named the
   * wrong failure: the shape was fine, the id was encoded. So each segment is
   * decoded first, and a segment that does not decode is a run that cannot be
   * named — `run_not_found` — never a route that does not exist. Found by the
   * Wonderland integration lane's first end-to-end run against the built bridge.
   */
  const decoded = decodePathSegments(request.path);
  if (decoded === null) {
    return err(404, 'run_not_found', 'The run id in the path is not a valid percent-encoding.');
  }
  const match = RUN_VIEW.exec(decoded);
  if (match === null) {
    return err(404, 'unknown_julius_route',
      'Julius state serves /julius/runs/<runId>/<run|slots|tasks|evidence|verification|result|timeline>.');
  }
  const [, runId, view] = match as unknown as [string, string, string];
  const identity: JuliusApiIdentity = {
    tenantId: request.tenantId, projectId: request.projectId,
    actorId: 'operator', scopes: ['run:read'],
  };

  switch (view) {
    case 'run': return answer(await ports.api.inspectRun(identity, runId));
    // THE VIEW WONDERLAND EXISTS FOR: the three C.A.R.D. peers, their provider
    // identity, their requested and served models, and a cost that says whether
    // it is a floor.
    case 'slots': return answer(await ports.api.inspectSlots(identity, runId));
    case 'tasks': return answer(await ports.api.inspectTasks(identity, runId));
    case 'evidence': return answer(await ports.api.inspectEvidence(identity, runId));
    case 'verification': return answer(await ports.api.inspectVerification(identity, runId));
    /**
     * THE ONE A USER ASKS FOR. `evidence` and `verification` are the raw record;
     * this is the answer a surface can show without assembling six reads and
     * risking its own completion rule. See `JuliusMissionResultView`.
     */
    case 'result': return answer(await ports.api.inspectResult(identity, runId));
    case 'timeline': return answer(await ports.api.timeline(identity, runId, 0, 200));
    default:
      return err(404, 'unknown_julius_view',
        `Julius state has no view "${view}". Served: run, slots, tasks, evidence, verification, result, timeline.`);
  }
}

/**
 * THE READ-ONLY COMPOSITION, built from the SAME repositories the mission job
 * writes through.
 *
 * `createJuliusPostgresRuntimeStore` already returns the store and the timeline
 * reader. The subagent and lifecycle repositories existed with no composition
 * root at all — declared in the harness manifest as reached from nowhere — and
 * this is the root they were waiting for, so the API is whole rather than an
 * object with three holes in it.
 *
 * `approvers` REFUSES EVERY APPROVAL. Nothing here mounts an approval decision,
 * and an authority that answered yes would be a permission granted by a surface
 * that never asked for one.
 */
export function createJuliusStatePorts(input: {
  readonly pool: Pool | null;
  readonly missingConfig: readonly string[];
  /** Overridable for a proof; production uses `composeJuliusStateApi`. */
  readonly compose?: (pool: Pool) => JuliusRuntimeApi;
}): JuliusStateRoutePorts {
  if (input.pool === null) return { api: null, missingConfig: input.missingConfig };
  return { api: (input.compose ?? composeJuliusStateApi)(input.pool), missingConfig: [] };
}

/**
 * ONE OBJECT WITH EVERY PORT THE API NEEDS, from the three repositories that
 * implement them. Every method is bound to the instance that owns it, and the
 * TYPE CHECKER — not a hand-kept list — is what proves the union is satisfied:
 * a repository that stopped implementing a port fails here at compile time
 * rather than at the first request.
 */
export function composeJuliusStateApi(pool: Pool): JuliusRuntimeApi {
  const store = createJuliusPostgresRuntimeStore(pool);
  const subagents = new JuliusSubagentPostgresRepository(pool);
  const lifecycle = new JuliusLifecyclePostgresRepository(pool);
  return new JuliusRuntimeApi({
    store: { ...boundMethods(store), ...boundMethods(subagents), ...boundMethods(lifecycle) } as never,
    timeline: store,
    // Nothing here mounts an approval decision, and an authority that answered
    // yes would be a permission granted by a surface that never asked for one.
    approvers: { mayApprove: async () => false },
    clock: { now: () => new Date().toISOString() },
  });
}

/** Every callable on an object, including prototype methods, bound to it. */
function boundMethods(target: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let proto: object | null = target; proto !== null && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const key of Object.getOwnPropertyNames(proto)) {
      if (key === 'constructor' || key in out) continue;
      const value = (target as Record<string, unknown>)[key];
      if (typeof value === 'function') out[key] = value.bind(target);
    }
  }
  return out;
}
