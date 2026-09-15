import { describe, expect, it } from 'vitest';

import { PAID_RUN_ARTIFACT_BYTES, paidRunArchive } from '../src/relay/mission/julius/julius-brain-archive-fixtures';
import { runArchiveExportConformance } from './julius-archive-export-conformance';

function cli(argv: readonly string[], files: Readonly<Record<string, string | Uint8Array>> = {}) {
  let out = '';
  const read = (path: string) => { const file = files[path]; if (file === undefined) throw new Error(`ENOENT: ${path}`); return file; };
  const code = runArchiveExportConformance(argv, {
    readText: (path) => { const file = read(path); return typeof file === 'string' ? file : new TextDecoder().decode(file); },
    readBytes: (path) => { const file = read(path); return typeof file === 'string' ? new TextEncoder().encode(file) : file; },
    write: (text) => { out += text; },
  });
  return { code, report: JSON.parse(out) as Record<string, any> };
}

describe('julius-archive-export-conformance CLI', () => {
  it('--self-test: the built-in fixture conforms and every case bites', () => {
    const { code, report } = cli(['--self-test']);
    expect(code).toBe(0);
    expect(report).toMatchObject({ verdict: 'CONFORMANT', contract: 'julius-paid-run-archive-export.v1', cases: { counts: { fail: 0, notApplicable: 0 } } });
  });

  it('an export file, its artifact bytes and its cases; exit codes say what happened', () => {
    const exported = JSON.stringify(paidRunArchive());
    expect(cli(['export.json', '--artifact', `art-plan=plan.bin`, '--cases'], { 'export.json': exported, 'plan.bin': PAID_RUN_ARTIFACT_BYTES.get('art-plan')! })).toMatchObject({ code: 0, report: { verdict: 'CONFORMANT', cases: { counts: { fail: 0 } } } });
    expect(cli(['export.json', '--artifact', 'art-plan=plan.bin'], { 'export.json': exported, 'plan.bin': 'forged' })).toMatchObject({ code: 1, report: { verdict: 'NOT_CONFORMANT' } });
    const altered = JSON.stringify({ ...paidRunArchive(), exportedAt: '2099-01-01T00:00:00.000Z' });
    expect(cli(['export.json', '--cases'], { 'export.json': altered })).toMatchObject({ code: 1, report: { verdict: 'NOT_CONFORMANT', cases: 'NOT RUN: the export does not conform' } });
    expect(cli(['export.json'], { 'export.json': '{"format":"julius-paid-run-archive-export.v9"}' })).toMatchObject({ code: 1, report: { verdict: 'UNSUPPORTED_VERSION' } });
    expect(cli(['missing.json']).code).toBe(2);
    expect(cli(['export.json'], { 'export.json': 'not json' }).code).toBe(2);
    expect(cli([]).code).toBe(2);
    expect(cli(['--self-test', 'export.json']).code).toBe(2);
    expect(cli(['export.json', '--artifact', 'no-equals'], { 'export.json': exported }).code).toBe(2);
  });

  it('a report never repeats a credential the export carried', () => {
    const token = ['gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'].join('');
    const body = paidRunArchive();
    const leaky = { ...body, tasks: [{ ...body.tasks[0]!, parentTaskId: token, unknown: body.tasks[0]!.unknown.filter((name) => name !== 'parentTaskId') }, ...body.tasks.slice(1)] };
    const { code, report } = cli(['export.json'], { 'export.json': JSON.stringify(leaky) });
    expect(code).toBe(1);
    expect(JSON.stringify(report)).not.toContain(token);
  });
});
