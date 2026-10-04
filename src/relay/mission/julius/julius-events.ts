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
 /* the claim ledger: a memory's standing rose on a reviewer's evidence, or the trust core refused to raise it */
 'claim.promoted','claim.promotion.refused',
 /* THE CORRECTED CARRY (julius-carry.v2): the one manifest of what an earlier mission handed this one — counts,
  * the carried ids, and every candidate refused by code. Written once per run, at bootstrap. */
 'knowledge.carried',
 /* a task's work was superseded rather than done: a declined request, re-planned into a continuation */
 'task.superseded',
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
 /* WORKER AUTHORITY AT THE RESULT BOUNDARY. `evidence.refused` is a claim of a
  * kind the producing role may not author — a coder's own review finding, a
  * user approval nobody gave — set aside and named. `worker.channel.refused`
  * is a channel that belongs to another role: a coder's verdict about its own
  * work, or a design. Both are refusals ON the record rather than silence. */
 'evidence.refused','worker.channel.refused',
 /* WHICH ACCEPTED GUIDANCE A DISPATCH WAS GIVEN, by entry id, recorded with the
  * compiled context it arrived in. A count on `worker.effort` could not say
  * which packet a coder acted on. */
 'guidance.consumed',
 /* THE CODING AGENT'S IMPLEMENTATION, ON THE RECORD. `recorded` is what the
  * independent executor observed the dispatch change and what the coder said
  * it did, side by side. `scope.violated` is a changed path the locked
  * contract did not allow, found by Julius from that change set — the rule used
  * to exist only as prompt text. `report.refused` is a coder report Julius
  * would not read, by name. */
 'coder.implementation.recorded','coder.scope.violated','coder.report.refused',
 /* WHICH ATTEMPT CHANGED WHAT. `attempt.workspace` is the attempt's own three
  * trees and the change sets between them — what it inherited, what it owns,
  * what the mission carries — written for a failed attempt as well, because a
  * failed attempt's edits used to reach the record only by turning up inside
  * the NEXT attempt's diff. `workspace.restored` is the one undo Julius
  * authorises: a refused attempt's own edits, and only while the workspace is
  * still exactly the tree that attempt left. Its refusals carry the same type,
  * because "Julius did not undo it, and why" is the fact that matters. */
 'coder.attempt.workspace','coder.workspace.restored',
 /* WHAT THE IMPLEMENTATION PEER SAW. `observed` is one evidenced observation a
  * Coding Agent made about the design in force; it can raise a consultation
  * and never a revision. `observation.refused` is a set Julius would not read,
  * by name. */
 'architecture.observed','architecture.observation.refused',
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
 /* A late FREE release met a close that says money may have gone ((a2) step 3): both stand, and this names them. */
 'budget.settlement.conflict',
 /* human gates and autonomy */
 'approval.requested','approval.decided',
 /* recovery */
 'recovery.action',
]as const;export type JuliusOperationalEventType=typeof JULIUS_OPERATIONAL_EVENT_TYPES[number];
/**
 * WHAT MAKES TWO WRITES THE SAME EVENT — AND WHAT MAKES THEM A CONFLICT.
 *
 * `appendEvent` has always answered `true` for "recorded" and `false` for
 * "already there", and the two stores disagreed about what "already there"
 * meant. The in-memory store compared the ID ALONE, so a second event carrying
 * DIFFERENT facts under a used id was silently dropped and its facts were lost.
 * PostgreSQL compared `JSON.stringify` of the stored payload with the one it
 * had just built — and `jsonb` does not preserve key order, so a genuine replay
 * of the same event almost always compared unequal and was refused with
 * `julius_event_id_conflict`. One contract, two behaviours, and neither was the
 * one the ledger claims.
 *
 * THE CONTRACT, STATED ONCE HERE:
 *
 *   same id, same event   -> idempotent. No duplicate row, no error, `false`.
 *   same id, other event  -> {@link JuliusEventIdConflict}, and nothing written.
 *   new id                -> recorded, `true`.
 *
 * IDENTITY IS THE FACTS, NOT THE INSTANT. `occurredAt` is when the write
 * happened, not what the event says: a replay after a restart reads a later
 * clock, and refusing it would make every honest replay a conflict. The ledger
 * keeps the first instant, and the event's identity is everything else.
 *
 * KEY ORDER IS NOT MEANING. The canonical form sorts every key at every depth,
 * so a payload that survived a round trip through `jsonb` — which reorders —
 * compares equal to the one that produced it.
 */
