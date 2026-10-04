import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { juliusFindingTransitionFacts } from '../../src/relay/mission/julius/julius-finding-lifecycle';
import { verifyCarryCommand } from '../julius-live-mission';
import { decideJuliusCarrySource, juliusPairedContractSha256, parseJuliusCarryRunRecord } from './carry-archive';
import { parseLiveMissionContract } from './mission-contract';

/**
 * DECISION C ON DISK: the files the fetch step writes, read the way the paid
 * job reads them, and the lines the job prints about them.
 *
 * The domain's own suite (`julius-carry-archive.test.ts`) reaches every refusal
 * from one valid bundle. This one proves the Node half: the export's exact BYTES
 * are hashed (a re-serialised copy would verify a file nobody wrote), the paired
 * contract is found beside the receiving one and hashed as this checkout holds
 * it, the pairing rules hold before any bundle is judged, `verify-carry` exits
 * as the workflow needs, and every line it prints survives the evidence
 * allowlist (`scripts/julius-live-evidence.mjs`), so a bundle can say what its
 * arm learned from.
 */

const COMMIT = 'a'.repeat(40);
const WORKFLOW_RUN = '37300000001';
const RUN = 'run:c-without-1';
const PROJECT = 'prj-decision-c';
const sha256 = (bytes: string | Buffer): string => createHash('sha256').update(bytes).digest('hex');

const contract = (overrides: Record<string, unknown>) => JSON.stringify({
  missionId: 'mission:c', markerNamespace: 'julius-c', projectId: PROJECT, tenantId: 'tenant',
  objective: 'Fix the date parser.', requirements: [], constraints: [],
  acceptanceCriteria: [{ id: 'AC-1', text: 'Invalid dates are refused.', blocking: true }],
  testCommand: 'npm test', workspacePath: '/tmp/ws', ...overrides,
}, null, 2);

const recorded = (findingId: string) => ({ findingId, reviewTaskId: `${RUN}:review` });
const moved = (findingId: string, move: 'REPAIR_SUCCEEDED' | 'REVIEWER_RESOLVED', id: string) =>
  Object.fromEntries(Object.entries(juliusFindingTransitionFacts({
    findingId, move, at: '2026-10-04T10:30:00.000Z',
    ...(move === 'REPAIR_SUCCEEDED' ? { repairTaskId: id } : { reviewTaskId: id }),
  })).filter(([, value]) => value !== null));

function exportText(resolved = true): string {
  const finding = (findingId: string) => ({
    findingId, runId: RUN, taskId: `${RUN}:build`, reviewerWorkerId: 'reviewer-hermes', severity: 'HIGH', category: 'correctness',
    claim: 'parseDate accepts 2026-02-30.\tA tab, and\na line break, which is why this file is JSON.', criterionId: null,
    evidenceIds: ['evidence:review-1'], blocking: true, status: 'OPEN', createdAt: '2026-10-04T10:01:00.000Z',
  });
  const ledger = [
    { sequence: 3, type: 'finding.recorded', taskId: `${RUN}:review`, facts: recorded('f-1') },
    { sequence: 9, type: 'finding.transitioned', taskId: `${RUN}:repair-1`, facts: moved('f-1', 'REPAIR_SUCCEEDED', `${RUN}:repair-1`) },
    ...(resolved ? [{ sequence: 14, type: 'finding.transitioned', taskId: `${RUN}:review:repair-1`, facts: moved('f-1', 'REVIEWER_RESOLVED', `${RUN}:review:repair-1`) }] : []),
  ];
  // As psql writes it: json_build_object's own spacing, then a newline.
  return `${JSON.stringify({ format: 'julius-carry-export.v1', runId: RUN, projectId: PROJECT, findings: [finding('f-1')], ledger }).replace(/":/gu, '" : ')}\n`;
}

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** A checkout holding both missions of a pair, and the directory the fetch step filled. */
function fixture(edit: { resolved?: boolean; withContract?: Record<string, unknown>; tamper?: boolean; manifest?: Record<string, string> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'carry-archive-'));
  roots.push(root);
  const missions = join(root, '.github', 'julius-missions');
  const withoutPath = join(missions, 'julius-c-without-1', 'contract.json');
  const withPath = join(missions, 'julius-c-with-1', 'contract.json');
  mkdirSync(join(missions, 'julius-c-without-1'), { recursive: true });
  mkdirSync(join(missions, 'julius-c-with-1'), { recursive: true });
  writeFileSync(withoutPath, contract({ missionId: 'mission:c-without-1', carryArm: 'WITHOUT' }));
  writeFileSync(withPath, contract({ missionId: 'mission:c-with-1', carryArm: 'WITH', carryFrom: 'julius-c-without-1', ...edit.withContract }));
  const bundle = join(root, 'carry-source');
  mkdirSync(bundle);
  const text = exportText(edit.resolved ?? true);
  const fields = {
    manifest_version: '1', source: 'github-actions', commit: COMMIT, tree: 'b'.repeat(40), tracked_changes: '0', mode: 'paid',
    mode_basis: 'dispatch_confirm_live', julius_run_id: RUN, workflow_run_id: WORKFLOW_RUN, workflow_run_attempt: '1',
    workflow_ref: 'o/r/.github/workflows/julius-first-live-mission.yml@refs/heads/main', event: 'workflow_dispatch',
    ref: 'refs/heads/main', github_sha: COMMIT, mission: 'julius-c-without-1',
    contract_sha256: sha256(contract({ missionId: 'mission:c-without-1', carryArm: 'WITHOUT' })),
    produced_at: '2026-10-04T11:00:00Z', carry_export_sha256: sha256(text), ...edit.manifest,
  };
  writeFileSync(join(bundle, 'bundle-manifest.txt'), `${Object.entries(fields).map(([key, value]) => `${key}=${value}`).join('\n')}\n`);
  writeFileSync(join(bundle, 'carry-export.json'), edit.tamper ? text.replace('2026-02-30', '2026-02-31') : text);
  writeFileSync(join(bundle, 'source-run.json'), JSON.stringify({
    id: WORKFLOW_RUN, path: '.github/workflows/julius-first-live-mission.yml', event: 'workflow_dispatch', headSha: COMMIT,
    displayTitle: 'julius mission=julius-c-without-1 lane=lab mode=paid key=julius-c-without-1@aaaaaaaaaaaa#lab#a1',
    runAttempt: '1', artifactDigest: `sha256:${'d'.repeat(64)}`, archiveSha256: 'd'.repeat(64),
  }));
  return { root, withPath, withoutPath, bundle };
}

