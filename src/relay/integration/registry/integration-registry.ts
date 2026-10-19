/**
 * THE SUPPORTED INTEGRATION REGISTRY — server-authoritative, credential-free.
 *
 * THE DEFECT THIS EXISTS TO PREVENT. A configuration surface that lists model,
 * tool and reviewer integrations from a hand-written array drifts from what
 * the product can actually run the first time either side changes, and the
 * drift is invisible: the page looks complete, the run refuses. So this
 * registry is DERIVED — every entry is a projection of `ROLE_OCCUPANTS`, the
 * module that already is the authority on what may stand in a role slot, and
 * capabilities are joined from the reviewer harness catalog, the module that
 * already is the authority on what an adapter has PROVEN. Nothing here is
 * typed in by hand, so nothing here can drift on its own.
 *
 * WHAT THIS IS NOT. It is not the provider ROUTER. The router is Julius's: it
 * decides, at run time, which provider actually receives a dispatch, how
 * failures are classified, when a circuit opens. This registry decides what
 * Relay is ALLOWED TO PRESENT AND CONFIGURE, before any run exists. Two
 * different questions, two different owners, and collapsing them would make
 * the website's model list depend on a runtime health signal it has no
 * business reading.
 *
 * NEVER A CREDENTIAL. Entries carry environment variable NAMES and never
 * values, exactly as `RoleOccupant.requiredConfig` does — which is what makes
 * a registry entry renderable in a browser without redaction. There is no code
 * path here that reads `process.env`, and `integration-registry.test.ts`
 * asserts the shape of every field a surface could render.
 *
 * PURE DOMAIN. No Node, no network, no clock.
 */

import {
  REVIEWER_HARNESS_CAPABILITIES,
  findCatalogEntry,
} from '../../mission/reviewer-harness';
import {
  ROLE_OCCUPANTS,
  type BillingPath,
  type ExecutionEnvironment,
  type OccupantKind,
  type RoleOccupant,
  type RoleSlot,
} from '../../mission/role-slots';
import {
  COMPOUND_AGENT_SLOTS,
  identityIsReservedForJulius,
  type CompoundAgentSlot,
} from '../compound-agent';

/* ------------------------------------------------------- the role mapping */

/**
 * RELAY'S ROLE VOCABULARY AND JULIUS'S, MAPPED IN ONE PLACE.
 *
 * Relay's `RoleSlot` is lower-snake and predates Julius; Julius's
 * `JuliusDefaultRole` is upper-snake. Both are canonical in their own layer
 * and neither should be rewritten to match the other — a rename would touch
 * every stored record on one side of the boundary. The boundary is where a
 * translation belongs, and this is the boundary.
 *
 * The map is TOTAL in both directions and a test walks both lists against it,
 * so a role added to either side without a mapping fails here rather than
 * silently dropping an integration out of the registry.
 */
export const ROLE_SLOT_TO_COMPOUND_AGENT_SLOT: Readonly<Record<RoleSlot, CompoundAgentSlot>> = Object.freeze({
  prompt_architect: 'PROMPT_ARCHITECT',
  coding_agent: 'CODING_AGENT',
  reviewer: 'INDEPENDENT_REVIEWER',
});

export const COMPOUND_AGENT_SLOT_TO_ROLE_SLOT: Readonly<Record<CompoundAgentSlot, RoleSlot>> = Object.freeze({
  PROMPT_ARCHITECT: 'prompt_architect',
  CODING_AGENT: 'coding_agent',
  INDEPENDENT_REVIEWER: 'reviewer',
});

/* ------------------------------------------------------------ capabilities */

/**
 * WHERE A CAPABILITY LIST CAME FROM — carried, because an empty list means two
 * completely different things.
 *
 * `reviewer_harness_catalog` means a catalogue exists for this integration and
 * an empty list is a real statement: nothing is proven yet. `none_declared`
 * means no catalogue covers this kind of integration at all, and an empty list
 * carries no information. Rendering both as "no capabilities" would tell a
 * user the second is the first — the over/under-claiming failure the harness
 * catalog is written at length to avoid, reintroduced one layer up.
 *
 * Relay does NOT invent a capability taxonomy for Prompt Architects and Coding
 * Agents. None exists in the repository, and a made-up one would be a list of
 * claims nothing verifies.
 */
export const CAPABILITY_SOURCES = ['reviewer_harness_catalog', 'none_declared'] as const;
export type CapabilitySource = (typeof CAPABILITY_SOURCES)[number];

