import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_REVIEWER_TOOLS, NO_HARNESS_CAPABILITIES, REVIEWER_HARNESS_CAPABILITIES,
  REVIEWER_TOOLS, type ReviewerHarnessRecordDraft,
} from './harness-contracts';
import {
  CATALOG_STATUS_LABEL, REVIEWER_HARNESS_CATALOG, findCatalogEntry, harnessIsSelectableForRun,
} from './harness-catalog';
import {
  assessIndependence, blockingFindings, grantReviewerTools, isForbiddenReviewerTool,
  validateProposedResult, validatedVerdictFor,
} from './harness-validation';
import {
  classifyRecoveredHarness, idleHarnessRecord, readHarnessRecord,
  retryHarnessRun, sealHarnessRecord, verifyHarnessChecksum,
} from './harness-record';
import {
  REVIEWER_SIMULATED_LABEL, projectReviewerHarness, renderHarnessCatalogLines,
  renderReviewerStatusLines, reviewerNotification,
} from './harness-projection';
import {
  FAKE_HARNESS_CAPABILITIES, fakeHarnessIdentity, fakeHarnessResult, FAKE_KNOWN_USAGE,
} from './harness-fixtures';

/** The canonical Reviewer harness: provider-neutral, read-only, and unable
    to approve anything. Zero provider calls. */

const NOW = '2026-08-01T12:00:00.000Z';
const idle = (o: Partial<ReviewerHarnessRecordDraft> = {}): ReviewerHarnessRecordDraft => ({
  ...idleHarnessRecord({ missionId: 'm1', projectId: 'p1', missionContractRef: 'contract:1', now: NOW }),
  ...o,
});
const reviewing = (o: Partial<ReviewerHarnessRecordDraft> = {}): ReviewerHarnessRecordDraft => ({
  ...idle(),
  identity: fakeHarnessIdentity(),
  capabilities: FAKE_HARNESS_CAPABILITIES,
  connectionState: 'reviewing',
  startedAt: NOW,
  provenance: 'simulated',
  ...o,
});

