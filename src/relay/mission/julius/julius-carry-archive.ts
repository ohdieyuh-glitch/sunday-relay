import type { JuliusCarryArchiveOrigin, JuliusCarrySourceRun } from './julius-carry';
import type { JuliusPeerLedgerEntry } from './julius-peer-channel';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * A CARRY THAT CROSSES DATABASES: DECISION C ON THE PAID VENUE.
 *
 * THE GAP THIS CLOSES. Every paid mission job gets a FRESH PostgreSQL, destroyed
 * with the runner. The corrected carry (`julius-carry.v2`) reads its sources
 * from the store the receiving run lives in, so a paid WITH arm found nothing of
 * its pair there, and its pair gate refused it as CARRY_EMPTY every time. As
 * built, Decision C could not run on the only venue that runs paid missions.
 *
 * WHAT CROSSES. The WITHOUT arm's evidence bundle already outlives its database
 * (90 days). It now also carries `carry-export.json`: the reviewer findings of
 * the one run its manifest names, and the `finding.*` ledger rows that give them
 * their lives, under named fact keys only (`.github/julius-carry-export.sql`).
 * The WITH arm's job downloads that bundle by its workflow run id, with its own
 * read-only token, before anything can spend. This module decides whether it is
 * the bundle it claims to be.
 *
 * WHAT IT MUST BE, all of it, or the WITH arm is refused before a run exists:
 *   - GITHUB'S RECORD of the source run (`source-run.json`, written by the fetch
 *     step from the API, never from the bundle): this repository's paid mission
 *     workflow, dispatched by hand, titled `mode=paid` for the paired mission, at
 *     the commit the bundle names, and the archive downloaded is the one whose
 *     digest GitHub recorded.
 *   - THE BUNDLE'S MANIFEST: version 1, `mode=paid`, a clean checkout, the SAME
 *     commit as the receiving job (the C freeze: four arms, one code), the paired
 *     mission and the digest of that mission's contract file at this checkout,
 *     and the one Julius run the bundle is about.
 *   - THE EXPORT: its sha256 is the one the manifest recorded when it was
 *     written, it names that same run and this mission's project, every finding
 *     in it is that run's, and its ledger rows stand in ledger order.
 *
 * WHAT IT DOES NOT DO. It decides nothing about what to carry. The verified
 * export becomes ONE `JuliusCarrySourceRun`, and `selectJuliusCarry` judges its
 * findings exactly as it judges a store's: the same lives, the same exclusions,
 * the same pair gate. The archive is a transport, never a second policy.
 *
 * PURE. No clock, no file system, no hashing: the caller reads the files,
 * computes the digests and passes them in.
 */

export const JULIUS_CARRY_EXPORT_FORMAT = 'julius-carry-export.v1' as const;
export const JULIUS_CARRY_EXPORT_FILE = 'carry-export.json' as const;
export const JULIUS_CARRY_MANIFEST_FILE = 'bundle-manifest.txt' as const;
export const JULIUS_CARRY_RUN_RECORD_FILE = 'source-run.json' as const;

/** The one workflow that runs paid missions. A bundle from any other workflow is not a paid arm's. */
export const JULIUS_PAID_MISSION_WORKFLOW = '.github/workflows/julius-first-live-mission.yml' as const;

/** One run's findings, not an archive's. Past these, the export is refused, never truncated. */
export const JULIUS_CARRY_EXPORT_MAX_FINDINGS = 500;
export const JULIUS_CARRY_EXPORT_MAX_LEDGER_ROWS = 5_000;
export const JULIUS_CARRY_EXPORT_MAX_CLAIM_CHARS = 20_000;

/** A mission directory under `.github/julius-missions/`. */
export const JULIUS_MISSION_NAME = /^[a-z][a-z0-9-]{1,63}$/u;

