/**
 * SUNDAY RELAY — PROJECT BRAIN LLMOPS
 * Intake: turning what an adapter observed into operational signal.
 *
 * This is where "unknown is not zero" is either honoured or lost, because it is
 * the only place a `null` from a provider meets a metric. Every function here
 * takes a STRUCTURAL type rather than importing a connector's interface: the
 * domain must not depend on any particular adapter, and an import edge from
 * `mission/` into `connectors/` would invert the same layering the website
 * boundary rule protects.
 *
 * THE RULE, stated once and applied everywhere below:
 *
 *   A null, a NaN, a negative, or an "unavailable" class produces NO SAMPLE.
 *   Not a zero, not an omitted field with a default — nothing enters the array.
 *   The projection then reports that phase under `missingPhases`, by name.
 *
 * The temptation this resists is small and constant: a dashboard with a gap in
 * it looks broken, and `?? 0` makes the gap go away. It makes the gap go away
 * by asserting the run was instantaneous.
 */

import type {
  RelayErrorEvent, RelayErrorKind, RelayLatencyPhase, RelayLatencySample,
  RelayOperationalRecord,
} from './llmops-contracts';
// Short-term memory lives in `brain-memory`, not in the signal contracts.
import type { RelayShortTermEntry, RelayShortTermMemory } from './brain-memory';
import { rememberShortTerm } from './brain-memory';

/* ------------------------------------------------------------- durations */

/**
 * What an adapter can tell us about one turn. Every field is nullable because
 * every field genuinely can be absent: a cached response has no generation
 * time, a subscription-associated run reports no cost, and a crashed process
 * reports nothing at all.
 */
export interface ObservedTurn {
  /** Wall-clock for the whole turn. */
  readonly durationMs?: number | null;
  /** Time inside the provider API, when the adapter can separate it. */
  readonly apiDurationMs?: number | null;
  /** Time spent running tools, when the adapter can separate it. */
  readonly toolDurationMs?: number | null;
  /** Time queued before work started. */
  readonly queuedMs?: number | null;
  /**
   * Whether the adapter could observe usage at all. `unavailable` means the
   * numbers above are not merely absent but UNKNOWABLE for this turn, and no
   * sample is produced from any of them even if one happens to be present.
   */
  readonly usageClass?: 'provider-reported' | 'subscription-associated' | 'estimated' | 'unavailable';
  /** ISO-8601. When the turn ENDED. */
  readonly observedAt: string;
  readonly missionId?: string;
  readonly taskId?: string;
}

/** A duration is usable only if it is a finite, non-negative number. */
function usableDuration(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Latency samples for one turn. Returns only the phases actually observed —
 * frequently none, and an empty array is the correct answer rather than a
 * failure.
 */
export function samplesFromTurn(turn: ObservedTurn): RelayLatencySample[] {
  // An adapter that could not observe usage has not observed a fast turn.
  // Compared case-insensitively: an adapter that reports `UNAVAILABLE` has not
  // observed a fast turn either.
  if ((turn.usageClass ?? '').toLowerCase() === 'unavailable') return [];
  if (!Number.isFinite(Date.parse(turn.observedAt))) return [];

  const pairs: readonly (readonly [RelayLatencyPhase, number | null | undefined])[] = [
    ['total', turn.durationMs],
    ['generation', turn.apiDurationMs],
    ['tool_execution', turn.toolDurationMs],
    ['queue', turn.queuedMs],
  ];

  const samples: RelayLatencySample[] = [];
  for (const [phase, raw] of pairs) {
    const durationMs = usableDuration(raw);
    if (durationMs === null) continue;
    samples.push({
      phase,
      durationMs,
      observedAt: turn.observedAt,
      ...(turn.missionId === undefined ? {} : { missionId: turn.missionId }),
      ...(turn.taskId === undefined ? {} : { taskId: turn.taskId }),
    });
  }
  return samples;
}

/* ---------------------------------------------------------------- errors */

/** What an adapter can tell us about a failure. */
export interface ObservedFailure {
  /** The adapter's own label. Mapped conservatively; unknown stays unknown. */
  readonly kind?: string | null;
  readonly observedAt: string;
  /** Whether the RUN continued. Different question from whether this attempt did. */
  readonly recovered?: boolean;
  readonly attempt?: number;
  readonly missionId?: string;
  readonly detail?: string;
}

/**
 * Prototype-free on purpose. A plain object literal inherits from
 * `Object.prototype`, so a failure labelled `constructor` or `toString` looked
 * up to a FUNCTION, `??` did not catch it because it is not null, and the value
 * escaped the `RelayErrorKind` type entirely — `tsc` cannot see it. The
 * projection then threw `a.kind.localeCompare is not a function` while sorting.
 */
const ERROR_KIND_BY_LABEL: Readonly<Record<string, RelayErrorKind>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, RelayErrorKind>, {
  timeout: 'provider_timeout',
  provider_timeout: 'provider_timeout',
  rate_limit: 'rate_limited',
  rate_limited: 'rate_limited',
  context_length: 'context_overflow',
  context_overflow: 'context_overflow',
  tool_error: 'tool_failure',
  tool_failure: 'tool_failure',
  workspace_error: 'workspace_failure',
  workspace_failure: 'workspace_failure',
  validation: 'validation_failure',
  validation_failure: 'validation_failure',
  budget: 'budget_refusal',
  budget_refusal: 'budget_refusal',
  policy: 'policy_refusal',
  policy_refusal: 'policy_refusal',
  provider_error: 'provider_error',
  internal_error: 'internal_error',
}));

