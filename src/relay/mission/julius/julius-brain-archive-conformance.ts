import {
  checkJuliusPaidRunArchiveExport,
  JULIUS_ARCHIVE_KNOWN_EVIDENCE_TYPES,
  JULIUS_ARCHIVE_SECTIONS,
  JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT,
  juliusArchiveBrainRunId,
  juliusArchiveHistoryConflicts,
  juliusArchiveLiveRepresentation,
  sealJuliusPaidRunArchiveExport,
  verifyJuliusArchiveArtifactBytes,
  type JuliusPaidRunArchiveExport,
  type JuliusPaidRunArchiveExportBody,
} from './julius-brain-archive-import';
import type { JuliusBrainRecord } from './julius-brain-contracts';
import { deriveJuliusBrainRunPreservation, type JuliusBrainPreservationStatus } from './julius-brain-preservation';
import type { JuliusBrainEntityState } from './julius-brain-projection';
import { redactJuliusSecrets } from './julius-brain-secrets';

/**
 * THE CONFORMANCE KIT FOR `julius-paid-run-archive-export.v1`.
 *
 * Independent of any archive's storage: it reads an export document and nothing
 * else, so whoever produces exports — Formal's exporter over whatever tables it
 * keeps — can prove a document conforms before Project Brain ever imports it.
 *
 *   checkJuliusPaidRunArchiveConformance(export)
 *       the verdict and every finding, by check:
 *         ERROR    the import would refuse it
 *         WARNING  the import accepts it, and something is worth knowing
 *                  (an evidence type no runtime vocabulary names is imported
 *                  as OBSERVATION with its source type kept)
 *         NOTE     facts about the document (Unknown fields, an UNKNOWN outcome)
 *       and, given a Brain's records, what importing it would do there —
 *       refuse (preserved or conflicting), reconcile, or reconstruct.
 *
 *   runJuliusArchiveConformanceCases(validExport)
 *       applies every catalogued corruption to a VALID export and checks each
 *       is refused (or, for unknown-but-valid values, accepted). A case that
 *       needs an item the export does not have is NOT_APPLICABLE, never passed.
 *
 * The archive's own version label is never evidence of anything here: only the
 * export's `format` is read, and only this contract is accepted.
 */

export type JuliusArchiveConformanceLevel = 'ERROR' | 'WARNING' | 'NOTE';

export interface JuliusArchiveConformanceFinding {
  readonly level: JuliusArchiveConformanceLevel;
  readonly check: string;
  readonly location: string;
  readonly detail: string;
}

export interface JuliusArchiveConformanceReport {
  readonly contract: typeof JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT;
  readonly verdict: 'CONFORMANT' | 'NOT_CONFORMANT' | 'UNSUPPORTED_VERSION' | 'NOT_AN_EXPORT';
  readonly findings: readonly JuliusArchiveConformanceFinding[];
  readonly summary: {
    readonly workflowRunId: string; readonly workflowRunAttempt: number; readonly brainRunId: string; readonly acceptedMainSha: string;
    readonly missionId: string; readonly campaignId: string | null; readonly stateMode: string; readonly outcome: string; readonly contentHash: string;
    readonly items: Readonly<Record<string, number>>; readonly unknownFields: number;
  } | null;
  readonly brain: {
    readonly preservation: JuliusBrainPreservationStatus;
    readonly conflicts: readonly string[];
    readonly wouldImport: 'REFUSE_ALREADY_PRESERVED' | 'REFUSE_CONFLICTING_HISTORY' | 'RECONCILE' | 'RECONSTRUCT';
  } | null;
}

const CHECKS: readonly [RegExp, string][] = [
  [/^format:/, 'version'],
  [/credential-shaped content/, 'security.credentials'],
  [/an empty string is not a value/, 'null-semantics.empty-string'],
  [/\.unknown:|null must be listed as Unknown/, 'null-semantics.unknown-list'],
  [/^integrity/, 'integrity.hash'],
  [/duplicate id|duplicate references/, 'references.duplicate'],
  [/references workflow run/, 'references.cross-run'],
  [/ is not in /, 'references.broken'],
  [/requires usdMicros|UNKNOWN basis cannot carry|^accounting\./, 'cost.honesty'],
  [/supplied bytes/, 'artifacts.digest'],
  [/contradicts|before startedAt|before requestedAt|REFUSED request records|only a REFUSED request/, 'consistency.contradiction'],
  [/not part of the contract|: missing$|: required$|: an object$|: a list$/, 'schema.shape'],
];