export const JULIUS_CARRY_ARCHIVE_REFUSALS = [
  'CARRY_SOURCE_EXPECTATION_INVALID',
  'CARRY_SOURCE_RUN_RECORD_MISSING',
  'CARRY_SOURCE_RUN_RECORD_MISMATCH',
  'CARRY_SOURCE_NOT_THE_PAID_WORKFLOW',
  'CARRY_SOURCE_NOT_DISPATCHED',
  'CARRY_SOURCE_NOT_PAID',
  'CARRY_SOURCE_MISSION_MISMATCH',
  'CARRY_SOURCE_ARCHIVE_DIGEST_MISMATCH',
  'CARRY_SOURCE_MANIFEST_MISSING',
  'CARRY_SOURCE_MANIFEST_UNREADABLE',
  'CARRY_SOURCE_COMMIT_MISMATCH',
  'CARRY_SOURCE_DIRTY',
  'CARRY_SOURCE_RUN_UNNAMED',
  'CARRY_SOURCE_CONTRACT_MISMATCH',
  'CARRY_SOURCE_EXPORT_MISSING',
  'CARRY_SOURCE_EXPORT_DIGEST_MISMATCH',
  'CARRY_SOURCE_EXPORT_MALFORMED',
  'CARRY_SOURCE_EXPORT_RUN_MISMATCH',
  'CARRY_SOURCE_PROJECT_MISMATCH',
] as const;
export type JuliusCarryArchiveRefusal = (typeof JULIUS_CARRY_ARCHIVE_REFUSALS)[number];

export interface JuliusCarryExport {
  readonly format: typeof JULIUS_CARRY_EXPORT_FORMAT;
  readonly runId: string;
  readonly projectId: string;
  readonly findings: readonly JuliusReviewerFinding[];
  readonly ledger: readonly JuliusPeerLedgerEntry[];
}

/** GitHub's own record of the source run and of the archive downloaded from it. */
export interface JuliusCarryRunRecord {
  readonly id: string;
  readonly path: string;
  readonly event: string;
  readonly headSha: string;
  readonly displayTitle: string;
  readonly runAttempt: string;
  /** As the artifacts API reports it: `sha256:<hex>`. */
  readonly artifactDigest: string;
  /** The sha256 of the archive the fetch step actually downloaded. */
  readonly archiveSha256: string;
}

/** What the receiving job knows for itself, independently of anything in the bundle. */
export interface JuliusCarryArchiveExpectation {
  /** The dispatch input naming the WITHOUT arm's workflow run. */
  readonly workflowRunId: string;
  /** The receiving checkout's own HEAD. */
  readonly commit: string;
  /** The receiving mission's project. */
  readonly projectId: string;
  /** The WITH contract's `carryFrom`: the paired WITHOUT mission. */
  readonly sourceMission: string;
  /** The sha256 of `.github/julius-missions/<carryFrom>/contract.json` at the receiving checkout. */
  readonly sourceContractSha256: string;
}

export type JuliusCarryArchiveVerdict =
  | { readonly ok: true; readonly source: JuliusCarrySourceRun; readonly origin: JuliusCarryArchiveOrigin }
  | { readonly ok: false; readonly reasonCode: JuliusCarryArchiveRefusal; readonly detail: string };

const SHA1 = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const DIGITS = /^[0-9]{1,20}$/u;
/** An identifier as Julius writes one: no whitespace, no control character, bounded. */
const IDENT = /^[A-Za-z0-9][A-Za-z0-9._:@#+/=-]{0,255}$/u;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SEVERITIES: readonly string[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUSES: readonly string[] = ['OPEN', 'RESOLVED', 'DISMISSED'];
const LEDGER_TYPES: readonly string[] = ['finding.recorded', 'finding.transitioned'];
const FINDING_KEYS = ['blocking', 'category', 'claim', 'createdAt', 'criterionId', 'evidenceIds', 'findingId',
  'reviewerWorkerId', 'runId', 'severity', 'status', 'taskId'] as const;

/** `key=value` lines, as the evidence dump writes `bundle-manifest.txt`. A repeated key keeps its first value. */
export function parseJuliusBundleManifest(text: string): Readonly<Record<string, string>> {
  const fields: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (!/^[a-z0-9_]+$/u.test(key) || key in fields) continue;
    fields[key] = line.slice(at + 1).replace(/\r$/u, '').trim();
  }
  return Object.freeze(fields);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(value).sort();
  const wanted = [...keys].sort();
  return present.length === wanted.length && present.every((key, index) => key === wanted[index]);
};

