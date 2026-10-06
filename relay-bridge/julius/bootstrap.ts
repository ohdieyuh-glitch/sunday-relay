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
 *
 * `build` is seeded BLOCKED and stays BLOCKED until Julius ACCEPTS the plan —
 * after the plan review, or after an accepted plan revision — which is when
 * the accepting decision's own write releases it. The plan merely SUCCEEDING
 * releases nothing: paid run 34037313976 built against a plan its review then
 * rejected, because the claim query once offered any BLOCKED task whose
 * dependencies had succeeded. The declared graph plan → plan review → build →
 * build review is now enforced by the release rule, not by this seed alone.
 */

import {
  RELAY_JULIUS_PORT_VERSION,
  type JuliusBootstrapOutcome,
  type JuliusBootstrapPort,
  type JuliusBootstrapRequest,
} from '../../src/relay/integration/julius/julius-port';
import { createHash } from 'node:crypto';
import { parseJuliusMissionActiveError } from '../../src/relay/persistence/julius-postgres';
import { seedJuliusTaskContract, type JuliusMissionState, type JuliusTask, type JuliusTaskContract } from '../../src/relay/mission/julius';
import type { JuliusKnowledgeCarryOutcome } from '../../src/relay/mission/julius/julius-claim-ledger';
import { JULIUS_CARRIED_KNOWLEDGE_LIMIT, type MissionKnowledgeStore } from './mission-knowledge';
import type { MissionSeedStore } from './mission-seed';

/** The store methods bootstrap needs — `JuliusPostgresRepository` satisfies this directly. */
export interface RunCreationStore {
  loadRun(runId: string, projectId: string): Promise<{ readonly state: string } | null>;
  createRun(input: {
    commandId: string; runId: string; missionId: string; projectId: string;
    cardRevision: string; missionContractRevision: number; projectBrainRevision: number; occurredAt: string;
    /** Refuse a second, different execution of a mission that is still in flight. */
    refuseIfMissionActive?: boolean;
  }): Promise<{ readonly runId: string; readonly state: string; readonly version: number }>;
  addTask(input: { commandId: string; runId: string; projectId: string; task: JuliusTask }): Promise<boolean>;
  /**
   * THE TASK CONTRACT JULIUS AUTHORS BEFORE ANY WORKER SEES THE RUN.
   *
   * Revision 1 is Julius's, cut from the Mission Contract; the architect's
   * contribution is a revision it proposes against terms it cannot rewrite.
   * Seeding it HERE — rather than leaving the first draft to a worker — is what
   * makes the dispatch gate usable: a build may not start without a locked
   * contract, and a run whose contract nobody was obliged to write would stall
   * waiting for a document that does not exist.
   */
  putTaskContract(input: { projectId: string; contract: JuliusTaskContract; occurredAt: string }): Promise<boolean>;
  transition(input: {
    commandId: string; runId: string; projectId: string; expectedVersion: number;
    to: 'PLANNING' | 'READY'; reasonCode: string; safeSummary: string;
    evidenceIds: readonly string[]; occurredAt: string;
  }): Promise<{ readonly state: string; readonly version: number }>;
}

export const planTaskId = (runId: string): string => `${runId}:plan`;
export const buildTaskId = (runId: string): string => `${runId}:build`;

/**
 * THE RUN A REQUEST NAMES, before anything is created: the contract's idempotency key, or, for an explicit rerun,
 * that key and the caller's rerun key (why, at the refusal of a keyless rerun below). One derivation: the bootstrap
 * names its run with it, and a registration computes every arm's run id with it before any arm runs.
 */
const juliusBootstrapIdentity = (request: Pick<JuliusBootstrapRequest, 'idempotencyKey' | 'rerunIntent' | 'rerunKey'>): string =>
  request.rerunIntent !== 'EXPLICIT'
    ? request.idempotencyKey
    : createHash('sha256').update(`${request.idempotencyKey}:rerun:${(request.rerunKey ?? '').trim()}`).digest('hex').slice(0, 24);
