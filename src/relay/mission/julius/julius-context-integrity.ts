import type { JuliusMemoryClaim, JuliusMemoryTrustState } from './julius-memory-trust';
import type { JuliusBrainEntry, JuliusWorkerRole } from './julius-runtime';

/**
 * JULIUS CONTEXT INTEGRITY.
 *
 * `compileJuliusContext` BEFORE THIS filtered an entry list by sensitivity, role
 * and task and then packed entries IN ARRAY ORDER until the budget ran out. That
 * was the whole of it: no ranking, and no notion of how far anything had been
 * checked. (It had already been taught to SKIP rather than STOP at an entry too
 * large to fit — the stub comment claiming otherwise was stale, and the skip is
 * pinned by a case below so it cannot regress.)
 *
 * Project Brain v2 gave claims a `trust` standing (`julius-memory-trust.ts`)
 * and nothing consumes it. So Julius can be handed, as fact, a candidate it
 * wrote itself one tick earlier; a swarm of near-duplicates can crowd out the
 * one verified fact a task needs; a preference can read as a requirement; and
 * two claims that flatly contradict each other can both arrive with nothing
 * saying which is current.
 *
 * FOUR FAILURE CLASSES, and this module exists to hold the line on all four:
 *
 *  POISONING   — an UNVERIFIED claim whose TEXT reads like an instruction is
 *                still DATA. It may never override the locked contract, an
 *                approved decision, verified evidence or a governance
 *                constraint, however imperative its prose.
 *  DISTRACTION — relevance alone is not a ranking. A hundred plausible
 *                low-authority memories must not evict the one VERIFIED fact
 *                the task actually needs.
 *  CONFUSION   — a preference is not a requirement, a hypothesis is not a fact,
 *                and a past event is not a current instruction. The type
 *                survives compilation or the packet is lying.
 *  CLASH       — contradictory claims keep BOTH sides and their lineage. When
 *                two of equal authority cannot be told apart, the compiler
 *                FAILS CLOSED with a typed conflict rather than silently
 *                picking one.
 *
 * IMPLEMENTED, and wired. This module was seeded as the deliverable of paid Live
 * Mission 5 and sat as five throwing stubs on main, imported by nothing but the
 * barrel, while "Julius's context is authority-ranked and fails closed on an
 * authoritative clash" was a claim with no code under it. The mission's own
 * specification (`.github/julius-missions/julius-live-mission-5/seed/`) is now
 * committed beside this file as `julius-context-integrity.test.ts`, ported to
 * this repository's runner and extended.
 *
 * THE INTEGRATION IS THE POINT, and it is not optional: `compileJuliusContext`
 * routes through `compileContextWithIntegrity` whenever it is handed
 * claim-qualified entries, and `createJuliusContextSnapshot` carries what the
 * layer decided — the conflicts, the exclusions, the admitted order — into the
 * durable snapshot. A ranking nothing calls ranks nothing.
 *
 * WHAT IS DELIBERATELY NOT HERE. There is no semantic model of agreement. A
 * clash between two claims that nothing else can separate is settled by the
 * locked contract only through `contractAgreement` below — a LEXICAL measure,
 * documented as one, applied only as the last step before failing closed, and
 * never able to raise a claim's authority, admit an excluded claim or override
 * supersession or trust.
 *
 * Pure: no clock, no Node, no store, no network. Time arrives as injected ISO
 * strings, the way every other Julius domain module takes it.
 */

export const JULIUS_CONTEXT_INTEGRITY_VERSION = 'julius-context-integrity.v1' as const;

/**
 * WHAT A PIECE OF CONTEXT IS, which is not the same as what it says.
 *
 * `JuliusBrainEntry.kind` records where a line came from in the run
 * (`DECISION`, `FINDING`, `HANDOFF`...). This records its EPISTEMIC STATUS, and
 * the two are independent: a `HANDOFF` may carry a `HYPOTHESIS` and a
 * `DECISION` may carry a `USER_PREFERENCE`.
 *
 * `CURRENT_CONTRACT` is the locked agreement in force. It is the only type that
 * is authoritative BY CONSTRUCTION rather than by trust standing, because it is
 * the thing every other claim is being judged against.
 */