function findingOf(error: string): JuliusArchiveConformanceFinding {
  const split = error.indexOf(': ');
  const location = split < 0 ? '(document)' : error.slice(0, split);
  const detail = split < 0 ? error : error.slice(split + 2);
  const check = CHECKS.find(([pattern]) => pattern.test(error))?.[1] ?? 'schema.value';
  // A finding may quote a value; a report never repeats a credential it found.
  return { level: 'ERROR', check, location, detail: redactJuliusSecrets(detail).text };
}

export function checkJuliusPaidRunArchiveConformance(archive: unknown, options: {
  /** A Brain's records and state, to say what importing this export there would do. */
  readonly brain?: { readonly brainId: string; readonly records: readonly JuliusBrainRecord[]; readonly entities: readonly JuliusBrainEntityState[] };
  /** The artifact bytes the archive holds, to check each against the digest and size the export declares. */
  readonly artifactBytes?: (artifactId: string) => Uint8Array | null;
} = {}): JuliusArchiveConformanceReport {
  const check = checkJuliusPaidRunArchiveExport(archive);
  if (!check.ok) {
    const verdict = check.reasonCode === 'unsupported_export_version' ? 'UNSUPPORTED_VERSION' : check.reasonCode === 'not_an_archive_export' ? 'NOT_AN_EXPORT' : 'NOT_CONFORMANT';
    return { contract: JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT, verdict, findings: check.errors.map(findingOf), summary: null, brain: null };
  }
  const typed = archive as JuliusPaidRunArchiveExport;
  const findings: JuliusArchiveConformanceFinding[] = [];
  if (options.artifactBytes !== undefined) {
    const bytes = verifyJuliusArchiveArtifactBytes(typed, options.artifactBytes);
    findings.push(...bytes.errors.map(findingOf));
    if (bytes.withoutBytes.length > 0) findings.push({ level: 'NOTE', check: 'artifacts.digest', location: 'artifacts', detail: `${bytes.withoutBytes.length} artifact(s) supplied without bytes; their digests are declared, not verified` });
  }
  typed.evidence.forEach((item, i) => {
    if (!JULIUS_ARCHIVE_KNOWN_EVIDENCE_TYPES.includes(item.evidenceType)) {
      findings.push({ level: 'WARNING', check: 'vocabulary.evidence-type', location: `evidence[${i}].evidenceType`, detail: `${item.evidenceType} is in no runtime vocabulary; it would be imported as OBSERVATION with its source type kept` });
    }
  });
  if (typed.identity.outcome === 'UNKNOWN') findings.push({ level: 'NOTE', check: 'null-semantics.unknown-value', location: 'identity.outcome', detail: 'the outcome is UNKNOWN, and will stay so' });
  const unknownBySection: Record<string, number> = { identity: typed.identity.unknown.length, accounting: typed.accounting.unknown.length };
  for (const section of JULIUS_ARCHIVE_SECTIONS) unknownBySection[section] = (typed[section] as readonly { unknown: readonly string[] }[]).reduce((sum, item) => sum + item.unknown.length, 0);
  for (const [section, count] of Object.entries(unknownBySection)) {
    if (count > 0) findings.push({ level: 'NOTE', check: 'null-semantics.unknown-count', location: section, detail: `${count} field value(s) recorded as Unknown` });
  }
  const identity = typed.identity;
  const brainRunId = juliusArchiveBrainRunId(identity);
  let brain: JuliusArchiveConformanceReport['brain'] = null;
  if (options.brain !== undefined) {
    const preservation = deriveJuliusBrainRunPreservation({ brainId: options.brain.brainId, brainRunId, records: options.brain.records, entities: options.brain.entities });
    const conflicts = preservation.status === 'PRESERVED' ? [] : juliusArchiveHistoryConflicts(typed, preservation, juliusArchiveLiveRepresentation(options.brain.entities, brainRunId));
    brain = {
      preservation: preservation.status, conflicts,
      wouldImport: preservation.status === 'PRESERVED' ? 'REFUSE_ALREADY_PRESERVED' : conflicts.length > 0 ? 'REFUSE_CONFLICTING_HISTORY' : preservation.status === 'PARTIALLY_PRESERVED' ? 'RECONCILE' : 'RECONSTRUCT',
    };
    for (const conflict of conflicts) findings.push({ level: 'ERROR', check: 'consistency.live-history', location: 'identity', detail: conflict });
  }
  return {
    contract: JULIUS_PAID_RUN_ARCHIVE_EXPORT_FORMAT,
    verdict: findings.some((finding) => finding.level === 'ERROR') ? 'NOT_CONFORMANT' : 'CONFORMANT',
    findings,
    summary: {
      workflowRunId: identity.workflowRunId, workflowRunAttempt: identity.workflowRunAttempt, brainRunId, acceptedMainSha: identity.acceptedMainSha,
      missionId: identity.missionId, campaignId: identity.campaignId, stateMode: identity.stateMode, outcome: identity.outcome, contentHash: typed.integrity.contentHash,
      items: Object.fromEntries(JULIUS_ARCHIVE_SECTIONS.map((section) => [section, (typed[section] as readonly unknown[]).length])),
      unknownFields: Object.values(unknownBySection).reduce((sum, count) => sum + count, 0),
    },
    brain,
  };
}

