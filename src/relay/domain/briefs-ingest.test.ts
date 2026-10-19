import { describe, expect, it } from 'vitest';
import { createMission } from './stages';
import {
  generateImplementerHandoff,
  generateRepairTask,
  generateReviewBrief,
} from './briefs';
import {
  extractLabeledJson,
  parseImplementationReport,
  parseRepairReport,
  parseReview,
  parseTestEvidence,
} from './ingest';
import type { RelayMission, ReviewReport } from './types';

const T0 = '2026-07-21T10:00:00.000Z';
const T1 = '2026-07-21T11:00:00.000Z';

function baseMission(): RelayMission {
  const created = createMission(
    {
      title: 'Anonymous spend banner',
      objective: 'Show the anonymous spend cap in the composer.',
      context: 'Anon access shipped 2026-07-21.',
      constraints: ['npm only', 'no provider keys in frontend'],
      acceptanceCriteria: ['Banner visible for anonymous users', 'vitest suite green'],
    },
    { id: 'm-brief', at: T0 },
  );
  if (!created.ok) throw new Error('fixture mission invalid');
  return created.value;
}

const realImplReply = `
Done. Here is my report.

\`\`\`json relay:implementation-report
{
  "agent": "Claude Code (Fable 5)",
  "summary": "Added SpendCapBanner gated on anonymous sessions.",
  "changedFiles": ["src/components/SpendCapBanner.tsx"],
  "commands": [{ "command": "npx vitest run", "status": "pass", "output": "1440 passed" }],
  "notes": "Copy is placeholder-approved."
}
\`\`\`
`;

const realReviewReply = `
Independent review complete.

\`\`\`json relay:review
{
  "reviewer": "OpenAI Codex",
  "verdict": "changes-requested",
  "findings": [
    {
      "id": "R1",
      "severity": "major",
      "title": "Banner shown to signed-in users",
      "detail": "SpendCapBanner renders unconditionally in Composer.tsx line 42.",
      "recommendation": "Gate on session.kind === 'anonymous'."
    }
  ]
}
\`\`\`
`;

const realRepairReply = `
Repairs done. Report and evidence follow.

\`\`\`json relay:repair-report
{
  "agent": "Claude Code (Fable 5)",
  "summary": "Gated the banner on anonymous session state.",
  "resolvedFindings": [{ "id": "R1", "resolution": "Added session.kind check with test." }],
  "changedFiles": ["src/components/SpendCapBanner.tsx"]
}
\`\`\`

\`\`\`json relay:test-evidence
{
  "entries": [
    { "command": "npm run typecheck", "status": "pass", "output": "tsc -b --noEmit (clean)" },
    { "command": "npx vitest run", "status": "pass", "output": "1441 passed" }
  ],
  "note": "Full suite after repair."
}
\`\`\`
`;

describe('brief generators', () => {
  it('implementer handoff embeds mission and the response contract', () => {
    const brief = generateImplementerHandoff(baseMission(), T0);
    expect(brief.kind).toBe('implementer-handoff');
    for (const needle of [
      'Anonymous spend banner',
      'Show the anonymous spend cap',
      'npm only',
      '1. Banner visible for anonymous users',
      '```json relay:implementation-report',
      'Report honestly',
    ]) {
      expect(brief.markdown).toContain(needle);
    }
  });

  it('review brief requires an implementation report and embeds it', () => {
    const missing = generateReviewBrief(baseMission(), T0);
    expect(missing.ok).toBe(false);

    const m = baseMission();
    const impl = parseImplementationReport(realImplReply, T0);
    expect(impl.ok).toBe(true);
    if (!impl.ok) return;
    const brief = generateReviewBrief({ ...m, implementationReport: impl.value }, T1);
    expect(brief.ok).toBe(true);
    if (!brief.ok) return;
    for (const needle of [
      'INDEPENDENT reviewer',
      'Claude Code (Fable 5)',
      'src/components/SpendCapBanner.tsx',
      '```json relay:review',
    ]) {
      expect(brief.value.markdown).toContain(needle);
    }
  });

  it('repair task requires a review needing repair, and targets its finding ids', () => {
    const m = baseMission();
    expect(generateRepairTask(m, T1).ok).toBe(false);

    const clean: ReviewReport = { receivedAt: T1, reviewer: 'OpenAI Codex', verdict: 'approved', findings: [] };
    expect(generateRepairTask({ ...m, review: clean }, T1).ok).toBe(false);

    const review = parseReview(realReviewReply, T1);
    expect(review.ok).toBe(true);
    if (!review.ok) return;
    const task = generateRepairTask({ ...m, review: review.value }, T1);
    expect(task.ok).toBe(true);
    if (!task.ok) return;
    expect(task.value.findingIds).toEqual(['R1']);
    for (const needle of [
      'R1 — Banner shown to signed-in users (major)',
      "Gate on session.kind === 'anonymous'.",
      '```json relay:repair-report',
      '```json relay:test-evidence',
    ]) {
      expect(task.value.markdown).toContain(needle);
    }
  });
});

