import { createHash } from 'node:crypto';

import { brainMayWrite, brainOwnershipOf, type BrainSystem, type BrainTruthDomain } from './brain-ownership';
import { parseBrainScope, type BrainScopeKey } from './brain-attempt-identity';

/**
 * THE BRAIN LEDGER: EVERY DURABLE FACT, IN THE ORDER IT WAS STATED, HASHED.
 *
 * Project Brain owns truth, which means it must be able to show its work. The
 * ledger is append-only and hash-chained: each record commits to the one before
 * it, so a record cannot be edited, removed or reordered after the fact without
 * the chain saying so. Nothing rewrites history; a change of truth is a new
 * record that supersedes an older one.
 *
 * WHAT MAY BE APPENDED IS DECIDED BY THE OWNERSHIP REGISTRY, not by the caller:
 *
 *   the domain's AUTHOR      appends a FACT
 *   a system that may PROPOSE appends a PROPOSAL, which is not yet truth
 *   anyone else              is refused, and the refusal names the author
 *
 * A PROPOSAL IS NOT A FACT. It sits in the ledger as what it is — someone's
 * statement awaiting the author — and only the author can turn it into a fact,
 * by appending one that references it. That is why `status` is on the record
 * rather than implied by who wrote it: a reader must never have to infer
 * authority from an author id.
 *
 * UNKNOWN STAYS UNKNOWN. `occurredAt` is when the thing happened, and it is
 * null when the stating system did not say. The Brain never substitutes the
 * moment it recorded something for the moment it happened; `recordedAt` is
 * kept separately and is never a stand-in.
 *
 * IDEMPOTENCY IS THE CALLER'S KEY, HONOURED BY THE STORE. The same key with the
 * same content is the same record — replaying a run appends nothing. The same
 * key with DIFFERENT content is a conflict and is refused, because two
 * different facts cannot both be that record.
 */

export const BRAIN_LEDGER_VERSION = 'brain-ledger.v1' as const;

export const BRAIN_RECORD_STATUSES = ['FACT', 'PROPOSAL', 'SUPERSEDED'] as const;
export type BrainRecordStatus = typeof BRAIN_RECORD_STATUSES[number];

export interface BrainRecordDraft {
  /** Which truth this is. The registry decides who may state it. */
  readonly domain: BrainTruthDomain;
  /** The record's subject, in the domain's own vocabulary (a decision, a finding, a sub-agent fact...). */
  readonly kind: string;
  /** Run or attempt scope, in Julius's terms (`brain-attempt-identity.ts`). */
  readonly scope: BrainScopeKey;
  readonly projectId: string;
  readonly missionId: string;
  /** The system stating it, and its identity within that system. */
  readonly author: BrainSystem;
  readonly authorId: string;
  /** The fact itself. Scalars only: a fact is stated, not serialised wholesale. */
  readonly payload: Readonly<Record<string, string | number | boolean | null>>;
  /** Evidence Julius already recorded. Ids, never copies. */
  readonly evidenceIds: readonly string[];
  /** When it happened, or null when the stating system did not say. */
  readonly occurredAt: string | null;
  /** The caller's key for "this same statement". */
  readonly idempotencyKey: string;
  /** A record this one replaces, which must already be in the ledger. */
  readonly supersedes?: string | null;
}

export interface BrainRecord extends Omit<BrainRecordDraft, 'supersedes'> {
  readonly recordId: string;
  readonly sequence: number;
  readonly status: BrainRecordStatus;
  readonly supersedes: string | null;
  /** When the Brain recorded it. Never a substitute for `occurredAt`. */
  readonly recordedAt: string;
  readonly previousHash: string | null;
  readonly hash: string;
}

export type BrainAppendRefusal =
  | 'not_an_author' | 'domain_not_durable' | 'scope_invalid' | 'payload_invalid' | 'identity_invalid'
  | 'idempotency_conflict' | 'supersedes_unknown' | 'supersedes_foreign';

export type BrainAppendResult =
  | { readonly outcome: 'APPENDED'; readonly record: BrainRecord }
  /** The same key with the same content: the first record stands, and nothing was written. */
  | { readonly outcome: 'DUPLICATE'; readonly record: BrainRecord }
  | { readonly outcome: 'REFUSED'; readonly reasonCode: BrainAppendRefusal; readonly detail: string };