/* ------------------------------------------------------------ availability */

/**
 * WHAT RELAY CAN HONESTLY SAY ABOUT WHETHER AN INTEGRATION COULD RUN.
 *
 * Each member is a DIFFERENT remedy, which is why none of them collapse:
 *
 *   adapter_unavailable      Relay ships no adapter. Nothing an operator sets
 *                            changes this; it is a fact about the build.
 *   environment_unsupported  The adapter exists and cannot run on THIS host —
 *                            an installed CLI on a container is never "not
 *                            ready yet", it is permanently the wrong host.
 *   configuration_missing    A declared variable NAME was not observed set.
 *   configuration_present    Every declared name was observed set. This is
 *                            NOT proof a credential is valid: only a call
 *                            proves that, and this registry makes none.
 *   unknown                  Nothing was observed. The default, and the only
 *                            answer a browser-side read can produce.
 */
export const INTEGRATION_AVAILABILITIES = [
  'unknown', 'adapter_unavailable', 'environment_unsupported',
  'configuration_missing', 'configuration_present',
] as const;
export type IntegrationAvailability = (typeof INTEGRATION_AVAILABILITIES)[number];

/* ---------------------------------------------------------- the entry type */

/**
 * ONE INTEGRATION, AS A SURFACE MAY SEE IT.
 *
 * Every field is either a product definition (what Relay ships), a declared
 * requirement (variable NAMES), or a derived fact with its derivation named.
 * No field holds a value read from an environment, a provider response, a
 * session identifier, or anything a credential could be reconstructed from.
 */
export interface RelayIntegration {
  readonly integrationId: string;
  readonly displayName: string;
  readonly roles: readonly CompoundAgentSlot[];
  /**
   * The vendor/independence group. Vendor-shaped ON PURPOSE — it is the field
   * that stops "same vendor, different model" from passing as an independent
   * review — and it doubles as the provider grouping a surface can group by.
   * A separate `provider` string would be a second name for one fact.
   */
  readonly independenceGroup: string;
  /** How Relay reaches it. A MECHANISM, never a quality claim. */
  readonly kind: OccupantKind;
  readonly billingPath: BillingPath;
  readonly environments: readonly ExecutionEnvironment[];
  /** Whether this integration may be configured at all. */
  readonly enabled: boolean;
  /** Why it is disabled, when it is. `null` when enabled. */
  readonly disabledReason: string | null;
  /** A development path that must never be presented as a real run. */
  readonly developmentOnly: boolean;
  /** PROVEN capabilities only. Read `capabilitySource` before reading this. */
  readonly capabilities: readonly string[];
  readonly capabilitySource: CapabilitySource;
  /** Environment variable NAMES. Names only — never a value. */
  readonly configurationRequirements: readonly string[];
  /** Names required only on a hosted deployment. */
  readonly hostedOnlyConfigurationRequirements: readonly string[];
  readonly availability: IntegrationAvailability;
  readonly verificationNotes: readonly string[];
  /* Identity, carried so independence is computed by Relay's one rule. */
  readonly agentId: string;
  readonly adapterId: string;
}

/* --------------------------------------------------------- the projection */

/** Capability keys the harness catalog has PROVEN for this adapter. */
function provenCapabilities(occupant: RoleOccupant): { capabilities: string[]; source: CapabilitySource } {
  const entry = findCatalogEntry(occupant.adapterId);
  if (entry === null) return { capabilities: [], source: 'none_declared' };
  return {
    capabilities: REVIEWER_HARNESS_CAPABILITIES.filter((capability) => entry.capabilities[capability]),
    source: 'reviewer_harness_catalog',
  };
}

function projectOccupant(occupant: RoleOccupant): RelayIntegration {
  const { capabilities, source } = provenCapabilities(occupant);
  return {
    integrationId: occupant.occupantId,
    displayName: occupant.displayName,
    roles: [ROLE_SLOT_TO_COMPOUND_AGENT_SLOT[occupant.role]],
    independenceGroup: occupant.independenceGroup,
    kind: occupant.kind,
    billingPath: occupant.billingPath,
    environments: occupant.environments,
    enabled: occupant.adapterAvailable,
    disabledReason: occupant.adapterAvailable
      ? null
      : 'Relay ships no adapter for this integration, so it cannot be configured into a worker slot.',
    developmentOnly: occupant.kind === 'development_engine',
    capabilities,
    capabilitySource: source,
    configurationRequirements: occupant.requiredConfig,
    hostedOnlyConfigurationRequirements: occupant.hostedOnlyConfig ?? [],
    availability: occupant.adapterAvailable ? 'unknown' : 'adapter_unavailable',
    verificationNotes: occupant.verificationNotes,
    agentId: occupant.agentId,
    adapterId: occupant.adapterId,
  };
}

