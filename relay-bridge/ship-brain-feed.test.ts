import { describe, expect, it } from 'vitest';

import { rememberShipRun } from './ship-brain-feed';
import { emptyShortTermMemory } from '../src/relay/shared/llmops/brain-memory';
import type { ShipRunResult } from './ship-runner';
import type { ShipStageEvidence } from '../src/relay/mission/repository-target';

/**
 * THE BRAIN FEED, WITH A PRODUCER.
 *
 * `repository-brain-feed.ts` was BUILT and nothing called it, so "feed
 * deployment history, failures and verified repairs into Project Brain" was
 * satisfied by a projection with no input. These hold the join.
 *
 * The failure worth catching is a Brain that remembers only the runs that
 * worked, because it then learns that everything works.
 */

const NOW = '2026-08-11T12:00:00.000Z';
const SHA = 'a'.repeat(40);
const STALE = 'b'.repeat(40);

const stage = (over: Partial<ShipStageEvidence>): ShipStageEvidence => ({
  stage: 'committed',
  observedAt: NOW,
  commitSha: SHA,
  branch: 'relay/mission-1',
  remoteRef: null,
  pullRequestRef: null,
  environment: null,
  deployedRevision: null,
  liveProbe: null,
  detail: null,
  ...over,
});

const feed = (result: ShipRunResult) =>
  rememberShipRun(emptyShortTermMemory(), {
    result,
    repositoryKey: 'local:demo',
    missionId: 'mission-1',
    entryIdFor: (slug) => `entry-${slug}`,
    observedAt: NOW,
  });

describe('a ship run reaches the Brain', () => {
  it('records every stage in the order it happened', () => {
    const memory = feed({
      stage: 'deployed',
      evidence: [
        stage({ stage: 'committed' }),
        stage({ stage: 'deployed', environment: 'staging', deployedRevision: SHA }),
      ],
      commitSha: SHA,
      verdict: null,
      stoppedBy: null,
    });
    const summaries = memory.entries.map((e) => e.summary);
    expect(summaries.some((s) => s.includes('reached committed'))).toBe(true);
    expect(summaries.some((s) => s.includes('reached deployed'))).toBe(true);
  });

  it('records a NOT-shipped verdict as an error, not silence', () => {
    /**
     * The whole point. A Brain fed only successes learns that deploys always
     * work, and the next Mission inherits that.
     */
    const memory = feed({
      stage: 'deployed',
      evidence: [stage({ stage: 'deployed', environment: 'staging', deployedRevision: STALE })],
      commitSha: SHA,
      verdict: { shipped: false, reason: 'The deployed revision is not the one Relay committed.', liveRevision: null },
      stoppedBy: 'The deployed revision is not the one Relay committed.',
    });
    const verdict = memory.entries.find((e) => e.entryId === 'entry-verdict');
    expect(verdict).toBeDefined();
    expect(verdict?.kind).toBe('error');
    expect(verdict?.summary).toContain('NOT shipped');
  });

  it('keeps the provider\'s revision even when the stage line says deployed', () => {
    /**
     * The stage history says a stage was reached; the deploy observation says
     * what the provider reported. On a stale deploy those disagree, and
     * collapsing them into one entry would lose the only record of it.
     */
    const memory = feed({
      stage: 'deployed',
      evidence: [stage({ stage: 'deployed', environment: 'staging', deployedRevision: STALE })],
      commitSha: SHA,
      verdict: { shipped: false, reason: 'stale', liveRevision: null },
      stoppedBy: 'stale',
    });
    const deployment = memory.entries.find((e) => e.entryId === 'entry-deployment');
    expect(deployment).toBeDefined();
    expect(deployment?.summary).toContain(STALE);
  });

  it('records a run that only committed, with no verdict invented', () => {
    const memory = feed({
      stage: 'committed',
      evidence: [stage({ stage: 'committed' })],
      commitSha: SHA,
      verdict: null,
      stoppedBy: null,
    });
    // No deployment happened and none is recorded. Unknown is not zero, and it
    // is certainly not a deployment.
    expect(memory.entries.find((e) => e.entryId === 'entry-deployment')).toBeUndefined();
    expect(memory.entries.find((e) => e.entryId === 'entry-verdict')).toBeUndefined();
    expect(memory.entries).toHaveLength(1);
  });

  it('promotes NOTHING to long-term memory', () => {
    /**
     * A ship run is an episode, not a durable fact about a repository. It says
     * what happened once; it does not establish how the repository works.
     * Promotion goes through `proposeRepositoryKnowledge` and a human.
     */
    const memory = feed({
      stage: 'shipped',
      evidence: [stage({ stage: 'shipped', environment: 'staging', deployedRevision: SHA })],
      commitSha: SHA,
      verdict: { shipped: true, reason: 'live and serving the committed revision', liveRevision: SHA },
      stoppedBy: null,
    });
    // The fold returns SHORT-term memory and touches nothing else.
    expect(Object.keys(memory)).toEqual(Object.keys(emptyShortTermMemory()));
    expect(memory.entries.every((e) => e.observedBy !== undefined)).toBe(true);
  });
});
