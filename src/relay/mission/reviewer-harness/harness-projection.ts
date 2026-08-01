import {
  ACTIVE_HARNESS_STATES, BLOCKING_HARNESS_STATES, REVIEWER_HARNESS_CAPABILITIES,
  type HarnessConnectionState, type ReviewerHarnessCapability, type ReviewerHarnessRecord,
} from './harness-contracts';
import {
  CATALOG_STATUS_LABEL, REVIEWER_HARNESS_CATALOG, harnessIsSelectableForRun,
  type HarnessInstallState, type HarnessIntegrationStatus, type ReviewerHarnessCatalogEntry,
} from './harness-catalog';
import {
  assessHarnessReadiness, effectiveCatalogEntry,
  type HarnessReadinessState, type HarnessRuntimeEvidence,
} from './harness-readiness';

/**
 * THE ONE REVIEWER PROJECTION — rendered identically by the website panel and
 * by `relay mission reviewer status`. Harness and Model are always two
 * separate labels, and neither says Connected without its own evidence.
 */

export const HARNESS_STATE_LABEL: Readonly<Record<HarnessConnectionState, string>> = Object.freeze({
  not_connected: 'Not connected',
  not_installed: 'Not installed',
  coming_soon: 'Coming soon',
  bridge_required: 'Relay Bridge required',
  preparing: 'Preparing',
  reviewing: 'Reviewing',
  completed: 'Completed',
  blocked: 'Blocked',
  stopped: 'Stopped',
  disconnected: 'Disconnected',
  needs_inspection: 'Needs inspection',
});

export const UNKNOWN_LABEL = 'Unknown';
/** Said whenever no harness has been observed running. Never "Not selected". */
export const REVIEWER_HARNESS_NOT_CONNECTED_LABEL = 'Reviewer harness not connected';
/** An empty capability set is a STATEMENT, never an empty list. */
export const NO_PROVEN_CAPABILITIES_LABEL = 'No proven capabilities';
export const REVIEWER_SIMULATED_LABEL =
  'SIMULATED REVIEW — DEMO SIMULATION — NO REVIEWER HARNESS RAN';
export const REVIEWER_BRIDGE_REQUIRED_LABEL =
  'A Reviewer harness adapter and the Relay Bridge are required to run a review. Not available in offline demo.';

const CAPABILITY_LABEL: Readonly<Record<ReviewerHarnessCapability, string>> = Object.freeze({
  supportsLiveExecution: 'Live execution', supportsStreaming: 'Streaming',
  supportsCancellation: 'Cancellation', supportsStructuredFindings: 'Structured findings',
  supportsEvidenceReferences: 'Evidence references', supportsUsageReporting: 'Usage reporting',
  supportsSessionRecovery: 'Session recovery', supportsReadOnlyExecution: 'Read-only execution',
  supportsSubagents: 'Subagents', supportsParallelSubagents: 'Parallel subagents',
  supportsActualIdentity: 'Actual identity', supportsModelIdentity: 'Model identity',
  supportsLocalExecution: 'Local execution', supportsRemoteExecution: 'Remote execution',
  supportsACP: 'ACP',
});

/** Installation is a PROBE RESULT, so "unknown" is one of its three answers. */
const INSTALL_LABEL: Readonly<Record<HarnessInstallState, string>> = Object.freeze({
  not_installed: 'Not installed',
  installed: 'Installed',
  unknown: 'Install state unknown',
});

export interface ReviewerHarnessView {
  readonly present: boolean;
  readonly summary: string;
  readonly connectionState: HarnessConnectionState;
  readonly connectionLabel: string;
  /** ALWAYS separate from the model. */
  readonly harnessLabel: string;
  readonly requestedHarnessLabel: string;
  readonly harnessVersionLabel: string;
  readonly modelLabel: string;
  readonly requestedModelLabel: string;
  readonly providerLabel: string;
  readonly launchVerified: boolean;
  readonly findingCount: number;
  readonly evidenceCount: number;
  readonly proposedVerdictLabel: string;
  /** Relay's conclusion — `Not determined` until Relay decided. */
  readonly validatedVerdictLabel: string;
  readonly independenceLabel: string;
  readonly independenceReasons: readonly string[];
  readonly providerDiversityLabel: string;
  readonly usageLabel: string;
  readonly costLabel: string;
  readonly outcomeLabel: string;
  readonly capabilityLabels: readonly string[];
  readonly blocking: boolean;
  readonly active: boolean;
  readonly canStart: boolean;
  readonly canCancel: boolean;
  readonly disclosure: string | null;
}

