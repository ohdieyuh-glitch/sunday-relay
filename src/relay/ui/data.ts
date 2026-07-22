import { createRelayApp } from '../core/app';
import { projectCompetitiveMission } from '../cli/competitive';
import {
  defaultModePolicy, computeDogActivity, entitlementPolicy, computeOutputVisibility,
  assignReviewer, reviewerIsIndependent, createInProcessTerminalStream,
  createCredentialHandle, accessSummary,
  type RelayMode, type RelayModePolicy, type RelayDogActivity, type MissionProjectionBundle,
  type RelayTerminalEvent, type RelayEntitlement, type ReviewerProfile, type OutputVisibility,
} from '../mission';

/**
 * Mission Control data layer (Prompt 8.2) — BROWSER-SAFE. Runs a real Relay
 * Core scenario in-process (simulated adapters, no Node, no provider call)
 * and projects the mission bundle + mode/dog/terminal/entitlement/access read
 * models the graphical surface renders. Relay Core stays authoritative; this
 * is projection only. Production network streaming is NOT implemented — the
 * terminal uses the deterministic in-process transport.
 */

export interface MissionControlData {
  ok: boolean;
  bundle: MissionProjectionBundle;
  modePolicy: RelayModePolicy;
  dog: RelayDogActivity;
  entitlementLabel: string;
  reviewer: ReviewerProfile;
  reviewerIndependent: boolean;
  outputVisibility: OutputVisibility;
  terminalEvents: RelayTerminalEvent[];
  connectionState: string;
  access: Array<{ service: string; accountLabel: string; capability: string; scope: string[]; status: string; expiresAt: string }>;
  latestEvent: string;
}

export interface MissionControlOptions {
  mode?: RelayMode;
  entitlement?: RelayEntitlement;
  reducedMotion?: boolean;
  now?: string;
}

export function buildMissionControlData(options: MissionControlOptions = {}): MissionControlData {
  const now = options.now ?? '2026-07-24T00:00:00.000Z';
  const mode = options.mode ?? 'semi';
  const entitlement = options.entitlement ?? 'pro';

  const created = createRelayApp({ scenarioName: 'competitive' });
  if (!created.ok) throw new Error(created.error.message);
  const app = created.value;
  app.start('Protect anonymous live access.');
  app.continueRun();

  const bundle = projectCompetitiveMission(app, now);
  const events = app.events(0);
  const status = app.status();

  const dog = computeDogActivity({
    events: events.map((e) => ({ sequence: e.sequence, source: e.source, kind: e.kind, provenance: e.provenance as 'simulated' })),
    runStatus: status?.status ?? 'completed', phase: status?.phase ?? 'audit', mode,
    manualTaskActive: false, checkpointActive: false, missionVerdict: bundle.verdict.verdict,
    reducedMotion: options.reducedMotion ?? false, now, provenance: 'simulated',
  });

  const policy = entitlementPolicy(entitlement);
  const reviewer = assignReviewer(entitlement, 'simulated');
  const independent = reviewerIsIndependent({
    reviewerAgentId: 'sim-reviewer', reviewerSessionId: null, reviewerAdapterId: 'sim-reviewer', reviewerIndependenceGroup: 'reviewers',
    implementerAgentId: 'sim-coding-agent', implementerSessionId: 'ses_impl', implementerAdapterId: 'sim-coding-agent', implementerIndependenceGroup: 'implementers',
  });
  const outputVisibility = computeOutputVisibility({
    entitlement, substantiveCoding: true, implementationReported: true, verificationPassed: true,
    reviewerRequired: true, reviewOccurred: true, blockingFindingOpen: false, reviewApproved: true,
    reviewerIsIndependent: independent, completionPolicySatisfied: bundle.verdict.verdict === 'verified_complete',
    runStatus: status?.status ?? 'completed',
  }).visibility;

  const streamInputs = events
    .filter((e) => !e.kind.startsWith('ledger.') && !e.kind.startsWith('file_claim.'))
    .map((e) => ({ sequence: e.sequence, at: e.at, source: e.source, kind: e.kind, safeSummary: e.safeSummary, provenance: e.provenance }));
  const stream = createInProcessTerminalStream(streamInputs);
  stream.connect();
  const loaded = stream.loadSince(0);

  // Demo credential handle (no secret value) for the access summary.
  const handle = createCredentialHandle({
    credentialHandleId: 'crd_claude_session', userId: 'user_demo', projectId: 'sunday-relay',
    service: 'Claude Code', accountLabel: 'local subscription', capability: 'authenticated_session',
    allowedActions: ['edit', 'read'], scope: ['sunday-relay'], createdAt: now,
    expiresAt: '2026-07-24T02:00:00.000Z', requiresUserPresence: false, requiresMultiFactor: false,
    provenance: 'simulated',
  });

  return {
    ok: true, bundle, modePolicy: defaultModePolicy(mode, now), dog,
    entitlementLabel: policy.label, reviewer, reviewerIndependent: independent, outputVisibility,
    terminalEvents: loaded.events, connectionState: stream.connectionState,
    access: handle.ok ? accessSummary([handle.value], now) : [],
    latestEvent: events.at(-1)?.safeSummary ?? '',
  };
}

export type { RelayMode, RelayModePolicy, RelayDogActivity, RelayTerminalEvent, MissionProjectionBundle };
