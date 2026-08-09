import {
  NO_HARNESS_CAPABILITIES,
  type ReviewerHarnessCapabilities,
} from './harness-contracts';

/**
 * THE REVIEWER HARNESS CATALOG.
 *
 * A catalog entry is a PRODUCT DEFINITION — a thing a customer may one day
 * select. It is not evidence that the harness is installed, that an adapter
 * exists, or that any capability works. Those are three separate facts and
 * each has its own field, because the failure this catalog is designed to
 * prevent is a list that reads like a feature set.
 *
 * Every entry here is therefore `coming_soon` or `experimental`, every one
 * reports `capabilities: NO_HARNESS_CAPABILITIES`, and none can be started.
 * A capability turns true only when a real adapter proves it in a test.
 */

export const HARNESS_INTEGRATION_STATUSES = [
  'coming_soon', 'experimental', 'available', 'unsupported',
] as const;
export type HarnessIntegrationStatus = (typeof HARNESS_INTEGRATION_STATUSES)[number];

export const HARNESS_INSTALL_STATES = ['not_installed', 'installed', 'unknown'] as const;
export type HarnessInstallState = (typeof HARNESS_INSTALL_STATES)[number];

export interface ReviewerHarnessCatalogEntry {
  readonly catalogId: string;
  readonly name: string;
  /** Short and NEUTRAL: no performance claims, no language claims. */
  readonly description: string;
  readonly integrationStatus: HarnessIntegrationStatus;
  /** Whether Relay ships an adapter for it AT ALL. */
  readonly adapterAvailable: boolean;
  /** Whether it was detected on this machine. `unknown` until probed. */
  readonly installState: HarnessInstallState;
  readonly supportedEnvironments: readonly ('local' | 'remote')[];
  /** Whether a model can be configured for it, when known. */
  readonly modelConfiguration: 'configurable' | 'fixed' | 'none' | 'unknown';
  readonly readOnlyReviewSupported: 'yes' | 'no' | 'unknown';
  /** Capabilities PROVEN by an adapter — never inferred from the description. */
  readonly capabilities: ReviewerHarnessCapabilities;
  readonly experimental: boolean;
  /** What must be verified before this can be integrated. */
  readonly verificationNotes: readonly string[];
}

/**
 * The ONE startability rule. It reads only catalog fields, so a surface that
 * wants a runtime answer must first replace the runtime-knowable fields with
 * what a probe proved (`effectiveCatalogEntry`) — it may never re-implement
 * this test.
 */
export function harnessIsSelectableForRun(entry: ReviewerHarnessCatalogEntry): boolean {
  return entry.adapterAvailable
    && entry.integrationStatus === 'available'
    && entry.installState === 'installed'
    && entry.readOnlyReviewSupported === 'yes';
}

const unproven = NO_HARNESS_CAPABILITIES;

/**
 * What the Hermes adapter's own tests PROVE, and nothing more.
 *
 * `supportsLiveExecution` stays FALSE deliberately: the adapter is exercised
 * against a fake Hermes executable that speaks the real process protocol, which
 * proves framing, cancellation, redaction and parsing — not that a paid
 * provider call succeeded. It turns true only when a founder-authorized live
 * run records a real provider response.
 */
const HERMES_PROVEN_CAPABILITIES = Object.freeze({
  ...NO_HARNESS_CAPABILITIES,
  supportsStructuredFindings: true,
  supportsEvidenceReferences: true,
  supportsCancellation: true,
  supportsReadOnlyExecution: true,
  supportsUsageReporting: true,
  supportsModelIdentity: true,
  supportsLocalExecution: true,
});

