/**
 * THE JOIN BETWEEN "A PERSON GOT IN" AND "THIS STREAM, FOR THIS RUN".
 *
 * `wonderland-entry.ts` runs the door: a person asks, the Bridge admits or
 * refuses, a renderer offers and then confirms it is presenting. What comes out
 * of that is an admitted entry naming a PROJECT, a player, and a session id the
 * Bridge chose.
 *
 * The stream needs one thing more. A world follows one RUN — the cursor, the
 * sequence, the snapshot position and the activity fold are all per run — and
 * nothing in the entry says which. That gap is where a landing page and a
 * running world would otherwise be joined by a convention nobody wrote down,
 * and conventions nobody wrote down are how a world ends up watching the wrong
 * mission with everything on screen looking correct.
 *
 * So the binding is a TYPE. It can only be made from an entry that is actually
 * presenting, it carries the run explicitly, and it produces the ingress grant
 * directly — so landing, world and stream are one chain a compiler can check
 * rather than three places that have to agree.
 *
 * WHAT IT IS NOT. This is not an avatar system, a profile, or a user record. It
 * is the smallest set of identifiers the stream needs to be scoped correctly,
 * and every one of them is already owned by something else: the project by the
 * entry, the player by the browser session, the session id by the Bridge, the
 * run by whoever chose it. Nothing here invents an identity.
 */

import { exactKeys } from './wonderland-contracts';
import { isInsideWonderland } from './wonderland-entry';
import type { WonderlandEntry, WonderlandRendererKind } from './wonderland-entry';
import type { WonderlandIngressGrant } from './wonderland-ingress';

export const WONDERLAND_WORLD_SESSION_SCHEMA_V1 = 'relay-wonderland-world-session.v1' as const;

/** Why a binding was refused. Each is a different thing to fix. */
export const WONDERLAND_BINDING_REFUSALS = [
  /** The entry never got past the door. Nothing may be scoped to it. */
  'not_admitted',
  /** Admitted, and no renderer is presenting. There is no world to scope yet. */
  'not_presenting',
  /** Admitted without the Bridge naming a session. Never invent one. */
  'no_session',
  /** The run named does not belong to the project the entry was admitted to. */
  'foreign_run',
  /** A run id that is blank. A world cannot follow a nameless run. */
  'no_run',
] as const;
export type WonderlandBindingRefusal = (typeof WONDERLAND_BINDING_REFUSALS)[number];

export interface WonderlandWorldSession {
  readonly schemaVersion: typeof WONDERLAND_WORLD_SESSION_SCHEMA_V1;
  readonly projectId: string;
  readonly playerId: string;
  /** Named by the Bridge on admission. Never derived from anything here. */
  readonly sessionId: string;
  /** The run this world follows. One, explicitly, for the reasons above. */
  readonly runId: string;
  /**
   * The Julius deployment, when the caller knows it.
   *
   * Null is honest and common: a world entering a project does not necessarily
   * know which instance is serving it, and the cursor LEARNS it from the first
   * envelope rather than demanding it up front — a cursor that insisted would
   * refuse the very envelope that would have told it.
   */
  readonly juliusInstanceId: string | null;
  /** What is drawing. Carried so a bridge can tell a stream from a preview. */
  readonly rendererKind: WonderlandRendererKind;
  readonly boundAtIso: string;
}

export const WONDERLAND_WORLD_SESSION_FIELDS = exactKeys<WonderlandWorldSession>()([
  'schemaVersion',
  'projectId',
  'playerId',
  'sessionId',
  'runId',
  'juliusInstanceId',
  'rendererKind',
  'boundAtIso',
] as const);

export type WonderlandBinding =
  | { readonly ok: true; readonly session: WonderlandWorldSession }
  | { readonly ok: false; readonly refusal: WonderlandBindingRefusal; readonly reason: string };

const REFUSAL_REASONS: Readonly<Record<WonderlandBindingRefusal, string>> = Object.freeze({
  not_admitted: 'Nothing has admitted this person to this world.',
  not_presenting: 'No renderer is presenting this world yet.',
  no_session: 'The Bridge did not name a session for this admission.',
  foreign_run: 'That run belongs to another project.',
  no_run: 'A world follows one run, and none was named.',
});

