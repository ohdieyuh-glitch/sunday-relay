import { describe, expect, it } from 'vitest';

import {
  REPOSITORY_KNOWLEDGE_KINDS,
  REPOSITORY_MEMORY_SOURCE,
  observeDeployment,
  observeJudgedDiff,
  observeRepair,
  observeShipHistory,
  observeShipVerdict,
  proposeRepositoryKnowledge,
} from './index';
import type {
  DeployObservation,
  DiffJudgement,
  MissionRepositoryTarget,
  ShipStageEvidence,
} from './index';
import { RELAY_MEMORY_SOURCES, RELAY_OBSERVATION_KINDS, rememberShortTerm, emptyShortTermMemory } from '../../shared/llmops/brain-memory';
import type { RelayShortTermEntry } from '../../shared/llmops/brain-memory';

/**
 * WHAT WORKING ON A REAL REPOSITORY TEACHES THE PROJECT BRAIN.
 *
 * The line these tests hold is the one that makes the Brain worth trusting:
 * **events go to short-term memory and nobody approves them; knowledge becomes a
 * PROPOSAL and a human does.** Collapsing the two would let a Mission write
 * "this repository's verification command is X" into approved memory on its own
 * authority, and every later mission would follow it.
 *
 * Nothing here touches a filesystem, a network or a clock.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
const MISSION = 'msn-repo-1';

const target = { repositoryKey: 'local:demo', workingBranch: 'relay/mission-1' } as MissionRepositoryTarget;

const judgement = (over: Partial<DiffJudgement> = {}): DiffJudgement => ({
  accepted: true,
  problems: [],
  scope: { allowed: ['src/a.ts'], protectedHits: [], outOfScope: [], invalid: [] },
  ceilings: { within: true, problems: [], filesChanged: 1, linesRemoved: 0, deletedPaths: [] },
  committablePaths: ['src/a.ts'],
  ...over,
});

const basis: RelayShortTermEntry = {
  entryId: 'st-1',
  kind: 'run_outcome',
  summary: 'Relay ran the verification command.',
  observedAt: NOW,
  observedBy: 'Relay repository target',
  missionId: MISSION,
};

/* ============================================================== events */

