import { describe, expect, it } from 'vitest';

import type { JuliusEvidence } from '../../src/relay/mission/julius/julius-runtime';
import { LIVE_EVIDENCE_SUPERSEDED_LABEL, liveEvidenceLines } from './live-evidence-lines';

/**
 * THE LIVE REPORT LABELS A ROW FROM AN ATTEMPT THE DECISION DID NOT READ (defect A's A-6).
 * The allowlist half, that every line printed here survives `scripts/julius-live-evidence.mjs`,
 * is pinned beside the other printers in `scripts/julius-first-live-mission.test.ts` (F5).
 */

const row = (evidenceId: string, taskId: string, status: JuliusEvidence['status'] = 'PASSED', type: JuliusEvidence['type'] = 'TEST'): JuliusEvidence => ({
  evidenceId, missionId: 'msn-1', taskId, workerId: 'w', type, status,
  safeSummary: `${type} ${status}.`, artifactRef: null, integrityHash: null, occurredAt: '2026-09-29T12:00:00.000Z',
});
/** The line the entrypoint printed for every row before this change. */
const unlabelled = (item: JuliusEvidence) => `  evidence ${item.evidenceId} [${item.type}/${item.status}] ${item.safeSummary}`;

describe('the live report’s evidence lines', () => {
  it('a lost lease’s FAILED row beside the accepted attempt is labelled; the accepted attempt’s row prints as it always did', () => {
    const lost = row('build-1:1:0', 'build-1', 'FAILED');
    const accepted = row('build-1:2:0', 'build-1');
    expect(liveEvidenceLines([lost, accepted], [{ taskId: 'build-1', leaseGeneration: 2 }])).toEqual([
      `${unlabelled(lost)}${LIVE_EVIDENCE_SUPERSEDED_LABEL}`,
      unlabelled(accepted),
    ]);
  });

  it('DA1 shape: an accepted attempt that wrote nothing leaves the lost lease’s row labelled, since only the task row names the accepted attempt', () => {
    const lines = liveEvidenceLines([row('build-1:1:0', 'build-1')], [{ taskId: 'build-1', leaseGeneration: 2 }]);
    expect(lines).toEqual([`${unlabelled(row('build-1:1:0', 'build-1'))}${LIVE_EVIDENCE_SUPERSEDED_LABEL}`]);
  });

  it('the label ends the line, after the summary, where the allowlist’s free-text tail accepts it', () => {
    const [line] = liveEvidenceLines([row('build-1:1:0', 'build-1', 'FAILED')], [{ taskId: 'build-1', leaseGeneration: 2 }]);
    expect(line).toBe('  evidence build-1:1:0 [TEST/FAILED] TEST FAILED. (superseded attempt)');
    expect(line).toMatch(/^ {2}evidence [\w:.-]+ \[[A-Z_]+\/[A-Z_]+\] .*$/u);
  });

  it('a tool row is judged by the generation it names, like every other row', () => {
    const lines = liveEvidenceLines(
      [row('tool:inv-7:g1', 'build-1', 'FAILED', 'COMMAND'), row('tool:inv-9:g2', 'build-1', 'PASSED', 'COMMAND')],
      [{ taskId: 'build-1', leaseGeneration: 2 }],
    );
    expect(lines.map((line) => line.endsWith(LIVE_EVIDENCE_SUPERSEDED_LABEL))).toEqual([true, false]);
  });

  it('a row that names no attempt is never labelled: nothing is assumed away', () => {
    const [line] = liveEvidenceLines([row('research:page-3', 'build-1', 'PASSED', 'ARTIFACT')], [{ taskId: 'build-1', leaseGeneration: 2 }]);
    expect(line).toBe(unlabelled(row('research:page-3', 'build-1', 'PASSED', 'ARTIFACT')));
  });

  it('each task is judged by its own task row', () => {
    const lines = liveEvidenceLines(
      [row('plan-1:1:0', 'plan-1', 'PASSED', 'ARTIFACT'), row('build-1:2:0', 'build-1', 'FAILED'), row('build-1:3:0', 'build-1')],
      [{ taskId: 'plan-1', leaseGeneration: 1 }, { taskId: 'build-1', leaseGeneration: 3 }],
    );
    expect(lines.map((line) => line.endsWith(LIVE_EVIDENCE_SUPERSEDED_LABEL))).toEqual([false, true, false]);
  });

  it('with nothing superseded, every line is byte for byte the line printed before, one per row, in order', () => {
    const rows = [row('plan-1:1:0', 'plan-1', 'PASSED', 'ARTIFACT'), row('build-1:1:0', 'build-1'), row('build-1:1:1', 'build-1', 'FAILED', 'LINT')];
    expect(liveEvidenceLines(rows, [{ taskId: 'plan-1', leaseGeneration: 1 }, { taskId: 'build-1', leaseGeneration: 1 }])).toEqual(rows.map(unlabelled));
  });
});
