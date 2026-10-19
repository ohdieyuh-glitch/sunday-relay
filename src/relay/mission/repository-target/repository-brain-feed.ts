import { proposePromotion } from '../../shared/llmops/brain-memory';
import type {
  RelayMemorySource,
  RelayObservationKind,
  RelayPromotionProposal,
  RelayShortTermEntry,
} from '../../shared/llmops/brain-memory';
import type { MissionRepositoryTarget } from './repository-contracts';
import type { DiffJudgement } from './repository-observation';
import type { DeployObservation, ShipStageEvidence, ShipVerdict } from './index';

/**
 * WHAT THE PROJECT BRAIN LEARNS FROM WORKING ON A REAL REPOSITORY.
 *
 * The founder's goal asks for repository architecture, stack, commands,
 * deployment history, failures and verified repairs to reach the **existing**
 * Project Brain. The Brain already models exactly the two states this needs, and
 * `evidence/evidence-brain-link.ts` is the precedent for reaching them from the
 * mission domain — so nothing here is a second store:
 *
 *   SHORT TERM   something was OBSERVED. Provisional, capped at 64, evicted by
 *                recency. A deploy, a refusal, a repair, a ship: all events.
 *   LONG TERM    something is KNOWN about this project. Requires an approver who
 *                is not the proposer, which `isSelfApproved` exists to enforce.
 *
 * THE SPLIT IS THE WHOLE DESIGN, and it falls out of what kind of fact each is:
 *
 *   - **Deployment history, failures, verified repairs are EVENTS.** They happened
 *     at a time, to a mission. They go to short-term memory immediately and
 *     nobody approves them, because nobody is going to approve "the staging
 *     deploy served a stale revision at 04:12".
 *   - **Architecture, stack and commands are KNOWLEDGE.** "This repository's
 *     verification command is `npm test`" is a durable claim that will steer
 *     every future mission, and Relay must not write it into approved memory on
 *     its own authority. It becomes a PROPOSAL. If an agent could promote its own
 *     observation, "the Brain says so" would mean "an agent wrote it down twice".
 *
 * ONLY VERIFIED FACTS ARE EVEN PROPOSED. `proposeRepositoryKnowledge` refuses
 * anything whose evidence Relay did not establish itself — an unverified guess
 * about a repository's build command is exactly the kind of durable claim that
 * would send every later mission down the same wrong path, and a proposal is
 * halfway to approved. Refusing it here is cheaper than un-approving it later.
 *
 * PURE. No Node, no network, no clock; every instant is an injected ISO string.
 * Nothing here writes to the Brain — `rememberShortTerm` does that, and the
 * caller owns the memory it mutates.
 */

/**
 * A repository event is a `run_outcome`, an `error`, or a `repair` — never a new
 * kind.
 *
 * `evidence-brain-link.ts` made the same call for retrievals and stated the
 * reason: the Brain's vocabulary describes what happened to a MISSION, and every
 * exhaustive switch over it would have to grow a branch for an eighth member.
 * A deploy IS a mission outcome, a refused diff IS an error, and a repaired
 * scope violation IS a repair, so the existing three carry all of it.
 */
export const REPOSITORY_OBSERVED_BY = 'Relay repository target';

/**
 * Repository knowledge is `repository_observed`, which the Brain's source
 * vocabulary already had — worth noticing, because it means the design already
 * assumed a repository could teach the Brain something and that it would need
 * approving.
 */
export const REPOSITORY_MEMORY_SOURCE: RelayMemorySource = 'repository_observed';

/* ------------------------------------------------------- observed events */

/**
 * The observation for a judged diff.
 *
 * An ACCEPTED diff is a `run_outcome`; a REFUSED one is an `error`, and its
 * summary names the refusals rather than the count. "3 problems" tells a future
 * mission nothing; "changed a protected path" tells it what not to do again,
 * which is the only reason to write any of this down.
 */
export function observeJudgedDiff(input: {
  readonly judgement: DiffJudgement;
  readonly target: MissionRepositoryTarget;
  readonly missionId: string;
  readonly entryId: string;
  readonly observedAt: string;
}): RelayShortTermEntry {
  const { judgement, target, missionId } = input;
  const accepted = judgement.accepted;
  return {
    entryId: input.entryId,
    kind: accepted ? 'run_outcome' : 'error',
    summary: accepted
      ? `Relay accepted a diff of ${String(judgement.committablePaths.length)} file(s) on `
        + `${target.repositoryKey} (${target.workingBranch}).`
      : `Relay refused a diff on ${target.repositoryKey}: ${judgement.problems.map((p) => p.refusal).join(', ')}.`,
    observedAt: input.observedAt,
    observedBy: REPOSITORY_OBSERVED_BY,
    missionId,
  };
}

