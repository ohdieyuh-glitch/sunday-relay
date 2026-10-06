import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  juliusCarryFindingCandidate, juliusKnowledgeCarryFacts, juliusKnowledgeConsumedFacts, planJuliusKnowledgeCarry,
} from '../src/relay/mission/julius/julius-claim-ledger';
import { JULIUS_CARRY_SOURCES_FORMAT, parseJuliusCarrySources } from '../src/relay/mission/julius/julius-carry-verify';
import { foldJuliusFindings } from '../src/relay/mission/julius/julius-finding-lifecycle';
import { planTaskId } from '../relay-bridge/julius/bootstrap';
import { juliusCarryScopeTaskId, juliusCarryVerifyCommandOf, runJuliusCarryPreview, runJuliusCarryVerify } from './julius-carry-verify';

/**
 * THE OFF-HOST VERIFIER'S CLI, OVER TWO BUNDLE DIRECTORIES (Decision C, C-7).
 *
 * What the CLI owns beyond the pure verifier: arm WITHOUT's export is held to the digest WITHOUT's own job recorded,
 * each bundle is read for the run its manifest names, a missing or unreadable file is a REFUSAL (exit 2), and the
 * verdict's PASS / FAIL becomes the exit code. The bundles here are written in the dump's own formats.
 */

const sha256 = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');
const WITHOUT = 'run:without';
const WITH = 'run:with';
const PLAN = `${WITH}:plan`;
const T = '2026-10-06T10:00:00.000Z';
const scratch = mkdtempSync(join(tmpdir(), 'julius-carry-verify-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const sourcesDocument = () => ({
  format: JULIUS_CARRY_SOURCES_FORMAT, runId: WITHOUT, projectId: 'prj-1', missionId: 'mission-1', state: 'COMPLETED',
  tasks: [
    { taskId: `${WITHOUT}:plan`, runId: WITHOUT, taskType: 'plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED' },
    { taskId: `review:${WITHOUT}:plan`, runId: WITHOUT, taskType: 'review:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED' },
    { taskId: `repair:${WITHOUT}:plan:1:task`, runId: WITHOUT, taskType: 'repair:plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED' },
    { taskId: `review:repair:${WITHOUT}:plan:1:task`, runId: WITHOUT, taskType: 'review:repair:plan', role: 'INDEPENDENT_REVIEWER', state: 'SUCCEEDED' },
  ],
  findings: [{
    findingId: 'finding:resolved', runId: WITHOUT, taskId: `${WITHOUT}:plan`, reviewerWorkerId: 'independent-reviewer-hermes', severity: 'HIGH',
    category: 'review', claim: 'CLI-SENTINEL the plan deploys before the migration runs.', criterionId: null,
    evidenceIds: ['evidence:resolved'], blocking: true, status: 'OPEN', createdAt: T,
  }],
  ledger: [
    { sequence: 1, type: 'finding.recorded', taskId: `${WITHOUT}:plan`, facts: { findingId: 'finding:resolved', reviewTaskId: `review:${WITHOUT}:plan` } },
    { sequence: 2, type: 'finding.transitioned', taskId: `${WITHOUT}:plan`, facts: { findingId: 'finding:resolved', move: 'REPAIR_SUCCEEDED', to: 'ADDRESSED', at: T, repairTaskId: `repair:${WITHOUT}:plan:1:task` } },
    { sequence: 3, type: 'finding.transitioned', taskId: `${WITHOUT}:plan`, facts: { findingId: 'finding:resolved', move: 'REVIEWER_RESOLVED', to: 'RESOLVED', at: T, reviewTaskId: `review:repair:${WITHOUT}:plan:1:task` } },
  ],
});

/** `psql -A -F '\t'`: header, rows, footer. */
const table = (rows: readonly Record<string, string>[], header: readonly string[]) =>
  `${[header.join('\t'), ...rows.map((row) => header.map((name) => row[name] ?? '').join('\t')), `(${String(rows.length)} row${rows.length === 1 ? '' : 's'})`].join('\n')}\n`;

