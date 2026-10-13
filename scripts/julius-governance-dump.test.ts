/**
 * V6 G-5: THE EVIDENCE BUNDLE CARRIES THE GOVERNANCE RECORD.
 *
 * `.github/julius-live-evidence-dump.sh` wrote 23 files and none read `julius_approvals` or
 * `julius_transitions`, so a gated run's bundle could not show that it held, who released it, or that nothing ran
 * in between (V6 amendment F9). G-5 adds THREE NEW files and changes no existing one:
 *
 *   approvals.tsv         every approval of every state, with decided_by and decision_reason;
 *   transitions.tsv       the recorded walk, in the ledger's order (run_id, sequence), never the clock's;
 *   lifecycle-events.tsv  approval / pause / resume / cancel events and dispatches, by ledger position.
 *
 * Offline here (the queries as text, against the migrations); executed against a real database in
 * `relay-bridge/julius-governance-dump.real-postgres.test.ts`, and by `julius-live-chain.e2e.test.ts`, which runs
 * every query this script declares.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const SCRIPT = readFileSync(join(ROOT, '.github', 'julius-live-evidence-dump.sh'), 'utf8');
const query = (file: string): string => SCRIPT.split('\n').find((line) => line.startsWith('dump "SELECT') && line.endsWith(`" ${file}`)) ?? '';
const selected = (line: string): string[] => (/^dump "SELECT ([\s\S]*?) FROM relay_wonderland\./u.exec(line)?.[1] ?? '').split(',');

describe('V6 G-5: the governance dumps', () => {
  it('RED before G-5: the dump writes approvals.tsv, transitions.tsv and lifecycle-events.tsv', () => {
    for (const file of ['approvals.tsv', 'transitions.tsv', 'lifecycle-events.tsv']) {
      expect(query(file), `${file} is dumped`).not.toBe('');
    }
  });

  it('approvals.tsv: every approval, of every state, with who decided and why (018\'s columns, nothing filtered)', () => {
    const line = query('approvals.tsv');
    expect(selected(line)).toEqual(['approval_id', 'run_id', 'task_id', 'operation', 'policy_revision', 'reason_code', 'state',
      'requested_at', 'decided_at', 'decided_by', 'decision_reason', 'idempotency_key']);
    expect(line, 'never only the PENDING ones: a granted run must show its grant').not.toMatch(/\bWHERE\b/u);
    expect(line).toContain('FROM relay_wonderland.julius_approvals ORDER BY requested_at,approval_id"');
    const ddl = readFileSync(join(ROOT, 'src', 'relay', 'persistence', 'wonderland-migrations', '018_julius_lifecycle.sql'), 'utf8');
    for (const column of selected(line)) expect(ddl, `018 creates julius_approvals.${column}`).toMatch(new RegExp(`\\n ${column} `, 'u'));
  });

  it('transitions.tsv: the walk in the ledger\'s order, run_id then sequence, never occurred_at', () => {
    const line = query('transitions.tsv');
    expect(selected(line)).toEqual(['run_id', 'sequence', 'from_state', 'to_state', 'reason_code', 'safe_summary', 'occurred_at', 'transition_id']);
    expect(line).toContain('FROM relay_wonderland.julius_transitions ORDER BY run_id,sequence"');
    expect(line).not.toMatch(/ORDER BY[^"]*occurred_at/u);
  });

  it('lifecycle-events.tsv: the six event types, by ledger position, identifiers only', () => {
    const line = query('lifecycle-events.tsv');
    for (const type of ['julius.approval.requested', 'julius.approval.decided', 'julius.run.paused', 'julius.run.resumed', 'julius.run.cancelled', 'julius.worker.dispatched']) {
      expect(line, type).toContain(`'${type}'`);
    }
    expect(line).toContain('ORDER BY e.stream_id,e.sequence"');
    for (const column of ['e.stream_id AS run_id', 'e.sequence', "e.payload->'facts'->>'approvalId' AS approval_id", "e.payload->'facts'->>'decision' AS decision",
      "e.payload->'facts'->>'decidedBy' AS decided_by", "e.payload->'facts'->>'reservationId' AS reservation_id", 'e.occurred_at']) {
      expect(line, column).toContain(column);
    }
    expect(line, 'no free text: a decision reason lives in approvals.tsv only, under the bundle scan').not.toContain('reason\'');
  });

  it('NEW files only: the 23 pre-G-5 dumps all stand above the G-5 block, and the block adds exactly three', () => {
    const before = SCRIPT.slice(0, SCRIPT.indexOf('# V6 G-5: THE GOVERNANCE RECORD'));
    expect(before.length, 'the G-5 block must be found, or this pin is vacuous').toBeLessThan(SCRIPT.length);
    expect(before.match(/^dump "/gmu), 'the pre-G-5 files, untouched above the block').toHaveLength(23);
    expect(SCRIPT.match(/^dump "/gmu)).toHaveLength(26);
  });
});