type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

function parseFinding(value: unknown, index: number): Parsed<JuliusReviewerFinding> {
  const where = `findings[${String(index)}]`;
  if (!isRecord(value) || !exactKeys(value, FINDING_KEYS)) return { ok: false, detail: `${where} does not have exactly the finding fields` };
  const { findingId, runId, taskId, reviewerWorkerId, severity, category, claim, criterionId, evidenceIds, blocking, status, createdAt } = value;
  for (const [name, field] of [['findingId', findingId], ['runId', runId], ['taskId', taskId], ['reviewerWorkerId', reviewerWorkerId]] as const) {
    if (typeof field !== 'string' || !IDENT.test(field)) return { ok: false, detail: `${where}.${name} is not an identifier` };
  }
  if (typeof severity !== 'string' || !SEVERITIES.includes(severity)) return { ok: false, detail: `${where}.severity is not a severity` };
  if (typeof category !== 'string' || category.length === 0 || category.length > 200) return { ok: false, detail: `${where}.category is not a category` };
  if (typeof claim !== 'string' || claim.length === 0 || claim.length > JULIUS_CARRY_EXPORT_MAX_CLAIM_CHARS) {
    return { ok: false, detail: `${where}.claim is empty or longer than ${String(JULIUS_CARRY_EXPORT_MAX_CLAIM_CHARS)} characters` };
  }
  if (criterionId !== null && (typeof criterionId !== 'string' || !IDENT.test(criterionId))) return { ok: false, detail: `${where}.criterionId is neither null nor an identifier` };
  if (!Array.isArray(evidenceIds) || evidenceIds.length > 100 || evidenceIds.some((id) => typeof id !== 'string' || !IDENT.test(id))) {
    return { ok: false, detail: `${where}.evidenceIds is not a list of identifiers` };
  }
  if (typeof blocking !== 'boolean') return { ok: false, detail: `${where}.blocking is not a boolean` };
  if (typeof status !== 'string' || !STATUSES.includes(status)) return { ok: false, detail: `${where}.status is not a finding status` };
  if (typeof createdAt !== 'string' || !ISO.test(createdAt) || Number.isNaN(Date.parse(createdAt))) return { ok: false, detail: `${where}.createdAt is not an ISO instant` };
  return {
    ok: true,
    value: Object.freeze({
      findingId: findingId as string, runId: runId as string, taskId: taskId as string,
      reviewerWorkerId: reviewerWorkerId as string, severity: severity as JuliusReviewerFinding['severity'],
      category, claim, criterionId: criterionId as string | null,
      evidenceIds: Object.freeze([...(evidenceIds as string[])]), blocking,
      status: status as JuliusReviewerFinding['status'], createdAt,
    }),
  };
}

function parseLedgerRow(value: unknown, index: number, previous: number): Parsed<JuliusPeerLedgerEntry & { readonly sequence: number }> {
  const where = `ledger[${String(index)}]`;
  if (!isRecord(value) || !exactKeys(value, ['facts', 'sequence', 'taskId', 'type'])) return { ok: false, detail: `${where} does not have exactly sequence, type, taskId and facts` };
  const { sequence, type, taskId, facts } = value;
  if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence <= previous) {
    return { ok: false, detail: `${where}.sequence does not follow the row before it: the fold needs ledger order` };
  }
  if (typeof type !== 'string' || !LEDGER_TYPES.includes(type)) return { ok: false, detail: `${where}.type is not a finding ledger type` };
  if (taskId !== null && (typeof taskId !== 'string' || !IDENT.test(taskId))) return { ok: false, detail: `${where}.taskId is neither null nor an identifier` };
  if (!isRecord(facts) || Object.keys(facts).length > 16) return { ok: false, detail: `${where}.facts is not a small object` };
  const scalars: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(facts)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(key)) return { ok: false, detail: `${where}.facts has a key that is not a fact name` };
    if (item !== null && typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') {
      return { ok: false, detail: `${where}.facts.${key} is not a scalar` };
    }
    if (typeof item === 'string' && item.length > 512) return { ok: false, detail: `${where}.facts.${key} is longer than a ledger token` };
    scalars[key] = item;
  }
  return { ok: true, value: Object.freeze({ sequence, type, taskId: taskId as string | null, facts: Object.freeze(scalars) }) };
}

