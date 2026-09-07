import { useCallback, useRef, useState } from 'react';

import {
  canRequestWonderland,
  isInsideWonderland,
  refuseWonderlandAdmission,
  wonderlandEntryDetail,
  wonderlandEntryHeadline,
} from '../../mission/wonderland/wonderland-entry';
import type { WonderlandEntry } from '../../mission/wonderland/wonderland-entry';
import { joinWonderland } from './join-wonderland';
import {
  beginWonderlandJoin,
  preferredWonderlandRenderer,
  wonderlandEntryForReadiness,
} from './wonderland-renderers';
import { readinessLabel } from '../relay-experience/wonderland-handoff';
import type { WonderlandReadiness } from '../relay-experience/wonderland-handoff';

/**
 * THE ENTRY BUTTON'S STATE, AND NOTHING ELSE.
 *
 * All the decisions live in the domain; this holds one entry, runs the one
 * network call, and hands back a label. There is no second source of truth
 * here — no `isLoading`, no `error`, no `entered`. A hook with its own flags
 * beside a state machine is a hook that will eventually disagree with it, and
 * the disagreement always resolves in favour of whichever one the button reads.
 *
 * WHAT IT WILL NOT DO. It will not report arrival. `joinWonderland` can return
 * `admitted` and that is as far as this build goes, because
 * `preferredWonderlandRenderer()` is null — so the label a founder sees after a
 * successful join says the world let them in and nothing here can draw it. That
 * is the truth, and a spinner that never resolved or a navigation to a blank
 * page would both be worse ways of saying it.
 */

export interface WonderlandEntryController {
  readonly entry: WonderlandEntry;
  /**
   * WHAT THE TELEMETRY STRIP SHOWS about the entrance.
   *
   * The readiness label until something has actually been attempted, and the
   * entry's own headline afterwards. One question — what is the state of the
   * entrance — with a state-dependent answer, and the split matters: a build
   * with no bridge configured has not been REFUSED, it was never asked, and
   * `READY · ENTRANCE UNREACHABLE` says that where `ENTRY REFUSED` would put
   * words in the bridge's mouth.
   */
  readonly label: string;
  /** The entry's own headline, regardless of whether anything was attempted. */
  readonly headline: string;
  /** The sentence under it, or null when there is nothing to add. */
  readonly detail: string | null;
  /** Whether a join has actually been asked for in this browser. */
  readonly attempted: boolean;
  readonly canEnter: boolean;
  readonly inside: boolean;
  /** Idempotent while a request is in flight. */
  readonly enter: () => void;
}

export function useWonderlandEntry(input: {
  readonly readiness: WonderlandReadiness;
  readonly projectId: string;
  readonly playerId: string;
  /** Injected in tests. Production passes nothing. */
  readonly join?: typeof joinWonderland;
  readonly now?: () => string;
  readonly newCommandId?: () => string;
}): WonderlandEntryController {
  const gate = wonderlandEntryForReadiness(input.readiness, {
    projectId: input.projectId,
    playerId: input.playerId,
  });
  // The gate is the starting point until something has been attempted. Holding
  // it in state instead would freeze a stale readiness: a person who signs in
  // after seeing "sign in to enter" must see the button come alive without
  // having to reload.
  const [attempted, setAttempted] = useState<WonderlandEntry | null>(null);
  const entry = attempted ?? gate;

  // A join in flight, guarded by a ref rather than by the entry's own state:
  // React batches, and two clicks in one frame would both read `not_requested`
  // and both post. A second join is a second presence.
  const joining = useRef(false);

  const join = input.join ?? joinWonderland;
  const now = input.now ?? (() => new Date().toISOString());
  const newCommandId =
    input.newCommandId ?? (() => `wonderland-join:${Math.random().toString(36).slice(2)}`);

  const enter = useCallback(() => {
    if (joining.current) return;
    if (!canRequestWonderland(entry)) return;
    joining.current = true;
    const requesting = beginWonderlandJoin(entry);
    setAttempted(requesting);
    void join({ entry: requesting, commandId: newCommandId(), atIso: now() })
      .then((next) => {
        setAttempted(next);
      })
      .catch(() => {
        // `joinWonderland` folds its own failures into a refusal, so reaching
        // here means the call itself broke rather than the bridge refusing.
        // Leaving the entry in `requesting` would strand the button on ENTERING
        // forever, which is the one outcome with no way back.
        setAttempted(
          refuseWonderlandAdmission(requesting, {
            reason: 'Entering Wonderland failed unexpectedly in this browser.',
          }),
        );
      })
      .finally(() => {
        joining.current = false;
      });
  }, [entry, join, newCommandId, now]);

  return {
    entry,
    label: attempted === null ? readinessLabel(input.readiness) : wonderlandEntryHeadline(entry),
    headline: wonderlandEntryHeadline(entry),
    detail: wonderlandEntryDetail(entry),
    attempted: attempted !== null,
    // `preferredWonderlandRenderer` is not consulted here: whether a renderer
    // exists decides what happens AFTER admission, never whether asking is
    // allowed. Conflating them would hide the entrance in a build that could
    // legitimately join a world it cannot yet draw.
    canEnter: canRequestWonderland(entry) && input.readiness.kind === 'ready',
    inside: isInsideWonderland(entry),
    enter,
  };
}

/** Re-exported so a surface needs one import to know whether to offer a world. */
export { preferredWonderlandRenderer };