export interface ReviewerProjectionOptions {
  readonly bridgeAvailable?: boolean;
  readonly simulated?: boolean;
  /** The harness the customer selected, when they selected one. */
  readonly selectedCatalogEntry?: ReviewerHarnessCatalogEntry | null;
}

export function projectReviewerHarness(
  record: ReviewerHarnessRecord | null,
  options: ReviewerProjectionOptions = {},
): ReviewerHarnessView {
  const bridgeAvailable = options.bridgeAvailable === true;
  const simulated = options.simulated === true;
  const selected = options.selectedCatalogEntry ?? null;
  // A catalog entry can only start a run when an adapter actually exists.
  const selectable = selected !== null && harnessIsSelectableForRun(selected);

  if (record === null) {
    const state: HarnessConnectionState = selected !== null && !selectable
      ? (selected.integrationStatus === 'experimental' ? 'not_installed' : 'coming_soon')
      : bridgeAvailable ? 'not_connected' : 'bridge_required';
    const harnessLabel = selected?.name ?? 'Not selected';
    return {
      present: false,
      summary: `${harnessLabel} · ${HARNESS_STATE_LABEL[state]}`,
      connectionState: state,
      connectionLabel: HARNESS_STATE_LABEL[state],
      harnessLabel: UNKNOWN_LABEL,
      requestedHarnessLabel: harnessLabel,
      harnessVersionLabel: UNKNOWN_LABEL,
      modelLabel: UNKNOWN_LABEL,
      requestedModelLabel: UNKNOWN_LABEL,
      providerLabel: UNKNOWN_LABEL,
      launchVerified: false,
      findingCount: 0, evidenceCount: 0,
      proposedVerdictLabel: 'None',
      validatedVerdictLabel: 'Not determined',
      independenceLabel: 'Unknown',
      independenceReasons: ['no review has run'],
      providerDiversityLabel: UNKNOWN_LABEL,
      usageLabel: UNKNOWN_LABEL,
      costLabel: UNKNOWN_LABEL,
      outcomeLabel: selected !== null && !selectable
        ? `${selected.name} is ${CATALOG_STATUS_LABEL[selected.integrationStatus].toLowerCase()} — no adapter exists yet, so no review can start.`
        : REVIEWER_BRIDGE_REQUIRED_LABEL,
      capabilityLabels: [],
      blocking: false, active: false,
      // Nothing in the catalog is startable, and no bridge is hosted.
      canStart: bridgeAvailable && selectable,
      canCancel: false,
      disclosure: simulated ? REVIEWER_SIMULATED_LABEL : null,
    };
  }

  const { identity, usage, independence } = record;
  const isSimulated = simulated || record.provenance === 'simulated';
  const active = ACTIVE_HARNESS_STATES.includes(record.connectionState);
  const blocking = BLOCKING_HARNESS_STATES.includes(record.connectionState);

  const outcomeLabel = (() => {
    if (record.connectionState === 'disconnected') {
      return record.disconnectionReason ?? 'Relay can no longer confirm the Reviewer process.';
    }
    if (record.connectionState === 'blocked' || record.connectionState === 'needs_inspection') {
      return record.blockedReason ?? 'Relay could not validate the Reviewer result.';
    }
    if (record.connectionState === 'stopped') {
      return record.cancellationConfirmed
        ? 'The review was cancelled. Evidence already received is preserved.'
        : 'Cancellation requested — not yet confirmed.';
    }
    if (record.connectionState === 'completed') {
      // A completed run is not automatically an approval.
      if (record.validatedVerdict === null) {
        return 'The harness returned a result. Relay has not validated it into a verdict.';
      }
      return record.validatedVerdict === 'approved'
        ? 'Relay validated the review as approved. Approval is not release authorization.'
        : 'Relay validated the review as requiring changes.';
    }
    if (active) return 'The Reviewer harness is inspecting the mission evidence.';
    return 'No review has run.';
  })();

  return {
    present: true,
    summary: `${identity.actualHarness ?? identity.requestedHarness} · ${HARNESS_STATE_LABEL[record.connectionState]}`,
    connectionState: record.connectionState,
    connectionLabel: HARNESS_STATE_LABEL[record.connectionState],
    // Harness and model are two labels, always.
    harnessLabel: identity.actualHarness ?? UNKNOWN_LABEL,
    requestedHarnessLabel: identity.requestedHarness,
    harnessVersionLabel: identity.harnessVersion ?? UNKNOWN_LABEL,
    modelLabel: identity.actualModel ?? UNKNOWN_LABEL,
    requestedModelLabel: identity.requestedModel ?? UNKNOWN_LABEL,
    providerLabel: identity.provider ?? UNKNOWN_LABEL,
    launchVerified: identity.launchVerified,
    findingCount: record.findingRefs.length,
    evidenceCount: record.evidenceRefs.length,
    proposedVerdictLabel: record.proposedVerdict ?? 'None',
    validatedVerdictLabel: record.validatedVerdict ?? 'Not determined',
    independenceLabel: independence.verdict === 'independent' ? 'Independent'
      : independence.verdict === 'not_independent' ? 'Not independent' : 'Unknown',
    independenceReasons: independence.reasons,
    providerDiversityLabel: independence.providerDiversity === 'different' ? 'Different providers'
      : independence.providerDiversity === 'same' ? 'Same provider' : UNKNOWN_LABEL,
    usageLabel: usage.source === 'unavailable'
      ? UNKNOWN_LABEL
      : usage.totalTokens !== null
        ? `${usage.totalTokens} tokens`
        : usage.executionMs !== null ? `${Math.round(usage.executionMs / 1000)}s execution` : UNKNOWN_LABEL,
    costLabel: usage.costMicros === null ? UNKNOWN_LABEL : `${usage.costMicros} ${usage.currency ?? ''}`.trim(),
    outcomeLabel,
    capabilityLabels: REVIEWER_HARNESS_CAPABILITIES
      .filter((c) => record.capabilities[c]).map((c) => CAPABILITY_LABEL[c]),
    blocking, active,
    canStart: !active && bridgeAvailable && selectable,
    canCancel: active,
    disclosure: isSimulated ? REVIEWER_SIMULATED_LABEL : null,
  };
}