/** The export, exactly as `julius-carry-export.v1` defines it, or why not. Unknown fields are refused, not ignored. */
export function parseJuliusCarryExport(text: string): Parsed<JuliusCarryExport> {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { ok: false, detail: 'the export is not JSON' }; }
  if (!isRecord(value) || !exactKeys(value, ['findings', 'format', 'ledger', 'projectId', 'runId'])) {
    return { ok: false, detail: 'the export does not have exactly format, runId, projectId, findings and ledger' };
  }
  if (value.format !== JULIUS_CARRY_EXPORT_FORMAT) return { ok: false, detail: `the export is not ${JULIUS_CARRY_EXPORT_FORMAT}` };
  if (typeof value.runId !== 'string' || !IDENT.test(value.runId)) return { ok: false, detail: 'the export names no run' };
  if (typeof value.projectId !== 'string' || !IDENT.test(value.projectId)) return { ok: false, detail: 'the export names no project' };
  if (!Array.isArray(value.findings) || value.findings.length > JULIUS_CARRY_EXPORT_MAX_FINDINGS) {
    return { ok: false, detail: `the export's findings are not a list of at most ${String(JULIUS_CARRY_EXPORT_MAX_FINDINGS)}` };
  }
  if (!Array.isArray(value.ledger) || value.ledger.length > JULIUS_CARRY_EXPORT_MAX_LEDGER_ROWS) {
    return { ok: false, detail: `the export's ledger is not a list of at most ${String(JULIUS_CARRY_EXPORT_MAX_LEDGER_ROWS)}` };
  }
  const findings: JuliusReviewerFinding[] = [];
  const seen = new Set<string>();
  for (const [index, item] of value.findings.entries()) {
    const parsed = parseFinding(item, index);
    if (!parsed.ok) return parsed;
    if (seen.has(parsed.value.findingId)) return { ok: false, detail: `findings[${String(index)}] repeats ${parsed.value.findingId}` };
    seen.add(parsed.value.findingId);
    findings.push(parsed.value);
  }
  const ledger: JuliusPeerLedgerEntry[] = [];
  let previous = 0;
  for (const [index, item] of value.ledger.entries()) {
    const parsed = parseLedgerRow(item, index, previous);
    if (!parsed.ok) return parsed;
    previous = parsed.value.sequence;
    ledger.push({ type: parsed.value.type, taskId: parsed.value.taskId, facts: parsed.value.facts });
  }
  return {
    ok: true,
    value: Object.freeze({
      format: JULIUS_CARRY_EXPORT_FORMAT, runId: value.runId, projectId: value.projectId,
      findings: Object.freeze(findings), ledger: Object.freeze(ledger),
    }),
  };
}

