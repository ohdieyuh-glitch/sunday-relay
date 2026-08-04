/**
 * SUNDAY RELAY — THE BROWSER'S VIEW OF A RUNNING LOOP.
 *
 * A pure projection from what the SERVER said into what the screen shows. The
 * browser owns none of this: not the state, not the usage, not whether a
 * control may be pressed, not whether the Loop is finished.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE. A surface may only animate "working"
 * when the server has reported a state that means work is happening. Not a
 * timer, not an optimistic flag set when the user clicked Start, not "we sent
 * a request and have not heard back". Those all produce a spinner that keeps
 * spinning after a run has failed, which is the single most common way a
 * product lies about a background job — and the user's only signal that
 * anything is wrong is that it never stops.
 *
 * So `activity` is derived from the server's state class alone. Before the
 * first response there is no run, and the view says so rather than pretending.
 *
 * RESTORATION IS A READ, NOT A CACHE. The browser persists ONE thing across a
 * refresh: the run id. Everything else is fetched. A cached projection would
 * survive a refresh and show a completed run as still running, and the user
 * would have no way to tell it was stale.
 *
 * PURE. No fetch, no storage, no timers — the host injects all three.
 */

import type { LoopStatusProjection } from '../../mission';

/* ------------------------------------------------------------- activity */

/**
 * What the surface is allowed to show as happening.
 *
 * `working` is the only value that may animate. `waiting` deliberately does
 * not: a run blocked on approval or a budget is making no progress, and a
 * spinner would say otherwise once a second for as long as it is stuck.
 */
export const RELAY_LOOP_ACTIVITY = ['none', 'working', 'waiting', 'stopping', 'at_rest', 'finished', 'attention'] as const;
export type RelayLoopActivity = (typeof RELAY_LOOP_ACTIVITY)[number];

export function activityFor(status: LoopStatusProjection | null): RelayLoopActivity {
  if (status === null) return 'none';
  switch (status.stateClass) {
    case 'active':
      return 'working';
    case 'waiting':
      return 'waiting';
    case 'stopping':
      return 'stopping';
    case 'resumable':
      return 'at_rest';
    case 'successful_terminal':
    case 'unsuccessful_terminal':
    case 'exhausted':
      return 'finished';
    case 'recovery':
      return 'attention';
    default:
      // `initial` — admitted, nothing dispatched. Not working yet.
      return 'none';
  }
}

/* -------------------------------------------------------------- controls */

export interface RelayLoopRunControlView {
  readonly action: 'pause' | 'resume' | 'stop';
  readonly enabled: boolean;
  /** Why it is unavailable. `null` when it is available. */
  readonly unavailableReason: string | null;
}

/**
 * Which controls this run state permits.
 *
 * Derived from the SERVER's state, never from what the user last clicked. A
 * button enabled optimistically produces a request the server refuses, and the
 * surface then has to explain a failure it caused itself.
 */
export function controlsFor(status: LoopStatusProjection | null): readonly RelayLoopRunControlView[] {
  const disabled = (action: RelayLoopRunControlView['action'], reason: string): RelayLoopRunControlView =>
    ({ action, enabled: false, unavailableReason: reason });
  const enabled = (action: RelayLoopRunControlView['action']): RelayLoopRunControlView =>
    ({ action, enabled: true, unavailableReason: null });

  if (status === null) {
    const reason = 'There is no run yet.';
    return [disabled('pause', reason), disabled('resume', reason), disabled('stop', reason)];
  }
  if (status.finished) {
    const reason = `This run ended in ${status.state.replace(/_/g, ' ')}. A finished run takes no further actions.`;
    return [disabled('pause', reason), disabled('resume', reason), disabled('stop', reason)];
  }
  if (status.state === 'recovery_required') {
    // Deliberately NOT offering Resume. Stage 2 auto-resumes nothing, and an
    // enabled button here would suggest the uncertainty can be clicked away.
    const reason = 'This run is held for inspection because its state cannot be vouched for.';
    return [disabled('pause', reason), disabled('resume', reason), enabled('stop')];
  }
  if (status.state === 'paused') {
    return [
      disabled('pause', 'This run is already paused.'),
      enabled('resume'),
      enabled('stop'),
    ];
  }
  if (status.state === 'pausing') {
    return [
      disabled('pause', 'A pause is already in progress.'),
      disabled('resume', 'Wait for the pause to reach a safe checkpoint.'),
      enabled('stop'),
    ];
  }
  if (status.state === 'stopping') {
    const reason = 'A stop is already in progress.';
    return [disabled('pause', reason), disabled('resume', reason), disabled('stop', reason)];
  }
  return [
    enabled('pause'),
    disabled('resume', 'This run is not paused.'),
    enabled('stop'),
  ];
}

/* ----------------------------------------------------------------- view */

export interface RelayLoopUsageLine {
  readonly label: string;
  readonly value: string;
  /** True when the value is Unknown. A surface may style it differently; it
   *  may never replace it with a number. */
  readonly unknown: boolean;
}

