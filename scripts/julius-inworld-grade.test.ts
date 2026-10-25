import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  J1_PINNED_CHECKER_FILE_SHA256,
  J1_PINNED_CHECKER_SHA256,
  J1_PINNED_CONTRACT_SHA256,
  J1_PINNED_ORACLE_SHA256,
  INWORLD_PIN_FILES,
} from '../relay-bridge/julius-inworld-checker';
// @ts-expect-error -- plain .mjs, no declaration file
import { expectedDocument } from '../relay-bridge/julius-inworld-mission/julius-inworld-data-1/checker/check.mjs';
import {
  J1_GRADE_PINS,
  J1_PIN_FILES,
  NOT_RUN_REASONS,
  gradeInworld,
  parsePsqlTsv,
  selectGradedAttempt,
  verdictText,
} from './julius-inworld-grade.mjs';

const PINNED = join('relay-bridge', 'julius-inworld-mission', 'julius-inworld-data-1');
const sha256 = (bytes: string | Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const CONTEXT = 'context:9';
const STEM = createHash('sha256').update(`task:build-1\ncontext:9`, 'utf8').digest('hex');
const DIAG_HEADER = 'run_id\tsequence\ttask_id\trole\tstage\tfinal_message_sha256\tfinal_message_context_id\tfinal_message_write';
const diagRow = (sha: string, context = CONTEXT, task = 'task:build-1') => `wlj_x\t7\t${task}\tCODING_AGENT\tbuild\t${sha}\t${context}\t`;

function rig(opts: {
  readonly artifact: string | null; readonly tasks?: string; readonly runs?: string; readonly diagnostics?: (sha: string) => readonly string[];
  readonly manifest?: (m: Record<string, unknown>) => Record<string, unknown>;
}) {
  const root = mkdtempSync(join(tmpdir(), 'julius-grade-'));
  roots.push(root);
  const staging = join(root, 'staging');
  const finalMessage = join(root, 'final-message');
  const evidence = join(root, 'evidence');
  for (const name of J1_PIN_FILES) {
    mkdirSync(dirname(join(staging, name)), { recursive: true });
    copyFileSync(join(PINNED, name), join(staging, name));
  }
  mkdirSync(finalMessage);
  mkdirSync(evidence);
  writeFileSync(join(evidence, 'runs.tsv'), opts.runs ?? [
    'run_id\tmission_id\tstate\tcard_revision\tcreated_at\tupdated_at\tproject_brain_revision',
    'wlj_x\tmission:julius-inworld-data-1\tCOMPLETED\tc\tt0\tt1\t0',
    '(1 row)',
    '',
  ].join('\n'));
  writeFileSync(join(evidence, 'tasks.tsv'), opts.tasks ?? [
    'task_id\ttask_type\trole\tstate\tordinal\tparent_task_id\trun_id\tlease_generation',
    'task:plan-1\tplan\tPROMPT_ARCHITECT\tSUCCEEDED\t1\t\twlj_x\t1',
    'task:build-1\tbuild\tCODING_AGENT\tSUCCEEDED\t2\t\twlj_x\t1',
    '(2 rows)',
    '',
  ].join('\n'));
  const trimmed = (opts.artifact ?? '').trim();
  const rows = opts.diagnostics ? opts.diagnostics(sha256(trimmed)) : [diagRow(sha256(trimmed))];
  writeFileSync(join(evidence, 'worker-diagnostics.tsv'), [DIAG_HEADER, ...rows, `(${String(rows.length)} rows)`, ''].join('\n'));
  if (opts.artifact !== null) {
    writeFileSync(join(finalMessage, `${STEM}.raw.txt`), trimmed);
    const manifest = { schema: 'julius-final-message.v2', taskId: 'task:build-1', contextId: CONTEXT, runId: 'wlj_x', trimmedSha256: sha256(trimmed), trimmedUtf8Bytes: Buffer.byteLength(trimmed) };
    writeFileSync(join(finalMessage, `${STEM}.manifest.json`), JSON.stringify(opts.manifest ? opts.manifest(manifest) : manifest));
  }
  return { staging, finalMessage, evidence };
}

const passing = (): string => JSON.stringify(expectedDocument());

describe('the grader holds the same pins as the runtime', () => {
  it('copies every pin constant and the pinned file order', () => {
    expect(J1_GRADE_PINS).toEqual({
      contractSha256: J1_PINNED_CONTRACT_SHA256,
      combinedSha256: J1_PINNED_CHECKER_SHA256,
      checkerFileSha256: J1_PINNED_CHECKER_FILE_SHA256,
      oracleSha256: J1_PINNED_ORACLE_SHA256,
    });
    expect([...J1_PIN_FILES]).toEqual([...INWORLD_PIN_FILES]);
  });

  it('the checker command is a literal, and its expected self-hash is the pinned checker sha256', () => {
    const source = readFileSync(join('scripts', 'julius-inworld-grade.mjs'), 'utf8');
    const call = source.slice(source.indexOf("spawnSync('node', ["), source.indexOf('], {', source.indexOf("spawnSync('node', [")));
    expect(call).toContain(`'--expect-self-sha256', '${J1_PINNED_CHECKER_FILE_SHA256}'`);
    expect(call).not.toMatch(/\$\{|join\(|opts\./u);
  });
});

describe('grading a paid J1 run with the real pinned checker', () => {
  it('PASS only on the checker\'s own PASS, and the raw text is deleted after grading', () => {
    const paths = rig({ artifact: `  ${passing()}\n` });
    const result = gradeInworld(paths);
    expect(result.exit).toBe(0);
    expect(result.verdict).toMatchObject({ verdict: 'PASS', taskId: 'task:build-1', trimmedSha256: sha256(passing()), checkerSha256: J1_PINNED_CHECKER_FILE_SHA256 });
    expect(existsSync(join(paths.finalMessage, `${STEM}.raw.txt`))).toBe(false);
    const text = verdictText(result.verdict);
    expect(text).toContain('verdict=PASS\n');
    expect(text).toContain(`game_digest=${sha256(passing()).slice(0, 12)}\n`);
  });

  it('a wrong document is FAIL, exits 0, and stays a visible verdict', () => {
    const wrong = JSON.stringify({ ...JSON.parse(passing()), schema: 'not-the-schema' });
    const result = gradeInworld(rig({ artifact: wrong }));
    expect(result.exit).toBe(0);
    expect(result.verdict.verdict).toBe('FAIL');
    expect(verdictText(result.verdict)).toContain('verdict=FAIL\n');
  });

  it('a changed staged checker is a pin mismatch that runs nothing and fails the step', () => {
    const paths = rig({ artifact: passing() });
    writeFileSync(join(paths.staging, 'checker', 'oracle.mjs'), `${readFileSync(join(paths.staging, 'checker', 'oracle.mjs'), 'utf8')}\n// changed\n`);
    const result = gradeInworld(paths);
    expect(result).toMatchObject({ exit: 2, verdict: { verdict: 'NOT_RUN', reason: 'pin_mismatch' } });
    expect(existsSync(join(paths.finalMessage, `${STEM}.raw.txt`))).toBe(true);
  });

  it('a final message that does not match its manifest is never graded', () => {
    const result = gradeInworld(rig({ artifact: passing(), manifest: (m) => ({ ...m, trimmedSha256: '0'.repeat(64) }) }));
    expect(result).toMatchObject({ exit: 2, verdict: { verdict: 'NOT_RUN', reason: 'integrity_mismatch' } });
  });

  it('a missing final message is NOT_RUN and fails the step', () => {
    expect(gradeInworld(rig({ artifact: null }))).toMatchObject({ exit: 3, verdict: { verdict: 'NOT_RUN', reason: 'final_message_missing' } });
  });

  it('no build, or an unreadable task listing, is NOT_RUN and not a failed step', () => {
    const header = 'task_id\ttask_type\trole\tstate\tordinal\tparent_task_id\trun_id\tlease_generation';
    expect(gradeInworld(rig({ artifact: passing(), tasks: `${header}\ntask:build-1\tbuild\tCODING_AGENT\tFAILED\t2\t\twlj_x\t1\n` })))
      .toMatchObject({ exit: 0, verdict: { verdict: 'NOT_RUN', reason: 'no_completed_build' } });
    expect(gradeInworld(rig({ artifact: passing(), tasks: '' }))).toMatchObject({ exit: 0, verdict: { verdict: 'NOT_RUN', reason: 'evidence_unreadable' } });
  });
});

describe('the graded attempt comes from the durable task and run rows only', () => {
  const t = (task_id: string, task_type: string, state: string, parent_task_id = '', role = 'CODING_AGENT', run_id = 'wlj_x') => ({ task_id, task_type, state, parent_task_id, role, run_id });
  const completedRun = [{ run_id: 'wlj_x', state: 'COMPLETED' }];

  it('a repaired build is superseded by its repair, and the repair is graded', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED'), t('repair:b1:1:task', 'repair:build', 'SUCCEEDED', 'b1')], completedRun))
      .toEqual({ ok: true, taskId: 'repair:b1:1:task', taskType: 'repair:build', runId: 'wlj_x' });
  });

  it('two unsuperseded succeeded builds are ambiguous; the grader never picks one', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED'), t('b2', 'build', 'SUCCEEDED')], completedRun))
      .toMatchObject({ ok: false, reason: 'ambiguous_attempt' });
  });

  it('a failed repair leaves no completed build, and other roles never count', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED'), t('repair:b1:1:task', 'repair:build', 'FAILED', 'b1'), t('p1', 'plan', 'SUCCEEDED', '', 'PROMPT_ARCHITECT')], completedRun))
      .toEqual({ ok: false, reason: 'no_completed_build' });
  });

  it('a run that is not COMPLETED is not graded, and two completed runs are ambiguous', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED')], [{ run_id: 'wlj_x', state: 'FAILED' }])).toEqual({ ok: false, reason: 'run_not_completed' });
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED')], [{ run_id: 'wlj_x', state: 'COMPLETED' }, { run_id: 'wlj_y', state: 'COMPLETED' }]))
      .toMatchObject({ ok: false, reason: 'ambiguous_attempt' });
  });

  it('a row without the planner\'s repair id, or of another role, supersedes nothing', () => {
    // An impostor 'repair' cannot hide the real build: both stay leaves, so the grade is refused.
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED'), t('r1', 'repair:build', 'SUCCEEDED', 'b1')], completedRun))
      .toMatchObject({ ok: false, reason: 'ambiguous_attempt' });
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED'), t('repair:b1:1:task', 'repair:build', 'SUCCEEDED', 'b1', 'INDEPENDENT_REVIEWER')], completedRun))
      .toEqual({ ok: true, taskId: 'b1', taskType: 'build', runId: 'wlj_x' });
    // Three rounds deep, each the planner's shape, grades the last.
    expect(selectGradedAttempt([
      t('b1', 'build', 'SUCCEEDED'), t('repair:b1:1:task', 'repair:build', 'SUCCEEDED', 'b1'),
      t('repair:repair:b1:1:task:2:task', 'repair:build', 'SUCCEEDED', 'repair:b1:1:task'),
      t('repair:repair:repair:b1:1:task:2:task:3:task', 'repair:build', 'SUCCEEDED', 'repair:repair:b1:1:task:2:task'),
    ], completedRun)).toMatchObject({ ok: true, taskId: 'repair:repair:repair:b1:1:task:2:task:3:task' });
  });

  it('a build of another run never counts', () => {
    expect(selectGradedAttempt([t('b9', 'build', 'SUCCEEDED', '', 'CODING_AGENT', 'wlj_other')], completedRun)).toEqual({ ok: false, reason: 'no_completed_build' });
  });

  it('a repair whose chain does not reach the run\'s first build is ambiguous', () => {
    expect(selectGradedAttempt([t('repair:b1:1:task', 'repair:build', 'SUCCEEDED', 'missing')], completedRun)).toMatchObject({ ok: false, reason: 'ambiguous_attempt' });
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED', 'p0'), t('repair:b1:1:task', 'repair:build', 'SUCCEEDED', 'b1')], completedRun)).toMatchObject({ ok: false, reason: 'ambiguous_attempt' });
  });

  it('a run graded end to end records its run id and task', () => {
    const result = gradeInworld(rig({ artifact: passing() }));
    expect(result.verdict).toMatchObject({ verdict: 'PASS', runId: 'wlj_x', taskId: 'task:build-1' });
    expect(verdictText(result.verdict)).toContain('run_id=wlj_x\n');
  });

  it('reads psql\'s aligned-off output, header, rows and footer', () => {
    expect(parsePsqlTsv('a\tb\n1\t2\n(1 row)\n')).toEqual([{ a: '1', b: '2' }]);
    expect(parsePsqlTsv('')).toBeNull();
  });
});

