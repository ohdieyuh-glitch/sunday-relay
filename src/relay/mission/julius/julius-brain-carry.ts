import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { canonicalJuliusBrainJson, juliusBrainSha256 } from './julius-brain-contracts';
import { checkJuliusBrainExportForRestore, type JuliusBrainExportBundle } from './julius-brain-export';

/**
 * THE TEMPORARY BRAIN CARRY — A STOPGAP, NOT A PERSISTENCE ARCHITECTURE.
 *
 * The Project Brain's canonical home is a dedicated persistent PostgreSQL.
 * Until that exists, a live Brain that must span disposable jobs is carried
 * between them as a sealed export. Nothing here is permanent behaviour: it
 * does not know about artifact retention, and nothing may depend on it once the
 * durable database is in service. It exists to make the approved transition
 * path exact:
 *
 *   job start → obtain the prior sealed carry → verify → restore → execute
 *   → checkpoint/export → seal → verify the export → upload → confirm the
 *   upload → only then may disposable state be destroyed.
 *
 * WHAT A CARRY PROVES.
 *   integrity    the export bundle re-derives its own hash, ledger and state
 *                (`checkJuliusBrainExportForRestore`), and every artifact byte
 *                it names travels with it and re-hashes;
 *   authenticity an HMAC-SHA256 seal under a key the jobs hold and the carry
 *                never contains — a self-consistent bundle anyone could write
 *                is not enough;
 *   lineage      the carry names the carry it extends, and its ledger holds
 *                that carry's head at that sequence — a fork or a rollback
 *                to an older carry is refused against the floor the opener
 *                supplies.
 * WHAT IT DOES NOT: a symmetric seal proves possession of the key, not which
 * job used it; and without a durable pointer the newest carry is whatever the
 * opener is told it is. Both end when the durable database exists.
 *
 * PRESERVED IS CLAIMED ONLY AT THE END OF THE JOURNAL. An export that did not
 * verify, an upload that did not confirm the exact digest, any step out of
 * order — the Brain is NOT preserved, and disposable state must not be
 * destroyed as though it were.
 */

export const JULIUS_BRAIN_CARRY_FORMAT = 'julius-brain-carry.v1' as const;
const CAS = 'cas://sha256/';

export interface JuliusBrainCarryKey {
  readonly keyId: string;
  /** At least 32 bytes of secret. Never written into a carry. */
  readonly secret: Uint8Array;
}

export interface JuliusBrainCarryHead {
  readonly bundleHash: string;
  readonly sequence: number;
  readonly chainHash: string;
}

export interface JuliusBrainCarry {
  readonly format: typeof JULIUS_BRAIN_CARRY_FORMAT;
  readonly purpose: 'TEMPORARY_CARRY';
  readonly environment: 'development' | 'test' | 'production';
  readonly brain: { readonly brainId: string; readonly projectId: string };
  readonly head: JuliusBrainCarryHead;
  readonly content: readonly { readonly contentHash: string; readonly byteSize: number }[];
  readonly previous: JuliusBrainCarryHead | null;
  readonly producedBy: { readonly workflowRunId: string; readonly workflowRunAttempt: number; readonly acceptedMainSha: string } | null;
  readonly createdAt: string;
  readonly seal: { readonly algorithm: 'HMAC-SHA256'; readonly keyId: string; readonly mac: string };
}

export interface JuliusBrainCarryPayload {
  readonly bundle: JuliusBrainExportBundle;
  readonly content: readonly { readonly contentHash: string; readonly bytes: Uint8Array }[];
}

const sha256OfBytes = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const bytesOfHex = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const macOf = (key: JuliusBrainCarryKey, unsealed: Omit<JuliusBrainCarry, 'seal'>): string =>
  createHmac('sha256', key.secret).update(canonicalJuliusBrainJson(unsealed)).digest('hex');