export interface RelayLoopRunView {
  readonly runId: string | null;
  readonly loopId: string | null;
  readonly headline: string;
  readonly activity: RelayLoopActivity;
  /** Only ever true for `completed`. */
  readonly succeeded: boolean;
  readonly finished: boolean;
  readonly identityLines: readonly { readonly label: string; readonly value: string; readonly unknown: boolean }[];
  readonly usageLines: readonly RelayLoopUsageLine[];
  readonly blocker: string | null;
  readonly requiredUserAction: string | null;
  readonly failure: string | null;
  readonly controls: readonly RelayLoopRunControlView[];
  /** What the surface should say when there is nothing to show yet. */
  readonly emptyReason: string | null;
}

const UNKNOWN = 'Unknown';

function spend(status: LoopStatusProjection): RelayLoopUsageLine {
  const { usage } = status;
  if (usage.spendUnknown || usage.knownSpendMicros === null) {
    return { label: 'Spend', value: UNKNOWN, unknown: true };
  }
  const dollars = Number(BigInt(usage.knownSpendMicros)) / 1_000_000;
  const cap = usage.maxSpendMicros === null
    ? 'no limit'
    : (Number(BigInt(usage.maxSpendMicros)) / 1_000_000).toFixed(2);
  return {
    label: 'Spend',
    value: `${dollars.toFixed(4)} / ${cap}${usage.currency === null ? '' : ` ${usage.currency}`}`,
    unknown: false,
  };
}

/**
 * Build everything the run panel renders.
 *
 * `status === null` is a first-class case: it means the browser has no run, or
 * has not fetched one yet. It renders as an explanation, never as an empty run
 * that looks idle.
 */
export function projectLoopRunView(input: {
  readonly status: LoopStatusProjection | null;
  /** Why there is no run, when there is none. */
  readonly emptyReason?: string;
}): RelayLoopRunView {
  const { status } = input;
  if (status === null) {
    return {
      runId: null,
      loopId: null,
      headline: 'No Loop run',
      activity: 'none',
      succeeded: false,
      finished: false,
      identityLines: [],
      usageLines: [],
      blocker: null,
      requiredUserAction: null,
      failure: null,
      controls: controlsFor(null),
      emptyReason: input.emptyReason ?? 'Draft a Loop and confirm it to start a run.',
    };
  }

  const identity = status.identity;
  return {
    runId: status.runId,
    loopId: status.loopId,
    headline: status.state.replace(/_/g, ' '),
    activity: activityFor(status),
    succeeded: status.succeeded,
    finished: status.finished,
    identityLines: identity === null ? [] : [
      {
        label: 'Role',
        value: identity.requestedRole === identity.resolvedRole
          ? identity.requestedRole
          : `${identity.requestedRole} → ${identity.resolvedRole}`,
        unknown: false,
      },
      // Requested and actual are shown SEPARATELY and the actual one is
      // Unknown until observed. Showing the requested model in the actual slot
      // would be the surface inventing provenance.
      { label: 'Agent', value: identity.actualAgentId ?? UNKNOWN, unknown: identity.actualAgentId === null },
      { label: 'Model requested', value: identity.requestedModel ?? 'none', unknown: false },
      { label: 'Model actual', value: identity.actualModel ?? UNKNOWN, unknown: identity.actualModel === null },
    ],
    usageLines: [
      {
        label: 'Iterations',
        value: `${status.usage.iterationsStarted} / ${status.usage.maxIterations ?? 'no limit'}`,
        unknown: false,
      },
      spend(status),
      {
        label: 'Tokens',
        value: status.usage.tokensUnknown || status.usage.tokensUsed === null
          ? UNKNOWN
          : `${status.usage.tokensUsed} / ${status.usage.maxTotalTokens ?? 'no limit'}`,
        unknown: status.usage.tokensUnknown || status.usage.tokensUsed === null,
      },
      {
        label: 'Provider calls',
        value: `${status.usage.providerCallsUsed} / ${status.usage.maxProviderCalls ?? 'no limit'}`,
        unknown: false,
      },
    ],
    blocker: status.blocker?.detail ?? null,
    requiredUserAction: status.blocker?.requiredUserAction ?? null,
    failure: status.latestFailure?.summary ?? null,
    controls: controlsFor(status),
    emptyReason: null,
  };
}

/* ------------------------------------------------------------ restoring */

/** The ONLY thing a browser persists about a run across a refresh. */
export interface RelayLoopRestorePoint {
  readonly runId: string;
  readonly loopId: string;
}

export function restorePointFor(status: LoopStatusProjection | null): RelayLoopRestorePoint | null {
  return status === null ? null : { runId: status.runId, loopId: status.loopId };
}

/**
 * Is this stored restore point usable?
 *
 * Shape only. Whether the run still exists, and what state it is in, are
 * questions only the server can answer — and the surface must ask it rather
 * than trusting anything it stored.
 */
export function isUsableRestorePoint(value: unknown): value is RelayLoopRestorePoint {
  if (value === null || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return typeof point.runId === 'string' && point.runId.startsWith('lpr_')
    && typeof point.loopId === 'string' && point.loopId.startsWith('lpe_');
}
