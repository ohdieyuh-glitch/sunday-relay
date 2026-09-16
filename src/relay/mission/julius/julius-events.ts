/**
 * EVERY AUTHORITATIVE TRANSITION HAS A TYPE HERE, AND NOTHING ELSE DOES.
 *
 * The list is the catalogue AND the guarantee: `julius-event-coverage.test.ts`
 * reads the runtime source, collects every type any code path actually emits,
 * and holds the two sets against each other in both directions. A type
 * declared and never emitted is a promise nothing keeps; a type emitted and
 * never declared is an event no consumer can name. Both fail the build.
 *
 * WHAT WAS MISSING BEFORE THAT AUDIT EXISTED: `task.failed` was emitted by the
 * execution coordinator and absent from the list, and `task.runnable`,
 * `provider.failure`, `approval.requested`, `approval.decided`,
 * `recovery.action`, `context.compiled`, `subagent.denied` and
 * `task.cancelled` were named in the product's own list of authoritative
 * transitions and had no type at all.
 *
 * NO GAUNTLET TYPE IS ON THIS LIST, and its absence is the architecture. The
 * Gauntlet Loop is a USER-ACTIVATED COMMAND that lives in
 * `src/relay/mission/gauntlet/**` and uses generic interfaces; Julius does not
 * know a feature called Gauntlet Loop exists. An earlier version of this
 * catalogue carried `gauntlet.started`, `gauntlet.round.started`,
 * `gauntlet.round.completed`, `gauntlet.cleared` and `gauntlet.halted`, which
 * made Julius aware of it. The gauntlet keeps its own ledger.
 *
 * ONE TYPE IS DELIBERATELY ABSENT. `autonomy.changed` belongs on this list and
 * is not on it, because C.A.R.D. POLICY IS NOT PERSISTED — `julius_runs`
 * stores a `card_revision` and nothing stores the policy that revision names,
 * so a run's autonomy cannot be changed at runtime and an event saying it did
 * would be an event nothing emits. Declaring it would be a promise nothing
 * keeps, which is exactly what the coverage audit refuses. The gap is recorded
 * in the runtime documentation rather than papered over with a type.
 *
 * NO PROSE, NO WORDING, NO LABELS. A type is a stable machine name; how a
 * terminal renders it belongs to the Relay projection layer, which owns
 * display and must be able to change it without a core migration.
 */
