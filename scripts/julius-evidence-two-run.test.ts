import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createJuliusDurableArtifacts } from '../relay-bridge/julius/durable-artifacts';
import { createJuliusWorkArtifactMemoryStore, type JuliusWorkArtifactKind, type JuliusWorkArtifactRecord } from '../src/relay/mission/julius';
import { LocalJuliusArtifactStore } from '../src/relay/workspace/julius-tools/local-artifact-store';
// @ts-expect-error — a plain ESM script without declarations; its exports are exercised directly.
import * as bodies from './julius-evidence-bodies.mjs';
// @ts-expect-error — a plain ESM script without declarations; its exports are exercised directly.
import * as resolver from './julius-evidence-resolve.mjs';

/**
 * A LEARNING-PAIR WITH BUNDLE HOLDS TWO RUNS (Decision C, audit F1, 2026-10-13).
 *
 * Arm WITH restores arm WITHOUT's whole store before it runs, so its evidence dump reads BOTH runs' work-artifact
 * rows; the WITHOUT run's bodies died with the WITHOUT runner (the store carries rows, not blobs). Before this fix the
 * copier marked every WITHOUT row MISSING and the strict resolver failed every WITH job, paid and dry.
 *
 * THE FIXTURE IS THE PRODUCER'S. Each run writes its bodies through `createJuliusDurableArtifacts` over the REAL local
 * content store, each on its own root (one per runner); the rows are the record store's own, written in the dump's
 * column order (`.github/julius-live-evidence-dump.sh`, work-artifacts.tsv); each evidence row's integrity_hash is
 * sha256 of the full text, as the live workers compute it. The manifest and the restore record are written in the
 * exact lines the dump and the WITH restore step write.
 */

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const scratch: string[] = [];
afterAll(() => { for (const dir of scratch) rmSync(dir, { recursive: true, force: true }); });
const temp = (label: string) => { const dir = mkdtempSync(join(tmpdir(), `julius-two-run-${label}-`)); scratch.push(dir); return dir; };

const PROJECT = 'prj-julius-learning-pair-1';
const WITHOUT_RUN = 'run:e50d275a63daa1dc3bc92a2a';
const WITH_RUN = 'run:9c1d3f0a7b2e4c6d8e0f1a2b';
const THIRD_RUN = 'run:0123456789abcdef01234567';

type Body = { readonly taskId: string; readonly kind: JuliusWorkArtifactKind; readonly role: string; readonly text: string };
const BODIES_OF = (run: string): Body[] => [
  { taskId: `${run}:plan`, kind: 'PLAN', role: 'PROMPT_ARCHITECT', text: `plan of ${run}\n- step one\n` },
  { taskId: `${run}:build`, kind: 'BASE_REVISION', role: 'CODING_AGENT', text: `base revision of ${run}\n` },
  { taskId: `${run}:build`, kind: 'DIFF', role: 'CODING_AGENT', text: `diff --git a/x b/x\n+${run}\n` },
  { taskId: `${run}:build`, kind: 'TEST_OUTPUT', role: 'CODING_AGENT', text: `ok 1 - ${run}\n` },
];

const WORK_COLUMNS = 'artifact_id\tproject_id\trun_id\ttask_id\tlease_generation\trole\tkind\tcontent_type\tbyte_size\tcontent_hash\tstorage_ref\toccurred_at\tcreated_at';
const EVIDENCE_COLUMNS = 'evidence_id\tevidence_type\tstatus\tsafe_summary\toccurred_at\trun_id\ttask_id\tintegrity_hash\tartifact_ref';

