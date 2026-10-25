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

function rig(opts: { readonly artifact: string | null; readonly tasks?: string; readonly manifest?: (m: Record<string, unknown>) => Record<string, unknown> }) {
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
  writeFileSync(join(evidence, 'tasks.tsv'), opts.tasks ?? [
    'task_id\ttask_type\trole\tstate\tordinal\tparent_task_id\trun_id\tlease_generation',
    'task:plan-1\tplan\tPROMPT_ARCHITECT\tSUCCEEDED\t1\t\twlj_x\t1',
    'task:build-1\tbuild\tCODING_AGENT\tSUCCEEDED\t2\t\twlj_x\t1',
    '(2 rows)',
    '',
  ].join('\n'));
  if (opts.artifact !== null) {
    const trimmed = opts.artifact.trim();
    writeFileSync(join(finalMessage, 'task_build-1.raw.txt'), trimmed);
    const manifest = { schema: 'julius-final-message.v1', taskId: 'task:build-1', runId: 'wlj_x', rawSha256: sha256(opts.artifact), trimmedSha256: sha256(trimmed), trimmedUtf8Bytes: Buffer.byteLength(trimmed) };
    writeFileSync(join(finalMessage, 'task_build-1.manifest.json'), JSON.stringify(opts.manifest ? opts.manifest(manifest) : manifest));
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
});

describe('grading a paid J1 run with the real pinned checker', () => {
  it('PASS only on the checker\'s own PASS, and the raw text is deleted after grading', () => {
    const paths = rig({ artifact: `  ${passing()}\n` });
    const result = gradeInworld(paths);
    expect(result.exit).toBe(0);
    expect(result.verdict).toMatchObject({ verdict: 'PASS', taskId: 'task:build-1', trimmedSha256: sha256(passing()), checkerSha256: J1_PINNED_CHECKER_FILE_SHA256 });
    expect(existsSync(join(paths.finalMessage, 'task_build-1.raw.txt'))).toBe(false);
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
    expect(existsSync(join(paths.finalMessage, 'task_build-1.raw.txt'))).toBe(true);
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

describe('the graded attempt comes from the durable task rows only', () => {
  const t = (task_id: string, task_type: string, state: string, parent_task_id = '', role = 'CODING_AGENT') => ({ task_id, task_type, state, parent_task_id, role });

  it('a repaired build is superseded by its repair, and the repair is graded', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED'), t('r1', 'repair:build', 'SUCCEEDED', 'b1')]))
      .toEqual({ ok: true, taskId: 'r1', taskType: 'repair:build' });
  });

  it('two unsuperseded succeeded builds are ambiguous; the grader never picks one', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED'), t('b2', 'build', 'SUCCEEDED')]))
      .toMatchObject({ ok: false, reason: 'ambiguous_attempt' });
  });

  it('a failed repair leaves no completed build, and other roles never count', () => {
    expect(selectGradedAttempt([t('b1', 'build', 'SUCCEEDED'), t('r1', 'repair:build', 'FAILED', 'b1'), t('p1', 'plan', 'SUCCEEDED', '', 'PROMPT_ARCHITECT')]))
      .toEqual({ ok: false, reason: 'no_completed_build' });
  });

  it('reads psql\'s aligned-off output, header, rows and footer', () => {
    expect(parsePsqlTsv('a\tb\n1\t2\n(1 row)\n')).toEqual([{ a: '1', b: '2' }]);
    expect(parsePsqlTsv('')).toBeNull();
  });
});

describe('the verdict file is a closed record', () => {
  it('an unknown verdict is written NOT_RUN, never PASS, and every reason is in the closed list', () => {
    expect(verdictText({ verdict: 'MAYBE' })).toContain('verdict=NOT_RUN\n');
    expect(NOT_RUN_REASONS).toEqual(['pin_mismatch', 'no_completed_build', 'ambiguous_attempt', 'final_message_missing', 'integrity_mismatch', 'checker_crashed', 'evidence_unreadable']);
  });
});
