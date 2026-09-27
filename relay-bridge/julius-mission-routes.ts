import type { Pool } from 'pg';

import type { JuliusBootstrapOutcome, JuliusBootstrapPort, JuliusBootstrapRequest } from '../src/relay/integration/julius/julius-port';
import { JuliusContractPostgresRepository } from '../src/relay/persistence/julius-contract-postgres';
import { JuliusPostgresRepository } from '../src/relay/persistence/julius-postgres';
import { createLiveJuliusBootstrapPort } from './julius/bootstrap';
import { CODER_WORKER, architectWorker, reviewerWorker } from './julius/live-composition';
import { compileBootstrapRequest, parseLiveMissionContract, type LiveMissionContractFile } from './julius/mission-contract';
import { createPostgresMissionSeedStore } from './julius/mission-seed';

/**
 * A MISSION, CREATED OVER HTTP — FOR WONDERLAND TO START WHAT IT CAN ALREADY WATCH.
 *
 * THE GAP. The state routes let a client OBSERVE a Julius mission. Nothing let one
 * CREATE a mission: creation was the mission job reading a contract file from
 * disk, so the only way to start Julius was a shell on the machine that holds the
 * job. "Wonderland must be capable of creating/observing Julius missions" was
 * half true.
 *
 * NOT THE JOB'S FILE. The parser and compiler come from `./julius/mission-contract`,
 * the library the job also uses — never from `julius-live-mission.ts` itself,
 * whose `require.main === module` entry guard is true inside the server's CJS
 * bundle and would run the job's `main` at server start.
 *
 * WHAT CREATION IS, AND IS NOT. It is the BOOTSTRAP: parse the contract, compile
 * the request, and submit it through `createLiveJuliusBootstrapPort` — the SAME
 * three steps, the same parser, the same compiler and the same port the mission
 * job uses, over the same PostgreSQL repositories. The run lands durable in
 * READY with its plan and build tasks, its task contract as revision 1 DRAFT, its
 * criteria and its seed brain, and the state routes can watch it from that
 * moment. It is NOT dispatch: nothing here composes a provider, spends money or
 * ticks the loop. Driving the run stays the job's, because the job is the process
 * that holds the credentials and the executor. Creation is provider-free by
 * construction, which is also why it can be proven here without one.
 *
 * ONE DEFINITION OF A MISSION. The body is the contract file's own shape,
 * validated by the contract file's own parser, so a mission created here and one
 * created from disk are the same mission — there is no second schema for
 * Wonderland to drift from.
 *
 * ONE DEFINITION OF WHO THE WORKERS ARE. The job builds its worker requests from
 * the workers it composed; this builds them from the same worker DEFINITIONS
 * (`architectWorker`, `CODER_WORKER`, `reviewerWorker`) without composing an
 * adapter. The reviewer's provider is read from the environment because it is
 * part of the mission's recorded identity — which independence group reviewed
 * it — and a creation that could not name it refuses rather than guessing.
 */

export interface JuliusMissionRouteResult {
  readonly status: number;
  readonly body: unknown;
}

const created = (data: unknown): JuliusMissionRouteResult => ({ status: 201, body: { data } });
const err = (status: number, kind: string, message: string): JuliusMissionRouteResult =>
  ({ status, body: { error: { kind, message } } });

/** `/julius/missions` — the one path this family serves. */
export function isJuliusMissionRoute(path: string): boolean {
  return path === '/julius/missions';
}

export interface JuliusMissionRouteRequest {
  readonly method: string;
  /** Path with `/relay-api` already stripped. */
  readonly path: string;
  /** True only for a verified OPERATOR credential. */
  readonly operator: boolean;
  /** The raw request body — a contract file, as JSON text. */
  readonly body: string | undefined;
  /**
   * `x-relay-julius-rerun: explicit` — a DELIBERATE second run of a mission
   * that already has a live one.
   *
   * A HEADER, NOT A BODY FIELD, for two reasons: the body is the contract file
   * and a rerun is not a property of the mission, and the contract parser
   * ignores keys it does not know — so a `rerun` in the body would be silently
   * dropped and the client would believe it had asked. Anything other than the
   * exact word is not an intent.
   */
  readonly rerun?: string | undefined;
}

/**
 * WHAT CREATION NEEDS, AND WHAT IT REFUSES WITHOUT.
 *
 * `bootstrap` is null when the process has no database: the family answers 503
 * naming the variable, never a run id for a run nowhere holds. `reviewerProvider`
 * is null when the environment does not say who reviews: the family refuses by
 * name, because a mission whose reviewer's independence group is unknown is a
 * mission whose independence cannot later be checked.
 */
export interface JuliusMissionRoutePorts {
  readonly bootstrap: ((executionId: string, tenantId: string) => JuliusBootstrapPort) | null;
  readonly missingConfig: readonly string[];
  readonly reviewerProvider: string | null;
  readonly cardRevision: string;
}