describe('the verdict file is a closed record', () => {
  it('an unknown verdict is written NOT_RUN, never PASS, and every reason is in the closed list', () => {
    expect(verdictText({ verdict: 'MAYBE' })).toContain('verdict=NOT_RUN\n');
    expect(NOT_RUN_REASONS).toEqual(['pin_mismatch', 'no_completed_build', 'ambiguous_attempt', 'final_message_missing', 'integrity_mismatch', 'checker_crashed', 'evidence_unreadable', 'run_not_completed']);
  });
});

describe('the grade binds to the run\'s durable record of the kept message', () => {
  it('a kept message whose bytes are not the ones the durable record names is never graded', () => {
    // Manifest and file agree with each other; the run's own record names other bytes.
    const result = gradeInworld(rig({ artifact: passing(), diagnostics: () => [diagRow('1'.repeat(64))] }));
    expect(result).toMatchObject({ exit: 2, verdict: { verdict: 'NOT_RUN', reason: 'integrity_mismatch', recordedSha256: '1'.repeat(64) } });
  });

  it('a manifest naming another dispatch context is never graded', () => {
    expect(gradeInworld(rig({ artifact: passing(), manifest: (m) => ({ ...m, contextId: 'context:1' }) })))
      .toMatchObject({ exit: 2, verdict: { verdict: 'NOT_RUN', reason: 'integrity_mismatch' } });
  });

  it('two dispatches of the graded task naming a kept message are ambiguous; none is a missing message', () => {
    expect(gradeInworld(rig({ artifact: passing(), diagnostics: (sha) => [diagRow(sha, 'context:1'), diagRow(sha, CONTEXT)] })))
      .toMatchObject({ exit: 0, verdict: { verdict: 'NOT_RUN', reason: 'ambiguous_attempt' } });
    expect(gradeInworld(rig({ artifact: passing(), diagnostics: () => [] })))
      .toMatchObject({ exit: 3, verdict: { verdict: 'NOT_RUN', reason: 'final_message_missing' } });
    // A record for another task does not stand in for this one.
    expect(gradeInworld(rig({ artifact: passing(), diagnostics: (sha) => [diagRow(sha, CONTEXT, 'task:build-9')] })))
      .toMatchObject({ exit: 3, verdict: { reason: 'final_message_missing' } });
  });

  it('the verdict names the dispatch context it graded', () => {
    const result = gradeInworld(rig({ artifact: passing() }));
    expect(result.verdict).toMatchObject({ verdict: 'PASS', contextId: CONTEXT });
    expect(verdictText(result.verdict)).toContain(`context_id=${CONTEXT}\n`);
  });
});

