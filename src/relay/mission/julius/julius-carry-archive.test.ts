import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  JULIUS_CARRY_ARCHIVE_REFUSALS,
  JULIUS_CARRY_EXPORT_FORMAT,
  parseJuliusBundleManifest,
  parseJuliusCarryExport,
  verifyJuliusCarryArchive,
  type JuliusCarryArchiveExpectation,
  type JuliusCarryArchiveRefusal,
  type JuliusCarryRunRecord,
} from './julius-carry-archive';
import {
  JULIUS_CARRY_MANIFEST_LIST_CHARS,
  juliusCarryEntryId,
  juliusCarryManifestFacts,
  juliusCarryPairGate,
  selectJuliusCarry,
  type JuliusCarryArchiveOrigin,
} from './julius-carry';
import { juliusFindingTransitionFacts } from './julius-finding-lifecycle';
import type { JuliusPeerLedgerEntry } from './julius-peer-channel';

/**
 * A PAIRED ARM'S BUNDLE, JUDGED BEFORE IT TEACHES ANYTHING.
 *
 * The valid bundle below is what the paid workflow produces for a WITHOUT arm
 * whose reviewer raised three findings: one repaired and then resolved by the
 * re-review (the thing a pair exists to move), one only repaired, one left
 * open. Every refusal the verifier names is reached from it by changing ONE
 * thing, and the closing case proves the list of refusals has no member this
 * file never reaches.
 */

const COMMIT = 'a'.repeat(40);
const RUN = 'run:c-without-1';
const PROJECT = 'prj-decision-c';
const MISSION = 'julius-c-without-1';
const CONTRACT_SHA = 'c'.repeat(64);
const WORKFLOW_RUN = '37300000001';
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const finding = (findingId: string, overrides: Record<string, unknown> = {}) => ({
  findingId, runId: RUN, taskId: `${RUN}:build`, reviewerWorkerId: 'reviewer-hermes', severity: 'HIGH',
  category: 'correctness', claim: `parseDate accepts 2026-02-30 (${findingId}).`, criterionId: null,
  evidenceIds: ['evidence:review-1'], blocking: true, status: 'OPEN', createdAt: '2026-10-04T10:01:00.000Z', ...overrides,
});

let sequence = 0;
const row = (type: 'finding.recorded' | 'finding.transitioned', facts: Record<string, unknown>) => {
  sequence += 10;
  return { sequence, type, taskId: null, facts };
};

function exportDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  sequence = 0;
  const transition = (findingId: string, move: 'REPAIR_SUCCEEDED' | 'REVIEWER_RESOLVED', ids: { review?: string; repair?: string }) =>
    row('finding.transitioned', Object.fromEntries(Object.entries(juliusFindingTransitionFacts({
      findingId, move, at: '2026-10-04T10:30:00.000Z', reviewTaskId: ids.review ?? null, repairTaskId: ids.repair ?? null,
    })).filter(([, value]) => value !== null)));
  return {
    format: JULIUS_CARRY_EXPORT_FORMAT,
    runId: RUN,
    projectId: PROJECT,
    findings: [finding('f-repaired'), finding('f-addressed'), finding('f-open')],
    ledger: [
      row('finding.recorded', { findingId: 'f-repaired', reviewTaskId: `${RUN}:review`, evidenceId: 'evidence:review-1', blocking: true, category: 'correctness' }),
      row('finding.recorded', { findingId: 'f-addressed', reviewTaskId: `${RUN}:review` }),
      row('finding.recorded', { findingId: 'f-open', reviewTaskId: `${RUN}:review` }),
      transition('f-repaired', 'REPAIR_SUCCEEDED', { repair: `${RUN}:repair-1` }),
      transition('f-addressed', 'REPAIR_SUCCEEDED', { repair: `${RUN}:repair-1` }),
      transition('f-repaired', 'REVIEWER_RESOLVED', { review: `${RUN}:review:repair-1` }),
    ],
    ...overrides,
  };
}

const EXPECT: JuliusCarryArchiveExpectation = {
  workflowRunId: WORKFLOW_RUN, commit: COMMIT, projectId: PROJECT, sourceMission: MISSION, sourceContractSha256: CONTRACT_SHA,
};

interface Bundle {
  expect: JuliusCarryArchiveExpectation;
  runRecord: JuliusCarryRunRecord | null;
  manifestText: string | null;
  exportText: string | null;
  exportSha256: string | null;
}