/** The identity of a sealed carry: what an upload must be confirmed against. */
export const juliusBrainCarryDigest = (carry: JuliusBrainCarry): string => juliusBrainSha256(canonicalJuliusBrainJson(carry));

/** Artifact bytes a restored Brain would claim to hold: every ARTIFACT naming `cas://sha256/`. */
function contentReferenced(bundle: JuliusBrainExportBundle): string[] {
  const hashes = new Set<string>();
  for (const state of bundle.entities) {
    if (state.kind !== 'ARTIFACT') continue;
    const ref = state.body.storageRef;
    if (typeof ref === 'string' && ref.startsWith(CAS)) hashes.add(`sha256:${ref.slice(CAS.length)}`);
  }
  return [...hashes].sort();
}

/** The previous carry's head must be this ledger's history at that sequence. */
function extendsPrevious(bundle: JuliusBrainExportBundle, previous: JuliusBrainCarryHead): boolean {
  if (previous.sequence === 0) return true;
  const record = bundle.records[previous.sequence - 1];
  return record !== undefined && record.sequence === previous.sequence && record.chainHash === previous.chainHash && bundle.head.sequence >= previous.sequence;
}

function checkKey(key: JuliusBrainCarryKey): void {
  if (!key.keyId.trim() || key.secret.byteLength < 32) throw new Error('julius_brain_carry_key_invalid');
}

export function sealJuliusBrainCarry(input: {
  readonly payload: JuliusBrainCarryPayload;
  readonly environment: JuliusBrainCarry['environment'];
  readonly previous: JuliusBrainCarryHead | null;
  readonly producedBy: JuliusBrainCarry['producedBy'];
  readonly createdAt: string;
  readonly key: JuliusBrainCarryKey;
  readonly maxContentBytes?: number;
}): JuliusBrainCarry {
  checkKey(input.key);
  const { bundle } = input.payload;
  // Never seal what would not restore.
  const check = checkJuliusBrainExportForRestore(bundle);
  if (!check.ok) throw new Error(`julius_brain_carry_bundle_not_restorable:${check.reasonCode}`);
  if (input.previous !== null && !extendsPrevious(bundle, input.previous)) throw new Error('julius_brain_carry_does_not_extend_previous');
  const supplied = new Map(input.payload.content.map((item) => [item.contentHash, item.bytes]));
  const manifest: { contentHash: string; byteSize: number }[] = [];
  let total = 0;
  for (const contentHash of contentReferenced(bundle)) {
    const bytes = supplied.get(contentHash);
    if (bytes === undefined) throw new Error(`julius_brain_carry_content_missing:${contentHash}`);
    if (sha256OfBytes(bytes) !== contentHash) throw new Error(`julius_brain_carry_content_integrity:${contentHash}`);
    total += bytes.byteLength;
    manifest.push({ contentHash, byteSize: bytes.byteLength });
  }
  if (total > (input.maxContentBytes ?? 256 * 1024 * 1024)) throw new Error('julius_brain_carry_too_large');
  const unsealed: Omit<JuliusBrainCarry, 'seal'> = {
    format: JULIUS_BRAIN_CARRY_FORMAT, purpose: 'TEMPORARY_CARRY', environment: input.environment,
    brain: { brainId: bundle.brain.brainId, projectId: bundle.brain.projectId },
    head: { bundleHash: bundle.bundleHash, sequence: bundle.head.sequence, chainHash: bundle.head.chainHash },
    content: manifest, previous: input.previous, producedBy: input.producedBy, createdAt: input.createdAt,
  };
  return { ...unsealed, seal: { algorithm: 'HMAC-SHA256', keyId: input.key.keyId, mac: macOf(input.key, unsealed) } };
}

export type JuliusBrainCarryOpen =
  | { readonly outcome: 'OPENED'; readonly carry: JuliusBrainCarry; readonly payload: JuliusBrainCarryPayload }
  | { readonly outcome: 'REFUSED'; readonly reasons: readonly string[] };

