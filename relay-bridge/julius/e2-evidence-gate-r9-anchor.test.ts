import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { verifyEvidenceChain } from './cursor-run-stream-evidence';
import * as G from './e2-evidence-gate';
import { GOOD, MODEL, RUN, START, call, liveCapture, makeRepo, rechain, tail, anchorOf } from './e2-test-kit';

/* PILOT 5366ad30 R3-1: the independent anchor is enforced in code. Failing-first: on 5366ad30 a self-derived anchor passed. */
let root = ''; let repo = ''; let base = ''; let head = '';
beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'e2r9a-')));
  repo = join(root, 'repo'); mkdirSync(repo);
  ({ base, head } = makeRepo(repo, { 'a.txt': 'one\n', 'ok.mjs': 'process.exit(0)\n' }, { 'a.txt': 'two\n' }, (p, c) => writeFileSync(p, c)));
});
afterAll(() => { rmSync(root, { recursive: true, force: true }); });
const reasons = (r: ReturnType<typeof G.e2Gate>): readonly string[] => (r.ok ? [] : r.reasons);
async function parts() {
  const runner = G.spawnVerifierRunner({ timeoutMs: 30_000 });
  const verifierSpec = G.pinVerifierSpec({ testCommand: 'node ok.mjs', workspace: repo, base }) as G.E2VerifierSpec;
  return {
    verifierSpec, reexec: await G.recordVerifierReexec({ spec: verifierSpec, cwd: repo, runner }),
    diff: await G.recordGitDiff({ base, head, cwd: repo, runner }),
    binding: { runId: RUN, base, head, workspace: repo },
  };
}
const selfHash = (l: readonly string[]): string => (verifyEvidenceChain(l) as { finalHash: string }).finalHash;

describe('R3-1: only a branded external anchor counts', () => {
  it('an untouched capture with a workflow_output anchor passes', async () => {
    const { lines, evidence } = await liveCapture(root, 'ok.jsonl', GOOD());
    expect(reasons(G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', evidence.finalHash), ...await parts(), modelId: MODEL }))).toEqual([]);
    expect(reasons(G.e2Gate({ streamLines: lines, anchor: anchorOf('ledger_hash', evidence.finalHash), ...await parts(), modelId: MODEL }))).toEqual([]);
  });
  it('a bare object, a string, a copy, or a file/capture-derived anchor is e2_anchor_not_external even when the hash matches', async () => {
    const { lines, evidence } = await liveCapture(root, 'bare.jsonl', GOOD());
    const p = await parts();
    const good = anchorOf('workflow_output', evidence.finalHash);
    for (const anchor of [{ finalHash: evidence.finalHash }, evidence.finalHash, { ...good }, Object.assign(Object.create(null), good), G.anchorFromEvidenceFile(lines), G.anchorFromCapture(evidence)]) {
      expect(reasons(G.e2Gate({ streamLines: lines, anchor, ...p, modelId: MODEL } as unknown as Parameters<typeof G.e2Gate>[0]))).toEqual(['e2_anchor_not_external']);
    }
  });
  it('externalAnchor refuses a source outside the closed set', () => {
    for (const s of ['evidence_file', 'capturing_process', 'workflow', '', 'WORKFLOW_OUTPUT']) expect(() => anchorOf(s as 'workflow_output', 'a'.repeat(64))).toThrow();
    expect(G.E2_EXTERNAL_ANCHOR_SOURCES).toEqual(['workflow_output', 'ledger_hash']);
  });
  it('PILOT forgeries are refused when the only anchor available is derived from the file', async () => {
    const p = await parts();
    /* (1) an unproven (literal-ref) capture re-chained and relabelled as created by this transport, with a requested model. */
    const mid = await liveCapture(root, 'relabel.jsonl', GOOD(), { created: false });
    const relabelled = rechain(mid.lines, (r) => { if (r.kind === 'header') { r.start = 'created_by_this_transport'; r.requestedModelId = MODEL; } if (r.kind === 'final') { r.mode = 'live'; } });
    /* (2) a read_file call rewritten into edit_file. */
    const reads = await liveCapture(root, 'reads.jsonl', START + call('c1', 'read_file') + tail());
    const toEdit = rechain(reads.lines, (r) => { if (r.kind === 'event' && r.event === 'tool_call') r.data = String(r.data).replace('read_file', 'edit_file'); });
    /* (3) the header model swapped. */
    const other = await liveCapture(root, 'model.jsonl', GOOD(), { modelId: 'composer-1' });
    const swapped = rechain(other.lines, (r) => { if (r.kind === 'header') r.requestedModelId = MODEL; });
    for (const forged of [relabelled, toEdit, swapped]) {
      expect(verifyEvidenceChain(forged).ok).toBe(true);
      /* Sanity: these ARE the forgeries that passed on 5366ad30 with a self-derived plain anchor. */
      expect(reasons(G.e2Gate({ streamLines: forged, anchor: anchorOf('ledger_hash', selfHash(forged)), ...p, modelId: MODEL }))).toEqual([]);
      for (const anchor of [G.anchorFromEvidenceFile(forged), { finalHash: selfHash(forged) }]) {
        expect(reasons(G.e2Gate({ streamLines: forged, anchor, ...p, modelId: MODEL } as Parameters<typeof G.e2Gate>[0]))).toEqual(['e2_anchor_not_external']);
      }
    }
  });
  it('no anchor is e2_anchor_absent; an external anchor with an empty hash is absent; a wrong one is a mismatch', async () => {
    const { lines } = await liveCapture(root, 'abs.jsonl', GOOD());
    const p = await parts();
    for (const anchor of [null, undefined]) expect(reasons(G.e2Gate({ streamLines: lines, anchor, ...p, modelId: MODEL }))).toEqual(['e2_anchor_absent']);
    expect(reasons(G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', ''), ...p, modelId: MODEL }))).toEqual(['e2_anchor_absent']);
    expect(reasons(G.e2Gate({ streamLines: lines, anchor: anchorOf('workflow_output', 'f'.repeat(64)), ...p, modelId: MODEL }))).toEqual(['e2_anchor_mismatch']);
  });
});