/** A bundle as the dump and the fetch step write it. `edit` changes one thing about it. */
function bundle(edit: {
  manifest?: Record<string, string | null>;
  record?: Partial<JuliusCarryRunRecord>;
  exportDoc?: Record<string, unknown>;
  exportText?: string;
  expect?: Partial<JuliusCarryArchiveExpectation>;
  recordMissing?: boolean;
  manifestMissing?: boolean;
  exportMissing?: boolean;
  digestOf?: (text: string) => string;
} = {}): Bundle {
  const exportText = edit.exportText ?? `${JSON.stringify(edit.exportDoc ?? exportDocument())}\n`;
  const fields: Record<string, string | null> = {
    manifest_version: '1', source: 'github-actions', commit: COMMIT, tree: 'b'.repeat(40), tracked_changes: '0',
    mode: 'paid', mode_basis: 'dispatch_confirm_live', julius_run_id: RUN, workflow_run_id: WORKFLOW_RUN,
    workflow_run_attempt: '1', workflow_ref: 'owner/repo/.github/workflows/julius-first-live-mission.yml@refs/heads/main',
    event: 'workflow_dispatch', ref: 'refs/heads/main', github_sha: COMMIT, mission: MISSION, contract_sha256: CONTRACT_SHA,
    produced_at: '2026-10-04T11:00:00Z', carry_export_sha256: sha256(exportText), ...edit.manifest,
  };
  const manifestText = Object.entries(fields).filter(([, value]) => value !== null).map(([key, value]) => `${key}=${String(value)}`).join('\n');
  const archive = 'd'.repeat(64);
  return {
    expect: { ...EXPECT, ...edit.expect },
    runRecord: edit.recordMissing ? null : {
      id: WORKFLOW_RUN, path: '.github/workflows/julius-first-live-mission.yml', event: 'workflow_dispatch', headSha: COMMIT,
      displayTitle: `julius mission=${MISSION} lane=lab mode=paid key=${MISSION}@aaaaaaaaaaaa#lab#a1`, runAttempt: '1',
      artifactDigest: `sha256:${archive}`, archiveSha256: archive, ...edit.record,
    },
    manifestText: edit.manifestMissing ? null : `${manifestText}\n`,
    exportText: edit.exportMissing ? null : exportText,
    exportSha256: edit.exportMissing ? null : (edit.digestOf ?? sha256)(exportText),
  };
}

const refusalOf = (input: Bundle): JuliusCarryArchiveRefusal | 'VERIFIED' => {
  const verdict = verifyJuliusCarryArchive(input);
  return verdict.ok ? 'VERIFIED' : verdict.reasonCode;
};

