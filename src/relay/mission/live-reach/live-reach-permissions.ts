import {
  isActionCapability,
  type LiveReachCapability,
  type LiveReachRefusal,
  type LiveReachSource,
} from './live-reach-contracts';
import { findSource, supportedCapabilities } from './live-reach-registry';

/**
 * WHAT RELAY IS ALLOWED TO REACH, AND WHAT IT MAY DO THERE.
 *
 * THE PRODUCT DECISION, implemented rather than described: a source Relay can
 * genuinely reach arrives ENABLED. Read access is on, and action access is on
 * where a backend actually performs actions. The founder restricts from there.
 * Relay arrives capable.
 *
 * THE DISTINCTION THAT KEEPS THAT SAFE. "Enabled" means Relay MAY use the
 * capability when a Mission requires it. It has never meant Relay acts on its
 * own. Two separate layers have to agree before anything external happens:
 *
 *   CAPABILITY   is this switched on for the project?   ← this file
 *   AUTHORITY    does THIS Mission authorise this act?  ← the Mission
 *
 * A Mission that says "find five customers and draft outreach" authorises no
 * message. A Mission that says "and send each one" does. Capability
 * availability and Mission authority are different questions and this file
 * answers only the first — `evaluateLiveReach` refuses when either is missing,
 * so neither can be mistaken for the other.
 *
 * ABSENCE MEANS DEFAULT, NOT OFF. Settings store only what the founder
 * CHANGED. A project configured before a source existed inherits the default
 * for it rather than being silently denied a capability nobody declined, and
 * an empty settings record is a project that has expressed no preference.
 */

/* -------------------------------------------------------------- state */

/**
 * One source's settings, as OVERRIDES.
 *
 * Every field is optional and every absent field means "the default". A
 * capability the founder never touched is not stored, which is what makes a
 * new capability arrive enabled instead of arriving denied.
 */
export interface LiveReachSourceSettings {
  /** Master switch. Off disables read and actions together. */
  readonly enabled?: boolean;
  /** All read capabilities for this source. */
  readonly readEnabled?: boolean;
  /** All action capabilities for this source. */
  readonly actionsEnabled?: boolean;
  /** Individual capabilities, finest grain, and the last word. */
  readonly capabilities?: Readonly<Partial<Record<LiveReachCapability, boolean>>>;
  /** Which backend the operator prefers. Reorders candidates; never adds one. */
  readonly preferredBackendId?: string;
}

export interface LiveReachSettings {
  readonly sources?: Readonly<Partial<Record<LiveReachSource, LiveReachSourceSettings>>>;
  /**
   * Whether the founder has seen the one-time notice that social capabilities
   * arrive enabled. Acknowledgement is PERSISTED so the product says it once
   * and does not nag.
   */
  readonly globalNoticeAcknowledgedAt?: string;
  /** Per-source acknowledgement of that source's own first-entry notice. */
  readonly sourceNoticeAcknowledgedAt?: Readonly<Partial<Record<LiveReachSource, string>>>;
}

/** A project that has expressed no preference. Not "everything off". */
export const EMPTY_LIVE_REACH_SETTINGS: LiveReachSettings = Object.freeze({});

/* ------------------------------------------------------------ defaults */

/**
 * The default for a capability Relay can genuinely perform.
 *
 * Enabled. Both read and action. The product decision is that Relay arrives
 * capable — but note what this function is NOT asked: whether a backend exists
 * at all. `evaluateLiveReach` refuses an unsupported capability before it ever
 * gets here, so "enabled by default" can never turn into a claim that Relay
 * can do something it cannot.
 */
export function defaultEnabled(_capability: LiveReachCapability): boolean {
  return true;
}

/* ---------------------------------------------------------- resolution */

export interface CapabilityState {
  readonly capability: LiveReachCapability;
  readonly supported: boolean;
  readonly enabled: boolean;
  /** Where the answer came from, so a surface can show inherited vs chosen. */
  readonly source: 'default' | 'capability' | 'group' | 'integration' | 'unsupported';
}

/**
 * Whether one capability is switched on, and why.
 *
 * Precedence, narrowest last: an unsupported capability can never be on; then
 * the master switch; then the read/actions group; then the individual
 * capability, which is the founder's finest instrument and therefore wins.
 */
export function capabilityState(
  source: LiveReachSource,
  capability: LiveReachCapability,
  settings: LiveReachSettings = EMPTY_LIVE_REACH_SETTINGS,
): CapabilityState {
  if (!supportedCapabilities(source).includes(capability)) {
    return { capability, supported: false, enabled: false, source: 'unsupported' };
  }

  const forSource = settings.sources?.[source];
  const explicit = forSource?.capabilities?.[capability];
  if (explicit !== undefined) {
    return { capability, supported: true, enabled: explicit, source: 'capability' };
  }
  if (forSource?.enabled === false) {
    return { capability, supported: true, enabled: false, source: 'integration' };
  }
  const group = isActionCapability(capability)
    ? forSource?.actionsEnabled
    : forSource?.readEnabled;
  if (group !== undefined) {
    return { capability, supported: true, enabled: group, source: 'group' };
  }
  return {
    capability,
    supported: true,
    enabled: defaultEnabled(capability),
    source: 'default',
  };
}

/* ---------------------------------------------------------- evaluation */

export interface LiveReachRequest {
  readonly source: string;
  readonly capability: LiveReachCapability;
  readonly settings?: LiveReachSettings;
  /**
   * Whether THIS Mission authorises this act.
   *
   * Supplied by the Mission, never inferred here. For a read this is normally
   * true; for an action it is true only when the Mission actually asked for
   * the act. A capability being enabled is not permission to perform it.
   */
  readonly missionAuthorises: boolean;
  /**
   * Whether the capability was observed working. `false` refuses: a request is
   * not the place to discover that a source was never ready.
   */
  readonly ready: boolean;
  /**
   * The connected account this act would use. Required for ACTIONS — "post to
   * X" must never mean "whichever credential this machine happens to have".
   */
  readonly accountId?: string | null;
}