describe('repository events reach SHORT-TERM memory, using the Brain\'s own kinds', () => {
  it('uses only observation kinds the Brain already defines', () => {
    const entries = [
      observeJudgedDiff({ judgement: judgement(), target, missionId: MISSION, entryId: 'e1', observedAt: NOW }),
      observeJudgedDiff({
        judgement: judgement({ accepted: false, problems: [{ refusal: 'protected_path_unprotect_refused', message: 'x' }], committablePaths: [] }),
        target, missionId: MISSION, entryId: 'e2', observedAt: NOW,
      }),
      observeRepair({ repositoryKey: 'local:demo', missionId: MISSION, entryId: 'e3', observedAt: NOW, what: 'scope', verified: true }),
    ];
    for (const entry of entries) {
      // A new eighth kind would put a source class into a vocabulary about
      // mission events, and every exhaustive switch would grow a branch.
      expect(RELAY_OBSERVATION_KINDS, entry.entryId).toContain(entry.kind);
      // An unattributed observation is a rumour.
      expect(entry.observedBy.length).toBeGreaterThan(0);
    }
  });

  it('records an accepted diff as an outcome and a refused one as an error, naming the refusals', () => {
    const accepted = observeJudgedDiff({ judgement: judgement(), target, missionId: MISSION, entryId: 'e1', observedAt: NOW });
    expect(accepted.kind).toBe('run_outcome');

    const refused = observeJudgedDiff({
      judgement: judgement({
        accepted: false,
        problems: [
          { refusal: 'protected_path_unprotect_refused', message: 'protected' },
          { refusal: 'ceiling_exceeded', message: 'too many' },
        ],
        committablePaths: [],
      }),
      target, missionId: MISSION, entryId: 'e2', observedAt: NOW,
    });
    expect(refused.kind).toBe('error');
    // "2 problems" teaches a future mission nothing. The refusal names do.
    expect(refused.summary).toContain('protected_path_unprotect_refused');
    expect(refused.summary).toContain('ceiling_exceeded');
  });

  it('never lets a DEPLOY observation read as a ship', () => {
    const deployment: DeployObservation = {
      ok: true, providerId: 'local-directory', environment: 'production',
      deployedRevision: SHA, deploymentRef: 'd-1', url: null, observedAt: NOW, detail: null,
    };
    const entry = observeDeployment({ deployment, repositoryKey: 'local:demo', missionId: MISSION, entryId: 'e1' });
    /**
     * A short-term entry saying "deployed to production" beside a mission that
     * never shipped is how a Brain comes to believe something the pipeline
     * explicitly refused to conclude.
     */
    expect(entry.summary).toContain('Whether it is live is a separate observation');
    expect(entry.summary).not.toMatch(/\bshipped\b/i);
    expect(entry.summary).not.toMatch(/\blive\b(?!.*separate)/i);
  });

  it('says the provider named no revision, rather than omitting the fact', () => {
    const entry = observeDeployment({
      deployment: {
        ok: true, providerId: 'p', environment: 'staging', deployedRevision: null,
        deploymentRef: null, url: null, observedAt: NOW, detail: null,
      },
      repositoryKey: 'local:demo', missionId: MISSION, entryId: 'e1',
    });
    expect(entry.summary).toContain('the provider named no revision');
  });

  it('carries the ship verdict\'s reason VERBATIM', () => {
    const reason = 'The running system reports serving ffff, not the committed a1b2.';
    const entry = observeShipVerdict({
      verdict: { shipped: false, reason, liveRevision: 'ffff' },
      repositoryKey: 'local:demo', missionId: MISSION, entryId: 'e1', observedAt: NOW,
    });
    expect(entry.kind).toBe('error');
    // Every rewording is a chance to turn "served a different revision" into
    // "deploy failed", and a future mission needs to know which of the four
    // conditions actually failed.
    expect(entry.summary).toContain(reason);
    expect(entry.summary).toContain('NOT shipped');
  });

  it('distinguishes a verified repair from an attempted one', () => {
    const verified = observeRepair({
      repositoryKey: 'local:demo', missionId: MISSION, entryId: 'e1', observedAt: NOW,
      what: 'removed the regex', verified: true,
    });
    const attempted = observeRepair({
      repositoryKey: 'local:demo', missionId: MISSION, entryId: 'e2', observedAt: NOW,
      what: 'removed the regex', verified: false,
    });
    expect(verified.summary).toContain('Repair verified');
    /**
     * Recording an attempt as a repair is how the Brain learns a fix that does
     * not work — worse than learning nothing, because the next mission tries it.
     */
    expect(attempted.summary).toContain('NOT verified');
    expect(attempted.summary).not.toContain('Repair verified');
  });

  it('projects a ship history in order, and the entries survive the Brain\'s own buffer', () => {
    const stage = (s: ShipStageEvidence['stage'], at: string): ShipStageEvidence => ({
      stage: s, observedAt: at, commitSha: SHA, branch: 'relay/mission-1',
      remoteRef: null, pullRequestRef: null, environment: null,
      deployedRevision: null, liveProbe: null, detail: null,
    });
    const entries = observeShipHistory({
      evidence: [stage('committed', NOW), stage('pushed', '2026-08-11T12:00:01.000Z')],
      repositoryKey: 'local:demo', missionId: MISSION, entryIdFor: (i) => `h-${String(i)}`,
    });
    expect(entries.map((e) => e.entryId)).toEqual(['h-0', 'h-1']);
    expect(entries[0]?.summary).toContain('committed');

    // And the real Brain accepts them — this is the existing store, not a new one.
    // `rememberShortTerm` takes ONE entry, so the history is folded in — which
    // is also the honest way a caller would use it.
    const memory = entries.reduce((acc, entry) => rememberShortTerm(acc, entry), emptyShortTermMemory());
    expect(memory.entries).toHaveLength(2);
    expect(memory.entries.map((e) => e.entryId)).toEqual(['h-0', 'h-1']);
  });
});

/* =========================================================== knowledge */