/**
 * Bind an admitted, presenting entry to the run its world will follow.
 *
 * THE ENTRY MUST BE PRESENTING, not merely admitted. An admitted entry means a
 * person may enter; a presenting one means something is actually drawing. A
 * stream scoped to the first would be delivering envelopes to a world that does
 * not exist, which is not harmful and is not free — and, more to the point, it
 * would make "is anybody watching" unanswerable from the session alone.
 */
export function bindWonderlandWorldSession(input: {
  readonly entry: WonderlandEntry;
  readonly runId: string;
  readonly boundAtIso: string;
  readonly juliusInstanceId?: string | null;
  /** The project the run belongs to, when the caller can check it. */
  readonly runProjectId?: string | null;
}): WonderlandBinding {
  const { entry } = input;

  if (entry.admission !== 'admitted') {
    return { ok: false, refusal: 'not_admitted', reason: REFUSAL_REASONS.not_admitted };
  }
  if (!isInsideWonderland(entry)) {
    return { ok: false, refusal: 'not_presenting', reason: REFUSAL_REASONS.not_presenting };
  }
  if (entry.sessionId === null || entry.sessionId.trim() === '') {
    return { ok: false, refusal: 'no_session', reason: REFUSAL_REASONS.no_session };
  }
  if (input.runId.trim() === '') {
    return { ok: false, refusal: 'no_run', reason: REFUSAL_REASONS.no_run };
  }
  // Checked only when the caller can say. A caller that cannot is not forced to
  // invent an answer — but one that CAN and gets it wrong is stopped here,
  // before a world starts drawing another project's mission.
  if (
    typeof input.runProjectId === 'string' &&
    input.runProjectId.trim() !== '' &&
    input.runProjectId !== entry.projectId
  ) {
    return { ok: false, refusal: 'foreign_run', reason: REFUSAL_REASONS.foreign_run };
  }
  if (entry.rendererKind === null) {
    return { ok: false, refusal: 'not_presenting', reason: REFUSAL_REASONS.not_presenting };
  }

  return {
    ok: true,
    session: Object.freeze({
      schemaVersion: WONDERLAND_WORLD_SESSION_SCHEMA_V1,
      projectId: entry.projectId,
      playerId: entry.playerId,
      sessionId: entry.sessionId,
      runId: input.runId,
      juliusInstanceId: input.juliusInstanceId ?? null,
      rendererKind: entry.rendererKind,
      boundAtIso: input.boundAtIso,
    }),
  };
}

/**
 * The ingress grant this session may use. THE WHOLE POINT OF THE TYPE.
 *
 * A grant made anywhere else would be a second place where a project and a run
 * are put together, and the two would eventually disagree. Made here, a stream
 * can only ever be scoped to what somebody was actually admitted to.
 */
export function wonderlandWorldSessionGrant(
  session: WonderlandWorldSession,
): WonderlandIngressGrant {
  return Object.freeze({ projectId: session.projectId, runId: session.runId });
}

/**
 * The query a world sends to the Bridge for this session.
 *
 * Returned as fields rather than a URL because building one here would put a
 * route's shape in the domain, and the domain does not know where the Bridge
 * lives or what it calls its paths.
 */
export interface WonderlandStreamRequest {
  readonly projectId: string;
  readonly runId: string;
  readonly cursor: number;
}

export function wonderlandStreamRequest(
  session: WonderlandWorldSession,
  cursor: number,
): WonderlandStreamRequest {
  return Object.freeze({
    projectId: session.projectId,
    runId: session.runId,
    // A cursor that is not a position asks from the beginning, which is the
    // safe direction: ordering refuses what the world already holds, so the
    // cost is bandwidth rather than a wrong picture.
    cursor: Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0,
  });
}

/** True when this session is streaming into a real Unreal client. */
export const wonderlandSessionIsPixelStreamed = (session: WonderlandWorldSession): boolean =>
  session.rendererKind === 'unreal_pixel_stream';
