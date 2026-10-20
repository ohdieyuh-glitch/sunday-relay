import {
  LIVE_REACH_SOURCES,
  isActionCapability,
  type BackendProbe,
  type LiveReachBackend,
  type LiveReachCapability,
  type LiveReachReadiness,
  type LiveReachSource,
  type LiveReachSourceDefinition,
} from './live-reach-contracts';

/**
 * THE SOURCES RELAY MODELS, AND WHAT COULD SERVE THEM.
 *
 * One registry. Every surface — permissions, settings, the gateway, the
 * founder handoff — reads this, so there is one answer to "what can Relay
 * reach" rather than a list per screen.
 *
 * WHAT IS HONEST HERE. A source in this registry is a source Relay has a
 * MODEL of. Only a backend marked `relayNative` is one Relay implements and
 * executes itself; the rest are recorded because naming the thing Relay would
 * need is more useful than pretending the source does not exist. Readiness is
 * answered by `resolveReadiness` from probes, never from this file, so nothing
 * here can make a source look available.
 *
 * ORDERED CANDIDATES. `backends[0]` is preferred and the rest are fallbacks —
 * Agent Reach's pattern, and the reason its own Twitter channel comments that
 * a two-phase scan is required: an installed-but-unauthenticated backend must
 * not mask a working one behind it. `backendCandidates` implements exactly
 * that ordering, with an operator override that can only reorder, never
 * introduce.
 *
 * NO ACTION BACKEND EXISTS YET, and that is stated rather than smoothed over.
 * Agent Reach — the project this capability was inspired by — implements no
 * write operation of any kind, so nothing in Relay may claim one on its
 * authority. When Relay builds an action backend it will be a Relay-native
 * client with its own scoped credential and its own audit record, and it will
 * appear here with the operations it genuinely performs.
 */

/* --------------------------------------------------------- the backends */

const RELAY_HTTP_FETCH: LiveReachBackend = Object.freeze({
  backendId: 'relay_http_fetch',
  displayName: 'Relay bounded HTTP fetch',
  operations: Object.freeze(['read_item', 'read_feed'] as LiveReachCapability[]),
  requiresAuthentication: false,
  requiredConfig: Object.freeze([]),
  relayNative: true,
  notes: Object.freeze([
    'Relay executes this itself, through the existing MCP network policy: the URL literal, the resolved address, and every redirect are each checked, and the response content type must be one the policy accepts.',
    'It retrieves a document. It does not run JavaScript, so a page that renders its content client-side returns what the server sent, which is sometimes nothing.',
  ]),
});

const RELAY_GITHUB_PUBLIC: LiveReachBackend = Object.freeze({
  backendId: 'relay_github_public',
  displayName: 'Relay GitHub public API client',
  operations: Object.freeze([
    'search', 'read_item', 'read_feed', 'read_profile',
  ] as LiveReachCapability[]),
  requiresAuthentication: false,
  // A token raises the rate limit; it is not required to read public data.
  requiredConfig: Object.freeze([]),
  relayNative: true,
  notes: Object.freeze([
    'Public repositories, releases, issues and commits, over the documented API. No credential is required to read public data, and none is used unless a deployment configures one.',
    'Unauthenticated requests are rate limited by GitHub per address; the readiness probe reports RATE LIMITED when that is the live answer rather than calling the source unavailable.',
  ]),
});

const RELAY_RSS_FETCH: LiveReachBackend = Object.freeze({
  backendId: 'relay_rss_fetch',
  displayName: 'Relay feed reader',
  operations: Object.freeze(['read_feed'] as LiveReachCapability[]),
  requiresAuthentication: false,
  requiredConfig: Object.freeze([]),
  relayNative: true,
  notes: Object.freeze([
    'Feeds are the one source class that publishes its own timestamps, which makes freshness a fact rather than an estimate.',
  ]),
});

/**
 * Sources with NO Relay-native backend.
 *
 * Each is recorded with what it would actually take, because "Relay has no way
 * to reach X yet" is a more useful thing for a founder to read than an absent
 * row. None of these can become READY, and `resolveReadiness` returns
 * `capability_unsupported` for a source whose backend list is empty.
 */
const UNREACHED: readonly LiveReachSource[] = Object.freeze([
  'x', 'reddit', 'linkedin', 'instagram', 'facebook', 'youtube',
]);

const UNREACHED_NOTE: Readonly<Record<string, string>> = Object.freeze({
  x: 'Reaching X requires either an authenticated session or its paid API. Relay will not read the founder’s browser cookies to get one — that is the practice the Agent Reach evaluation rejected — so this stays unreached until a scoped connection exists.',
  reddit: 'Reddit’s API requires a registered application and an OAuth credential. No Relay-native client exists yet.',
  linkedin: 'LinkedIn permits almost nothing without a partner agreement, and its terms forbid the scraping route. Unreached, deliberately.',
  instagram: 'Requires a Meta app, a business account and review. No Relay-native client exists yet.',
  facebook: 'Requires a Meta app and review. No Relay-native client exists yet.',
  youtube: 'Public metadata needs an API key; transcripts need a separate mechanism. No Relay-native client exists yet.',
});

/**
 * Display names, declared BEFORE the registry that reads them.
 *
 * The registry builds its unreached entries with `.map()` at module load, so a
 * table declared afterwards is in its temporal dead zone and throws on import.
 */
const DISPLAY_NAMES: Readonly<Record<LiveReachSource, string>> = Object.freeze({
  web: 'Web',
  github: 'GitHub',
  rss: 'RSS and Atom',
  youtube: 'YouTube',
  x: 'X (Twitter)',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
});

