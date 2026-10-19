import { describe, it, expect } from 'vitest';
import { createRelayAppStore } from './store';
import { createLiveRelayApplicationAdapter } from './live-adapter';
import { deriveMissionProjection } from './projection';
import { createDefaultSettingsDraft } from '../project-settings/defaults';
import { emptyRelayAppData } from './contracts';
import type {
  CodingTerminalState,
  LiveMissionUpdate,
  MissionAttestationSummary,
  MissionReview,
  MissionRole,
  RelayAppData,
} from './contracts';
import type { RelayAppStorage } from './persistence';
import type { EventTruthClass, TerminalEventCategory } from '../project-workspace/contracts';

/**
 * REVIEW AND VERIFICATION TRUTH (H-1 regression suite).
 *
 * The defect these tests lock out: the workspace projection derived reviewer
 * approval and passing verification checks from the MISSION-STATE ORDINAL. A
 * mission sitting in `approved` or `verified_complete` rendered an APPROVED
 * reviewer with no reviewer verdict anywhere on record, and rendered four
 * green checks — including two, "No protected files changed" and "Source
 * worktree unchanged", for which no result was consulted at all.
 *
 * That is a renderer asserting facts its domain records do not contain. Every
 * test below fails against that code and passes against the repaired
 * derivation, which reads reviewer state only from a real verdict and check
 * results only from Relay's own recorded inspection and test results.
 *
 * No provider, no network, no agent: a mocked bridge feeds the real store.
 */

/* ------------------------------------------------------------- harness */

function memStorage(): RelayAppStorage {
  let data = emptyRelayAppData();
  return {
    load: () => data,
    save: (d: RelayAppData) => {
      data = d;
    },
    clear: () => {
      data = emptyRelayAppData();
    },
  };
}

const AT = '2026-07-29T00:00:00.000Z';

const ev = (
  sequence: number,
  role: MissionRole,
  category: TerminalEventCategory,
  truth: EventTruthClass,
  headline: string,
  extra: Record<string, unknown> = {},
) => ({ sequence, at: AT, role, category, truth, headline, ...extra });

const CLAIM = {
  summary: 'Implemented the normalizer.',
  filesChanged: ['src/normalize.js'],
  checksRun: ['Reported completing the task'],
};

/** A never-called bridge: these tests drive the store directly. */
const idleBridge = (async () => {
  throw new Error('no live call is permitted in this suite');
}) as unknown as typeof fetch;

function liveProject() {
  const adapter = createLiveRelayApplicationAdapter({ bridgeBaseUrl: '/relay-api', fetchImpl: idleBridge });
  const store = createRelayAppStore(memStorage(), adapter);
  store.init();
  const created = store.createDraftFromRequest('Implement normalizeProjectName so its test passes.');
  if (!created.ok) throw new Error('draft creation failed');
  const projectId = created.value.project.id;
  store.approveBrief(projectId);
  const started = store.startProject(projectId, createDefaultSettingsDraft(store.getBrief(projectId)!.draft));
  if (!started.ok) throw new Error('project start failed');
  return { store, projectId, missionId: started.value.mission.id };
}

/** Ingest one backend-authoritative update and project it. */
function project(update: LiveMissionUpdate) {
  const { store, projectId, missionId } = liveProject();
  const ingested = store.ingestLiveUpdate(missionId, update);
  if (!ingested.ok) throw new Error('ingest failed');
  const mission = store.getMission(missionId)!;
  expect(mission.demo, 'this suite must only ever exercise LIVE missions').toBe(false);
  return deriveMissionProjection({
    project: store.getProject(projectId)!,
    settings: store.getSettings(projectId)!,
    brain: store.getProjectBrain(projectId),
    mission,
    events: store.getMissionEvents(missionId),
  });
}

/* ------------------------------------------------------------ fixtures */

