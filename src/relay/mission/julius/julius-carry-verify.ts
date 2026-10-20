import {
  JULIUS_KNOWLEDGE_CARRY_VERSION,
  juliusCarryFindingCandidate,
  juliusKnowledgeCarryFacts,
  planJuliusKnowledgeCarry,
  type JuliusCarryScope,
} from './julius-claim-ledger';
import { foldJuliusFindings } from './julius-finding-lifecycle';
import type { JuliusPeerLedgerEntry } from './julius-peer-channel';
import type { JuliusReviewerFinding } from './julius-verification-runtime';

/**
 * THE FOUR-POINT CHAIN, PROVEN OFF-HOST (Decision C, C-7; SECOND's K2).
 *
 * The founder's four points, for every finding a paired arm WITH inherited:
 *   (1) arm WITHOUT wrote it: its row and its life, in WITHOUT's own bundle
 *       (`carry-sources.json`, `.github/julius-carry-sources.sql`);
 *   (2) it became eligible and was carried: WITH's `knowledge.carried` record,
 *       whose carriedEntries name each copy and bind its text by full sha256;
 *   (3) WITH holds the copy: its `carried:` row, scoped to WITH's plan, holding
 *       the text the record bound (`carry-copies.tsv`: the store's own digest);
 *   (4) the planner received it: WITH's `knowledge.consumed` receipts for the
 *       plan task, every owed row admitted and none missing.
 *
 * NOTHING IS TAKEN ON TRUST FROM THE RECORD. What WITH should have carried is
 * re-derived from WITHOUT's exported rows alone, with the production rule
 * (`planJuliusKnowledgeCarry`), the production lifecycle fold
 * (`foldJuliusFindings`), the production renderer, and the production record
 * (`juliusKnowledgeCarryFacts`). WITH's record and copies are then held to the
 * result. A tampered digest, a field the export lacks or altered, a copy whose
 * text differs, a receipt that missed a row: each FAILS a named check.
 *
 * BEFORE WITH RUNS, the same derivation previews what it will carry
 * (`previewJuliusCarry`): the procedure gate that keeps a WITHOUT with no
 * verified repair finding from ever having its WITH dispatched.
 *
 * PURE. No file system, no clock, no hashing: the caller reads the bundles and
 * passes `sha256` (hex of the UTF-8 text).
 */

export const JULIUS_CARRY_SOURCES_FORMAT = 'julius-carry-sources.v1' as const;

/** One run's carry sources, as `carry-sources.json` holds them: the store reader's own shapes. */
export interface JuliusCarrySources {
  readonly runId: string;
  readonly projectId: string;
  readonly missionId: string;
  readonly state: string;
  readonly tasks: readonly { readonly taskId: string; readonly taskType: string; readonly role: string; readonly state: string }[];
  readonly findings: readonly JuliusReviewerFinding[];
  /** The run's `finding.*` ledger rows, in ledger order. */
  readonly ledger: readonly JuliusPeerLedgerEntry[];
}

export type JuliusCarryParsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly problem: string };

export interface JuliusCarryChainCheck {
  readonly check: string;
  readonly ok: boolean;
  readonly detail: string;
}