describe('a paired arm\'s bundle, verified', () => {
  it('the bundle the paid workflow writes verifies, and its source selects the repaired, resolved finding and refuses the rest by name', () => {
    const verdict = verifyJuliusCarryArchive(bundle());
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.origin).toEqual({
      kind: 'ARCHIVE', sourceRunId: RUN, sourceProjectId: PROJECT, sourceMission: MISSION, workflowRunId: WORKFLOW_RUN,
      workflowRunAttempt: '1', commit: COMMIT, contractSha256: CONTRACT_SHA,
      exportSha256: sha256(`${JSON.stringify(exportDocument())}\n`), archiveSha256: 'd'.repeat(64),
    });
    const selection = selectJuliusCarry({ targetRunId: 'run:c-with-1', sources: [verdict.source], claims: [] });
    expect(selection.selected.map((item) => item.entryId)).toEqual([juliusCarryEntryId(RUN, 'finding:f-repaired')]);
    expect(selection.counts.VERIFIED_REPAIR_FINDING).toBe(1);
    expect(selection.excluded.map((item) => `${item.reasonCode}:${item.sourceRef}`).sort())
      .toEqual(['FINDING_ADDRESSED_NOT_VERIFIED:finding:f-addressed', 'FINDING_UNRESOLVED:finding:f-open']);
    expect(juliusCarryPairGate('WITH', selection)).toEqual({ valid: true, reasonCode: 'CARRY_PAIR_VALID' });
    // The copy keeps its whole provenance, as from a store.
    expect(selection.selected[0]!.text).toContain(`Source: run ${RUN}, about task ${RUN}:build; raised by review ${RUN}:review, repaired by ${RUN}:repair-1; resolved by review ${RUN}:review:repair-1.`);
  });

  it('accepts GitHub\'s REAL record of a paid run: the path, event, title and artifact digest shapes of paid run 37222057584', () => {
    // As the API answered on 2026-10-04 for M2's paid run (get workflow run; list run artifacts), with the
    // fetch step's own projection applied (`.id|tostring`, `.run_attempt|tostring`, the artifact `digest`).
    const real = bundle({
      record: {
        path: '.github/workflows/julius-first-live-mission.yml',
        event: 'workflow_dispatch',
        displayTitle: 'julius mission=julius-live-mission-2 lane=regression mode=paid key=julius-live-mission-2@0a2b4d162a09#regression#a7',
        artifactDigest: 'sha256:23499c7cdc01fa787c81f0941332a617c91e31878c9ad17a0623127daa245896',
        archiveSha256: '23499c7cdc01fa787c81f0941332a617c91e31878c9ad17a0623127daa245896',
      },
      manifest: { mission: 'julius-live-mission-2' },
      expect: { sourceMission: 'julius-live-mission-2' },
    });
    expect(refusalOf(real)).toBe('VERIFIED');
  });

  it('a WITHOUT arm whose findings were never resolved verifies, and is still no pair: nothing it holds may be inherited', () => {
    const doc = exportDocument();
    const verdict = verifyJuliusCarryArchive(bundle({ exportDoc: { ...doc, ledger: (doc.ledger as unknown[]).slice(0, 5) } }));
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const selection = selectJuliusCarry({ targetRunId: 'run:c-with-1', sources: [verdict.source], claims: [] });
    expect(juliusCarryPairGate('WITH', selection)).toEqual({ valid: false, reasonCode: 'CARRY_EMPTY' });
  });

  // ONE CHANGE, ONE REFUSAL. Each row is a way the bundle could be the wrong one.
  const CASES: ReadonlyArray<[string, Bundle, JuliusCarryArchiveRefusal]> = [
    ['the receiving job could not state its own commit', bundle({ expect: { commit: 'HEAD' } }), 'CARRY_SOURCE_EXPECTATION_INVALID'],
    ['the paired contract could not be read at this checkout', bundle({ expect: { sourceContractSha256: '' } }), 'CARRY_SOURCE_EXPECTATION_INVALID'],
    ['the source run number is not a number', bundle({ expect: { workflowRunId: '37x' } }), 'CARRY_SOURCE_EXPECTATION_INVALID'],
    ['GitHub was never asked', bundle({ recordMissing: true }), 'CARRY_SOURCE_RUN_RECORD_MISSING'],
    ['GitHub answered for another run', bundle({ record: { id: '37300000002' } }), 'CARRY_SOURCE_RUN_RECORD_MISMATCH'],
    ['another workflow wrote it', bundle({ record: { path: '.github/workflows/julius-real-infra.yml' } }), 'CARRY_SOURCE_NOT_THE_PAID_WORKFLOW'],
    ['a push started it', bundle({ record: { event: 'push' } }), 'CARRY_SOURCE_NOT_DISPATCHED'],
    ['its title is not the paid workflow\'s', bundle({ record: { displayTitle: 'julius mission=julius-c-without-1 mode=paid' } }), 'CARRY_SOURCE_RUN_RECORD_MISMATCH'],
    ['it was a preflight', bundle({ record: { displayTitle: `julius mission=${MISSION} lane=lab mode=preflight key=none` } }), 'CARRY_SOURCE_NOT_PAID'],
    ['it ran another mission', bundle({ record: { displayTitle: 'julius mission=julius-c-without-2 lane=lab mode=paid key=none' } }), 'CARRY_SOURCE_MISSION_MISMATCH'],
    ['the archive is not the one GitHub recorded', bundle({ record: { artifactDigest: `sha256:${'e'.repeat(64)}` } }), 'CARRY_SOURCE_ARCHIVE_DIGEST_MISMATCH'],
    ['GitHub recorded no digest', bundle({ record: { artifactDigest: '' } }), 'CARRY_SOURCE_ARCHIVE_DIGEST_MISMATCH'],
    ['the bundle has no manifest', bundle({ manifestMissing: true }), 'CARRY_SOURCE_MANIFEST_MISSING'],
    ['the manifest is another version', bundle({ manifest: { manifest_version: '2' } }), 'CARRY_SOURCE_MANIFEST_UNREADABLE'],
    ['the manifest says preflight', bundle({ manifest: { mode: 'preflight' } }), 'CARRY_SOURCE_NOT_PAID'],
    ['the manifest was written by another run', bundle({ manifest: { workflow_run_id: '1' } }), 'CARRY_SOURCE_RUN_RECORD_MISMATCH'],
    ['the manifest was written by another attempt', bundle({ manifest: { workflow_run_attempt: '2' } }), 'CARRY_SOURCE_RUN_RECORD_MISMATCH'],
    ['the manifest names a commit GitHub did not run', bundle({ manifest: { commit: 'f'.repeat(40) } }), 'CARRY_SOURCE_RUN_RECORD_MISMATCH'],
    ['the source arm ran other code (main moved: the freeze was broken)',
      bundle({ manifest: { commit: 'f'.repeat(40) }, record: { headSha: 'f'.repeat(40) } }), 'CARRY_SOURCE_COMMIT_MISMATCH'],
    ['the source checkout was edited', bundle({ manifest: { tracked_changes: '3' } }), 'CARRY_SOURCE_DIRTY'],
    ['the source checkout could not be counted', bundle({ manifest: { tracked_changes: 'unknown' } }), 'CARRY_SOURCE_DIRTY'],
    ['the manifest names another mission', bundle({ manifest: { mission: 'julius-c-without-2' } }), 'CARRY_SOURCE_MISSION_MISMATCH'],
    ['the manifest predates the mission line', bundle({ manifest: { mission: null } }), 'CARRY_SOURCE_MISSION_MISMATCH'],
    ['the source ran another contract', bundle({ manifest: { contract_sha256: 'e'.repeat(64) } }), 'CARRY_SOURCE_CONTRACT_MISMATCH'],
    ['the manifest names no run', bundle({ manifest: { julius_run_id: 'none' } }), 'CARRY_SOURCE_RUN_UNNAMED'],
    ['the bundle has no export', bundle({ exportMissing: true }), 'CARRY_SOURCE_EXPORT_MISSING'],
    ['the manifest never recorded the export', bundle({ manifest: { carry_export_sha256: null } }), 'CARRY_SOURCE_EXPORT_DIGEST_MISMATCH'],
    ['the export\'s bytes changed after the manifest recorded them', bundle({ digestOf: () => 'e'.repeat(64) }), 'CARRY_SOURCE_EXPORT_DIGEST_MISMATCH'],
    ['the export is a placeholder', bundle({ exportText: 'unavailable\n' }), 'CARRY_SOURCE_EXPORT_MALFORMED'],
    ['the export names no run', bundle({ exportDoc: exportDocument({ runId: null }) }), 'CARRY_SOURCE_EXPORT_MALFORMED'],
    ['the export is about another run', bundle({ exportDoc: exportDocument({ runId: 'run:c-without-2' }) }), 'CARRY_SOURCE_EXPORT_RUN_MISMATCH'],
    ['a finding of another run rides along',
      bundle({ exportDoc: exportDocument({ findings: [finding('f-repaired'), finding('f-stray', { runId: 'run:elsewhere' })] }) }), 'CARRY_SOURCE_EXPORT_RUN_MISMATCH'],
    ['the source run is another project\'s', bundle({ exportDoc: exportDocument({ projectId: 'prj-elsewhere' }) }), 'CARRY_SOURCE_PROJECT_MISMATCH'],
  ];

  it.each(CASES)('refuses when %s', (_why, input, code) => {
    expect(refusalOf(input)).toBe(code);
  });

  it('every refusal the verifier can name is reached above: the list has no unproven member', () => {
    const reached = new Set(CASES.map(([, , code]) => code));
    expect(JULIUS_CARRY_ARCHIVE_REFUSALS.filter((code) => !reached.has(code))).toEqual([]);
  });

  it('a refusal says what was wrong without quoting the export', () => {
    const verdict = verifyJuliusCarryArchive(bundle({ exportDoc: exportDocument({ projectId: 'prj-elsewhere' }) }));
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.detail).toBe(`the source run is project prj-elsewhere, this mission ${PROJECT}`);
    expect(verdict.detail).not.toContain('parseDate');
  });
});

