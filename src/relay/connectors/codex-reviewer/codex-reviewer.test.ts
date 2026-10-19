import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deterministicIds } from '../../testing/factories';
import { buildExecutionAttestation, attestsSuccessfulExecution } from '../../mission/attestation';
import { evaluateReviewerGate } from '../../mission/reviewer-gate';
import {
  DEFAULT_REVIEWER_LIMITS, REVIEW_REPORT_MARKER, type RelayReviewReport, type ReviewReportFinding,
} from './contracts';
import { buildCodexEnvironment, apiKeyEnvironmentDetected } from './environment';
import { assessCodexConfiguration } from './configuration';
import {
  classifyCodexAuth, classifyCodexLoginOutput, probeCodexLoginStatus,
  resolveCodexExecutable, selectRuntimeStrategy,
} from './capability-probe';
import { compileReviewerPrompt, reviewReportJsonSchema, type ReviewerPromptContext } from './reviewer-prompt-compiler';
import { compileReviewerPermissions, FORBIDDEN_FLAGS } from './permission-compiler';
import { parseReviewReport, type ExpectedReview } from './report-parser';
import { createReviewerStreamParser, reviewerStreamIsStructurallyValid } from './stream-parser';
import { buildReviewerAttestation } from './attestation';
import { createCodexReviewerAdapter, codexReviewerDescriptor } from './adapter';
import { runCodexReviewerContractVerification } from './verify-harness';

/**
 * Codex Reviewer adapter tests (Prompt 8.3) — pure/unit coverage plus the
 * offline contract verification. NO provider call anywhere (fake executable
 * only). These are never live Codex tests.
 */

const SYNTH_CAPS = {
  executablePath: '/fake/codex', version: '0.0.0', nonInteractiveExecSupported: true, jsonEventsSupported: true,
  outputSchemaSupported: true, outputLastMessageSupported: true, exactResumeSupported: true, nativeReviewSupported: true,
  uncommittedReviewSupported: true, baseReviewSupported: true, commitReviewSupported: true, readOnlySandboxSupported: true,
  workspaceWriteSandboxSupported: true, ignoreUserConfigSupported: true, ignoreRulesSupported: true, strictConfigSupported: true,
  cancellationSupported: true, authenticationStatus: 'ready' as const, selectedRuntimeStrategy: 'exec_structured_review' as const,
  probedAt: 't', provenance: 'live' as const,
};

const EXPECTED: ExpectedReview = {
  reviewId: 'rvw_1', missionId: 'msn_1', taskId: 'tsk_1', missionRevision: 1, taskRevision: 1, workspaceRevision: 'rev1',
};

const blockingFinding: ReviewReportFinding = {
  severity: 'high', title: 'dispatch bug', description: '&& should be ||',
  evidence: ['src/dispatch.js'], affectedFiles: ['src/dispatch.js'], affectedCriterionIds: ['AC-1'],
  requiredAction: 'change && to ||', blocking: true,
};

const validReport = (over: Partial<RelayReviewReport> = {}): string => JSON.stringify({
  reviewId: 'rvw_1', missionId: 'msn_1', taskId: 'tsk_1', reviewedMissionRevision: 1, reviewedTaskRevision: 1,
  reviewedWorkspaceRevision: 'rev1', reviewerRole: 'independent_coding_reviewer', verdict: 'changes_required',
  summary: 'found a bug', findings: [blockingFinding], evidenceReviewed: ['git diff'], limitations: [], ...over,
});

