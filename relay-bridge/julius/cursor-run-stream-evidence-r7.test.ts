import { mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { E2_STREAM_CAUSE_DETAIL, E2_STREAM_CAUSES, createFileEvidenceSink, readEvidenceLines } from './cursor-run-stream-evidence';

/* PILOT 43b93a4e N-4 (one fd for the sink) and Skywalker 43b93a4e L-resume (the resume refusal explains itself), failing-first. */
let dir = '';
beforeAll(() => { dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2r7-'))); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

describe('PILOT N-4: the file sink writes through one open fd', () => {
  it('a regular file swapped in at the path after the first line is never written to and the append fails (the open fd pins the inode, so no reuse)', async () => {
    for (let i = 0; i < 10; i += 1) {
      const p = join(dir, `s${i}.jsonl`);
      const sink = createFileEvidenceSink(p);
      await sink.append('one');
      unlinkSync(p);
      writeFileSync(p, 'attacker\n');
      await expect(sink.append('two')).rejects.toThrow('e2_evidence_file_swapped');
      await sink.close?.();
      expect(readFileSync(p, 'utf8')).toBe('attacker\n');
    }
  });
  it('lines written through the one fd read back in order; close is idempotent; append after close fails', async () => {
    const p = join(dir, 'ok.jsonl');
    const sink = createFileEvidenceSink(p);
    for (const l of ['a', 'b', 'c']) await sink.append(l);
    await sink.close?.();
    await sink.close?.();
    expect(await readEvidenceLines(p)).toEqual(['a', 'b', 'c']);
    await expect(sink.append('d')).rejects.toThrow();
  });
});

describe('Skywalker L: a resumed stream stays fail-closed, and says why', () => {
  it('every cause has a plain explanation, and the resume one names the reason', () => {
    for (const c of E2_STREAM_CAUSES) expect(typeof E2_STREAM_CAUSE_DETAIL[c], c).toBe('string');
    expect(E2_STREAM_CAUSE_DETAIL.e2_stream_resumed).toMatch(/opaque/u);
    expect(E2_STREAM_CAUSE_DETAIL.e2_stream_resumed).toMatch(/not a failure of the run/u);
  });
});