const PAYLOAD_LIMIT = 8_192;
const KEY = /^[A-Za-z0-9_.:@+/-]{1,200}$/u;

/** Canonical JSON: keys sorted at every depth, so a re-serialisation is never a different fact. */
export function canonicalBrainJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.keys(input as Record<string, unknown>).sort().map((key) => [key, canonical((input as Record<string, unknown>)[key])]));
    }
    return input;
  };
  return JSON.stringify(canonical(value));
}

export const brainSha256 = (text: string): string => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

/** What a record commits to. `recordedAt` is included: when the Brain recorded it is part of the history. */
export const brainRecordHashInput = (record: Omit<BrainRecord, 'hash'>): string => canonicalBrainJson({
  version: BRAIN_LEDGER_VERSION,
  recordId: record.recordId, sequence: record.sequence, domain: record.domain, kind: record.kind, status: record.status,
  scope: record.scope, projectId: record.projectId, missionId: record.missionId,
  author: record.author, authorId: record.authorId, payload: record.payload, evidenceIds: [...record.evidenceIds],
  occurredAt: record.occurredAt, recordedAt: record.recordedAt, supersedes: record.supersedes, previousHash: record.previousHash,
});

export function validateBrainDraft(draft: BrainRecordDraft): readonly string[] {
  const problems: string[] = [];
  if (parseBrainScope(draft.scope) === null) problems.push('scope: not a run or attempt scope');
  if (!KEY.test(draft.idempotencyKey)) problems.push('idempotencyKey: 1..200 characters of A-Z a-z 0-9 _ . : @ + / -');
  if (!KEY.test(draft.projectId)) problems.push('projectId: required');
  if (!KEY.test(draft.missionId)) problems.push('missionId: required');
  if (!KEY.test(draft.kind)) problems.push('kind: required');
  if (!KEY.test(draft.authorId)) problems.push('authorId: required');
  if (draft.occurredAt !== null && Number.isNaN(Date.parse(draft.occurredAt))) problems.push('occurredAt: an ISO timestamp, or null for Unknown');
  for (const [key, value] of Object.entries(draft.payload)) {
    if (value !== null && typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') problems.push(`payload.${key}: a scalar or null`);
  }
  if (canonicalBrainJson(draft.payload).length > PAYLOAD_LIMIT) problems.push(`payload: at most ${PAYLOAD_LIMIT} characters`);
  if (new Set(draft.evidenceIds).size !== draft.evidenceIds.length) problems.push('evidenceIds: duplicate reference');
  return problems;
}

/**
 * The next record, or the refusal. Pure: the caller supplies the ledger as it
 * stands, so the same inputs always give the same answer, on any store.
 */
export function appendBrainRecord(input: {
  readonly ledger: readonly BrainRecord[];
  readonly draft: BrainRecordDraft;
  readonly recordedAt: string;
  /** The record id to use when one is appended. Supplied so nothing here invents identity. */
  readonly recordId: string;
}): BrainAppendResult {
  const { draft, ledger } = input;
  const problems = validateBrainDraft(draft);
  if (problems.length > 0) {
    const scopeProblem = problems.find((problem) => problem.startsWith('scope:'));
    return { outcome: 'REFUSED', reasonCode: scopeProblem !== undefined ? 'scope_invalid' : 'payload_invalid', detail: problems.slice(0, 4).join('; ') };
  }
  if (!KEY.test(input.recordId)) return { outcome: 'REFUSED', reasonCode: 'identity_invalid', detail: 'recordId: required' };

  const authority = brainMayWrite(draft.author, draft.domain);
  if (!authority.ok) {
    return {
      outcome: 'REFUSED',
      reasonCode: authority.reasonCode === 'not_durable' ? 'domain_not_durable' : 'not_an_author',
      detail: authority.detail,
    };
  }
  const status: BrainRecordStatus = authority.as === 'AUTHOR' ? 'FACT' : 'PROPOSAL';

  // The same key twice: the same statement is the same record; a different one is a conflict.
  const held = ledger.find((record) => record.idempotencyKey === draft.idempotencyKey);
  if (held !== undefined) {
    const same = canonicalBrainJson({ domain: draft.domain, kind: draft.kind, scope: draft.scope, projectId: draft.projectId, missionId: draft.missionId, author: draft.author, authorId: draft.authorId, payload: draft.payload, evidenceIds: [...draft.evidenceIds], occurredAt: draft.occurredAt, supersedes: draft.supersedes ?? null })
      === canonicalBrainJson({ domain: held.domain, kind: held.kind, scope: held.scope, projectId: held.projectId, missionId: held.missionId, author: held.author, authorId: held.authorId, payload: held.payload, evidenceIds: [...held.evidenceIds], occurredAt: held.occurredAt, supersedes: held.supersedes });
    return same
      ? { outcome: 'DUPLICATE', record: held }
      : { outcome: 'REFUSED', reasonCode: 'idempotency_conflict', detail: `${draft.idempotencyKey} already records a different statement` };
  }

  // Superseding is how truth changes: the older record stays, and the newer one names it.
  const supersedes = draft.supersedes ?? null;
  if (supersedes !== null) {
    const target = ledger.find((record) => record.recordId === supersedes);
    if (target === undefined) return { outcome: 'REFUSED', reasonCode: 'supersedes_unknown', detail: `${supersedes} is not in this ledger` };
    if (target.domain !== draft.domain) return { outcome: 'REFUSED', reasonCode: 'supersedes_foreign', detail: `${supersedes} is ${target.domain}, not ${draft.domain}` };
    if (status !== 'FACT') return { outcome: 'REFUSED', reasonCode: 'not_an_author', detail: `only ${brainOwnershipOf(draft.domain).author} may supersede a ${draft.domain} record` };
  }

  const previous = ledger.at(-1) ?? null;
  const unhashed: Omit<BrainRecord, 'hash'> = {
    recordId: input.recordId, sequence: (previous?.sequence ?? 0) + 1, status,
    domain: draft.domain, kind: draft.kind, scope: draft.scope, projectId: draft.projectId, missionId: draft.missionId,
    author: draft.author, authorId: draft.authorId, payload: draft.payload, evidenceIds: [...draft.evidenceIds],
    occurredAt: draft.occurredAt, idempotencyKey: draft.idempotencyKey, supersedes,
    recordedAt: input.recordedAt, previousHash: previous?.hash ?? null,
  };
  return { outcome: 'APPENDED', record: { ...unhashed, hash: brainSha256(brainRecordHashInput(unhashed)) } };
}

export interface BrainLedgerVerification { readonly ok: boolean; readonly problems: readonly string[] }

/** Whether the ledger is the history it claims: sequence, links and hashes, in order. */
export function verifyBrainLedger(ledger: readonly BrainRecord[]): BrainLedgerVerification {
  const problems: string[] = [];
  let previous: BrainRecord | null = null;
  const seenKeys = new Set<string>();
  for (const record of ledger) {
    const expectedSequence = (previous?.sequence ?? 0) + 1;
    if (record.sequence !== expectedSequence) { problems.push(`record ${record.recordId}: sequence ${record.sequence}, expected ${expectedSequence}`); break; }
    if ((record.previousHash ?? null) !== (previous?.hash ?? null)) { problems.push(`record ${record.recordId}: does not follow ${previous?.recordId ?? 'the start of the ledger'}`); break; }
    const { hash, ...unhashed } = record;
    if (hash !== brainSha256(brainRecordHashInput(unhashed))) { problems.push(`record ${record.recordId}: its content does not match its hash`); break; }
    if (seenKeys.has(record.idempotencyKey)) { problems.push(`record ${record.recordId}: idempotency key ${record.idempotencyKey} appears twice`); break; }
    seenKeys.add(record.idempotencyKey);
    previous = record;
  }
  return { ok: problems.length === 0, problems };
}

/**
 * What the ledger currently says: the newest record per idempotency key, with
 * anything superseded marked. A projection, rebuilt from the records — never a
 * second truth that could drift from them.
 */
export function projectBrainLedger(ledger: readonly BrainRecord[]): readonly BrainRecord[] {
  const superseded = new Set(ledger.map((record) => record.supersedes).filter((value): value is string => value !== null));
  return ledger.map((record) => (superseded.has(record.recordId) ? { ...record, status: 'SUPERSEDED' as const } : record));
}

/** The current facts of a domain: what a reader should act on. Proposals and superseded records are not facts. */
export const brainFactsOf = (ledger: readonly BrainRecord[], domain: BrainTruthDomain): readonly BrainRecord[] =>
  projectBrainLedger(ledger).filter((record) => record.domain === domain && record.status === 'FACT');