describe('the export, read strictly', () => {
  const parse = (doc: Record<string, unknown>) => parseJuliusCarryExport(JSON.stringify(doc));
  const detailOf = (doc: Record<string, unknown>): string => {
    const parsed = parse(doc);
    return parsed.ok ? 'PARSED' : parsed.detail;
  };

  it('keeps the ledger in the order it was written and every fact as a scalar', () => {
    const parsed = parse(exportDocument());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ledger.map((entry) => `${entry.type}:${String(entry.facts.findingId)}`)).toEqual([
      'finding.recorded:f-repaired', 'finding.recorded:f-addressed', 'finding.recorded:f-open',
      'finding.transitioned:f-repaired', 'finding.transitioned:f-addressed', 'finding.transitioned:f-repaired',
    ]);
    expect(parsed.value.ledger[0]!.facts).toEqual({ findingId: 'f-repaired', reviewTaskId: `${RUN}:review`, evidenceId: 'evidence:review-1', blocking: true, category: 'correctness' });
  });

  it.each<[string, Record<string, unknown>, RegExp]>([
    ['an unknown top-level field', exportDocument({ extra: 1 }), /exactly format, runId, projectId, findings and ledger/u],
    ['another format', exportDocument({ format: 'julius-carry-export.v0' }), /is not julius-carry-export\.v1/u],
    ['a finding with a field too many', exportDocument({ findings: [{ ...finding('f-1'), trust: 'VERIFIED' }] }), /exactly the finding fields/u],
    ['a finding with a field too few', exportDocument({ findings: [Object.fromEntries(Object.entries(finding('f-1')).filter(([key]) => key !== 'reviewerWorkerId'))] }), /exactly the finding fields/u],
    ['an unknown severity', exportDocument({ findings: [finding('f-1', { severity: 'URGENT' })] }), /severity is not a severity/u],
    ['an unknown status', exportDocument({ findings: [finding('f-1', { status: 'ADDRESSED' })] }), /status is not a finding status/u],
    ['an empty claim', exportDocument({ findings: [finding('f-1', { claim: '' })] }), /claim is empty/u],
    ['a claim past the bound', exportDocument({ findings: [finding('f-1', { claim: 'x'.repeat(20_001) })] }), /claim is empty or longer/u],
    ['an instant that is not one', exportDocument({ findings: [finding('f-1', { createdAt: '2026-10-04 10:01:00' })] }), /createdAt is not an ISO instant/u],
    ['evidence that is not a list of ids', exportDocument({ findings: [finding('f-1', { evidenceIds: 'evidence:1' })] }), /evidenceIds is not a list/u],
    ['an identifier with a space', exportDocument({ findings: [finding('f 1')] }), /findingId is not an identifier/u],
    ['the same finding twice', exportDocument({ findings: [finding('f-1'), finding('f-1')] }), /repeats f-1/u],
    ['ledger rows out of order', exportDocument({ ledger: [{ sequence: 5, type: 'finding.recorded', taskId: null, facts: {} }, { sequence: 5, type: 'finding.recorded', taskId: null, facts: {} }] }), /ledger order/u],
    ['a ledger row of another kind', exportDocument({ ledger: [{ sequence: 1, type: 'review.verdict.declared', taskId: null, facts: {} }] }), /not a finding ledger type/u],
    ['a fact that is not a scalar', exportDocument({ ledger: [{ sequence: 1, type: 'finding.recorded', taskId: null, facts: { findingId: { nested: true } } }] }), /is not a scalar/u],
    ['a payload smuggled in whole', exportDocument({ ledger: [{ sequence: 1, type: 'finding.recorded', taskId: null, facts: {}, payload: {} }] }), /exactly sequence, type, taskId and facts/u],
    ['too many findings', exportDocument({ findings: Array.from({ length: 501 }, (_, index) => finding(`f-${String(index)}`)) }), /at most 500/u],
  ])('refuses %s', (_why, doc, detail) => {
    expect(detailOf(doc)).toMatch(detail);
  });

  it('refuses what is not JSON at all', () => {
    expect(parseJuliusCarryExport('{"format":')).toEqual({ ok: false, detail: 'the export is not JSON' });
  });
});