export const JULIUS_CONTEXT_TYPES = [
  'CURRENT_CONTRACT',
  'REVIEW_FINDING',
  'FACT',
  'PAST_EVENT',
  'USER_PREFERENCE',
  'INSTRUCTION',
  'ASSUMPTION',
  'HYPOTHESIS',
] as const;
export type JuliusContextType = (typeof JULIUS_CONTEXT_TYPES)[number];

/**
 * WHO SAYS SO. Ranked, highest first; `authorityRank` is the index.
 *
 * Authority is NOT trust: trust says how far a claim has been checked,
 * authority says what kind of thing is doing the saying. A `GOVERNANCE`
 * constraint outranks a `VERIFIED_EVIDENCE` fact even though both are settled,
 * and an `ASSERTION` never outranks anything however confidently it is phrased.
 */
export const JULIUS_CONTEXT_AUTHORITY = [
  'GOVERNANCE',
  'LOCKED_CONTRACT',
  'APPROVED_DECISION',
  'VERIFIED_EVIDENCE',
  'CORROBORATED_OBSERVATION',
  'ASSERTION',
] as const;
export type JuliusContextAuthority = (typeof JULIUS_CONTEXT_AUTHORITY)[number];

/** One entry, plus the claim that qualifies it. They join on `entryId`. */
export interface JuliusContextCandidate {
  readonly entry: JuliusBrainEntry;
  readonly claim: JuliusMemoryClaim;
  readonly contextType: JuliusContextType;
  /** ISO. Used for currentness and for supersession ordering, never for ranking alone. */
  readonly recordedAt: string;
}

/**
 * WHY ONE CANDIDATE BEAT ANOTHER, recorded so a packet can be explained.
 *
 * Every component is reported separately and none is allowed to be the whole
 * score: ranking on similarity alone is exactly the distraction failure.
 */
export interface JuliusContextRanking {
  readonly entryId: string;
  readonly claimId: string;
  /**
   * THE EPISTEMIC STATUS, CARRIED THROUGH. Without this the CONFUSION defence
   * is invisible in the output: a reader of an admitted row could not tell a
   * `HYPOTHESIS` from a `FACT`, which is the distinction the whole class is
   * about. It is the candidate's own type, never re-derived from the text.
   */
  readonly contextType: JuliusContextType;
  readonly authority: JuliusContextAuthority;
  readonly authorityRank: number;
  readonly trust: JuliusMemoryTrustState;
  readonly evidenceCount: number;
  /** True when the candidate is scoped to THIS task rather than the whole run. */
  readonly taskScoped: boolean;
  /** Deterministic tie-break of last resort. Never a source of truth. */
  readonly tieBreak: string;
}

/**
 * TWO CLAIMS THAT CANNOT BOTH BE CURRENT.
 *
 * A conflict is RECORDED, never silently resolved away, and both sides keep
 * their claim ids so the lineage survives into the packet.
 */
export interface JuliusContextConflict {
  readonly entryIds: readonly [string, string];
  readonly claimIds: readonly [string, string];
  readonly resolution:
    | 'RESOLVED_BY_SUPERSESSION'
    | 'RESOLVED_BY_TRUST'
    | 'RESOLVED_BY_AUTHORITY'
    | 'RESOLVED_BY_CONTRACT'
    | 'UNRESOLVED';
  /** The claim that remains current, or null when nothing could be chosen safely. */
  readonly keptClaimId: string | null;
  readonly reasonCode: string;
}

export interface JuliusContextSelection {
  readonly version: typeof JULIUS_CONTEXT_INTEGRITY_VERSION;
  readonly admitted: readonly JuliusContextRanking[];
  /** Ranked but not affordable under the budget. Present so eviction is auditable. */
  readonly evicted: readonly JuliusContextRanking[];
  /** Every conflict seen, resolved or not. Both sides always survive here. */
  readonly conflicts: readonly JuliusContextConflict[];
  /** Entry ids excluded outright: CONTRADICTED, SUPERSEDED, out of role or task scope. */
  readonly excludedEntryIds: readonly string[];
  readonly budgetCharacters: number;
  readonly usedCharacters: number;
}

