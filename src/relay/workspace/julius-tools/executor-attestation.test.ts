import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { canonicalExecutorAttestation, signExecutorAttestation, verifyExecutorAttestation, type ExecutorAttestation } from './executor-attestation';

const identity = { phase: 'AFTER', executionIdentity: 'exec:inv:7', invocationId: 'inv', dispatchGeneration: 7, sandboxId: 'box', requestDigest: 'a'.repeat(64), receiptDigest: 'b'.repeat(64) } as const;

describe('independent executor attestation', () => {
  it('accepts an executor signature with a rotated trusted key ring', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const attestation: ExecutorAttestation = { version: 1, keyId: 'executor-2026-08', issuedAt: new Date().toISOString(), ...identity };
    const signed = signExecutorAttestation(attestation, privateKey);
    expect(() => verifyExecutorAttestation(signed, new Map([['old', publicKey], [attestation.keyId, publicKey]]), identity)).not.toThrow();
  });

  it.each(['receiptDigest', 'invocationId', 'sandboxId', 'requestDigest', 'dispatchGeneration'] as const)('rejects hostile orchestrator substitution of %s', field => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const attestation: ExecutorAttestation = { version: 1, keyId: 'executor', issuedAt: new Date().toISOString(), ...identity };
    const signed = signExecutorAttestation(attestation, privateKey);
    const changed = { ...signed, attestation: { ...signed.attestation, [field]: field === 'dispatchGeneration' ? 8 : 'c'.repeat(64) } };
    expect(() => verifyExecutorAttestation(changed, new Map([['executor', publicKey]]), identity)).toThrow(/scope_mismatch|signature_invalid/);
  });

  it('rejects forged, unknown-key, and extra-field receipts', () => {
    const trusted = generateKeyPairSync('ed25519');
    const hostile = generateKeyPairSync('ed25519');
    const attestation: ExecutorAttestation = { version: 1, keyId: 'executor', issuedAt: new Date().toISOString(), ...identity };
    const forged = signExecutorAttestation(attestation, hostile.privateKey);
    expect(() => verifyExecutorAttestation(forged, new Map([['executor', trusted.publicKey]]), identity)).toThrow('executor_attestation_signature_invalid');
    expect(() => verifyExecutorAttestation(forged, new Map(), identity)).toThrow('executor_attestation_unknown_key');
    expect(() => canonicalExecutorAttestation({ ...attestation, secret: 'ambiguous' } as ExecutorAttestation)).toThrow('executor_attestation_fields_invalid');
  });
});