export function renderReviewerStatusLines(missionId: string, view: ReviewerHarnessView): string[] {
  const lines: string[] = [`REVIEWER — ${missionId}`];
  if (view.disclosure !== null) lines.push(view.disclosure);
  lines.push(`  Harness:      ${view.harnessLabel} (requested ${view.requestedHarnessLabel})`);
  lines.push(`  Version:      ${view.harnessVersionLabel}`);
  lines.push(`  Model:        ${view.modelLabel} (requested ${view.requestedModelLabel})`);
  lines.push(`  Provider:     ${view.providerLabel}`);
  lines.push(`  Connection:   ${view.connectionLabel}`);
  lines.push(`  Launch:       ${view.launchVerified ? 'verified' : 'not verified'}`);
  lines.push(`  Findings:     ${view.findingCount}`);
  lines.push(`  Evidence:     ${view.evidenceCount}`);
  lines.push(`  Proposed:     ${view.proposedVerdictLabel}`);
  lines.push(`  Validated:    ${view.validatedVerdictLabel}`);
  lines.push(`  Independence: ${view.independenceLabel}`);
  lines.push(`  Providers:    ${view.providerDiversityLabel}`);
  lines.push(`  Usage:        ${view.usageLabel}`);
  lines.push(`  Cost:         ${view.costLabel}`);
  lines.push(`  Outcome:      ${view.outcomeLabel}`);
  return lines;
}

/* ----------------------------------------------------- the catalog view */