const decide = (contractPath: string, bundleDir: string | null, requireArchiveForWith = true) => {
  const parsed = parseLiveMissionContract(readFileSync(contractPath, 'utf8'));
  if (!parsed.ok) throw new Error(parsed.problem);
  return decideJuliusCarrySource({
    contractPath, contract: parsed.contract, bundleDir, workflowRunId: WORKFLOW_RUN, commit: COMMIT, requireArchiveForWith,
  });
};

/** Every line survives the same allowlist the workflow rebuilds the bundle's logs with. */
const keptByEvidence = (lines: readonly string[]): readonly string[] => execFileSync(process.execPath, ['scripts/julius-live-evidence.mjs', '-'], {
  input: `${lines.join('\n')}\n`, encoding: 'utf8',
}).split('\n').filter((line) => lines.includes(line));

describe('Decision C on disk: a WITH arm and its pair\'s bundle', () => {
  it('verifies the pair\'s bundle from the files the fetch step writes, hashing the export\'s own bytes and the pair\'s contract as this checkout holds it', () => {
    const { withPath, withoutPath, bundle } = fixture();
    const decision = decide(withPath, bundle);
    expect(decision.kind, JSON.stringify(decision.lines)).toBe('ARCHIVE');
    if (decision.kind !== 'ARCHIVE') return;
    expect(decision.verdict.origin.exportSha256).toBe(sha256(exportText()));
    expect(decision.verdict.origin.contractSha256).toBe(sha256(readFileSync(withoutPath)));
    expect(juliusPairedContractSha256(withPath, 'julius-c-without-1')).toBe(decision.verdict.origin.contractSha256);
    // The claim kept its tab and its line break: the export is read as JSON, never split as TSV.
    expect(decision.verdict.source.findings[0]!.claim).toContain('\tA tab, and\na line break');
    expect(decision.lines).toEqual([
      `  carry source: ARCHIVE mission=julius-c-without-1 julius_run=${RUN} workflow_run=${WORKFLOW_RUN} attempt=1 commit=${COMMIT}`
        + ` contract_sha256=${decision.verdict.origin.contractSha256} export_sha256=${sha256(exportText())} archive_sha256=${'d'.repeat(64)}`,
      '  carry preview: selected=1 verified_repair_findings=1 verified_findings=0 accepted_decisions=0 excluded=0 gate=CARRY_PAIR_VALID',
    ]);
    expect(keptByEvidence(decision.lines), 'the bundle can say what its arm learned from').toEqual(decision.lines);
  });

  it('a pair whose WITHOUT arm left nothing resolved is refused before anything spends, and says what it found', () => {
    const { withPath, bundle } = fixture({ resolved: false });
    const decision = decide(withPath, bundle);
    expect(decision.kind).toBe('REFUSED');
    if (decision.kind !== 'REFUSED') return;
    expect(decision.reasonCode).toBe('CARRY_SOURCE_NOT_A_VALID_PAIR');
    expect(decision.lines.at(-2)).toBe('  carry preview: selected=0 verified_repair_findings=0 verified_findings=0 accepted_decisions=0 excluded=1 gate=CARRY_EMPTY');
    expect(decision.lines.at(-1)).toBe('  carry source: REFUSED CARRY_SOURCE_NOT_A_VALID_PAIR — CARRY_EMPTY');
  });

  it('one byte of the export changed after the manifest recorded it: refused', () => {
    const { withPath, bundle } = fixture({ tamper: true });
    expect(decide(withPath, bundle)).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_EXPORT_DIGEST_MISMATCH' });
  });

  it('the pair\'s contract at this checkout is not the one the WITHOUT arm ran: refused', () => {
    const { withPath, withoutPath, bundle } = fixture();
    writeFileSync(withoutPath, contract({ missionId: 'mission:c-without-1', carryArm: 'WITHOUT', objective: 'Something else.' }));
    expect(decide(withPath, bundle)).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_CONTRACT_MISMATCH' });
  });

  it('the pair\'s contract is missing at this checkout: the job cannot state what it expects, and refuses', () => {
    const { withPath, withoutPath, bundle } = fixture();
    rmSync(withoutPath);
    expect(decide(withPath, bundle)).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_EXPECTATION_INVALID' });
  });

  it('GitHub\'s record of the run is missing or not the fetch step\'s shape: refused', () => {
    const { withPath, bundle } = fixture();
    writeFileSync(join(bundle, 'source-run.json'), JSON.stringify({ id: Number(WORKFLOW_RUN) }));
    expect(parseJuliusCarryRunRecord(Buffer.from(JSON.stringify({ id: Number(WORKFLOW_RUN) })))).toBeNull();
    expect(decide(withPath, bundle)).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_RUN_RECORD_MISSING' });
  });

  describe('the pairing, before any bundle is judged', () => {
    it('a WITHOUT arm with no bundle learns from nothing, and says so', () => {
      const { withoutPath } = fixture();
      expect(decide(withoutPath, null)).toEqual({ kind: 'NONE', lines: ['  carry source: NONE arm=WITHOUT'] });
    });

    it('a WITH arm on the paid venue with no bundle is refused: its database is fresh', () => {
      const { withPath } = fixture();
      expect(decide(withPath, null)).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_REQUIRED' });
    });

    it('a WITH arm with no bundle where none is required reads its own store', () => {
      const { withPath } = fixture();
      expect(decide(withPath, null, false)).toEqual({ kind: 'STORE', lines: ['  carry source: STORE arm=WITH'] });
    });

    it('a bundle given to an arm that does not learn is refused', () => {
      const { withoutPath, bundle } = fixture();
      expect(decide(withoutPath, bundle)).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_UNEXPECTED' });
    });

    it('a WITH arm naming no pair, or itself, is refused', () => {
      const unnamed = fixture({ withContract: { carryFrom: undefined } });
      expect(decide(unnamed.withPath, unnamed.bundle)).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_UNPAIRED' });
      const itself = fixture({ withContract: { carryFrom: 'julius-c-with-1' } });
      expect(decide(itself.withPath, itself.bundle)).toMatchObject({ kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_UNPAIRED' });
    });
  });

  describe('`verify-carry`, as the workflow runs it', () => {
    const run = (contractPath: string, bundleDir: string | null) => {
      const lines: string[] = [];
      const code = verifyCarryCommand({
        contractPath, bundleDir, workflowRunId: bundleDir === null ? null : WORKFLOW_RUN, commit: bundleDir === null ? null : COMMIT,
        out: (line) => lines.push(line),
      });
      return { code, lines };
    };

    it('exits 0 on a verified pair and 1 on a refusal, and its refusal survives the evidence allowlist', () => {
      const good = fixture();
      expect(run(good.withPath, good.bundle).code).toBe(0);
      const bad = fixture({ tamper: true });
      const refused = run(bad.withPath, bad.bundle);
      expect(refused.code).toBe(1);
      expect(refused.lines.at(-1)).toBe('RESULT: BLOCKED at carry — CARRY_SOURCE_EXPORT_DIGEST_MISMATCH: nothing was submitted and no provider was contacted.');
      expect(keptByEvidence(refused.lines)).toEqual(refused.lines);
    });

    it('exits 0 for an arm with nothing to verify, 1 for a WITH arm with no bundle, 2 for an unreadable contract', () => {
      const { withoutPath, withPath, root } = fixture();
      expect(run(withoutPath, null)).toEqual({ code: 0, lines: ['  carry source: NONE arm=WITHOUT'] });
      expect(run(withPath, null).code).toBe(1);
      expect(run(join(root, 'absent.json'), null).code).toBe(2);
    });
  });

});
