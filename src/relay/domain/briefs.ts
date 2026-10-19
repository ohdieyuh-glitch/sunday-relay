import type {
  GeneratedBrief,
  IsoTimestamp,
  RelayMission,
  RelayResult,
  ReviewFinding,
} from './types';
import { reviewRequiresRepair } from './stages';

/**
 * Brief generators — the only artifacts Relay authors itself. Each brief is a
 * self-contained markdown document the operator hands to a real agent session
 * (Claude Code implementer, Codex reviewer). Every brief ends with response
 * format instructions: a fenced `json relay:<kind>` block that ingest.ts can
 * extract from the agent's reply verbatim.
 */

const fence = '```';

function missionHeader(mission: RelayMission): string {
  const lines = [
    `**Mission:** ${mission.title}`,
    `**Mission id:** ${mission.id}`,
    '',
    '## Objective',
    '',
    mission.objective,
  ];
  if (mission.context) {
    lines.push('', '## Context', '', mission.context);
  }
  if (mission.constraints.length > 0) {
    lines.push('', '## Constraints', '', ...mission.constraints.map((c) => `- ${c}`));
  }
  lines.push(
    '',
    '## Acceptance criteria',
    '',
    ...mission.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
  );
  return lines.join('\n');
}

const INTEGRITY_RULES = [
  '- Report honestly. Never claim a command ran, a test passed, or a file changed unless it really did.',
  '- `status` fields must reflect real exit results (`pass` only for exit code 0).',
  '- If you are blocked, say so in the report instead of guessing.',
].join('\n');

function responseFormat(kind: string, example: string): string {
  return [
    '## Required response format',
    '',
    `End your final message with exactly one fenced block labeled \`relay:${kind}\`:`,
    '',
    `${fence}json relay:${kind}`,
    example,
    fence,
    '',
    '## Integrity rules',
    '',
    INTEGRITY_RULES,
  ].join('\n');
}

export function generateImplementerHandoff(
  mission: RelayMission,
  at: IsoTimestamp,
): GeneratedBrief {
  const markdown = [
    '# Sunday Relay — Implementer Handoff',
    '',
    missionHeader(mission),
    '',
    '## Your task',
    '',
    'Implement this mission in the target repository. Verify your work with the',
    "repository's own verification commands before reporting.",
    '',
    responseFormat(
      'implementation-report',
      JSON.stringify(
        {
          missionId: mission.id,
          agent: '<what actually ran, e.g. "Claude Code (Fable 5)">',
          summary: '<what you implemented and how>',
          changedFiles: ['<repo-relative/path.ts>'],
          commands: [
            { command: 'npx vitest run', status: 'pass', output: '<real output tail>' },
          ],
          notes: '<optional caveats, follow-ups, honest gaps>',
        },
        null,
        2,
      ),
    ),
  ].join('\n');
  return { kind: 'implementer-handoff', generatedAt: at, markdown };
}

export function generateReviewBrief(mission: RelayMission, at: IsoTimestamp): RelayResult<GeneratedBrief> {
  const report = mission.implementationReport;
  if (!report) {
    return { ok: false, errors: ['Review brief needs an implementation report to review.'] };
  }
  const markdown = [
    '# Sunday Relay — Independent Review Brief',
    '',
    'You are the INDEPENDENT reviewer. You did not write this implementation.',
    'Review it adversarially against the mission and acceptance criteria below.',
    '',
    missionHeader(mission),
    '',
    '## Implementation under review',
    '',
    `**Implementer:** ${report.agent}`,
    '',
    report.summary,
    '',
    '**Changed files:**',
    '',
    ...(report.changedFiles.length > 0
      ? report.changedFiles.map((f) => `- \`${f}\``)
      : ['- (none reported)']),
    '',
    '## Your task',
    '',
    'Inspect the actual diff/files in the repository — do not review the summary',
    'alone. Report every defect that would block the acceptance criteria as a',
    'finding with a stable id (R1, R2, …). An empty findings list with verdict',
    '`approved` means you are staking your review on this implementation.',
    '',
    responseFormat(
      'review',
      JSON.stringify(
        {
          missionId: mission.id,
          reviewer: '<what actually reviewed, e.g. "OpenAI Codex">',
          verdict: 'approved | changes-requested',
          findings: [
            {
              id: 'R1',
              severity: 'critical | major | minor',
              title: '<short defect title>',
              detail: '<what is wrong, with file/line specifics>',
              recommendation: '<how to fix it>',
            },
          ],
        },
        null,
        2,
      ),
    ),
  ].join('\n');
  return { ok: true, value: { kind: 'review-brief', generatedAt: at, markdown } };
}

export function generateRepairTask(mission: RelayMission, at: IsoTimestamp): RelayResult<GeneratedBrief> {
  const review = mission.review;
  if (!review) return { ok: false, errors: ['Repair task needs a completed review.'] };
  if (!reviewRequiresRepair(review)) {
    return { ok: false, errors: ['Review was a clean approval — nothing to repair.'] };
  }
  const findings: ReviewFinding[] = review.findings;
  const findingIds = findings.map((f) => f.id);
  const markdown = [
    '# Sunday Relay — Repair Task',
    '',
    missionHeader(mission),
    '',
    `## Review findings to repair (reviewer: ${review.reviewer}, verdict: ${review.verdict})`,
    '',
    ...(findings.length > 0
      ? findings.flatMap((f) => [
          `### ${f.id} — ${f.title} (${f.severity})`,
          '',
          f.detail,
          ...(f.recommendation ? ['', `**Recommendation:** ${f.recommendation}`] : []),
          '',
        ])
      : ['The reviewer requested changes; see the review verdict context.', '']),
    '## Your task',
    '',
    'Fix every finding above in the target repository. After repairs, run the',
    "repository's full verification commands and capture their real output —",
    'you will provide it as separate test evidence.',
    '',
    responseFormat(
      'repair-report',
      JSON.stringify(
        {
          missionId: mission.id,
          agent: '<what actually ran>',
          summary: '<what you repaired and how>',
          resolvedFindings: findingIds.map((id) => ({
            id,
            resolution: `<how ${id} was fixed>`,
          })),
          changedFiles: ['<repo-relative/path.ts>'],
        },
        null,
        2,
      ),
    ),
    '',
    'Then, in the same message or a follow-up, provide the verification runs:',
    '',
    `${fence}json relay:test-evidence`,
    JSON.stringify(
      {
        missionId: mission.id,
        entries: [
          { command: 'npm run typecheck', status: 'pass', output: '<real output tail>' },
          { command: 'npx vitest run', status: 'pass', output: '<real output tail>' },
        ],
        note: '<optional context>',
      },
      null,
      2,
    ),
    fence,
  ].join('\n');
  return { ok: true, value: { kind: 'repair-task', generatedAt: at, markdown, findingIds } };
}
