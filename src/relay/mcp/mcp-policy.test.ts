import { describe, expect, it } from 'vitest';

import { EMPTY_ANNOTATIONS } from './domain/mcp-capabilities';
import { argumentFingerprint } from './domain/mcp-invocation';
import {
  approvalCovers, consumeApproval, DEFAULT_MAXIMUM_INVOCATIONS, findCoveringApproval, revokeApproval,
} from './policy/mcp-approvals';
import {
  evaluatePermission, MCP_FORBIDDEN_ROLES, MCP_ROLE_DEFAULTS, pathWithinScope,
} from './policy/mcp-permissions';
import { classifyRisk, normalizeToolName, requiresHumanApproval } from './policy/mcp-risk';
import {
  buildApproval, buildGrant, buildIdentity, buildSnapshot, TEST_ACCOUNT, TEST_MISSION,
  TEST_PROJECT, TEST_REGISTRY_ENTRY, TEST_WORKSPACE, TEST_NOW,
} from './testing/mcp-test-fixtures';

/* ==================================================================== *
 * RISK CLASSIFICATION
 * ==================================================================== */

const classify = (
  toolName: string,
  overrides: Partial<Parameters<typeof classifyRisk>[0]> = {},
) => classifyRisk({
  toolName,
  description: '',
  inputSchema: {},
  annotations: EMPTY_ANNOTATIONS,
  registryDeclaredClass: null,
  serverIdentityVerified: true,
  ...overrides,
});

describe('risk classification — the §10 examples', () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['read_file', 'read_only'],
    ['search_repository', 'read_only'],
    ['write_file', 'workspace_write'],
    ['create_branch', 'workspace_write'],
    ['create_issue', 'external_write'],
    ['send_message', 'external_write'],
    ['merge_pull_request', 'destructive'],
    ['deploy', 'deployment'],
    ['create_charge', 'financial'],
    ['read_secret', 'credential_access'],
    ['update_secret', 'credential_access'],
    ['drop_table', 'destructive'],
  ];

  for (const [tool, expected] of cases) {
    it(`${tool} -> ${expected}`, () => {
      expect(classify(tool).riskClass).toBe(expected);
    });
  }
});

describe('risk classification cannot be defeated by naming style', () => {
  it('normalizes camelCase, kebab-case and SCREAMING_CASE to the same words', () => {
    expect(normalizeToolName('mergePullRequest')).toBe('merge_pull_request');
    expect(normalizeToolName('merge-pull-request')).toBe('merge_pull_request');
    expect(normalizeToolName('MERGE_PULL_REQUEST')).toBe('merge_pull_request');
  });

  it('classifies all three spellings identically', () => {
    for (const spelling of ['mergePullRequest', 'merge-pull-request', 'MERGE_PULL_REQUEST']) {
      expect(classify(spelling).riskClass, spelling).toBe('destructive');
    }
  });
});

describe('an unclassifiable tool fails closed', () => {
  it('is `unknown`, requires approval, and says no rule matched', () => {
    const result = classify('frobnicate');
    expect(result.riskClass).toBe('unknown');
    expect(result.requiresHumanApproval).toBe(true);
    expect(result.evidence.join(' ')).toContain('no rule');
  });

  it('unknown ranks ABOVE destructive — not knowing is worse than knowing it is bad', () => {
    expect(requiresHumanApproval('unknown')).toBe(true);
  });
});

describe('annotations are evidence, never authority', () => {
  it('a tool claiming readOnlyHint is still classified external_write, with the contradiction recorded', () => {
    const result = classify('create_issue', {
      annotations: { ...EMPTY_ANNOTATIONS, readOnlyHint: true },
    });
    expect(result.riskClass).toBe('external_write');
    expect(result.annotationContradiction).toBe(true);
    expect(result.evidence.join(' ')).toContain('not honoured');
  });

  it('a destructive tool claiming destructiveHint:false is still destructive', () => {
    const result = classify('drop_table', {
      annotations: { ...EMPTY_ANNOTATIONS, destructiveHint: false },
    });
    expect(result.riskClass).toBe('destructive');
    expect(result.annotationContradiction).toBe(true);
  });

  it('an honest annotation produces no contradiction', () => {
    const result = classify('read_file', { annotations: { ...EMPTY_ANNOTATIONS, readOnlyHint: true } });
    expect(result.annotationContradiction).toBe(false);
  });
});