export const juliusBootstrapRunId = (request: Pick<JuliusBootstrapRequest, 'idempotencyKey' | 'rerunIntent' | 'rerunKey'>): string =>
  `run:${juliusBootstrapIdentity(request)}`;

const REQUIRED_ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'] as const;

export function createLiveJuliusBootstrapPort(deps: {
  readonly runs: RunCreationStore;
  readonly seeds: MissionSeedStore;
  /** What earlier runs of this mission verified. Absent: nothing is inherited. */
  readonly knowledge?: MissionKnowledgeStore;
  /**
   * WHAT THIS RUN MUST INHERIT, when its caller says so. Absent: the carry runs
   * whenever a knowledge store is bound, its outcome is recorded either way, and
   * no outcome stops a mission starting — a mission with no inherited knowledge
   * is a mission that has to work it out again.
   */
  readonly carry?: {
    /**
     * Refuse the bootstrap — before the run is READY, so nothing is dispatched —
     * unless the carry holds at least one VERIFIED REPAIR FINDING and every
     * carried finding came from `fromRunIds` (`requiredCarryRefusal`). A
     * registered learning arm WITH (founder rulings 2026-10-04, R2 and the
     * non-empty carry; Decision C, C-1): an experiment about inherited knowledge
     * that inherited no verified lesson from its own arm WITHOUT is not the
     * experiment, and must not be paid for.
     */
    readonly required: boolean;
    /** Carry only from these runs (arm WITH: its own arm WITHOUT). Still this project and this mission only. */
    readonly fromRunIds?: readonly string[];
  };
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

      /**
       * A RERUN NEEDS AN IDENTITY OF ITS OWN, AND ONLY THE CALLER CAN GIVE IT ONE.
       *
       * Run identity is `sha256(contract)`: the same bytes name the same run,
       * which is what makes a retry safe and what made the commonest rerun
       * impossible — "run that again, exactly" named the run that had already
       * finished, so the caller was handed a terminal run and told it was created
       * (the Wonderland integration lane's drill, D09).
       *
       * SO AN EXPLICIT RERUN CARRIES A KEY, AND IT IS THE CALLER'S. A
       * discriminator DERIVED from durable state cannot be retry-safe: derive it
       * from the mission's latest run and the rerun itself becomes the latest, so
       * the retry computes a different identity and buys a third execution —
       * measured, not reasoned. A count has the same defect. The only value that
       * is stable across a caller's own retries is one the caller holds, so an
       * explicit rerun without a key is REFUSED by name rather than served
       * unsafely. That is the whole of "preserve an explicit rerun path" and "no
       * double execution from a duplicate request" at the same time.
       */
      if (request.rerunIntent === 'EXPLICIT' && (request.rerunKey ?? '').trim() === '') {
        return refuse('rerun_key_required',
          'An explicit rerun must carry a key of its own, so that repeating the request cannot buy a second execution. '
          + 'Send one stable token per intended rerun.');
      }
      const identity = juliusBootstrapIdentity(request);
      const runId = `run:${identity}`;
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
          commandId: `bootstrap:${identity}`,
          runId,
          missionId: request.missionId,
          projectId: request.projectId,
          cardRevision: request.card.revision,
          missionContractRevision: Math.max(1, request.missionRevision),
          projectBrainRevision: Number.isFinite(projectBrainRevision) ? Math.max(0, projectBrainRevision) : 0,
          occurredAt: now(),
          /**
           * THE ACCIDENT THIS REFUSES is a second paid execution of a mission
           * that is still running. Only an EXPLICIT rerun intent clears it —
           * never a retry, never a default — and an identical request is
           * unaffected: its key is the contract's content, so it resumes.
           */
          refuseIfMissionActive: request.rerunIntent !== 'EXPLICIT',
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
            dependencyIds: [planTaskId(runId)], requiredEvidenceTypes: [buildEvidenceFor(request)], taskType: 'build',
            role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
          } as JuliusTask,
        });
        /**
         * WHAT EARLIER RUNS OF THIS MISSION VERIFIED, HANDED TO THIS RUN'S PLANNER
         * (founder ruling 2026-10-04, R1-R3; the rule is `planJuliusKnowledgeCarry`).
         *
         * AFTER THE TASK GRAPH, because every carried row is scoped to this run's
         * plan task and `julius_brain_entries.task_id` references `julius_tasks`:
         * the plan task must exist first. Nothing can claim it in between — the
         * run is CREATED, and only READY and later states are claimable.
         *
         * ONLY ON A RUN THAT IS STILL CREATED, read from the store rather than
         * from `createRun`'s answer: a replayed create returns the response it
         * recorded the first time, which always says CREATED. A run that already
         * moved on inherited what it was going to inherit when it was new; a
         * replay must not hand a running mission something mid-flight. (A replay
         * while it is still CREATED carries again, which is idempotent.)
         *
         * RECORDED, NEVER SWALLOWED. The store writes the outcome as one
         * `knowledge.carried` event — what travelled, what was excluded and why,
         * or why the carry failed — and returns it. Only a caller that REQUIRES
         * inheritance turns a carry without a verified repair finding from its
         * pinned runs into a refusal; everyone else starts as before, with the
         * reason on the record.
         */
        const current = deps.knowledge === undefined && deps.carry === undefined
          ? null : await deps.runs.loadRun(runId, request.projectId);
        if (current !== null && current.state === 'CREATED') {
          const carry = deps.knowledge === undefined ? null : await deps.knowledge.carryKnowledge({
            runId, projectId: request.projectId, missionId: request.missionId,
            scopeTaskId: planTaskId(runId), limit: JULIUS_CARRIED_KNOWLEDGE_LIMIT, occurredAt: now(),
            ...(deps.carry?.fromRunIds === undefined ? {} : { fromRunIds: deps.carry.fromRunIds }),
          });
          if (deps.carry?.required === true) {
            const refusal = requiredCarryRefusal(carry, deps.carry.fromRunIds ?? []);
            if (refusal !== null) return refuse('carried_knowledge_required', refusal);
          }
        }
        /**
         * THE CONTRACT THE BUILD WILL BE HELD TO, written before the run is
         * READY. Seeded from the mission's own terms, so the criteria ids, the
         * money and the objective are Julius's rather than a worker's.
         *
         * A REFUSAL TO SEED IS A REFUSAL TO BOOTSTRAP. Unknown is not a
         * default: a mission with no spend ceiling or no authorised repair
         * rounds cannot have a contract derived from it, and bootstrapping
         * anyway would produce a run whose build can never be dispatched — a
         * stall whose cause is three layers away from its symptom. It says so
         * here instead.
         */
        const seeded = seedJuliusTaskContract({
          runId,
          taskId: buildTaskId(runId),
          missionContractRevision: Math.max(1, request.missionRevision),
          objective: request.objective,
          requirements: request.requirements,
          constraints: request.constraints,
          acceptanceCriteria: request.acceptanceCriteria,
          filesInScope: request.scope.filesInScope,
          filesOutOfScope: request.scope.filesOutOfScope,
          spendUsd: request.limits.spendUsd,
          repairCycles: request.limits.repairCycles,
          // The build task's own declared evidence, quoted rather than guessed:
          // it is what `verifyTask` actually enforces.
          requiredEvidence: [buildEvidenceFor(request)],
        });
        if (!seeded.seeded) {
          return refuse('task_contract_not_derivable',
            `The mission does not state enough for Julius to author the build's task contract (${seeded.reasonCode}).`);
        }
        await deps.runs.putTaskContract({ projectId: request.projectId, contract: seeded.contract, occurredAt: now() });

        let version = created.version;
        for (const step of ['PLANNING', 'READY'] as const) {
          const transitioned = await deps.runs.transition({
            commandId: `bootstrap-${step.toLowerCase()}:${identity}`,
            runId, projectId: request.projectId, expectedVersion: version, to: step,
            reasonCode: 'BOOTSTRAP', safeSummary: `Mission bootstrap advanced the run to ${step}.`,
            evidenceIds: [], occurredAt: now(),
          });
          version = transitioned.version;
        }
        return { accepted: true, runId, acceptedAt: now(), state: 'READY', resumed: false };
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
          // FOUND, NOT MADE: this is the duplicate-submit path, and a caller
          // that is told otherwise will draw a run that does not exist.
          return { accepted: true, runId, acceptedAt: now(), state: (existing?.state ?? 'READY') as JuliusMissionState, resumed: true };
        }
        if (message.includes('idempotency_payload_conflict')) {
          return refuse('mission_already_running', 'This idempotency key was already used for a different mission payload.');
        }
        /**
         * THE MISSION IS ALREADY RUNNING SOMETHING ELSE. Named, with the run
         * that holds it, so a client can follow that runId instead of guessing
         * — and so the answer to "why was my mission refused" is one line.
         * Not retryable: repeating it changes nothing until that run ends or
         * somebody states an explicit rerun.
         */
        const active = parseJuliusMissionActiveError(error);
        if (active !== null) {
          return refuse('mission_run_already_active',
            `Mission ${request.missionId} already has an active run (${active.runId}, ${active.state}); `
            + 'follow that run, wait for it to end, or state an explicit rerun intent to start another.');
        }
        return refuse('bootstrap_persistence_failure', 'The durable store refused or was unavailable while bootstrapping the run; nothing was dispatched.', true);
      }
    },
  };
}

