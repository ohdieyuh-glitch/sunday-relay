import { describe, expect, it } from 'vitest';

import type { MissionSpec, RelayMissionContract } from '../../mission/contracts';
import { buildMissionContract } from '../../mission';
import {
  createCompoundAgentConfiguration,
  type CompoundAgentAuthority,
  type CompoundAgentConfiguration,
  type IntegrationDirectory,
  type IntegrationDirectoryEntry,
} from '../compound-agent';
import {
  IDEMPOTENCY_KEY,
  JULIUS_BOOTSTRAP_REQUEST_VERSION,
  RELAY_JULIUS_PORT_VERSION,
  compileJuliusBootstrapRequest,
  unwiredJuliusBootstrapPort,
  type CurrentPinnedRevisions,
  type JuliusBootstrapAuthorization,
  type JuliusBootstrapInput,
} from './index';

/**
 * THE BOOTSTRAP ADAPTER, ADVERSARIALLY.
 *
 * The adapter's only job is to refuse a request that should not reach Julius,
 * and to compile one that should — losing nothing on the way. So this file
 * spends most of its length on refusals, and the accepted case is checked
 * field by field rather than by a snapshot: a snapshot passes just as happily
 * when a field silently stops being carried.
 */

/* ------------------------------------------------------------- fixtures */

const entry = (over: Partial<IntegrationDirectoryEntry> & { integrationId: string }): IntegrationDirectoryEntry => ({
  roles: ['CODING_AGENT'], enabled: true, capabilities: [], configurationRequirements: [],
  agentId: over.integrationId, adapterId: `${over.integrationId}-adapter`,
  independenceGroup: over.integrationId, ...over,
});

const ENTRIES: readonly IntegrationDirectoryEntry[] = [
  entry({ integrationId: 'architect_a', roles: ['PROMPT_ARCHITECT'], independenceGroup: 'group-a' }),
  entry({ integrationId: 'coder_b', roles: ['CODING_AGENT'], independenceGroup: 'group-b' }),
  entry({ integrationId: 'reviewer_c', roles: ['INDEPENDENT_REVIEWER'], independenceGroup: 'group-c' }),
];

const DIRECTORY: IntegrationDirectory = {
  lookup: (id) => ENTRIES.find((e) => e.integrationId === id) ?? null,
};

const AUTHORITY: CompoundAgentAuthority = {
  tenantId: 'tenant-1', projectId: 'prj-1', ownerParticipant: 'ghu-1',
};

const AUTHORIZATION: JuliusBootstrapAuthorization = {
  tenantId: 'tenant-1', projectId: 'prj-1', ownerParticipant: 'ghu-1',
  method: 'participant_session', authorizationRef: 'auth-ref-1',
};

const CURRENT: CurrentPinnedRevisions = { cardRevision: 'card-r3', projectBrainRevision: 'brain-r9' };

const SPEC: MissionSpec = {
  title: 'Bind the boundary',
  objective: 'Compile a Julius bootstrap request from an authorized Relay mission.',
  requirements: ['The compiled request must carry every acceptance criterion.'],
  constraints: ['No provider is contacted.'],
  acceptanceCriteria: [
    { id: 'ac-1', text: 'The request carries the mission binding digest.', blocking: true },
    { id: 'ac-2', text: 'The request carries the pinned revisions.', blocking: false },
  ],
  filesInScope: ['src/relay/integration/julius/mission-bootstrap-adapter.ts'],
  filesOutOfScope: ['src/relay/mission/julius/julius-runtime.ts'],
  systemsInScope: ['relay-integration'],
  systemsOutOfScope: ['julius-runtime'],
  assumptions: [], decisions: [], unresolvedQuestions: [],
  requiredEvidence: ['TEST'], requiredReviewers: ['independent'],
  implementerRequirement: 'coding_agent',
  reviewerRequirement: 'independent',
  maximumRepairIterations: 2, maximumReviewRuns: 2,
  maximumCostUsd: 5, maximumRuntimeMinutes: 60,
  completionRule: 'all_blocking_criteria_and_independent_review',
  createdBy: 'ghu-1',
};

