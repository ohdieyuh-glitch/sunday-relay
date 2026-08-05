/**
 * SUNDAY RELAY — THE LOOP'S STABLE DIGEST.
 *
 * Every digest a Loop takes — of a reduced run, of an event about to be
 * checksummed, of a snapshot — uses the SAME primitive the durable mission
 * record uses: sorted-key JSON, then sha-256, in pure TypeScript. Nothing is
 * reimplemented here.
 *
 * WHY THAT MATTERS AND IS NOT A DETAIL. A Loop run is written by whichever
 * process happened to own it and read back by a different one, possibly on a
 * different platform, possibly in a browser. If the digest depended on key
 * insertion order, a run would fail its own integrity check purely because it
 * was reduced somewhere else — and the system would report corruption where
 * there was none. `stableSerialize` sorts keys, so the same run is the same
 * bytes everywhere.
 *
 * The reducer still takes an INJECTED digest rather than importing this one.
 * That is not indecision: it keeps the reducer provably free of any hashing at
 * all, and it lets a test substitute a cheap digest to isolate what it is
 * actually testing. This module is the default every real caller passes.
 *
 * PURE. No crypto module, no clock, no I/O.
 */

import { digestOf, sha256Hex, stableSerialize } from '../../durable/durable-digest';
import type { LoopDigestFn } from './loop-runtime-reducer';

/** The digest every real Loop caller uses. Identical bytes to the Node layer. */
export const loopDigest: LoopDigestFn = (value: unknown): string => digestOf(value);

export { digestOf as loopDigestOf, sha256Hex as loopSha256Hex, stableSerialize as loopStableSerialize };