/**
 * The observation for one deployment.
 *
 * **A deploy is not a ship, and this entry must not read like one.** The
 * summary states the environment, whether the provider reported a revision, and
 * nothing about whether the software is live — that is `observeShipVerdict`,
 * which reads the probe. A short-term entry saying "deployed to production"
 * beside a mission that never shipped is how a Brain comes to believe something
 * the pipeline explicitly refused to conclude.
 */
export function observeDeployment(input: {
  readonly deployment: DeployObservation;
  readonly repositoryKey: string;
  readonly missionId: string;
  readonly entryId: string;
}): RelayShortTermEntry {
  const { deployment } = input;
  const revision = deployment.deployedRevision === null
    ? 'the provider named no revision'
    : `revision ${deployment.deployedRevision}`;
  return {
    entryId: input.entryId,
    kind: deployment.ok ? 'run_outcome' : 'error',
    summary: deployment.ok
      ? `Deployed ${input.repositoryKey} to ${deployment.environment} via `
        + `${deployment.providerId} — ${revision}. Whether it is live is a separate observation.`
      : `A ${deployment.environment} deploy of ${input.repositoryKey} via ${deployment.providerId} did not succeed.`,
    observedAt: deployment.observedAt,
    observedBy: REPOSITORY_OBSERVED_BY,
    missionId: input.missionId,
  };
}

/**
 * The observation for the ship verdict — the one place "live" may be stated.
 *
 * `ShipVerdict.reason` is carried VERBATIM rather than summarised, because it is
 * already the sentence that explains itself and every rewording is a chance to
 * turn "the running system reports serving a different revision" into "deploy
 * failed". A future mission needs to know WHICH of the four conditions failed.
 */
export function observeShipVerdict(input: {
  readonly verdict: ShipVerdict;
  readonly repositoryKey: string;
  readonly missionId: string;
  readonly entryId: string;
  readonly observedAt: string;
}): RelayShortTermEntry {
  return {
    entryId: input.entryId,
    kind: input.verdict.shipped ? 'run_outcome' : 'error',
    summary: input.verdict.shipped
      ? `SHIPPED ${input.repositoryKey}. ${input.verdict.reason}`
      : `NOT shipped: ${input.repositoryKey}. ${input.verdict.reason}`,
    observedAt: input.observedAt,
    observedBy: REPOSITORY_OBSERVED_BY,
    missionId: input.missionId,
  };
}

/**
 * The observation for a repair that Relay itself re-verified.
 *
 * `verified` is required and there is no default. A repair nobody re-verified is
 * an attempt, and recording an attempt as a repair is how the Brain learns a
 * fix that does not work — which is worse than learning nothing, because the
 * next mission will try it.
 */
export function observeRepair(input: {
  readonly repositoryKey: string;
  readonly missionId: string;
  readonly entryId: string;
  readonly observedAt: string;
  readonly what: string;
  readonly verified: boolean;
}): RelayShortTermEntry {
  return {
    entryId: input.entryId,
    kind: 'repair',
    summary: input.verified
      ? `Repair verified on ${input.repositoryKey}: ${input.what}`
      : `Repair attempted on ${input.repositoryKey} and NOT verified: ${input.what}`,
    observedAt: input.observedAt,
    observedBy: REPOSITORY_OBSERVED_BY,
    missionId: input.missionId,
  };
}

/** Every ship-stage evidence record, as observations, in the order given. */
export function observeShipHistory(input: {
  readonly evidence: readonly ShipStageEvidence[];
  readonly repositoryKey: string;
  readonly missionId: string;
  readonly entryIdFor: (index: number) => string;
}): readonly RelayShortTermEntry[] {
  return input.evidence.map((stage, index) => ({
    entryId: input.entryIdFor(index),
    kind: 'run_outcome' as RelayObservationKind,
    summary: `${input.repositoryKey} reached ${stage.stage}`
      + (stage.commitSha === null ? '' : ` at ${stage.commitSha}`)
      + (stage.environment === null ? '' : ` (${stage.environment})`)
      + '.',
    observedAt: stage.observedAt,
    observedBy: REPOSITORY_OBSERVED_BY,
    missionId: input.missionId,
  }));
}

/* ------------------------------------------------- proposed knowledge */

/**
 * WHAT A REPOSITORY CAN TEACH THE BRAIN, and the one kind of claim it may make.
 *
 * Deliberately narrow. Each member is a fact Relay can OBSERVE from a repository
 * it has already read — not a judgement about it. There is no
 * `code_quality`, no `recommended_refactor`, no `technical_debt`: those are
 * opinions, they would arrive from a model, and an approval flow full of model
 * opinions is an approval flow nobody reads.
 */
export const REPOSITORY_KNOWLEDGE_KINDS = [
  /** e.g. "the verification command is `npm test`". */
  'verification_command',
  /** e.g. "the build command is `npm run build`". */
  'build_command',
  /** e.g. "TypeScript, Vite, Vitest". */
  'stack',
  /** e.g. "the domain is pure and the UI is a consumer of it". */
  'architecture',
  /** e.g. "the default branch is `main` and is protected". */
  'branch_policy',
  /** e.g. "staging deploys are served by the local-directory provider". */
  'deployment_target',
] as const;
export type RepositoryKnowledgeKind = (typeof REPOSITORY_KNOWLEDGE_KINDS)[number];

