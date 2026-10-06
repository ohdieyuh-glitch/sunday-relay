import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  JULIUS_CARRY_SOURCES_FORMAT,
  parseJuliusCarrySources,
  parseJuliusDumpTable,
  previewJuliusCarry,
  verifyJuliusCarryChain,
  type JuliusCarrySources,
} from './julius-carry-verify';
import { juliusCarryFindingCandidate, juliusKnowledgeCarryFacts, juliusKnowledgeConsumedFacts, planJuliusKnowledgeCarry } from './julius-claim-ledger';
import { foldJuliusFindings, juliusFindingTransitionFacts } from './julius-finding-lifecycle';

/**
 * THE OFF-HOST VERIFIER, HELD TO ITS CONTROLS (Decision C, C-7).
 *
 * The PASS fixture's arm WITH side is what `carryProjectKnowledge` writes for these sources, computed here by the
 * same production functions: scaffolding, so each control below changes ONE thing and must FAIL by name. The proof
 * that the store really writes it is the real-PostgreSQL case in `julius-carry-reaches-planner.real-postgres.test.ts`.
 */

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const WITHOUT = 'run:without';
const WITH = 'run:with';
const PLAN = `${WITH}:plan`;
const LIMIT = 12;
const T = '2026-10-06T10:00:00.000Z';
const noNulls = (facts: Record<string, string | number | boolean | null>) =>
  Object.fromEntries(Object.entries(facts).filter(([, value]) => value !== null));

/** WITHOUT's export as `.github/julius-carry-sources.sql` writes it: one finding a repair answered and a re-review RESOLVED, one left OPEN. */
function sourcesDocument(): Record<string, unknown> {
  const finding = (findingId: string) => ({
    findingId, runId: WITHOUT, taskId: `${WITHOUT}:plan`, reviewerWorkerId: 'independent-reviewer-hermes', severity: 'HIGH',
    category: 'review', claim: 'VERIFY-SENTINEL the plan deploys before the migration runs.', criterionId: 'AC-1',
    evidenceIds: [`evidence:${findingId}`], blocking: true, status: 'OPEN', createdAt: T,
  });
  const recorded = (findingId: string, sequence: number) => ({
    sequence, type: 'finding.recorded', taskId: `${WITHOUT}:plan`, facts: { findingId, reviewTaskId: `review:${WITHOUT}:plan` },
  });
  return {
    format: JULIUS_CARRY_SOURCES_FORMAT, runId: WITHOUT, projectId: 'prj-1', missionId: 'mission-1', state: 'COMPLETED',
    // The run's own tasks, the review, the repair and the re-review the resolved finding's life names among them.
    tasks: [
      { taskId: `${WITHOUT}:plan`, runId: WITHOUT, taskType: 'plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED' },
      { taskId: `review:${WITHOUT}:plan`, runId: WITHOUT, taskType: 'review:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED' },
      { taskId: `repair:${WITHOUT}:plan:1:task`, runId: WITHOUT, taskType: 'repair:plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED' },
      { taskId: `review:repair:${WITHOUT}:plan:1:task`, runId: WITHOUT, taskType: 'review:repair:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED' },
    ],
    findings: [finding('finding:resolved'), finding('finding:open')],
    ledger: [
      recorded('finding:resolved', 1),
      recorded('finding:open', 2),
      { sequence: 3, type: 'finding.transitioned', taskId: `${WITHOUT}:plan`, facts: noNulls(juliusFindingTransitionFacts({ findingId: 'finding:resolved', move: 'REPAIR_SUCCEEDED', at: T, repairTaskId: `repair:${WITHOUT}:plan:1:task` })) },
      { sequence: 4, type: 'finding.transitioned', taskId: `${WITHOUT}:plan`, facts: noNulls(juliusFindingTransitionFacts({ findingId: 'finding:resolved', move: 'REVIEWER_RESOLVED', at: T, reviewTaskId: `review:repair:${WITHOUT}:plan:1:task` })) },
    ],
  };
}

const parsed = (document: Record<string, unknown>): JuliusCarrySources => {
  const result = parseJuliusCarrySources(JSON.stringify(document));
  if (!result.ok) throw new Error(result.problem);
  return result.value;
};