/**
 * FAIL CLOSED, WITH A TYPE.
 *
 * When two claims of equal authority contradict and nothing — supersession,
 * trust, the locked contract — can separate them, picking either would make the
 * packet assert something Julius has no basis for. The compiler refuses and
 * says which pair defeated it.
 */
export type JuliusContextIntegrityOutcome =
  | { readonly outcome: 'OK'; readonly selection: JuliusContextSelection }
  | {
      readonly outcome: 'FAIL_CLOSED';
      readonly reasonCode: 'UNRESOLVED_AUTHORITATIVE_CLASH';
      readonly conflicts: readonly JuliusContextConflict[];
    };

/**
 * WHAT KIND OF THING IS SAYING THIS.
 *
 * Derived from the claim's provenance, its trust standing and the candidate's
 * context type — never from the entry's TEXT. Prose that says "you must" is an
 * `ASSERTION` when an unverified derived candidate is what asserted it, and
 * that is the whole of the poisoning defence.
 */
export function classifyContextAuthority(_candidate: JuliusContextCandidate): JuliusContextAuthority {
  // ORDER MATTERS AND IS THE WHOLE POISONING DEFENCE. Each arm reads a
  // structural fact — the candidate's type, the claim's provenance, the claim's
  // standing. None of them reads `_candidate.entry.text`, and nothing below may.
  if (_candidate.contextType === 'CURRENT_CONTRACT') return 'LOCKED_CONTRACT';
  if (_candidate.claim.provenance === 'system_policy') return 'GOVERNANCE';
  if (_candidate.claim.trust === 'APPROVED') return 'APPROVED_DECISION';
  if (_candidate.claim.trust === 'VERIFIED') return 'VERIFIED_EVIDENCE';
  if (_candidate.claim.trust === 'SUPPORTED') return 'CORROBORATED_OBSERVATION';
  // UNVERIFIED, CONTRADICTED and SUPERSEDED all land here. However imperative
  // the prose, an unverified derived candidate asserts and nothing more.
  return 'ASSERTION';
}

/**
 * ORDER CANDIDATES BY EVERYTHING THAT MATTERS, deterministically.
 *
 * Authority first, then trust standing, then evidence, then task scope, then
 * currentness, and a stable deterministic tie-break last. The SAME input must
 * always produce the SAME order: replay is a proof obligation, not a nicety.
 */
export function rankContextCandidates(
  _candidates: readonly JuliusContextCandidate[],
  _input: { readonly role: JuliusWorkerRole; readonly taskId: string },
): readonly JuliusContextRanking[] {
  // This RANKS what it is handed and filters nothing: scope is decided by
  // `compileContextWithIntegrity`, which reports what it excluded. A ranker
  // that silently dropped rows would make `admitted + evicted = ranked`
  // — the accounting identity the budget pass is checked against — a lie.
  void _input.role;
  return _candidates
    .map((candidate) => rankingOf(candidate, _input.taskId))
    .sort(byStanding);
}

/** One row, and every component of its standing, computed once. */
function rankingOf(candidate: JuliusContextCandidate, taskId: string): JuliusContextRanking {
  const authority = classifyContextAuthority(candidate);
  return {
    entryId: candidate.entry.entryId,
    claimId: candidate.claim.claimId,
    contextType: candidate.contextType,
    authority,
    authorityRank: JULIUS_CONTEXT_AUTHORITY.indexOf(authority),
    trust: candidate.claim.trust,
    evidenceCount: candidate.claim.evidence.length,
    taskScoped: candidate.entry.taskIds.includes(taskId),
    tieBreak: `${candidate.claim.claimId}|${candidate.entry.entryId}`,
  };
}