/** Two bundle directories: WITHOUT's export + manifest, and what WITH's store holds for it, written by the production functions. */
function bundles(label: string, over: { sourcesText?: (text: string) => string; recordedDigest?: (digest: string) => string; skip?: string } = {}) {
  const parsed = parseJuliusCarrySources(JSON.stringify(sourcesDocument()));
  if (!parsed.ok) throw new Error(parsed.problem);
  const sources = parsed.value;
  const lives = new Map(foldJuliusFindings(sources.findings, sources.ledger).map((life) => [life.findingId, life] as const));
  const taskOf = new Map(sources.tasks.map((task) => [task.taskId, task] as const));
  const plan = planJuliusKnowledgeCarry({
    runId: WITH, projectId: sources.projectId, missionId: sources.missionId, scope: { taskId: PLAN, taskType: 'plan', role: 'PROMPT_ARCHITECT' },
    sourceRuns: [{ runId: WITHOUT, state: 'COMPLETED' }],
    findings: sources.findings.map((finding) => juliusCarryFindingCandidate({ runId: WITHOUT, finding, life: lives.get(finding.findingId), taskOf: (taskId) => taskOf.get(taskId) })),
    architectures: [], brain: [], limit: 12,
  });
  const facts = juliusKnowledgeCarryFacts(plan, Object.fromEntries(plan.carried.map((item) => [item.entryId, `sha256:${sha256(item.text)}`])));
  const consumed = juliusKnowledgeConsumedFacts({ owed: plan.carried.map((item) => item.entryId), sourceEntryIds: plan.carried.map((item) => item.entryId), evictedEntryIds: [], excludedEntryIds: [], attempt: 1, role: 'PROMPT_ARCHITECT', taskType: 'plan' })!;
  const withoutDir = join(scratch, label, 'without');
  const withDir = join(scratch, label, 'with');
  mkdirSync(withoutDir, { recursive: true });
  mkdirSync(withDir, { recursive: true });
  const sourcesText = (over.sourcesText ?? ((text: string) => text))(`${JSON.stringify(sourcesDocument())}\n`);
  if (over.skip !== 'carry-sources.json') writeFileSync(join(withoutDir, 'carry-sources.json'), sourcesText);
  const recorded = (over.recordedDigest ?? ((digest: string) => digest))(sha256(Buffer.from(`${JSON.stringify(sourcesDocument())}\n`, 'utf8')));
  writeFileSync(join(withoutDir, 'bundle-manifest.txt'), `julius_run_id=${WITHOUT}\ncarry_sources_sha256=${recorded}\n`);
  writeFileSync(join(withDir, 'bundle-manifest.txt'), `julius_run_id=${WITH}\n`);
  const knowledge = [
    { run_id: WITH, event_type: 'julius.knowledge.carried', task_id: '', carry_version: String(facts.carryVersion), outcome: String(facts.outcome), scope_task_id: PLAN, scope_task_type: 'plan', scope_role: 'PROMPT_ARCHITECT', source_run_ids: String(facts.sourceRunIds), eligible: String(facts.eligible), carried_entries: String(facts.carriedEntries ?? ''), entries_truncated: String(facts.entriesTruncated), role: '', task_type: '', in_scope: '', admitted: '', missing: '', admitted_entry_ids: '' },
    { run_id: WITH, event_type: 'julius.knowledge.consumed', task_id: PLAN, carry_version: '', outcome: '', scope_task_id: '', scope_task_type: '', scope_role: '', source_run_ids: '', eligible: '', carried_entries: '', entries_truncated: '', role: String(consumed.role), task_type: String(consumed.taskType), in_scope: String(consumed.inScope), admitted: String(consumed.admitted), missing: String(consumed.missing), admitted_entry_ids: String(consumed.admittedEntryIds ?? '') },
  ];
  const files: Record<string, string> = {
    'knowledge-carry.tsv': table(knowledge, Object.keys(knowledge[0]!)),
    'carry-copies.tsv': table(plan.carried.map((item) => ({ run_id: WITH, entry_id: item.entryId, task_id: PLAN, worker_id: item.workerId, entry_kind: 'FINDING', content_sha256: sha256(item.text) })), ['run_id', 'entry_id', 'task_id', 'worker_id', 'entry_kind', 'content_sha256']),
    'tasks.tsv': table([{ task_id: PLAN, task_type: 'plan', role: 'PROMPT_ARCHITECT', state: 'SUCCEEDED', ordinal: '0', parent_task_id: '', run_id: WITH }], ['task_id', 'task_type', 'role', 'state', 'ordinal', 'parent_task_id', 'run_id']),
  };
  for (const [file, body] of Object.entries(files)) if (over.skip !== file) writeFileSync(join(withDir, file), body);
  return { withoutDir, withDir, limit: 12 };
}