/** Arm WITH's dump rows, as the store and `.github/julius-live-evidence-dump.sh` would hold them for these sources. */
function withSide(sources: JuliusCarrySources) {
  const lives = new Map(foldJuliusFindings(sources.findings, sources.ledger).map((life) => [life.findingId, life] as const));
  const taskOf = new Map(sources.tasks.map((task) => [task.taskId, task] as const));
  const plan = planJuliusKnowledgeCarry({
    runId: WITH, projectId: sources.projectId, missionId: sources.missionId,
    scope: { taskId: PLAN, taskType: 'plan', role: 'PROMPT_ARCHITECT' },
    sourceRuns: [{ runId: sources.runId, state: sources.state }],
    findings: sources.findings.map((finding) =>
      juliusCarryFindingCandidate({ runId: sources.runId, finding, life: lives.get(finding.findingId), taskOf: (taskId) => taskOf.get(taskId) })),
    architectures: [], brain: [], limit: LIMIT,
  });
  const facts = juliusKnowledgeCarryFacts(plan, Object.fromEntries(plan.carried.map((item) => [item.entryId, `sha256:${sha256(item.text)}`])));
  const owed = plan.carried.map((item) => item.entryId);
  // A packet owed nothing writes no receipt (`juliusKnowledgeConsumedFacts` answers null).
  const consumed = juliusKnowledgeConsumedFacts({ owed, sourceEntryIds: ['x', ...owed], evictedEntryIds: [], excludedEntryIds: [], attempt: 1, role: 'PROMPT_ARCHITECT', taskType: 'plan' });
  return {
    knowledge: [
      {
        run_id: WITH, event_type: 'julius.knowledge.carried', task_id: '', carry_version: String(facts.carryVersion), outcome: String(facts.outcome),
        scope_task_id: PLAN, scope_task_type: 'plan', scope_role: 'PROMPT_ARCHITECT', source_run_ids: String(facts.sourceRunIds),
        eligible: String(facts.eligible), carried_entries: String(facts.carriedEntries ?? ''), entries_truncated: String(facts.entriesTruncated),
      },
      ...(consumed === null ? [] : [{
        run_id: WITH, event_type: 'julius.knowledge.consumed', task_id: PLAN, role: String(consumed.role), task_type: String(consumed.taskType),
        in_scope: String(consumed.inScope), admitted: String(consumed.admitted), missing: String(consumed.missing), admitted_entry_ids: String(consumed.admittedEntryIds ?? ''),
      }]),
    ] as Record<string, string>[],
    copies: plan.carried.map((item) => ({ run_id: WITH, entry_id: item.entryId, task_id: PLAN, worker_id: item.workerId, entry_kind: 'FINDING', content_sha256: sha256(item.text) })) as Record<string, string>[],
    tasks: [{ task_id: PLAN, task_type: 'plan', role: 'PROMPT_ARCHITECT', state: 'COMPLETED', ordinal: '0', parent_task_id: '', run_id: WITH }] as Record<string, string>[],
  };
}

const verify = (sources: JuliusCarrySources, side: ReturnType<typeof withSide>) =>
  verifyJuliusCarryChain({ sources, withRunId: WITH, ...side, limit: LIMIT, sha256 });
const failed = (verdict: ReturnType<typeof verify>) => verdict.checks.filter((item) => !item.ok).map((item) => item.check);

