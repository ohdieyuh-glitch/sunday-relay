/**
 * SUNDAY RELAY — WHAT A LOOP JOURNAL LINE IS ALLOWED TO CONTAIN.
 *
 * A Loop run is the one part of Relay that reads model output on a schedule,
 * for hours, and writes what it saw to a file that outlives the process. That
 * is precisely the shape of system that accidentally persists a transcript.
 *
 * REUSE, NOT REIMPLEMENTATION. The forbidden-key set, the secret value shapes
 * and the size bounds come from `redactDurableValue` in `mission/durable` — the
 * same walker that protects a durable mission record, which in turn mirrors the
 * Node persistence layer's `sanitizePayload`. This module adds exactly one rule
 * the record walker does not carry, because a mission record has no free-text
 * field a model can write into and a Loop observation does:
 *
 *   HIDDEN REASONING IS REJECTED BY SHAPE, NOT ONLY BY KEY NAME. A summary that
 *   contains `<thinking>` or "chain of thought" is replaced wholesale rather
 *   than trimmed. Relay does not store a model's private reasoning, and it does
 *   not store the half of it that fitted inside the bound either.
 *
 * `loop-runtime.test.ts` pins these rules against the Node layer's own regexes,
 * so the two cannot drift apart silently.
 *
 * PURE. No filesystem, no clock, no crypto.
 */

import { redactDurableValue } from '../../durable/durable-record';

/**
 * Text that is hidden reasoning by shape. Mirrors `HIDDEN_REASONING_RE` in
 * `persistence/redaction.ts`; the pinning test proves the two agree.
 */
export const LOOP_HIDDEN_REASONING_RE =
  /chain[- ]of[- ]thought|hidden reasoning|<thinking>|internal monologue/i;

/** The longest free-text summary a journal line may carry. */
export const LOOP_MAX_SUMMARY_LENGTH = 2_000;

/**
 * Sanitize one free-text field — a summary, a reason, a failure detail.
 *
 * Hidden reasoning is replaced rather than truncated: keeping the first two
 * thousand characters of a model's private reasoning is still storing it.
 */
export function sanitizeLoopText(text: string): string {
  if (LOOP_HIDDEN_REASONING_RE.test(text)) {
    return '[REDACTED: hidden-reasoning-shaped content removed]';
  }
  const redacted = redactDurableValue(text);
  const safe = typeof redacted === 'string' ? redacted : '[REDACTED]';
  return safe.length > LOOP_MAX_SUMMARY_LENGTH
    ? `${safe.slice(0, LOOP_MAX_SUMMARY_LENGTH)}…[truncated]`
    : safe;
}

/**
 * Sanitize a whole event payload.
 *
 * Two passes, and the order matters. The durable walker runs first and drops
 * forbidden keys and secret-shaped values anywhere in the structure; the text
 * pass then runs over every surviving string, because a credential nested three
 * levels down is caught by the first pass but hidden reasoning in a `summary`
 * is only caught by the second.
 */
export function sanitizeLoopPayload<T>(payload: T): T {
  return sanitizeStrings(redactDurableValue(payload)) as T;
}

function sanitizeStrings(value: unknown): unknown {
  if (typeof value === 'string') return sanitizeLoopText(value);
  if (Array.isArray(value)) return value.map(sanitizeStrings);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeStrings(raw);
    }
    return out;
  }
  return value;
}

/**
 * Audit helper: does this serialized line still contain material that should
 * never have reached a journal? Used by the tests to prove the writer, not to
 * clean up after it — a `true` here is a bug in the writer, not a repair.
 */
export function containsForbiddenLoopMaterial(text: string): string | null {
  if (LOOP_HIDDEN_REASONING_RE.test(text)) return 'hidden-reasoning marker';
  const roundTripped = redactDurableValue(text);
  if (roundTripped !== text) return 'secret-shaped value';
  return null;
}
