/**
 * SUNDAY RELAY — MISSION OPERATIONS MILESTONE 3
 * Capsule secret handling (PURE) — REUSES the shared redactors rather than
 * adding a fourth, weaker copy.
 *
 * `redactCommandMetadata` (Milestone 2) already performs deep, non-mutating
 * key-name and value redaction over structured metadata, and
 * `redactTerminalText` (mission/terminal) is the shared text redactor. This
 * module adds only what a capsule needs on top: a DETECTOR, so a caller can
 * choose to reject secret-shaped input rather than silently storing a redacted
 * version of something that should never have been passed at all.
 *
 * Environment-variable NAMES may be retained (they are useful evidence);
 * their VALUES never are.
 */

import { redactCommandMetadata } from '../commands/command-events';
import { redactTerminalText } from '../terminal';
import { capsuleError, capsuleFail, capsuleOk, type CapsuleResult } from './capsule-errors';

export { redactCommandMetadata } from '../commands/command-events';

/** Deep, non-mutating redaction of any capsule-bound metadata. */
export function redactCapsuleMetadata(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  return redactCommandMetadata(metadata);
}

/** Redacts a free-text value bound for a capsule reference summary. */
export function redactCapsuleText(text: string): string {
  return redactTerminalText(text).text;
}

/**
 * True when redaction would change the input — i.e. the input carried
 * secret-shaped content. Used by callers that must REJECT rather than store.
 */
export function containsSecretShapedValue(metadata: Record<string, unknown>): boolean {
  return JSON.stringify(redactCommandMetadata(metadata)) !== JSON.stringify(metadata);
}

/**
 * Reject-on-secret variant for inputs that should never contain credentials
 * (identity records, workspace bindings, report digests). Metadata that may
 * legitimately quote agent output should be REDACTED instead, via
 * `redactCapsuleMetadata`.
 */
export function requireSecretFreeMetadata(
  metadata: Record<string, unknown>,
  field: string,
  capsuleId?: string,
): CapsuleResult<Record<string, unknown>> {
  if (containsSecretShapedValue(metadata)) {
    return capsuleFail(
      capsuleError(
        'SECRET_REDACTION_FAILED',
        `${field} contains secret-shaped values, which are never persisted in a capsule`,
        'remove the credential and pass a credential handle or reference instead',
        { capsuleId, field },
      ),
    );
  }
  return capsuleOk(metadata);
}
