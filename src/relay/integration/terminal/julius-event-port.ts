/**
 * THE JULIUS EVENT PORT — one normalized shape every Julius event source maps
 * into, declared on Relay's side of the boundary.
 *
 * WHY THIS IS NOT A SECOND JULIUS EVENT SYSTEM. Julius's durable runtime owns
 * event persistence, ordering and delivery; none of that is here. What IS here
 * is the SHAPE Relay is willing to read — because Relay has three consumers
 * that must all agree (the website, the Wonderland Live Terminal, and any
 * future CLI), and three consumers reading a runtime type directly is three
 * independent interpretations of it.
 *
 * ONE PROJECTION MODEL. Every surface renders the output of
 * `projectJuliusEvent`. A surface that formats a Julius event itself is a
 * fourth interpretation, and the first place a role label, a redaction or a
 * severity silently disagrees.
 *
 * WHEN THE RUNTIME'S EVENT TYPE MERGES, an adapter maps it into
 * {@link JuliusOperationalEvent} and nothing in the projection changes. That
 * adapter is the only place that will need to know the runtime's field names.
 *
 * PURE. No Node, no network, no clock.
 */

import { COMPOUND_AGENT_SLOTS, type CompoundAgentSlot } from '../compound-agent';

export const JULIUS_EVENT_PORT_VERSION = 'relay-julius-event.v1' as const;

/* ------------------------------------------------------------- the actors */

/**
 * WHO A TERMINAL LINE IS ATTRIBUTED TO — the permanent labels, and only these.
 *
 * The three worker actors are DERIVED from `COMPOUND_AGENT_SLOTS`, which is
 * itself derived from `JULIUS_DEFAULT_ROLES`, so a worker role cannot exist in
 * the configuration layer and be unlabelable in the terminal. The rest are
 * subsystems rather than workers: `JULIUS` is the harness itself,
 * `RELAY_VERIFICATION` is Relay's own verification (never a worker's claim
 * about it), and `SUB_AGENT` covers every specialist Julius spawns — a
 * specialist's own name is not a permanent label and never becomes one.
 *
 * A PROVIDER NAME IS NEVER A LABEL. "GPT said" and "Claude said" would make
 * the terminal a transcript of vendors; the product's line is that a ROLE did
 * the work and the occupant of that role is a separate, attested fact.
 */
export const JULIUS_EVENT_ACTORS = [
  'RELAY_SYSTEM',
  'JULIUS',
  ...COMPOUND_AGENT_SLOTS,
  'RELAY_VERIFICATION',
  'SUB_AGENT',
  'GAUNTLET',
  'CARD',
  'PROJECT_BRAIN',
] as const;
export type JuliusEventActor = (typeof JULIUS_EVENT_ACTORS)[number];

/** The exact human label for each actor. The terminal renders these verbatim. */
export const TERMINAL_ROLE_LABELS: Readonly<Record<JuliusEventActor, string>> = Object.freeze({
  RELAY_SYSTEM: 'Relay System',
  JULIUS: 'Julius',
  PROMPT_ARCHITECT: 'Prompt Architect',
  CODING_AGENT: 'Coding Agent',
  INDEPENDENT_REVIEWER: 'Independent Reviewer',
  RELAY_VERIFICATION: 'Relay Verification',
  SUB_AGENT: 'Sub-Agent',
  GAUNTLET: 'Gauntlet',
  CARD: 'C.A.R.D.',
  PROJECT_BRAIN: 'Project Brain',
} as Record<JuliusEventActor, string>);

/** Whether a worker slot has a terminal actor of the same name. */
export function actorForWorkerSlot(slot: CompoundAgentSlot): JuliusEventActor {
  return slot;
}

/* -------------------------------------------------------------- the facts */

/**
 * STRUCTURED FACTS, NOT A PAYLOAD.
 *
 * A projection that formats numbers out of prose is a projection that breaks
 * when the prose changes. `facts` carries the values a headline is composed
 * from — a round, a finding count, a capability — as scalars, so
 * "2 blocking findings" is produced from the number 2 rather than parsed back
 * out of a sentence.
 *
 * Scalars only, on purpose. A nested object is somewhere a provider payload
 * can hide, and there is no shape here for one to hide in.
 */
export type JuliusEventFact = string | number | boolean | null;

export interface JuliusOperationalEvent {
  readonly eventId: string;
  /** Monotonic within a run. Gaps are DETECTED, never filled. */
  readonly sequence: number;
  readonly occurredAt: string;
  readonly runId: string;
  /**
   * What happened, as a stable dotted kind. An UNRECOGNISED kind is rendered
   * safely rather than dropped or guessed at — see `projectJuliusEvent`.
   */
  readonly kind: string;
  readonly actor: JuliusEventActor;
  /** Julius's own safe summary. Re-sanitized here regardless. */
  readonly safeSummary: string;
  readonly taskId: string | null;
  readonly severity: 'info' | 'warning' | 'blocking' | null;
  readonly facts: Readonly<Record<string, JuliusEventFact>>;
}

/**
 * A SOURCE OF JULIUS EVENTS, as Relay needs to read them.
 *
 * `since` is a sequence, so a reconnecting surface resumes from what it last
 * confirmed rather than replaying a run from the beginning. `gapDetected`
 * exists because a gap must be VISIBLE: a terminal that silently renumbers
 * around a missing event is a terminal claiming it showed everything.
 */
export interface JuliusEventSource {
  readonly portVersion: typeof JULIUS_EVENT_PORT_VERSION;
  since(runId: string, sequence: number): Promise<{
    readonly events: readonly JuliusOperationalEvent[];
    readonly gapDetected: boolean;
    readonly lastSequence: number;
  }>;
}