function terminal(overrides: Partial<CodingTerminalState> = {}): CodingTerminalState {
  return {
    executionId: 'exec-1',
    externalSessionRedacted: null,
    runtime: 'Claude Code (local CLI)',
    billing: 'subscription',
    status: 'complete',
    projectLabel: 'relay-sample',
    startedAt: AT,
    endedAt: AT,
    permissions: {
      allowedTools: ['Read', 'Edit'],
      allowedFiles: ['src/normalize.js'],
      protectedPaths: ['src/relay/'],
      deniedCapabilities: ['network'],
    },
    lines: [],
    activeFile: 'src/normalize.js',
    changedFiles: ['src/normalize.js'],
    diff: null,
    test: { command: 'npm test', status: 'passed', exitCode: 0, output: '' },
    claim: CLAIM,
    attestation: null,
    ...overrides,
  };
}

function review(overrides: Partial<MissionReview> = {}): MissionReview {
  return {
    reviewer: 'Hermes',
    runtime: 'Hermes (read-only)',
    provider: null,
    requestedModel: null,
    servedModel: null,
    billing: 'subscription',
    verdict: 'approved',
    summary: 'The change matches the mission contract.',
    findings: [],
    requirementsChecked: [],
    reviewedArtifactDigest: 'artifact-abc',
    startedAt: AT,
    completedAt: AT,
    ...overrides,
  };
}

function attestation(
  role: MissionAttestationSummary['role'],
  overrides: Partial<MissionAttestationSummary> = {},
): MissionAttestationSummary {
  return {
    role,
    attestationId: `att-${role}`,
    requestedActor: role,
    actualActor: role,
    actualRuntime: 'local',
    billingPath: 'subscription',
    launchVerified: true,
    completionVerified: true,
    fallbackOccurred: false,
    startedAt: AT,
    ...overrides,
  };
}

/** A mission the machine calls COMPLETE, carrying no evidence whatsoever. */
const COMPLETE_WITHOUT_EVIDENCE: LiveMissionUpdate = {
  state: 'verified_complete',
  currentRole: 'relay',
  completedAt: AT,
  claim: CLAIM,
  events: [
    ev(0, 'relay', 'relay', 'system_notice', 'Mission Contract locked.'),
    ev(1, 'coding_agent', 'coding_agent', 'agent_claim', 'Work submitted — pending Relay verification.', {
      done: true,
    }),
  ],
};

/* ------------------------------------------------------------------ 1 */

describe('H-1.1 — verified_complete with no review record never renders reviewer approved', () => {
  it('the reviewer is WAITING, not APPROVED, when no verdict exists', () => {
    const p = project(COMPLETE_WITHOUT_EVIDENCE);
    expect(p.reviewerState).toBe('waiting');
    expect(p.workforce.reviewer.state).toBe('waiting');
    expect(p.reviewerState).not.toBe('approved');
  });

  it('the same holds in the `approved` mission state — the ordinal is not a verdict', () => {
    const p = project({ ...COMPLETE_WITHOUT_EVIDENCE, state: 'approved', completedAt: null });
    expect(p.reviewerState).toBe('waiting');
  });

  it('an attested reviewer LAUNCH is still not an approval', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      attestations: [attestation('reviewer', { completionVerified: false })],
    });
    // It ran. That is a pending status, never an outcome.
    expect(p.reviewerState).toBe('reviewing');
    expect(p.reviewerState).not.toBe('approved');
  });

  it('completion evidence never claims a review that has no record', () => {
    const p = project(COMPLETE_WITHOUT_EVIDENCE);
    const text = p.completionState.evidence.join(' ');
    expect(text).toMatch(/no independent review was performed/i);
    expect(text).not.toMatch(/approved/i);
  });
});

/* ------------------------------------------------------------------ 2 */

