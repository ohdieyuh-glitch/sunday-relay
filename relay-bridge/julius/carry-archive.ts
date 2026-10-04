import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  JULIUS_CARRY_EXPORT_FILE,
  JULIUS_CARRY_MANIFEST_FILE,
  JULIUS_CARRY_RUN_RECORD_FILE,
  JULIUS_MISSION_NAME,
  verifyJuliusCarryArchive,
  type JuliusCarryArchiveVerdict,
  type JuliusCarryRunRecord,
} from '../../src/relay/mission/julius/julius-carry-archive';
import {
  juliusCarryPairGate, selectJuliusCarry,
  type JuliusCarryArm, type JuliusCarryPairGate, type JuliusCarrySelection,
} from '../../src/relay/mission/julius/julius-carry';

/**
 * READ A PAIRED ARM'S BUNDLE FROM DISK AND HAND IT TO THE VERIFIER.
 *
 * The fetch step wrote three files into one directory: the source bundle's
 * `bundle-manifest.txt` and `carry-export.json`, and `source-run.json`, which is
 * GitHub's own record of the source run and of the archive downloaded from it.
 * This reads them (bounded), hashes the export's exact bytes, works out what
 * the receiving job knows for itself — its paired mission's contract digest at
 * this checkout — and returns the domain's verdict. It decides nothing itself.
 */

/** No honest bundle file comes near this; a larger one is refused rather than read. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

const readBounded = (path: string): Buffer | null => {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) return null;
    return readFileSync(path);
  } catch {
    return null;
  }
};

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** `source-run.json` as the fetch step writes it, every field a string, or null when it is not that. */
export function parseJuliusCarryRunRecord(bytes: Buffer | null): JuliusCarryRunRecord | null {
  if (bytes === null) return null;
  let value: unknown;
  try { value = JSON.parse(bytes.toString('utf8')); } catch { return null; }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const fields = ['id', 'path', 'event', 'headSha', 'displayTitle', 'runAttempt', 'artifactDigest', 'archiveSha256'] as const;
  if (fields.some((field) => typeof record[field] !== 'string')) return null;
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, record[field] as string])) as unknown as JuliusCarryRunRecord);
}

/**
 * The paired mission's contract, as THIS checkout holds it. Missions live side
 * by side under `.github/julius-missions/<name>/contract.json`, so the pair's
 * contract is found beside the receiving contract's own directory.
 */
export function juliusPairedContractSha256(receivingContractPath: string, sourceMission: string): string | null {
  if (!JULIUS_MISSION_NAME.test(sourceMission)) return null;
  const bytes = readBounded(join(dirname(dirname(receivingContractPath)), sourceMission, 'contract.json'));
  return bytes === null ? null : sha256(bytes);
}

export function readJuliusCarryArchive(input: {
  readonly bundleDir: string;
  readonly receivingContractPath: string;
  readonly workflowRunId: string;
  readonly commit: string;
  readonly projectId: string;
  readonly sourceMission: string;
}): JuliusCarryArchiveVerdict {
  const exportBytes = readBounded(join(input.bundleDir, JULIUS_CARRY_EXPORT_FILE));
  const manifestBytes = readBounded(join(input.bundleDir, JULIUS_CARRY_MANIFEST_FILE));
  return verifyJuliusCarryArchive({
    expect: {
      workflowRunId: input.workflowRunId,
      commit: input.commit,
      projectId: input.projectId,
      sourceMission: input.sourceMission,
      sourceContractSha256: juliusPairedContractSha256(input.receivingContractPath, input.sourceMission) ?? '',
    },
    runRecord: parseJuliusCarryRunRecord(readBounded(join(input.bundleDir, JULIUS_CARRY_RUN_RECORD_FILE))),
    manifestText: manifestBytes === null ? null : manifestBytes.toString('utf8'),
    exportText: exportBytes === null ? null : exportBytes.toString('utf8'),
    exportSha256: exportBytes === null ? null : sha256(exportBytes),
  });
}

/**
 * WHAT THE BOOTSTRAP WILL SELECT FROM THIS SOURCE, said before anything spends.
 * The same pure selection and the same pair gate the bootstrap applies; the
 * receiving run does not exist yet, so no source can be it.
 */
export function previewJuliusCarry(arm: JuliusCarryArm | null, verdict: JuliusCarryArchiveVerdict & { readonly ok: true }):
  { readonly selection: JuliusCarrySelection; readonly gate: JuliusCarryPairGate } {
  const selection = selectJuliusCarry({ targetRunId: '', sources: [verdict.source], claims: [] });
  return { selection, gate: juliusCarryPairGate(arm, selection) };
}

/** The lines `verify-carry` and `run` print, in the closed grammar the evidence allowlist keeps. */
export function juliusCarrySourceLines(verdict: JuliusCarryArchiveVerdict, preview: ReturnType<typeof previewJuliusCarry> | null): readonly string[] {
  if (!verdict.ok) return [`  carry source: REFUSED ${verdict.reasonCode} — ${verdict.detail}`];
  const origin = verdict.origin;
  const lines = [
    `  carry source: ARCHIVE mission=${origin.sourceMission} julius_run=${origin.sourceRunId} workflow_run=${origin.workflowRunId}`
      + ` attempt=${origin.workflowRunAttempt} commit=${origin.commit} contract_sha256=${origin.contractSha256}`
      + ` export_sha256=${origin.exportSha256} archive_sha256=${origin.archiveSha256}`,
  ];
  if (preview !== null) {
    const { selection, gate } = preview;
    lines.push(`  carry preview: selected=${String(selection.selected.length)} verified_repair_findings=${String(selection.counts.VERIFIED_REPAIR_FINDING)}`
      + ` verified_findings=${String(selection.counts.VERIFIED_FINDING)} accepted_decisions=${String(selection.counts.ACCEPTED_DECISION)}`
      + ` excluded=${String(selection.excluded.length)} gate=${gate.reasonCode}`);
  }
  return lines;
}