describe('schema and argument signals', () => {
  it('a read-NAMED tool that accepts a path AND content is classified as a write', () => {
    const result = classify('read_file', {
      inputSchema: { type: 'object', properties: { path: {}, content: {} } },
    });
    expect(result.riskClass).toBe('workspace_write');
    expect(result.evidence.join(' ')).toContain('this writes');
  });

  it('an argument escaping the workspace root raises risk and is flagged as boundary-crossing', () => {
    const result = classify('read_file', { argumentValues: { path: '../../etc/passwd' } });
    expect(result.crossesWorkspaceBoundary).toBe(true);
  });

  it('an absolute remote destination is flagged as boundary-crossing', () => {
    const result = classify('read_file', { argumentValues: { url: 'https://evil.example/x' } });
    expect(result.crossesWorkspaceBoundary).toBe(true);
  });
});

describe('registry declarations are a FLOOR, never a ceiling', () => {
  it('raises a classification when the registry declares something worse', () => {
    const result = classify('read_file', { registryDeclaredClass: 'destructive' });
    expect(result.riskClass).toBe('destructive');
  });

  it('does NOT lower a classification when the registry declares something safer', () => {
    const result = classify('drop_table', { registryDeclaredClass: 'read_only' });
    expect(result.riskClass).toBe('destructive');
  });

  it('supplies a class when Relay could not derive one', () => {
    const result = classify('frobnicate', { registryDeclaredClass: 'workspace_write' });
    expect(result.riskClass).toBe('workspace_write');
  });
});

describe('an unverified server identity cannot hold a low classification', () => {
  it('demotes read_only to unknown when the server was never verified', () => {
    const result = classify('read_file', { serverIdentityVerified: false });
    expect(result.riskClass).toBe('unknown');
    expect(result.evidence.join(' ')).toContain('not independently verified');
  });
});

describe('risk overrides', () => {
  it('raising is always permitted', () => {
    const result = classify('read_file', {
      overrides: [{ toolName: 'read_file', riskClass: 'destructive', founderAuthorized: false, reason: 'known bad' }],
    });
    expect(result.riskClass).toBe('destructive');
    expect(result.overrideApplied).toBe(true);
  });

  it('lowering WITHOUT founder authorization is REFUSED and recorded', () => {
    const result = classify('drop_table', {
      overrides: [{ toolName: 'drop_table', riskClass: 'read_only', founderAuthorized: false, reason: 'trust me' }],
    });
    expect(result.riskClass).toBe('destructive');
    expect(result.overrideApplied).toBe(false);
    expect(result.evidence.join(' ')).toContain('REFUSED');
  });

  it('lowering WITH founder authorization is applied and loudly recorded', () => {
    const result = classify('drop_table', {
      overrides: [{ toolName: 'drop_table', riskClass: 'workspace_write', founderAuthorized: true, reason: 'sandboxed replica' }],
    });
    expect(result.riskClass).toBe('workspace_write');
    expect(result.evidence.join(' ')).toContain('FOUNDER-AUTHORIZED');
  });
});

/* ==================================================================== *
 * PERMISSIONS
 * ==================================================================== */

const evaluate = (overrides: Partial<Parameters<typeof evaluatePermission>[0]> = {}) => evaluatePermission({
  accountId: TEST_ACCOUNT,
  workspaceId: TEST_WORKSPACE,
  projectId: TEST_PROJECT,
  missionId: TEST_MISSION,
  pspAgentFingerprint: null,
  actualAgentId: 'agent-coding-1',
  role: 'coding-agent',
  serverIdentity: buildIdentity(),
  registryEntryId: TEST_REGISTRY_ENTRY,
  capabilitySnapshotIsApproved: true,
  capabilityExistsInSnapshot: true,
  capabilityKind: 'tool',
  capabilityName: 'read_file',
  normalizedArguments: { path: 'src/a.ts' },
  riskClass: 'read_only',
  missingCredentialScopes: [],
  networkPolicyAllows: true,
  grants: [buildGrant()],
  missionWritablePathPrefixes: ['src/'],
  now: TEST_NOW,
  ...overrides,
});