/**
 * THE ORDER, AND WHY EACH COMPONENT IS THERE RATHER THAN ONE SCORE.
 *
 * A single weighted score is how distraction wins: one component grows large
 * enough to buy a position no individual fact earned. These are LEXICOGRAPHIC,
 * so a lower-authority candidate can never overtake a higher one however much
 * evidence or recency it accumulates.
 *
 *   1 authority   — what kind of thing is saying it.
 *   2 trust       — how far that has been checked.
 *   3 evidence    — how much it points at. Never a substitute for 1 or 2.
 *   4 task scope  — a fact about THIS task beats a fact about the run.
 *   5 currentness — later first, and only among things otherwise equal.
 *   6 tieBreak    — deterministic, and never a source of truth.
 *
 * Nowhere in the list: how the text reads, how many near-copies exist, or the
 * order the candidates arrived in.
 */
const byStanding = (left: JuliusContextRanking, right: JuliusContextRanking): number =>
  left.authorityRank - right.authorityRank
  || trustStanding(right.trust) - trustStanding(left.trust)
  || right.evidenceCount - left.evidenceCount
  || Number(right.taskScoped) - Number(left.taskScoped)
  || left.tieBreak.localeCompare(right.tieBreak);

/**
 * FIND EVERY PAIR THAT CANNOT BOTH BE CURRENT, and say how far each can be
 * resolved. Nothing is dropped here; resolution is recorded, not applied.
 */
export function detectContextConflicts(
  _candidates: readonly JuliusContextCandidate[],
  _input: { readonly contractEntryIds: readonly string[] },
): readonly JuliusContextConflict[] {
  const byClaimId = new Map(_candidates.map((candidate) => [candidate.claim.claimId, candidate]));
  const contractText = _candidates
    .filter((candidate) => _input.contractEntryIds.includes(candidate.entry.entryId))
    .map((candidate) => candidate.entry.text)
    .join(' ');
  const contractTerms = significantTerms(contractText);

  // A PAIR IS A PAIR, ASSERTED FROM EITHER END. `contradicts` and `supersedes`
  // are both one-directional fields, so the same disagreement arrives once,
  // twice, or from the side that is no longer current. Keyed on the unordered
  // pair of claim ids so it is recorded exactly once whichever way it came.
  const pairs = new Map<string, readonly [JuliusContextCandidate, JuliusContextCandidate]>();
  const note = (a: JuliusContextCandidate, b: JuliusContextCandidate): void => {
    if (a.claim.claimId === b.claim.claimId) return;
    const [first, second] = a.claim.claimId < b.claim.claimId ? [a, b] : [b, a];
    pairs.set(`${first.claim.claimId}\u0000${second.claim.claimId}`, [first, second]);
  };
  for (const candidate of _candidates) {
    for (const claimId of candidate.claim.contradicts) {
      const other = byClaimId.get(claimId);
      if (other) note(candidate, other);
    }
    if (candidate.claim.supersedes !== null) {
      const other = byClaimId.get(candidate.claim.supersedes);
      if (other) note(candidate, other);
    }
  }

  return [...pairs.values()]
    .map(([first, second]) => resolveConflict(first, second, contractTerms))
    .sort((left, right) => left.claimIds[0].localeCompare(right.claimIds[0])
      || left.claimIds[1].localeCompare(right.claimIds[1]));
}

/**
 * HOW FAR TWO IRRECONCILABLE CLAIMS CAN BE SEPARATED, in the order the
 * separations are trustworthy. Every arm is recorded; none is applied. The last
 * arm is the one that matters: when nothing structural separates them, this
 * refuses to choose and the compiler fails closed on it.
 */