function mission(over: Partial<RelayMissionContract> = {}): RelayMissionContract {
  const built = buildMissionContract({
    spec: SPEC, missionId: 'msn-1', projectId: 'prj-1',
    now: '2026-08-27T00:00:00.000Z', provenance: 'live',
  });
  if (!built.ok) throw new Error(`fixture mission must build: ${built.error.message}`);
  return { ...built.value, ...over };
}

function configuration(over: Partial<CompoundAgentConfiguration> = {}): CompoundAgentConfiguration {
  const result = createCompoundAgentConfiguration({
    draft: {
      compoundAgentId: 'agent-1', displayName: 'Agent One',
      slots: [
        { role: 'PROMPT_ARCHITECT', integrationId: 'architect_a', requiredCapabilities: [] },
        { role: 'CODING_AGENT', integrationId: 'coder_b', requiredCapabilities: [] },
        { role: 'INDEPENDENT_REVIEWER', integrationId: 'reviewer_c', requiredCapabilities: [] },
      ],
      card: { referenceId: 'card-standard', revision: 'card-r3' },
      projectBrain: { referenceId: 'brain-1', revision: 'brain-r9' },
      missionDefaults: {
        executionMode: 'semi', reviewRequirement: 'independent', completionRule: 'strict',
        limits: { runtimeMinutes: 45, agentCalls: null, spendUsd: 3, reviewCycles: 2, repairCycles: null },
      },
      activation: 'ACTIVE',
    },
    authority: AUTHORITY, directory: DIRECTORY, now: '2026-08-27T00:00:00.000Z',
  });
  if (!result.ok) throw new Error('fixture configuration must create');
  return { ...result.configuration, ...over };
}

const input = (over: Partial<JuliusBootstrapInput> = {}): JuliusBootstrapInput => ({
  mission: mission(), configuration: configuration(), authorization: AUTHORIZATION,
  authority: AUTHORITY, current: CURRENT, directory: DIRECTORY,
  idempotencyKey: 'boot-0000-0001', now: '2026-08-27T01:00:00.000Z', ...over,
});

const reasons = (result: ReturnType<typeof compileJuliusBootstrapRequest>) =>
  (result.ok ? [] : result.problems.map((p) => p.reason));

/* -------------------------------------------------------- the happy path */

