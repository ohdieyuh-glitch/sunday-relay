import {
  ACTIVE_HARNESS_STATES, BLOCKING_HARNESS_STATES, REVIEWER_HARNESS_CAPABILITIES,
  type HarnessConnectionState, type ReviewerHarnessCapability, type ReviewerHarnessRecord,
} from './harness-contracts';
import {
  CATALOG_STATUS_LABEL, REVIEWER_HARNESS_CATALOG, harnessIsSelectableForRun,
  type ReviewerHarnessCatalogEntry,
} from './harness-catalog';

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

/** `relay reviewer harnesses` — the catalog, worded once. */
export function renderHarnessCatalogLines(): string[] {
  const lines = ['REVIEWER HARNESS CATALOG'];
  for (const entry of REVIEWER_HARNESS_CATALOG) {
    lines.push(`  ${entry.catalogId}`);
    lines.push(`    name:        ${entry.name}`);
    lines.push(`    status:      ${CATALOG_STATUS_LABEL[entry.integrationStatus]}`);
    lines.push(`    installed:   ${entry.installState.replace(/_/g, ' ')}`);
    lines.push(`    adapter:     ${entry.adapterAvailable ? 'available' : 'none'}`);
    const proven = REVIEWER_HARNESS_CAPABILITIES.filter((c) => entry.capabilities[c]);
    lines.push(`    capabilities: ${proven.length === 0 ? 'none verified' : proven.join(', ')}`);
    lines.push(`    startable:   ${harnessIsSelectableForRun(entry) ? 'yes' : 'no'}`);
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