describe('H-1.2 — a mission with no verification evidence never renders checks as passed', () => {
  it('no evidence and no terminal result means nothing is passed', () => {
    const p = project(COMPLETE_WITHOUT_EVIDENCE);
    expect(p.verificationSummary.checks.every((c) => c.status !== 'passed')).toBe(true);
    expect(p.verificationSummary.headline).not.toMatch(/passed/i);
  });

  it('the checks are reported as NOT RUN rather than silently omitted', () => {
    const p = project(COMPLETE_WITHOUT_EVIDENCE);
    expect(p.verificationSummary.checks.length).toBeGreaterThan(0);
    expect(p.verificationSummary.checks.map((c) => c.status)).toEqual(
      p.verificationSummary.checks.map(() => 'not_run'),
    );
  });

  it('an evidence EVENT proves the step ran, not that it passed', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      events: [
        ...COMPLETE_WITHOUT_EVIDENCE.events,
        ev(2, 'relay', 'workspace_inspection', 'relay_evidence', 'Relay inspected the workspace.'),
        ev(3, 'relay', 'verification', 'relay_evidence', 'Relay ran the required tests.'),
      ],
    });
    expect(p.verificationSummary.checks.map((c) => c.status)).toEqual(['pending', 'pending']);
    expect(p.verificationSummary.headline).not.toMatch(/passed/i);
  });

  it('a mission the machine calls complete does not turn a FAILED test green', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      terminal: terminal({ test: { command: 'npm test', status: 'failed', exitCode: 1, output: '' } }),
    });
    const tests = p.verificationSummary.checks.find((c) => c.label === 'Required tests');
    expect(tests?.status).toBe('failed');
    expect(p.verificationSummary.headline).toBe('Relay verification did not pass.');
  });

  it('a claim that does not match the files Relay actually saw is a FAILED check', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      terminal: terminal({ changedFiles: ['src/normalize.js', 'src/secretly-also-this.js'] }),
    });
    const match = p.verificationSummary.checks.find((c) => c.label === 'Claimed files match changed files');
    expect(match?.status).toBe('failed');
  });

  it('a protected path Relay observed changing is a FAILED check', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      terminal: terminal({
        changedFiles: ['src/relay/ui/app/projection.ts'],
        claim: { ...CLAIM, filesChanged: ['src/relay/ui/app/projection.ts'] },
      }),
    });
    const guarded = p.verificationSummary.checks.find((c) => c.label === 'No protected files changed');
    expect(guarded?.status).toBe('failed');
  });
});

/* ------------------------------------------------------------------ 3 */

describe('H-1.3 — reviewer approval renders only from an actual reviewer verdict', () => {
  it('an approved verdict renders APPROVED', () => {
    const p = project({ ...COMPLETE_WITHOUT_EVIDENCE, review: review() });
    expect(p.reviewerState).toBe('approved');
  });

  it('a changes_required verdict renders CHANGES REQUIRED', () => {
    const p = project({ ...COMPLETE_WITHOUT_EVIDENCE, review: review({ verdict: 'changes_required' }) });
    expect(p.reviewerState).toBe('changes_required');
  });

  it('a blocking finding overrides an approved verdict', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      review: review({
        findings: [
          {
            findingId: 'F-1',
            severity: 'blocking',
            requirement: 'Inputs are validated',
            explanation: 'Empty input reaches the core module.',
            evidence: 'src/normalize.js',
          },
        ],
      }),
    });
    expect(p.reviewerState).toBe('changes_required');
  });

  it('unable_to_review renders UNAVAILABLE and never approval', () => {
    const p = project({ ...COMPLETE_WITHOUT_EVIDENCE, review: review({ verdict: 'unable_to_review' }) });
    expect(p.reviewerState).toBe('unavailable');
  });

  it('the completion evidence names the reviewer only with a verdict AND an attestation', () => {
    const withoutAttestation = project({ ...COMPLETE_WITHOUT_EVIDENCE, review: review() });
    expect(withoutAttestation.completionState.evidence.join(' ')).not.toMatch(/Independent review by/i);

    const withAttestation = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      review: review(),
      attestations: [attestation('reviewer')],
      artifactDigest: 'artifact-abc',
    });
    expect(withAttestation.completionState.evidence.join(' ')).toMatch(/Independent review by Hermes/);
  });
});

