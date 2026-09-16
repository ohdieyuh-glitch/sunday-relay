import { describe, expect, it } from 'vitest';

import { createJuliusBrainAccessMemoryState, verifyJuliusBrainAuditChain, type JuliusBrainAuditEvent } from './julius-brain-access';
import {
  createJuliusBrainAnchorMemorySink,
  createJuliusBrainAuditAnchorer,
  digestJuliusBrainAuditAnchor,
  JULIUS_BRAIN_ANCHOR_FIELDS,
  verifyJuliusBrainAuditAgainstAnchors,
  type JuliusBrainAuditAnchor,
} from './julius-brain-audit-anchor';

/**
 * WHAT THE DATABASE'S OWNER CANNOT HIDE. The audit chain proves itself; the
 * anchors prove the chain is the one that was there yesterday.
 */

const START = Date.parse('2026-09-15T12:00:00.000Z');

async function world() {
  let now = START;
  const state = createJuliusBrainAccessMemoryState();
  const sink = createJuliusBrainAnchorMemorySink();
  let brainHead: { sequence: number; chainHash: string } | null = { sequence: 10, chainHash: `sha256:${'b'.repeat(64)}` };
  const anchorer = createJuliusBrainAuditAnchorer({
    environment: 'production', sink, clock: { now: () => new Date(now).toISOString() },
    auditHead: () => state.auditHead(), brainHead: async () => brainHead,
  });
  const decide = async (reasonCode: string | null = null) => {
    await state.appendAudit({ at: new Date(now).toISOString(), action: reasonCode === null ? 'CALL_ALLOWED' : 'CALL_REFUSED', sessionId: 'bsess:abc', brainRunId: 'workflow:35000000000/1', call: 'READ_CONTEXT', reasonCode: reasonCode as never });
  };
  return {
    state, sink, anchorer, decide,
    advance: (ms: number) => { now += ms; },
    setBrainHead: (head: typeof brainHead) => { brainHead = head; },
    verify: async (events?: readonly JuliusBrainAuditEvent[]) => verifyJuliusBrainAuditAgainstAnchors({ events: events ?? await state.readAudit(), anchors: await sink.read(), environment: 'production' }),
  };
}