/* --------------------------------------------------------------- the cases */

type Body = JuliusPaidRunArchiveExportBody;
type Mutable = { -readonly [K in keyof Body]: Body[K] } & Record<string, unknown>;

export interface JuliusArchiveConformanceCase {
  readonly id: string;
  readonly requirement: string;
  /** Resealed: a faulty exporter that hashes what it wrote. Not resealed: bytes altered after sealing. */
  readonly reseal: boolean;
  /** A corrupted copy of a valid export body, or null when the export has nothing to corrupt. */
  readonly corrupt: (body: Mutable) => unknown | null;
  readonly expect: { readonly verdict: JuliusArchiveConformanceReport['verdict']; readonly check?: string; readonly location?: string; readonly warning?: string };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const JULIUS_ARCHIVE_CONFORMANCE_CASES: readonly JuliusArchiveConformanceCase[] = [
  { id: 'version.newer', requirement: 'a newer contract version is refused, not guessed at', reseal: false, corrupt: (body) => ({ ...body, format: 'julius-paid-run-archive-export.v2' }), expect: { verdict: 'UNSUPPORTED_VERSION', check: 'version' } },
  { id: 'version.older', requirement: 'an older contract version is refused', reseal: false, corrupt: (body) => ({ ...body, format: 'julius-paid-run-archive-export.v0' }), expect: { verdict: 'UNSUPPORTED_VERSION', check: 'version' } },
  { id: 'version.archive-label', requirement: "an archive's own label is not an export contract", reseal: false, corrupt: (body) => ({ ...body, format: 'julius-paid-run-archive.v1' }), expect: { verdict: 'NOT_AN_EXPORT', check: 'version' } },
  { id: 'version.missing', requirement: 'a document without a format is not an export', reseal: false, corrupt: (body) => { const copy = { ...body } as Record<string, unknown>; delete copy.format; return copy; }, expect: { verdict: 'NOT_AN_EXPORT', check: 'version' } },
  { id: 'identity.workflow-run', requirement: 'the workflow run id is bound by hash', reseal: false, corrupt: (body) => ({ ...body, identity: { ...body.identity, workflowRunId: `${body.identity.workflowRunId}9` } }), expect: { verdict: 'NOT_CONFORMANT', check: 'integrity.hash' } },
  { id: 'identity.workflow-run.invalid', requirement: 'the workflow run id is digits', reseal: true, corrupt: (body) => ({ ...body, identity: { ...body.identity, workflowRunId: 'run:julius-live-4' } }), expect: { verdict: 'NOT_CONFORMANT', check: 'schema.value' } },
  { id: 'identity.attempt', requirement: 'the attempt is bound by hash', reseal: false, corrupt: (body) => ({ ...body, identity: { ...body.identity, workflowRunAttempt: body.identity.workflowRunAttempt + 1 } }), expect: { verdict: 'NOT_CONFORMANT', check: 'integrity.hash' } },
  { id: 'identity.attempt.invalid', requirement: 'the attempt is a positive integer', reseal: true, corrupt: (body) => ({ ...body, identity: { ...body.identity, workflowRunAttempt: 0 } }), expect: { verdict: 'NOT_CONFORMANT', check: 'schema.value' } },
  { id: 'identity.accepted-main', requirement: 'the accepted main SHA is bound by hash', reseal: false, corrupt: (body) => ({ ...body, identity: { ...body.identity, acceptedMainSha: body.identity.acceptedMainSha.startsWith('f') ? '0'.repeat(40) : 'f'.repeat(40) } }), expect: { verdict: 'NOT_CONFORMANT', check: 'integrity.hash' } },
  { id: 'identity.accepted-main.invalid', requirement: 'the accepted main is a 40-hex commit, not a ref', reseal: true, corrupt: (body) => ({ ...body, identity: { ...body.identity, acceptedMainSha: 'HEAD' } }), expect: { verdict: 'NOT_CONFORMANT', check: 'schema.value' } },
  { id: 'identity.mission', requirement: 'the mission is bound by hash', reseal: false, corrupt: (body) => ({ ...body, identity: { ...body.identity, missionId: `${body.identity.missionId}-other` } }), expect: { verdict: 'NOT_CONFORMANT', check: 'integrity.hash' } },
  { id: 'identity.campaign.empty', requirement: 'an empty campaign is not a campaign (null means Unknown)', reseal: true, corrupt: (body) => ({ ...body, identity: { ...body.identity, campaignId: '' } }), expect: { verdict: 'NOT_CONFORMANT', check: 'null-semantics.empty-string' } },
  { id: 'identity.state-mode', requirement: 'the state mode is bound by hash', reseal: false, corrupt: (body) => ({ ...body, identity: { ...body.identity, stateMode: body.identity.stateMode === 'LEARNING' ? 'FRESH' : 'LEARNING' } }), expect: { verdict: 'NOT_CONFORMANT', check: 'integrity.hash' } },
  { id: 'identity.state-mode.invalid', requirement: 'the state mode is one of the four', reseal: true, corrupt: (body) => ({ ...body, identity: { ...body.identity, stateMode: 'WARM' } }), expect: { verdict: 'NOT_CONFORMANT', check: 'schema.value' } },
  { id: 'identity.outcome.invalid', requirement: 'the outcome is COMPLETED, FAILED, CANCELLED or UNKNOWN', reseal: true, corrupt: (body) => ({ ...body, identity: { ...body.identity, outcome: 'SUCCESS' } }), expect: { verdict: 'NOT_CONFORMANT', check: 'schema.value' } },
  {
    id: 'identity.outcome.unknown-but-valid', requirement: 'an UNKNOWN outcome with no reason is valid, and stays UNKNOWN', reseal: true,
    corrupt: (body) => ({ ...body, identity: { ...body.identity, outcome: 'UNKNOWN', outcomeReason: null, unknown: [...new Set([...body.identity.unknown, 'outcomeReason'])].sort() } }),
    expect: { verdict: 'CONFORMANT' },
  },
  {
    id: 'integrity.section', requirement: 'every section is bound by its own hash', reseal: false,
    corrupt: (body) => (body.tasks.length === 0 ? null : { ...body, tasks: [{ ...body.tasks[0]!, state: `${body.tasks[0]!.state}-altered` }, ...body.tasks.slice(1)] }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'integrity.hash', location: 'integrity.sectionHashes.tasks' },
  },
  { id: 'integrity.content', requirement: 'the whole document is bound by its content hash', reseal: false, corrupt: (body) => ({ ...body, exportedAt: '2099-01-01T00:00:00.000Z' }), expect: { verdict: 'NOT_CONFORMANT', check: 'integrity.hash', location: 'integrity.contentHash' } },
  {
    id: 'artifacts.digest.invalid', requirement: 'an artifact digest is sha256:<64 hex>', reseal: true,
    corrupt: (body) => (body.artifacts.length === 0 ? null : { ...body, artifacts: [{ ...body.artifacts[0]!, contentHash: 'md5:1234' }, ...body.artifacts.slice(1)] }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'schema.value' },
  },
  {
    id: 'artifacts.reference.broken', requirement: 'evidence may only reference artifacts the export holds', reseal: true,
    corrupt: (body) => (body.evidence.length === 0 ? null : { ...body, evidence: [{ ...body.evidence[0]!, artifactRefs: ['artifact-that-is-not-here'], unknown: body.evidence[0]!.unknown.filter((name) => name !== 'artifactRefs') }, ...body.evidence.slice(1)] }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'references.broken' },
  },
  {
    id: 'null.listed-with-value', requirement: 'a field listed Unknown must be null', reseal: true,
    corrupt: (body) => ({ ...body, identity: { ...body.identity, campaignId: 'invented-campaign', unknown: [...new Set([...body.identity.unknown, 'campaignId'])].sort() } }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'null-semantics.unknown-list' },
  },
  {
    id: 'null.unlisted-null-list', requirement: 'a null list is Unknown and must be listed; a recorded empty list is []', reseal: true,
    corrupt: (body) => (body.tasks.length === 0 ? null : { ...body, tasks: [{ ...body.tasks[0]!, dependencyIds: null, unknown: body.tasks[0]!.unknown.filter((name) => name !== 'dependencyIds') }, ...body.tasks.slice(1)] }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'null-semantics.unknown-list' },
  },
  {
    id: 'null.not-nullable', requirement: 'only nullable fields may be listed Unknown', reseal: true,
    corrupt: (body) => (body.tasks.length === 0 ? null : { ...body, tasks: [{ ...body.tasks[0]!, unknown: [...body.tasks[0]!.unknown, 'taskType'].sort() }, ...body.tasks.slice(1)] }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'null-semantics.unknown-list' },
  },
  { id: 'null.empty-string', requirement: 'an empty string is never a value', reseal: true, corrupt: (body) => (body.tasks.length === 0 ? null : { ...body, tasks: [{ ...body.tasks[0]!, state: '' }, ...body.tasks.slice(1)] }), expect: { verdict: 'NOT_CONFORMANT', check: 'null-semantics.empty-string' } },
  { id: 'references.broken', requirement: 'a parent task must exist in the export', reseal: true, corrupt: (body) => (body.tasks.length === 0 ? null : { ...body, tasks: [{ ...body.tasks[0]!, parentTaskId: 'task-that-is-not-here', unknown: body.tasks[0]!.unknown.filter((name) => name !== 'parentTaskId') }, ...body.tasks.slice(1)] }), expect: { verdict: 'NOT_CONFORMANT', check: 'references.broken' } },
  { id: 'references.duplicate', requirement: 'ids are unique within a section', reseal: true, corrupt: (body) => (body.tasks.length === 0 ? null : { ...body, tasks: [...body.tasks, clone(body.tasks[0]!)] }), expect: { verdict: 'NOT_CONFORMANT', check: 'references.duplicate' } },
  {
    id: 'references.cross-run', requirement: "an attempt's export does not reference another workflow run or attempt", reseal: true,
    corrupt: (body) => (body.tasks.length === 0 ? null : { ...body, tasks: [{ ...body.tasks[0]!, taskType: `${body.tasks[0]!.taskType} after workflow:${body.identity.workflowRunId}/${body.identity.workflowRunAttempt + 1}` }, ...body.tasks.slice(1)] }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'references.cross-run' },
  },
  {
    id: 'vocabulary.evidence-type', requirement: 'an evidence type no runtime names is accepted, imported as OBSERVATION, and flagged', reseal: true,
    corrupt: (body) => (body.evidence.length === 0 ? null : { ...body, evidence: [{ ...body.evidence[0]!, evidenceType: 'CRYSTAL_BALL' }, ...body.evidence.slice(1)] }),
    expect: { verdict: 'CONFORMANT', warning: 'vocabulary.evidence-type' },
  },
  {
    id: 'security.credentials', requirement: 'credential-shaped content is refused with its location', reseal: true,
    corrupt: (body) => (body.tasks.length === 0 ? null : { ...body, tasks: [{ ...body.tasks[0]!, taskType: `${body.tasks[0]!.taskType} ${['gh', 'p_', 'abcdefghijklmnopqrstuvwxyz0123'].join('')}` }, ...body.tasks.slice(1)] }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'security.credentials' },
  },
  {
    id: 'cost.totals-conflict', requirement: 'claimed cost totals must equal what the usage items sum to', reseal: true,
    corrupt: (body) => ({ ...body, accounting: { ...body.accounting, knownUsdMicros: (body.accounting.knownUsdMicros ?? 0) + 1, unknown: body.accounting.unknown.filter((name) => name !== 'knownUsdMicros') } }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'cost.honesty' },
  },
  {
    id: 'cost.reported-without-amount', requirement: 'a reported cost basis must carry its amount', reseal: true,
    corrupt: (body) => (body.usage.length === 0 ? null : { ...body, usage: [{ ...body.usage[0]!, costBasis: 'PROVIDER_REPORTED', usdMicros: null, unknown: [...new Set([...body.usage[0]!.unknown, 'usdMicros'])].sort() }, ...body.usage.slice(1)], accounting: { ...body.accounting, knownUsdMicros: null, unknownComponents: null, unknown: [...new Set([...body.accounting.unknown, 'knownUsdMicros', 'unknownComponents'])].sort() } }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'cost.honesty' },
  },
  {
    id: 'consistency.outcome', requirement: "the outcome may not contradict the run's own ending event", reseal: true,
    corrupt: (body) => ({ ...body, identity: { ...body.identity, outcome: body.identity.outcome === 'COMPLETED' ? 'FAILED' : 'COMPLETED' }, events: [...body.events, { eventId: 'conformance-ending', sequence: null, eventType: `julius.run.${body.identity.outcome === 'COMPLETED' ? 'completed' : 'failed'}`, taskId: null, occurredAt: null, facts: {}, unknown: ['occurredAt', 'sequence'] }] }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'consistency.contradiction' },
  },
  {
    id: 'consistency.run-window', requirement: 'a run does not end before it starts', reseal: true,
    corrupt: (body) => ({ ...body, identity: { ...body.identity, startedAt: '2026-01-02T00:00:00.000Z', endedAt: '2026-01-01T00:00:00.000Z', unknown: body.identity.unknown.filter((name) => name !== 'startedAt' && name !== 'endedAt') } }),
    expect: { verdict: 'NOT_CONFORMANT', check: 'consistency.contradiction' },
  },
];

export interface JuliusArchiveConformanceCaseResult {
  readonly id: string;
  readonly requirement: string;
  readonly result: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  readonly observed: JuliusArchiveConformanceReport['verdict'] | null;
  readonly detail: string;
}

/** Every catalogued corruption, applied to a valid export. The export itself must conform first. */
export function runJuliusArchiveConformanceCases(valid: JuliusPaidRunArchiveExport): readonly JuliusArchiveConformanceCaseResult[] {
  const baseline = checkJuliusPaidRunArchiveConformance(valid);
  if (baseline.verdict !== 'CONFORMANT') throw new Error(`julius_archive_conformance_baseline_not_conformant: ${baseline.findings.filter((f) => f.level === 'ERROR').map((f) => `${f.location}: ${f.detail}`).join('; ')}`);
  const { integrity, ...body } = clone(valid);
  return JULIUS_ARCHIVE_CONFORMANCE_CASES.map((testCase) => {
    const corrupted = testCase.corrupt(clone(body) as Mutable);
    if (corrupted === null) return { id: testCase.id, requirement: testCase.requirement, result: 'NOT_APPLICABLE' as const, observed: null, detail: 'the export has nothing this case can corrupt' };
    const document = testCase.reseal ? sealJuliusPaidRunArchiveExport(corrupted as Body) : { ...(corrupted as object), integrity };
    const report = checkJuliusPaidRunArchiveConformance(document);
    const checkMatches = testCase.expect.check === undefined || report.findings.some((finding) => finding.level === 'ERROR' && finding.check === testCase.expect.check && (testCase.expect.location === undefined || finding.location === testCase.expect.location));
    const warningMatches = testCase.expect.warning === undefined || report.findings.some((finding) => finding.level === 'WARNING' && finding.check === testCase.expect.warning);
    const pass = report.verdict === testCase.expect.verdict && checkMatches && warningMatches;
    const errors = report.findings.filter((finding) => finding.level === 'ERROR').map((finding) => `${finding.check} @ ${finding.location}`);
    return { id: testCase.id, requirement: testCase.requirement, result: pass ? 'PASS' as const : 'FAIL' as const, observed: report.verdict, detail: errors.length > 0 ? errors.slice(0, 4).join('; ') : report.verdict };
  });
}