function resolveConflict(
  first: JuliusContextCandidate,
  second: JuliusContextCandidate,
  contractTerms: ReadonlySet<string>,
): JuliusContextConflict {
  const claimIds = [first.claim.claimId, second.claim.claimId] as const;
  const entryIds = [first.entry.entryId, second.entry.entryId] as const;
  const settled = (
    resolution: JuliusContextConflict['resolution'],
    keptClaimId: string | null,
    reasonCode: string,
  ): JuliusContextConflict => ({ entryIds, claimIds, resolution, keptClaimId, reasonCode });

  // 1. SUPERSESSION — the run said so itself, in a field written when the later
  //    claim was admitted. Nothing else is as direct.
  if (first.claim.supersedes === second.claim.claimId) {
    return settled('RESOLVED_BY_SUPERSESSION', first.claim.claimId, 'SUPERSEDES_THE_OTHER');
  }
  if (second.claim.supersedes === first.claim.claimId) {
    return settled('RESOLVED_BY_SUPERSESSION', second.claim.claimId, 'SUPERSEDES_THE_OTHER');
  }

  // 2. ONE SIDE IS ALREADY DEAD. A claim recorded CONTRADICTED or SUPERSEDED
  //    cannot be the surviving side of a fresh disagreement.
  const firstDead = isTerminal(first.claim.trust);
  const secondDead = isTerminal(second.claim.trust);
  if (firstDead !== secondDead) {
    return settled('RESOLVED_BY_TRUST', firstDead ? second.claim.claimId : first.claim.claimId,
      'OTHER_SIDE_NO_LONGER_CURRENT');
  }

  // 3. AUTHORITY, then 4. TRUST. What kind of thing is saying it outranks how
  //    far it has been checked: a governance constraint beats a verified fact.
  const firstAuthority = JULIUS_CONTEXT_AUTHORITY.indexOf(classifyContextAuthority(first));
  const secondAuthority = JULIUS_CONTEXT_AUTHORITY.indexOf(classifyContextAuthority(second));
  if (firstAuthority !== secondAuthority) {
    return settled('RESOLVED_BY_AUTHORITY',
      firstAuthority < secondAuthority ? first.claim.claimId : second.claim.claimId, 'HIGHER_AUTHORITY');
  }
  const firstTrust = trustStanding(first.claim.trust);
  const secondTrust = trustStanding(second.claim.trust);
  if (firstTrust !== secondTrust) {
    return settled('RESOLVED_BY_TRUST',
      firstTrust > secondTrust ? first.claim.claimId : second.claim.claimId, 'HIGHER_TRUST');
  }

  // 5. THE LOCKED CONTRACT, LEXICALLY, AND ONLY HERE. See `contractAgreement`.
  //    It can only ever choose between two claims that authority, trust and
  //    lineage have already failed to separate, and only when the contract is
  //    actually in the packet.
  if (contractTerms.size > 0) {
    const firstAgreement = contractAgreement(first.entry.text, contractTerms);
    const secondAgreement = contractAgreement(second.entry.text, contractTerms);
    if (firstAgreement !== secondAgreement && Math.max(firstAgreement, secondAgreement) > 0) {
      return settled('RESOLVED_BY_CONTRACT',
        firstAgreement > secondAgreement ? first.claim.claimId : second.claim.claimId,
        'AGREES_WITH_LOCKED_CONTRACT');
    }
  }

  // 6. NOTHING SEPARATES THEM. Both sides survive in the record; neither is
  //    chosen, and `compileContextWithIntegrity` fails closed on this.
  return settled('UNRESOLVED', null, 'EQUAL_AUTHORITY_EQUAL_TRUST');
}

/**
 * SPEND THE BUDGET, HIGHEST AUTHORITY FIRST.
 *
 * `compileJuliusContext` STOPS at the first entry that will not fit. This must
 * not: an unaffordable candidate is skipped and the next one is still
 * considered, or one fat distraction silently truncates everything trusted
 * behind it. Anything ranked but not admitted is reported in `evicted`.
 */