/** The three worker requests, from the same definitions the live composition dispatches. */
export function missionWorkerRequests(reviewerProvider: string): JuliusBootstrapRequest['workers'] {
  return [architectWorker({}), CODER_WORKER, reviewerWorker(reviewerProvider)].map((worker) => ({
    role: worker.role as JuliusBootstrapRequest['workers'][number]['role'],
    integrationId: worker.workerId,
    adapterId: worker.adapterId,
    independenceGroup: worker.providerId,
    requiredCapabilities: worker.capabilities,
  }));
}

/**
 * How a bootstrap refusal becomes a status: the port's own reason codes, quoted.
 * A contract the port refuses is the caller's to fix (400); anything the port
 * names that is not listed here is the run's state, not the request (409).
 */
const REFUSAL_STATUS: Readonly<Record<string, number>> = {
  malformed_mission_contract: 400,
  acceptance_criteria_missing: 400,
  blocking_acceptance_criterion_missing: 400,
  invalid_worker_configuration: 400,
  task_contract_not_derivable: 400,
  // The same identity was already used for a different mission: the run's.
  mission_already_running: 409,
  // The mission is already running something else. 409, and the message names
  // the run that holds it so a client can follow that runId.
  mission_run_already_active: 409,
  // The store was unreachable or refused: nothing durable exists, try again.
  bootstrap_persistence_failure: 503,
};

export async function handleJuliusMissionRoute(
  request: JuliusMissionRouteRequest,
  ports: JuliusMissionRoutePorts,
): Promise<JuliusMissionRouteResult | null> {
  if (!isJuliusMissionRoute(request.path)) return null;
  if (request.method !== 'POST') return err(405, 'method_not_allowed', 'A mission is created with POST.');
  if (!request.operator) {
    return err(401, 'operator_required', 'Creating a Julius mission requires operator authentication.');
  }
  if (ports.bootstrap === null) {
    return err(503, 'julius_state_unavailable',
      `No durable Julius state is reachable from this process: ${ports.missingConfig.join(', ')} is not set. `
      + 'No run was created.');
  }
  if (ports.reviewerProvider === null) {
    return err(503, 'reviewer_provider_unknown',
      'RELAY_HERMES_PROVIDER is not set, so the mission’s reviewer independence group cannot be recorded. No run was created.');
  }
  if (request.body === undefined || request.body.trim() === '') {
    return err(400, 'contract_required', 'The request body must be a mission contract, as the contract file is written.');
  }

  // THE CONTRACT FILE'S OWN PARSER. A mission created here is the mission the job
  // would have read from disk, refused for the same reasons in the same words.
  const parsed = parseLiveMissionContract(request.body);
  if (!parsed.ok) return err(400, 'malformed_mission_contract', parsed.problem);
  const contract: LiveMissionContractFile = parsed.contract;

  const rerunIntent = request.rerun?.trim().toLowerCase() === 'explicit';
  const bootstrapRequest = {
    ...compileBootstrapRequest(contract, missionWorkerRequests(ports.reviewerProvider), ports.cardRevision),
    ...(rerunIntent ? { rerunIntent: 'EXPLICIT' as const } : {}),
  };
  // The same execution identity the job derives, so a mission created here and
  // then driven by the job is ONE execution rather than two that share a name.
  const outcome: JuliusBootstrapOutcome = await ports.bootstrap(`execution:julius-live:${contract.missionId}`, contract.tenantId)
    .submit(bootstrapRequest);
  if (!outcome.accepted) {
    return err(REFUSAL_STATUS[outcome.reasonCode] ?? 409, outcome.reasonCode, outcome.safeMessage);
  }
  return created({
    runId: outcome.runId,
    state: outcome.state,
    missionId: contract.missionId,
    projectId: contract.projectId,
    // WHAT WAS NOT DONE, stated on the wire. A client that read "created" as
    // "running" would draw a mission nobody is driving. The state is the port's
    // — a re-posted contract is answered with the run that already exists, in
    // whatever state it has really reached, never with an asserted READY.
    dispatched: false,
    // WHETHER THIS WAS A DELIBERATE SECOND RUN, on the wire: a client that did
    // not ask for one must never be told it got one.
    rerun: rerunIntent,
    next: `The run is durable in state ${outcome.state}. It is driven by the Julius mission job, not by this route.`,
  });
}

/**
 * THE PRODUCTION COMPOSITION: the same two repositories and the same seed store
 * the mission job hands to the same port. Nothing here is a second way to create
 * a run.
 */
export function composeJuliusMissionBootstrap(pool: Pool): (executionId: string, tenantId: string) => JuliusBootstrapPort {
  const runs = new JuliusPostgresRepository(pool);
  const contracts = new JuliusContractPostgresRepository(pool);
  const seeds = createPostgresMissionSeedStore(pool);
  return (executionId, tenantId) => createLiveJuliusBootstrapPort({
    runs: {
      loadRun: runs.loadRun.bind(runs),
      createRun: runs.createRun.bind(runs),
      addTask: runs.addTask.bind(runs),
      transition: runs.transition.bind(runs),
      putTaskContract: contracts.putTaskContract.bind(contracts),
    },
    seeds, tenantId, executionId,
  });
}
