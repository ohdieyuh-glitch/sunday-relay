import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JULIUS_MEMORY_PROVENANCE,
  JULIUS_MEMORY_TRUST_STATES,
  admitJuliusMemoryCandidate,
  promoteJuliusMemoryClaim,
  contradictJuliusMemoryClaims,
  supersedeJuliusMemoryClaim,
  retrieveTrustedJuliusMemory,
  type JuliusMemoryClaim,
} from './julius-memory-trust';

/**
 * PROJECT BRAIN v2 TRUST CORE — THE SPECIFICATION.
 *
 * The rule the whole module exists to hold: AUTO-GENERATE IS ALLOWED,
 * AUTO-TRUST IS NOT. Julius may derive a memory candidate from anything it
 * observes; nothing becomes trusted except by verification from an authority
 * that is not the thing being verified.
 */

const AT = '2026-09-10T02:00:00.000Z';
const ok = <T>(outcome: { outcome: string } & Record<string, unknown>): T => {
  assert.equal(outcome.outcome, 'OK', `expected OK, got ${JSON.stringify(outcome)}`);
  return outcome.claim as T;
};
const refused = (outcome: { outcome: string; reasonCode?: string }, reasonCode?: string): void => {
  assert.equal(outcome.outcome, 'REFUSED', `expected REFUSED, got ${JSON.stringify(outcome)}`);
  if (reasonCode !== undefined) assert.equal(outcome.reasonCode, reasonCode);
};
const candidate = (over: Record<string, unknown> = {}): JuliusMemoryClaim => ok<JuliusMemoryClaim>(
  admitJuliusMemoryCandidate({
    claimId: 'claim-1', entryId: 'entry-1', provenance: 'run_observed',
    assertedBy: 'coding-agent-claude-hosted', assertedAt: AT, ...over,
  } as never) as never);

test('the vocabularies are closed and complete', () => {
  assert.deepEqual([...JULIUS_MEMORY_PROVENANCE], [
    'user_stated', 'repository_observed', 'tool_observed', 'run_observed',
    'reviewer_verified', 'system_policy', 'derived_candidate',
  ]);
  assert.deepEqual([...JULIUS_MEMORY_TRUST_STATES], [
    'UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED', 'CONTRADICTED', 'SUPERSEDED',
  ]);
});

test('a candidate is admitted UNVERIFIED however much trust was requested', () => {
  // THE CENTRAL INVARIANT. Requesting more is not refused — refusing would tempt
  // callers to stop generating candidates, and generating them is meant to be
  // free. It is admitted at UNVERIFIED, which is what costs something to change.
  for (const requestedTrust of JULIUS_MEMORY_TRUST_STATES) {
    const claim = candidate({ claimId: `claim-${requestedTrust}`, requestedTrust });
    assert.equal(claim.trust, 'UNVERIFIED', `requesting ${requestedTrust} must not grant it`);
  }
  assert.equal(candidate().evidence.length, 0);
  assert.equal(candidate().supersedes, null);
  assert.deepEqual([...candidate().contradicts], []);
});

test('a claim nobody asserted is refused', () => {
  refused(admitJuliusMemoryCandidate({
    claimId: 'c', entryId: 'e', provenance: 'run_observed', assertedBy: '  ', assertedAt: AT,
  } as never) as never);
  refused(admitJuliusMemoryCandidate({
    claimId: '', entryId: 'e', provenance: 'run_observed', assertedBy: 'w', assertedAt: AT,
  } as never) as never);
  refused(admitJuliusMemoryCandidate({
    claimId: 'c', entryId: 'e', provenance: 'invented' as never, assertedBy: 'w', assertedAt: AT,
  } as never) as never);
});

test('promotion to VERIFIED needs reviewer evidence from someone other than the asserter', () => {
  const claim = candidate();
  // No evidence at all.
  refused(promoteJuliusMemoryClaim(claim, { to: 'VERIFIED', by: 'independent-reviewer-hermes', evidence: [], at: AT }) as never);
  // Evidence of the wrong kind.
  refused(promoteJuliusMemoryClaim(claim, {
    to: 'VERIFIED', by: 'independent-reviewer-hermes',
    evidence: [{ kind: 'RUN', id: 'run-1' }], at: AT,
  }) as never);
  // SELF-VERIFICATION. The asserter cannot be the authority for its own claim.
  refused(promoteJuliusMemoryClaim(claim, {
    to: 'VERIFIED', by: claim.assertedBy,
    evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: AT,
  }) as never);
  // And the legitimate case.
  const verified = ok<JuliusMemoryClaim>(promoteJuliusMemoryClaim(claim, {
    to: 'VERIFIED', by: 'independent-reviewer-hermes',
    evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: AT,
  }) as never);
  assert.equal(verified.trust, 'VERIFIED');
  assert.equal(verified.evidence.length, 1);
  assert.equal(verified.claimId, claim.claimId, 'promotion does not mint a new claim');
});

test('a contradicted or superseded claim can never be promoted again', () => {
  const a = candidate({ claimId: 'a' });
  const b = candidate({ claimId: 'b' });
  const [ca] = ok<readonly [JuliusMemoryClaim, JuliusMemoryClaim]>(
    contradictJuliusMemoryClaims(a, b, AT) as never);
  assert.equal(ca.trust, 'CONTRADICTED');
  refused(promoteJuliusMemoryClaim(ca, {
    to: 'VERIFIED', by: 'independent-reviewer-hermes',
    evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: AT,
  }) as never);

  const old = candidate({ claimId: 'old' });
  const next = candidate({ claimId: 'next' });
  const [superseded] = ok<readonly [JuliusMemoryClaim, JuliusMemoryClaim]>(
    supersedeJuliusMemoryClaim(old, next, AT) as never);
  assert.equal(superseded.trust, 'SUPERSEDED');
  refused(promoteJuliusMemoryClaim(superseded, {
    to: 'VERIFIED', by: 'independent-reviewer-hermes',
    evidence: [{ kind: 'REVIEW', id: 'review-1' }], at: AT,
  }) as never);
});