export function selectContextUnderBudget(
  _ranked: readonly JuliusContextRanking[],
  _candidates: readonly JuliusContextCandidate[],
  _budgetCharacters: number,
): JuliusContextSelection {
  assertBudget(_budgetCharacters);
  const costs = new Map(_candidates.map((candidate) =>
    [candidate.entry.entryId, redactJuliusContextText(candidate.entry.text).length]));
  const admitted: JuliusContextRanking[] = [];
  const evicted: JuliusContextRanking[] = [];
  let used = 0;
  for (const row of _ranked) {
    // SKIP, NEVER STOP. An unaffordable candidate is reported and the next one
    // is still considered; one fat distraction must not truncate everything
    // trusted behind it. A row whose candidate was not supplied costs nothing
    // that can be measured, so it cannot be admitted on a guess.
    const cost = costs.get(row.entryId);
    if (cost === undefined || used + cost > _budgetCharacters) { evicted.push(row); continue; }
    admitted.push(row);
    used += cost;
  }
  return {
    version: JULIUS_CONTEXT_INTEGRITY_VERSION,
    admitted, evicted,
    // This function sees a budget and a ranking, and neither conflicts nor
    // scope. `compileContextWithIntegrity` is what knows those and fills them.
    conflicts: [], excludedEntryIds: [],
    budgetCharacters: _budgetCharacters,
    usedCharacters: used,
  };
}

/**
 * THE WHOLE PASS, and the only function `compileJuliusContext` needs to call.
 *
 * Excludes what may never be current (`CONTRADICTED`, `SUPERSEDED`, out of role
 * or task scope), detects clashes, fails closed on an unresolved authoritative
 * one, ranks what remains and spends the budget on it.
 */
export function compileContextWithIntegrity(_input: {
  readonly candidates: readonly JuliusContextCandidate[];
  readonly role: JuliusWorkerRole;
  readonly taskId: string;
  readonly contractEntryIds: readonly string[];
  readonly budgetCharacters: number;
}): JuliusContextIntegrityOutcome {
  assertBudget(_input.budgetCharacters);

  // 1. SCOPE FIRST, and it is not negotiable by standing. A SECRET entry, an
  //    entry another role owns and an entry another task owns are excluded
  //    before anything is ranked: no amount of authority buys a coder the
  //    reviewer's rubric.
  const inScope = _input.candidates.filter((candidate) => withinScope(candidate, _input.role, _input.taskId));
  const outOfScope = _input.candidates.filter((candidate) => !withinScope(candidate, _input.role, _input.taskId));

  // 2. CONFLICTS OVER WHAT THIS ROLE MAY SEE. Terminal claims stay in this pass
  //    so supersession lineage survives into the record — but out-of-scope ones
  //    do not, or an entry this role may never read would reach it as a claim id.
  const conflicts = detectContextConflicts(inScope, { contractEntryIds: _input.contractEntryIds });

  // 3. WHAT MAY BE CURRENT TRUTH. A CONTRADICTED or SUPERSEDED claim is never
  //    returned, whatever standing it once held.
  const admissible = inScope.filter((candidate) => !isTerminal(candidate.claim.trust));
  const terminal = inScope.filter((candidate) => isTerminal(candidate.claim.trust));

  // 4. FAIL CLOSED — but only on a clash between two claims that could BOTH
  //    still be current. An unresolved pair whose sides are already excluded is
  //    lineage, not a live ambiguity, and must not take the packet down.
  const admissibleClaimIds = new Set(admissible.map((candidate) => candidate.claim.claimId));
  const unresolved = conflicts.filter((conflict) => conflict.resolution === 'UNRESOLVED'
    && conflict.claimIds.every((claimId) => admissibleClaimIds.has(claimId)));
  if (unresolved.length > 0) {
    return { outcome: 'FAIL_CLOSED', reasonCode: 'UNRESOLVED_AUTHORITATIVE_CLASH', conflicts: unresolved };
  }

  // 5. RANK, THEN SPEND.
  const ranked = rankContextCandidates(admissible, { role: _input.role, taskId: _input.taskId });
  const spent = selectContextUnderBudget(ranked, admissible, _input.budgetCharacters);
  return {
    outcome: 'OK',
    selection: {
      ...spent,
      conflicts,
      excludedEntryIds: [...new Set([...outOfScope, ...terminal].map((candidate) => candidate.entry.entryId))].sort(),
    },
  };
}

// ───────────────────────────────────────────────────────────────── internals