/**
 * WHAT PROVES THE BUILD, given what the mission can produce.
 *
 * A mission with a deterministic check is proven by that check passing: `TEST`.
 * A mission that declared none — a report, an analysis, a plan — is proven by
 * the deliverable it produced: the captured `DIFF`, which the live coder records
 * as PASSED only when the executor observed a real change. Demanding `TEST` of
 * the second kind parked the run in VERIFYING forever for lacking something the
 * mission never had. Absent means declared, so every existing caller is unchanged.
 */
function buildEvidenceFor(request: JuliusBootstrapRequest): 'TEST' | 'DIFF' {
  return (request.deterministicCheck?.declared ?? true) ? 'TEST' : 'DIFF';
}

/**
 * THE GATE ON A REQUIRED CARRY, IN ONE MODE (Decision C, C-1): valid only when
 * the carry holds at least one VERIFIED REPAIR FINDING and every carried
 * finding came from a run the caller pinned (arm WITH: its own arm WITHOUT).
 * A design never counts, and neither does the word CARRIED: the count and the
 * sources are the evidence. A required carry that pinned nothing has no
 * source that could qualify. Null when valid; otherwise the refusal's message.
 */
function requiredCarryRefusal(carry: JuliusKnowledgeCarryOutcome | null, pinned: readonly string[]): string | null {
  const must = 'This mission must inherit a verified repair finding from its own earlier run';
  const after = 'the run was not made ready and nothing was dispatched.';
  if (carry === null) return `${must}, and no knowledge store is bound; ${after}`;
  if (carry.outcome !== 'CARRIED') {
    return `${must}, and the carry was ${carry.outcome}${carry.reasonCode === null ? '' : ` (${carry.reasonCode})`}; ${after}`;
  }
  if (carry.carriedFindings < 1 || carry.findingSourceRunIds.length === 0) {
    return `${must}, and the carry held ${String(carry.carried)} row(s) but no verified repair finding; ${after}`;
  }
  if (carry.findingSourceRunIds.some((runId) => !pinned.includes(runId))) {
    return `${must}, and a carried finding came from a run it did not pin; ${after}`;
  }
  return null;
}