export type RepositoryKnowledgeRefusal =
  | 'not_verified'
  | 'no_citation'
  | 'empty_statement'
  | 'unknown_kind'
  | 'no_proposer';

/**
 * Propose a durable repository fact, or refuse to.
 *
 * Returns a `RelayPromotionProposal` — never a `RelayLongTermEntry`. There is
 * deliberately no function in this module that produces an approved entry, for
 * the reason `brain-memory.ts` gives about its own absence of one: a module that
 * could mint an approved entry would make the approval flow optional.
 *
 * FOUR REFUSALS, and `not_verified` is the one that matters. Relay may only
 * propose what it established itself — it ran the command, it read the manifest,
 * it observed the branch. A stack inferred by a model from a filename is a claim
 * that would steer every future mission, and it is refused here rather than
 * un-approved later.
 */
export function proposeRepositoryKnowledge(input: {
  readonly kind: RepositoryKnowledgeKind;
  readonly statement: string;
  /** The short-term observation this rests on. Its id becomes the basis. */
  readonly basis: RelayShortTermEntry;
  /** Where anyone can go and check: a path, a command, a mission id. */
  readonly citation: string;
  readonly proposedBy: string;
  readonly proposedAt: string;
  /**
   * Did RELAY establish this, by running or reading something? A model's
   * assertion is not verification, and this parameter has no default.
   */
  readonly verifiedByRelay: boolean;
  readonly supporting?: readonly RelayShortTermEntry[];
}):
  | { readonly ok: true; readonly proposal: RelayPromotionProposal }
  | { readonly ok: false; readonly refusal: RepositoryKnowledgeRefusal; readonly reason: string } {
  if (!(REPOSITORY_KNOWLEDGE_KINDS as readonly string[]).includes(input.kind)) {
    return { ok: false, refusal: 'unknown_kind', reason: `"${String(input.kind)}" is not a repository knowledge kind.` };
  }
  if (typeof input.statement !== 'string' || input.statement.trim() === '') {
    return { ok: false, refusal: 'empty_statement', reason: 'A proposal with no statement proposes nothing.' };
  }
  if (typeof input.citation !== 'string' || input.citation.trim() === '') {
    return {
      ok: false,
      refusal: 'no_citation',
      reason: 'A durable fact needs somewhere anyone can go and check it.',
    };
  }
  /**
   * A PROPOSAL MUST NAME ITS PROPOSER, and this is not cosmetic.
   *
   * `isSelfApproved` in `brain-memory.ts` is
   * `proposer !== '' && proposer === approver` — so an entry whose proposer
   * normalises to the empty string is reported as NOT self-approved whoever
   * approves it. An empty `proposedBy` is therefore a proposal that, once
   * approved by anybody including the agent that wrote it, evades the one guard
   * that makes long-term memory worth trusting. An independent review found it
   * by proposing with `proposedBy: ''`.
   */
  if (typeof input.proposedBy !== 'string' || input.proposedBy.trim() === '') {
    return {
      ok: false,
      refusal: 'no_proposer',
      reason:
        'A proposal must name who proposed it. An empty proposer defeats `isSelfApproved`, '
        + 'which is the only thing standing between an agent and approving its own claim.',
    };
  }
  /**
   * `!== true`, NOT falsy. `verifiedByRelay` is a required parameter, which makes
   * it un-defaultable — and a required parameter is still just a value. A review
   * executed `"false"`, `1`, `{}` and `[]` through it and every one PROPOSED,
   * because a truthy non-boolean passes a falsy check. A JSON-sourced `"false"`
   * is the realistic one.
   */
  if (input.verifiedByRelay !== true) {
    return {
      ok: false,
      refusal: 'not_verified',
      reason:
        'Relay did not establish this itself, so it may not be proposed as durable project knowledge. '
        + 'It can be recorded as a short-term observation instead.',
    };
  }
  /**
   * `proposePromotion` DOES THE BUILDING, and this used to re-implement its body.
   *
   * `REPOSITORY_TARGETS.md` already claimed the feed reaches the Brain's own
   * functions rather than restating them, and it reached its SHAPES while copying
   * the basis-deduplication logic by hand. One means: if the Brain ever adds a
   * field to a proposal, this gets it.
   */
  return {
    ok: true,
    proposal: proposePromotion({
      entry: input.basis,
      // Prefixed with the kind so a human approving a queue can see WHAT kind
      // of claim they are approving without reading the whole sentence.
      statement: `[${input.kind}] ${input.statement.trim()}`,
      source: REPOSITORY_MEMORY_SOURCE,
      citation: input.citation.trim(),
      proposedBy: input.proposedBy.trim(),
      proposedAt: input.proposedAt,
      supporting: input.supporting,
    }),
  };
}