test('an APPROVED claim survives a contradiction that demotes the other', () => {
  // A human or policy authority outranks a conflicting assertion. Both are
  // still RECORDED as conflicting — the contradiction is a fact, not a deletion.
  const approved = ok<JuliusMemoryClaim>(promoteJuliusMemoryClaim(candidate({ claimId: 'approved' }), {
    to: 'APPROVED', by: 'founder', evidence: [{ kind: 'DECISION', id: 'decision-1' }], at: AT,
  }) as never);
  const guess = candidate({ claimId: 'guess' });
  const [left, right] = ok<readonly [JuliusMemoryClaim, JuliusMemoryClaim]>(
    contradictJuliusMemoryClaims(approved, guess, AT) as never);
  assert.equal(left.trust, 'APPROVED', 'an approved claim is not demoted by a bare assertion');
  assert.equal(right.trust, 'CONTRADICTED');
  assert.ok(left.contradicts.includes('guess'), 'and the conflict is recorded on both');
  assert.ok(right.contradicts.includes('approved'));
});

test('supersession links the replacement to what it replaced', () => {
  const old = candidate({ claimId: 'old' });
  const next = candidate({ claimId: 'next' });
  const [wasOld, isNext] = ok<readonly [JuliusMemoryClaim, JuliusMemoryClaim]>(
    supersedeJuliusMemoryClaim(old, next, AT) as never);
  assert.equal(wasOld.trust, 'SUPERSEDED');
  assert.equal(isNext.supersedes, 'old');
  // A claim about a DIFFERENT entry is not a replacement for this one.
  refused(supersedeJuliusMemoryClaim(old, candidate({ claimId: 'other', entryId: 'entry-2' }), AT) as never);
  // Nor is a claim superseding itself.
  refused(supersedeJuliusMemoryClaim(old, old, AT) as never);
});

test('retrieval never returns a contradicted or superseded claim, whatever it once was', () => {
  const verified = ok<JuliusMemoryClaim>(promoteJuliusMemoryClaim(candidate({ claimId: 'good' }), {
    to: 'VERIFIED', by: 'independent-reviewer-hermes',
    evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
  }) as never);
  const [dead] = ok<readonly [JuliusMemoryClaim, JuliusMemoryClaim]>(
    contradictJuliusMemoryClaims(verified, candidate({ claimId: 'rival' }), AT) as never);
  const bare = candidate({ claimId: 'bare' });

  const got = retrieveTrustedJuliusMemory([verified, dead, bare], {
    minimumTrust: 'VERIFIED', role: 'CODING_AGENT',
  });
  assert.deepEqual(got.map((claim) => claim.claimId), ['good'],
    'only the standing that survives, at or above the bar');

  const low = retrieveTrustedJuliusMemory([verified, bare], {
    minimumTrust: 'UNVERIFIED', role: 'CODING_AGENT',
  });
  assert.deepEqual(low.map((claim) => claim.claimId).sort(), ['bare', 'good'],
    'a lower bar admits more, and the ordering of the states is what decides');
});

test('a promotion that does not raise standing is not a promotion', () => {
  // FOUND BY CHECKING THE SPECIFICATION AGAINST AN IMPLEMENTATION BEFORE PAYING
  // FOR ONE. Nothing else here forbids `promoteJuliusMemoryClaim` from being a
  // general "set the trust field", which would let an APPROVED claim be quietly
  // returned to UNVERIFIED — losing an adopted decision with no record that
  // anything was lost. Trust is expensive to acquire on purpose; it must not be
  // cheap to discard.
  const approved = ok<JuliusMemoryClaim>(promoteJuliusMemoryClaim(candidate({ claimId: 'a' }), {
    to: 'APPROVED', by: 'founder', evidence: [{ kind: 'DECISION', id: 'd' }], at: AT,
  }) as never);
  for (const to of ['UNVERIFIED', 'SUPPORTED', 'VERIFIED', 'APPROVED'] as const) {
    refused(promoteJuliusMemoryClaim(approved, {
      to, by: 'independent-reviewer-hermes',
      evidence: [{ kind: 'REVIEW', id: 'r' }, { kind: 'DECISION', id: 'd' }], at: AT,
    }) as never);
  }
  // Demotion is not what CONTRADICTED and SUPERSEDED are for either: those are
  // reached by contradiction and supersession, which record WHY.
  const bare = candidate({ claimId: 'b' });
  refused(promoteJuliusMemoryClaim(bare, {
    to: 'CONTRADICTED' as never, by: 'independent-reviewer-hermes',
    evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
  }) as never);
  refused(promoteJuliusMemoryClaim(bare, {
    to: 'SUPERSEDED' as never, by: 'independent-reviewer-hermes',
    evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
  }) as never);
});

test('nothing mutates its inputs', () => {
  const claim = candidate();
  const before = JSON.stringify(claim);
  promoteJuliusMemoryClaim(claim, {
    to: 'VERIFIED', by: 'independent-reviewer-hermes',
    evidence: [{ kind: 'REVIEW', id: 'r' }], at: AT,
  });
  contradictJuliusMemoryClaims(claim, candidate({ claimId: 'other' }), AT);
  assert.equal(JSON.stringify(claim), before, 'a claim handed in comes back unchanged');
});
