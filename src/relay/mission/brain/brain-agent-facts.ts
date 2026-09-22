import { brainMayWrite, type BrainSystem } from './brain-ownership';
import { isBrainJuliusId, type BrainAttemptIdentity } from './brain-attempt-identity';

/**
 * TWO KINDS OF AGENT, AND THEY NEVER BECOME EACH OTHER.
 *
 *   A REGULAR SUB-AGENT is a child Julius authorised under a parent task:
 *   bounded by depth, by a permission subset it can never exceed, and by a
 *   budget reservation. Julius already stores its lifecycle durably in
 *   `relay_wonderland.julius_subagents`, so the Brain holds a REFERENCE — the
 *   request id — and the facts a project history needs, not a second copy that
 *   could disagree with the runtime.
 *
 *   A /MAS COMPOUND CLONE is a temporary clone of the Compound AI Agent itself,
 *   given a workstream and later synthesised or terminated. Julius emits no such
 *   lifecycle today. So this type exists, and stays empty, until it does.
 *
 * WHY THIS FILE IS SEPARATE FROM EVERYTHING ELSE. A Relay Dog Cub Ghost in
 * Wonderland is the visual embodiment of a REGULAR SUB-AGENT. It is a picture.
 * Seeing three Cubs is not evidence that three sub-agents exist, and it is
 * certainly not evidence that a Compound clone was made. Both mistakes are
 * refused here rather than left to reviewers to notice:
 *
 *   - `brainSubAgentFact` and `brainCompoundCloneFact` are separate
 *     constructors over separate types with separate id namespaces;
 *   - there is deliberately NO converter between them, and
 *     `refuseSilentAgentUpgrade` states why when something tries;
 *   - every fact carries the `observedBy` system, and anything a renderer
 *     claims is refused: `presentation_is_not_evidence`.
 */

export const BRAIN_AGENT_FACT_KINDS = ['SUB_AGENT', 'COMPOUND_CLONE'] as const;
export type BrainAgentFactKind = typeof BRAIN_AGENT_FACT_KINDS[number];

