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
    'REQUIRED FINAL REPORT',
    `End your final message with the marker ${REPORT_MARKER} on its own line, immediately followed by a single JSON object with EXACTLY these fields:`,
    '{',
    `  "taskId": "${ctx.taskId}",`,
    `  "runId": "${ctx.runId}",`,
    '  "attempt": 1,',
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
  ].join('\n');
}

export interface RevisionPromptContext {
  revision: RevisionContract;
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
    'Relay is resuming this exact session for ONE focused repair.',
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
    'REQUIRED FINAL REPORT',
    `End with the marker ${REPORT_MARKER} followed by the same JSON object shape, with "attempt": 2.`,
  ].join('\n');
}
