import {
  observeDeployment,
  observeShipHistory,
  observeShipVerdict,
} from '../src/relay/mission/repository-target';
import { rememberShortTerm } from '../src/relay/shared/llmops/brain-memory';
import type { ShipRunResult } from './ship-runner';
import type { RelayShortTermMemory } from '../src/relay/shared/llmops/brain-memory';

/**
 * THE PRODUCER THE BRAIN FEED NEVER HAD.
 *
 * `repository-brain-feed.ts` projects repository work into the EXISTING Brain
 * — `rememberShortTerm`, following the `evidence/evidence-brain-link.ts`
 * precedent — and `REPOSITORY_TARGETS.md` has listed it as "BUILT but has no
 * producer" since it landed. Nothing called it, so the goal's requirement to
 * feed deployment history, failures and verified repairs into Project Brain
 * was satisfied by a projection with no input.
 *
 * `runShipLifecycle` produces exactly those events, so this is the join. It is
 * a pure function of a `ShipRunResult` plus the memory it is folding into: no
 * clock, no IO, no second store. The Brain is the Brain.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It writes only SHORT-TERM observations and
 * never promotes anything to long-term memory. Promotion goes through
 * `proposeRepositoryKnowledge`, which returns a PROPOSAL a human approves —
 * "only what Relay established itself may even be proposed" — and a ship run is
 * an episode, not a durable fact about a repository. A run that shipped tells
 * you what happened once; it does not establish how the repository works.
 */

export interface ShipBrainFeedInput {
  readonly result: ShipRunResult;
  readonly repositoryKey: string;
  readonly missionId: string;
  /**
   * Stable, caller-supplied entry ids. NOT generated here: the domain has no
   * clock and no randomness, and an id minted inside a fold cannot be
   * reconciled with the record it describes after a restart.
   */
  readonly entryIdFor: (slug: string) => string;
  readonly observedAt: string;
}

/**
 * Fold one ship run into short-term memory.
 *
 * Order is the order things HAPPENED — stage history first, then the deploy
 * observation, then the verdict — because the Brain reads the sequence and a
 * verdict recorded before the deploy it judges reads as a prediction.
 */
export function rememberShipRun(
  memory: RelayShortTermMemory,
  input: ShipBrainFeedInput,
): RelayShortTermMemory {
  const { result, repositoryKey, missionId, entryIdFor, observedAt } = input;
  let next = memory;

  for (const entry of observeShipHistory({
    evidence: result.evidence,
    repositoryKey,
    missionId,
    entryIdFor: (index) => entryIdFor(`stage-${String(index)}`),
  })) {
    next = rememberShortTerm(next, entry);
  }

  /**
   * The deploy observation is recorded SEPARATELY from the stage history,
   * because the stage line says a stage was reached and this says what the
   * provider reported — including a `deployedRevision` that does not match, on
   * a run whose stage history reads `deployed`. Collapsing them would lose the
   * only record of the disagreement.
   */
  const deployed = result.evidence.find((stage) => stage.stage === 'deployed');
  if (deployed !== undefined && deployed.environment !== null) {
    next = rememberShortTerm(next, observeDeployment({
      deployment: {
        ok: true,
        providerId: 'recorded',
        environment: deployed.environment,
        deployedRevision: deployed.deployedRevision,
        deploymentRef: null,
        url: null,
        observedAt: deployed.observedAt,
        detail: deployed.detail,
      },
      repositoryKey,
      missionId,
      entryId: entryIdFor('deployment'),
    }));
  }

  /**
   * A verdict is recorded whether or not it says shipped, and
   * `observeShipVerdict` files a refusal under `error` rather than
   * `run_outcome`. A Brain that only remembers the runs that worked learns that
   * everything works.
   */
  if (result.verdict !== null) {
    next = rememberShortTerm(next, observeShipVerdict({
      verdict: result.verdict,
      repositoryKey,
      missionId,
      entryId: entryIdFor('verdict'),
      observedAt,
    }));
  }

  return next;
}
