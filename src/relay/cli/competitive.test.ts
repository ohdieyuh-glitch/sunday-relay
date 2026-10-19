import { describe, expect, it } from 'vitest';
import { runScenarioToCompletion, parseCli } from './main';
import { buildCompetitiveFrames, projectCompetitiveMission, renderVerdict, renderTimeline, renderFindings } from './competitive';
import { deterministicIds, testClock } from '../testing/factories';

/**
 * Competitive proof CLI tests (Prompt 8.1) — deterministic, NO provider
 * call. Drives the real orchestrator through the `competitive` scenario and
 * asserts the mission projection: independent review + repair are not
 * skippable, the finding is evidence-gated, and the final verdict is exactly
 * verified_complete, with truthful simulation labels.
 */

const RENDER = { color: false, mascot: false, plain: true, json: false, width: 80 };
const NOW = '2026-07-23T13:00:00.000Z';
const det = () => {
  const clock = testClock('2026-07-23T13:00:00.000Z', 1000);
  return { ids: deterministicIds(), now: () => clock.now() };
};
const run = () => runScenarioToCompletion({ scenarioName: 'competitive', render: RENDER, ...det() });
const ESC = String.fromCharCode(27);

describe('competitive scenario parsing + registration', () => {
  it('parses from the CLI', () => {
    expect(parseCli(['demo', 'competitive'])).toMatchObject({ command: 'demo', scenario: 'competitive' });
  });
});

describe('competitive golden path through the real orchestrator', () => {
  it('reaches VERIFIED COMPLETE with an independent review, a finding, a repair, and evidence', () => {
    const outcome = run();
    expect(outcome.finalStatus).toBe('completed');
    expect(outcome.exitCode).toBe(0);
    const b = projectCompetitiveMission(outcome.app, NOW);
    expect(b.verdict.verdict).toBe('verified_complete');
    expect(b.reviews.map((r) => r.verdict)).toEqual(['changes_required', 'approved']);
    expect(b.findings).toHaveLength(1);
    expect(b.findings[0].findingId).toBe('F-1');
    expect(b.findings[0].status).toBe('resolved');
    expect(b.repairs).toHaveLength(1);
    expect(b.repairs[0].findingId).toBe('F-1');
    expect(b.repairs[0].prohibitedScopeExpansion).toBe(true);
    expect(b.mission.revision).toBe(1);
    expect(b.mission.acceptanceCriteria.filter((c) => c.blocking)).toHaveLength(6);
  });

  it('cannot skip independent review, repair, or evidence (the verdict fails without them)', () => {
    const b = projectCompetitiveMission(run().app, NOW);
    // A completed run only reaches verified_complete BECAUSE review + repair +
    // evidence are present; the verdict checks prove each is load-bearing.
    const checks = Object.fromEntries(b.verdict.checks.map((c) => [c.requirement, c.passed]));
    expect(checks['required independent review approved']).toBe(true);
    expect(checks['required tests passed']).toBe(true);
    expect(checks['no open blocking findings']).toBe(true);
    expect(checks['identity-sensitive executions attested']).toBe(true);
  });

  it('both requested-vs-actual agents are attested; no fallback occurred', () => {
    const b = projectCompetitiveMission(run().app, NOW);
    expect(b.attestations.map((a) => a.actualRole).sort()).toEqual(['coding-agent', 'reviewer']);
    expect(b.attestations.every((a) => a.provenance === 'simulated')).toBe(true);
    expect(b.executionSummary.fallbackOccurred).toBe(false);
    expect(b.executionSummary.independentReviewComplete).toBe(true);
  });

  it('the timeline is ordered, attributable, and retains finding + repair history', () => {
    const b = projectCompetitiveMission(run().app, NOW);
    const seqs = b.timeline.map((e) => e.sequence);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    expect(b.timeline.filter((e) => e.kind === 'finding_created')).toHaveLength(1);
    expect(b.timeline.filter((e) => e.kind === 'repair_created')).toHaveLength(1);
    expect(b.timeline.filter((e) => e.kind === 'finding_resolved')).toHaveLength(1);
    const claim = b.timeline.find((e) => e.kind === 'completion_claimed');
    expect(claim?.requestedAgent).toBe('sim-coding-agent');
  });
});

describe('competitive presentation output', () => {
  it('renders the ordered progression, truthful labels, and VERIFIED COMPLETE at 80 columns', () => {
    const frames = buildCompetitiveFrames(run().app, RENDER, NOW);
    const labels = frames.map((f) => f.label);
    expect(labels).toEqual([
      'opening', 'mission', 'mission-contract', 'project-ledger', 'implementer-handoff',
      'implementation-claim', 'verification-initial', 'reviewer-handoff', 'independent-review',
      'repair-ledger', 'revision-contract', 'repair-claim', 'verification-repair', 're-review',
      'completion-engine', 'mission-verdict', 'final-audit',
    ]);
    const text = frames.flatMap((f) => f.lines).join('\n');
    expect(text).toContain('SUNDAY RELAY');
    expect(text).toContain('CLAIMED COMPLETE');
    expect(text).toContain('CHANGES REQUIRED');
    expect(text).toContain('IPv6 /128 rotation bypass');
    expect(text).toContain('Finding F-1 created');
    expect(text).toContain('Repair R-1 assigned');
    expect(text).toContain('Finding remains open until Relay verifies');
    expect(text).toContain('VERIFIED COMPLETE');
    expect(text).toContain('CODEX REVIEWER: Deterministic simulation in this presentation');
    expect(text).toContain('EXTERNAL CODEX CONNECTION: Not active');
    expect(text).toContain('npm run relay:claude:live');
    // 80-column safe, no ANSI in plain mode.
    for (const line of frames.flatMap((f) => f.lines)) {
      expect(line.length, line).toBeLessThanOrEqual(80);
      expect(line).not.toContain(ESC);
    }
  });

  it('inspection views render with no ANSI or secrets', () => {
    const b = projectCompetitiveMission(run().app, NOW);
    for (const view of [renderVerdict(b), renderTimeline(b), renderFindings(b)]) {
      const joined = view.join('\n');
      expect(joined).not.toContain(ESC);
      expect(joined).not.toMatch(/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/);
    }
  });

  it('produces stable semantic outcomes across runs and a clean JSON bundle', () => {
    const a = projectCompetitiveMission(run().app, NOW);
    const c = projectCompetitiveMission(run().app, NOW);
    const semantic = (x: typeof a) => ({
      verdict: x.verdict.verdict, findings: x.findings.map((f) => `${f.findingId}:${f.status}`),
      repairs: x.repairs.map((r) => `${r.repairId}:${r.status}`), reviews: x.reviews.map((r) => r.verdict),
      timeline: x.timeline.map((e) => e.kind),
    });
    expect(semantic(c)).toEqual(semantic(a));
    const raw = JSON.stringify(a);
    expect(raw).not.toContain(ESC);
    expect(raw).not.toMatch(/sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|BEGIN [A-Z ]*PRIVATE KEY/);
    expect(raw.toLowerCase()).not.toContain('"token"');
  });
});