/**
 * THE ONE CATALOG PROJECTION — rendered by `relay reviewer harnesses` and by
 * the website's Reviewer Harness surface from the SAME call, so neither can
 * word a maturity, an adapter, an installation or a capability differently.
 *
 * It is a PROJECTION, not a second catalog: every value below is read from
 * `REVIEWER_HARNESS_CATALOG` or from the reviewer view, and nothing is
 * asserted that the domain does not already hold. A surface that wants to
 * show a harness must render these strings; it may not compose its own.
 */

/** One capability of one entry, with its proven state as READABLE TEXT. */
export interface HarnessCapabilityView {
  readonly capability: ReviewerHarnessCapability;
  readonly label: string;
  readonly proven: boolean;
  /** Never a bare tick: a false capability says so in words. */
  readonly statusLabel: string;
}

export interface HarnessCatalogEntryView {
  readonly catalogId: string;
  readonly name: string;
  readonly description: string;
  readonly integrationStatus: HarnessIntegrationStatus;
  readonly maturityLabel: string;
  readonly experimental: boolean;
  readonly adapterAvailable: boolean;
  readonly adapterLabel: string;
  readonly installState: HarnessInstallState;
  readonly installLabel: string;
  /** The domain's own startability rule — never re-derived by a surface. */
  readonly startable: boolean;
  readonly startLabel: string;
  /** Raw capability keys an adapter proved. The CLI prints these verbatim. */
  readonly provenCapabilityKeys: readonly ReviewerHarnessCapability[];
  readonly provenCapabilityLabels: readonly string[];
  /** `No proven capabilities` when nothing is proven. */
  readonly capabilitySummary: string;
  /** All fifteen, so a detail view can show false without implying support. */
  readonly capabilities: readonly HarnessCapabilityView[];
  /** Every fact that blocks a run, each naming the field that decided it. */
  readonly unavailableReasons: readonly string[];
  readonly unavailableReason: string | null;
  readonly environmentLabel: string;
  readonly modelConfigurationLabel: string;
  readonly readOnlyReviewLabel: string;
  readonly verificationNotes: readonly string[];
  /**
   * RUNTIME readiness, from the one ladder in `harness-readiness`. With no
   * server-side evidence — every browser, always — this is the truthful
   * "Relay cannot ask anything" answer, never a guess.
   */
  readonly readinessState: HarnessReadinessState;
  readonly readinessLabel: string;
  readonly readinessReason: string;
  readonly readinessMissing: readonly string[];
}

/** Identity fields stay SEPARATE rows; none is inferred from another. */
export interface ReviewerIdentityRow {
  readonly key: 'requested_harness' | 'actual_harness' | 'requested_model' | 'actual_model' | 'provider';
  readonly label: string;
  readonly value: string;
}

export interface ReviewerHarnessCatalogView {
  readonly title: string;
  /** `Reviewer harness not connected` until a launch was actually verified. */
  readonly statusLabel: string;
  readonly statusDetail: string;
  readonly identityRows: readonly ReviewerIdentityRow[];
  readonly independenceLabel: string;
  readonly independenceReasons: readonly string[];
  readonly providerDiversityLabel: string;
  readonly entries: readonly HarnessCatalogEntryView[];
  readonly startableCount: number;
  readonly countLabel: string;
  /** Carries the simulated/fixture disclosure through to every surface. */
  readonly disclosure: string | null;
}

