import { harnessIsSelectableForRun, type ReviewerHarnessCatalogEntry } from './harness-catalog';

/**
 * RUNTIME READINESS FOR A CONCRETE HARNESS.
 *
 * The catalog is a static PRODUCT DEFINITION and stays that way: it is pure
 * domain the browser can import, so it can never learn whether a binary exists
 * on some server. Whether a harness can actually start is a SERVER-SIDE FACT,
 * and this module is the one place the two are combined.
 *
 * PROVIDER-NEUTRAL, like every other module here: it names no product, no
 * model and no vendor. The catalog remains the only place a product name may
 * appear, so this ladder serves the next harness as-is.
 *
 * The browser passes no evidence and therefore sees `bridge_unavailable` —
 * truthfully, because a static deployment has no Relay Bridge to ask. The CLI
 * and the bridge pass what they actually proved. Neither surface computes its
 * own answer, so they cannot disagree.
 *
 * EVERY REQUIREMENT IS SEPARATE, and a missing one is never inferred from a
 * present one: a discovered binary is not a credential, a credential is not a
 * verified model, and a verified model is not an authorized run.
 */

export const HARNESS_READINESS_STATES = [
  'bridge_unavailable',
  'not_installed',
  'incompatible',
  'interface_unverified',
  'credentials_missing',
  'model_unverified',
  'ready',
] as const;
export type HarnessReadinessState = (typeof HARNESS_READINESS_STATES)[number];

/**
 * What a server-side probe PROVED. Every field is an observation, never a
 * configuration value echoed back: `binaryPath` means a binary was found,
 * `modelVerified` means the authenticated account listed that exact model.
 */
export interface HarnessRuntimeEvidence {
  /** A Relay Bridge answered at all. Without this nothing else is knowable. */
  readonly bridgeAvailable: boolean;
  readonly installed: boolean;
  readonly binaryPath: string | null;
  readonly version: string | null;
  /** Whether the version satisfies the adapter's minimum. */
  readonly compatible: boolean;
  /** The machine interface the adapter selected, once verified. */
  readonly machineInterface: string | null;
  readonly machineInterfaceVerified: boolean;
  /** A server-side credential EXISTS. Never its value, never a comparison. */
  readonly credentialPresent: boolean;
  /** The requested model was listed by the authenticated account. */
  readonly modelVerified: boolean;
  readonly requestedModel: string | null;
  /** The canonical id the provider returned for that model. */
  readonly verifiedModelId: string | null;
  /** Read-only execution is structurally enforceable for this build. */
  readonly readOnlyEnforceable: boolean;
  readonly checkedAt: string | null;
  readonly failureReason: string | null;
}

export const NO_RUNTIME_EVIDENCE: HarnessRuntimeEvidence = Object.freeze({
  bridgeAvailable: false,
  installed: false,
  binaryPath: null,
  version: null,
  compatible: false,
  machineInterface: null,
  machineInterfaceVerified: false,
  credentialPresent: false,
  modelVerified: false,
  requestedModel: null,
  verifiedModelId: null,
  readOnlyEnforceable: false,
  checkedAt: null,
  failureReason: null,
});

export const HARNESS_READINESS_LABEL: Readonly<Record<HarnessReadinessState, string>> =
  Object.freeze({
    bridge_unavailable: 'Backend unavailable',
    not_installed: 'Not installed',
    incompatible: 'Incompatible version',
    interface_unverified: 'Interface unverified',
    credentials_missing: 'Credentials required on Relay Bridge',
    model_unverified: 'Model verification required',
    ready: 'Ready for connection test',
  });

export interface HarnessReadinessAssessment {
  readonly state: HarnessReadinessState;
  readonly label: string;
  /** Ordered, each naming the exact unmet requirement. */
  readonly missing: readonly string[];
  /**
   * Whether a review may be STARTED. Being ready is still not authorization:
   * an explicit founder action and a budget check remain separate gates.
   */
  readonly startable: boolean;
  readonly reason: string;
}

/**
 * The requirement ladder, in the order a surface should report it. The FIRST
 * unmet requirement names the state, so a user is told the next thing to fix
 * rather than a pile of consequences.
 */
export function assessHarnessReadiness(
  entry: ReviewerHarnessCatalogEntry,
  evidence: HarnessRuntimeEvidence | null,
): HarnessReadinessAssessment {
  // No adapter is built for this entry at all — runtime evidence is irrelevant.
  if (!entry.adapterAvailable) {
    return {
      state: 'bridge_unavailable',
      label: 'Adapter unavailable',
      missing: ['a Relay adapter for this harness'],
      startable: false,
      reason: 'Relay ships no adapter for this harness yet.',
    };
  }

  const e = evidence ?? NO_RUNTIME_EVIDENCE;
  const ladder: ReadonlyArray<{ state: HarnessReadinessState; ok: boolean; missing: string }> = [
    { state: 'bridge_unavailable', ok: e.bridgeAvailable, missing: 'an active Relay Bridge' },
    { state: 'not_installed', ok: e.installed, missing: 'a discovered harness runtime' },
    { state: 'incompatible', ok: e.compatible, missing: 'a compatible harness version' },
    {
      state: 'interface_unverified',
      ok: e.machineInterfaceVerified && e.readOnlyEnforceable,
      missing: 'a verified read-only machine interface',
    },
    { state: 'credentials_missing', ok: e.credentialPresent, missing: 'a server-side provider credential' },
    { state: 'model_unverified', ok: e.modelVerified, missing: 'a model verified for the authenticated account' },
  ];

  const unmet = ladder.filter((step) => !step.ok);
  if (unmet.length > 0) {
    const first = unmet[0];
    return {
      state: first.state,
      label: HARNESS_READINESS_LABEL[first.state],
      missing: unmet.map((step) => step.missing),
      startable: false,
      reason: e.failureReason ?? `Relay still needs ${first.missing}.`,
    };
  }

  return {
    state: 'ready',
    label: HARNESS_READINESS_LABEL.ready,
    missing: [],
    // Ready is the FLOOR, not the verdict. The ONE canonical startability rule
    // still decides — applied to an entry whose install and read-only fields
    // have been replaced by what the probe actually proved, so a `coming_soon`
    // entry can never become startable merely by being installed.
    startable: harnessIsSelectableForRun(effectiveCatalogEntry(entry, e)),
    reason: 'The harness and the requested model were verified. A review still requires explicit authorization.',
  };
}

/**
 * The static entry with its two RUNTIME-KNOWABLE fields replaced by proven
 * observations. Everything else — name, maturity, capabilities — stays exactly
 * as the canonical catalog declares it, so a probe can never promote a harness
 * or invent a capability.
 */
export function effectiveCatalogEntry(
  entry: ReviewerHarnessCatalogEntry,
  evidence: HarnessRuntimeEvidence | null,
): ReviewerHarnessCatalogEntry {
  if (!entry.adapterAvailable || evidence === null || !evidence.bridgeAvailable) return entry;
  return {
    ...entry,
    installState: evidence.installed && evidence.compatible ? 'installed' : 'not_installed',
    readOnlyReviewSupported: evidence.readOnlyEnforceable ? 'yes' : 'unknown',
  };
}