describe('environment filtering', () => {
  it('strips provider keys, keeps PATH + CODEX_HOME, records stripped names', () => {
    const filtered = buildCodexEnvironment({
      PATH: '/bin', HOME: '/home/x', CODEX_HOME: '/home/x/.codex',
      OPENAI_API_KEY: 'sk-FAKETESTNOTREAL0000', AWS_SECRET_ACCESS_KEY: 'y', OPENAI_BASE_URL: 'https://z',
    });
    expect(filtered.env.PATH).toBe('/bin');
    expect(filtered.env.CODEX_HOME).toBe('/home/x/.codex');
    expect(filtered.env.OPENAI_API_KEY).toBeUndefined();
    expect(filtered.env.OPENAI_BASE_URL).toBeUndefined();
    expect(filtered.strippedKeys).toEqual(expect.arrayContaining(['OPENAI_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'OPENAI_BASE_URL']));
    expect(JSON.stringify(filtered.env)).not.toContain('sk-FAKETESTNOTREAL');
  });

  it('detects an explicit API-key environment source by name', () => {
    expect(apiKeyEnvironmentDetected({ OPENAI_API_KEY: 'x' })).toBe(true);
    expect(apiKeyEnvironmentDetected({ PATH: '/bin' })).toBe(false);
  });

  it('preserves the safe home/runtime variables the login probe needs (HOME, PATH, USER, LOGNAME, LANG, TMPDIR, XDG paths)', () => {
    const filtered = buildCodexEnvironment({
      PATH: '/bin', HOME: '/home/x', USER: 'x', LOGNAME: 'x', LANG: 'C.UTF-8', TMPDIR: '/tmp',
      XDG_CONFIG_HOME: '/home/x/.config', XDG_STATE_HOME: '/home/x/.local/state',
      XDG_DATA_HOME: '/home/x/.local/share', XDG_CACHE_HOME: '/home/x/.cache',
      OPENAI_API_KEY: 'sk-FAKETESTNOTREAL0000',
    });
    for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'TMPDIR',
      'XDG_CONFIG_HOME', 'XDG_STATE_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME']) {
      expect(filtered.env[name], `${name} must pass through`).toBeDefined();
    }
    expect(filtered.env.OPENAI_API_KEY).toBeUndefined();
  });
});

describe('canonical login probe (Gate-B preflight / doctor / Manual Task recheck)', () => {
  const writeFakeLoginStatus = (body: string): string => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-login-'));
    const p = join(dir, 'codex');
    writeFileSync(p, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
    return p;
  };

  it('recognizes exit-0 "Logged in using ChatGPT" printed on STDERR (the real CLI behavior)', () => {
    const fake = writeFakeLoginStatus("process.stderr.write('Logged in using ChatGPT\\n'); process.exit(0);");
    const probe = probeCodexLoginStatus(fake);
    expect(probe.exitCode).toBe(0);
    expect(probe.text).toContain('Logged in using ChatGPT');
    expect(classifyCodexLoginOutput(probe)).toEqual({ status: 'ready', loggedIn: true, methodLabel: 'chatgpt' });
  });

  it('sanitizes account material and ANSI from the probe text before classification', () => {
    const fake = writeFakeLoginStatus(
      "process.stderr.write('\\u001b[32mLogged in\\u001b[0m using ChatGPT (fake-account@example.com)\\n'); process.exit(0);");
    const probe = probeCodexLoginStatus(fake);
    expect(probe.text).not.toContain('fake-account@example.com');
    expect(probe.text).toContain('<redacted-account>');
    expect(probe.text).not.toContain('\u001b');
    expect(classifyCodexLoginOutput(probe).status).toBe('ready');
  });

  it('classifies safe wording variations, explicit sign-out, and unknown output', () => {
    const status = (t: string): string => classifyCodexLoginOutput({ exitCode: 0, text: t }).status;
    expect(status('Logged in using ChatGPT')).toBe('ready');
    expect(status('Logged in with ChatGPT')).toBe('ready');
    expect(status('Signed in using your ChatGPT account')).toBe('ready');
    expect(status('Authenticated (ChatGPT)')).toBe('ready');
    expect(status('Not logged in. Run `codex login`.')).toBe('not_ready');
    expect(status('No stored credentials found')).toBe('not_ready');
    expect(status('some unrecognized diagnostic output')).toBe('unverified');
  });

  it('never classifies a non-zero or missing exit code as ready', () => {
    expect(classifyCodexLoginOutput({ exitCode: 1, text: 'Logged in using ChatGPT' }).status).toBe('unverified');
    expect(classifyCodexLoginOutput({ exitCode: 1, text: 'Not logged in' }).status).toBe('not_ready');
    expect(classifyCodexLoginOutput({ exitCode: null, text: 'Logged in using ChatGPT' }).loggedIn).toBe(false);
  });

  it('classifyCodexAuth (used by doctor, preflight, live launch, and the recheck) approves a stored ChatGPT login via the ONE probe', () => {
    // Guard: an ambient API-key source would legitimately classify api_key.
    const guarded = ['OPENAI_API_KEY', 'AZURE_OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE',
      'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN', 'CODEX_BASE_URL', 'AWS_ACCESS_KEY_ID'];
    const saved = new Map(guarded.map((n) => [n, process.env[n]]));
    guarded.forEach((n) => { delete process.env[n]; });
    try {
      const fake = writeFakeLoginStatus("process.stderr.write('Logged in using ChatGPT\\n'); process.exit(0);");
      expect(classifyCodexAuth('t', fake)).toMatchObject({
        executablePresent: true, loggedIn: true, status: 'ready', approvedForLiveReview: true, methodLabel: 'chatgpt',
      });
      const signedOut = writeFakeLoginStatus("process.stderr.write('Not logged in\\n'); process.exit(1);");
      expect(classifyCodexAuth('t', signedOut)).toMatchObject({
        loggedIn: false, status: 'not_ready', approvedForLiveReview: false,
      });
    } finally {
      for (const [n, v] of saved) { if (v === undefined) delete process.env[n]; else process.env[n] = v; }
    }
  });
});

describe('configuration isolation inspection', () => {
  it('flags hooks/plugins/MCP/custom-provider config as review_required; clean otherwise', () => {
    const clean = mkdtempSync(join(tmpdir(), 'cfg-clean-'));
    writeFileSync(join(clean, 'README.md'), '# ok');
    expect(assessCodexConfiguration(clean, 't').risk).toBe('clean');

    const risky = mkdtempSync(join(tmpdir(), 'cfg-risky-'));
    mkdirSync(join(risky, '.codex'), { recursive: true });
    writeFileSync(join(risky, '.codex', 'config.toml'), 'model = "x"');
    const assessment = assessCodexConfiguration(risky, 't');
    expect(assessment.risk).toBe('review_required');
    expect(assessment.hasCustomProvider).toBe(true);
  });
});

describe('capability probe helpers', () => {
  it('resolves a bad explicit path to null', () => {
    expect(resolveCodexExecutable('/no/such/codex/binary')).toBeNull();
  });
  it('selects exec_structured_review when structured exec is supported', () => {
    expect(selectRuntimeStrategy(SYNTH_CAPS)).toBe('exec_structured_review');
    expect(selectRuntimeStrategy({ ...SYNTH_CAPS, jsonEventsSupported: false, nativeReviewSupported: true })).toBe('native_review');
    expect(selectRuntimeStrategy({ ...SYNTH_CAPS, jsonEventsSupported: false, nativeReviewSupported: false })).toBe('unavailable');
  });
});

describe('reviewer prompt compiler', () => {
  const ctx: ReviewerPromptContext = {
    missionId: 'msn_1', missionRevision: 1, taskId: 'tsk_1', taskRevision: 1, reviewId: 'rvw_1',
    reviewerRole: 'independent_coding_reviewer', independenceRequirement: 'be independent',
    missionObjective: 'block on either control', requirements: ['req a'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'either blocks', blocking: true }], workspaceRevision: 'rev1',
    changedFiles: ['src/dispatch.js'], diffSummary: '1 file', implementerIdentityLabel: 'impl', implementerAttestationRef: 'att',
    verificationEvidence: [{ command: 'node --test', status: 'passed' }], knownLimitations: ['partial tests'],
    protectedPaths: ['package.json'], filesOutOfScope: ['README.md'], securityConstraints: ['read-only review'],
  };
  it('preserves role, objective, criteria, changed files, evidence; marks implementer untrusted; requires the schema; no transcript', () => {
    const prompt = compileReviewerPrompt(ctx);
    expect(prompt).toContain('INDEPENDENT');
    expect(prompt).toContain('Do not trust the Implementer');
    expect(prompt).toContain('READ-ONLY');
    expect(prompt).toContain('block on either control');
    expect(prompt).toContain('AC-1');
    expect(prompt).toContain('src/dispatch.js');
    expect(prompt).toContain('node --test');
    expect(prompt).toContain(REVIEW_REPORT_MARKER);
    expect(prompt).not.toMatch(/transcript|chain of thought/i);
  });
  it('emits a strict JSON schema with the required fields', () => {
    const schema = reviewReportJsonSchema() as { required: string[] };
    expect(schema.required).toEqual(expect.arrayContaining(['reviewId', 'verdict', 'findings', 'reviewedWorkspaceRevision']));
  });
});