describe('the off-host verifier CLI, over two bundle directories', () => {
  it('PASSES two consistent bundles, exit 0, and names the finding it proved', () => {
    const result = runJuliusCarryVerify(bundles('pass'));
    expect(result.code).toBe(0);
    expect(result.output).toMatchObject({ verdict: 'PASS', withoutRunId: WITHOUT, withRunId: WITH, proven: [{ findingId: 'finding:resolved' }] });
  });

  it('REFUSES arm WITHOUT\'s export when its bytes are not the ones its own job recorded, or the record is absent, exit 2', () => {
    const edited = runJuliusCarryVerify(bundles('edited', { sourcesText: (text) => text.replace('CLI-SENTINEL', 'CLI-SENTINEL ') }));
    expect(edited).toEqual({ code: 2, output: { verdict: 'REFUSED', problem: 'without_sources_digest_mismatch' } });
    const unrecorded = runJuliusCarryVerify(bundles('unrecorded', { recordedDigest: () => '' }));
    expect(unrecorded).toEqual({ code: 2, output: { verdict: 'REFUSED', problem: 'without_sources_digest_unrecorded' } });
  });

  it('REFUSES a bundle missing what the chain reads, by name, exit 2', () => {
    expect(runJuliusCarryVerify(bundles('no-sources', { skip: 'carry-sources.json' })).output).toMatchObject({ problem: 'without_sources_missing' });
    for (const file of ['knowledge-carry.tsv', 'carry-copies.tsv', 'tasks.tsv']) {
      const result = runJuliusCarryVerify(bundles(`no-${file}`, { skip: file }));
      expect(result, file).toEqual({ code: 2, output: { verdict: 'REFUSED', problem: `with_table_missing: ${file}` } });
    }
  });

  it('FAILS, exit 1, when the record WITH holds is not the one the export re-derives', () => {
    const dirs = bundles('tampered');
    const path = join(dirs.withDir, 'knowledge-carry.tsv');
    writeFileSync(path, readFileSync(path, 'utf8').replace(/sha256:[0-9a-f]{64}/u, `sha256:${'0'.repeat(64)}`));
    const result = runJuliusCarryVerify(dirs);
    expect(result.code).toBe(1);
    expect(result.output).toMatchObject({ verdict: 'FAIL', proven: [] });
  });
});