export type LiveReachDecision =
  | { readonly allowed: true; readonly capability: LiveReachCapability }
  | { readonly allowed: false; readonly refusal: LiveReachRefusal; readonly detail: string };

/**
 * May this request proceed?
 *
 * Fail closed, and refuse with the code that names the ACTUAL obstacle — a
 * founder who turned off X actions and a founder whose Mission never asked for
 * one need different sentences.
 *
 * The order is deliberate: what Relay cannot do at all, then what the founder
 * switched off, then what this Mission did not ask for. A disabled capability
 * says so rather than hiding behind a missing authority it also lacks.
 */
export function evaluateLiveReach(request: LiveReachRequest): LiveReachDecision {
  const definition = findSource(request.source);
  if (definition === null) {
    return { allowed: false, refusal: 'source_unknown', detail: `Unknown source: ${request.source}.` };
  }
  const source = definition.source;
  const state = capabilityState(source, request.capability, request.settings);

  if (!state.supported) {
    return {
      allowed: false,
      refusal: 'capability_unsupported',
      detail: `Relay has no backend that performs ${request.capability} for ${definition.displayName}.`,
    };
  }

  if (!state.enabled) {
    // WHICH switch turned it off, because that is what the founder has to
    // find in order to change their mind.
    const refusal: LiveReachRefusal = state.source === 'integration'
      ? 'integration_disabled'
      : state.source === 'group'
        ? (isActionCapability(request.capability) ? 'actions_disabled' : 'read_disabled')
        : 'capability_disabled';
    return {
      allowed: false,
      refusal,
      detail: `${definition.displayName} ${request.capability} is switched off for this project.`,
    };
  }

  if (!request.ready) {
    return {
      allowed: false,
      refusal: 'not_ready',
      detail: `${definition.displayName} has not been observed answering ${request.capability}.`,
    };
  }

  if (!request.missionAuthorises) {
    return {
      allowed: false,
      refusal: 'mission_does_not_authorize',
      detail: `This Mission does not authorise ${request.capability} on ${definition.displayName}. The capability is available; the Mission did not ask for it.`,
    };
  }

  // An action needs to know WHOSE account it acts as. A read does not.
  if (isActionCapability(request.capability)
    && (request.accountId === undefined || request.accountId === null || request.accountId === '')) {
    return {
      allowed: false,
      refusal: 'no_account_bound',
      detail: `No connected ${definition.displayName} account is bound to this project, so Relay cannot say who would be acting.`,
    };
  }

  return { allowed: true, capability: request.capability };
}

/* ------------------------------------------------------------- notices */

/**
 * Should the one-time global notice be shown?
 *
 * Once, on first entry to the integration settings, and never again — the
 * direction is explicit that this must not become a nag. Acknowledgement is a
 * timestamp rather than a boolean so a future material change can be compared
 * against it without a second field.
 */
export function shouldShowGlobalNotice(settings: LiveReachSettings): boolean {
  return settings.globalNoticeAcknowledgedAt === undefined;
}

/** The same, for one source's own first-entry notice. Acknowledged separately. */
export function shouldShowSourceNotice(
  source: LiveReachSource,
  settings: LiveReachSettings,
): boolean {
  return settings.sourceNoticeAcknowledgedAt?.[source] === undefined;
}

/* --------------------------------------------------------- transitions */

/** Record the global acknowledgement. Pure: time arrives from the caller. */
export function acknowledgeGlobalNotice(
  settings: LiveReachSettings,
  at: string,
): LiveReachSettings {
  return { ...settings, globalNoticeAcknowledgedAt: at };
}

export function acknowledgeSourceNotice(
  settings: LiveReachSettings,
  source: LiveReachSource,
  at: string,
): LiveReachSettings {
  return {
    ...settings,
    sourceNoticeAcknowledgedAt: { ...settings.sourceNoticeAcknowledgedAt, [source]: at },
  };
}

/** Turn one capability on or off, leaving every other answer inherited. */
export function setCapability(
  settings: LiveReachSettings,
  source: LiveReachSource,
  capability: LiveReachCapability,
  enabled: boolean,
): LiveReachSettings {
  const current = settings.sources?.[source] ?? {};
  return {
    ...settings,
    sources: {
      ...settings.sources,
      [source]: {
        ...current,
        capabilities: { ...current.capabilities, [capability]: enabled },
      },
    },
  };
}

/** Turn a whole group on or off. Individual overrides still win afterwards. */
export function setGroup(
  settings: LiveReachSettings,
  source: LiveReachSource,
  group: 'read' | 'actions' | 'integration',
  enabled: boolean,
): LiveReachSettings {
  const current = settings.sources?.[source] ?? {};
  const patch = group === 'read'
    ? { readEnabled: enabled }
    : group === 'actions'
      ? { actionsEnabled: enabled }
      : { enabled };
  return {
    ...settings,
    sources: { ...settings.sources, [source]: { ...current, ...patch } },
  };
}

/**
 * Switch off every source at once.
 *
 * The direction asks for a single control that disables social integrations,
 * and it has to be a real write rather than a flag some future code path might
 * forget to read: this sets each source's master switch, so every later
 * question resolves to off through the ordinary precedence.
 */
export function disableAllSources(
  settings: LiveReachSettings,
  sources: readonly LiveReachSource[],
): LiveReachSettings {
  return sources.reduce<LiveReachSettings>(
    (acc, source) => setGroup(acc, source, 'integration', false),
    settings,
  );
}
