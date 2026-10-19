import type { AgentHandoffPackage, RevisionContract } from '../../protocol/contracts';
import type { ClaudeLiveLimits } from './contracts';

/**
 * Claude-specific responsibility prompt compiler (Prompt 8) — PURE. Turns
 * the provider-neutral AgentHandoffPackage into a bounded Claude prompt.
 * It forwards references and the responsibility contract ONLY — never the
 * whole ledger, transcripts, unrelated files, hidden reasoning, secrets, or
 * other provider sessions. The compiled prompt states the hard boundaries
 * plainly and requires the structured report marker at the end.
 */

export const REPORT_MARKER = 'RELAY_AGENT_EXECUTION_REPORT_V1';

export interface PromptContext {
  pkg: AgentHandoffPackage;
  runId: string;
  taskId: string;
  workspaceRelativeRoot: string; // always '.' — Claude works in cwd
  readOnlyFiles: string[];
  protectedFiles: string[];
  relayVerificationCommands: string[];
  limits: ClaudeLiveLimits;
}

const bullet = (items: string[]): string => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- (none)');

const BOUNDARY_RULES = [
  'Work only inside the current directory. Do not access parent directories.',
  'Do not modify unclaimed files.',
  'Do not modify protected files.',
  'Do not read secrets or inspect credential stores.',
  'Do not deploy, push, commit, or change Git configuration.',
  'Do not install dependencies.',
  'Do not use network tools.',
  'Do not claim tests passed unless you actually ran them.',
  'Relay will independently inspect and verify the workspace after you exit.',
  'A completion statement is a claim, not proof.',
  'Stop as soon as the assigned responsibility is complete.',
];

export function compileClaudePrompt(ctx: PromptContext): string {
  const { pkg, limits } = ctx;
  const turnsLine = limits.maxTurns !== null
    ? `Maximum turns: ${limits.maxTurns}.`
    : `Work efficiently within a ${Math.round(limits.maxRuntimeMs / 60_000)}-minute time limit; there is no turn allowance to waste.`;

  return [
    'You are a coding agent operating under Sunday Relay supervision.',
    '',
    `Relay run: ${ctx.runId}`,
    `Relay task: ${ctx.taskId}`,
    `Base revision: ${pkg.baseRevision}`,
    `Context version: ${pkg.contextVersion} · Ledger version: ${pkg.ledgerVersion}`,
    '',
    'RESPONSIBILITY',
    pkg.responsibilityBoundary,
    '',
    'OBJECTIVE',
    pkg.objective,
    '',
    'WORKSPACE BOUNDARY',
    'Your entire workspace is the current directory (an isolated Git worktree).',
    'The source repository is elsewhere and must never be touched.',
    '',
    'FILES YOU MAY CHANGE (claimed for write)',
    bullet(pkg.permittedFiles.map((f) => f.value)),
    '',
    'READ-ONLY FILES',
    bullet(ctx.readOnlyFiles),
    '',
    'PROTECTED FILES (never modify)',
    bullet(ctx.protectedFiles),
    '',
    'ALLOWED TOOLS',
    bullet(pkg.permittedTools.map((t) => t.value)),
    '',
    'PROHIBITED ACTIONS',
    bullet(pkg.prohibitedActions.map((a) => a.value)),
    '',
    'ACCEPTANCE CRITERIA',
    bullet(pkg.acceptanceCriteria),
    '',
    'REQUIRED EVIDENCE (Relay — not you — will run these afterward)',
    bullet(ctx.relayVerificationCommands.length ? ctx.relayVerificationCommands : pkg.requiredEvidence),
    '',
    'LIMITS AND STOPPING CONDITION',
    turnsLine,
    pkg.stoppingCondition.description,
    '',
    'HARD RULES',
    bullet(BOUNDARY_RULES),
    '',
    ...reportContract({ taskId: ctx.taskId, runId: ctx.runId, attempt: 1 }),
  ].join('\n');
}