/** One runner's mission: its bodies written through the producer onto ITS root, and the rows the store recorded. */
async function runOnRunner(run: string): Promise<{ root: string; rows: JuliusWorkArtifactRecord[]; evidence: string[] }> {
  const root = temp(`root-${run.slice(4, 10)}`);
  const records = createJuliusWorkArtifactMemoryStore();
  const durable = createJuliusDurableArtifacts({ content: new LocalJuliusArtifactStore(root), records, tenancy: { tenantId: 'tenant' } });
  const evidence: string[] = [];
  for (const [index, body] of BODIES_OF(run).entries()) {
    const written = await durable.put({
      projectId: PROJECT, runId: run, taskId: body.taskId, leaseGeneration: 1, kind: body.kind,
      role: body.role, occurredAt: `2026-10-13T12:0${index}:00.000Z`,
    }, body.text);
    // A base revision is recorded so a diff can be read against it; no evidence row names one (the resolver's rule).
    if (body.kind !== 'BASE_REVISION') {
      evidence.push([`${body.taskId}:1:${body.kind}`, body.kind, 'PASSED', 'a summary\nthat spans\ttwo lines', '2026-10-13 12:00:00+00',
        run, body.taskId, sha(Buffer.from(body.text, 'utf8')), written.ref].join('\t'));
    }
  }
  // A tool row names no artifact: listed HASH_ONLY, never a failure.
  evidence.push([`tool:${run}:1`, 'COMMAND_EXECUTION', 'PASSED', 'ran', '2026-10-13 12:09:00+00', run, `${run}:build`, sha(`stdout ${run}`), ''].join('\t'));
  return { root, rows: [...await records.workArtifactsForRun({ projectId: PROJECT, runId: run })], evidence };
}

const workLine = (row: JuliusWorkArtifactRecord) => [row.artifactId, row.projectId, row.runId, row.taskId, String(row.leaseGeneration),
  row.role, row.kind, row.contentType, String(row.byteSize), row.contentHash, row.storageRef, row.occurredAt, row.occurredAt].join('\t');

/** The bundle a job's evidence dump leaves: its manifest, the two dumps, and (arm WITH only) the restore record. */
function bundleOf(input: { ownRun: string; restoredFrom?: string; rows: JuliusWorkArtifactRecord[]; evidence: string[] }): string {
  const bundle = temp('bundle');
  writeFileSync(join(bundle, 'bundle-manifest.txt'), [
    'manifest_version=1', 'source=github-actions', `commit=${'c'.repeat(40)}`, `tree=${'d'.repeat(40)}`, 'tracked_changes=0',
    `mode=${input.ownRun === 'none' ? 'preflight' : 'paid'}`, 'mode_basis=dispatch_confirm_live', `julius_run_id=${input.ownRun}`,
    'workflow_run_id=37300000002', 'workflow_run_attempt=1', 'event=workflow_dispatch', '',
  ].join('\n'));
  if (input.restoredFrom !== undefined) {
    writeFileSync(join(bundle, 'learning-restore.txt'), [
      'learning_restore_version=1', 'without_workflow_run_id=37300000001', `without_julius_run_id=${input.restoredFrom}`, `dump_sha256=${'e'.repeat(64)}`, '',
    ].join('\n'));
  }
  const ordered = [...input.rows].sort((a, b) => (a.occurredAt === b.occurredAt ? (a.artifactId < b.artifactId ? -1 : 1) : a.occurredAt < b.occurredAt ? -1 : 1));
  writeFileSync(join(bundle, 'work-artifacts.tsv'), `${[WORK_COLUMNS, ...ordered.map(workLine)].join('\n')}\n(${ordered.length} rows)\n`);
  writeFileSync(join(bundle, 'evidence.tsv'), `${[EVIDENCE_COLUMNS, ...input.evidence].join('\n')}\n(${input.evidence.length} rows)\n`);
  return bundle;
}

type Verdict = { verdict: string; subject: string; detail: string };
const resolve = (bundle: string) => resolver.resolveBundle(bundle) as Verdict[];
const statusesIn = (bundle: string) => readFileSync(join(bundle, 'artifacts', 'BODIES.tsv'), 'utf8').trim().split('\n').slice(1)
  .map((line) => { const [artifactId, body, contentHash, byteSize, status] = line.split('\t'); return { artifactId, body, contentHash, byteSize, status }; });
const runOf = (id: string) => id.split(':').slice(1, 3).join(':');

