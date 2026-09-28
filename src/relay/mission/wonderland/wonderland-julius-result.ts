/**
 * WHAT A PLAYER'S WORLD MAY SHOW OF A JULIUS RESULT.
 *
 * Founder decision 5 (2026-09-27): "The result view should be designed as a
 * USER RESULT, not a raw internal trace dump."
 *
 *   SHOW    the final status; verified or not; what the mission made; each
 *           acceptance criterion and whether it was met; the reviewer's
 *           verdict; what is still open; repair and re-review status; the
 *           evidence references; why it ended.
 *   NEVER   hidden or private model reasoning, provider secrets, API keys,
 *           credentials, privileged host paths, security-sensitive internals.
 *   COST    exact spend only for a viewer whose role carries
 *           `read_mission_cost` (the OWNER; an explicitly authorised ADMIN).
 *   TOKENS  UNKNOWN. Nothing Julius serves here reports tokens a surface can
 *           rely on, and "UNKNOWN remains UNKNOWN".
 *
 * NOT A SECOND AUTHORITY. Every judgement here is Julius's own, taken from
 * `JuliusRuntimeApi.inspectResult`: `verified` is the run's COMPLETED, a
 * criterion's `satisfied` is the verification evaluator's rule, the failure is
 * the named reason Julius recorded. Nothing is re-derived. What this module adds
 * is only REMOVAL -- fields a player has no use for, and text that must not
 * reach a screen -- and a count of what it removed, so a surface can say that
 * something was withheld without saying what.
 *
 * THE TEXT RULES, applied to EVERY text, in order, reusing the repository's own
 * redactors rather than writing a weaker third copy
 * (`integration/terminal/terminal-redaction.ts`):
 *   1. A text that carries private reasoning or a stack trace is WITHHELD WHOLE.
 *      A redacted chain of thought is still a record that one existed. This
 *      applies to criteria too: a model can write those as well as a person,
 *      and a criterion wrongly withheld costs a word while one wrongly shown
 *      costs the rule.
 *   2. Secrets are redacted by `redactBoundaryText`.
 *   3. Host paths are cut back to the file name (`trimHostPaths`): the name is
 *      usually what the mission made; the directories above it name the
 *      machine, its accounts and its workspace layout.
 *
 * PURE. No Node, no network, no clock.
 */

import type { JuliusMissionResultView } from '../julius/julius-runtime-api';
import { isJuliusContentDigest, juliusDurableArtifactRef } from '../julius/julius-artifact-reference';
import {
  containsPrivateReasoning,
  containsStackTrace,
  redactBoundaryText,
} from '../../integration/terminal/terminal-redaction';
import { exactKeys } from './wonderland-contracts';
import { projectJuliusTaskState } from './wonderland-julius-task-state';

export const WONDERLAND_JULIUS_RESULT_SCHEMA_V1 = 'relay-wonderland-julius-result.v1' as const;

/** What a withheld text reads as. One word, the same everywhere, carrying nothing of what it replaced. */
export const WONDERLAND_RESULT_WITHHELD = '[withheld]' as const;

export interface WonderlandJuliusResultCriterion {
  readonly criterionId: string;
  readonly description: string;
  /** Julius's verdict for it, verbatim. */
  readonly satisfied: boolean;
  /** EVIDENCE: every required evidence type PASSED. COMPLETION: it names none, so only verified completion meets it. */
  readonly basis: 'EVIDENCE' | 'COMPLETION';
  readonly requiredEvidenceTypes: readonly string[];
  /** The PASSED evidence that satisfies it, so a reader can go and look. */
  readonly evidenceIds: readonly string[];
}

export interface WonderlandJuliusResultDeliverable {
  readonly evidenceId: string;
  /** DIFF, ARTIFACT, TEST, BUILD, LINT, TYPECHECK or COMMAND -- a product, never a judgement. */
  readonly type: string;
  readonly summary: string;
  /** A durable reference (`artifact:` or `local://`), or null. Anything else is dropped, never shown. */
  readonly artifactRef: string | null;
  /** sha256 of the body, or null. */
  readonly integrityHash: string | null;
  /** False when no body was retained: a reference nobody can resolve is not one. */
  readonly retained: boolean;
  readonly occurredAt: string;
}

export interface WonderlandJuliusResultFinding {
  readonly findingId: string;
  readonly severity: string;
  readonly claim: string;
}