export const JULIUS_OPERATIONAL_EVENT_TYPES=[
 /* run lifecycle */
 'run.created','run.transitioned','run.paused','run.resumed','run.cancelled','run.completed','run.failed',
 /* task lifecycle */
 'task.created','task.runnable','task.claimed','task.failed','task.cancelled',
 /* dispatch */
 'worker.selected','worker.dispatched','worker.completed','provider.failure','reroute.selected','fallback.selected','retry.scheduled',
 /* budget: what one dispatch was allocated from the mission's money, before the reservation */
 'budget.allocated',
 /* context */
 'context.compiled',
 /* evidence and verification */
 'evidence.recorded','review.started','finding.recorded','verification.decided','repair.scheduled',
 /* the task/sprint contract: what a worker was charged with, and when it stopped being arguable */
 'contract.proposed','contract.challenged','contract.locked','contract.refused',
 /* WHAT THE EVALUATOR DECIDED, on both branches — because a bundle with no
  * challenge in it cannot otherwise say whether the terms were examined and
  * found sound, or whether the challenge leg simply never ran. */
 'contract.disposition',
 /* THE CONTINUOUS LIFECYCLE. A checkpoint is a moment Julius judged worth a
  * decision; a verdict is what the reviewer said about one; guidance is what
  * the architect said after the contract locked. Before these four, the ledger
  * recorded only boundaries — a task started, a task ended — and a mission's
  * whole middle was unwritten. */
 'checkpoint.recorded','checkpoint.verdict','guidance.issued','guidance.refused',
 /* WHEN A PACKET BECAME ADVICE. `guidance.issued` says an architect produced one
  * and which question it answers; `guidance.delivered` says Julius ACCEPTED it
  * after review and handed it to the worker that asked. They were one fact, and
  * a packet the reviewer went on to reject had already been delivered. */
 'guidance.delivered',
 /* GOVERNED RESEARCH. `research.refused` is Julius unable to read what a worker
  * asked for; `guidance.deferred` is a worker that asked for two things in one
  * dispatch and got the cheaper one, recorded rather than dropped so the record
  * says what it wanted. What research OBSERVED is on `checkpoint.verdict`,
  * outcome by outcome, because the observation belongs to the checkpoint that
  * asked for it.
  *
  * `research.retrieved` is the CHARGE, one row per observation, and it exists
  * because the meter that enforces a research budget lived only in process
  * memory: a bridge restart forgot what every slot had already spent and the
  * budget began again from zero. The outcome names on `checkpoint.verdict` are
  * an aggregate for a reader; these rows are what the ledger is rebuilt from,
  * so they carry the role, the source and the metered outcome separately. */
 'research.refused','research.retrieved','guidance.deferred',
 /* `research.attempted` is the INTENT, written before the socket can exist and
  * carrying the attempt's deterministic key. It exists because the charge row
  * above is written AFTER the retrieval returns: a process that died in between
  * had spent with nothing on the record, and the restart spent again while the
  * rebuilt ledger counted one. This row is what makes that loss visible — an
  * attempt with no retrieval beside it is a retrieval nobody can vouch for, and
  * Julius refuses rather than replays it. */
 'research.attempted',
 /* THE PEER CHANNEL. Every exchange between sustained workers as an audited
  * request: who asked whom, for what, what answered it and how Julius closed
  * it. `peer.request.refused` is a request the channel would not open — a
  * direction no rule permits, a party that is not a peer — written so an
  * illegal attempt is visible rather than silently dropped. The request's
  * state is a fold over these rows; nothing else stores it. */
 'peer.request.opened','peer.request.transitioned','peer.request.refused',
 /* THE REVIEWER'S CANONICAL VERDICT. `declared` is what the reviewer said,
  * rebuilt from an allowlist; `refused` is a declaration Julius would not read —
  * a Julius-only outcome, a mission-owned term, an unknown word — with the
  * reason; `applied` is the verdict Julius acted on (the stricter of the
  * declaration and the evidence) and the route it took. A declaration from a
  * dispatch that paused to research is kept and never applied. */
 'review.verdict.declared','review.verdict.refused','review.verdict.applied',
 /* DISAGREEMENT. `opened` is the record — subject, both positions' evidence,
  * the binding — and `step` is each move it makes: the rebuttal scheduled, the
  * architect's answer, the re-review scheduled and its verdict. `resolved`
  * names the resolution and its basis. The record's state is a fold over
  * `opened` and `step`; `refused` is a challenge that could not be opened as
  * one, which leaves its hold in place rather than dropping it. */
 'disagreement.opened','disagreement.step','disagreement.resolved','disagreement.refused',
 /* A FINDING'S LIFE. Findings were recorded OPEN and stayed OPEN forever, so a
  * mission could complete with its record still saying the problem was there.
  * Each row is one legal move: a repair that SUCCEEDED addressed it, or the
  * reviewer that raised it resolved, maintained or superseded it. Only a
  * reviewer's own answer reaches RESOLVED; changed code never does. */
 'finding.transitioned',
 /* THE ARCHITECTURE, AS STATE. `recorded` is a whole bounded revision — the
  * components, boundaries, dependencies, decisions, assumptions, questions and
  * risks the architect holds — carried on the row so a reader reconstructs it
  * without a second store. `refused` is a proposal Julius would not read, by
  * name. It is ADVISORY: the Mission Contract remains authoritative, and
  * `architecture.conflicted` records where the two disagree rather than letting
  * either quietly win. */
 'architecture.recorded','architecture.refused','architecture.conflicted',
 /* THE ARCHITECTURE, WATCHED AND CHECKED. `trigger.raised` is one of the seven
  * named moments Julius goes back to the architect, cause-once by trigger id.
  * `proposed` and `accepted` are the post-lock re-plan path: a material change
  * to locked terms waits for the review of the task that proposed it.
  * `assessed` is the final consistency check — an ASSESSMENT, never a verdict:
  * the architect can refuse to let a completion happen, and can never mint one.
  * `replan.escalated` is a re-plan that would need a mission term to move,
  * which is the user's decision and not the architect's. */
 'architecture.trigger.raised','architecture.proposed','architecture.accepted','architecture.unchanged',
 'architecture.assessed','architecture.assessment.refused','architecture.replan.escalated',
 /* PERSISTENT-WORKER EFFORT. One row per completed dispatch, carrying what the
  * provider actually reported and NOTHING inferred — an unreported token count
  * is null here rather than the zero the budget path substitutes, because a
  * parity diagnostic built on substituted zeros would call every silent worker
  * shallow. */
 'worker.effort',
 /* bounded children */
 'subagent.spawned','subagent.denied','subagent.completed',
 /* budget */
 'budget.reserved','budget.settled','budget.denied',
 /* human gates and autonomy */
 'approval.requested','approval.decided',
 /* recovery */
 'recovery.action',
]as const;export type JuliusOperationalEventType=typeof JULIUS_OPERATIONAL_EVENT_TYPES[number];
export interface JuliusOperationalEvent{readonly eventId:string;readonly runId:string;readonly projectId:string;readonly type:JuliusOperationalEventType;readonly taskId:string|null;readonly workerId:string|null;readonly correlationId:string;readonly causationId:string|null;readonly occurredAt:string;readonly facts:Readonly<Record<string,string|number|boolean|null>>;}
export function validateJuliusEvent(event:JuliusOperationalEvent):void{for(const value of[event.eventId,event.runId,event.projectId,event.correlationId,event.occurredAt])if(!value.trim())throw new Error('julius_event_identity_required');const payload=JSON.stringify(event.facts);if(payload.length>8192)throw new Error('julius_event_too_large');if(/(?:api[_-]?key|authorization|token|secret|password)\s*[=:]/i.test(payload))throw new Error('julius_event_secret_rejected');for(const value of Object.values(event.facts))if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new Error('julius_event_fact_invalid');}