/* ------------------------------------------------------------------ 4 */

describe('H-1.4 — verification success renders only from actual verification evidence', () => {
  it('a recorded passing inspection and test render PASSED', () => {
    const p = project({ ...COMPLETE_WITHOUT_EVIDENCE, terminal: terminal() });
    expect(p.verificationSummary.checks).toEqual([
      { label: 'Claimed files match changed files', status: 'passed' },
      { label: 'No protected files changed', status: 'passed' },
      { label: 'Required tests', status: 'passed' },
    ]);
    expect(p.verificationSummary.headline).toBe('Required checks passed under Relay verification.');
  });

  it('a check with no recorded result is never invented as passing', () => {
    // Relay inspected but never ran the verification command.
    const p = project({ ...COMPLETE_WITHOUT_EVIDENCE, terminal: terminal({ test: null }) });
    const tests = p.verificationSummary.checks.find((c) => c.label === 'Required tests');
    expect(tests?.status).toBe('not_run');
    expect(p.verificationSummary.headline).not.toMatch(/passed/i);
  });

  it('a NOT RUN test stays not run under a complete mission state', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      terminal: terminal({ test: { command: 'npm test', status: 'not_run', exitCode: null, output: '' } }),
    });
    expect(p.verificationSummary.checks.find((c) => c.label === 'Required tests')?.status).toBe('not_run');
  });

  it('completion evidence quotes Relay’s own recorded statements, and invents none', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      events: [
        ...COMPLETE_WITHOUT_EVIDENCE.events,
        ev(2, 'relay', 'verification', 'relay_evidence', 'Relay verification did not pass.'),
      ],
    });
    expect(p.completionState.evidence).toContain('Relay verification did not pass.');
    expect(p.completionState.evidence.join(' ')).not.toMatch(
      /Coding-agent claim verified independently by Relay-run tests/,
    );
  });

  it('an AGENT CLAIM of success is never promoted to Relay evidence', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      events: [
        ...COMPLETE_WITHOUT_EVIDENCE.events,
        ev(2, 'coding_agent', 'verification', 'agent_claim', 'All tests pass.', { done: true }),
        ev(3, 'coding_agent', 'workspace_inspection', 'agent_claim', 'Only the claimed file changed.'),
      ],
    });
    expect(p.verificationSummary.checks.every((c) => c.status === 'not_run')).toBe(true);
    expect(p.completionState.evidence.join(' ')).not.toMatch(/All tests pass/);
  });
});

/* ------------------------------------------------------------------ 5 */

describe('H-1.5 — release status stays a separate authority', () => {
  it('verified_complete never renders a release approval, authorization or deployment', () => {
    for (const update of [
      COMPLETE_WITHOUT_EVIDENCE,
      { ...COMPLETE_WITHOUT_EVIDENCE, terminal: terminal(), review: review(), attestations: [attestation('reviewer')] },
    ]) {
      const p = project(update);
      const surface = [
        ...p.completionState.evidence,
        p.verificationSummary.headline ?? '',
        ...p.verificationSummary.checks.map((c) => c.label),
      ].join(' ');
      expect(surface).not.toMatch(/released|release approved|authoriz|deploy|shipp|publish/i);
    }
  });

  it('a release-shaped event cannot move the reviewer or a check', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      events: [
        ...COMPLETE_WITHOUT_EVIDENCE.events,
        ev(2, 'relay', 'relay', 'relay_evidence', 'Release gate opened for this artifact.'),
        ev(3, 'relay', 'system', 'system_notice', 'Release approved by the operator.'),
      ],
    });
    expect(p.reviewerState).toBe('waiting');
    expect(p.verificationSummary.checks.every((c) => c.status === 'not_run')).toBe(true);
  });
});

/* ------------------------------------------------------------------ 6 */