export interface WonderlandJuliusResultReview {
  /** The latest verification decision, verbatim (ACCEPT, REPAIR, HALT, COMPLETE ...), or null before any. */
  readonly verdict: string | null;
  readonly reasonCode: string | null;
  /** How many decisions asked for a repair. */
  readonly repairRounds: number;
  /** True when a decision followed the last REPAIR -- the repair was looked at again. */
  readonly reReviewedAfterRepair: boolean;
  readonly decisions: number;
}

export type WonderlandJuliusResultCost =
  /** This viewer's role does not carry `read_mission_cost`. Not zero, not unknown: not theirs to see. */
  | { readonly visible: false }
  | {
    readonly visible: true;
    /** A FLOOR whenever `complete` is false. */
    readonly knownUsdMicros: number;
    readonly unknownComponents: number;
    readonly complete: boolean;
  };

export interface WonderlandJuliusResult {
  readonly schemaVersion: typeof WONDERLAND_JULIUS_RESULT_SCHEMA_V1;
  readonly runId: string;
  readonly missionId: string;
  /** Julius's own word for the run's state, verbatim -- the authoritative one (founder decision 3). */
  readonly juliusState: string;
  /** The Mission Contract state a player reads, by the world's one mapping; null where Julius's state has none. */
  readonly taskState: string | null;
  /** COMPLETED, and nothing else, is verified. Julius decided it. */
  readonly verified: boolean;
  /** COMPLETED, FAILED or CANCELLED: the run can no longer change. */
  readonly terminal: boolean;
  readonly criteria: readonly WonderlandJuliusResultCriterion[];
  readonly deliverables: readonly WonderlandJuliusResultDeliverable[];
  /** Blocking findings still open -- the unresolved limitations. */
  readonly openFindings: readonly WonderlandJuliusResultFinding[];
  readonly review: WonderlandJuliusResultReview;
  /** Why it is not verified, when it is not: the reason Julius named, never a guess. */
  readonly failure: { readonly reasonCode: string; readonly failureClass: string | null } | null;
  readonly cost: WonderlandJuliusResultCost;
  readonly tokens: 'UNKNOWN';
  /** How many texts or references were withheld, redacted or cut back on the way out. */
  readonly withheldDetails: number;
}

export const WONDERLAND_JULIUS_RESULT_FIELDS = exactKeys<WonderlandJuliusResult>()([
  'schemaVersion',
  'runId',
  'missionId',
  'juliusState',
  'taskState',
  'verified',
  'terminal',
  'criteria',
  'deliverables',
  'openFindings',
  'review',
  'failure',
  'cost',
  'tokens',
  'withheldDetails',
] as const);

/* ------------------------------------------------------------ host paths */

/**
 * A PATH ON THE HOST THAT RAN THE MISSION. `file://` URLs first, so one is cut
 * as a whole; then drive paths, UNC paths, and POSIX paths under a system or
 * home root. A RELATIVE path -- `src/app.ts` -- is the project's own and stays.
 */
