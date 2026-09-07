/**
 * THE LINK — the one thing that composes the seam, and the seam's honesty label.
 *
 * Everything else in this integration is a table or a fold. This is the piece
 * that puts them in a line:
 *
 *   JuliusOperationalEvent[]      the kernel's own catalogue
 *     -> normalizeJuliusOperationalEvents   (world events, ledger-numbered)
 *     -> applyJuliusEvent                   (one embodiment, ordering enforced)
 *     -> activity / motion / animation      (the clip Unreal plays)
 *
 * WHY IT EXISTS RATHER THAN LEAVING CALLERS TO WIRE IT. Three of those steps
 * have rules that only bite when they are applied together — the ledger
 * allocates the sequence, a silent kernel event must consume none, and the
 * embodiment's cursor must end up exactly where a reconnect would resume. A
 * caller assembling them by hand gets each rule right in isolation and the
 * combination wrong, which is precisely the class of defect this repository
 * keeps finding. One composition, tested once.
 *
 * THE LABEL IS NOT OPTIONAL, and it is the reason this file is not just a
 * helper. A link must declare where its events CAME FROM, and the label travels
 * on the status rather than sitting in a caller's variable:
 *
 *   live_runtime          a real Julius run produced these
 *   development_fixture   they were written by a human, for a demo or a test
 *
 * Nothing in this module can produce the first label from the second, and a
 * surface reaching the embodiment has necessarily passed the status to get it.
 * The alternative — an unlabelled fold — is how a scripted demo ends up
 * indistinguishable from a mission, which is the single untruth this whole
 * product is built to refuse.
 *
 * IMMUTABLE. `observe` returns a NEW link; nothing here mutates. That is what
 * makes the reconnect story testable: two links folding the same events in
 * different groupings must be indistinguishable, and a mutable one would let
 * a caller's retained reference quietly answer for a state it no longer holds.
 *
 * PURE. No clock, no network, no ids generated here.
 */

import type { JuliusOperationalEvent } from '../julius/julius-events';
import type { WonderlandEvent } from './wonderland-backend';
import {
  applyJuliusEvent,
  emptyJuliusEmbodiment,
  juliusReplayCursor,
} from './wonderland-julius-state';
import type { JuliusEmbodiment } from './wonderland-julius-state';
import { normalizeJuliusOperationalEvents } from './wonderland-julius-normalizer';
import type { JuliusNormalizationIdentity } from './wonderland-julius-normalizer';

/* ---------------------------------------------------------------- source */

/**
 * Where a link's events came from. There is no third member and there must not
 * be one: "probably live" is not a provenance.
 */
export const WONDERLAND_JULIUS_LINK_SOURCES = ['live_runtime', 'development_fixture'] as const;
export type WonderlandJuliusLinkSource = (typeof WONDERLAND_JULIUS_LINK_SOURCES)[number];

/**
 * The words a surface shows. Uppercase and unambiguous, because the whole point
 * is that a viewer can tell the two apart at a glance.
 */
export const WONDERLAND_JULIUS_LINK_LABEL: Readonly<
  Record<WonderlandJuliusLinkSource, string>
> = Object.freeze({
  live_runtime: 'LIVE RUNTIME',
  development_fixture: 'DEVELOPMENT FIXTURE · NOT A MISSION',
});

/* ---------------------------------------------------------------- status */

export interface WonderlandJuliusLinkStatus {
  readonly source: WonderlandJuliusLinkSource;
  readonly sourceLabel: string;
  /** True only once the link has actually applied an event. Never configured-therefore-connected. */
  readonly observed: boolean;
  /** The cursor a reconnect resumes from. Identical to the embodiment's. */
  readonly cursor: number;
  /** World events this link produced. */
  readonly published: number;
  /** Kernel events with no truthful world type. Counted, never faked. */
  readonly silentJuliusEvents: number;
}

export interface WonderlandJuliusLink {
  readonly status: WonderlandJuliusLinkStatus;
  readonly embodiment: JuliusEmbodiment;
}

export interface WonderlandJuliusLinkInput {
  readonly source: WonderlandJuliusLinkSource;
  readonly projectId: string;
  readonly identity?: JuliusNormalizationIdentity;
}

/** A link that has been told nothing. `observed` is false and the state is null. */
export function createWonderlandJuliusLink(
  input: WonderlandJuliusLinkInput,
): WonderlandJuliusLink {
  return Object.freeze({
    status: Object.freeze({
      source: input.source,
      sourceLabel: WONDERLAND_JULIUS_LINK_LABEL[input.source],
      observed: false,
      cursor: 0,
      published: 0,
      silentJuliusEvents: 0,
    }),
    embodiment: emptyJuliusEmbodiment({
      projectId: input.projectId,
      missionId: input.identity?.missionId ?? null,
      agentId: input.identity?.agentId ?? null,
    }),
  });
}