describe('the canonical contract is provider-neutral', () => {
  it('mentions no specific harness, model, provider or language', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const sources = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !f.includes('.test.') && f !== 'harness-catalog.ts')
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
    for (const vendor of ['Hermes', 'Grok', 'xAI', 'ACP protocol', 'Python', 'Rust', 'Golang']) {
      expect(sources, `the canonical contract must not assume ${vendor}`).not.toContain(vendor);
    }
    // The catalog is the only place product names belong.
    expect(readFileSync(`${dir}/harness-catalog.ts`, 'utf8')).toContain('Hermes');
  });

  it('reaches no process, network or clock', () => {
    const dir = new URL('.', import.meta.url).pathname;
    const sources = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !f.includes('.test.'))
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
    expect(sources).not.toMatch(/from\s+['"]node:/);
    expect(sources).not.toMatch(/child_process|\bfetch\s*\(|Date\.now\s*\(|new Date\(\)/);
  });
});

describe('harness and model identity stay separate', () => {
  it('keeps four distinct identity fields', () => {
    const record = sealHarnessRecord(reviewing());
    expect(record.identity.requestedHarness).toBe('Fake Harness');
    expect(record.identity.actualHarness).toBe('Fake Harness');
    expect(record.identity.requestedModel).toBe('fixture-model');
    expect(record.identity.actualModel).toBe('fixture-model');
    const view = projectReviewerHarness(record);
    // Two labels, never one combined string.
    expect(view.harnessLabel).toBe('Fake Harness');
    expect(view.modelLabel).toBe('fixture-model');
    expect(view.summary).not.toContain('Fake Harness + fixture-model');
  });

  it('an unknown harness or model renders Unknown independently', () => {
    const record = sealHarnessRecord(reviewing({
      identity: fakeHarnessIdentity({ actualHarness: null, actualModel: null, harnessVersion: null }),
    }));
    const view = projectReviewerHarness(record);
    expect(view.harnessLabel).toBe('Unknown');
    expect(view.modelLabel).toBe('Unknown');
    expect(view.harnessVersionLabel).toBe('Unknown');
    // The REQUESTED values survive regardless.
    expect(view.requestedHarnessLabel).toBe('Fake Harness');
  });
});

describe('the catalog is a product list, not a capability claim', () => {
  it('contains the seven requested entries', () => {
    expect(REVIEWER_HARNESS_CATALOG.map((e) => e.catalogId).sort()).toEqual([
      'agent-zero', 'buzz-acp', 'hermes', 'picoclaw', 'trustclaw', 'vellum', 'zeroclaw',
    ]);
  });

  it('no entry claims an adapter, an installation or any capability', () => {
    for (const entry of REVIEWER_HARNESS_CATALOG) {
      expect(entry.adapterAvailable, entry.catalogId).toBe(false);
      expect(entry.installState, entry.catalogId).toBe('not_installed');
      expect(entry.capabilities, entry.catalogId).toEqual(NO_HARNESS_CAPABILITIES);
      // And therefore nothing can be started.
      expect(harnessIsSelectableForRun(entry), entry.catalogId).toBe(false);
    }
  });

  it('carries the truthful statuses the founder specified', () => {
    const status = (id: string) => findCatalogEntry(id)?.integrationStatus;
    expect(status('hermes')).toBe('coming_soon');
    expect(status('buzz-acp')).toBe('coming_soon');
    expect(status('vellum')).toBe('coming_soon');
    expect(status('trustclaw')).toBe('experimental');
    expect(status('picoclaw')).toBe('experimental');
    expect(status('zeroclaw')).toBe('coming_soon');
    expect(status('agent-zero')).toBe('coming_soon');
    expect(findCatalogEntry('trustclaw')?.experimental).toBe(true);
    expect(findCatalogEntry('hermes')?.experimental).toBe(false);
  });

  it('advertises no performance, language or installation claims', () => {
    for (const entry of REVIEWER_HARNESS_CATALOG) {
      const text = `${entry.description} ${entry.verificationNotes.join(' ')}`.toLowerCase();
      for (const claim of ['fastest', 'fast', 'rust', 'golang', 'benchmark', 'x faster', 'production ready']) {
        expect(text, `${entry.catalogId} must not claim "${claim}"`).not.toContain(claim);
      }
    }
  });

  it('renders no entry as Connected', () => {
    const lines = renderHarnessCatalogLines().join('\n');
    expect(lines).not.toContain('Connected');
    expect(lines).toContain('Coming soon');
    expect(lines).toContain('Experimental');
    expect(lines).toContain('none verified');
    expect(lines).toContain('startable:   no');
  });

  it('selecting an unavailable harness cannot start anything', () => {
    const view = projectReviewerHarness(null, {
      bridgeAvailable: true,
      selectedCatalogEntry: findCatalogEntry('hermes'),
    });
    expect(view.canStart).toBe(false);
    expect(view.connectionLabel).toBe('Coming soon');
    expect(view.outcomeLabel).toContain('no adapter exists yet');
    expect(CATALOG_STATUS_LABEL.coming_soon).toBe('Coming soon');
  });
});

describe('the Reviewer is read-only', () => {
  it('grants only allowlisted tools and refuses every write tool', () => {
    const result = grantReviewerTools([
      'read_diff', 'inspect_tests', 'propose_verdict',
      'edit_files', 'deploy', 'merge', 'authorize_release', 'modify_mission_contract',
    ]);
    expect(result.granted).toEqual(['read_diff', 'inspect_tests', 'propose_verdict']);
    expect(result.refused).toEqual(['edit_files', 'deploy', 'merge', 'authorize_release', 'modify_mission_contract']);
  });

  it('treats every forbidden tool as forbidden, and anything unlisted too', () => {
    for (const tool of FORBIDDEN_REVIEWER_TOOLS) {
      expect(isForbiddenReviewerTool(tool), tool).toBe(true);
    }
    expect(isForbiddenReviewerTool('some_new_tool')).toBe(true);
    for (const tool of REVIEWER_TOOLS) expect(isForbiddenReviewerTool(tool), tool).toBe(false);
  });
});

describe('findings and verdicts', () => {
  it('accepts a clean review with NO findings', () => {
    const validated = validateProposedResult(fakeHarnessResult('clean'));
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error('clean review must validate');
    expect(validated.result.findings).toEqual([]);
    expect(validatedVerdictFor(validated.result)).toBe('approved');
  });

  it('rejects a malformed finding and a malformed verdict', () => {
    const badFinding = validateProposedResult(fakeHarnessResult('malformed_finding'));
    expect(badFinding.ok).toBe(false);
    if (badFinding.ok) throw new Error('must reject');
    expect(badFinding.reason).toContain('malformed finding');

    const badVerdict = validateProposedResult(fakeHarnessResult('malformed_verdict'));
    expect(badVerdict.ok).toBe(false);
    if (badVerdict.ok) throw new Error('must reject');
    expect(badVerdict.reason).toContain('not a proposable verdict');
  });

  it('refuses a passed verdict that carries blocking findings', () => {
    const contradictory = { verdict: 'passed', summary: 'fine', inspectedEvidenceRefs: [],
      findings: [{ proposedId: 'F', severity: 'critical', title: 't', description: 'd',
        affectedFiles: [], evidenceRefs: [], impact: 'i', recommendedRepair: 'r', blocking: true }] };
    const validated = validateProposedResult(contradictory);
    expect(validated.ok).toBe(false);
  });

  it('blocking findings force changes_requested; inconclusive determines nothing', () => {
    const blocked = validateProposedResult(fakeHarnessResult('blocked'));
    if (!blocked.ok) throw new Error('must validate');
    expect(blockingFindings(blocked.result)).toHaveLength(1);
    expect(validatedVerdictFor(blocked.result)).toBe('changes_requested');

    const inconclusive = validateProposedResult(fakeHarnessResult('inconclusive'));
    if (!inconclusive.ok) throw new Error('must validate');
    // Relay learned nothing it can act on.
    expect(validatedVerdictFor(inconclusive.result)).toBeNull();
  });

  it('a completed run is not an approval, and approval is not release', () => {
    const completedUnvalidated = sealHarnessRecord(reviewing({
      connectionState: 'completed', proposedVerdict: 'passed', validatedVerdict: null,
    }));
    const view = projectReviewerHarness(completedUnvalidated);
    expect(view.validatedVerdictLabel).toBe('Not determined');
    expect(view.outcomeLabel).toContain('has not validated it');

    const approved = sealHarnessRecord(reviewing({
      connectionState: 'completed', proposedVerdict: 'passed', validatedVerdict: 'approved',
    }));
    // Approval explicitly disclaims release authority.
    expect(projectReviewerHarness(approved).outcomeLabel).toContain('not release authorization');
  });
});

describe('independence', () => {
  const evidence = (o: Partial<Record<string, string | null>> = {}) => ({
    agentId: 'agent-a', adapterId: 'adapter-a', sessionId: 'session-a',
    independenceGroup: 'group-a', model: 'model-a', provider: 'provider-a', humanId: 'human-a',
    ...o,
  });

  it('unknown identity means UNKNOWN, never independent', () => {
    const assessment = assessIndependence({
      author: evidence(),
      reviewer: { agentId: null, adapterId: null, sessionId: null, independenceGroup: null,
        model: null, provider: null, humanId: null },
    });
    expect(assessment.verdict).toBe('unknown');
    expect(assessment.verdict).not.toBe('independent');
    expect(assessment.reasons.join(' ')).toContain('unknown');
  });

  it('a shared session is not independent even when the harness name differs', () => {
    // Hermes driving the same authenticated Claude session as the author.
    const assessment = assessIndependence({
      author: evidence({ agentId: 'claude-code', adapterId: 'claude-code-local' }),
      reviewer: evidence({ agentId: 'hermes', adapterId: 'hermes-local', independenceGroup: 'group-b' }),
    });
    expect(assessment.verdict).toBe('not_independent');
    expect(assessment.reasons.join(' ')).toContain('share one authenticated session');
  });

  it('the same actual agent is never independent', () => {
    const assessment = assessIndependence({ author: evidence(), reviewer: evidence() });
    expect(assessment.verdict).toBe('not_independent');
  });

  it('records a genuinely independent identity, and reports provider diversity as a fact', () => {
    const assessment = assessIndependence({
      author: evidence(),
      reviewer: evidence({ agentId: 'agent-b', adapterId: 'adapter-b', sessionId: 'session-b',
        independenceGroup: 'group-b', provider: 'provider-b', humanId: 'human-b' }),
    });
    expect(assessment.verdict).toBe('independent');
    expect(assessment.providerDiversity).toBe('different');

    // Different providers alone does NOT make it independent.
    const sameSession = assessIndependence({
      author: evidence(),
      reviewer: evidence({ agentId: 'agent-b', adapterId: 'adapter-b', provider: 'provider-b' }),
    });
    expect(sameSession.providerDiversity).toBe('different');
    expect(sameSession.verdict).toBe('not_independent');
  });
});

describe('persistence, recovery and retry', () => {
  it('rejects tampering and a future schema', () => {
    const sealed = sealHarnessRecord(reviewing());
    expect(verifyHarnessChecksum(sealed)).toBe(true);
    expect(verifyHarnessChecksum({ ...sealed, validatedVerdict: 'approved' })).toBe(false);
    const future = { ...sealed, schemaVersion: 'relay-reviewer-harness.v99' };
    const read = readHarnessRecord(future);
    if (read.ok || read.reason !== 'unsupported_version') throw new Error('must be unsupported');
  });

  it('an uncertain active review becomes disconnected and is never repeated', () => {
    const active = sealHarnessRecord(reviewing({ findingRefs: ['F1'] }));
    const after = classifyRecoveredHarness({ record: active, runConfirmed: false, now: NOW });
    expect(after.connectionState).toBe('disconnected');
    expect(after.connectionState).not.toBe('completed');
    expect(after.disconnectionReason).toContain('was not repeated');
    // Findings already recorded survive.
    expect(after.findingRefs).toEqual(['F1']);
  });

  it('a completed review keeps its findings and verdict across a restart', () => {
    const done = sealHarnessRecord(reviewing({
      connectionState: 'completed', validatedVerdict: 'changes_requested', findingRefs: ['F1', 'F2'],
    }));
    const after = classifyRecoveredHarness({ record: done, runConfirmed: false, now: NOW });
    expect(after.connectionState).toBe('completed');
    expect(after.validatedVerdict).toBe('changes_requested');
    expect(after.findingRefs).toEqual(['F1', 'F2']);
  });

  it('a retry always mints a NEW run and clears the old verdict', () => {
    const disconnected = sealHarnessRecord(reviewing({
      connectionState: 'disconnected', proposedVerdict: 'blocked', findingRefs: ['F1'],
    }));
    const retried = retryHarnessRun({ record: disconnected, newRunId: 'fake-run-2', now: NOW });
    expect(retried.identity.runId).toBe('fake-run-2');
    expect(retried.identity.runId).not.toBe(disconnected.identity.runId);
    expect(retried.identity.launchVerified).toBe(false);
    expect(retried.proposedVerdict).toBeNull();
    expect(retried.validatedVerdict).toBeNull();
    // Evidence already gathered is preserved.
    expect(retried.findingRefs).toEqual(['F1']);
  });

  it('unknown usage stays unknown', () => {
    expect(projectReviewerHarness(sealHarnessRecord(reviewing())).usageLabel).toBe('Unknown');
    const known = sealHarnessRecord(reviewing({ usage: FAKE_KNOWN_USAGE }));
    expect(projectReviewerHarness(known).usageLabel).toBe('1540 tokens');
    // Cost stays Unknown because the fake reports none.
    expect(projectReviewerHarness(known).costLabel).toBe('Unknown');
  });
});

describe('notifications and surfaces', () => {
  it('started requires a verified launch; completed requires a validated verdict', () => {
    const unverified = sealHarnessRecord(reviewing({
      identity: fakeHarnessIdentity({ launchVerified: false }),
    }));
    expect(reviewerNotification(unverified)).toBeNull();
    expect(reviewerNotification(sealHarnessRecord(reviewing()))?.title).toBe('Reviewer started');

    const unvalidated = sealHarnessRecord(reviewing({ connectionState: 'completed', validatedVerdict: null }));
    expect(reviewerNotification(unvalidated)).toBeNull();
  });

  it('blockers, cancellation and disconnection each have their own truthful notification', () => {
    const blockers = sealHarnessRecord(reviewing({
      connectionState: 'completed', validatedVerdict: 'changes_requested', findingRefs: ['F1'],
    }));
    expect(reviewerNotification(blockers)?.title).toBe('Reviewer found blockers');

    const pendingStop = sealHarnessRecord(reviewing({ connectionState: 'stopped', cancellationConfirmed: false }));
    expect(reviewerNotification(pendingStop)).toBeNull();
    const stopped = sealHarnessRecord(reviewing({ connectionState: 'stopped', cancellationConfirmed: true }));
    expect(reviewerNotification(stopped)?.title).toBe('Reviewer stopped');

    const gone = sealHarnessRecord(reviewing({ connectionState: 'disconnected' }));
    const note = reviewerNotification(gone);
    expect(note?.title).toBe('Reviewer disconnected');
    expect(note?.kind).toBe('critical');
  });

  it('offline says a harness and bridge are required, and discloses simulation', () => {
    const view = projectReviewerHarness(null, { bridgeAvailable: false });
    expect(view.canStart).toBe(false);
    expect(view.connectionLabel).toBe('Relay Bridge required');
    const simulated = projectReviewerHarness(sealHarnessRecord(reviewing()), { simulated: true });
    expect(simulated.disclosure).toBe(REVIEWER_SIMULATED_LABEL);
  });

  it('the CLI lines come from the same view', () => {
    const view = projectReviewerHarness(sealHarnessRecord(reviewing()));
    const out = renderReviewerStatusLines('m1', view).join('\n');
    expect(out).toContain(view.harnessLabel);
    expect(out).toContain(view.modelLabel);
    expect(out).toContain(view.independenceLabel);
    expect(out).toContain(view.validatedVerdictLabel);
  });

  it('the fake advertises only what it proves', () => {
    expect(FAKE_HARNESS_CAPABILITIES.supportsStreaming).toBe(false);
    expect(FAKE_HARNESS_CAPABILITIES.supportsSubagents).toBe(false);
    expect(FAKE_HARNESS_CAPABILITIES.supportsStructuredFindings).toBe(true);
    expect(FAKE_HARNESS_CAPABILITIES.supportsReadOnlyExecution).toBe(true);
    expect(REVIEWER_HARNESS_CAPABILITIES).toHaveLength(15);
  });
});
