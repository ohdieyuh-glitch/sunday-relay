import {
  ACTIVE_ARCHITECT_STATES,
  BLOCKING_ARCHITECT_STATES,
  PROMPT_ARCHITECT_CAPABILITIES,
  type ArchitectConnectionState,
  type PromptArchitectCapability,
  type PromptArchitectRecord,
} from './prompt-architect-contracts';
import { planNeedsInput } from './prompt-architect-plan';

/**
 * THE ONE PROMPT ARCHITECT PROJECTION — rendered identically by the website
 * panel and by `relay mission prompt-architect status`. Every operator-facing
 * string is worded once here.
 */

export const ARCHITECT_STATE_LABEL: Readonly<Record<ArchitectConnectionState, string>> =
  Object.freeze({
    not_connected: 'Not connected',
    bridge_required: 'Relay Bridge required',
    preparing: 'Preparing',
    planning: 'Planning',
    completed: 'Completed',
    needs_input: 'Needs input',
    stopped: 'Stopped',
    refused: 'Refused',
    disconnected: 'Disconnected',
    blocked: 'Blocked',
  });

export const UNKNOWN_LABEL = 'Unknown';
export const ARCHITECT_BRIDGE_REQUIRED_LABEL =
  'The Relay Bridge is required to run the Prompt Architect. Not available in offline demo.';
export const ARCHITECT_SIMULATED_LABEL =
  'SIMULATED PROMPT ARCHITECT — DEMO SIMULATION — NO PROVIDER REQUEST WAS MADE';

const CAPABILITY_LABEL: Readonly<Record<PromptArchitectCapability, string>> = Object.freeze({
  supportsLiveExecution: 'Live execution',
  supportsStreaming: 'Streaming',
  supportsStructuredOutput: 'Structured output',
  supportsCancellation: 'Cancellation',
  supportsTokenUsage: 'Token usage',
  supportsProjectContext: 'Project context',
  supportsExternalResearch: 'External research',
});

export interface PromptArchitectView {
  readonly present: boolean;
  readonly summary: string;
  readonly connectionState: ArchitectConnectionState;
  readonly connectionLabel: string;
  readonly requestedRuntime: string;
  readonly providerLabel: string;
  readonly requestedModelLabel: string;
  readonly actualModelLabel: string;
  readonly launchVerified: boolean;
  readonly planReady: boolean;
  readonly requirementCount: number;
  readonly decisionCount: number;
  readonly unresolvedCount: number;
  readonly stepCount: number;
  readonly riskCount: number;
  readonly acceptanceCount: number;
  readonly testPlanCount: number;
  readonly handoffReady: boolean;
  readonly approvalLabel: string;
  readonly usageLabel: string;
  /** Cost is Unknown by contract until Relay has a pricing authority. */
  readonly costLabel: string;
  readonly outcomeLabel: string;
  readonly capabilityLabels: readonly string[];
  readonly blocking: boolean;
  readonly active: boolean;
  readonly canStart: boolean;
  readonly canCancel: boolean;
  readonly disclosure: string | null;
}

export interface ArchitectProjectionOptions {
  readonly bridgeAvailable?: boolean;
  readonly simulated?: boolean;
}