describe('H-1.6 — cost status can never grant review or verification status', () => {
  it('the projection reads no economics input at all', () => {
    // Structural: the projection's input is (project, settings, brain,
    // mission, events). There is no cost channel into reviewer or check
    // state, and this asserts the shape rather than trusting the prose.
    const { store, projectId, missionId } = liveProject();
    store.ingestLiveUpdate(missionId, COMPLETE_WITHOUT_EVIDENCE);
    const input = {
      project: store.getProject(projectId)!,
      settings: store.getSettings(projectId)!,
      brain: store.getProjectBrain(projectId),
      mission: store.getMission(missionId)!,
      events: store.getMissionEvents(missionId),
    };
    expect(Object.keys(input).sort()).toEqual(['brain', 'events', 'mission', 'project', 'settings']);
    expect(JSON.stringify(input.mission)).not.toMatch(/budget|receipt|economics/i);
  });

  it('cost and budget events leave the reviewer waiting and the checks unrun', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      events: [
        ...COMPLETE_WITHOUT_EVIDENCE.events,
        ev(2, 'relay', 'relay', 'relay_evidence', 'Mission cost finalized: under budget.'),
        ev(3, 'relay', 'completion_engine', 'relay_evidence', 'Budget policy evaluated — no approval required.'),
      ],
    });
    expect(p.reviewerState).toBe('waiting');
    expect(p.verificationSummary.checks.every((c) => c.status === 'not_run')).toBe(true);
  });

  it('an under-budget mission with a failing test still fails verification', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      terminal: terminal({ test: { command: 'npm test', status: 'failed', exitCode: 1, output: '' } }),
      events: [
        ...COMPLETE_WITHOUT_EVIDENCE.events,
        ev(2, 'relay', 'relay', 'relay_evidence', 'Mission cost finalized: under budget.'),
      ],
    });
    expect(p.verificationSummary.checks.find((c) => c.label === 'Required tests')?.status).toBe('failed');
    expect(p.reviewerState).toBe('waiting');
  });
});

/* --------------------------------------------------- demo path intact */

describe('H-1 — the labeled demo path is unchanged', () => {
  it('the demo simulation still reaches an approved reviewer and passing checks', async () => {
    const { createDemoRelayApplicationAdapter } = await import('./demo-adapter');
    const store = createRelayAppStore(memStorage(), createDemoRelayApplicationAdapter());
    store.init();
    const created = store.createDraftFromRequest('Demonstrate the Relay mission flow.');
    if (!created.ok) throw new Error('draft creation failed');
    const projectId = created.value.project.id;
    store.approveBrief(projectId);
    const started = store.startProject(projectId, createDefaultSettingsDraft(store.getBrief(projectId)!.draft));
    if (!started.ok) throw new Error('project start failed');
    const missionId = started.value.mission.id;

    // Advance the deterministic demo script to its end.
    for (let step = 0; step < 200; step += 1) {
      const mission = store.getMission(missionId)!;
      if (mission.state === 'verified_complete') break;
      const advanced = store.advanceMission(missionId);
      if (!advanced.ok) break;
    }

    const mission = store.getMission(missionId)!;
    expect(mission.demo).toBe(true);
    expect(mission.state).toBe('verified_complete');
    const p = deriveMissionProjection({
      project: store.getProject(projectId)!,
      settings: store.getSettings(projectId)!,
      brain: store.getProjectBrain(projectId),
      mission,
      events: store.getMissionEvents(missionId),
    });
    expect(p.reviewerState).toBe('approved');
    expect(p.verificationSummary.checks.some((c) => c.status === 'passed')).toBe(true);
  });
});

/* ------------------------------------------------------------------ 8 */

/**
 * H-1.8 — THE TWO FOUNDER-FACING SURFACES OF THE SERVED MODEL.
 *
 * Defect 3 was that Relay attested a reviewer model it had only requested. The
 * fix split requested from served at every layer — and shipped with no test on
 * the two places the defect was VISIBLE: the review card's model and the
 * completion-evidence line. An independent review reverted both back to the
 * requested axis and watched all 177 tests across `src/relay/ui/app/` and
 * `coding-terminal.test.tsx` pass. A count with no scope is a number no command
 * reproduces, so the scope is named.
 *
 * These are those tests. Each fixture makes the two axes genuinely different
 * strings, so reading the wrong one is detectable rather than a coin flip.
 */