/* ---------------------------------------------------------- the sources */

export const LIVE_REACH_REGISTRY: readonly LiveReachSourceDefinition[] = Object.freeze([
  Object.freeze({
    source: 'web' as LiveReachSource,
    displayName: 'Web',
    backends: Object.freeze([RELAY_HTTP_FETCH]),
    accessNote: 'Public pages, fetched through Relay’s network policy.',
  }),
  Object.freeze({
    source: 'github' as LiveReachSource,
    displayName: 'GitHub',
    backends: Object.freeze([RELAY_GITHUB_PUBLIC, RELAY_HTTP_FETCH]),
    accessNote: 'Public repositories, releases and issues. No credential required.',
  }),
  Object.freeze({
    source: 'rss' as LiveReachSource,
    displayName: 'RSS and Atom',
    backends: Object.freeze([RELAY_RSS_FETCH, RELAY_HTTP_FETCH]),
    accessNote: 'Feeds that publish their own timestamps.',
  }),
  ...UNREACHED.map((source) => Object.freeze({
    source,
    displayName: DISPLAY_NAMES[source],
    backends: Object.freeze([] as LiveReachBackend[]),
    accessNote: UNREACHED_NOTE[source] ?? 'No Relay-native backend exists yet.',
  })),
]);

/* ------------------------------------------------------------ lookups */

export function findSource(source: string): LiveReachSourceDefinition | null {
  return LIVE_REACH_REGISTRY.find((s) => s.source === source) ?? null;
}

/** Every capability at least one registered backend actually implements. */
export function supportedCapabilities(source: LiveReachSource): readonly LiveReachCapability[] {
  const definition = findSource(source);
  if (definition === null) return Object.freeze([]);
  const seen = new Set<LiveReachCapability>();
  for (const backend of definition.backends) {
    for (const operation of backend.operations) seen.add(operation);
  }
  return Object.freeze([...seen]);
}

/** The action capabilities a source genuinely supports. Today: none, anywhere. */
export function supportedActionCapabilities(
  source: LiveReachSource,
): readonly LiveReachCapability[] {
  return Object.freeze(supportedCapabilities(source).filter(isActionCapability));
}

/**
 * Candidate backends for one capability, preferred first.
 *
 * `preferredBackendId` is an operator override and can only REORDER: an id
 * that does not serve this capability is ignored rather than honoured, so a
 * stale override can never hide the backends that work. That failure mode is
 * Agent Reach's, documented in its `ordered_backends`, and it is worth
 * inheriting the fix without the bug.
 */
export function backendCandidates(
  source: LiveReachSource,
  capability: LiveReachCapability,
  preferredBackendId?: string,
): readonly LiveReachBackend[] {
  const definition = findSource(source);
  if (definition === null) return Object.freeze([]);
  const able = definition.backends.filter((b) => b.operations.includes(capability));
  if (preferredBackendId === undefined) return Object.freeze(able);
  const index = able.findIndex((b) => b.backendId === preferredBackendId);
  if (index <= 0) return Object.freeze(able);
  const reordered = [...able];
  reordered.unshift(...reordered.splice(index, 1));
  return Object.freeze(reordered);
}

/* ---------------------------------------------------------- readiness */

/**
 * What this deployment may claim about one capability of one source.
 *
 * READ THE PROBES, NOT THE CONFIGURATION. A source is `ready` only when some
 * candidate backend was actually observed answering. Everything else names the
 * closest thing to ready that was seen, in a fixed order of usefulness: a
 * founder who can fix an authentication problem should be told about it rather
 * than about an unrelated backend that is merely unreachable.
 *
 * With no probes at all the answer is `unknown` — never `backend_unavailable`,
 * because nothing has been asked.
 */
export function resolveReadiness(input: {
  source: LiveReachSource;
  capability: LiveReachCapability;
  probes: readonly BackendProbe[];
  preferredBackendId?: string;
}): LiveReachReadiness {
  const candidates = backendCandidates(
    input.source,
    input.capability,
    input.preferredBackendId,
  );
  if (candidates.length === 0) return 'capability_unsupported';

  const relevant = candidates.map((backend) => input.probes.find(
    (p) => p.backendId === backend.backendId && p.capability === input.capability,
  ));

  if (relevant.some((p) => p?.result === 'observed')) return 'ready';
  // Order matters: each of these is a different next step for a founder, and
  // the most actionable one wins.
  if (relevant.some((p) => p?.result === 'throttled')) return 'rate_limited';
  if (relevant.some((p) => p?.result === 'unauthenticated')) return 'authentication_required';
  if (relevant.some((p) => p?.result === 'unconfigured')) return 'configuration_required';
  if (relevant.some((p) => p?.result === 'unreachable')) return 'backend_unavailable';
  if (relevant.length > 0 && relevant.every((p) => p?.result === 'unsupported')) {
    return 'capability_unsupported';
  }
  return 'unknown';
}

/** Every source, for a surface that lists them. Registry order. */
export function allSources(): readonly LiveReachSourceDefinition[] {
  return LIVE_REACH_REGISTRY;
}

/** Sources Relay implements a backend for. The rest are modelled, not reachable. */
export function reachableSources(): readonly LiveReachSourceDefinition[] {
  return Object.freeze(
    LIVE_REACH_REGISTRY.filter((s) => s.backends.some((b) => b.relayNative)),
  );
}

/** Guard for values arriving from storage or a wire. */
export function isLiveReachSource(value: unknown): value is LiveReachSource {
  return typeof value === 'string' && (LIVE_REACH_SOURCES as readonly string[]).includes(value);
}