export function projectPromptArchitect(
  record: PromptArchitectRecord | null,
  options: ArchitectProjectionOptions = {},
): PromptArchitectView {
  const bridgeAvailable = options.bridgeAvailable === true;
  const simulated = options.simulated === true;

  if (record === null) {
    const state: ArchitectConnectionState = bridgeAvailable ? 'not_connected' : 'bridge_required';
    return {
      present: false,
      summary: `GPT (OpenAI) · ${ARCHITECT_STATE_LABEL[state]}`,
      connectionState: state,
      connectionLabel: ARCHITECT_STATE_LABEL[state],
      requestedRuntime: 'GPT (OpenAI)',
      providerLabel: 'OpenAI',
      requestedModelLabel: UNKNOWN_LABEL,
      actualModelLabel: UNKNOWN_LABEL,
      launchVerified: false,
      planReady: false,
      requirementCount: 0, decisionCount: 0, unresolvedCount: 0, stepCount: 0,
      riskCount: 0, acceptanceCount: 0, testPlanCount: 0,
      handoffReady: false,
      approvalLabel: 'Not requested',
      usageLabel: UNKNOWN_LABEL,
      costLabel: UNKNOWN_LABEL,
      outcomeLabel: bridgeAvailable ? 'No planning run has started.' : ARCHITECT_BRIDGE_REQUIRED_LABEL,
      capabilityLabels: [],
      blocking: false,
      active: false,
      canStart: bridgeAvailable,
      canCancel: false,
      disclosure: simulated ? ARCHITECT_SIMULATED_LABEL : null,
    };
  }

  const { identity, usage, plan } = record;
  const isSimulated = simulated || record.provenance === 'simulated';
  const active = ACTIVE_ARCHITECT_STATES.includes(record.connectionState);
  const blocking = BLOCKING_ARCHITECT_STATES.includes(record.connectionState);
  // A plan exists only after strict validation stored one.
  const planReady = plan !== null && record.connectionState === 'completed';

  const outcomeLabel = (() => {
    if (record.connectionState === 'refused') {
      return record.failureMessage ?? 'The provider refused this planning request.';
    }
    if (record.connectionState === 'blocked' || record.connectionState === 'disconnected') {
      return record.failureMessage ?? 'The planning request could not be completed.';
    }
    if (record.connectionState === 'stopped') {
      return record.cancellationConfirmed
        ? 'Cancelled. Any evidence already received is preserved.'
        : 'Cancellation requested — not yet confirmed.';
    }
    if (record.connectionState === 'needs_input') {
      return 'Unresolved questions require a decision before implementation.';
    }
    if (planReady) return 'A structured Coding Agent handoff is ready for review.';
    if (active) return 'Preparing the mission plan.';
    return 'No planning run has started.';
  })();

  return {
    present: true,
    summary: `${identity.actualRuntime ?? identity.requestedRuntime} · ${ARCHITECT_STATE_LABEL[record.connectionState]}`,
    connectionState: record.connectionState,
    connectionLabel: ARCHITECT_STATE_LABEL[record.connectionState],
    requestedRuntime: identity.requestedRuntime,
    providerLabel: identity.provider,
    requestedModelLabel: identity.requestedModel ?? UNKNOWN_LABEL,
    // The provider response is the only authority for the actual model.
    actualModelLabel: identity.actualModel ?? UNKNOWN_LABEL,
    launchVerified: identity.launchVerified,
    planReady,
    requirementCount: plan?.requirements.length ?? 0,
    decisionCount: plan?.architectureDecisions.length ?? 0,
    unresolvedCount: plan?.unresolvedQuestions.length ?? 0,
    stepCount: plan?.implementationSteps.length ?? 0,
    riskCount: plan?.risks.length ?? 0,
    acceptanceCount: plan?.acceptanceCriteria.length ?? 0,
    testPlanCount: plan?.testPlan.length ?? 0,
    handoffReady: planReady && plan !== null && !planNeedsInput(plan),
    approvalLabel: record.approvalState.replace(/_/g, ' '),
    usageLabel: usage.source === 'unavailable' || usage.inputTokens === null
      ? UNKNOWN_LABEL
      : `${usage.inputTokens} in / ${usage.outputTokens ?? UNKNOWN_LABEL} out`,
    // Never a dollar figure: Relay has no pricing authority for the model.
    costLabel: UNKNOWN_LABEL,
    outcomeLabel,
    capabilityLabels: PROMPT_ARCHITECT_CAPABILITIES
      .filter((c) => record.capabilities[c]).map((c) => CAPABILITY_LABEL[c]),
    blocking,
    active,
    canStart: !active && bridgeAvailable,
    canCancel: active,
    disclosure: isSimulated ? ARCHITECT_SIMULATED_LABEL : null,
  };
}

export function renderArchitectStatusLines(
  missionId: string,
  view: PromptArchitectView,
): string[] {
  const lines: string[] = [`PROMPT ARCHITECT — ${missionId}`];
  if (view.disclosure !== null) lines.push(view.disclosure);
  lines.push(`  Runtime:      ${view.requestedRuntime}`);
  lines.push(`  Provider:     ${view.providerLabel}`);
  lines.push(`  Requested:    ${view.requestedModelLabel}`);
  lines.push(`  Actual model: ${view.actualModelLabel}`);
  lines.push(`  Connection:   ${view.connectionLabel}`);
  lines.push(`  Launch:       ${view.launchVerified ? 'verified' : 'not verified'}`);
  lines.push(`  Requirements: ${view.requirementCount}`);
  lines.push(`  Decisions:    ${view.decisionCount} (proposed)`);
  lines.push(`  Unresolved:   ${view.unresolvedCount}`);
  lines.push(`  Steps:        ${view.stepCount}`);
  lines.push(`  Acceptance:   ${view.acceptanceCount}`);
  lines.push(`  Test plan:    ${view.testPlanCount}`);
  lines.push(`  Risks:        ${view.riskCount}`);
  lines.push(`  Handoff:      ${view.handoffReady ? 'ready for review' : 'not ready'}`);
  lines.push(`  Approval:     ${view.approvalLabel}`);
  lines.push(`  Usage:        ${view.usageLabel}`);
  lines.push(`  Cost:         ${view.costLabel}`);
  lines.push(`  Outcome:      ${view.outcomeLabel}`);
  return lines;
}

/** Notification wording, defined once; each gated on a verified fact. */
export function architectNotification(
  record: PromptArchitectRecord,
): { key: string; title: string; body: string; kind: 'info' | 'success' | 'warning' | 'critical' } | null {
  const base = `prompt-architect:${record.missionId}:${record.identity.runId ?? 'no-run'}`;
  switch (record.connectionState) {
    case 'planning':
      // Only after the provider request was verifiably created.
      if (!record.identity.launchVerified) return null;
      return { key: `${base}:started`, title: 'Prompt Architect started',
        body: 'GPT is preparing the mission plan.', kind: 'info' };
    case 'completed':
      // Only after strict schema validation stored a plan.
      if (record.plan === null) return null;
      return { key: `${base}:completed`, title: 'Prompt Architect completed',
        body: 'A structured Coding Agent handoff is ready for review.', kind: 'success' };
    case 'needs_input':
      return { key: `${base}:needs-input`, title: 'Prompt Architect needs input',
        body: 'Unresolved questions require a decision.', kind: 'warning' };
    case 'stopped':
      if (!record.cancellationConfirmed) return null;
      return { key: `${base}:stopped`, title: 'Prompt Architect stopped',
        body: 'The planning request was cancelled.', kind: 'warning' };
    case 'refused':
    case 'disconnected':
    case 'blocked':
      return { key: `${base}:blocked`, title: 'Prompt Architect blocked',
        body: record.failureMessage ?? 'The planning request could not be completed.',
        kind: 'critical' };
    default:
      return null;
  }
}
