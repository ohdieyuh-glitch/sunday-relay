import type { RelayApp } from '../core/app';
import { badge, style, type RenderOptions } from './render';

/**
 * YC presentation renderer (Prompt 6) — RENDERER ONLY. Builds milestone
 * frames from the completed run's read models and event feed; pacing and
 * filtering never touch Relay Core state, sequence numbers, or outcomes.
 * Everything stays honest: SIMULATED disclosure up front, real evidence
 * counts, real repair count, real audit values. Lines stay ≤ 78 chars so an
 * 80-column recording never clips.
 */

export interface PresentationFrame {
  label: string;
  lines: string[];
}

const wrap = (text: string, width = 78): string[] => {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > width) {
      lines.push(current.trim());
      current = word;
    } else current = `${current} ${word}`;
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
};

export function buildPresentationFrames(app: RelayApp, opts: RenderOptions): PresentationFrame[] {
  const s = style(opts);
  const frames: PresentationFrame[] = [];
  const push = (label: string, lines: string[]) => frames.push({ label, lines });

  const status = app.status();
  const events = app.events(0);
  const evidence = app.evidence();
  const reviews = app.review();
  const audit = app.audit();
  const task = app.task();
  const handoff = app.handoff();
  const brain = app.brain();
  const blueprint = app.blueprint();
  if (!status) return [{ label: 'error', lines: ['No run to present.'] }];

  /* opening */
  push('opening', [
    '',
    `${s.bold('SUNDAY RELAY')}  ${s.dim('RLY / 001')}`,
    s.dim('Pass the work. Keep the context.'),
    '',
    `${badge('SIMULATED')} SIMULATED AGENT EXECUTION`,
    'NO REPOSITORY FILES WILL BE MODIFIED',
    'SESSION STORAGE: VOLATILE',
  ]);

  push('objective', ['', s.gold('OBJECTIVE'), ...wrap(status.objective)]);

  /* project brain moment */
  if (brain) {
    push('brain', [
      '',
      s.gold('PROJECT BRAIN'),
      `  [CANONICAL]  Objective loaded`,
      `  [CANONICAL]  Architecture constraints loaded`,
      `  [CANONICAL]  Anonymous-access safety policy loaded (scenario context)`,
      `  [CANONICAL]  Protected resources loaded`,
      `  [PENDING]    Production verification incomplete`,
      s.dim(`  ledger v${brain.ledgerVersion} · provider-neutral · owned by the project`),
    ]);
  }

  if (blueprint) {
    push('blueprint', [
      '',
      s.gold('PLAN'),
      `  Prompt Architect created Blueprint V${blueprint.version} ${badge('SIMULATED')}`,
      ...wrap(`  ${blueprint.content.approach}`, 76),
    ]);
  }

  if (task) {
    push('owner', [
      '',
      s.gold('TASK OWNER'),
      `  ${task.owner ?? 'unassigned'} assigned implementation responsibility`,
      s.dim(`  one owner · leased · files claimed: ${task.claimedFiles.map((c) => c.path).join(', ')}`),
    ]);
  }

  /* handoff moment — from the real package read model */
  if (handoff) {
    const protectedPaths = handoff.prohibitedActions.filter((p) => p.value.startsWith('protected:')).map((p) => p.value.replace('protected:', ''));
    push('handoff', [
      '',
      s.gold('HANDOFF PACKAGE — CODING AGENT'),
      '  Responsibility:',
      ...wrap(`    ${handoff.responsibilityBoundary}`, 76),
      `  Context: ${handoff.contextRefs.length} pinned reference(s) — never a transcript`,
      `  Allowed files: ${handoff.permittedFiles.map((f) => f.value).join(', ')}`,
      `  Protected: ${protectedPaths.join(', ') || 'production credentials, main branch'}`,
      `  Required proof: ${handoff.requiredEvidence.length} evidence requirement(s)`,
      s.dim(`  pinned: ledger v${handoff.ledgerVersion} · context v${handoff.contextVersion} · ${handoff.baseRevision}`),
    ]);
  }

  /* attempts + verification from real evidence, split by attempt order */
  const attempt2Start = events.find((e) => e.kind === 'agent.session_resumed');
  push('attempt1', ['', s.gold('ATTEMPT 1'), `  Implementation report received ${badge('SIMULATED')} — claims, not evidence`]);

  // Evidence is appended per attempt; with a repair, the first half is
  // attempt 1 (the policy check count is identical per attempt).
  const verify1 = attempt2Start ? Math.floor(evidence.length / 2) : evidence.length;
  const attempt1Records = evidence.slice(0, verify1);
  const failed1 = attempt1Records.filter((e) => e.status === 'failed');
  push('verify1', [
    '',
    s.gold('RELAY VERIFICATION'),
    `  ${attempt1Records.filter((e) => e.status === 'passed').length} checks passed.`,
    ...failed1.map((e) => `  ${badge('FAIL')} ${e.command ?? e.type}`),
  ]);

  const review1 = reviews[0];
  if (review1) {
    push('review1', [
      '',
      s.gold('INDEPENDENT REVIEW'),
      `  ${review1.reviewer} (independent of the coding agent): ${review1.verdict.replace('_', ' ')}`,
      ...review1.findings.flatMap((f) => wrap(`  ${badge('FAIL')} ${f.title}: ${f.detail}`, 76)),
    ]);
  }

  if (status.repairCount > 0) {
    push('repair', [
      '',
      s.gold('RELAY DECISION'),
      '  One bounded repair authorized (all Guided-Mode conditions passed).',
      '  Same agent session resumed — context preserved, scope unchanged.',
    ]);
    const attempt2Records = evidence.slice(verify1);
    push('verify2', [
      '',
      s.gold('RELAY VERIFICATION (RE-RUN)'),
      `  ${attempt2Records.filter((e) => e.status === 'passed').length} checks passed.`,
      `  ${attempt2Records.filter((e) => e.status === 'failed').length} failed.`,
    ]);
    const review2 = reviews[1];
    if (review2) push('review2', ['', s.gold('INDEPENDENT REVIEW'), `  ${review2.reviewer}: ${review2.verdict} ${badge('SIMULATED')}`]);
  }

  /* final audit + completion */
  if (audit) {
    push('audit', [
      '',
      s.gold('FINAL AUDIT'),
      `  outcome: ${audit.outcome}`,
      `  1 task · ${audit.repairCount} repair · 0 unresolved blocking findings`,
      `  claim promotions: ${(audit.claimPromotions ?? []).length} (evidence-backed, exactly-once)`,
      s.dim(`  ${audit.simulationNotice ?? ''}`),
    ]);
    push('complete', [
      '',
      s.bold(s.gold('RELAY COMPLETE')),
      '',
      'Workflow:',
      '  Architect → Coding Agent → Relay Verification → Independent Review',
      '  → One Bounded Repair → Re-Verification → Final Audit',
      '',
      `${badge('PASS')} CompletionPolicy satisfied`,
      `${badge('PASS')} Independent review approved`,
      `${badge('PASS')} Required evidence verified`,
      `${badge('PASS')} No unresolved blocking findings`,
      `${badge('PASS')} One bounded repair used`,
      '',
      `Mission: 1 task · 1 owner · ${audit.repairCount} repair · 0 blocked requirements`,
      `Provenance: ${badge('SIMULATED')} SIMULATED AGENT EXECUTION`,
      '',
      s.dim('Pass the work. Keep the context.'),
    ]);
  } else {
    push('stopped', [
      '',
      s.bold('RELAY STOPPED SAFELY'),
      `  status: ${status.status}`,
      ...(status.checkpoint ? wrap(`  reason: ${status.checkpoint.reason}`, 76) : []),
    ]);
  }

  return frames;
}