describe('F1: arm WITH resolves its two-run bundle (the restored WITHOUT run is PRIOR_RUN, never MISSING)', () => {
  it('a PAID WITH bundle: WITHOUT rows are PRIOR_RUN (hash-checked against the evidence), WITH rows RESOLVED, and --strict passes', async () => {
    const without = await runOnRunner(WITHOUT_RUN);
    const withArm = await runOnRunner(WITH_RUN);
    // THE WITHOUT RUNNER IS GONE: its root dies with its job, so only the WITH runner's root exists at the WITH dump.
    rmSync(without.root, { recursive: true, force: true });
    const bundle = bundleOf({ ownRun: WITH_RUN, restoredFrom: WITHOUT_RUN, rows: [...without.rows, ...withArm.rows], evidence: [...without.evidence, ...withArm.evidence] });

    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: withArm.root });
    const copied = statusesIn(bundle);
    expect(copied.filter((row) => runOf(row.artifactId) === WITHOUT_RUN).map((row) => row.status), 'never MISSING').toEqual(['PRIOR_RUN', 'PRIOR_RUN', 'PRIOR_RUN', 'PRIOR_RUN']);
    expect(copied.filter((row) => runOf(row.artifactId) === WITHOUT_RUN).map((row) => row.body), 'and no body is claimed for them').toEqual(['-', '-', '-', '-']);
    expect(copied.filter((row) => runOf(row.artifactId) === WITH_RUN).map((row) => row.status)).toEqual(['COPIED', 'COPIED', 'COPIED', 'COPIED']);

    const verdicts = resolve(bundle);
    const forRun = (run: string) => verdicts.filter((entry) => runOf(entry.subject) === run && entry.verdict !== 'HASH_ONLY').map((entry) => entry.verdict);
    expect(forRun(WITHOUT_RUN), 'never MISSING and never RESOLVED: a body this bundle does not carry').toEqual(['PRIOR_RUN', 'PRIOR_RUN', 'PRIOR_RUN', 'PRIOR_RUN']);
    expect(forRun(WITH_RUN)).toEqual(['RESOLVED', 'RESOLVED', 'RESOLVED', 'RESOLVED']);
    expect(verdicts.filter((entry) => entry.verdict === 'HASH_ONLY').map((entry) => entry.subject).sort()).toEqual([`tool:${WITH_RUN}:1`, `tool:${WITHOUT_RUN}:1`]);
    expect(resolver.exitCodeFor(verdicts, true), JSON.stringify(verdicts.filter((entry) => !['RESOLVED', 'PRIOR_RUN', 'HASH_ONLY'].includes(entry.verdict)))).toBe(0);
  });

  it('a WITH DRY RUN (no run of its own: julius_run_id=none) resolves the restored store as PRIOR_RUN, and passes --strict', async () => {
    const without = await runOnRunner(WITHOUT_RUN);
    rmSync(without.root, { recursive: true, force: true });
    const runner = temp('dry-root');
    const bundle = bundleOf({ ownRun: 'none', restoredFrom: WITHOUT_RUN, rows: without.rows, evidence: without.evidence });
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: runner });
    const verdicts = resolve(bundle);
    expect(verdicts.filter((entry) => entry.verdict !== 'HASH_ONLY').map((entry) => entry.verdict)).toEqual(['PRIOR_RUN', 'PRIOR_RUN', 'PRIOR_RUN', 'PRIOR_RUN']);
    expect(resolver.exitCodeFor(verdicts, true)).toBe(0);
  });

  it('a WITHOUT bundle (one run, the one its manifest names) resolves exactly as a single-run bundle always has', async () => {
    const without = await runOnRunner(WITHOUT_RUN);
    const bundle = bundleOf({ ownRun: WITHOUT_RUN, rows: without.rows, evidence: without.evidence });
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: without.root });
    expect(statusesIn(bundle).map((row) => row.status)).toEqual(['COPIED', 'COPIED', 'COPIED', 'COPIED']);
    for (const row of without.rows) expect(readFileSync(join(bundle, 'artifacts', `${sha(row.artifactId)}.body`), 'utf8')).toBe(BODIES_OF(WITHOUT_RUN).find((body) => body.kind === row.kind)!.text);
    const verdicts = resolve(bundle);
    expect(verdicts.map((entry) => entry.verdict).sort()).toEqual(['HASH_ONLY', 'RESOLVED', 'RESOLVED', 'RESOLVED', 'RESOLVED']);
    expect(resolver.exitCodeFor(verdicts, true)).toBe(0);
  });

  it('ANY OTHER RUN IS A FAILURE: a third run in the store, or a restored run the bundle never declared, is FOREIGN_RUN', async () => {
    const without = await runOnRunner(WITHOUT_RUN);
    const third = await runOnRunner(THIRD_RUN);
    const withArm = await runOnRunner(WITH_RUN);
    rmSync(without.root, { recursive: true, force: true });
    const declared = bundleOf({ ownRun: WITH_RUN, restoredFrom: WITHOUT_RUN, rows: [...without.rows, ...third.rows, ...withArm.rows], evidence: [...without.evidence, ...third.evidence, ...withArm.evidence] });
    bodies.copyEvidenceBodies({ bundleDir: declared, configuredRoot: withArm.root });
    expect(statusesIn(declared).filter((row) => runOf(row.artifactId) === THIRD_RUN).map((row) => row.status)).toEqual(['FOREIGN_RUN', 'FOREIGN_RUN', 'FOREIGN_RUN', 'FOREIGN_RUN']);
    const verdicts = resolve(declared);
    expect(verdicts.filter((entry) => runOf(entry.subject) === THIRD_RUN && entry.verdict !== 'HASH_ONLY').map((entry) => entry.verdict)).toEqual(['FOREIGN_RUN', 'FOREIGN_RUN', 'FOREIGN_RUN', 'FOREIGN_RUN']);
    expect(resolver.exitCodeFor(verdicts, false)).toBe(1);

    // A store restored with no declaration beside it (no learning-restore.txt): the bundle names its own run only.
    const undeclared = bundleOf({ ownRun: WITH_RUN, rows: [...without.rows, ...withArm.rows], evidence: [...without.evidence, ...withArm.evidence] });
    bodies.copyEvidenceBodies({ bundleDir: undeclared, configuredRoot: withArm.root });
    expect(resolve(undeclared).filter((entry) => runOf(entry.subject) === WITHOUT_RUN && entry.verdict !== 'HASH_ONLY').map((entry) => entry.verdict)).toEqual(['FOREIGN_RUN', 'FOREIGN_RUN', 'FOREIGN_RUN', 'FOREIGN_RUN']);
    expect(resolver.exitCodeFor(resolve(undeclared), false)).toBe(1);
  });

  it('PRIOR_RUN IS STILL CHECKED: a prior-run row whose content_hash disagrees with the evidence naming it is a MISMATCH', async () => {
    const without = await runOnRunner(WITHOUT_RUN);
    const withArm = await runOnRunner(WITH_RUN);
    rmSync(without.root, { recursive: true, force: true });
    const diff = without.rows.find((row) => row.kind === 'DIFF')!;
    const tampered = without.rows.map((row) => (row === diff ? { ...row, contentHash: sha('another diff') } : row));
    const bundle = bundleOf({ ownRun: WITH_RUN, restoredFrom: WITHOUT_RUN, rows: [...tampered, ...withArm.rows], evidence: [...without.evidence, ...withArm.evidence] });
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: withArm.root });
    const verdicts = resolve(bundle);
    expect(verdicts.find((entry) => entry.subject === diff.artifactId)?.verdict).toBe('MISMATCH');
    expect(resolver.exitCodeFor(verdicts, false)).toBe(1);
  });

  it('THE RESOLVER DOES NOT TRUST THE COPIER: BODIES.tsv calling an own-run row PRIOR_RUN, or a body present for a prior-run row, is refused', async () => {
    const without = await runOnRunner(WITHOUT_RUN);
    const withArm = await runOnRunner(WITH_RUN);
    rmSync(without.root, { recursive: true, force: true });
    const bundle = bundleOf({ ownRun: WITH_RUN, restoredFrom: WITHOUT_RUN, rows: [...without.rows, ...withArm.rows], evidence: [...without.evidence, ...withArm.evidence] });
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: withArm.root });
    const own = withArm.rows.find((row) => row.kind === 'PLAN')!;
    const prior = without.rows.find((row) => row.kind === 'PLAN')!;
    const file = join(bundle, 'artifacts', 'BODIES.tsv');
    writeFileSync(file, readFileSync(file, 'utf8').split('\n').map((line) => (line.startsWith(`${own.artifactId}\t`)
      ? [own.artifactId, '-', own.contentHash, String(own.byteSize), 'PRIOR_RUN'].join('\t') : line)).join('\n'));
    rmSync(join(bundle, 'artifacts', `${sha(own.artifactId)}.body`));
    writeFileSync(join(bundle, 'artifacts', `${sha(prior.artifactId)}.body`), BODIES_OF(WITHOUT_RUN)[0]!.text);
    const verdicts = resolve(bundle);
    expect(verdicts.find((entry) => entry.subject === own.artifactId)?.verdict, 'an own-run row is never PRIOR_RUN').toBe('MISMATCH');
    expect(verdicts.some((entry) => entry.verdict === 'UNEXPECTED_FILE' && entry.subject === `artifacts/${sha(prior.artifactId)}.body`), 'a prior run carries no body').toBe(true);
    expect(existsSync(join(bundle, 'artifacts', `${sha(prior.artifactId)}.body`))).toBe(true);
    expect(resolver.exitCodeFor(verdicts, false)).toBe(1);
  });
});