describe('compiling an authorized mission', () => {
  const compiled = () => {
    const result = compileJuliusBootstrapRequest(input());
    if (!result.ok) throw new Error(`must compile: ${JSON.stringify(reasons(result))}`);
    return result.request;
  };

  it('stamps the request version and carries the idempotency key', () => {
    const request = compiled();
    expect(request.requestVersion).toBe(JULIUS_BOOTSTRAP_REQUEST_VERSION);
    expect(request.idempotencyKey).toBe('boot-0000-0001');
    expect(request.compiledAt).toBe('2026-08-27T01:00:00.000Z');
  });

  it('carries mission identity, revision and binding digest without altering them', () => {
    const source = mission();
    const request = compiled();
    expect(request.missionId).toBe(source.missionId);
    expect(request.projectId).toBe(source.projectId);
    expect(request.missionRevision).toBe(source.revision);
    expect(request.missionBindingDigest).toBe(source.bindingDigest);
    expect(request.missionBindingDigest).not.toBe('');
  });

  it('carries every acceptance criterion, blocking flag included', () => {
    expect(compiled().acceptanceCriteria).toEqual([
      { id: 'ac-1', text: 'The request carries the mission binding digest.', blocking: true },
      { id: 'ac-2', text: 'The request carries the pinned revisions.', blocking: false },
    ]);
  });

  it('carries the mission scope on all four axes', () => {
    const source = mission();
    expect(compiled().scope).toEqual({
      filesInScope: source.filesInScope, filesOutOfScope: source.filesOutOfScope,
      systemsInScope: source.systemsInScope, systemsOutOfScope: source.systemsOutOfScope,
    });
  });

  it('emits one provider-neutral worker per slot and no provider id', () => {
    const request = compiled();
    expect(request.workers).toHaveLength(3);
    expect(request.workers.map((w) => w.role).sort())
      .toEqual(['CODING_AGENT', 'INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT']);
    for (const worker of request.workers) {
      expect(worker.adapterId).toBe(`${worker.integrationId}-adapter`);
      expect(worker.independenceGroup).not.toBe('');
      // Relay never guesses which provider Julius's router will pick.
      expect(Object.keys(worker)).not.toContain('providerId');
    }
  });

  it('carries the Compound Agent revision, so a later edit is detectable', () => {
    const request = compiled();
    expect(request.compoundAgentId).toBe('agent-1');
    expect(request.compoundAgentRevision).toBe(1);
  });

  it('carries the pinned C.A.R.D. and Project Brain references verbatim', () => {
    const request = compiled();
    expect(request.card).toEqual({ referenceId: 'card-standard', revision: 'card-r3' });
    expect(request.projectBrain).toEqual({ referenceId: 'brain-1', revision: 'brain-r9' });
  });

  it('takes execution policy from the Compound Agent and the completion rule from the mission', () => {
    const request = compiled();
    expect(request.executionMode).toBe('semi');
    expect(request.reviewRequirement).toBe('independent');
    expect(request.completionRule).toBe(mission().completionRule);
    expect(request.limits).toEqual({
      runtimeMinutes: 45, agentCalls: null, spendUsd: 3, reviewCycles: 2, repairCycles: null,
    });
  });

  it('keeps an unset limit null rather than inventing a ceiling', () => {
    expect(compiled().limits.agentCalls).toBeNull();
    expect(compiled().limits.repairCycles).toBeNull();
  });

  it('carries no credential, prompt or reasoning', () => {
    const serialized = JSON.stringify(compiled());
    for (const shape of [
      /sk-[A-Za-z0-9]{8,}/, /gh[pousr]_[A-Za-z0-9]{20,}/,
      /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/, /BEGIN [A-Z ]*PRIVATE KEY/,
    ]) {
      expect(shape.test(serialized), `compiled request matched ${shape}`).toBe(false);
    }
    expect(serialized.toLowerCase()).not.toContain('chain of thought');
    expect(serialized.toLowerCase()).not.toContain('system prompt');
  });

  it('is deterministic — the same inputs compile to the same request', () => {
    expect(compileJuliusBootstrapRequest(input())).toEqual(compileJuliusBootstrapRequest(input()));
  });
});

/* ------------------------------------------------------------- refusals */