export interface JuliusCarryChainVerdict {
  readonly verdict: 'PASS' | 'FAIL';
  readonly withoutRunId: string;
  readonly withRunId: string;
  readonly checks: readonly JuliusCarryChainCheck[];
  /** Each verified repair finding of arm WITHOUT proven at all four points; empty unless the verdict is PASS. */
  readonly proven: readonly { readonly entryId: string; readonly findingId: string; readonly digest: string }[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
const refused = <T>(problem: string): JuliusCarryParsed<T> => ({ ok: false, problem });

const SEVERITIES: readonly JuliusReviewerFinding['severity'][] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const STATUSES: readonly JuliusReviewerFinding['status'][] = ['OPEN', 'RESOLVED', 'DISMISSED'];
const LEDGER_TYPES = ['finding.recorded', 'finding.transitioned'];

/**
 * THE EXPORT, READ STRICTLY. Every field the rule and the header use must be
 * present and of its type: a missing field is a refusal by its path, never a
 * default, because a default would re-derive a text the source never had.
 */
export function parseJuliusCarrySources(text: string): JuliusCarryParsed<JuliusCarrySources> {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return refused('sources_not_json');
  }
  if (!isObject(document)) return refused('sources_not_an_object');
  const problems: string[] = [];
  const need = (ok: boolean, path: string, what: string): boolean => {
    if (!ok) problems.push(`${path}: ${what}`);
    return ok;
  };
  const string = (o: Json, key: string, path: string): string =>
    (need(typeof o[key] === 'string' && (o[key] as string).length > 0, `${path}.${key}`, 'a non-empty string is required') ? o[key] as string : '');
  const nullableString = (o: Json, key: string, path: string): string | null =>
    (need(key in o && (o[key] === null || typeof o[key] === 'string'), `${path}.${key}`, 'a string or null is required') ? o[key] as string | null : null);
  const list = (o: Json, key: string, path: string): readonly unknown[] =>
    (need(Array.isArray(o[key]), `${path}.${key}`, 'an array is required') ? o[key] as unknown[] : []);
  const objects = (o: Json, key: string, path: string): readonly Json[] =>
    list(o, key, path).filter((item, index) => need(isObject(item), `${path}.${key}[${String(index)}]`, 'an object is required')) as Json[];

  if (document.format !== JULIUS_CARRY_SOURCES_FORMAT) return refused(`sources_format: ${String(document.format)}`);
  if (document.runId === null) return refused('sources_run_unnamed: the manifest named no run this store holds');
  const runId = string(document, 'runId', '$');
  const projectId = string(document, 'projectId', '$');
  const missionId = string(document, 'missionId', '$');
  const state = string(document, 'state', '$');
  const tasks = objects(document, 'tasks', '$').map((task, index) => {
    const path = `$.tasks[${String(index)}]`;
    // OF THIS RUN: a task of another run can never vouch for this run's finding (P2b's run check, off-host).
    need(task.runId === runId, `${path}.runId`, `${String(task.runId)} is not the exported run ${runId}`);
    return { taskId: string(task, 'taskId', path), taskType: string(task, 'taskType', path), role: string(task, 'role', path), state: string(task, 'state', path) };
  });
  const findings = objects(document, 'findings', '$').map((row, index): JuliusReviewerFinding => {
    const path = `$.findings[${String(index)}]`;
    const severity = string(row, 'severity', path);
    const status = string(row, 'status', path);
    const evidenceIds = list(row, 'evidenceIds', path);
    need(evidenceIds.every((id) => typeof id === 'string' && id.length > 0), `${path}.evidenceIds`, 'every id must be a non-empty string');
    need(SEVERITIES.includes(severity as JuliusReviewerFinding['severity']), `${path}.severity`, `not a severity: ${severity}`);
    need(STATUSES.includes(status as JuliusReviewerFinding['status']), `${path}.status`, `not a status: ${status}`);
    need(typeof row.blocking === 'boolean', `${path}.blocking`, 'a boolean is required');
    const finding: JuliusReviewerFinding = {
      findingId: string(row, 'findingId', path), runId: string(row, 'runId', path), taskId: string(row, 'taskId', path),
      reviewerWorkerId: string(row, 'reviewerWorkerId', path), severity: severity as JuliusReviewerFinding['severity'],
      category: string(row, 'category', path), claim: string(row, 'claim', path), criterionId: nullableString(row, 'criterionId', path),
      evidenceIds: evidenceIds as string[], blocking: row.blocking === true, status: status as JuliusReviewerFinding['status'],
      createdAt: string(row, 'createdAt', path),
    };
    need(finding.runId === runId, `${path}.runId`, `${finding.runId} is not the exported run ${runId}`);
    return finding;
  });
  let previous = -Infinity;
  const ledger = objects(document, 'ledger', '$').map((row, index): JuliusPeerLedgerEntry => {
    const path = `$.ledger[${String(index)}]`;
    const sequence = typeof row.sequence === 'number' ? row.sequence : Number.NaN;
    need(Number.isFinite(sequence) && sequence > previous, `${path}.sequence`, 'must rise strictly: the fold reads ledger order');
    previous = sequence;
    const type = string(row, 'type', path);
    need(LEDGER_TYPES.includes(type), `${path}.type`, `not a finding ledger row: ${type}`);
    const facts = need(isObject(row.facts), `${path}.facts`, 'an object is required') ? row.facts as Json : {};
    for (const [key, value] of Object.entries(facts)) {
      need(['string', 'number', 'boolean'].includes(typeof value), `${path}.facts.${key}`, 'a string, number or boolean is required');
    }
    return { type, taskId: nullableString(row, 'taskId', path), facts: facts as JuliusPeerLedgerEntry['facts'] };
  });
  if (problems.length > 0) return refused(`sources_field: ${problems[0]!}${problems.length > 1 ? ` (+${String(problems.length - 1)} more)` : ''}`);
  return { ok: true, value: { runId, projectId, missionId, state, tasks, findings, ledger } };
}

const FOOTER = /^\((\d+) rows?\)$/u;

/**
 * ONE DUMP TABLE, READ STRICTLY (`psql -A -F '\t'`: header, rows, one `(N rows)`
 * footer). A table the dump could not write, a ragged row, or a footer that
 * disagrees with the rows read is refused: the reader never guesses.
 */
export function parseJuliusDumpTable(text: string): JuliusCarryParsed<readonly Readonly<Record<string, string>>[]> {
  const lines = text.split('\n').map((line) => line.replace(/\r$/u, '')).filter((line) => line !== '');
  if (lines.length === 0) return refused('table_empty');
  if (lines.some((line) => line.trim() === 'unavailable')) return refused('table_unavailable');
  const footers = lines.filter((line) => FOOTER.test(line));
  if (footers.length !== 1) return refused(`table_footers: ${String(footers.length)}`);
  const [header, ...data] = lines.filter((line) => !FOOTER.test(line)).map((line) => line.split('\t'));
  if (header === undefined) return refused('table_no_header');
  if (data.some((cells) => cells.length !== header.length)) return refused('table_ragged_row');
  const count = Number(FOOTER.exec(footers[0]!)![1]);
  if (count !== data.length) return refused(`table_footer: says ${String(count)}, ${String(data.length)} read`);
  return { ok: true, value: data.map((cells) => Object.freeze(Object.fromEntries(header.map((name, index) => [name, cells[index]!])))) };
}

/**
 * WHAT ARM WITH CARRIES, RE-DERIVED from WITHOUT's exported rows alone, by the production rule. ONE derivation for
 * the chain verifier and the preview, so what the preview promises before WITH runs is what the verifier holds WITH to.
 */
function rederive(input: {
  readonly sources: JuliusCarrySources;
  readonly withRunId: string;
  readonly scope: JuliusCarryScope;
  readonly limit: number;
  readonly sha256: (text: string) => string;
}) {
  const { sources } = input;
  const lives = new Map(foldJuliusFindings(sources.findings, sources.ledger).map((life) => [life.findingId, life] as const));
  const taskOf = new Map(sources.tasks.map((task) => [task.taskId, task] as const));
  const plan = planJuliusKnowledgeCarry({
    runId: input.withRunId, projectId: sources.projectId, missionId: sources.missionId, scope: input.scope,
    sourceRuns: [{ runId: sources.runId, state: sources.state }],
    // The store's own builder: the same life, the same judged work, the same tasks the life names (P2b's provenance).
    findings: sources.findings.map((finding) =>
      juliusCarryFindingCandidate({ runId: sources.runId, finding, life: lives.get(finding.findingId), taskOf: (taskId) => taskOf.get(taskId) })),
    architectures: [], brain: [], limit: input.limit,
  });
  const digestOf = new Map(plan.carried.map((item) => [item.entryId, input.sha256(item.text)] as const));
  const expected = juliusKnowledgeCarryFacts(plan, Object.fromEntries([...digestOf].map(([entryId, hex]) => [entryId, `sha256:${hex}`])));
  return { plan, digestOf, expected };
}

/** The carried items that count for Decision C: verified repair findings of arm WITHOUT itself. */
const verifiedRepairFindingsOf = (plan: ReturnType<typeof rederive>['plan'], withoutRunId: string) =>
  plan.carried.filter((item) => item.source === 'VERIFIED_REPAIR_FINDING' && item.sourceRunId === withoutRunId);

export interface JuliusCarryPreview {
  /** CARRIES: arm WITH will inherit >= 1 verified repair finding of this WITHOUT. EMPTY: it will inherit none. */
  readonly verdict: 'CARRIES' | 'EMPTY';
  readonly withoutRunId: string;
  readonly withRunId: string;
  readonly scopeTaskId: string;
  readonly eligible: number;
  /** The carriedEntries WITH's `knowledge.carried` record must hold: what the chain verifier will re-derive. */
  readonly carriedEntries: string;
  /** Each verified repair finding WITH will carry, with the full digest of the exact text its copy must hold. */
  readonly carries: readonly { readonly entryId: string; readonly findingId: string; readonly digest: string }[];
  /** Every finding of WITHOUT the rule leaves behind, with the rule's reason. */
  readonly excluded: readonly { readonly findingId: string; readonly reason: string }[];
}

/**
 * THE PROCEDURE GATE, BEFORE ARM WITH IS DISPATCHED (SECOND's ruling (a)). From arm WITHOUT's bundle alone and the
 * WITH run id the registration fixes before any run, it says what WITH's bootstrap will carry: each verified repair
 * finding, its copy's entry id and the digest of its exact text. EMPTY means the pair is INVALID and WITH is never
 * dispatched. After WITH runs, the chain verifier must prove these same entries made the whole trip.
 */
export function previewJuliusCarry(input: {
  readonly sources: JuliusCarrySources;
  readonly withRunId: string;
  /** WITH's plan task: the bootstrap scopes every copy to it (`planTaskId` in relay-bridge/julius/bootstrap.ts). */
  readonly scopeTaskId: string;
  readonly limit: number;
  readonly sha256: (text: string) => string;
}): JuliusCarryPreview {
  const scope: JuliusCarryScope = { taskId: input.scopeTaskId, taskType: 'plan', role: 'PROMPT_ARCHITECT' };
  const { plan, digestOf, expected } = rederive({ sources: input.sources, withRunId: input.withRunId, scope, limit: input.limit, sha256: input.sha256 });
  const vrfs = verifiedRepairFindingsOf(plan, input.sources.runId);
  return {
    verdict: vrfs.length >= 1 ? 'CARRIES' : 'EMPTY',
    withoutRunId: input.sources.runId,
    withRunId: input.withRunId,
    scopeTaskId: input.scopeTaskId,
    eligible: plan.eligible,
    carriedEntries: String(expected.carriedEntries ?? ''),
    carries: vrfs.map((item) => ({ entryId: item.entryId, findingId: item.sourceRef, digest: `sha256:${digestOf.get(item.entryId)!}` })),
    excluded: plan.excluded.map((item) => ({ findingId: item.sourceRef, reason: item.reason })),
  };
}

/** Which carried tokens differ, and how, without printing a whole record twice. */
function entriesDiff(recorded: string, expected: string): string {
  const got = recorded === '' ? [] : recorded.split(';');
  const want = expected === '' ? [] : expected.split(';');
  const differ = want.filter((token, index) => got[index] !== token).length + Math.max(0, got.length - want.length);
  return differ === 0 ? `${String(want.length)} token(s) equal` : `${String(differ)} of ${String(Math.max(got.length, want.length))} token(s) differ from the re-derived record`;
}

/**
 * VERIFY ONE ARM WITH AGAINST ITS ARM WITHOUT. `knowledge`, `copies` and `tasks`
 * are WITH's `knowledge-carry.tsv`, `carry-copies.tsv` and `tasks.tsv` rows;
 * `limit` is the bootstrap's packet bound (`JULIUS_CARRIED_KNOWLEDGE_LIMIT`).
 */
export function verifyJuliusCarryChain(input: {
  readonly sources: JuliusCarrySources;
  readonly withRunId: string;
  readonly knowledge: readonly Readonly<Record<string, string>>[];
  readonly copies: readonly Readonly<Record<string, string>>[];
  readonly tasks: readonly Readonly<Record<string, string>>[];
  readonly limit: number;
  readonly sha256: (text: string) => string;
}): JuliusCarryChainVerdict {
  const { sources, withRunId } = input;
  const checks: JuliusCarryChainCheck[] = [];
  const check = (name: string, ok: boolean, detail: string): boolean => {
    checks.push({ check: name, ok, detail });
    return ok;
  };
  check('arms_distinct', sources.runId !== withRunId, `WITHOUT ${sources.runId}, WITH ${withRunId}`);

  // (2) THE RECORD: one knowledge.carried row on WITH's stream, of this rule's version, CARRIED, whole, from WITHOUT only.
  const records = input.knowledge.filter((row) => row.run_id === withRunId && row.event_type === 'julius.knowledge.carried');
  check('record_one', records.length === 1, `${String(records.length)} knowledge.carried row(s) on ${withRunId}`);
  const record: Readonly<Record<string, string>> = records[0] ?? {};
  check('record_version', record.carry_version === JULIUS_KNOWLEDGE_CARRY_VERSION, `carry_version ${record.carry_version ?? 'absent'}`);
  check('record_carried', record.outcome === 'CARRIED', `outcome ${record.outcome ?? 'absent'}`);
  check('record_whole', record.entries_truncated === 'false', `entries_truncated ${record.entries_truncated ?? 'absent'}`);
  check('record_sources', record.source_run_ids === sources.runId, `source_run_ids ${record.source_run_ids ?? 'absent'}; arm WITHOUT is ${sources.runId}`);

  // THE SCOPE: WITH's plan task, as WITH's own tasks name it.
  const scopeTaskId = record.scope_task_id ?? '';
  const planTask = input.tasks.find((row) => row.run_id === withRunId && row.task_id === scopeTaskId);
  check('scope_plan', planTask?.task_type === 'plan' && planTask.role === 'PROMPT_ARCHITECT'
    && record.scope_task_type === 'plan' && record.scope_role === 'PROMPT_ARCHITECT', `scope ${scopeTaskId === '' ? 'absent' : scopeTaskId}`);
  const scope: JuliusCarryScope = { taskId: scopeTaskId, taskType: 'plan', role: 'PROMPT_ARCHITECT' };

  // (1) -> (2), RE-DERIVED: what WITH should have carried, from WITHOUT's exported rows alone, by the production rule.
  const { plan, digestOf, expected } = rederive({ sources, withRunId, scope, limit: input.limit, sha256: input.sha256 });
  check('record_eligible', record.eligible === String(expected.eligible), `recorded ${record.eligible ?? 'absent'}, re-derived ${String(expected.eligible)}`);
  const entries = String(expected.carriedEntries ?? '');
  check('record_entries', (record.carried_entries ?? '') === entries, entriesDiff(record.carried_entries ?? '', entries));

  // (3) THE COPIES: each on WITH's stream, scoped to the plan, holding the text the record bound, and no other.
  const copies = input.copies.filter((row) => row.run_id === withRunId);
  for (const item of plan.carried) {
    const copy = copies.find((row) => row.entry_id === item.entryId);
    check(`copy ${item.entryId}`, copy !== undefined && copy.task_id === scope.taskId && copy.content_sha256 === digestOf.get(item.entryId),
      copy === undefined ? 'absent from carry-copies.tsv' : `task ${copy.task_id ?? 'absent'}, content_sha256 ${copy.content_sha256 ?? 'absent'}`);
  }
  check('copies_exact', copies.length === plan.carried.length, `${String(copies.length)} carried row(s) on ${withRunId}; the rule carries ${String(plan.carried.length)}`);

  // (4) THE RECEIPTS: every planner compile of WITH's plan admitted every owed row and missed none.
  const receipts = input.knowledge.filter((row) => row.run_id === withRunId && row.event_type === 'julius.knowledge.consumed' && row.task_id === scope.taskId);
  check('receipts_present', receipts.length > 0, `${String(receipts.length)} knowledge.consumed row(s) for ${scope.taskId}`);
  for (const [index, receipt] of receipts.entries()) {
    const admitted = (receipt.admitted_entry_ids ?? '') === '' ? [] : (receipt.admitted_entry_ids ?? '').split(' ');
    check(`receipt ${String(index + 1)}`, receipt.role === 'PROMPT_ARCHITECT' && receipt.task_type === 'plan' && receipt.missing === '0'
      && receipt.admitted === receipt.in_scope && plan.carried.every((item) => admitted.includes(item.entryId)),
      `in_scope ${receipt.in_scope ?? 'absent'}, admitted ${receipt.admitted ?? 'absent'}, missing ${receipt.missing ?? 'absent'}`);
  }

  // THE POINT OF IT: at least one verified repair finding of arm WITHOUT made the whole trip.
  const vrfs = verifiedRepairFindingsOf(plan, sources.runId);
  check('vrf_carried', vrfs.length >= 1, `${String(vrfs.length)} verified repair finding(s) of ${sources.runId}`);
  const pass = checks.every((item) => item.ok);
  return {
    verdict: pass ? 'PASS' : 'FAIL',
    withoutRunId: sources.runId,
    withRunId,
    checks,
    proven: pass ? vrfs.map((item) => ({ entryId: item.entryId, findingId: item.sourceRef, digest: `sha256:${digestOf.get(item.entryId)!}` })) : [],
  };
}