describe('the manifest, as the dump writes it', () => {
  it('reads key=value lines, keeps a repeated key\'s FIRST value, and ignores what is not a line of that shape', () => {
    const manifest = parseJuliusBundleManifest('manifest_version=1\r\nmode=paid\nmode=preflight\njunk line\n=x\ncarry_export_sha256=abc\n');
    expect(manifest).toEqual({ manifest_version: '1', mode: 'paid', carry_export_sha256: 'abc' });
  });

  it('a repeated key keeps the value the dump wrote first, so a second digest line appended later changes nothing', () => {
    const input = bundle();
    const forged = { ...input, manifestText: `${input.manifestText!}carry_export_sha256=${'e'.repeat(64)}\n` };
    expect(refusalOf(forged)).toBe('VERIFIED');
  });
});

describe('the WITH arm\'s manifest names the bundle it learned from', () => {
  const origin: JuliusCarryArchiveOrigin = {
    kind: 'ARCHIVE', sourceRunId: RUN, sourceProjectId: PROJECT, sourceMission: MISSION, workflowRunId: WORKFLOW_RUN,
    workflowRunAttempt: '1', commit: COMMIT, contractSha256: CONTRACT_SHA, exportSha256: 'e'.repeat(64), archiveSha256: 'd'.repeat(64),
  };

  it('as scalar facts, and a store carry says STORE', () => {
    const selection = selectJuliusCarry({ targetRunId: 'run:c-with-1', sources: [], claims: [] });
    expect(juliusCarryManifestFacts({ arm: 'WITH', selection, written: 0, origin })).toMatchObject({
      origin: 'ARCHIVE', sourceRunId: RUN, sourceProjectId: PROJECT, sourceMission: MISSION, sourceWorkflowRunId: WORKFLOW_RUN,
      sourceWorkflowRunAttempt: '1', sourceCommit: COMMIT, sourceContractSha256: CONTRACT_SHA,
      sourceExportSha256: 'e'.repeat(64), sourceArchiveSha256: 'd'.repeat(64),
    });
    expect(juliusCarryManifestFacts({ arm: null, selection, written: 0 })).toMatchObject({ origin: 'STORE' });
    expect(juliusCarryManifestFacts({ arm: null, selection, written: 0 })).not.toHaveProperty('sourceRunId');
  });

  it('fits the ledger\'s 8 KiB fact budget at its worst: both lists at their bound, every code, and the longest origin', () => {
    const long = (prefix: string): string => `${prefix}-${'x'.repeat(300)}`;
    const ids = Array.from({ length: 400 }, (_, index) => `f-${String(index).padStart(3, '0')}-${'y'.repeat(20)}`);
    // Twenty repaired and resolved (twelve selected, eight past the limit), the rest left open.
    const ledger: JuliusPeerLedgerEntry[] = ids.slice(0, 20).flatMap((findingId): JuliusPeerLedgerEntry[] => [
      { type: 'finding.recorded', taskId: null, facts: { findingId, reviewTaskId: 'review' } },
      { type: 'finding.transitioned', taskId: null, facts: { findingId, move: 'REPAIR_SUCCEEDED', repairTaskId: 'repair-1' } },
      { type: 'finding.transitioned', taskId: null, facts: { findingId, move: 'REVIEWER_RESOLVED', reviewTaskId: 'review:repair-1' } },
    ]);
    const selection = selectJuliusCarry({
      targetRunId: 'run:c-with-1',
      sources: [{ runId: long('run'), findings: ids.map((findingId) => finding(findingId, { runId: long('run') })) as never, ledger }],
      claims: [],
    });
    expect(selection.selected.length).toBe(12);
    expect(selection.excluded.length).toBe(388);
    const facts = juliusCarryManifestFacts({
      arm: 'WITH', selection, written: 0,
      origin: { ...origin, sourceRunId: long('run'), sourceProjectId: long('prj'), sourceMission: 'm'.repeat(64) },
    });
    expect(facts.excludedRefsTruncated).toBe(true);
    expect(facts.selectedEntryIdsTruncated).toBe(true);
    expect(String(facts.excludedRefs).length).toBeLessThanOrEqual(JULIUS_CARRY_MANIFEST_LIST_CHARS);
    expect(String(facts.selectedEntryIds).length).toBeLessThanOrEqual(JULIUS_CARRY_MANIFEST_LIST_CHARS);
    expect(JSON.stringify(facts).length).toBeLessThan(8_192);
  });
});