/** `julius mission=<m> lane=<l> mode=<paid|preflight> key=<k>`, the paid workflow's `run-name`, read whole. */
const RUN_TITLE = /^julius mission=([a-z0-9-]{1,64}) lane=([a-z-]{1,40}) mode=(paid|preflight) key=([A-Za-z0-9._@#-]{1,96})$/u;
const PAID_WORKFLOW_PATH = /^\.github\/workflows\/julius-first-live-mission\.yml(?:@\S+)?$/u;

/**
 * IS THIS THE PAIRED WITHOUT ARM'S BUNDLE, AND WHAT DID IT RECORD.
 *
 * Every check reads something the receiving job knows for itself (`expect`) or
 * GitHub's own record against what the bundle says, never the bundle against
 * itself alone. The order is the order a person would check in: who ran it,
 * which code, which mission, which run, which bytes.
 */
export function verifyJuliusCarryArchive(input: {
  readonly expect: JuliusCarryArchiveExpectation;
  readonly runRecord: JuliusCarryRunRecord | null;
  readonly manifestText: string | null;
  readonly exportText: string | null;
  /** The sha256 of the export file's bytes, computed by the reader. */
  readonly exportSha256: string | null;
}): JuliusCarryArchiveVerdict {
  const refuse = (reasonCode: JuliusCarryArchiveRefusal, detail: string): JuliusCarryArchiveVerdict =>
    Object.freeze({ ok: false as const, reasonCode, detail });
  const { expect } = input;

  if (!DIGITS.test(expect.workflowRunId) || !SHA1.test(expect.commit) || !IDENT.test(expect.projectId)
    || !JULIUS_MISSION_NAME.test(expect.sourceMission) || !SHA256.test(expect.sourceContractSha256)) {
    return refuse('CARRY_SOURCE_EXPECTATION_INVALID', 'the receiving job could not state the source run, its own commit, its project, the paired mission or that mission\'s contract digest');
  }

  // WHO RAN IT: GitHub's record, never the bundle's word.
  const record = input.runRecord;
  if (record === null) return refuse('CARRY_SOURCE_RUN_RECORD_MISSING', 'GitHub\'s record of the source run was not read');
  if (record.id !== expect.workflowRunId) return refuse('CARRY_SOURCE_RUN_RECORD_MISMATCH', `GitHub answered for run ${record.id}, not ${expect.workflowRunId}`);
  if (!PAID_WORKFLOW_PATH.test(record.path)) return refuse('CARRY_SOURCE_NOT_THE_PAID_WORKFLOW', `run ${record.id} is ${record.path || '(no path)'}, not ${JULIUS_PAID_MISSION_WORKFLOW}`);
  if (record.event !== 'workflow_dispatch') return refuse('CARRY_SOURCE_NOT_DISPATCHED', `run ${record.id} was started by ${record.event || '(no event)'}`);
  const title = RUN_TITLE.exec(record.displayTitle);
  if (title === null) return refuse('CARRY_SOURCE_RUN_RECORD_MISMATCH', `run ${record.id} carries a title the paid workflow does not write`);
  if (title[3] !== 'paid') return refuse('CARRY_SOURCE_NOT_PAID', `run ${record.id} was a ${title[3]}, not a paid mission`);
  if (title[1] !== expect.sourceMission) return refuse('CARRY_SOURCE_MISSION_MISMATCH', `run ${record.id} ran ${title[1]}, and this arm is paired with ${expect.sourceMission}`);
  if (!SHA256.test(record.archiveSha256) || record.artifactDigest !== `sha256:${record.archiveSha256}`) {
    return refuse('CARRY_SOURCE_ARCHIVE_DIGEST_MISMATCH', 'the archive downloaded is not the one whose digest GitHub recorded');
  }

  // WHICH CODE, WHICH MISSION, WHICH RUN: the bundle's manifest, checked against the job's own knowledge.
  if (input.manifestText === null) return refuse('CARRY_SOURCE_MANIFEST_MISSING', 'the bundle carries no bundle-manifest.txt');
  const manifest = parseJuliusBundleManifest(input.manifestText);
  if (manifest.manifest_version !== '1') return refuse('CARRY_SOURCE_MANIFEST_UNREADABLE', `the manifest is version ${manifest.manifest_version ?? '(none)'}`);
  if (manifest.mode !== 'paid') return refuse('CARRY_SOURCE_NOT_PAID', `the manifest says mode=${manifest.mode ?? '(absent)'}`);
  if (manifest.workflow_run_id !== record.id) return refuse('CARRY_SOURCE_RUN_RECORD_MISMATCH', `the manifest was written by workflow run ${manifest.workflow_run_id ?? '(absent)'}, not ${record.id}`);
  if (manifest.workflow_run_attempt !== record.runAttempt) {
    return refuse('CARRY_SOURCE_RUN_RECORD_MISMATCH', `the manifest was written by attempt ${manifest.workflow_run_attempt ?? '(absent)'}, and GitHub records attempt ${record.runAttempt}`);
  }
  if (manifest.commit !== record.headSha) return refuse('CARRY_SOURCE_RUN_RECORD_MISMATCH', 'the manifest names a commit GitHub did not run');
  if (manifest.commit !== expect.commit) {
    return refuse('CARRY_SOURCE_COMMIT_MISMATCH', `the source arm ran ${String(manifest.commit).slice(0, 12)} and this arm runs ${expect.commit.slice(0, 12)}: the arms of a pair run one frozen code`);
  }
  if (manifest.tracked_changes !== '0') return refuse('CARRY_SOURCE_DIRTY', `the source checkout recorded tracked_changes=${manifest.tracked_changes ?? '(absent)'}`);
  if (manifest.mission !== expect.sourceMission) return refuse('CARRY_SOURCE_MISSION_MISMATCH', `the manifest names mission ${manifest.mission ?? '(absent)'}`);
  if (manifest.contract_sha256 !== expect.sourceContractSha256) {
    return refuse('CARRY_SOURCE_CONTRACT_MISMATCH', `the source ran a contract other than ${expect.sourceMission}'s at this checkout`);
  }
  const sourceRunId = manifest.julius_run_id;
  if (sourceRunId === undefined || sourceRunId === 'none' || !IDENT.test(sourceRunId)) return refuse('CARRY_SOURCE_RUN_UNNAMED', 'the manifest names no Julius run');

  // WHICH BYTES: the export the manifest recorded, about that run and this project.
  if (input.exportText === null || input.exportSha256 === null) return refuse('CARRY_SOURCE_EXPORT_MISSING', `the bundle carries no ${JULIUS_CARRY_EXPORT_FILE}`);
  if (!SHA256.test(manifest.carry_export_sha256 ?? '') || manifest.carry_export_sha256 !== input.exportSha256) {
    return refuse('CARRY_SOURCE_EXPORT_DIGEST_MISMATCH', 'the export is not the one the manifest recorded when it was written');
  }
  const parsed = parseJuliusCarryExport(input.exportText);
  if (!parsed.ok) return refuse('CARRY_SOURCE_EXPORT_MALFORMED', parsed.detail);
  const exported = parsed.value;
  if (exported.runId !== sourceRunId) return refuse('CARRY_SOURCE_EXPORT_RUN_MISMATCH', `the export is about ${exported.runId}, the manifest about ${sourceRunId}`);
  const stray = exported.findings.find((finding) => finding.runId !== exported.runId);
  if (stray !== undefined) return refuse('CARRY_SOURCE_EXPORT_RUN_MISMATCH', `finding ${stray.findingId} belongs to ${stray.runId}`);
  if (exported.projectId !== expect.projectId) return refuse('CARRY_SOURCE_PROJECT_MISMATCH', `the source run is project ${exported.projectId}, this mission ${expect.projectId}`);

  return Object.freeze({
    ok: true as const,
    source: Object.freeze({ runId: exported.runId, findings: exported.findings, ledger: exported.ledger }),
    origin: Object.freeze({
      kind: 'ARCHIVE' as const,
      sourceRunId: exported.runId,
      sourceProjectId: exported.projectId,
      sourceMission: expect.sourceMission,
      workflowRunId: record.id,
      workflowRunAttempt: record.runAttempt,
      commit: expect.commit,
      contractSha256: expect.sourceContractSha256,
      exportSha256: input.exportSha256,
      archiveSha256: record.archiveSha256,
    }),
  });
}