describe('read-only permission compiler', () => {
  it('applies read-only sandbox + config isolation + structured output, never a bypass flag', () => {
    const plan = compileReviewerPermissions({
      capabilities: SYNTH_CAPS, workspacePath: '/ws', outputSchemaPath: '/io/schema.json', outputLastMessagePath: '/io/out.json',
    });
    expect(plan.args).toEqual(expect.arrayContaining(['exec', '--sandbox', 'read-only', '--cd', '/ws', '--ignore-user-config', '--ignore-rules', '--strict-config', '--json', '--output-schema', '/io/schema.json', '--output-last-message', '/io/out.json']));
    expect(plan.readOnly).toBe(true);
    expect(plan.networkDisabled).toBe(true);
    for (const flag of FORBIDDEN_FLAGS) expect(plan.args).not.toContain(flag);
  });
  it('resumes an exact session by id when provided', () => {
    const plan = compileReviewerPermissions({
      capabilities: SYNTH_CAPS, workspacePath: '/ws', outputSchemaPath: null, outputLastMessagePath: '/io/out.json',
      resumeSessionId: 'sess-123',
    });
    expect(plan.args.slice(0, 3)).toEqual(['exec', 'resume', 'sess-123']);
  });
});

describe('report parser', () => {
  it('accepts a valid changes_required report (direct JSON and marked)', () => {
    expect(parseReviewReport(validReport(), EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(true);
    expect(parseReviewReport(`noise\n${REVIEW_REPORT_MARKER}\n${validReport()}\ntail`, EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(true);
  });
  it('rejects id / revision mismatches', () => {
    expect(parseReviewReport(validReport({ reviewId: 'rvw_WRONG' }), EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
    expect(parseReviewReport(validReport({ reviewedWorkspaceRevision: 'other' }), EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
    expect(parseReviewReport(validReport({ reviewedMissionRevision: 9 }), EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
  });
  it('enforces verdict/finding coherence and blocking-finding requirements', () => {
    expect(parseReviewReport(validReport({ verdict: 'approved' }), EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false); // approved with blocking finding
    expect(parseReviewReport(validReport({ verdict: 'changes_required', findings: [] }), EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false); // no actionable finding
    const noCriterion = validReport({ findings: [{ ...blockingFinding, affectedCriterionIds: [] }] });
    expect(parseReviewReport(noCriterion, EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
    const noEvidence = validReport({ findings: [{ ...blockingFinding, evidence: [] }] });
    expect(parseReviewReport(noEvidence, EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
  });
  it('rejects secret-shaped and hidden-reasoning content, and malformed JSON, without inventing a verdict', () => {
    expect(parseReviewReport(validReport({ summary: 'leak sk-FAKETESTNOTREAL0000' }), EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
    expect(parseReviewReport(validReport({ summary: 'my chain of thought was' }), EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
    expect(parseReviewReport('{ not json', EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
    expect(parseReviewReport(null, EXPECTED, DEFAULT_REVIEWER_LIMITS).ok).toBe(false);
  });
});

describe('stream parser', () => {
  it('captures session identity, drops reasoning, and validates structure', () => {
    const parser = createReviewerStreamParser();
    parser.push(`${JSON.stringify({ type: 'session.created', session_id: 'sess-9', model: 'm' })}\n`);
    parser.push(`${JSON.stringify({ type: 'reasoning', text: 'SECRET chain of thought' })}\n`);
    parser.push(`${JSON.stringify({ type: 'item.completed', item: { role: 'assistant', text: 'looked at the diff' } })}\n`);
    parser.push(`${JSON.stringify({ type: 'turn.completed' })}\n`);
    const state = parser.end();
    expect(state.sessionId).toBe('sess-9');
    expect(state.reasoningBlocksOmitted).toBe(1);
    expect(JSON.stringify(state)).not.toContain('SECRET chain of thought');
    expect(reviewerStreamIsStructurallyValid(state).ok).toBe(true);
  });
  it('reports missing initialization and missing session id', () => {
    const p1 = createReviewerStreamParser();
    p1.push(`${JSON.stringify({ type: 'item.completed', item: { role: 'assistant', text: 'x' } })}\n`);
    expect(reviewerStreamIsStructurallyValid(p1.end()).ok).toBe(false);
    const p2 = createReviewerStreamParser();
    p2.push(`${JSON.stringify({ type: 'session.created' })}\n${JSON.stringify({ type: 'turn.completed' })}\n`);
    expect(reviewerStreamIsStructurallyValid(p2.end()).ok).toBe(false);
  });
});

describe('reviewer execution attestation', () => {
  const facts = {
    attestationId: 'aud_1', projectId: 'p', missionId: 'm', taskId: 't', runId: 'r',
    requestedReviewerId: 'codex', actualReviewerId: 'codex', adapterId: 'codex-reviewer-local',
    codexSessionId: 'sess-1', workspaceId: 'wsp_1', startedAt: 'a', finishedAt: 'b',
    launchRequested: true, launchVerified: true, reportReceived: true, workspaceInspectionCompleted: true,
    reviewContractSummary: 'contract', activitySummary: 'acts', reportSummary: 'verdict changes_required', evidenceIds: [],
  };
  it('proves execution only when launch verified + report received; carries no fallback', () => {
    const good = buildReviewerAttestation(facts);
    expect(good.ok && attestsSuccessfulExecution(good.value)).toBe(true);
    expect(good.ok && good.value.fallbackOccurred).toBe(false);
    expect(good.ok && good.value.actualAgentType).toBe('codex');
    const notVerified = buildReviewerAttestation({ ...facts, launchVerified: false, reportReceived: false });
    expect(notVerified.ok && attestsSuccessfulExecution(notVerified.value)).toBe(false);
  });
  it('an unauthorized fallback cannot be attested (mission builder)', () => {
    const bad = buildExecutionAttestation({
      attestationId: 'aud_x', projectId: 'p', missionId: 'm', taskId: 't', runId: 'r',
      requestedAgentId: 'codex', requestedAgentType: 'codex', requestedRole: 'independent_coding_reviewer',
      actualAgentId: 'sim', actualAgentType: 'reviewer', actualRole: 'independent_coding_reviewer',
      adapterId: 'x', evidenceIds: [], provenance: 'live', launchRequested: true, launchVerified: true,
      completionSignalReceived: true, workspaceInspectionCompleted: true, verificationCompleted: true,
      fallback: { occurred: true, agentId: 'sim', reason: 'codex down', authorized: false },
    });
    expect(bad.ok).toBe(false);
  });
});

describe('reviewer gate + independence', () => {
  const base = {
    entitlement: 'pro' as const, verificationPassed: true, runStatus: 'completed',
    reviewer: { agentId: 'codex-reviewer-local', sessionId: 's1', adapterId: 'codex-reviewer-local', independenceGroup: 'reviewers' },
    implementer: { agentId: 'impl', sessionId: 's2', adapterId: 'impl', independenceGroup: 'implementers' },
    completionPolicySatisfied: false,
  };
  const ledgerInput = (verdict: 'approved' | 'changes_requested') => ({
    missionId: 'm', taskId: 't', reviewerRunId: 'r', missionRevision: 1, taskRevision: 1, workspaceRevision: 'rev1',
    originalClaimedFiles: ['src/dispatch.js'], affectedCriterionIds: ['AC-1'],
    reviews: [{
      attempt: 1, verdict, reviewerAgentId: 'codex', requestedReviewerAgentId: 'codex', independent: true, provenance: 'live' as const,
      findings: verdict === 'changes_requested' ? [{ id: 'x', severity: 'high', title: 't', detail: 'd', recommendation: 'r' }] : [],
    }],
    postRepairEvidenceIds: [], repairDispatched: false, maxRepairIterations: 1, now: 't',
  });
  it('changes_required with a blocking finding holds output at revision_required and creates a repair', () => {
    const gate = evaluateReviewerGate({ ...base, ledger: ledgerInput('changes_requested') });
    expect(gate.independent).toBe(true);
    expect(gate.blockingFindingsOpen).toBe(1);
    expect(gate.visibility).toBe('revision_required');
    expect(gate.ledger.repairs.length).toBe(1);
  });
  it('approved independent review reaches approved_for_release (before completion policy)', () => {
    const gate = evaluateReviewerGate({ ...base, ledger: ledgerInput('approved') });
    expect(gate.visibility).toBe('approved_for_release');
  });
  it('a shared adapter is not independent', () => {
    const gate = evaluateReviewerGate({
      ...base, reviewer: { ...base.reviewer, adapterId: 'same' }, implementer: { ...base.implementer, adapterId: 'same' },
      ledger: ledgerInput('changes_requested'),
    });
    expect(gate.independent).toBe(false);
  });
});

describe('adapter surface', () => {
  it('is a live reviewer that refuses the sync port path', () => {
    expect(codexReviewerDescriptor.roles).toContain('reviewer');
    expect(codexReviewerDescriptor.provenance).toBe('live');
    const adapter = createCodexReviewerAdapter({ now: () => 't', ids: deterministicIds() });
    const refused = adapter.review({} as never);
    expect(refused.ok).toBe(false);
  });
  it('never marks itself independent (no self-independence in the descriptor)', () => {
    expect(JSON.stringify(codexReviewerDescriptor)).not.toMatch(/independent.*true/i);
  });
});

describe('offline contract verification (fake executable only, no provider call)', () => {
  it('passes every check', async () => {
    const { failures } = await runCodexReviewerContractVerification();
    expect(failures).toBe(0);
  }, 60_000);
});