describe('THE REVIEWER RULE — absolute, first, unoverridable', () => {
  it('denies the reviewer even with a maximally permissive grant, an approval and read_only risk', () => {
    const decision = evaluate({
      role: 'reviewer',
      riskClass: 'read_only',
      grants: [buildGrant({ role: 'reviewer', maximumRiskClass: 'destructive', capabilityNames: ['read_file'] })],
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('no MCP access by design');
    expect(decision.evidence.join(' ')).toContain('no grant, approval or risk class can change this');
  });

  it('denies the security-reviewer for the same reason', () => {
    expect(evaluate({ role: 'security-reviewer' }).decision).toBe('deny');
  });

  it('both reviewing roles are on the permanent denial list and have empty defaults', () => {
    expect(MCP_FORBIDDEN_ROLES).toContain('reviewer');
    expect(MCP_FORBIDDEN_ROLES).toContain('security-reviewer');
    expect(MCP_ROLE_DEFAULTS.reviewer.allowedRiskClasses).toEqual([]);
    expect(MCP_ROLE_DEFAULTS.reviewer.approvableRiskClasses).toEqual([]);
    expect(MCP_ROLE_DEFAULTS.reviewer.allowedCapabilityKinds).toEqual([]);
  });

  it('denies the reviewer for EVERY capability kind and EVERY risk class', () => {
    for (const kind of ['tool', 'resource', 'prompt'] as const) {
      for (const risk of ['read_only', 'workspace_write', 'external_write', 'destructive'] as const) {
        expect(evaluate({ role: 'reviewer', capabilityKind: kind, riskClass: risk }).decision, `${kind}/${risk}`).toBe('deny');
      }
    }
  });
});

describe('Prompt Architect defaults', () => {
  it('allows read-only work', () => {
    const decision = evaluate({
      role: 'architect',
      riskClass: 'read_only',
      grants: [buildGrant({ role: 'architect' })],
    });
    expect(decision.decision).toBe('allow');
  });

  it('DENIES workspace writes — not even approvable for this role', () => {
    const decision = evaluate({
      role: 'architect',
      riskClass: 'workspace_write',
      capabilityName: 'write_file',
      grants: [buildGrant({ role: 'architect', capabilityNames: ['write_file'], maximumRiskClass: 'workspace_write' })],
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('may not perform workspace_write');
  });

  it('DENIES external writes, deployment, financial, credential and destructive operations', () => {
    for (const risk of ['external_write', 'deployment', 'financial', 'credential_access', 'destructive'] as const) {
      const decision = evaluate({
        role: 'architect',
        riskClass: risk,
        grants: [buildGrant({ role: 'architect', maximumRiskClass: 'destructive' })],
      });
      expect(decision.decision, risk).toBe('deny');
    }
  });
});

describe('Coding Agent defaults', () => {
  it('allows a mission-scoped workspace write inside the approved path scope', () => {
    const decision = evaluate({
      riskClass: 'workspace_write',
      capabilityName: 'write_file',
      normalizedArguments: { path: 'src/feature.ts', content: 'x' },
      grants: [buildGrant({ capabilityNames: ['write_file'], maximumRiskClass: 'workspace_write' })],
    });
    expect(decision.decision).toBe('allow');
  });

  it('REFUSES a write outside the approved path scope', () => {
    const decision = evaluate({
      riskClass: 'workspace_write',
      capabilityName: 'write_file',
      normalizedArguments: { path: 'infra/deploy.yaml', content: 'x' },
      grants: [buildGrant({ capabilityNames: ['write_file'], maximumRiskClass: 'workspace_write' })],
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('outside the approved path scope');
  });

  it('REFUSES a write that names no path at all', () => {
    const decision = evaluate({
      riskClass: 'workspace_write',
      capabilityName: 'write_file',
      normalizedArguments: { content: 'x' },
      grants: [buildGrant({ capabilityNames: ['write_file'], maximumRiskClass: 'workspace_write' })],
    });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('must name its target path');
  });

  it('requires human approval for an external write', () => {
    const decision = evaluate({
      riskClass: 'external_write',
      capabilityName: 'create_issue',
      grants: [buildGrant({ capabilityNames: ['create_issue'], maximumRiskClass: 'external_write' })],
    });
    expect(decision.decision).toBe('requires_approval');
  });

  it('DENIES deployment, financial, credential access and destructive operations outright', () => {
    for (const risk of ['deployment', 'financial', 'credential_access', 'destructive'] as const) {
      const decision = evaluate({
        riskClass: risk,
        capabilityName: 'x',
        grants: [buildGrant({ capabilityNames: ['x'], maximumRiskClass: 'destructive' })],
      });
      expect(decision.decision, risk).toBe('deny');
    }
  });
});

describe('permission evaluation fails closed', () => {
  it('denies an unrecognised role', () => {
    expect(evaluate({ role: 'wizard' }).decision).toBe('deny');
  });

  it('denies `unknown` risk for every permitted role', () => {
    for (const role of ['architect', 'coding-agent'] as const) {
      const decision = evaluate({ role, riskClass: 'unknown', grants: [buildGrant({ role, maximumRiskClass: 'destructive' })] });
      expect(decision.decision, role).toBe('deny');
      expect(decision.reason).toContain('could not classify');
    }
  });

  it('denies an untrusted server', () => {
    const decision = evaluate({ serverIdentity: buildIdentity({ trust: 'untrusted' }) });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('untrusted');
  });

  it('denies when the snapshot is not approved', () => {
    expect(evaluate({ capabilitySnapshotIsApproved: false }).decision).toBe('deny');
  });

  it('denies a capability absent from the approved snapshot', () => {
    const decision = evaluate({ capabilityExistsInSnapshot: false });
    expect(decision.decision).toBe('deny');
    expect(decision.evidence.join(' ')).toContain('even if the live server offers it');
  });

  it('denies when the network policy refuses', () => {
    expect(evaluate({ networkPolicyAllows: false }).decision).toBe('deny');
  });

  it('denies with the MISSING SCOPE NAMED', () => {
    const decision = evaluate({ missingCredentialScopes: ['repo:write'] });
    expect(decision.decision).toBe('deny');
    expect(decision.reason).toContain('repo:write');
  });

  it('denies when no grant names the capability — there is no wildcard grant', () => {
    const decision = evaluate({ capabilityName: 'some_other_tool' });
    expect(decision.decision).toBe('deny');
    expect(decision.evidence.join(' ')).toContain('no wildcard grant');
  });

  it('denies an expired or revoked grant', () => {
    expect(evaluate({ grants: [buildGrant({ expiresAt: '2026-08-01T00:00:00.000Z' })] }).decision).toBe('deny');
    expect(evaluate({ grants: [buildGrant({ revokedAt: TEST_NOW })] }).decision).toBe('deny');
  });

  it('denies a grant belonging to another workspace or mission', () => {
    expect(evaluate({ grants: [buildGrant({ workspaceId: 'wsp-other' })] }).decision).toBe('deny');
    expect(evaluate({ grants: [buildGrant({ missionId: 'msn-other' })] }).decision).toBe('deny');
  });
});

describe('path scoping refuses what it would have to normalize before trusting', () => {
  it('accepts a path inside a prefix', () => {
    expect(pathWithinScope('src/a/b.ts', ['src/'])).toBe(true);
    expect(pathWithinScope('src', ['src'])).toBe(true);
  });

  it('refuses absolute paths', () => {
    expect(pathWithinScope('/etc/passwd', ['src/'])).toBe(false);
    expect(pathWithinScope('C:/Windows', ['src/'])).toBe(false);
  });

  it('refuses ANY traversal segment rather than resolving it', () => {
    expect(pathWithinScope('src/../../etc/passwd', ['src/'])).toBe(false);
    expect(pathWithinScope('src/../etc', ['src/'])).toBe(false);
  });

  it('refuses a sibling directory whose name merely starts with the prefix', () => {
    expect(pathWithinScope('srcret/x.ts', ['src'])).toBe(false);
  });

  it('refuses everything when no prefix is configured', () => {
    expect(pathWithinScope('src/a.ts', [])).toBe(false);
  });
});

/* ==================================================================== *
 * APPROVALS
 * ==================================================================== */

describe('approvals never widen', () => {
  const snapshot = buildSnapshot();
  const check = (overrides: Partial<Parameters<typeof approvalCovers>[1]> = {}) => ({
    accountId: TEST_ACCOUNT,
    workspaceId: TEST_WORKSPACE,
    projectId: null,
    missionId: TEST_MISSION,
    actualAgentId: 'agent-coding-1',
    agentRole: 'coding-agent',
    serverName: 'Repository Reader (fixture)',
    capabilitySnapshotFingerprint: snapshot.fingerprint,
    capabilityKind: 'tool' as const,
    capabilityName: 'create_issue',
    argumentFingerprint: argumentFingerprint('create_issue', { repository: 'a', title: 't' }),
    riskClass: 'external_write' as const,
    now: TEST_NOW,
    ...overrides,
  });

  it('covers the exact operation it was granted for', () => {
    expect(approvalCovers(buildApproval(), check()).covered).toBe(true);
  });

  it('reading Repository A does NOT permit Repository B', () => {
    const verdict = approvalCovers(buildApproval(), check({
      argumentFingerprint: argumentFingerprint('create_issue', { repository: 'b', title: 't' }),
    }));
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.reason).toContain('different arguments');
  });

  it('creating a branch does NOT permit merging', () => {
    const verdict = approvalCovers(buildApproval(), check({ capabilityName: 'merge_pull_request' }));
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.reason).toContain('create_issue');
  });

  it('an approval for one risk class does not cover a higher one', () => {
    const verdict = approvalCovers(buildApproval(), check({ riskClass: 'destructive' }));
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.reason).toContain('external_write');
  });

  it('a single-use approval does NOT permit unlimited recurrence', () => {
    const used = consumeApproval(buildApproval());
    expect(used.usageCount).toBe(1);
    expect(used.state).toBe('exhausted');
    const verdict = approvalCovers(used, check());
    expect(verdict.covered).toBe(false);
  });

  it('an approval for one agent does not cover another agent', () => {
    const verdict = approvalCovers(buildApproval(), check({ actualAgentId: 'agent-other' }));
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.reason).toContain('different agent');
  });

  it('an approval for one server does not cover another server', () => {
    const verdict = approvalCovers(buildApproval(), check({ serverName: 'Other Server' }));
    expect(verdict.covered).toBe(false);
  });

  it('an approval is void once the capability SNAPSHOT changes', () => {
    const other = buildSnapshot({ tools: [{ name: 'read_file', description: 'changed', inputSchema: {} }] });
    const verdict = approvalCovers(buildApproval(), check({ capabilitySnapshotFingerprint: other.fingerprint }));
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.reason).toContain('capability surface changed');
  });

  it('expires', () => {
    const verdict = approvalCovers(
      buildApproval({ expiresAt: '2026-08-02T11:00:00.000Z', maximumInvocations: 5 }),
      check(),
    );
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.state).toBe('expired');
  });

  it('is void once revoked', () => {
    const verdict = approvalCovers(revokeApproval(buildApproval(), TEST_NOW), check());
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.state).toBe('revoked');
  });

  it('ask_every_time grants nothing standing', () => {
    const verdict = approvalCovers(buildApproval({ policy: 'ask_every_time' }), check());
    expect(verdict.covered).toBe(false);
  });

  it('an explicit deny is final and is not overtaken by a later broader grant', () => {
    const verdict = findCoveringApproval(
      [
        buildApproval({ policy: 'deny', state: 'denied' }),
        buildApproval({ approvalRecordId: 'mca_test0002' as never, policy: 'always_allow', maximumInvocations: 100 }),
      ],
      check(),
    );
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.state).toBe('denied');
  });

  it('allow_for_mission drops the argument binding but keeps the mission binding', () => {
    const record = buildApproval({ policy: 'allow_for_mission', maximumInvocations: 10 });
    const differentArgs = approvalCovers(record, check({
      argumentFingerprint: argumentFingerprint('create_issue', { repository: 'z', title: 'q' }),
    }));
    expect(differentArgs.covered).toBe(true);

    const otherMission = approvalCovers(record, check({ missionId: 'msn-other' }));
    expect(otherMission.covered).toBe(false);
    expect(otherMission.covered === false && otherMission.reason).toContain('different mission');
  });

  it('reports "no human approval exists" when the set is empty', () => {
    const verdict = findCoveringApproval([], check());
    expect(verdict.covered).toBe(false);
    expect(verdict.covered === false && verdict.state).toBe('absent');
  });

  it('always_allow is bounded, not infinite', () => {
    expect(DEFAULT_MAXIMUM_INVOCATIONS.always_allow).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_MAXIMUM_INVOCATIONS.always_allow)).toBe(true);
    expect(DEFAULT_MAXIMUM_INVOCATIONS.allow_once).toBe(1);
    expect(DEFAULT_MAXIMUM_INVOCATIONS.deny).toBe(0);
  });
});