describe('every pinned file is a pin on its own', () => {
  for (const name of ['contract.json', 'seed/data/legacy_ledger.csv', 'seed/data/posts.json', 'checker/check.mjs']) {
    it(`a change to ${name} alone is a pin mismatch that runs nothing`, () => {
      const paths = rig({ artifact: passing() });
      writeFileSync(join(paths.staging, name), `${readFileSync(join(paths.staging, name), 'utf8')}\n`);
      expect(gradeInworld(paths)).toMatchObject({ exit: 2, verdict: { verdict: 'NOT_RUN', reason: 'pin_mismatch' } });
      expect(existsSync(join(paths.finalMessage, `${STEM}.raw.txt`))).toBe(true);
    });
  }
});

describe('the graded chain starts at the run\'s first build', () => {
  const t = (task_id: string, task_type: string, state: string, ordinal: string, parent_task_id = '') => ({ task_id, task_type, state, parent_task_id, role: 'CODING_AGENT', run_id: 'wlj_x', ordinal });
  it('a later build that succeeded after the first build failed is not graded', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'FAILED', '2'), t('b2', 'build', 'SUCCEEDED', '3')], [{ run_id: 'wlj_x', state: 'COMPLETED' }]))
      .toMatchObject({ ok: false, reason: 'ambiguous_attempt' });
  });
  it('the first build, or its repair chain, is graded', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED', '2'), t('repair:b1:1:task', 'repair:build', 'SUCCEEDED', '3', 'b1')], [{ run_id: 'wlj_x', state: 'COMPLETED' }]))
      .toMatchObject({ ok: true, taskId: 'repair:b1:1:task' });
  });
});