describe('the preview CLI: the procedure gate, over arm WITHOUT\'s bundle and the WITH run id the registration fixes', () => {
  // Real-shaped run ids, as the registration computes them before any run.
  const WITHOUT_RUN = `run:${'a1'.repeat(12)}`;
  const WITH_RUN = `run:${'b2'.repeat(12)}`;

  /** Arm WITHOUT's bundle for `runId`: the export (optionally edited first) and the manifest its job writes. */
  function withoutBundle(label: string, runId: string, edit: (document: ReturnType<typeof sourcesDocument>) => void = () => undefined) {
    const document = JSON.parse(JSON.stringify(sourcesDocument()).replaceAll(WITHOUT, runId)) as ReturnType<typeof sourcesDocument>;
    edit(document);
    const text = `${JSON.stringify(document)}\n`;
    const dir = join(scratch, `preview-${label}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'carry-sources.json'), text);
    writeFileSync(join(dir, 'bundle-manifest.txt'), `julius_run_id=${runId}\ncarry_sources_sha256=${sha256(Buffer.from(text, 'utf8'))}\n`);
    return dir;
  }

  it('scopes the copies to WITH\'s plan task as the bootstrap names it', () => {
    expect(juliusCarryScopeTaskId(WITH_RUN)).toBe(planTaskId(WITH_RUN));
  });

  it('CARRIES, exit 0: names each verified repair finding WITH will inherit, its copy and the digest of its exact text', () => {
    const result = runJuliusCarryPreview({ withoutDir: withoutBundle('carries', WITHOUT_RUN), withRunId: WITH_RUN, limit: 12 });
    expect(result.code).toBe(0);
    expect(result.output).toMatchObject({
      verdict: 'CARRIES', withoutRunId: WITHOUT_RUN, withRunId: WITH_RUN, scopeTaskId: `${WITH_RUN}:plan`, eligible: 1,
      carries: [{ findingId: 'finding:resolved', entryId: `carried:${WITHOUT_RUN}:finding:resolved:into:${WITH_RUN}` }],
    });
    if (result.code !== 0) throw new Error('unreachable');
    expect(result.output.carries[0]!.digest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.output.carriedEntries).toContain(result.output.carries[0]!.digest);
  });

  it('is EMPTY, exit 1, when arm WITHOUT holds no verified repair finding: WITH is not dispatched', () => {
    const unresolved = withoutBundle('empty', WITHOUT_RUN, (document) => { document.ledger.pop(); });
    const result = runJuliusCarryPreview({ withoutDir: unresolved, withRunId: WITH_RUN, limit: 12 });
    expect(result.code).toBe(1);
    expect(result.output).toMatchObject({ verdict: 'EMPTY', carries: [], excluded: [{ findingId: 'finding:resolved', reason: 'finding_unresolved' }] });
  });

  it('REFUSES, exit 2, a WITH run id that is not one, an arm inheriting from itself, and an export its job did not record', () => {
    const dir = withoutBundle('refusals', WITHOUT_RUN);
    expect(runJuliusCarryPreview({ withoutDir: dir, withRunId: 'run:b2b2', limit: 12 }))
      .toEqual({ code: 2, output: { verdict: 'REFUSED', problem: "with_run_invalid: 'run:b2b2' is not a Julius run id" } });
    expect(runJuliusCarryPreview({ withoutDir: dir, withRunId: WITHOUT_RUN, limit: 12 }))
      .toEqual({ code: 2, output: { verdict: 'REFUSED', problem: 'with_run_is_without: an arm cannot inherit from itself' } });
    const edited = join(dir, 'carry-sources.json');
    writeFileSync(edited, readFileSync(edited, 'utf8').replace('CLI-SENTINEL', 'CLI-SENTINEL '));
    expect(runJuliusCarryPreview({ withoutDir: dir, withRunId: WITH_RUN, limit: 12 }))
      .toEqual({ code: 2, output: { verdict: 'REFUSED', problem: 'without_sources_digest_mismatch' } });
  });

  it('runs on exactly its arguments: anything else is a usage refusal, never a guess', () => {
    expect(juliusCarryVerifyCommandOf(['w', 'x'])).toEqual({ mode: 'chain', withoutDir: 'w', withDir: 'x' });
    expect(juliusCarryVerifyCommandOf(['--preview', 'w', WITH_RUN])).toEqual({ mode: 'preview', withoutDir: 'w', withRunId: WITH_RUN });
    for (const args of [[], ['w'], ['w', 'x', 'y'], ['--preview', 'w'], ['--preview', 'w', WITH_RUN, 'y'], ['w', '--preview'], ['--check', 'w'], ['--previw', 'w', WITH_RUN]]) {
      expect(juliusCarryVerifyCommandOf(args), JSON.stringify(args)).toBeNull();
    }
  });
});