describe('repository KNOWLEDGE is only ever proposed, and only when Relay established it', () => {
  const propose = (over: Record<string, unknown> = {}) =>
    proposeRepositoryKnowledge({
      kind: 'verification_command',
      statement: 'The verification command is `npm test`.',
      basis,
      citation: 'package.json scripts.test',
      proposedBy: 'Relay',
      proposedAt: NOW,
      verifiedByRelay: true,
      ...over,
    } as Parameters<typeof proposeRepositoryKnowledge>[0]);

  it('returns a PROPOSAL, with a source the Brain already had', () => {
    const result = propose();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.source).toBe(REPOSITORY_MEMORY_SOURCE);
    // The vocabulary already assumed a repository could teach the Brain
    // something and that it would need approving.
    expect(RELAY_MEMORY_SOURCES).toContain(result.proposal.source);
    // There is no `approvedBy` anywhere on a proposal, by construction.
    expect(Object.keys(result.proposal)).not.toContain('approvedBy');
    expect(result.proposal.basis).toEqual(['st-1']);
  });

  it('REFUSES anything Relay did not establish itself', () => {
    const result = propose({ verifiedByRelay: false });
    expect(result.ok).toBe(false);
    /**
     * A stack inferred by a model from a filename is a claim that would steer
     * every future mission, and a proposal is halfway to approved. Refusing it
     * here is cheaper than un-approving it later.
     */
    if (!result.ok) {
      expect(result.refusal).toBe('not_verified');
      // The refusal says what to do instead rather than only saying no.
      expect(result.reason).toContain('short-term observation');
    }
  });

  it('refuses a TRUTHY NON-BOOLEAN, not merely a falsy one', () => {
    /**
     * `verifiedByRelay` is a required parameter, which makes it un-defaultable —
     * and a required parameter is still just a value. A review executed
     * `"false"`, `1`, `{}` and `[]` through the falsy check and every one
     * PROPOSED. A JSON-sourced `"false"` is the realistic one.
     */
    for (const bad of ['false', 'true', 1, {}, [], 'yes'] as const) {
      const result = propose({ verifiedByRelay: bad });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('not_verified');
    }
    // And a real `true` still proposes.
    expect(propose({ verifiedByRelay: true }).ok).toBe(true);
  });

  it('refuses a proposal that does not name its proposer', () => {
    /**
     * `isSelfApproved` is `proposer !== '' && proposer === approver`, so an entry
     * whose proposer normalises to the empty string is reported as NOT
     * self-approved whoever approves it. An empty `proposedBy` is a proposal
     * that, once approved by anybody including the agent that wrote it, evades
     * the one guard that makes long-term memory worth trusting.
     */
    for (const bad of ['', '   ', undefined, null] as const) {
      const result = propose({ proposedBy: bad });
      expect(result.ok, JSON.stringify(bad)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe('no_proposer');
    }
  });

  it('builds the proposal through the Brain\'s own proposePromotion', () => {
    // It reached the Brain's SHAPES while copying its basis-deduplication logic
    // by hand. One means: a field added to a proposal arrives here for free.
    const result = propose({ supporting: [{ ...basis, entryId: 'st-2' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.proposal.basis).toEqual(['st-1', 'st-2']);
  });

  it('refuses a proposal with no citation, no statement, or an unknown kind', () => {
    for (const [over, refusal] of [
      [{ citation: '   ' }, 'no_citation'],
      [{ statement: '' }, 'empty_statement'],
      [{ kind: 'code_quality' }, 'unknown_kind'],
    ] as const) {
      const result = propose(over);
      expect(result.ok, JSON.stringify(over)).toBe(false);
      if (!result.ok) expect(result.refusal).toBe(refusal);
    }
  });

  it('has no kind that carries an opinion', () => {
    // An approval flow full of model opinions is an approval flow nobody reads.
    for (const forbidden of ['code_quality', 'technical_debt', 'recommended_refactor', 'risk']) {
      expect(REPOSITORY_KNOWLEDGE_KINDS as readonly string[]).not.toContain(forbidden);
    }
    // And the six it does have are all facts Relay can observe.
    expect(REPOSITORY_KNOWLEDGE_KINDS).toHaveLength(6);
  });

  it('labels the statement with its kind so an approver sees what they are approving', () => {
    const result = propose({ kind: 'stack', statement: 'TypeScript, Vite, Vitest.' });
    expect(result.ok && result.proposal.statement).toBe('[stack] TypeScript, Vite, Vitest.');
  });
});