/**
 * A RUN'S EVIDENCE VOUCHES ONLY FOR ITS OWN ARTIFACTS (MAIN internal review 39b7192e, MINOR-3 F1c, 2026-10-13). With
 * the resolver's cross-run check removed (`artifact_ref names a work artifact of another run`), all 26 evidence tests
 * stayed green, while a row of one run naming the other run's artifact would be folded into that artifact's verdict: a
 * body vouched for across runs, and a bundle passing --strict. Such a row is never accepted: it is UNRESOLVABLE (a
 * failing verdict), and the artifact it names is judged by its own run's evidence alone.
 */
describe('F1: evidence of one run never vouches for an artifact of another (review MINOR-3, F1c)', () => {
  it('a WITH row naming a restored WITHOUT artifact, and a WITHOUT row naming a WITH artifact, each with the right hash: UNRESOLVABLE, never folded, and the bundle fails', async () => {
    const without = await runOnRunner(WITHOUT_RUN);
    const withArm = await runOnRunner(WITH_RUN);
    rmSync(without.root, { recursive: true, force: true });
    const diffOf = (rows: JuliusWorkArtifactRecord[]) => rows.find((row) => row.kind === 'DIFF')!;
    // The producer's own ref for each run's DIFF, read from the producer's own evidence row (never retyped).
    const refOf = (evidence: string[]) => evidence.find((line) => line.split('\t')[1] === 'DIFF')!.split('\t').at(-1)!;
    const diffText = (run: string) => BODIES_OF(run).find((body) => body.kind === 'DIFF')!.text;
    const cross = (id: string, run: string, otherRun: string, otherEvidence: string[]) => [id, 'DIFF', 'PASSED', 'names the other run',
      '2026-10-13 12:10:00+00', run, `${run}:build`, sha(Buffer.from(diffText(otherRun), 'utf8')), refOf(otherEvidence)].join('\t');
    const CROSS_WITH = `cross:${WITH_RUN}:1`;
    const CROSS_WITHOUT = `cross:${WITHOUT_RUN}:1`;
    const crossRows = [cross(CROSS_WITH, WITH_RUN, WITHOUT_RUN, without.evidence), cross(CROSS_WITHOUT, WITHOUT_RUN, WITH_RUN, withArm.evidence)];
    const both = { ownRun: WITH_RUN, restoredFrom: WITHOUT_RUN, rows: [...without.rows, ...withArm.rows] };

    // CONTROL: the same two runs without the cross rows pass --strict, so the failure below is the cross rows' alone.
    const control = bundleOf({ ...both, evidence: [...without.evidence, ...withArm.evidence] });
    bodies.copyEvidenceBodies({ bundleDir: control, configuredRoot: withArm.root });
    expect(resolver.exitCodeFor(resolve(control), true)).toBe(0);

    const bundle = bundleOf({ ...both, evidence: [...without.evidence, ...withArm.evidence, ...crossRows] });
    bodies.copyEvidenceBodies({ bundleDir: bundle, configuredRoot: withArm.root });
    const verdicts = resolve(bundle);
    for (const id of [CROSS_WITH, CROSS_WITHOUT]) {
      expect(verdicts.filter((entry) => entry.subject === id), id).toEqual([{ verdict: 'UNRESOLVABLE', subject: id, detail: 'artifact_ref names a work artifact of another run' }]);
    }
    const judged = (row: JuliusWorkArtifactRecord) => verdicts.find((entry) => entry.subject === row.artifactId)!;
    expect(judged(diffOf(without.rows)).verdict).toBe('PRIOR_RUN');
    expect(judged(diffOf(withArm.rows)).verdict).toBe('RESOLVED');
    for (const row of [diffOf(without.rows), diffOf(withArm.rows)]) {
      expect(judged(row).detail, `${row.artifactId}: the other run's row is not among its witnesses`).not.toContain('cross:');
    }
    expect(resolver.exitCodeFor(verdicts, true)).toBe(1);
    expect(resolver.exitCodeFor(verdicts, false)).toBe(1);
  });
});