export interface WonderlandJuliusObservation {
  readonly link: WonderlandJuliusLink;
  /**
   * The world events this call produced, in order.
   *
   * Returned rather than kept, because they belong to whatever durable log the
   * caller owns. A link that retained them would be a second event store with
   * no replay, no ordering guarantee and no way to be read back.
   */
  readonly published: readonly WonderlandEvent[];
}

/**
 * Fold a run of kernel events through the whole seam.
 *
 * `nextEventId` is injected for the same reason the sequence is: an id
 * generated here would be non-deterministic, and a seam whose output changes
 * between two identical inputs cannot be tested for the ordering properties
 * that are the entire reason it exists.
 *
 * The sequence continues from the link's own cursor, so calling this once with
 * ten events and twice with five is the same fold — which the test asserts,
 * because "the stream arrived in two pieces" is the normal case and not an
 * edge one.
 */
export function observeJuliusEvents(
  link: WonderlandJuliusLink,
  events: readonly JuliusOperationalEvent[],
  input: {
    readonly identity?: JuliusNormalizationIdentity;
    readonly nextEventId: (event: JuliusOperationalEvent, index: number) => string;
  },
): WonderlandJuliusObservation {
  const normalized = normalizeJuliusOperationalEvents(events, {
    baseSequence: link.status.cursor,
    nextEventId: input.nextEventId,
    identity: input.identity,
  });
  const embodiment = normalized.events.reduce(applyJuliusEvent, link.embodiment);

  return Object.freeze({
    published: normalized.events,
    link: Object.freeze({
      status: Object.freeze({
        ...link.status,
        // OBSERVED means an event was APPLIED, not that one arrived. A run of
        // events the model does not map leaves the link exactly as unobserved
        // as it was, which is the truthful answer.
        observed: link.status.observed || embodiment.visualState !== null,
        cursor: juliusReplayCursor(embodiment),
        published: link.status.published + normalized.events.length,
        silentJuliusEvents: link.status.silentJuliusEvents + normalized.silentEvents,
      }),
      embodiment,
    }),
  });
}

/* -------------------------------------------------------------- fixtures */

/**
 * A SCRIPTED RUN, for looking at the world without spending anything.
 *
 * It is a demo and a test input, and `development_fixture` is the only source a
 * link built from it may carry — there is no code path here that could produce
 * `live_runtime`, which is the guarantee rather than the comment.
 *
 * The shape is the kernel's own: `run.transitioned` carrying the destination
 * state in `facts.to`, exactly as the runtime emits it. That matters more than
 * it looks — a fixture written in a shape the runtime does not use would
 * exercise a path production never takes and pass while the real one broke.
 */
export const WONDERLAND_JULIUS_DEV_SCRIPT: readonly JuliusOperationalEvent[] = Object.freeze(
  (
    [
      ['run.created', {}],
      ['run.transitioned', { to: 'PLANNING' }],
      ['context.compiled', { tokens: 4211 }],
      ['run.transitioned', { to: 'READY' }],
      ['run.transitioned', { to: 'EXECUTING' }],
      ['budget.reserved', { usdMicros: 120_000 }],
      ['run.transitioned', { to: 'REVIEWING' }],
      ['finding.recorded', { severity: 'MEDIUM' }],
      ['run.transitioned', { to: 'REPAIRING' }],
      ['run.transitioned', { to: 'VERIFYING' }],
      ['run.transitioned', { to: 'COMPLETED' }],
      ['run.completed', {}],
    ] as const
  ).map(([type, facts], index) =>
    Object.freeze({
      eventId: `dev-julius-${index + 1}`,
      runId: 'dev-run-1',
      projectId: 'dev-project-1',
      type,
      taskId: null,
      workerId: null,
      correlationId: 'dev-correlation-1',
      causationId: null,
      // Fixed instants. A fixture that refreshed its own clock would look more
      // live than it is.
      occurredAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      facts,
    } as JuliusOperationalEvent),
  ),
);

/** The project the dev script belongs to. Named so a caller cannot mistype it. */
export const WONDERLAND_JULIUS_DEV_PROJECT = 'dev-project-1';

/**
 * The dev script, folded. A whole labelled run in one call.
 *
 * Deliberately returns the LINK rather than the embodiment, so a caller cannot
 * reach the state without also holding the label that says it is not a mission.
 */
export function wonderlandJuliusDevLink(): WonderlandJuliusLink {
  return observeJuliusEvents(
    createWonderlandJuliusLink({
      source: 'development_fixture',
      projectId: WONDERLAND_JULIUS_DEV_PROJECT,
      identity: { missionId: 'dev-mission-1', agentId: 'dev-agent-1' },
    }),
    WONDERLAND_JULIUS_DEV_SCRIPT,
    {
      identity: { missionId: 'dev-mission-1', agentId: 'dev-agent-1' },
      nextEventId: (_event, index) => `dev-world-${index + 1}`,
    },
  ).link;
}
