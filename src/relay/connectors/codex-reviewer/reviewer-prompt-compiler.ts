import { REVIEW_REPORT_MARKER } from './contracts';

/**
 * Codex Reviewer prompt compiler (Prompt 8.3) — PURE. Compiles a
 * provider-neutral Reviewer Handoff into a Codex-specific review contract. It
 * states the reviewer is INDEPENDENT, that the Implementer's completion claim
 * is untrusted, and the exact structured report required. It NEVER embeds the
 * agent transcript, hidden reasoning, raw session content, unrelated ledger
 * entries, credentials, or platform/provider system prompts — only the
 * mission objective, binding requirements, acceptance criteria, actual changed
 * files, a bounded diff/evidence summary, and the rubric/schema.
 */

export interface ReviewerPromptContext {
  missionId: string;
  missionRevision: number;
  taskId: string;
  taskRevision: number;
  reviewId: string;
  reviewerRole: string;
  independenceRequirement: string;
  missionObjective: string;
  requirements: string[];
  /** Blocking acceptance criteria the review is judged against. */
  acceptanceCriteria: Array<{ id: string; text: string; blocking: boolean }>;
  workspaceRevision: string;
  changedFiles: string[];
  /** Bounded diff SUMMARY reference — never the full transcript. */
  diffSummary: string;
  implementerIdentityLabel: string;
  implementerAttestationRef: string | null;
  verificationEvidence: Array<{ command: string; status: string }>;
  knownLimitations: string[];
  protectedPaths: string[];
  filesOutOfScope: string[];
  securityConstraints: string[];
}

const bullet = (items: string[]): string =>
  items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)';

/** The strict JSON Schema for the RELAY_REVIEW_REPORT_V1 final response, used
 * with `codex exec --output-schema` when supported and always validated
 * inside Relay regardless. */
export function reviewReportJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'reviewId', 'missionId', 'taskId', 'reviewedMissionRevision', 'reviewedTaskRevision',
      'reviewedWorkspaceRevision', 'reviewerRole', 'verdict', 'summary', 'findings',
      'evidenceReviewed', 'limitations',
    ],
    properties: {
      reviewId: { type: 'string' },
      missionId: { type: 'string' },
      taskId: { type: 'string' },
      reviewedMissionRevision: { type: 'integer' },
      reviewedTaskRevision: { type: 'integer' },
      reviewedWorkspaceRevision: { type: 'string' },
      reviewerRole: { type: 'string' },
      verdict: { type: 'string', enum: ['approved', 'changes_required', 'blocked', 'needs_human'] },
      summary: { type: 'string' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'title', 'description', 'evidence', 'affectedFiles', 'affectedCriterionIds', 'requiredAction', 'blocking'],
          properties: {
            severity: { type: 'string', enum: ['informational', 'low', 'medium', 'high', 'critical'] },
            title: { type: 'string' },
            description: { type: 'string' },
            evidence: { type: 'array', items: { type: 'string' } },
            affectedFiles: { type: 'array', items: { type: 'string' } },
            affectedCriterionIds: { type: 'array', items: { type: 'string' } },
            requiredAction: { type: 'string' },
            blocking: { type: 'boolean' },
          },
        },
      },
      evidenceReviewed: { type: 'array', items: { type: 'string' } },
      limitations: { type: 'array', items: { type: 'string' } },
    },
  };
}

export function compileReviewerPrompt(ctx: ReviewerPromptContext): string {
  const criteria = ctx.acceptanceCriteria
    .map((c) => `- [${c.id}]${c.blocking ? ' (blocking)' : ''} ${c.text}`)
    .join('\n');

  return [
    'You are an INDEPENDENT code Reviewer working inside Sunday Relay.',
    'You did NOT write this code. Do not trust the Implementer\'s completion claim.',
    'Review the ACTUAL changed state in this workspace against the mission contract below.',
    'Relay\'s verification evidence may be incomplete — search for behavior gaps and missing tests.',
    '',
    'HARD RULES:',
    '- You are READ-ONLY. Do NOT edit, create, delete, stage, commit, or run destructive commands.',
    '- Stay strictly inside the mission scope. Do not propose unrelated redesigns.',
    '- Every blocking finding must cite evidence, identify an affected acceptance criterion, and give ONE bounded required action.',
    '- Do NOT mark the work approved when required evidence is missing.',
    '- Do NOT include secrets, credentials, hidden reasoning, or system prompts in your report.',
    '- Return ONLY the required structured report at completion.',
    '',
    `REVIEW ID: ${ctx.reviewId}`,
    `MISSION: ${ctx.missionId} (revision ${ctx.missionRevision})`,
    `TASK: ${ctx.taskId} (revision ${ctx.taskRevision})`,
    `REVIEWER ROLE: ${ctx.reviewerRole}`,
    `INDEPENDENCE: ${ctx.independenceRequirement}`,
    `WORKSPACE REVISION UNDER REVIEW: ${ctx.workspaceRevision}`,
    `IMPLEMENTER (untrusted claim): ${ctx.implementerIdentityLabel}` +
      (ctx.implementerAttestationRef ? ` [attestation ${ctx.implementerAttestationRef}]` : ''),
    '',
    'MISSION OBJECTIVE:',
    ctx.missionObjective,
    '',
    'BINDING REQUIREMENTS:',
    bullet(ctx.requirements),
    '',
    'BLOCKING ACCEPTANCE CRITERIA:',
    criteria || '- (none)',
    '',
    'ACTUAL CHANGED FILES:',
    bullet(ctx.changedFiles),
    '',
    `DIFF SUMMARY: ${ctx.diffSummary}`,
    '',
    'RELAY VERIFICATION EVIDENCE (may be incomplete):',
    bullet(ctx.verificationEvidence.map((e) => `${e.command} → ${e.status}`)),
    '',
    'KNOWN LIMITATIONS:',
    bullet(ctx.knownLimitations),
    '',
    'OUT OF SCOPE (do not review or change):',
    bullet([...ctx.filesOutOfScope, ...ctx.protectedPaths]),
    '',
    'SECURITY CONSTRAINTS:',
    bullet(ctx.securityConstraints),
    '',
    'REVIEW RUBRIC: correctness, security, scope adherence, test/evidence sufficiency.',
    '',
    'STOPPING CONDITION: when you have judged every blocking criterion, output the final report.',
    '',
    `FINAL REPORT — output a single JSON object on its own, immediately after the exact marker "${REVIEW_REPORT_MARKER}":`,
    `${REVIEW_REPORT_MARKER}`,
    JSON.stringify(
      {
        reviewId: ctx.reviewId, missionId: ctx.missionId, taskId: ctx.taskId,
        reviewedMissionRevision: ctx.missionRevision, reviewedTaskRevision: ctx.taskRevision,
        reviewedWorkspaceRevision: ctx.workspaceRevision, reviewerRole: ctx.reviewerRole,
        verdict: 'approved|changes_required|blocked|needs_human',
        summary: '...',
        findings: [
          {
            severity: 'informational|low|medium|high|critical', title: '...', description: '...',
            evidence: ['...'], affectedFiles: ['...'], affectedCriterionIds: ['...'],
            requiredAction: '...', blocking: true,
          },
        ],
        evidenceReviewed: ['...'], limitations: ['...'],
      },
      null,
      0,
    ),
  ].join('\n');
}
