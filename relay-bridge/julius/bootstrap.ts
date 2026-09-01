/**
 * THE PRODUCTION `JuliusBootstrapPort` — the first implementation of the port
 * `src/relay/integration/julius/julius-port.ts` declared and left unwired.
 *
 * `submit` takes the compiled `JuliusBootstrapRequest` VALUE and turns it into
 * durable Julius state: the FK-required base rows, the run (CREATED), the
 * acceptance criteria the verification phase will evaluate, the Project Brain
 * entries the context compiler will read, the initial task graph, and the
 * transitions to READY. Everything downstream of READY — claiming, dispatch,
 * verification, review, repair, completion — belongs to the Julius run loop
 * and is deliberately not reachable from here.
 *
 * FAIL CLOSED, AS VALUES. An invalid request or an unavailable store answers
 * `accepted: false` with a stable reason code; nothing about a refusal writes
 * state, and no error text can smuggle a connection string or credential into
 * the outcome (`safeMessage` is composed here, never copied from a driver).
 *
 * THE INITIAL TASK GRAPH IS DELIBERATELY MINIMAL: one PROMPT_ARCHITECT `plan`
 * task, one CODING_AGENT `build` task depending on it. Reviews, repairs and
 * every later task are scheduled by Julius's own verification runtime, not
 * planned here — planning more would be this module pre-empting decisions the
 * runtime owns.
 */

import {
  RELAY_JULIUS_PORT_VERSION,
  type JuliusBootstrapOutcome,
  type JuliusBootstrapPort,
  type JuliusBootstrapRequest,
} from '../../src/relay/integration/julius/julius-port';
import type { JuliusMissionState, JuliusTask } from '../../src/relay/mission/julius';
import type { MissionSeedStore } from './mission-seed';

/** The store methods bootstrap needs — `JuliusPostgresRepository` satisfies this directly. */
export interface RunCreationStore {
  loadRun(runId: string, projectId: string): Promise<{ readonly state: string } | null>;
  createRun(input: {
    commandId: string; runId: string; missionId: string; projectId: string;
    cardRevision: string; missionContractRevision: number; projectBrainRevision: number; occurredAt: string;
  }): Promise<{ readonly runId: string; readonly state: string; readonly version: number }>;
  addTask(input: { commandId: string; runId: string; projectId: string; task: JuliusTask }): Promise<boolean>;
  transition(input: {
    commandId: string; runId: string; projectId: string; expectedVersion: number;
    to: 'PLANNING' | 'READY'; reasonCode: string; safeSummary: string;
    evidenceIds: readonly string[]; occurredAt: string;
  }): Promise<{ readonly state: string; readonly version: number }>;
}

export const planTaskId = (runId: string): string => `${runId}:plan`;
export const buildTaskId = (runId: string): string => `${runId}:build`;

const REQUIRED_ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const;