function projectCatalogEntry(
  staticEntry: ReviewerHarnessCatalogEntry,
  evidence: HarnessRuntimeEvidence | null,
): HarnessCatalogEntryView {
  // Runtime-knowable fields are replaced by what a probe PROVED before any
  // label is derived, so every string below describes one consistent world.
  const entry = effectiveCatalogEntry(staticEntry, evidence);
  const readiness = assessHarnessReadiness(staticEntry, evidence);
  const startable = harnessIsSelectableForRun(entry) && readiness.startable;
  const provenCapabilityKeys = REVIEWER_HARNESS_CAPABILITIES.filter((c) => entry.capabilities[c]);
  const maturityLabel = CATALOG_STATUS_LABEL[entry.integrationStatus];

  // Every blocking fact, in the order the startability rule tests them, so the
  // explanation and the rule can never drift apart.
  const unavailableReasons: string[] = [];
  if (!entry.adapterAvailable) {
    unavailableReasons.push('Adapter unavailable — Relay ships no adapter for this harness yet.');
  }
  if (entry.integrationStatus !== 'available') {
    unavailableReasons.push(`${maturityLabel} — not available to run a review yet.`);
  }
  if (entry.installState !== 'installed') {
    unavailableReasons.push(
      entry.installState === 'not_installed'
        ? 'Not installed — Relay has not detected this harness.'
        : 'Install state unknown — Relay has not probed for this harness.',
    );
  }
  if (entry.readOnlyReviewSupported !== 'yes') {
    unavailableReasons.push('Read-only review is not proven for this harness.');
  }
  if (!readiness.startable && readiness.state !== 'ready') {
    unavailableReasons.push(readiness.reason);
  }

  return {
    catalogId: entry.catalogId,
    name: entry.name,
    description: entry.description,
    integrationStatus: entry.integrationStatus,
    maturityLabel,
    experimental: entry.experimental,
    adapterAvailable: entry.adapterAvailable,
    adapterLabel: entry.adapterAvailable ? 'Adapter available' : 'Adapter unavailable',
    installState: entry.installState,
    installLabel: INSTALL_LABEL[entry.installState],
    startable,
    startLabel: startable ? 'Startable' : 'Not startable',
    provenCapabilityKeys,
    provenCapabilityLabels: provenCapabilityKeys.map((c) => CAPABILITY_LABEL[c]),
    capabilitySummary: provenCapabilityKeys.length === 0
      ? NO_PROVEN_CAPABILITIES_LABEL
      : provenCapabilityKeys.map((c) => CAPABILITY_LABEL[c]).join(', '),
    capabilities: REVIEWER_HARNESS_CAPABILITIES.map((capability) => ({
      capability,
      label: CAPABILITY_LABEL[capability],
      proven: entry.capabilities[capability],
      statusLabel: entry.capabilities[capability] ? 'Proven' : 'Not proven',
    })),
    unavailableReasons,
    unavailableReason: unavailableReasons[0] ?? null,
    environmentLabel: entry.supportedEnvironments.join(', '),
    modelConfigurationLabel: entry.modelConfiguration === 'unknown'
      ? UNKNOWN_LABEL
      : entry.modelConfiguration,
    readOnlyReviewLabel: entry.readOnlyReviewSupported === 'unknown'
      ? UNKNOWN_LABEL
      : entry.readOnlyReviewSupported,
    verificationNotes: entry.verificationNotes,
    readinessState: readiness.state,
    readinessLabel: readiness.label,
    readinessReason: readiness.reason,
    readinessMissing: readiness.missing,
  };
}

/**
 * The catalog, plus the CURRENT reviewer identity when a surface has one.
 *
 * `reviewer` is optional and every identity row falls back to `Unknown`
 * independently — an absent view can never make one field imply another, and
 * a requested harness never becomes an actual one.
 */