const HOST_PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bfile:\/\/[^\s"'`<>]+/gi,
  /\b[A-Za-z]:[\\/][^\s"'`<>|]*/g,
  /\\\\[^\s\\"'`<>|]+\\[^\s"'`<>|]*/g,
  /(?<![\w.~:/\\-])\/(?:home|Users|root|tmp|var|opt|srv|mnt|private|etc|usr|workspace|workspaces|data|run|Volumes)\/[^\s"'`<>]*/g,
]);

/** Punctuation that ends a sentence rather than a path, kept after the cut. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/u;

const basenameOf = (path: string): string => {
  const parts = path.replace(/[\\/]+$/u, '').split(/[\\/]/u);
  return parts[parts.length - 1] ?? '';
};

/** Cut every host path back to its file name. Counts what it cut. */
export function trimHostPaths(text: string): { readonly text: string; readonly trimmed: number } {
  let trimmed = 0;
  let out = text;
  for (const pattern of HOST_PATH_PATTERNS) {
    out = out.replace(pattern, (match) => {
      const tail = TRAILING_PUNCTUATION.exec(match)?.[0] ?? '';
      const path = tail === '' ? match : match.slice(0, -tail.length);
      const name = basenameOf(path.replace(/^file:\/\//iu, ''));
      trimmed += 1;
      return `${name === '' || /^[A-Za-z]:$/u.test(name) ? '…' : `…/${name}`}${tail}`;
    });
  }
  return { text: out, trimmed };
}

/* ------------------------------------------------------------------ text */

interface Screened {
  readonly text: string;
  readonly withheld: number;
}

/**
 * One text, made safe to put in front of a player: withheld whole when it
 * carries private reasoning or a stack trace; otherwise secrets redacted and
 * host paths cut back.
 */
function screen(text: string): Screened {
  if (containsPrivateReasoning(text) || containsStackTrace(text)) {
    return { text: WONDERLAND_RESULT_WITHHELD, withheld: 1 };
  }
  const secrets = redactBoundaryText(text);
  const paths = trimHostPaths(secrets.text);
  return { text: paths.text, withheld: (secrets.redactions > 0 ? 1 : 0) + (paths.trimmed > 0 ? 1 : 0) };
}

/* ------------------------------------------------------------- projection */

/**
 * The player-facing result of one run, from Julius's own result view.
 *
 * `includeCost` is the caller's `read_mission_cost` decision, made against the
 * canonical role table by the route. It is a parameter rather than a role so
 * this stays a projection and never becomes a second permission model.
 */
export function projectWonderlandJuliusResult(
  view: JuliusMissionResultView,
  options: { readonly includeCost: boolean },
): WonderlandJuliusResult {
  let withheld = 0;
  const safe = (text: string): string => {
    const screened = screen(text);
    withheld += screened.withheld;
    return screened.text;
  };
  const safeOrNull = (text: string | null): string | null =>
    (text === null ? null : safe(text));

  const criteria = view.criteria.map((criterion) => Object.freeze({
    criterionId: criterion.criterionId,
    // Contract text -- which a model can write as well as a person, so every rule applies to it.
    description: safe(criterion.description),
    satisfied: criterion.satisfied,
    basis: criterion.basis,
    requiredEvidenceTypes: Object.freeze([...criterion.requiredEvidenceTypes]),
    evidenceIds: Object.freeze([...criterion.evidenceIds]),
  }));

  const deliverables = view.deliverables.map((item) => {
    // THE REFERENCE IS CHECKED AGAIN HERE, by Julius's own rule. A row written before that rule existed could
    // still hold a process-local key or a path; one that fails is dropped and counted, never shown.
    const artifactRef = juliusDurableArtifactRef(item.artifactRef);
    const integrityHash = isJuliusContentDigest(item.integrityHash) ? item.integrityHash : null;
    if (item.artifactRef !== null && artifactRef === null) withheld += 1;
    if (item.integrityHash !== null && integrityHash === null) withheld += 1;
    return Object.freeze({
      evidenceId: item.evidenceId,
      type: item.type,
      summary: safe(item.safeSummary),
      artifactRef,
      integrityHash,
      retained: artifactRef !== null,
      occurredAt: item.occurredAt,
    });
  });

  const openFindings = view.outstandingFindings.map((finding) => Object.freeze({
    findingId: finding.findingId,
    severity: safe(finding.severity),
    claim: safe(finding.claim),
  }));

  // Decisions arrive in log order (julius-read-postgres reverses its newest-first read), so the last is current.
  const decisions = view.reviewDecisions;
  const latest = decisions.length > 0 ? decisions[decisions.length - 1] : null;
  let lastRepair = -1;
  decisions.forEach((decision, index) => { if (decision.action === 'REPAIR') lastRepair = index; });
  const review = Object.freeze({
    verdict: latest === null ? null : safe(latest.action),
    reasonCode: latest === null ? null : safe(latest.reasonCode),
    repairRounds: decisions.filter((decision) => decision.action === 'REPAIR').length,
    reReviewedAfterRepair: lastRepair !== -1 && lastRepair < decisions.length - 1,
    decisions: decisions.length,
  });

  const failure = view.failure === null ? null : Object.freeze({
    reasonCode: safe(view.failure.reasonCode),
    failureClass: safeOrNull(view.failure.failureClass),
  });

  const projected = projectJuliusTaskState(view.state);
  const cost: WonderlandJuliusResultCost = options.includeCost
    ? Object.freeze({
      visible: true as const,
      knownUsdMicros: view.cost.knownUsdMicros,
      unknownComponents: view.cost.unknownComponents,
      complete: view.cost.complete,
    })
    : Object.freeze({ visible: false as const });

  return Object.freeze({
    schemaVersion: WONDERLAND_JULIUS_RESULT_SCHEMA_V1,
    runId: view.runId,
    missionId: view.missionId,
    juliusState: view.state,
    taskState: projected !== null && projected.kind === 'state' ? projected.state : null,
    verified: view.verified,
    terminal: view.terminal,
    criteria: Object.freeze(criteria),
    deliverables: Object.freeze(deliverables),
    openFindings: Object.freeze(openFindings),
    review,
    failure,
    cost,
    tokens: 'UNKNOWN' as const,
    withheldDetails: withheld,
  });
}