/**
 * EVERY SUPPORTED INTEGRATION, DERIVED.
 *
 * A Julius-named occupant is EXCLUDED here rather than merely refused later.
 * The exclusion is what makes "the registry contains no Julius entry" a
 * property of the registry itself instead of a promise someone has to keep,
 * and it means a surface reading this list can never render Julius as a
 * selectable worker even for a moment.
 */
export const RELAY_INTEGRATIONS: readonly RelayIntegration[] = Object.freeze(
  ROLE_OCCUPANTS
    .filter((occupant) => !identityIsReservedForJulius(occupant.occupantId))
    .map(projectOccupant),
);

/** Look one up. Unknown is `null`, never a nearest match. */
export function findIntegration(integrationId: string): RelayIntegration | null {
  return RELAY_INTEGRATIONS.find((entry) => entry.integrationId === integrationId) ?? null;
}

/** Every integration offered for one worker slot, in registration order. */
export function integrationsForSlot(slot: CompoundAgentSlot): readonly RelayIntegration[] {
  return RELAY_INTEGRATIONS.filter((entry) => entry.roles.includes(slot));
}

/* ------------------------------------------------ observed availability */

/**
 * UPGRADE AVAILABILITY FROM WHAT A SERVER ACTUALLY OBSERVED.
 *
 * The server knows which variable NAMES are set in its own process; it passes
 * that list of NAMES in. This function never reads an environment itself, so
 * it stays pure and testable, and it never receives a value — a name being
 * present is the entire input, which is also the entire honest signal.
 *
 * `configuration_present` deliberately does NOT mean "ready". Every occupant
 * that carries a credential requirement also carries a verification note
 * saying a variable being set is never proof the key is valid. This function
 * upgrades the availability field and changes none of those notes.
 */
export function applyObservedAvailability(
  integrations: readonly RelayIntegration[],
  observed: {
    readonly environment: ExecutionEnvironment;
    /** Variable NAMES the server observed set. Never values. */
    readonly presentConfigurationNames: readonly string[];
  },
): readonly RelayIntegration[] {
  const present = new Set(observed.presentConfigurationNames);
  return integrations.map((entry) => {
    if (!entry.enabled) return { ...entry, availability: 'adapter_unavailable' as const };
    if (!entry.environments.includes(observed.environment)) {
      return { ...entry, availability: 'environment_unsupported' as const };
    }
    const required = [
      ...entry.configurationRequirements,
      ...(observed.environment === 'hosted' ? entry.hostedOnlyConfigurationRequirements : []),
    ];
    const missing = required.filter((name) => !present.has(name));
    return {
      ...entry,
      availability: missing.length === 0 ? 'configuration_present' as const : 'configuration_missing' as const,
    };
  });
}

/* ---------------------------------------------------- the directory adapter */

/**
 * THE ONE PLACE THE REGISTRY IS HANDED TO THE CONFIGURATION VALIDATOR.
 *
 * `RelayIntegration` is a superset of `IntegrationDirectoryEntry`, so this
 * adapter is a lookup and not a translation — which is the point. If the two
 * shapes ever diverge, this function stops compiling rather than quietly
 * dropping a field the validator was relying on.
 *
 * The parameter defaults to the derived registry and is overridable so a
 * server can pass a list that has already had observed availability applied,
 * or a test can pass a fixture, without either reaching for a module-level
 * mutable.
 */
export function createIntegrationDirectory(
  integrations: readonly RelayIntegration[] = RELAY_INTEGRATIONS,
): { lookup(integrationId: string): RelayIntegration | null } {
  return {
    lookup: (integrationId) => integrations.find((entry) => entry.integrationId === integrationId) ?? null,
  };
}

/* ------------------------------------------------------------ completeness */

/**
 * Sanity, asserted rather than assumed: every worker slot has at least one
 * enabled integration Relay could offer for it. A slot with none is a product
 * gap, and a registry that reported it as an ordinary empty list would let a
 * configuration surface render three dropdowns of which one is silently empty.
 */
export function slotsWithNoEnabledIntegration(): readonly CompoundAgentSlot[] {
  return COMPOUND_AGENT_SLOTS.filter(
    (slot) => !integrationsForSlot(slot).some((entry) => entry.enabled),
  );
}