export function projectHarnessCatalog(
  reviewer?: ReviewerHarnessView | null,
  /**
   * Server-side probe results by catalog id. A browser passes nothing and gets
   * the truthful "no Relay Bridge answered" projection; the CLI and the bridge
   * pass what they proved. Same function, same strings, both surfaces.
   */
  runtimeEvidence?: Readonly<Record<string, HarnessRuntimeEvidence>> | null,
): ReviewerHarnessCatalogView {
  const view = reviewer ?? null;
  const entries = REVIEWER_HARNESS_CATALOG.map((entry) =>
    projectCatalogEntry(entry, runtimeEvidence?.[entry.catalogId] ?? null));
  const startableCount = entries.filter((e) => e.startable).length;

  // "Connected" requires a VERIFIED launch AND an observed harness identity.
  // A requested harness, a selected catalog entry and an intended future
  // harness are all still "not connected".
  const connected = view !== null
    && view.present
    && view.launchVerified
    && view.harnessLabel !== UNKNOWN_LABEL;

  return {
    title: 'REVIEWER HARNESS CATALOG',
    statusLabel: connected && view !== null
      ? `${view.harnessLabel} · ${view.connectionLabel}`
      : REVIEWER_HARNESS_NOT_CONNECTED_LABEL,
    statusDetail: view?.outcomeLabel ?? REVIEWER_BRIDGE_REQUIRED_LABEL,
    identityRows: [
      { key: 'requested_harness', label: 'Requested harness', value: view?.requestedHarnessLabel ?? UNKNOWN_LABEL },
      { key: 'actual_harness', label: 'Actual harness', value: view?.harnessLabel ?? UNKNOWN_LABEL },
      { key: 'requested_model', label: 'Requested model', value: view?.requestedModelLabel ?? UNKNOWN_LABEL },
      { key: 'actual_model', label: 'Actual model', value: view?.modelLabel ?? UNKNOWN_LABEL },
      { key: 'provider', label: 'Provider', value: view?.providerLabel ?? UNKNOWN_LABEL },
    ],
    independenceLabel: view?.independenceLabel ?? UNKNOWN_LABEL,
    independenceReasons: view?.independenceReasons ?? ['no reviewer identity evidence has been recorded'],
    providerDiversityLabel: view?.providerDiversityLabel ?? UNKNOWN_LABEL,
    entries,
    startableCount,
    countLabel: `${startableCount} of ${entries.length} harnesses can start a review.`,
    disclosure: view?.disclosure ?? null,
  };
}

/** `relay reviewer harnesses` — the catalog, worded once, from the projection. */
export function renderHarnessCatalogLines(): string[] {
  const catalog = projectHarnessCatalog();
  const lines = [catalog.title];
  for (const entry of catalog.entries) {
    lines.push(`  ${entry.catalogId}`);
    lines.push(`    name:        ${entry.name}`);
    lines.push(`    status:      ${entry.maturityLabel}`);
    lines.push(`    installed:   ${entry.installState.replace(/_/g, ' ')}`);
    lines.push(`    adapter:     ${entry.adapterAvailable ? 'available' : 'none'}`);
    lines.push(`    capabilities: ${entry.provenCapabilityKeys.length === 0
      ? 'none verified' : entry.provenCapabilityKeys.join(', ')}`);
    lines.push(`    startable:   ${entry.startable ? 'yes' : 'no'}`);
  }
  return lines;
}

/** Canonical Reviewer notifications, each gated on a verified fact. */
export function reviewerNotification(
  record: ReviewerHarnessRecord,
): { key: string; title: string; body: string; kind: 'info' | 'success' | 'warning' | 'critical' } | null {
  const base = `reviewer:${record.missionId}:${record.identity.runId ?? 'no-run'}`;
  switch (record.connectionState) {
    case 'reviewing':
      if (!record.identity.launchVerified) return null;
      return { key: `${base}:started`, title: 'Reviewer started',
        body: 'The selected Reviewer harness is inspecting the mission evidence.', kind: 'info' };
    case 'completed':
      // Only after Relay validated the structured result into a verdict.
      if (record.validatedVerdict === null) return null;
      if (record.validatedVerdict === 'changes_requested' && record.findingRefs.length > 0) {
        return { key: `${base}:blockers`, title: 'Reviewer found blockers',
          body: 'Blocking findings require repair.', kind: 'warning' };
      }
      return { key: `${base}:completed`, title: 'Reviewer completed',
        body: 'The Reviewer returned a structured result.', kind: 'success' };
    case 'needs_inspection':
      return { key: `${base}:needs-inspection`, title: 'Reviewer needs inspection',
        body: record.blockedReason ?? 'Relay could not validate the Reviewer result.', kind: 'warning' };
    case 'stopped':
      if (!record.cancellationConfirmed) return null;
      return { key: `${base}:stopped`, title: 'Reviewer stopped',
        body: 'The review was cancelled.', kind: 'warning' };
    case 'disconnected':
      return { key: `${base}:disconnected`, title: 'Reviewer disconnected',
        body: record.disconnectionReason ?? 'Relay can no longer confirm the Reviewer process.',
        kind: 'critical' };
    case 'blocked':
      return { key: `${base}:blocked`, title: 'Reviewer blocked',
        body: record.blockedReason ?? 'The review cannot proceed.', kind: 'critical' };
    default:
      return null;
  }
}