/** Exactly the lifecycle Julius records for a sub-agent. The Brain adds none of its own. */
export const BRAIN_SUB_AGENT_STATES = ['AUTHORIZED', 'ACTIVE', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
export type BrainSubAgentState = typeof BRAIN_SUB_AGENT_STATES[number];

/** What a Compound clone would do, if Julius ever says one existed. */
export const BRAIN_COMPOUND_CLONE_STATES = ['SPAWNED', 'WORKING', 'SYNTHESISED', 'TERMINATED'] as const;
export type BrainCompoundCloneState = typeof BRAIN_COMPOUND_CLONE_STATES[number];

interface BrainAgentFactBase {
  readonly kind: BrainAgentFactKind;
  /** The run and attempt this fact belongs to, in Julius's terms. */
  readonly attempt: BrainAttemptIdentity;
  readonly projectId: string;
  readonly missionId: string;
  /** The system that observed it. Only JULIUS may author agent lifecycle. */
  readonly observedBy: BrainSystem;
  /** Evidence and artifacts Julius already recorded. Ids, never copies. */
  readonly evidenceIds: readonly string[];
  /** When Julius says it happened; null when it did not say. Unknown stays Unknown. */
  readonly occurredAt: string | null;
}

export interface BrainSubAgentFact extends BrainAgentFactBase {
  readonly kind: 'SUB_AGENT';
  /** `julius_subagents.request_id` — the sub-agent's identity, owned by Julius. */
  readonly subAgentId: string;
  /** The parent task that was authorised to spawn it. */
  readonly parentTaskId: string;
  /** The task the child runs as. */
  readonly childTaskId: string;
  readonly depth: number;
  /** The delegated function, as Julius authorised it. */
  readonly capability: string;
  readonly state: BrainSubAgentState;
  readonly denialReason: string | null;
}

export interface BrainCompoundCloneFact extends BrainAgentFactBase {
  readonly kind: 'COMPOUND_CLONE';
  /** A clone's own identity namespace. It is never a sub-agent request id. */
  readonly cloneId: string;
  /** The agent this is a temporary clone OF. */
  readonly primaryAgentId: string;
  readonly workstream: string;
  readonly state: BrainCompoundCloneState;
  /** What the clone's work was folded into, once it was. */
  readonly synthesisRef: string | null;
  readonly terminationReason: string | null;
}

export type BrainAgentFact = BrainSubAgentFact | BrainCompoundCloneFact;

export type BrainAgentFactRefusal =
  | { readonly ok: false; readonly reasonCode: 'presentation_is_not_evidence' | 'not_an_author' | 'identity_invalid' | 'state_invalid' | 'depth_invalid'; readonly detail: string };
export type BrainAgentFactResult<T> = { readonly ok: true; readonly fact: T } | BrainAgentFactRefusal;

const authored = (observedBy: BrainSystem, domain: 'AGENT_LIFECYCLE' | 'COMPOUND_CLONE_LIFECYCLE'): BrainAgentFactRefusal | null => {
  // A renderer claiming an agent exists is the exact mistake this guards.
  if (observedBy === 'WONDERLAND') {
    return { ok: false, reasonCode: 'presentation_is_not_evidence', detail: 'Wonderland renders sub-agents as Cub Ghosts; a Cub on screen is not evidence that an agent exists' };
  }
  const verdict = brainMayWrite(observedBy, domain);
  if (!verdict.ok || verdict.as !== 'AUTHOR') {
    return { ok: false, reasonCode: 'not_an_author', detail: `${observedBy} may not author ${domain}; Julius does` };
  }
  return null;
};

/** A sub-agent fact, from what Julius recorded. */
export function brainSubAgentFact(input: Omit<BrainSubAgentFact, 'kind'>): BrainAgentFactResult<BrainSubAgentFact> {
  const refusal = authored(input.observedBy, 'AGENT_LIFECYCLE');
  if (refusal !== null) return refusal;
  if (!isBrainJuliusId(input.subAgentId) || !isBrainJuliusId(input.parentTaskId) || !isBrainJuliusId(input.childTaskId)) {
    return { ok: false, reasonCode: 'identity_invalid', detail: 'a sub-agent carries the request id, parent task and child task Julius gave it' };
  }
  if (!(BRAIN_SUB_AGENT_STATES as readonly string[]).includes(input.state)) return { ok: false, reasonCode: 'state_invalid', detail: `${input.state} is not a sub-agent state` };
  // Julius stores depth rather than recomputing it, and a child is always deeper than its parent.
  if (!Number.isSafeInteger(input.depth) || input.depth < 1) return { ok: false, reasonCode: 'depth_invalid', detail: 'depth is the stored depth of the child, which is at least 1' };
  return { ok: true, fact: { kind: 'SUB_AGENT', ...input } };
}

/** A Compound clone fact. Only from a Julius clone lifecycle — never from a sub-agent, and never from a visual. */
export function brainCompoundCloneFact(input: Omit<BrainCompoundCloneFact, 'kind'>): BrainAgentFactResult<BrainCompoundCloneFact> {
  const refusal = authored(input.observedBy, 'COMPOUND_CLONE_LIFECYCLE');
  if (refusal !== null) return refusal;
  if (!isBrainJuliusId(input.cloneId) || !isBrainJuliusId(input.primaryAgentId)) {
    return { ok: false, reasonCode: 'identity_invalid', detail: 'a clone carries its own id and the primary agent it was cloned from' };
  }
  if (!(BRAIN_COMPOUND_CLONE_STATES as readonly string[]).includes(input.state)) return { ok: false, reasonCode: 'state_invalid', detail: `${input.state} is not a compound clone state` };
  return { ok: true, fact: { kind: 'COMPOUND_CLONE', ...input } };
}

/**
 * There is no conversion, and this says so with the reason rather than a type
 * error alone. A sub-agent that did a lot of work is still a sub-agent; a clone
 * that did almost nothing is still a clone. Only Julius's own lifecycle decides
 * which happened.
 */
export function refuseSilentAgentUpgrade(from: BrainAgentFactKind, to: BrainAgentFactKind): BrainAgentFactRefusal {
  return {
    ok: false, reasonCode: 'not_an_author',
    detail: from === to
      ? `${from} is already ${to}; nothing to convert`
      : `a ${from} is not a ${to}: they are separate entities with separate lifecycles, and only Julius may state which one existed`,
  };
}

/**
 * What Wonderland may derive for its own rendering: how many sub-agents are
 * live, and which states they are in. Counts of REAL facts — the direction of
 * travel is Brain to renderer, never back.
 */
export function brainCubPresentation(facts: readonly BrainAgentFact[]): {
  readonly activeSubAgents: number;
  readonly byState: Readonly<Record<BrainSubAgentState, number>>;
  readonly compoundClones: number;
} {
  const byState: Record<BrainSubAgentState, number> = { AUTHORIZED: 0, ACTIVE: 0, SUCCEEDED: 0, FAILED: 0, CANCELLED: 0 };
  let compoundClones = 0;
  for (const fact of facts) {
    if (fact.kind === 'SUB_AGENT') byState[fact.state] += 1;
    else compoundClones += 1;
  }
  return { activeSubAgents: byState.AUTHORIZED + byState.ACTIVE, byState, compoundClones };
}