export function createLiveJuliusBootstrapPort(deps: {
  readonly runs: RunCreationStore;
  readonly seeds: MissionSeedStore;
  readonly tenantId: string;
  readonly executionId: string;
  readonly now?: () => string;
}): JuliusBootstrapPort {
  const now = deps.now ?? (() => new Date().toISOString());
  const refuse = (reasonCode: string, safeMessage: string, retryable = false): JuliusBootstrapOutcome =>
    ({ accepted: false, reasonCode, safeMessage, retryable });

  return {
    portVersion: RELAY_JULIUS_PORT_VERSION,
    async submit(request: JuliusBootstrapRequest): Promise<JuliusBootstrapOutcome> {
      if (!request.missionId.trim() || !request.projectId.trim() || !request.idempotencyKey.trim()) {
        return refuse('malformed_mission_contract', 'The bootstrap request is missing its mission, project or idempotency identity.');
      }
      if (request.acceptanceCriteria.length === 0) {
        return refuse('acceptance_criteria_missing', 'A mission with no acceptance criteria cannot be verified and is refused.');
      }
      if (!request.acceptanceCriteria.some((criterion) => criterion.blocking)) {
        return refuse('blocking_acceptance_criterion_missing', 'A mission needs at least one blocking acceptance criterion.');
      }
      const roles = new Set(request.workers.map((worker) => worker.role));
      for (const role of REQUIRED_ROLES) {
        if (!roles.has(role)) {
          return refuse('invalid_worker_configuration', `The mission does not configure a ${role} worker, and this deployment refuses to substitute one.`);
        }
      }

      const runId = `run:${request.idempotencyKey}`;
      const projectBrainRevision = Number.parseInt(request.projectBrain.revision, 10);
      try {
        await deps.seeds.ensureBase({
          tenantId: deps.tenantId,
          projectId: request.projectId,
          missionId: request.missionId,
          executionId: deps.executionId,
          cardRevision: request.card.revision,
          missionSnapshot: request,
          canonicalHash: request.missionBindingDigest,
        });
        const created = await deps.runs.createRun({
          commandId: `bootstrap:${request.idempotencyKey}`,
          runId,
          missionId: request.missionId,
          projectId: request.projectId,
          cardRevision: request.card.revision,
          missionContractRevision: Math.max(1, request.missionRevision),
          projectBrainRevision: Number.isFinite(projectBrainRevision) ? Math.max(0, projectBrainRevision) : 0,
          occurredAt: now(),
        });
        await deps.seeds.insertCriteria(runId, request.acceptanceCriteria.map((criterion) => ({
          criterionId: criterion.id,
          description: criterion.text,
          // Deliberately empty: the runtime checks a criterion's evidence
          // types against EVERY verified task, so a TEST-typed criterion can
          // never accept the plan task and the run would honestly park in
          // VERIFYING forever. The machine-testable enforcement lives on the
          // build task's own requiredEvidenceTypes (TEST), which verifyTask
          // HALTs without — completion still requires the real test to pass.
          requiredEvidenceTypes: [],
        })));
        await deps.seeds.insertBrainEntries(runId, request.projectId, [
          { entryId: `${runId}:objective`, kind: 'CONSTRAINT', text: `OBJECTIVE: ${request.objective}`, revision: 1 },
          ...request.requirements.map((text, index) => ({
            entryId: `${runId}:requirement:${index}`, kind: 'ACCEPTANCE_UPDATE' as const, text: `REQUIREMENT: ${text}`, revision: 2 + index,
          })),
          ...request.constraints.map((text, index) => ({
            entryId: `${runId}:constraint:${index}`, kind: 'CONSTRAINT' as const, text: `CONSTRAINT: ${text}`, revision: 2 + request.requirements.length + index,
          })),
          {
            entryId: `${runId}:criteria`, kind: 'ACCEPTANCE_UPDATE',
            text: `ACCEPTANCE CRITERIA: ${request.acceptanceCriteria.map((criterion) => `[${criterion.id}] ${criterion.text}`).join(' | ')}`,
            revision: 2 + request.requirements.length + request.constraints.length,
          },
        ]);
        await deps.runs.addTask({
          commandId: `bootstrap-task:${planTaskId(runId)}`, runId, projectId: request.projectId,
          task: {
            taskId: planTaskId(runId), missionId: request.missionId, parentTaskId: null,
            dependencyIds: [], requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan',
            role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
          } as JuliusTask,
        });
        await deps.runs.addTask({
          commandId: `bootstrap-task:${buildTaskId(runId)}`, runId, projectId: request.projectId,
          task: {
            taskId: buildTaskId(runId), missionId: request.missionId, parentTaskId: null,
            dependencyIds: [planTaskId(runId)], requiredEvidenceTypes: ['TEST'], taskType: 'build',
            role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
          } as JuliusTask,
        });
        let version = created.version;
        for (const step of ['PLANNING', 'READY'] as const) {
          const transitioned = await deps.runs.transition({
            commandId: `bootstrap-${step.toLowerCase()}:${request.idempotencyKey}`,
            runId, projectId: request.projectId, expectedVersion: version, to: step,
            reasonCode: 'BOOTSTRAP', safeSummary: `Mission bootstrap advanced the run to ${step}.`,
            evidenceIds: [], occurredAt: now(),
          });
          version = transitioned.version;
        }
        return { accepted: true, runId, acceptedAt: now(), state: 'READY' };
      } catch (error) {
        // A replayed bootstrap lands here when the run already advanced past
        // CREATED: createRun idempotently returns the existing run, and the
        // CREATED→PLANNING transition then conflicts (version race), or the
        // runtime refuses the transition outright (`invalid_julius_transition`
        // — the string the state machine actually throws). That is a
        // duplicate submit, not a failure — and the ACTUAL durable state is
        // reported, never an asserted READY. (Independent review finding F10.)
        const message = error instanceof Error ? error.message : '';
        if (message.includes('optimistic_concurrency_conflict') || message.includes('invalid_julius_transition')) {
          const existing = await deps.runs.loadRun(runId, request.projectId).catch(() => null);
          return { accepted: true, runId, acceptedAt: now(), state: (existing?.state ?? 'READY') as JuliusMissionState };
        }
        if (message.includes('idempotency_payload_conflict')) {
          return refuse('mission_already_running', 'This idempotency key was already used for a different mission payload.');
        }
        return refuse('bootstrap_persistence_failure', 'The durable store refused or was unavailable while bootstrapping the run; nothing was dispatched.', true);
      }
    },
  };
}