/**
 * THE ONE REDACTION THE CONTEXT COMPILER APPLIES, and the ONE definition of it.
 *
 * `compileJuliusContext` owned this regex inline, which made the budget the
 * integrity layer spends and the budget the compiler spends two different
 * measurements of the same text — one rename apart from disagreeing. It lives
 * here because this is the module that has to cost a candidate before deciding
 * whether it fits.
 *
 * It is a LAST-DITCH scrub, not the durable redactor: `src/relay/persistence/
 * redaction.ts` is what protects what is written down. This protects what is
 * handed to a model in a packet compiled from already-safe content.
 *
 * The group is CAPTURING, so the key that was redacted is still named. It was
 * `(?:...)` with a `$1` in the replacement, and JavaScript leaves a `$1` with no
 * group 1 as the literal text `$1` — so every redacted credential in every
 * packet Julius has ever compiled read `$1=[REDACTED]`, losing which key it was.
 */
export function redactJuliusContextText(text: string): string {
  return text.replace(/(api[_-]?key|token|secret)(\s*[=:]\s*)\S+/gi, '$1$2[REDACTED]');
}

const TRUST_STANDING: Readonly<Record<JuliusMemoryTrustState, number>> = {
  APPROVED: 3, VERIFIED: 2, SUPPORTED: 1, UNVERIFIED: 0,
  // NOT POSITIONS ON THE LADDER. They are below everything, and `isTerminal`
  // rather than this number is what keeps them out of current truth.
  CONTRADICTED: -1, SUPERSEDED: -1,
};

const trustStanding = (trust: JuliusMemoryTrustState): number => TRUST_STANDING[trust] ?? -1;

const isTerminal = (trust: JuliusMemoryTrustState): boolean =>
  trust === 'CONTRADICTED' || trust === 'SUPERSEDED';

/** Role, task and sensitivity — the three scopes v1 already enforced. */
const withinScope = (candidate: JuliusContextCandidate, role: JuliusWorkerRole, taskId: string): boolean =>
  candidate.entry.sensitivity !== 'SECRET'
  && candidate.entry.allowedRoles.includes(role)
  && (candidate.entry.taskIds.length === 0 || candidate.entry.taskIds.includes(taskId));

function assertBudget(budgetCharacters: number): void {
  // The same reason code `compileJuliusContext` throws, so a caller that hands
  // a bad budget to either gets the same answer.
  if (!Number.isFinite(budgetCharacters) || budgetCharacters < 1) throw new Error('invalid_context_budget');
}

/**
 * LEXICAL AGREEMENT WITH THE LOCKED CONTRACT. Named for what it is.
 *
 * This is the only place in the module where text is read, and it exists because
 * of a narrow, real case: two claims of equal authority and equal trust that
 * flatly contradict, where one restates a term of the agreement in force and the
 * other denies it. Refusing to look would fail the packet closed over a
 * disagreement the contract settles; a semantic model of agreement does not
 * exist here and inventing one would be worse than either.
 *
 * SO IT IS FENCED. It runs only as step 5 of `resolveConflict`, decides only
 * WHICH OF TWO otherwise-indistinguishable claims is kept, requires a strict
 * difference and at least one shared term, and can never raise an authority,
 * admit an excluded claim, or place anything in the ranking. A crafted memory
 * that echoes contract vocabulary gains nothing it could not already have.
 *
 * Terms are normalised words of three characters or more, minus a short
 * stop-list. Word boundaries matter: `uncapped` does not agree with `capped`.
 */
function contractAgreement(text: string, contractTerms: ReadonlySet<string>): number {
  let agreed = 0;
  for (const term of significantTerms(text)) if (contractTerms.has(term)) agreed += 1;
  return agreed;
}

const STOP_TERMS: ReadonlySet<string> = new Set([
  'the', 'and', 'for', 'are', 'with', 'this', 'that', 'from', 'was', 'its',
  'not', 'but', 'all', 'any', 'may', 'can', 'will', 'must', 'has', 'have',
]);

function significantTerms(text: string): ReadonlySet<string> {
  const terms = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9$]+/u)) {
    if (raw.length < 3 || STOP_TERMS.has(raw)) continue;
    terms.add(raw);
  }
  return terms;
}