describe('it fails closed', () => {
  it('refuses an absent or incomplete authorization', () => {
    const table: Array<[Partial<JuliusBootstrapAuthorization>, string]> = [
      [{ authorizationRef: '' }, 'blank reference'],
      [{ authorizationRef: '   ' }, 'whitespace reference'],
      [{ method: 'forged' as never }, 'unknown method'],
      [{ ownerParticipant: '' }, 'no participant'],
    ];
    for (const [override, label] of table) {
      const result = compileJuliusBootstrapRequest(input({
        authorization: { ...AUTHORIZATION, ...override },
      }));
      expect(result.ok, label).toBe(false);
      expect(reasons(result), label).toContain('authorization_absent');
    }
  });

  it('refuses a tenant mismatch between authorization, agent and caller', () => {
    expect(reasons(compileJuliusBootstrapRequest(input({
      authorization: { ...AUTHORIZATION, tenantId: 'tenant-2' },
    })))).toContain('tenant_mismatch');
    expect(reasons(compileJuliusBootstrapRequest(input({
      configuration: configuration({ tenantId: 'tenant-2' }),
    })))).toContain('tenant_mismatch');
  });

  it('refuses a Compound Agent belonging to another project', () => {
    const result = compileJuliusBootstrapRequest(input({
      configuration: configuration({ projectId: 'prj-other' }),
    }));
    expect(reasons(result)).toContain('compound_agent_project_mismatch');
  });

  it('refuses a mission belonging to another project', () => {
    const result = compileJuliusBootstrapRequest(input({
      mission: mission({ projectId: 'prj-other' }),
    }));
    expect(reasons(result)).toContain('project_mismatch');
  });

  it('refuses a malformed idempotency key', () => {
    for (const key of ['', 'short', 'has space!!', 'a'.repeat(129), '-leading-dash-key']) {
      const result = compileJuliusBootstrapRequest(input({ idempotencyKey: key }));
      expect(result.ok, JSON.stringify(key)).toBe(false);
      expect(reasons(result)).toContain('invalid_idempotency_key');
      expect(IDEMPOTENCY_KEY.test(key)).toBe(false);
    }
  });

  it('refuses a malformed Mission Contract rather than completing it', () => {
    for (const broken of [
      { objective: '' }, { bindingDigest: '' }, { revision: 0 }, { missionId: '' },
    ] as Partial<RelayMissionContract>[]) {
      const result = compileJuliusBootstrapRequest(input({ mission: mission(broken) }));
      expect(result.ok, JSON.stringify(broken)).toBe(false);
      expect(reasons(result)).toContain('malformed_mission_contract');
    }
  });

  it('gives each unstartable mission status its own reason', () => {
    const table = [
      ['draft', 'mission_not_locked'],
      ['in_progress', 'mission_already_running'],
      ['blocked', 'mission_already_running'],
      ['verified_complete', 'mission_terminal'],
      ['cancelled', 'mission_terminal'],
    ] as const;
    for (const [status, expected] of table) {
      const result = compileJuliusBootstrapRequest(input({ mission: mission({ status }) }));
      expect(result.ok, status).toBe(false);
      expect(reasons(result), status).toContain(expected);
    }
  });

  it('refuses a mission with no acceptance criteria at all', () => {
    const result = compileJuliusBootstrapRequest(input({ mission: mission({ acceptanceCriteria: [] }) }));
    expect(reasons(result)).toContain('acceptance_criteria_missing');
  });

  it('refuses a mission whose criteria are all non-blocking', () => {
    const result = compileJuliusBootstrapRequest(input({
      mission: mission({ acceptanceCriteria: [{ id: 'ac-1', text: 'Nice to have.', blocking: false }] }),
    }));
    expect(reasons(result)).toContain('blocking_acceptance_criterion_missing');
  });

  it('refuses duplicate acceptance criterion ids, because findings attribute by id', () => {
    const result = compileJuliusBootstrapRequest(input({
      mission: mission({
        acceptanceCriteria: [
          { id: 'ac-1', text: 'First.', blocking: true },
          { id: 'ac-1', text: 'Second.', blocking: true },
        ],
      }),
    }));
    expect(reasons(result)).toContain('duplicate_acceptance_criterion_id');
  });

  it('refuses a Compound Agent that is not activated', () => {
    for (const activation of ['DRAFT', 'RETIRED'] as const) {
      const result = compileJuliusBootstrapRequest(input({ configuration: configuration({ activation }) }));
      expect(result.ok, activation).toBe(false);
      expect(reasons(result)).toContain('configuration_not_activated');
    }
  });

  it('refuses worker slots that no longer resolve, and returns the typed problems', () => {
    const shrunk: IntegrationDirectory = {
      lookup: (id) => (id === 'coder_b' ? null : DIRECTORY.lookup(id)),
    };
    const result = compileJuliusBootstrapRequest(input({ directory: shrunk }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(reasons(result)).toContain('invalid_worker_configuration');
    expect(result.configurationProblems.map((p) => p.reason)).toContain('unknown_integration');
  });

  it('refuses a Julius-named worker through the configuration check', () => {
    const polluted: IntegrationDirectory = {
      lookup: (id) => (id === 'julius' ? entry({ integrationId: 'julius' }) : DIRECTORY.lookup(id)),
    };
    const config = configuration({
      slots: [
        { role: 'PROMPT_ARCHITECT', integrationId: 'architect_a', requiredCapabilities: [] },
        { role: 'CODING_AGENT', integrationId: 'julius', requiredCapabilities: [] },
        { role: 'INDEPENDENT_REVIEWER', integrationId: 'reviewer_c', requiredCapabilities: [] },
      ],
    });
    const result = compileJuliusBootstrapRequest(input({ configuration: config, directory: polluted }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.configurationProblems.map((p) => p.reason)).toContain('julius_cannot_occupy_worker_slot');
  });

  it('refuses an unverifiable pin rather than assuming it is fresh', () => {
    expect(reasons(compileJuliusBootstrapRequest(input({
      current: { ...CURRENT, cardRevision: null },
    })))).toContain('card_revision_unknown');
    expect(reasons(compileJuliusBootstrapRequest(input({
      current: { ...CURRENT, projectBrainRevision: null },
    })))).toContain('project_brain_revision_unknown');
  });

  it('refuses a stale C.A.R.D. or Project Brain pin', () => {
    expect(reasons(compileJuliusBootstrapRequest(input({
      current: { ...CURRENT, cardRevision: 'card-r4' },
    })))).toContain('card_revision_stale');
    expect(reasons(compileJuliusBootstrapRequest(input({
      current: { ...CURRENT, projectBrainRevision: 'brain-r10' },
    })))).toContain('project_brain_revision_stale');
  });

  it('reports every refusal at once, not the first', () => {
    const result = compileJuliusBootstrapRequest(input({
      mission: mission({ status: 'draft', objective: '' }),
      authorization: { ...AUTHORIZATION, authorizationRef: '' },
      idempotencyKey: 'x',
      current: { cardRevision: null, projectBrainRevision: 'brain-r10' },
    }));
    expect(result.ok).toBe(false);
    expect(reasons(result)).toEqual(expect.arrayContaining([
      'authorization_absent', 'invalid_idempotency_key', 'malformed_mission_contract',
      'mission_not_locked', 'card_revision_unknown', 'project_brain_revision_stale',
    ]));
  });

  it('never returns a request on the refusing branch', () => {
    const result = compileJuliusBootstrapRequest(input({ idempotencyKey: '' }));
    expect(result.ok).toBe(false);
    expect(Object.keys(result)).not.toContain('request');
  });

  it('safe messages name fields and ids, never a credential', () => {
    const result = compileJuliusBootstrapRequest(input({
      authorization: { ...AUTHORIZATION, authorizationRef: '' }, idempotencyKey: '',
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const p of result.problems) {
      expect(p.safeMessage.length).toBeGreaterThan(0);
      expect(p.safeMessage).not.toMatch(/sk-[A-Za-z0-9]{8,}|Bearer\s+\S{16,}/);
      expect(p.field.length).toBeGreaterThan(0);
    }
  });
});

/* --------------------------------------------------------------- the port */

describe('the unwired port', () => {
  it('refuses honestly instead of pretending a run began', async () => {
    const port = unwiredJuliusBootstrapPort();
    expect(port.portVersion).toBe(RELAY_JULIUS_PORT_VERSION);
    const result = compileJuliusBootstrapRequest(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const outcome = await port.submit(result.request);
    expect(outcome.accepted).toBe(false);
    if (outcome.accepted) return;
    expect(outcome.reasonCode).toBe('julius_runtime_not_wired');
    expect(outcome.retryable).toBe(false);
    expect(outcome.safeMessage).toContain('it was not submitted anywhere');
    // A refusal carries no run id to read.
    expect(Object.keys(outcome)).not.toContain('runId');
  });

  it('models denial as a value, so a surface must handle it', async () => {
    const denying = {
      portVersion: RELAY_JULIUS_PORT_VERSION,
      submit: async () => ({
        accepted: false as const, reasonCode: 'policy_denied',
        safeMessage: 'The C.A.R.D. policy denied this request.', retryable: false,
      }),
    };
    const outcome = await denying.submit();
    expect(outcome.accepted).toBe(false);
  });
});
