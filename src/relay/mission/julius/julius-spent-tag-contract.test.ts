import { describe, expect, it } from 'vitest';

import { deriveJuliusSpentTag, parseJuliusAdmissionRunId } from '../../../../scripts/julius-admission-run-id.mjs';
import {
  claimJuliusAdmissionSpend,
  interpretJuliusSpentTags,
  juliusSpentTagMessage,
  juliusSpentTagRecord,
  parseJuliusSpentTagRecord,
} from './julius-spent-tag-record';

/**
 * CROSS-PR CONTRACT. The same file is pinned on the spent-tag writer (#434)
 * and the $60 cap (#404). The literal below is the tag message and the
 * `julius-run-spent-audit.txt` blob. The cap's parser accepts those bytes.
 * It refuses the previous body, which stored `server_run_id` and no reservation.
 */

const HEX = '0123456789abcdef01234567';
const RUN_ID = `run:${HEX}`;
const SHA = 'a'.repeat(40);
const NAMESPACE = 'julius-live-mission-5';
const RESERVED = 30_000_000;

const WRITTEN = [
  'julius-run-spent.v1',
  `run=${RUN_ID}`,
  `namespace=${NAMESPACE}`,
  `reservedUsdMicros=${String(RESERVED)}`,
  'workflow_run_id=4242',
  'workflow_run_attempt=1',
  `head_sha=${SHA}`,
  '',
].join('\n');

const LEGACY = [
  'julius-run-spent.v1',
  `server_run_id=${RUN_ID}`,
  'workflow_run_id=4242',
  'workflow_run_attempt=1',
  `head_sha=${SHA}`,
  '',
].join('\n');

describe('the spent tag #434 writes is the record #404 counts', () => {
  it('accepts exactly those bytes, and refuses the old server_run_id body', () => {
    expect(juliusSpentTagRecord({
      runId: RUN_ID,
      namespace: NAMESPACE,
      reservedUsdMicros: RESERVED,
      workflowRunId: '4242',
      workflowRunAttempt: '1',
      headSha: SHA,
    })).toBe(WRITTEN);
    expect(parseJuliusSpentTagRecord(WRITTEN, RUN_ID, NAMESPACE)).toEqual({
      kind: 'verified', reservedUsdMicros: RESERVED,
    });
    expect(parseJuliusSpentTagRecord(LEGACY, RUN_ID, NAMESPACE)).toEqual({ kind: 'unverified' });
    const counted = interpretJuliusSpentTags({
      namespace: NAMESPACE,
      tags: [{ ref: `refs/tags/julius-run-spent-${HEX}`, message: WRITTEN }],
    });
    expect(counted).toEqual({
      readable: true,
      durableRecord: 'PRESENT',
      priorRuns: [{
        runId: RUN_ID,
        knownUsdMicros: RESERVED,
        unknownCostComponents: 0,
        unverifiableApiSpend: false,
        spendVerified: true,
      }],
    });
    const refused = interpretJuliusSpentTags({
      namespace: NAMESPACE,
      tags: [{ ref: `refs/tags/julius-run-spent-${HEX}`, message: LEGACY }],
    });
    expect(refused.readable).toBe(true);
    if (!refused.readable) return;
    expect(refused.priorRuns).toEqual([{
      runId: RUN_ID,
      knownUsdMicros: 0,
      unknownCostComponents: 1,
      unverifiableApiSpend: false,
      spendVerified: false,
    }]);
    const duplicated = interpretJuliusSpentTags({
      namespace: NAMESPACE,
      tags: [
        { ref: `refs/tags/julius-run-spent-${HEX}`, message: WRITTEN },
        { ref: `refs/tags/julius-run-spent-${HEX}`, message: WRITTEN },
      ],
    });
    expect(duplicated.readable).toBe(true);
    if (!duplicated.readable) return;
    expect(duplicated.priorRuns).toHaveLength(1);
  });
});

describe('one spent claim per admission run id', () => {
  const UUID = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
  const UUID_SUFFIX = '0123456789ab4cde8fab0123456789ab';

  it('spends a UUIDv4 once, keyed by the 32-hex suffix, and a replay does not spend again', () => {
    const first = claimJuliusAdmissionSpend(new Set(), UUID);
    expect(first.decision).toEqual({ ok: true, runId: UUID });
    expect([...first.spent]).toEqual([UUID_SUFFIX]);
    const replay = claimJuliusAdmissionSpend(first.spent, UUID);
    expect(replay.decision).toEqual({ ok: false, reasonCode: 'admission_run_already_spent' });
    expect(replay.spent).toBe(first.spent);
    const padded = claimJuliusAdmissionSpend(new Set(), `  ${UUID}  `);
    expect(padded.decision).toEqual({ ok: false, reasonCode: 'admission_run_id_malformed' });
    expect(padded.spent.size).toBe(0);
    const other = claimJuliusAdmissionSpend(replay.spent, RUN_ID);
    expect(other.decision).toEqual({ ok: true, runId: RUN_ID });
    expect(other.spent.has(HEX)).toBe(true);
    const hexReplay = claimJuliusAdmissionSpend(other.spent, RUN_ID);
    expect(hexReplay.decision).toEqual({ ok: false, reasonCode: 'admission_run_already_spent' });
    expect(other.spent.size).toBe(2);
  });

  it('a malformed or non-UUIDv4 id spends nothing', () => {
    const spent = new Set<string>([UUID]);
    for (const runId of [
      '',
      'none',
      '11111111-1111-4111-8111-111111111111',
      UUID.toUpperCase(),
      'wlj_01234567-89ab-1cde-8fab-0123456789ab',
      'wlj_01234567-89ab-4cde-cfab-0123456789ab',
      `run:${HEX.slice(0, 23)}`,
      `run:${HEX.toUpperCase()}`,
      `run:${HEX};touch /tmp/pwn`,
    ]) {
      const claim = claimJuliusAdmissionSpend(spent, runId);
      expect(claim.decision, runId).toEqual({ ok: false, reasonCode: 'admission_run_id_malformed' });
      expect(claim.spent, runId).toBe(spent);
      expect(claim.spent.has(UUID)).toBe(true);
    }
  });
});