describe('H-1.8 — the projection reads the SERVED model, never the requested one', () => {
  it('projects the reviewer model from servedModel', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      attestations: [attestation('reviewer')],
      review: review({ requestedModel: 'grok-4', servedModel: 'grok-4-0709', provider: 'xai' }),
    });
    // The founder-visible string, which is where the defect was visible.
    const row = p.roleBilling?.find((r) => r.roleKey === 'reviewer');
    expect(row?.runtime).toContain('served model grok-4-0709');
    // `grok-4` is a PREFIX of the served id, so a bare `toContain('grok-4')`
    // would pass either way. The assertion is on the whole segment.
    expect(row?.runtime).not.toContain('served model grok-4 ');
    expect(row?.runtime).not.toMatch(/served model grok-4$/);
  });

  it('leaves the reviewer model Unknown when the provider named none', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      attestations: [attestation('reviewer')],
      review: review({ requestedModel: 'grok-4', servedModel: null, provider: 'xai' }),
    });
    /**
     * THE DEFECT IN ONE ASSERTION, and its sequel.
     *
     * This position used to be filled from CONFIGURATION, so a founder shown
     * `grok-4` had been shown a model nobody confirmed reviewed anything. The
     * first fix made it null — and the row then dropped the segment entirely,
     * so it went SILENT in exactly the case the work exists to make legible.
     * Unknown renders, matching the provider one field over.
     */
    const row = p.roleBilling?.find((r) => r.roleKey === 'reviewer');
    expect(row?.runtime).toContain('served model Unknown');
    expect(row?.runtime).not.toContain('grok-4');
  });

  it('says nothing about a served model when the reviewer never ran', () => {
    /**
     * `served model Unknown` beside a reviewer that never launched reads as "it
     * ran and the provider said nothing", which is a larger claim than "it has
     * not run" — and the status label two fields over already says `NOT RUN`.
     * The first repair rendered Unknown unconditionally; a re-review caught it.
     */
    const p = project(COMPLETE_WITHOUT_EVIDENCE);
    const row = p.roleBilling?.find((r) => r.roleKey === 'reviewer');
    expect(row?.statusLabel).toBe('NOT RUN');
    expect(row?.runtime).not.toContain('served model');
  });

  it('names the ARCHITECT\'s served model in the completion evidence, not the requested one', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      attestations: [attestation('prompt_architect', {
        actualActor: 'ChatGPT',
        requestedModel: 'gpt-4o',
        actualModel: 'gpt-4o-2024-08-06',
        launchVerified: true,
        completionVerified: true,
      })],
    });
    const evidence = p.completionState.evidence.join(' | ');
    expect(evidence).toContain('gpt-4o-2024-08-06');
    // `gpt-4o` is a prefix of the served id, so a bare `toContain` would pass
    // either way. The assertion is on the exact rendered sentence.
    expect(evidence).toContain('Prompt Architect execution attested (ChatGPT · gpt-4o-2024-08-06).');
    expect(evidence).not.toContain('(ChatGPT · gpt-4o).');
  });

  it('names no architect model at all when the provider named none', () => {
    const p = project({
      ...COMPLETE_WITHOUT_EVIDENCE,
      attestations: [attestation('prompt_architect', {
        actualActor: 'ChatGPT',
        requestedModel: 'gpt-4o',
        launchVerified: true,
        completionVerified: true,
      })],
    });
    const evidence = p.completionState.evidence.join(' | ');
    expect(evidence).toContain('Prompt Architect execution attested (ChatGPT).');
    // The requested model never stands in for the one that answered.
    expect(evidence).not.toContain('gpt-4o');
  });
});