/** Refusals that belong to the pairing itself, before any bundle is judged. */
export type JuliusCarryPairingRefusal =
  | 'CARRY_SOURCE_REQUIRED'
  | 'CARRY_SOURCE_UNEXPECTED'
  | 'CARRY_SOURCE_UNPAIRED'
  | 'CARRY_SOURCE_NOT_A_VALID_PAIR';

export type JuliusCarrySourceDecision =
  | { readonly kind: 'NONE'; readonly lines: readonly string[] }
  | { readonly kind: 'STORE'; readonly lines: readonly string[] }
  | { readonly kind: 'ARCHIVE'; readonly verdict: JuliusCarryArchiveVerdict & { readonly ok: true }; readonly lines: readonly string[] }
  | { readonly kind: 'REFUSED'; readonly reasonCode: string; readonly detail: string; readonly lines: readonly string[] };

/**
 * WHERE THIS MISSION'S CARRY COMES FROM, decided before anything exists.
 *
 *   NONE     not a WITH arm, and no bundle given: nothing to learn from.
 *   STORE    a WITH arm with no bundle, where a bundle is not required: the
 *            bootstrap reads this database, as on a long-lived store.
 *   ARCHIVE  a WITH arm with its pair's bundle, verified, and a selection from
 *            it the pair gate accepts.
 *   REFUSED  anything else, by code: a bundle given to an arm that does not
 *            learn, a WITH arm naming no pair or itself, a bundle that is not
 *            its pair's, or a pair whose WITHOUT arm left nothing a WITH arm may
 *            inherit (`CARRY_SOURCE_NOT_A_VALID_PAIR`).
 *
 * `requireArchiveForWith` is the paid venue's rule: its database is fresh, so a
 * WITH arm there has nothing to learn from but its pair's bundle, and saying so
 * in the preflight costs nothing where finding it out at bootstrap costs an
 * attempt.
 */
export function decideJuliusCarrySource(input: {
  readonly contractPath: string;
  readonly contract: { readonly projectId: string; readonly carryArm?: JuliusCarryArm; readonly carryFrom?: string };
  readonly bundleDir: string | null;
  readonly workflowRunId: string | null;
  readonly commit: string | null;
  readonly requireArchiveForWith: boolean;
}): JuliusCarrySourceDecision {
  const arm = input.contract.carryArm ?? null;
  const refused = (reasonCode: string, detail: string): JuliusCarrySourceDecision =>
    ({ kind: 'REFUSED', reasonCode, detail, lines: [`  carry source: REFUSED ${reasonCode} — ${detail}`] });
  if (input.bundleDir === null) {
    if (arm !== 'WITH') return { kind: 'NONE', lines: [`  carry source: NONE arm=${arm ?? 'none'}`] };
    if (input.requireArchiveForWith) {
      return refused('CARRY_SOURCE_REQUIRED', 'this WITH arm runs on a fresh database, where the only thing it can learn from is its paired WITHOUT arm\'s bundle, and none was given');
    }
    return { kind: 'STORE', lines: ['  carry source: STORE arm=WITH'] };
  }
  if (arm !== 'WITH') return refused('CARRY_SOURCE_UNEXPECTED', `a bundle was given to a mission whose arm is ${arm ?? 'none'}; only a WITH arm learns from its pair`);
  const own = dirname(input.contractPath).split(/[\\/]/u).pop() ?? '';
  if (input.contract.carryFrom === undefined) return refused('CARRY_SOURCE_UNPAIRED', 'this WITH arm\'s contract names no paired WITHOUT mission (carryFrom)');
  if (input.contract.carryFrom === own) return refused('CARRY_SOURCE_UNPAIRED', 'this WITH arm names itself as its pair');
  const verdict = readJuliusCarryArchive({
    bundleDir: input.bundleDir,
    receivingContractPath: input.contractPath,
    workflowRunId: input.workflowRunId ?? '',
    commit: input.commit ?? '',
    projectId: input.contract.projectId,
    sourceMission: input.contract.carryFrom,
  });
  if (!verdict.ok) return { kind: 'REFUSED', reasonCode: verdict.reasonCode, detail: verdict.detail, lines: juliusCarrySourceLines(verdict, null) };
  const preview = previewJuliusCarry('WITH', verdict);
  const lines = juliusCarrySourceLines(verdict, preview);
  if (!preview.gate.valid) {
    return {
      kind: 'REFUSED', reasonCode: 'CARRY_SOURCE_NOT_A_VALID_PAIR',
      detail: `the paired WITHOUT arm's bundle holds nothing a WITH arm may inherit as a verified repair finding (${preview.gate.reasonCode})`,
      lines: [...lines, `  carry source: REFUSED CARRY_SOURCE_NOT_A_VALID_PAIR — ${preview.gate.reasonCode}`],
    };
  }
  return { kind: 'ARCHIVE', verdict, lines };
}