/**
 * THE REPORT CONTRACT, STATED IN FULL, TO EVERY PROMPT THAT NEEDS ONE.
 *
 * A repair used to be told to end with the marker "followed by the same JSON
 * object shape, with attempt: 2" — a back-reference to the first attempt's
 * prompt. That reads correctly and is unusable: the hosted repair runs in a
 * FRESH session and a FRESH workspace (Relay has to seed the reviewed bytes
 * back in, which is the proof it is not the same process), so the agent being
 * asked for "the same shape" had never been shown a shape at all.
 *
 * Observed in production on `pack-11-four-constraints-1786424002`: a genuine
 * rejection, a repair that really ran — nine turns, four tools, 1285 characters
 * of final text — and then `Report failed validation`, because the one thing
 * the agent could not guess was the schema nobody sent it. The work was done
 * and thrown away.
 *
 * So the contract is written out once and emitted by both prompts. A schema
 * that exists in two places is a schema that will disagree with itself; a
 * schema referred to indirectly is one the reader may not have.
 */
function reportContract(ctx: { taskId: string; runId: string; attempt: 1 | 2 }): string[] {
  return [
    'REQUIRED FINAL REPORT',
    `End your final message with the marker ${REPORT_MARKER} on its own line, immediately followed by a single JSON object with EXACTLY these fields:`,
    '{',
    `  "taskId": "${ctx.taskId}",`,
    `  "runId": "${ctx.runId}",`,
    `  "attempt": ${String(ctx.attempt)},`,
    '  "status": "completed" | "blocked" | "failed",',
    '  "summary": "one or two plain sentences",',
    '  "filesRead": ["repo-relative paths"],',
    '  "filesChanged": ["repo-relative paths you actually edited"],',
    '  "commandsClaimed": [],',
    '  "testsClaimed": [],',
    '  "remainingIssues": [],',
    '  "manualActionRequest": null',
    '}',
    'Do not put secrets, hidden reasoning, or file contents in the report.',
  ];
}

export interface RevisionPromptContext {
  /**
   * OPTIONAL BECAUSE THIS FUNCTION DOES NOT READ IT.
   *
   * It was required, and `compileRevisionPrompt` never touched it — so the
   * first real caller had to fabricate a `RevisionContract` to satisfy a field
   * the prompt ignores. Demanding data nobody reads is how a cast gets written,
   * and a cast is how a missing field ships.
   *
   * It stays in the type because a repair prompt that one day carries the
   * contract's narrow-scope terms should take them from here rather than
   * inventing a second channel.
   */
  revision?: RevisionContract;
  runId: string;
  taskId: string;
  findingSummaries: string[];
  relayVerificationCommands: string[];
}

/** A NARROW repair prompt for an explicit-session resume — never the whole
 * original prompt. Only the finding(s), unchanged constraints, and the same
 * report requirement. */
export function compileRevisionPrompt(ctx: RevisionPromptContext): string {
  return [
    /**
     * NOT "resuming this exact session". The hosted repair is a new process in
     * a new workspace seeded with the reviewed bytes, so a prompt that told the
     * agent otherwise was inviting it to rely on context it does not have —
     * which is exactly how the report contract came to be a back-reference.
     */
    'Relay is continuing this task for ONE focused repair.',
    'The findings below are from an independent review of your previous result,',
    'which has been restored into this workspace for you.',
    'Do not restart or broaden the task. Keep every prior constraint.',
    '',
    `Relay run: ${ctx.runId}`,
    `Relay task: ${ctx.taskId} (attempt 2 of at most 2)`,
    '',
    'ADDRESS ONLY THESE FINDINGS',
    bullet(ctx.findingSummaries),
    '',
    'UNCHANGED CONSTRAINTS',
    '- Same claimed files only; do not modify unclaimed or protected files.',
    '- No new tools, no Bash, no network, no deploy, no push, no commit.',
    '- Relay will re-inspect and re-verify after you exit.',
    '',
    'REQUIRED EVIDENCE (Relay will run these)',
    bullet(ctx.relayVerificationCommands),
    '',
    ...reportContract({ taskId: ctx.taskId, runId: ctx.runId, attempt: 2 }),
  ].join('\n');
}
