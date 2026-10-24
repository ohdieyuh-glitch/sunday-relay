import { describe, expect, it } from 'vitest';

import {
  claimJuliusAdmissionSpend,
  interpretJuliusSpentTags,
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

  it('spends a UUIDv4 once, and a replay does not spend again', () => {
    const first = claimJuliusAdmissionSpend(new Set(), `  ${UUID}  `);
    expect(first.decision).toEqual({ ok: true, runId: UUID });
    const replay = claimJuliusAdmissionSpend(first.spent, UUID);
    expect(replay.decision).toEqual({ ok: false, reasonCode: 'admission_run_already_spent' });
    expect(replay.spent).toBe(first.spent);
    const other = claimJuliusAdmissionSpend(replay.spent, RUN_ID);
    expect(other.decision).toEqual({ ok: true, runId: RUN_ID });
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