export function openJuliusBrainCarry(input: {
  readonly carry: JuliusBrainCarry;
  readonly payload: JuliusBrainCarryPayload;
  readonly key: JuliusBrainCarryKey;
  readonly expect: {
    readonly brainId: string;
    readonly projectId: string;
    readonly environment: JuliusBrainCarry['environment'];
    /** The lowest head sequence acceptable: a carry older than this is a rollback. */
    readonly minimumSequence: number;
  };
}): JuliusBrainCarryOpen {
  checkKey(input.key);
  const { carry, payload, expect } = input;
  const reasons: string[] = [];
  if (carry.format !== JULIUS_BRAIN_CARRY_FORMAT || carry.purpose !== 'TEMPORARY_CARRY') return { outcome: 'REFUSED', reasons: ['format: not a julius-brain-carry.v1'] };

  // Authenticity first: nothing else in an unauthenticated carry is worth reading.
  const { seal, ...unsealed } = carry;
  const expected = bytesOfHex(macOf(input.key, unsealed));
  const given = bytesOfHex(typeof seal?.mac === 'string' && /^[0-9a-f]{64}$/.test(seal.mac) ? seal.mac : '');
  if (seal?.algorithm !== 'HMAC-SHA256' || seal.keyId !== input.key.keyId || given.byteLength !== expected.byteLength || !timingSafeEqual(given, expected)) {
    return { outcome: 'REFUSED', reasons: ['seal: not sealed by this key'] };
  }

  if (carry.environment !== expect.environment) reasons.push(`environment: carry is ${carry.environment}, expected ${expect.environment}`);
  if (carry.brain.brainId !== expect.brainId || carry.brain.projectId !== expect.projectId) reasons.push('brain: carry is for another Brain or project');
  if (carry.head.sequence < expect.minimumSequence) reasons.push(`rollback: carry head ${carry.head.sequence} is below the known floor ${expect.minimumSequence}`);

  const check = checkJuliusBrainExportForRestore(payload.bundle);
  if (!check.ok) reasons.push(`bundle: ${check.reasonCode}`);
  if (payload.bundle.bundleHash !== carry.head.bundleHash) reasons.push('bundle: not the bundle this carry sealed');
  if (payload.bundle.brain.brainId !== carry.brain.brainId || payload.bundle.brain.projectId !== carry.brain.projectId) reasons.push('bundle: identity differs from the carry');
  if (payload.bundle.head.sequence !== carry.head.sequence || payload.bundle.head.chainHash !== carry.head.chainHash) reasons.push('bundle: head differs from the carry');
  if (carry.previous !== null && check.ok && !extendsPrevious(payload.bundle, carry.previous)) reasons.push('lineage: the ledger does not extend the carry it names');

  const supplied = new Map(payload.content.map((item) => [item.contentHash, item.bytes]));
  const manifest = new Map(carry.content.map((item) => [item.contentHash, item.byteSize]));
  for (const [contentHash, byteSize] of manifest) {
    const bytes = supplied.get(contentHash);
    if (bytes === undefined) reasons.push(`content: ${contentHash} missing`);
    else if (bytes.byteLength !== byteSize || sha256OfBytes(bytes) !== contentHash) reasons.push(`content: ${contentHash} does not match`);
  }
  for (const contentHash of supplied.keys()) if (!manifest.has(contentHash)) reasons.push(`content: ${contentHash} is not in the sealed manifest`);
  if (check.ok) for (const contentHash of contentReferenced(payload.bundle)) if (!manifest.has(contentHash)) reasons.push(`content: ${contentHash} is referenced but was not carried`);

  return reasons.length === 0 ? { outcome: 'OPENED', carry, payload } : { outcome: 'REFUSED', reasons };
}

/* ------------------------------------------------------------ the journal */

