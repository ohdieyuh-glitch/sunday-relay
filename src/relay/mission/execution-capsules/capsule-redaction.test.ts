import { describe, expect, it } from 'vitest';

import {
  CAPSULE_T3,
  CLAUDE_ACTUAL,
  claudeImplementationInput,
  runningFixture,
  secretShapedMetadata,
} from './capsule-fixtures';
import {
  containsSecretShapedValue,
  redactCapsuleMetadata,
  redactCapsuleText,
  requireSecretFreeMetadata,
} from './capsule-redaction';
import { appendCapsuleTraceReference, findTraceReference } from './capsule-service';

describe('capsule redaction', () => {
  it('redacts secret-named keys, nested secrets, and secret-shaped values', () => {
    const redacted = redactCapsuleMetadata(secretShapedMetadata()) as {
      apiKey: string;
      nested: { AUTHORIZATION: string; keep: string };
      note: string;
      envName: string;
    };
    expect(redacted.apiKey).toBe('[redacted]');
    expect(redacted.nested.AUTHORIZATION).toBe('[redacted]');
    expect(redacted.nested.keep).toBe('plain value');
    expect(redacted.note).not.toContain('fixtureSecret123');
    // An environment-variable NAME is useful evidence and may remain.
    expect(redacted.envName).toBe('ANTHROPIC_API_KEY');
  });

  it('never mutates the metadata input', () => {
    const metadata = secretShapedMetadata();
    const snapshot = JSON.stringify(metadata);
    redactCapsuleMetadata(metadata);
    containsSecretShapedValue(metadata);
    requireSecretFreeMetadata(metadata, 'test');
    expect(JSON.stringify(metadata)).toBe(snapshot);
  });

  it('redacts free text through the shared redactor', () => {
    const redacted = redactCapsuleText('token=abcdef1234567890 was used');
    expect(redacted).not.toContain('abcdef1234567890');
    expect(redacted).toContain('[redacted]');
  });

  it('detects secret-shaped metadata for reject-on-secret call sites', () => {
    expect(containsSecretShapedValue(secretShapedMetadata())).toBe(true);
    expect(containsSecretShapedValue({ files: ['src/auth/session.ts'], count: 2 })).toBe(false);
  });

  it('rejects credentials where a capsule must never carry them', () => {
    const rejected = requireSecretFreeMetadata(secretShapedMetadata(), 'workspace', 'cap-1');
    expect(rejected.ok).toBe(false);
    if (rejected.ok) return;
    expect(rejected.error.code).toBe('SECRET_REDACTION_FAILED');
    expect(rejected.error.capsuleId).toBe('cap-1');

    const accepted = requireSecretFreeMetadata({ branch: 'auth-repair' }, 'workspace');
    expect(accepted.ok).toBe(true);
  });

  it('a stored capsule never contains a synthetic secret value', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const result = appendCapsuleTraceReference(running, {
      channel: 'toolEvents',
      reference: {
        referenceId: 'ref-secret',
        eventId: 'evt-secret',
        eventType: 'tool.invoked',
        occurredAt: CAPSULE_T3,
        actorId: 'relay-supervisor',
        source: 'relay_supervisor',
        metadata: secretShapedMetadata(),
      },
      at: CAPSULE_T3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain('sk-fixture0123456789abcdef');
    expect(serialized).not.toContain('fixture-token-0123456789');
    expect(serialized).not.toContain('fixtureSecret123');
    expect(serialized).toContain('[redacted]');
    expect(Object.isFrozen(findTraceReference(result.value, 'toolEvents', 'evt-secret'))).toBe(true);
  });

  it('the whole capsule record carries no raw provider object or credential field', () => {
    const running = runningFixture(claudeImplementationInput(), CLAUDE_ACTUAL);
    const serialized = JSON.stringify(running);
    const CREDENTIAL_SHAPES: Array<[RegExp, string]> = [
      [/"[^"]*api[-_]?key[^"]*"\s*:/iu, 'an api-key field'],
      [/"[^"]*authorization[^"]*"\s*:/iu, 'an authorization field'],
      [/"[^"]*password[^"]*"\s*:/iu, 'a password field'],
      [/Bearer\s+\S+/u, 'a bearer token'],
      [/\bsk-[A-Za-z0-9]{8,}/u, 'an sk- style key'],
      [/eyJ[A-Za-z0-9_-]{10,}\./u, 'a JWT'],
    ];
    for (const [pattern, what] of CREDENTIAL_SHAPES) {
      expect(pattern.test(serialized), `the capsule must not contain ${what}`).toBe(false);
    }
    // Serializable by construction — no functions survive a JSON round-trip.
    expect(JSON.parse(serialized)).toEqual(JSON.parse(JSON.stringify(running)));
  });
});