export const JULIUS_EVENT_IDENTITY_VERSION='julius-event-identity.v1'as const;
/** The fields that make an event what it is. `eventId` names it; `occurredAt` is not part of it. */
export interface JuliusEventIdentityFields{readonly runId:unknown;readonly projectId:unknown;readonly type:unknown;readonly taskId:unknown;readonly workerId:unknown;readonly correlationId:unknown;readonly causationId:unknown;readonly facts:unknown;}
const canonical=(value:unknown):string=>{
 if(value===null||typeof value!=='object')return JSON.stringify(value===undefined?null:value);
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 const record=value as Record<string,unknown>;
 return `{${Object.keys(record).sort().map(key=>`${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
};
/**
 * The canonical form of one event's identity: stable at every depth, so two
 * stores — and a value that has been through `jsonb` — agree on what it says.
 */
export function canonicalJuliusEventIdentity(event:JuliusEventIdentityFields):string{
 return canonical({
  version:JULIUS_EVENT_IDENTITY_VERSION,
  runId:event.runId??null,projectId:event.projectId??null,type:event.type??null,
  taskId:event.taskId??null,workerId:event.workerId??null,
  correlationId:event.correlationId??null,causationId:event.causationId??null,
  facts:event.facts??null,
 });
}
/**
 * THE ID OF AN EVENT THAT EXPLAINS A DECISION — NAMED BY THE DECISION.
 *
 * Operational event ids are `${kind}:${randomUUID()}` in the live composition,
 * which is right for an event written once and wrong for one that may be
 * written again: a replay mints a NEW id, so the append contract above — the
 * one that makes a replay idempotent and a rewrite a conflict — is never
 * reached, and the ledger grows a second row saying the same thing.
 *
 * An event that explains a decision has a durable name available to it: the
 * decision's own idempotency key, which is what the store dedupes the decision
 * on. Two processes deciding the same thing agree on that key, so they agree
 * on these ids, so a second write is recognised as the replay it is.
 *
 * The ORDINAL separates events one decision writes under a single type — one
 * `task.runnable` per released task — and is the position within that
 * decision's own released set, which is computed from durable rows rather than
 * from the order a process happened to visit them in.
 */
export const JULIUS_DECISION_EVENT_ID_VERSION='julius-decision-event-id.v1'as const;
export const juliusDecisionEventId=(idempotencyKey:string,type:JuliusOperationalEventType,ordinal:number):string=>
 `${JULIUS_DECISION_EVENT_ID_VERSION}:${idempotencyKey}:${type}:${String(ordinal)}`;

/** The same event id, asked to say something else. Nothing is written. */
export class JuliusEventIdConflict extends Error{
 constructor(readonly eventId:string){super('julius_event_id_conflict');this.name='JuliusEventIdConflict';}
}
export interface JuliusOperationalEvent{readonly eventId:string;readonly runId:string;readonly projectId:string;readonly type:JuliusOperationalEventType;readonly taskId:string|null;readonly workerId:string|null;readonly correlationId:string;readonly causationId:string|null;readonly occurredAt:string;readonly facts:Readonly<Record<string,string|number|boolean|null>>;}
export function validateJuliusEvent(event:JuliusOperationalEvent):void{for(const value of[event.eventId,event.runId,event.projectId,event.correlationId,event.occurredAt])if(!value.trim())throw new Error('julius_event_identity_required');const payload=JSON.stringify(event.facts);if(payload.length>8192)throw new Error('julius_event_too_large');if(/(?:api[_-]?key|authorization|token|secret|password)\s*[=:]/i.test(payload))throw new Error('julius_event_secret_rejected');for(const value of Object.values(event.facts))if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new Error('julius_event_fact_invalid');}