describe('the paid workflow hands off, publishes and deletes the final message safely', () => {
  const workflow = readFileSync(join('.github', 'workflows', 'julius-first-live-mission.yml'), 'utf8');
  const job = (name: string): string => {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    const rest = workflow.slice(start + 1);
    const next = rest.slice(1).search(/\n {2}[a-z][a-z0-9-]*:\n/u);
    return next === -1 ? rest : rest.slice(0, next + 1);
  };

  it('the final-message directory is a fresh mktemp, never a fixed path', () => {
    expect(workflow).toContain('dir=$(mktemp -d "$RUNNER_TEMP/julius-final-message.XXXXXX")');
    expect(workflow).toContain('JULIUS_FINAL_MESSAGE_DIR: ${{ steps.final_message_dir.outputs.dir }}');
    expect(workflow).not.toContain('/tmp/julius-final-message');
  });

  it('a raw final message in the evidence removes the bundle before failing, so nothing is uploaded', () => {
    const at = workflow.indexOf("find julius-live-evidence -name '*.raw.txt'");
    expect(at).toBeGreaterThan(-1);
    expect(workflow.slice(at, at + 260)).toMatch(/rm -rf julius-live-evidence[\s\S]*exit 1/u);
  });

  it('the grade job only reads; the delete job alone may write actions, and checks out nothing', () => {
    expect(job('grade-inworld')).toMatch(/permissions:\n {6}contents: read\n {4}steps:/u);
    expect(job('grade-inworld')).not.toMatch(/^ {6}actions: write$/mu);
    expect(job('grade-inworld')).not.toMatch(/secrets\.|environment:/u);
    const remove = job('delete-final-message');
    expect(remove).toMatch(/permissions:\n {6}actions: write\n {4}steps:/u);
    expect(remove).not.toContain('actions/checkout');
    expect(remove).not.toMatch(/secrets\./u);
  });
});