describe('the external audit anchor', () => {
  it('an anchor carries only safe metadata, chains to the one before it, and does not repeat itself', async () => {
    const w = await world();
    expect(await w.anchorer.anchor()).toEqual({ outcome: 'NOTHING_TO_ANCHOR' });
    await w.decide();
    const first = await w.anchorer.anchor();
    if (first.outcome !== 'ANCHORED') throw new Error(JSON.stringify(first));
    expect(Object.keys(first.anchor).sort()).toEqual([...JULIUS_BRAIN_ANCHOR_FIELDS].sort());
    expect(first.anchor).toMatchObject({ environment: 'production', anchorSequence: 1, previousAnchorDigest: null, auditHead: { sequence: 1 }, brainHead: { sequence: 10 } });
    // Nothing of the decision itself travels: no session, no run, no call, no reason.
    expect(JSON.stringify(first.anchor)).not.toMatch(/bsess|workflow:|READ_CONTEXT/);

    expect(await w.anchorer.anchor()).toMatchObject({ outcome: 'UNCHANGED' });
    w.advance(60_000);
    await w.decide('other_run');
    const second = await w.anchorer.anchor();
    if (second.outcome !== 'ANCHORED') throw new Error(JSON.stringify(second));
    expect(second.anchor).toMatchObject({ anchorSequence: 2, previousAnchorDigest: first.anchor.digest, auditHead: { sequence: 2 } });
    expect(await w.verify()).toEqual({ ok: true, problems: [], verifiedThrough: 2, anchors: 2 });
  });

  it('an owner who rewrites history is exposed, even after rebuilding the in-database chain', async () => {
    const w = await world();
    for (const reason of [null, 'other_run', null]) { await w.decide(reason); w.advance(1_000); }
    await w.anchorer.anchor();
    const events = await w.state.readAudit();

    // The owner rewrites a refusal as an allowance and rebuilds every hash after it: the chain verifies.
    const rebuilt: JuliusBrainAuditEvent[] = [];
    for (const event of events) {
      const edited = event.sequence === 2 ? { ...event, action: 'CALL_ALLOWED' as const, reasonCode: null } : event;
      const previous = rebuilt.at(-1) ?? null;
      const { chainJuliusBrainAuditEvent } = await import('./julius-brain-access');
      rebuilt.push(chainJuliusBrainAuditEvent(previous, edited));
    }
    expect(verifyJuliusBrainAuditChain(rebuilt).ok).toBe(true);
    // The anchor taken before the rewrite does not agree.
    const checked = await w.verify(rebuilt);
    expect(checked.ok).toBe(false);
    expect(checked.problems[0]).toMatch(/audit 3: does not match the anchor taken at .* \(the audit was rewritten\)/);
  });

  it('a rolled-back database is behind its anchors, and a valid restore is not', async () => {
    const w = await world();
    for (let i = 0; i < 4; i += 1) { await w.decide(); w.advance(1_000); }
    await w.anchorer.anchor();
    const full = await w.state.readAudit();
    // Restored from a snapshot taken before the last two decisions.
    const rolledBack = full.slice(0, 2);
    const behind = await w.verify(rolledBack);
    expect(behind.ok).toBe(false);
    expect(behind.problems[0]).toMatch(/audit 4: anchored at .* but absent now \(the database is behind its anchors\)/);
    // A restore that is genuinely current verifies, and says how far the anchors vouch.
    expect(await w.verify(full)).toMatchObject({ ok: true, verifiedThrough: 4 });
  });

  it('the anchor record itself is checked: a missing, reordered or edited anchor is caught', async () => {
    const w = await world();
    for (let i = 0; i < 3; i += 1) { await w.decide(); w.advance(1_000); await w.anchorer.anchor(); }
    const anchors = await w.sink.read();
    expect(anchors).toHaveLength(3);
    const events = await w.state.readAudit();
    const check = (list: readonly JuliusBrainAuditAnchor[]) => verifyJuliusBrainAuditAgainstAnchors({ events, anchors: list, environment: 'production' });

    expect(check([anchors[0]!, anchors[2]!]).problems[0]).toMatch(/anchor 3: out of sequence \(expected 2\)/);
    expect(check([anchors[0]!, anchors[2]!, anchors[1]!]).problems[0]).toMatch(/out of sequence/);
    const edited = { ...anchors[1]!, auditHead: { sequence: 2, hash: `sha256:${'0'.repeat(64)}` } };
    expect(check([anchors[0]!, edited, anchors[2]!]).problems[0]).toMatch(/anchor 2: its content does not match its digest/);
    // Re-digesting the edit does not help: it no longer follows anchor 1.
    const { digest, ...body } = edited;
    const resealed = { ...body, digest: digestJuliusBrainAuditAnchor({ ...body, previousAnchorDigest: null }) };
    expect(check([anchors[0]!, resealed as JuliusBrainAuditAnchor, anchors[2]!]).ok).toBe(false);
    // An anchor from another environment is not this service's.
    expect(check([{ ...anchors[0]!, environment: 'development' as const }]).problems[0]).toMatch(/anchored a development service/);
  });

  it('a sink that is unavailable stops the verifiable window advancing, and nothing else', async () => {
    const w = await world();
    await w.decide();
    await w.anchorer.anchor();
    const failing = createJuliusBrainAuditAnchorer({
      environment: 'production', clock: { now: () => new Date(START).toISOString() },
      auditHead: () => w.state.auditHead(), brainHead: async () => null,
      sink: { append: async () => { throw new Error('anchor store unreachable'); }, read: () => w.sink.read() },
    });
    await w.decide('other_mission');
    const unavailable = await failing.anchor();
    expect(unavailable).toMatchObject({ outcome: 'SINK_UNAVAILABLE', detail: 'anchor store unreachable', pending: { anchorSequence: 2, auditHead: { sequence: 2 } } });
    // The service kept deciding and auditing throughout; only the vouched-for window is older than the audit.
    const checked = await w.verify();
    expect(checked).toMatchObject({ ok: true, verifiedThrough: 1, anchors: 1 });
    expect((await w.state.readAudit()).length).toBe(2);
    // A sink that cannot even be read is the same kind of answer, and the audit is never held back by it.
    const blind = createJuliusBrainAuditAnchorer({
      environment: 'production', clock: { now: () => new Date(START).toISOString() },
      auditHead: () => w.state.auditHead(), brainHead: async () => null,
      sink: { append: async () => undefined, read: async () => { throw new Error('anchor store unreachable'); } },
    });
    expect(await blind.anchor()).toMatchObject({ outcome: 'SINK_UNAVAILABLE', pending: null });
    // And an unreadable audit is reported as such, not anchored as if it were empty.
    const unreadable = createJuliusBrainAuditAnchorer({
      environment: 'production', clock: { now: () => new Date(START).toISOString() },
      auditHead: async () => { throw new Error('connection terminated'); }, brainHead: async () => null, sink: w.sink,
    });
    expect(await unreadable.anchor()).toEqual({ outcome: 'AUDIT_UNREADABLE', detail: 'connection terminated' });
  });
});