describe('extraction', () => {
  it('picks the correctly labeled block among several', () => {
    const repair = parseRepairReport(realRepairReply, T1);
    const evidence = parseTestEvidence(realRepairReply, T1);
    expect(repair.ok).toBe(true);
    expect(evidence.ok).toBe(true);
    if (!repair.ok || !evidence.ok) return;
    expect(repair.value.resolvedFindings).toEqual([
      { id: 'R1', resolution: 'Added session.kind check with test.' },
    ]);
    expect(evidence.value.entries).toHaveLength(2);
    expect(evidence.value.receivedAt).toBe(T1);
  });

  it('falls back to a single unlabeled json block, then to raw JSON', () => {
    const unlabeled = 'Here:\n```json\n{"a": 1}\n```';
    expect(extractLabeledJson(unlabeled, 'review')).toEqual({ ok: true, value: { a: 1 } });
    expect(extractLabeledJson('{"a": 2}', 'review')).toEqual({ ok: true, value: { a: 2 } });
  });

  it('rejects empty paste, ambiguous blocks, and invalid JSON with operator-readable errors', () => {
    expect(extractLabeledJson('   ', 'review').ok).toBe(false);

    const two = '```json\n{"a":1}\n```\n```json\n{"b":2}\n```';
    const ambiguous = extractLabeledJson(two, 'review');
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.errors[0]).toContain('relay:review');

    const bad = extractLabeledJson('```json relay:review\n{nope}\n```', 'review');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toContain('Could not parse');
  });
});

describe('validation', () => {
  it('accepts a real implementation reply and stamps receivedAt', () => {
    const result = parseImplementationReport(realImplReply, T1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.receivedAt).toBe(T1);
    expect(result.value.agent).toBe('Claude Code (Fable 5)');
    expect(result.value.commands?.[0]?.status).toBe('pass');
  });

  it('rejects the unfilled template from the generated handoff (placeholder guard)', () => {
    const handoff = generateImplementerHandoff(baseMission(), T0);
    const result = parseImplementationReport(handoff.markdown, T1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.join('\n')).toContain('placeholder');
  });

  it('reports every field error at once with paths', () => {
    const result = parseReview(
      JSON.stringify({
        reviewer: '',
        verdict: 'maybe',
        findings: [
          { id: 'R1', severity: 'catastrophic', title: 'x', detail: 'y' },
          { id: 'R1', severity: 'minor', title: 'dup', detail: 'z' },
          'not-an-object',
        ],
      }),
      T1,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const all = result.errors.join('\n');
    expect(all).toContain('`reviewer`');
    expect(all).toContain('`verdict`');
    expect(all).toContain('findings[0]');
    expect(all).toContain('duplicated');
    expect(all).toContain('findings[2]');
  });

  it('rejects evidence with no entries or a bogus status', () => {
    expect(parseTestEvidence(JSON.stringify({ entries: [] }), T1).ok).toBe(false);
    const bogus = parseTestEvidence(
      JSON.stringify({ entries: [{ command: 'npm test', status: 'passed-ish', output: 'ok' }] }),
      T1,
    );
    expect(bogus.ok).toBe(false);
    if (!bogus.ok) expect(bogus.errors.join('\n')).toContain('status');
  });

  it('rejects a repair report missing resolutions', () => {
    const result = parseRepairReport(
      JSON.stringify({ agent: 'a', summary: 's', changedFiles: [] }),
      T1,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toContain('resolvedFindings');
  });
});