describe('the off-host verifier: the four-point chain, re-derived from arm WITHOUT\'s export alone', () => {
  it('PASSES the chain the production rule re-derives, and names the verified repair finding it proved', () => {
    const sources = parsed(sourcesDocument());
    const verdict = verify(sources, withSide(sources));
    expect(failed(verdict)).toEqual([]);
    expect(verdict.verdict).toBe('PASS');
    expect(verdict.proven).toHaveLength(1);
    expect(verdict.proven[0]).toMatchObject({ findingId: 'finding:resolved' });
    expect(verdict.proven[0]!.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it('FAILS a tampered digest in the record — the C-7 control', () => {
    const sources = parsed(sourcesDocument());
    const side = withSide(sources);
    side.knowledge[0]!.carried_entries = side.knowledge[0]!.carried_entries!.replace(/sha256:[0-9a-f]{64}/u, `sha256:${'0'.repeat(64)}`);
    const verdict = verify(sources, side);
    expect(verdict.verdict).toBe('FAIL');
    expect(failed(verdict)).toEqual(['record_entries']);
    expect(verdict.proven, 'nothing is proven by a failed chain').toEqual([]);
  });

  it('REFUSES an export missing a field the header renders, by its path — the C-7 control — and FAILS one whose field was altered', () => {
    const missing = sourcesDocument();
    delete ((missing.findings as Record<string, unknown>[])[0]!).severity;
    expect(parseJuliusCarrySources(JSON.stringify(missing))).toEqual({ ok: false, problem: expect.stringContaining('$.findings[0].severity') });
    const altered = sourcesDocument();
    (altered.findings as Record<string, unknown>[])[0]!.category = 'release';
    const verdict = verify(parsed(altered), withSide(parsed(sourcesDocument())));
    expect(verdict.verdict).toBe('FAIL');
    expect(failed(verdict), 'the text re-derived from the altered export is not the one the record bound').toContain('record_entries');
  });

  it('FAILS a carry whose finding\'s repair is no task of arm WITHOUT\'s export — the provenance rule, applied off-host too (P2b)', () => {
    const forged = sourcesDocument();
    forged.tasks = (forged.tasks as Record<string, unknown>[]).filter((task) => task.taskType !== 'repair:plan');
    // The record WITH holds was made from the full store; the export says the repair never existed.
    const verdict = verify(parsed(forged), withSide(parsed(sourcesDocument())));
    expect(verdict.verdict).toBe('FAIL');
    expect(failed(verdict)).toEqual(expect.arrayContaining(['record_eligible', 'record_entries', 'copies_exact', 'vrf_carried']));
  });

  it('FAILS a copy whose text is not the one the record bound, and a copy that should not exist', () => {
    const sources = parsed(sourcesDocument());
    const changed = withSide(sources);
    changed.copies[0]!.content_sha256 = sha256('a different text');
    expect(failed(verify(sources, changed))).toEqual([`copy ${changed.copies[0]!.entry_id}`]);
    const extra = withSide(sources);
    extra.copies.push({ ...extra.copies[0]!, entry_id: `carried:${WITHOUT}:finding:open:into:${WITH}` });
    expect(failed(verify(sources, extra))).toEqual(['copies_exact']);
  });

  it('FAILS when the planner\'s receipt missed a row, or there is none', () => {
    const sources = parsed(sourcesDocument());
    const missed = withSide(sources);
    missed.knowledge[1] = { ...missed.knowledge[1]!, admitted: '0', missing: '1', admitted_entry_ids: '' };
    expect(failed(verify(sources, missed))).toEqual(['receipt 1']);
    const none = withSide(sources);
    none.knowledge.pop();
    expect(failed(verify(sources, none))).toEqual(['receipts_present']);
  });

  it('FAILS a record that is truncated, carried from another run, or carried nothing — and never proves an empty carry', () => {
    const sources = parsed(sourcesDocument());
    const truncated = withSide(sources);
    truncated.knowledge[0]!.entries_truncated = 'true';
    expect(failed(verify(sources, truncated))).toEqual(['record_whole']);
    const stranger = withSide(sources);
    stranger.knowledge[0]!.source_run_ids = `${WITHOUT} run:stranger`;
    expect(failed(verify(sources, stranger))).toEqual(['record_sources']);
    // Arm WITHOUT left nothing eligible (the open finding only): the re-derived carry is empty, and so is any proof.
    const nothing = sourcesDocument();
    nothing.ledger = (nothing.ledger as Record<string, unknown>[]).slice(0, 2);
    const empty = parsed(nothing);
    const verdict = verify(empty, withSide(empty));
    expect(verdict.verdict).toBe('FAIL');
    expect(failed(verdict)).toEqual(expect.arrayContaining(['record_carried', 'receipts_present', 'vrf_carried']));
  });

  it('refuses an export holding a task of another run: no other run\'s task may vouch for this run\'s finding', () => {
    const foreign = sourcesDocument();
    (foreign.tasks as Record<string, unknown>[])[1]!.runId = 'run:stranger';
    expect(parseJuliusCarrySources(JSON.stringify(foreign))).toEqual({ ok: false, problem: expect.stringContaining('$.tasks[1].runId') });
  });

  it('refuses an export that names no run, is not this format, or is out of ledger order', () => {
    expect(parseJuliusCarrySources(JSON.stringify({ ...sourcesDocument(), runId: null }))).toMatchObject({ ok: false, problem: expect.stringContaining('sources_run_unnamed') });
    expect(parseJuliusCarrySources(JSON.stringify({ ...sourcesDocument(), format: 'julius-carry-export.v1' }))).toMatchObject({ ok: false });
    const shuffled = sourcesDocument();
    shuffled.ledger = [...(shuffled.ledger as unknown[])].reverse();
    expect(parseJuliusCarrySources(JSON.stringify(shuffled))).toMatchObject({ ok: false, problem: expect.stringContaining('sequence') });
    expect(parseJuliusCarrySources('not json')).toEqual({ ok: false, problem: 'sources_not_json' });
  });
});

describe('the preview: what arm WITH will carry, said from arm WITHOUT\'s export before WITH is dispatched', () => {
  const preview = (sources: JuliusCarrySources) => previewJuliusCarry({ sources, withRunId: WITH, scopeTaskId: PLAN, limit: LIMIT, sha256 });

  it('CARRIES exactly the entries, findings and digests the chain verifier later proves, and names what it leaves behind', () => {
    const sources = parsed(sourcesDocument());
    const promised = preview(sources);
    const side = withSide(sources);
    const proven = verify(sources, side);
    expect(proven.verdict).toBe('PASS');
    expect(promised.verdict).toBe('CARRIES');
    expect(promised.carries, 'the gate promises what C-7 proves, digest for digest').toEqual(proven.proven);
    expect(promised.carriedEntries, 'and the record WITH must hold').toBe(side.knowledge[0]!.carried_entries);
    expect(promised).toMatchObject({ withoutRunId: WITHOUT, withRunId: WITH, scopeTaskId: PLAN, eligible: 1 });
    expect(promised.excluded).toEqual([{ findingId: 'finding:open', reason: 'finding_unresolved' }]);
  });

  it('is EMPTY when no finding was resolved by the independent re-review: the pair is INVALID, and nothing is promised', () => {
    const unresolved = sourcesDocument();
    unresolved.ledger = (unresolved.ledger as unknown[]).filter((row) => (row as { sequence: number }).sequence !== 4);
    const promised = preview(parsed(unresolved));
    expect(promised).toMatchObject({ verdict: 'EMPTY', eligible: 0, carriedEntries: '', carries: [] });
    expect(promised.excluded).toEqual([
      { findingId: 'finding:resolved', reason: 'finding_unresolved' },
      { findingId: 'finding:open', reason: 'finding_unresolved' },
    ]);
  });

  it('is EMPTY when the resolved finding\'s repair did not succeed: the provenance rule decides the gate too (P2b)', () => {
    const forged = sourcesDocument();
    (forged.tasks as Record<string, unknown>[])[2]!.state = 'FAILED';
    const promised = preview(parsed(forged));
    expect(promised.verdict).toBe('EMPTY');
    expect(promised.excluded).toContainEqual({ findingId: 'finding:resolved', reason: 'finding_provenance_unverified' });
  });
});

describe('a dump table, read strictly', () => {
  const table = (rows: string[], footer = `(${String(rows.length)} row${rows.length === 1 ? '' : 's'})`) =>
    `${['run_id\tentry_id', ...rows, footer].join('\n')}\n`;

  it('reads the header, the rows and a footer that agrees', () => {
    expect(parseJuliusDumpTable(table(['run:a\tcarried:x']))).toEqual({ ok: true, value: [{ run_id: 'run:a', entry_id: 'carried:x' }] });
    expect(parseJuliusDumpTable(table([]))).toEqual({ ok: true, value: [] });
  });

  it('refuses what the dump could not write, a ragged row, and a footer that disagrees or is missing', () => {
    expect(parseJuliusDumpTable('unavailable\n')).toEqual({ ok: false, problem: 'table_unavailable' });
    expect(parseJuliusDumpTable('')).toEqual({ ok: false, problem: 'table_empty' });
    expect(parseJuliusDumpTable(table(['run:a']))).toEqual({ ok: false, problem: 'table_ragged_row' });
    expect(parseJuliusDumpTable(table(['run:a\tcarried:x'], '(2 rows)'))).toMatchObject({ ok: false, problem: expect.stringContaining('table_footer') });
    expect(parseJuliusDumpTable('run_id\tentry_id\nrun:a\tcarried:x\n')).toMatchObject({ ok: false, problem: 'table_footers: 0' });
  });
});
