/**
 * THE MISSION TRACE ID, DERIVED AND NOT STORED.
 *
 * One canonical id for a Wonderland Julius mission, compatible with W3C
 * trace-context. Admission, dispatch, the Julius runtime, the paid-run
 * archive, and the Wonderland client all compute it from the admitted
 * `wlj_` id. Nothing persists it, and a trace id that arrived from anywhere
 * else is not this id.
 *
 * This file imports only `node:crypto`. It is the copy the workflow and a
 * drift test can take byte for byte. It does not read the environment and it
 * does not import another module from this repository.
 *
 * `traceId` is a correlation id. It is not a secret and it is not proof of
 * spend. The `julius-run-spent.v1` tag stays the spend record.
 */

import { createHash } from 'node:crypto';

/** Same grammar as `WLJ_RUN_ID_PATTERN` in `julius-admission-run-id.mjs`. */
export const JULIUS_TRACE_WLJ_RUN_ID = '^wlj_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const JULIUS_TRACE_LABEL = 'julius-trace.v1:';
export const JULIUS_SPAN_LABEL = 'julius-span.v1:';

export const JULIUS_TRACE_ROLES = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'];
export const JULIUS_TRACE_STAGES = ['plan', 'build', 'repair:plan', 'repair:build'];

const WLJ = new RegExp(JULIUS_TRACE_WLJ_RUN_ID, 'u');
const HEX64 = /^[0-9a-f]{64}$/;
const TRACE_ID = /^[0-9a-f]{32}$/;
const SPAN_ID = /^[0-9a-f]{16}$/;

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * The first aligned non-zero window of `width` hex characters in a 64-hex
 * SHA-256 digest, or null when every aligned window is zero.
 *
 * @param {unknown} digestHex
 * @param {16 | 32} width
 * @returns {string | null}
 */
export function juliusMissionTraceWindow(digestHex, width) {
  if (typeof digestHex !== 'string' || !HEX64.test(digestHex)) return null;
  if (width !== 16 && width !== 32) return null;
  for (let index = 0; index + width <= digestHex.length; index += width) {
    const window = digestHex.slice(index, index + width);
    if (!/^0+$/.test(window)) return window;
  }
  return null;
}

/**
 * W3C forbids an all-zero trace id and an all-zero span id.
 *
 * Take the first aligned non-zero window of the first digest. When that
 * digest's windows are all zero, take the same walk over the second digest.
 * When both digests are all zero, the id is `width - 1` zeros and a final
 * `1`. The second digest is SHA-256 of the same label with one trailing
 * U+0000. Callers pass that digest in; this function does not hash.
 *
 * @param {string} firstDigest
 * @param {string} secondDigest
 * @param {16 | 32} width
 * @returns {string}
 */
export function juliusMissionHexIdFromDigests(firstDigest, secondDigest, width) {
  return juliusMissionTraceWindow(firstDigest, width)
    ?? juliusMissionTraceWindow(secondDigest, width)
    ?? `${'0'.repeat(width - 1)}1`;
}

/**
 * @param {string} label
 * @param {16 | 32} width
 * @returns {string}
 */
function hexId(label, width) {
  return juliusMissionHexIdFromDigests(sha256Hex(label), sha256Hex(`${label}\0`), width);
}

/**
 * The mission trace id, or null when `wljRunId` is not a lowercase `wlj_`
 * UUIDv4. A legacy `run:` id, a `preflight:` id, and any other string are
 * null. This never invents an id for them.
 *
 * @param {unknown} wljRunId
 * @returns {string | null}
 */
export function juliusMissionTraceId(wljRunId) {
  if (typeof wljRunId !== 'string' || !WLJ.test(wljRunId)) return null;
  return hexId(`${JULIUS_TRACE_LABEL}${wljRunId}`, 32);
}

/**
 * A phase span id. `attempt` is a safe integer greater than or equal to zero,
 * written in decimal with no padding. Any other attempt, role, or stage is
 * null.
 *
 * @param {unknown} wljRunId
 * @param {unknown} role
 * @param {unknown} stage
 * @param {unknown} attempt
 * @returns {string | null}
 */
export function juliusMissionSpanId(wljRunId, role, stage, attempt) {
  if (typeof wljRunId !== 'string' || !WLJ.test(wljRunId)) return null;
  if (typeof role !== 'string' || !JULIUS_TRACE_ROLES.includes(role)) return null;
  if (typeof stage !== 'string' || !JULIUS_TRACE_STAGES.includes(stage)) return null;
  if (typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 0) return null;
  return hexId(`${JULIUS_SPAN_LABEL}${wljRunId}:${role}:${stage}:${String(attempt)}`, 16);
}

/**
 * W3C traceparent: `00-<traceId>-<spanId>-01`. The flag is sampled.
 * An all-zero id, or any other shape, is null.
 *
 * @param {unknown} traceId
 * @param {unknown} spanId
 * @returns {string | null}
 */
export function juliusMissionTraceparent(traceId, spanId) {
  if (typeof traceId !== 'string' || !TRACE_ID.test(traceId) || /^0+$/.test(traceId)) return null;
  if (typeof spanId !== 'string' || !SPAN_ID.test(spanId) || /^0+$/.test(spanId)) return null;
  return `00-${traceId}-${spanId}-01`;
}
