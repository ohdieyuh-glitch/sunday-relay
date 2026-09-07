import { useCallback, useMemo, useState } from 'react';

import {
  applyWonderlandUsageReport,
  emptyWonderlandUsageAuthority,
  projectWonderlandUsageFromAuthority,
} from '../../mission/wonderland/wonderland-usage-authority';
import type {
  WonderlandUsageAuthorityState,
  WonderlandUsageAuthorityStatus,
  WonderlandUsageReport,
} from '../../mission/wonderland/wonderland-usage-authority';
import type { WonderlandUsageHud } from '../../mission/wonderland/wonderland-usage-meter';

/**
 * THE HUD'S NUMBERS, FROM THE ONLY PLACE ALLOWED TO SUPPLY THEM.
 *
 * The HUD was mounted with a simulated fixture handed to it directly, which
 * bypassed the usage authority entirely. Two things were wrong with that and
 * only the second is obvious.
 *
 * The obvious one: this repository's rule is that simulated data says so AND
 * that normal production navigation never loads it. The other usage bar already
 * obeys that — `usage-integration.test.tsx` asserts an offline production
 * render says `USAGE · UNAVAILABLE` and contains no simulated label. The
 * Wonderland HUD sat on the same navigation path showing invented figures.
 *
 * The less obvious one, and the reason this is a hook rather than a default
 * argument: a fixture passed straight to the view means the authority's
 * REFUSALS never run. Foreign-project reports, stale revisions and malformed
 * reports are rejected inside `applyWonderlandUsageReport`, and a surface that
 * can put figures on screen without passing through it has a second, unguarded
 * way in. Routing everything through here means there is no path around them.
 *
 * WHAT A BUILD WITH NO AUTHORITY SHOWS. `not_reported` — the HUD draws Unknown
 * and labels itself NO USAGE AUTHORITY REPORTING. That is the truthful state
 * today, and it is the state this returns until something calls `report`.
 */

export interface WonderlandUsageController {
  readonly hud: WonderlandUsageHud;
  readonly status: WonderlandUsageAuthorityStatus;
  /**
   * Fold in a report from a usage authority.
   *
   * Takes the REPORT rather than figures, so a caller cannot supply numbers
   * without also supplying the project, revision, timestamp and authority id
   * that make them checkable. Everything the authority refuses is refused here.
   */
  readonly report: (next: WonderlandUsageReport) => void;
}

export function useWonderlandUsage(input: {
  readonly projectId: string;
  /**
   * The observation instant. Injected so staleness is testable — a hook that
   * read the clock could be tested for `known` and never for the transition,
   * and the transition is the whole feature.
   */
  readonly now?: () => string;
  readonly staleAfterSeconds?: number;
}): WonderlandUsageController {
  const [state, setState] = useState<WonderlandUsageAuthorityState>(() =>
    emptyWonderlandUsageAuthority({
      projectId: input.projectId,
      staleAfterSeconds: input.staleAfterSeconds,
    }),
  );

  const now = input.now;
  const projection = useMemo(
    () => projectWonderlandUsageFromAuthority(state, now ? now() : new Date().toISOString()),
    [state, now],
  );

  const report = useCallback((next: WonderlandUsageReport) => {
    setState((current) => applyWonderlandUsageReport(current, next));
  }, []);

  return { hud: projection.hud, status: projection.status, report };
}
