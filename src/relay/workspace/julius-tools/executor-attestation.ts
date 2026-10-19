import { createHash, sign, verify, type KeyObject } from 'node:crypto';

export type ExecutorReceiptPhase = 'BEFORE' | 'AFTER';

export interface ExecutorAttestation {
  readonly version: 1;
  readonly keyId: string;
  readonly phase: ExecutorReceiptPhase;
  readonly executionIdentity: string;
  readonly invocationId: string;
  readonly dispatchGeneration: number;
  readonly sandboxId: string;
  readonly requestDigest: string;
  readonly receiptDigest: string;
  readonly issuedAt: string;
}

export interface SignedExecutorAttestation {
  readonly attestation: ExecutorAttestation;
  readonly signature: string;
}

const KEYS = ['dispatchGeneration', 'executionIdentity', 'invocationId', 'issuedAt', 'keyId', 'phase', 'receiptDigest', 'requestDigest', 'sandboxId', 'version'] as const;
const text = (value: string) => `${Buffer.byteLength(value, 'utf8')}:${value}`;

/** Length-prefixed, fixed-field encoding. Unknown, missing, and reordered JSON fields cannot alter the signed meaning. */
export function canonicalExecutorAttestation(value: ExecutorAttestation): Buffer {
  const record = value as unknown as Record<string, unknown>;
  if (Object.keys(record).sort().join('\0') !== [...KEYS].sort().join('\0')) throw new Error('executor_attestation_fields_invalid');
  if (value.version !== 1 || !Number.isSafeInteger(value.dispatchGeneration) || value.dispatchGeneration < 1) throw new Error('executor_attestation_version_invalid');
  for (const key of KEYS.filter(key => key !== 'version' && key !== 'dispatchGeneration')) {
    if (typeof record[key] !== 'string' || !(record[key] as string).length) throw new Error(`executor_attestation_field_invalid:${key}`);
  }
  if (!/^[a-f0-9]{64}$/.test(value.requestDigest) || !/^[a-f0-9]{64}$/.test(value.receiptDigest)) throw new Error('executor_attestation_digest_invalid');
  if (!Number.isFinite(Date.parse(value.issuedAt))) throw new Error('executor_attestation_time_invalid');
  return Buffer.from(KEYS.map(key => text(String(record[key]))).join('|'));
}

export const receiptDigest = (body: string | Uint8Array) => createHash('sha256').update(body).digest('hex');

export function signExecutorAttestation(attestation: ExecutorAttestation, privateKey: KeyObject): SignedExecutorAttestation {
  return { attestation, signature: sign(null, canonicalExecutorAttestation(attestation), privateKey).toString('base64url') };
}

export function verifyExecutorAttestation(
  signed: SignedExecutorAttestation,
  trustedKeys: ReadonlyMap<string, KeyObject>,
  expected: Omit<ExecutorAttestation, 'version' | 'keyId' | 'issuedAt'>,
): void {
  const key = trustedKeys.get(signed.attestation.keyId);
  if (!key) throw new Error('executor_attestation_unknown_key');
  for (const [field, value] of Object.entries(expected)) {
    if ((signed.attestation as unknown as Record<string, unknown>)[field] !== value) throw new Error(`executor_attestation_scope_mismatch:${field}`);
  }
  let signature: Buffer;
  try { signature = Buffer.from(signed.signature, 'base64url'); } catch { throw new Error('executor_attestation_signature_invalid'); }
  if (!verify(null, canonicalExecutorAttestation(signed.attestation), key, signature)) throw new Error('executor_attestation_signature_invalid');
}