export const REVIEWER_HARNESS_CATALOG: readonly ReviewerHarnessCatalogEntry[] = Object.freeze([
  {
    catalogId: 'hermes',
    name: 'Hermes',
    description: 'A reviewer harness intended to conduct independent reviews against mission evidence.',
    // `available` describes the INTEGRATION — Relay ships a concrete adapter.
    // Whether it can actually run is a server-side fact and lives in
    // `assessHarnessReadiness`, never here.
    integrationStatus: 'available',
    adapterAvailable: true,
    // Installation is a PROBE RESULT. The static catalog cannot know it and
    // the browser must never guess it, so it stays `unknown` until a Relay
    // Bridge reports what it actually found.
    installState: 'unknown',
    // BOTH, since the remote transport shipped. This said `['local']` for as
    // long as local was the only way to reach Hermes, and stayed saying it
    // after a dedicated Reviewer service and an authenticated remote transport
    // were added — an entry that under-claimed a capability the code had. It
    // is the same defect as over-claiming one: a description the source does
    // not support, which the next change then trusts.
    supportedEnvironments: ['local', 'remote'],
    modelConfiguration: 'configurable',
    // Proven per run by the adapter's zero-toolset enforcement, not asserted.
    readOnlyReviewSupported: 'unknown',
    capabilities: HERMES_PROVEN_CAPABILITIES,
    experimental: true,
    verificationNotes: [
      'Runs as a local one-shot Hermes process behind the Relay Bridge; the browser never reaches it.',
      'Read-only is structural: the adapter grants Hermes no toolset, so it holds no file, terminal or network tool.',
      'The provider credential is read only inside the bridge process and is never returned, persisted or logged.',
      'Live execution stays unproven until a founder-authorized run records a real provider response.',
    ],
  },
  {
    catalogId: 'buzz-acp',
    name: 'Buzz Agent / Buzz ACP',
    description: 'An agent-communication-protocol oriented integration placeholder.',
    integrationStatus: 'coming_soon',
    adapterAvailable: false,
    installState: 'not_installed',
    supportedEnvironments: ['local', 'remote'],
    modelConfiguration: 'unknown',
    readOnlyReviewSupported: 'unknown',
    capabilities: unproven,
    experimental: false,
    verificationNotes: [
      'Relay does not claim the full Buzz workspace is installed.',
      'The ACP surface Relay would speak has not been pinned.',
    ],
  },
  {
    catalogId: 'vellum',
    name: 'Vellum',
    description: 'A reviewer harness candidate.',
    integrationStatus: 'coming_soon',
    adapterAvailable: false,
    installState: 'not_installed',
    supportedEnvironments: ['local'],
    modelConfiguration: 'unknown',
    readOnlyReviewSupported: 'unknown',
    capabilities: unproven,
    experimental: false,
    verificationNotes: ['The exact integration interface must be verified before integration.'],
  },
  {
    catalogId: 'trustclaw',
    name: 'TrustClaw',
    description: 'An experimental reviewer harness candidate.',
    integrationStatus: 'experimental',
    adapterAvailable: false,
    installState: 'not_installed',
    supportedEnvironments: ['local'],
    modelConfiguration: 'unknown',
    readOnlyReviewSupported: 'unknown',
    capabilities: unproven,
    experimental: true,
    verificationNotes: [
      'The exact implementation and repository identity must be pinned before integration.',
    ],
  },
  {
    catalogId: 'picoclaw',
    name: 'PicoClaw',
    description: 'An experimental reviewer harness candidate.',
    integrationStatus: 'experimental',
    adapterAvailable: false,
    installState: 'not_installed',
    supportedEnvironments: ['local'],
    modelConfiguration: 'unknown',
    readOnlyReviewSupported: 'unknown',
    capabilities: unproven,
    experimental: true,
    verificationNotes: ['No production readiness claim is made.'],
  },
  {
    catalogId: 'zeroclaw',
    name: 'ZeroClaw',
    description: 'A reviewer harness candidate.',
    integrationStatus: 'coming_soon',
    adapterAvailable: false,
    installState: 'not_installed',
    supportedEnvironments: ['local'],
    modelConfiguration: 'unknown',
    readOnlyReviewSupported: 'unknown',
    capabilities: unproven,
    experimental: false,
    verificationNotes: [
      'No performance characteristics are advertised until Relay measures them.',
    ],
  },
  {
    catalogId: 'agent-zero',
    name: 'Agent Zero',
    description: 'A reviewer harness candidate.',
    integrationStatus: 'coming_soon',
    adapterAvailable: false,
    installState: 'not_installed',
    supportedEnvironments: ['local'],
    modelConfiguration: 'unknown',
    readOnlyReviewSupported: 'unknown',
    capabilities: unproven,
    experimental: false,
    verificationNotes: ['No installed state is claimed unless a probe detects it.'],
  },
]);

export const CATALOG_STATUS_LABEL: Readonly<Record<HarnessIntegrationStatus, string>> =
  Object.freeze({
    coming_soon: 'Coming soon',
    experimental: 'Experimental',
    available: 'Available',
    unsupported: 'Unsupported',
  });

export function findCatalogEntry(catalogId: string): ReviewerHarnessCatalogEntry | null {
  return REVIEWER_HARNESS_CATALOG.find((e) => e.catalogId === catalogId) ?? null;
}

/** One truthful line per entry, shared by the CLI and the website. */
export function renderCatalogLine(entry: ReviewerHarnessCatalogEntry): string {
  return `${entry.name} — ${CATALOG_STATUS_LABEL[entry.integrationStatus]}`;
}
