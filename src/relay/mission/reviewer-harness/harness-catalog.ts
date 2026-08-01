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

/** Nothing in the catalog can be started: no adapter exists for any of it. */
export function harnessIsSelectableForRun(entry: ReviewerHarnessCatalogEntry): boolean {
  return entry.adapterAvailable
    && entry.integrationStatus === 'available'
    && entry.installState === 'installed'
    && entry.readOnlyReviewSupported === 'yes';
}

const unproven = NO_HARNESS_CAPABILITIES;

export const REVIEWER_HARNESS_CATALOG: readonly ReviewerHarnessCatalogEntry[] = Object.freeze([
  {
    catalogId: 'hermes',
    name: 'Hermes',
    description: 'A reviewer harness intended to conduct independent reviews against mission evidence.',
    integrationStatus: 'coming_soon',
    adapterAvailable: false,
    installState: 'not_installed',
    supportedEnvironments: ['local'],
    modelConfiguration: 'configurable',
    readOnlyReviewSupported: 'unknown',
    capabilities: unproven,
    experimental: false,
    verificationNotes: [
      'Intended first live reviewer harness.',
      'No connected state exists yet — no adapter has been written.',
      'Read-only execution must be proven before it may review.',
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