/**
 * Map an adapter's label onto the vocabulary. An unrecognised label becomes
 * `unknown` rather than the closest-looking match: guessing that
 * `"connection_reset"` is a `provider_timeout` invents a diagnosis, and the
 * count of `unknown` errors is itself the signal that the mapping needs a case.
 */
export function errorFromFailure(failure: ObservedFailure): RelayErrorEvent | null {
  if (!Number.isFinite(Date.parse(failure.observedAt))) return null;
  const label = (failure.kind ?? '').trim().toLowerCase();
  // A nonsense attempt number becomes 1 — the first attempt — because that is
  // the only value that cannot overstate how many times something was tried.
  const attempt = typeof failure.attempt === 'number'
    && Number.isInteger(failure.attempt) && failure.attempt >= 1
    ? failure.attempt
    : 1;
  return {
    // `hasOwn`, not `??`: see the note on the map above.
    kind: Object.hasOwn(ERROR_KIND_BY_LABEL, label) ? ERROR_KIND_BY_LABEL[label] : 'unknown',
    at: failure.observedAt,
    // Absent means NOT KNOWN to have recovered. Defaulting to `true` would
    // quietly downgrade every failure an adapter forgot to annotate.
    recovered: failure.recovered === true,
    attempt,
    ...(failure.missionId === undefined ? {} : { missionId: failure.missionId }),
    ...(failure.detail === undefined ? {} : { detail: failure.detail }),
  };
}

/* -------------------------------------------------------------- assembly */

/**
 * Fold observations into a record, keeping `newestSignalAt` honest.
 *
 * `newestSignalAt` drives staleness, and staleness drives health, so it is
 * computed from the signals actually present rather than from the wall clock at
 * ingest — a record assembled at noon from an hour-old log is an hour old.
 */
export function ingest(
  record: RelayOperationalRecord,
  input: {
    readonly latency?: readonly RelayLatencySample[];
    readonly errors?: readonly RelayErrorEvent[];
    readonly attemptsObserved?: number | null;
  },
): RelayOperationalRecord {
  const latency = [...record.latency, ...(input.latency ?? [])];
  const errors = [...record.errors, ...(input.errors ?? [])];

  const stamps = [
    ...(record.newestSignalAt === null ? [] : [record.newestSignalAt]),
    ...latency.map((s) => s.observedAt),
    ...errors.map((e) => e.at),
  ].filter((value) => Number.isFinite(Date.parse(value)));

  const newestSignalAt = stamps.length === 0
    ? null
    : stamps.reduce((newest, value) => (Date.parse(value) > Date.parse(newest) ? value : newest));

  // A counted denominator only grows by counting. An adapter that cannot count
  // leaves the base `unavailable`, and every rate downstream stays unknown —
  // it does NOT fall back to the number of attempts we happen to have seen.
  const observed = input.attemptsObserved;
  const attempts = typeof observed === 'number' && Number.isFinite(observed) && observed >= 0
    ? { attempts: (record.attempts.attempts ?? 0) + observed, source: 'counted' as const }
    : record.attempts;

  return { ...record, latency, errors, attempts, newestSignalAt };
}

/* ---------------------------------------------------- short-term echo */

/**
 * Record an observation in short-term memory. Deliberately separate from
 * `ingest`: a metric and a remembered sentence are different artefacts, and
 * writing one should never silently write the other.
 */
export function noteObservation(
  memory: RelayShortTermMemory,
  entry: RelayShortTermEntry,
): RelayShortTermMemory {
  return rememberShortTerm(memory, entry);
}