const WLJ = 'wlj_01234567-89ab-4cde-8fab-0123456789ab';
const WLJ_HEX = '0123456789ab4cde8fab0123456789ab';
const WLJ_RESERVED = 30_000_000;
const LEGACY_RESERVED = 20_000_000;

function spentRecord(runId: string, reservedUsdMicros: number): string {
  return [
    'julius-run-spent.v1',
    `run=${runId}`,
    `namespace=${NAMESPACE}`,
    `reservedUsdMicros=${String(reservedUsdMicros)}`,
    'workflow_run_id=4242',
    'workflow_run_attempt=1',
    `head_sha=${SHA}`,
    '',
  ].join('\n');
}

describe('a wlj tag uses the same suffix as the paid workflow', () => {
  it('counts a 32-hex wlj tag toward the cap at its reserved micros', () => {
    const message = juliusSpentTagMessage({
      runId: WLJ,
      namespace: NAMESPACE,
      reservedUsdMicros: WLJ_RESERVED,
    });
    expect(message).toBe([
      'julius-run-spent.v1',
      `run=${WLJ}`,
      `namespace=${NAMESPACE}`,
      `reservedUsdMicros=${String(WLJ_RESERVED)}`,
    ].join('\n'));
    const written = spentRecord(WLJ, WLJ_RESERVED);
    expect(juliusSpentTagRecord({
      runId: WLJ,
      namespace: NAMESPACE,
      reservedUsdMicros: WLJ_RESERVED,
      workflowRunId: '4242',
      workflowRunAttempt: '1',
      headSha: SHA,
    })).toBe(written);
    const counted = interpretJuliusSpentTags({
      namespace: NAMESPACE,
      tags: [{ ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: written }],
    });
    expect(counted).toEqual({
      readable: true,
      durableRecord: 'PRESENT',
      priorRuns: [{
        runId: WLJ,
        knownUsdMicros: WLJ_RESERVED,
        unknownCostComponents: 0,
        unverifiableApiSpend: false,
        spendVerified: true,
      }],
    });
    const derived = deriveJuliusSpentTag(WLJ);
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    expect(derived.suffix).toBe(WLJ_HEX);
    expect(derived.tag).toBe(`refs/tags/julius-run-spent-${WLJ_HEX}`);
  });

  it('refuses a replay of the same wlj id, including when the set already holds the tag suffix', () => {
    const first = claimJuliusAdmissionSpend(new Set(), WLJ);
    expect(first.decision).toEqual({ ok: true, runId: WLJ });
    const replay = claimJuliusAdmissionSpend(first.spent, WLJ);
    expect(replay.decision).toEqual({ ok: false, reasonCode: 'admission_run_already_spent' });
    expect(replay.spent).toBe(first.spent);
    const fromTag = claimJuliusAdmissionSpend(new Set([WLJ_HEX]), WLJ);
    expect(fromTag.decision).toEqual({ ok: false, reasonCode: 'admission_run_already_spent' });
    expect(fromTag.spent).toEqual(new Set([WLJ_HEX]));
    const ownLock = interpretJuliusSpentTags({
      namespace: NAMESPACE,
      excludeRunId: WLJ,
      tags: [{ ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: spentRecord(WLJ, WLJ_RESERVED) }],
    });
    expect(ownLock).toEqual({ readable: true, durableRecord: 'PRESENT', priorRuns: [] });
  });

  it('counts a mixed legacy and wlj listing, and excludes the current id by suffix', () => {
    const listing = interpretJuliusSpentTags({
      namespace: NAMESPACE,
      tags: [
        { ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: spentRecord(WLJ, WLJ_RESERVED) },
        { ref: `refs/tags/julius-run-spent-${HEX}`, message: spentRecord(RUN_ID, LEGACY_RESERVED) },
      ],
    });
    expect(listing.readable).toBe(true);
    if (!listing.readable) return;
    expect(listing.priorRuns.map((run) => run.runId)).toEqual([RUN_ID, WLJ]);
    const known = listing.priorRuns.reduce((sum, run) => sum + run.knownUsdMicros, 0);
    expect(known).toBe(LEGACY_RESERVED + WLJ_RESERVED);
    expect(listing.priorRuns.every((run) => run.spendVerified && run.unknownCostComponents === 0)).toBe(true);
    const withoutCurrent = interpretJuliusSpentTags({
      namespace: NAMESPACE,
      excludeRunId: WLJ,
      tags: [
        { ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: spentRecord(WLJ, WLJ_RESERVED) },
        { ref: `refs/tags/julius-run-spent-${HEX}`, message: spentRecord(RUN_ID, LEGACY_RESERVED) },
      ],
    });
    expect(withoutCurrent.readable).toBe(true);
    if (!withoutCurrent.readable) return;
    expect(withoutCurrent.priorRuns).toEqual([{
      runId: RUN_ID,
      knownUsdMicros: LEGACY_RESERVED,
      unknownCostComponents: 0,
      unverifiableApiSpend: false,
      spendVerified: true,
    }]);
  });

  it('rejects a malformed tag for the whole listing, and does not treat it as zero', () => {
    const valid = { ref: `refs/tags/julius-run-spent-${HEX}`, message: spentRecord(RUN_ID, LEGACY_RESERVED) };
    const versionOne = `0123456789ab1cde8fab0123456789ab`;
    const badVariant = `0123456789ab4cdecfab0123456789ab`;
    for (const ref of [
      'refs/tags/julius-run-spent-',
      `refs/tags/julius-run-spent-${HEX.slice(0, 23)}`,
      `refs/tags/julius-run-spent-${WLJ_HEX.slice(0, 31)}`,
      `refs/tags/julius-run-spent-${WLJ_HEX.toUpperCase()}`,
      `refs/tags/julius-run-spent-${versionOne}`,
      `refs/tags/julius-run-spent-${badVariant}`,
      `refs/tags/julius-run-spent-${WLJ}`,
      `refs/tags/julius-run-spent-${HEX}ff`,
      `refs/tags/julius-run-spent-${HEX}\n`,
    ]) {
      const rejected = interpretJuliusSpentTags({
        namespace: NAMESPACE,
        tags: [valid, { ref, message: spentRecord(WLJ, WLJ_RESERVED) }],
      });
      expect(rejected, ref).toEqual({ readable: false });
    }
    const unverified = interpretJuliusSpentTags({
      namespace: NAMESPACE,
      tags: [{ ref: `refs/tags/julius-run-spent-${WLJ_HEX}`, message: LEGACY }],
    });
    expect(unverified.readable).toBe(true);
    if (!unverified.readable) return;
    expect(unverified.priorRuns).toEqual([{
      runId: WLJ,
      knownUsdMicros: 0,
      unknownCostComponents: 1,
      unverifiableApiSpend: false,
      spendVerified: false,
    }]);
  });

  it('accepts and refuses the same ids as scripts/julius-admission-run-id.mjs', () => {
    const samples = [
      WLJ,
      RUN_ID,
      '',
      ` ${WLJ}`,
      `${WLJ} `,
      WLJ.toUpperCase(),
      'wlj_01234567-89ab-1cde-8fab-0123456789ab',
      'wlj_01234567-89ab-7cde-8fab-0123456789ab',
      `run:${HEX.toUpperCase()}`,
      'not-an-id',
    ];
    for (const sample of samples) {
      const parsed = parseJuliusAdmissionRunId(sample);
      const derived = deriveJuliusSpentTag(sample);
      const claim = claimJuliusAdmissionSpend(new Set(), sample);
      const message = juliusSpentTagMessage({
        runId: sample,
        namespace: NAMESPACE,
        reservedUsdMicros: RESERVED,
      });
      expect(derived.ok, sample).toBe(parsed.ok);
      if (!parsed.ok || !derived.ok) {
        expect(claim.decision, sample).toEqual({ ok: false, reasonCode: 'admission_run_id_malformed' });
        expect(claim.spent.size, sample).toBe(0);
        expect(message, sample).toBeNull();
        continue;
      }
      expect(claim.decision, sample).toEqual({ ok: true, runId: derived.runId });
      expect([...claim.spent], sample).toEqual([derived.suffix]);
      expect(message, sample).toContain(`run=${derived.runId}`);
      const written = juliusSpentTagRecord({
        runId: sample,
        namespace: NAMESPACE,
        reservedUsdMicros: RESERVED,
        workflowRunId: '4242',
        workflowRunAttempt: '1',
        headSha: SHA,
      });
      const counted = interpretJuliusSpentTags({
        namespace: NAMESPACE,
        tags: [{ ref: derived.tag, message: written }],
      });
      expect(counted, sample).toEqual({
        readable: true,
        durableRecord: 'PRESENT',
        priorRuns: [{
          runId: derived.runId,
          knownUsdMicros: RESERVED,
          unknownCostComponents: 0,
          unverifiableApiSpend: false,
          spendVerified: true,
        }],
      });
    }
  });
});