export const JULIUS_BRAIN_CARRY_STEPS = ['STARTED', 'PRIOR_VERIFIED', 'RESTORED', 'EXECUTED', 'EXPORTED', 'EXPORT_VERIFIED', 'UPLOAD_CONFIRMED'] as const;
export type JuliusBrainCarryStep = typeof JULIUS_BRAIN_CARRY_STEPS[number];

export interface JuliusBrainCarryJournalStatus {
  readonly step: JuliusBrainCarryStep;
  readonly failed: { readonly at: JuliusBrainCarryStep; readonly reason: string } | null;
  readonly carryDigest: string | null;
  readonly preserved: boolean;
  readonly mayDestroyDisposableState: boolean;
}

/**
 * One job's carry, in the only order that preserves a Brain. Every step names
 * the evidence it rests on; a step out of order, or a failure anywhere, ends
 * the journal NOT preserved. There is no path back from a failure.
 */
export function createJuliusBrainCarryJournal() {
  let step: JuliusBrainCarryStep = 'STARTED';
  let failed: JuliusBrainCarryJournalStatus['failed'] = null;
  let carryDigest: string | null = null;
  let exported: JuliusBrainCarry | null = null;

  const advance = (from: JuliusBrainCarryStep, to: JuliusBrainCarryStep): boolean => {
    if (failed !== null) return false;
    if (step !== from) { failed = { at: step, reason: `out of order: ${to} after ${step}` }; return false; }
    step = to;
    return true;
  };
  const fail = (reason: string) => { if (failed === null) failed = { at: step, reason }; };

  return {
    /** A prior carry opened; or, only when a new Brain is explicitly authorised, none. */
    priorVerified(evidence: JuliusBrainCarryOpen | { readonly outcome: 'GENESIS_AUTHORIZED' }): boolean {
      if (evidence.outcome === 'REFUSED') { fail(`prior carry refused: ${evidence.reasons.join('; ')}`); return false; }
      return advance('STARTED', 'PRIOR_VERIFIED');
    },
    restored(evidence: { readonly outcome: 'RESTORED' | 'REFUSED' | 'GENESIS'; readonly detail?: string }): boolean {
      if (evidence.outcome === 'REFUSED') { fail(`restore refused: ${evidence.detail ?? 'unknown'}`); return false; }
      return advance('PRIOR_VERIFIED', 'RESTORED');
    },
    executed(): boolean {
      return advance('RESTORED', 'EXECUTED');
    },
    exported(carry: JuliusBrainCarry | { readonly error: string }): boolean {
      if ('error' in carry) { fail(`export failed: ${carry.error}`); return false; }
      if (!advance('EXECUTED', 'EXPORTED')) return false;
      exported = carry;
      carryDigest = juliusBrainCarryDigest(carry);
      return true;
    },
    /** The export, read back from what was written and opened as the next job would open it. */
    exportVerified(evidence: JuliusBrainCarryOpen): boolean {
      if (evidence.outcome === 'REFUSED') { fail(`export did not verify: ${evidence.reasons.join('; ')}`); return false; }
      if (exported === null || juliusBrainCarryDigest(evidence.carry) !== carryDigest) { fail('export verified a different carry than was sealed'); return false; }
      return advance('EXPORTED', 'EXPORT_VERIFIED');
    },
    /** The digest the artifact store reports for what it now holds — never the digest the job meant to send. */
    uploadConfirmed(evidence: { readonly storedDigest: string | null }): boolean {
      if (evidence.storedDigest === null || evidence.storedDigest !== carryDigest) {
        fail(`upload not confirmed: stored ${evidence.storedDigest ?? 'nothing'}, sealed ${carryDigest ?? 'nothing'}`);
        return false;
      }
      return advance('EXPORT_VERIFIED', 'UPLOAD_CONFIRMED');
    },
    status(): JuliusBrainCarryJournalStatus {
      const preserved = failed === null && step === 'UPLOAD_CONFIRMED';
      return { step, failed, carryDigest, preserved, mayDestroyDisposableState: preserved };
    },
  };
}
