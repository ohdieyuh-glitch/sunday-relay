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
 *           `read_mission_cost` (the OWNER; an explicitly authorised ADMIN),
 *           and beside it, for the same viewer only, WHO PAID for each role's
 *           work -- a metered API account, a subscription, nobody, or not
 *           established. See `WONDERLAND_JULIUS_BILLING_PATHS`.
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
 * The owner's billing is the one grouping it does, and it decides nothing
 * Julius has not: what is money is `juliusCostComponent`'s rule, who paid is
 * the `billingPath` Julius's settlement states, and the roles and their slot
 * states are `inspectSlots`'. Julius's own total is passed through unchanged.
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

import type { JuliusMissionResultView, JuliusSlotView, JuliusTimelineEntry } from '../julius/julius-runtime-api';
import { isJuliusContentDigest, juliusDurableArtifactRef } from '../julius/julius-artifact-reference';
import { JULIUS_BILLING_PATHS, consistentJuliusBillingPath, juliusCostComponent } from '../julius/julius-cost-accounting';
import type { JuliusBillingPath } from '../julius/julius-cost-accounting';
import { JULIUS_DEFAULT_ROLES, type JuliusDefaultRole } from '../julius/julius-runtime';
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

/**
 * WHO PAID FOR A ROLE'S WORK -- a separate fact from WHAT it cost, and never
 * read off a dollar figure.
 *
 * Priority 10 runs the Coding Agent on the founder's Claude Max subscription
 * beside API-billed OpenAI and xAI roles. The runtime prices a subscription run
 * too (`total_cost_usd`), and a world that printed that figure as spend would
 * be showing the owner an Anthropic API bill that was never sent. So the owner
 * is told the billing path per role, and only an API-billed role carries money.
 *
 *   API_BILLED      a metered provider account billed it: Julius recorded a
 *                   spend basis with a figure, or its settlement says so.
 *   SUBSCRIPTION    the work ran on a subscription. ONLY Julius's settlement
 *                   can say this (`billingPath`, decided from the auth the
 *                   runtime actually resolved); it is never inferred from an
 *                   absent charge, which could equally be an unmetered local run.
 *   NOT_APPLICABLE  no metered billing event exists: the role never ran,
 *                   everything it dispatched was released unsent, or Julius
 *                   recorded NOT_APPLICABLE. Not $0 of API spend: no API bill.
 *   UNKNOWN         billing could not be established -- a charge nobody
 *                   reported, a harness's estimate, a dispatch still open or
 *                   never settled, records that disagree, a word nobody
 *                   defined, or a timeline that could not be read whole.
 *
 * ONE VOCABULARY. Julius owns these words (`JULIUS_BILLING_PATHS`, the ones its
 * settlements are written with); the world reads them, it does not keep a copy.
 */
export const WONDERLAND_JULIUS_BILLING_PATHS = JULIUS_BILLING_PATHS;
export type WonderlandJuliusBillingPath = JuliusBillingPath;

/** One C.A.R.D. role's billing, for the owner. Numbers and closed words only: nothing here can carry a secret. */
export interface WonderlandJuliusRoleBilling {
  readonly role: JuliusDefaultRole;
  readonly billingPath: WonderlandJuliusBillingPath;
  /**
   * What a metered API account was charged for this role, as Julius recorded
   * it. Null when no API-billed settlement of it recorded an amount -- never a
   * 0 standing in for "not billed" -- and a FLOOR whenever
   * `unestablishedComponents` > 0.
   */
  readonly apiSpendUsdMicros: number | null;
  /** Settlements and dispatches whose billing, or whose API amount, could not be established. */
  readonly unestablishedComponents: number;
}

export const WONDERLAND_JULIUS_ROLE_BILLING_FIELDS = exactKeys<WonderlandJuliusRoleBilling>()([
  'role',
  'billingPath',
  'apiSpendUsdMicros',
  'unestablishedComponents',
] as const);

export type WonderlandJuliusResultCost =
  /** This viewer's role does not carry `read_mission_cost`. Not zero, not unknown: not theirs to see. */
  | { readonly visible: false }
  | {
    readonly visible: true;
    /** Julius's own total, unchanged from Priority 9. A FLOOR whenever `complete` is false. */
    readonly knownUsdMicros: number;
    readonly unknownComponents: number;
    readonly complete: boolean;
    /** Every C.A.R.D. role, in Julius's order, whether or not it ran. */
    readonly billing: readonly WonderlandJuliusRoleBilling[];
  };

/**
 * WHAT THE BILLING IS READ FROM: Julius's own public reads, never a store.
 *
 * `slots` is `JuliusRuntimeApi.inspectSlots`; `settlements` are the run's
 * `budget.settled` entries from `JuliusRuntimeApi.timeline`, every page of it.
 * `whole` is false when the timeline reported a gap or could not be walked to
 * its end: a settlement may be missing, so no role's billing is established.
 */
export interface WonderlandJuliusBillingRecord {
  readonly slots: readonly JuliusSlotView[];
  readonly settlements: readonly JuliusTimelineEntry[];
  readonly whole: boolean;
}

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

/* ---------------------------------------------------------------- billing */

interface SettlementBilling {
  readonly path: WonderlandJuliusBillingPath;
  /** Money a metered account was charged, when the path is API_BILLED and Julius recorded it as spend. */
  readonly apiUsdMicros: number | null;
}

/**
 * ONE SETTLEMENT'S BILLING.
 *
 * WHAT IS MONEY IS JULIUS'S DECISION. The amount is `juliusCostComponent`'s own
 * `knownUsdMicros`, non-null only for a spend basis with a figure -- so a
 * runtime's notional price (`executionUsdMicros`, never read), a harness's
 * estimate, or a number beside a non-spend basis can never become API spend
 * here, whatever the row carries.
 *
 * WHO PAID IS JULIUS'S RECORD. `billingPath`, when the settlement states it,
 * decides -- by `consistentJuliusBillingPath`, the rule Julius's own writer
 * applies before it records a path, so the reader and the writer cannot
 * disagree: a word nobody defined, or a path its own basis contradicts (an API
 * bill beside "no billing event", a subscription beside a provider bill), is
 * believed neither way. Without it, only the basis speaks, and a basis cannot
 * say SUBSCRIPTION.
 */
function settlementBilling(entry: JuliusTimelineEntry): SettlementBilling {
  const facts = entry.facts;
  const component = juliusCostComponent({
    taskId: entry.taskId ?? '',
    role: typeof facts.role === 'string' ? facts.role : null,
    basis: facts.costBasis,
    usdMicros: facts.usdMicros,
    estimatedUsdMicros: facts.estimatedUsdMicros,
  });
  const spend = component.knownUsdMicros;
  const stated = facts.billingPath;
  if (stated === undefined || stated === null) {
    if (spend !== null) return { path: 'API_BILLED', apiUsdMicros: spend };
    return { path: component.basis === 'NOT_APPLICABLE' ? 'NOT_APPLICABLE' : 'UNKNOWN', apiUsdMicros: null };
  }
  const path = consistentJuliusBillingPath(stated, component.basis);
  if (path === null) return { path: 'UNKNOWN', apiUsdMicros: null };
  // SUBSCRIPTION and NOT_APPLICABLE are consistent only beside a NOT_APPLICABLE basis, which carries no amount.
  return { path, apiUsdMicros: path === 'API_BILLED' ? spend : null };
}

const unestablishedRole = (role: JuliusDefaultRole): WonderlandJuliusRoleBilling => Object.freeze({
  role, billingPath: 'UNKNOWN' as const, apiSpendUsdMicros: null, unestablishedComponents: 1,
});

/**
 * EVERY C.A.R.D. ROLE'S BILLING, from Julius's slots and settlements.
 *
 *   - A `released` settlement sent nothing (julius-slot-ledger's own meaning),
 *     so it is no billing event of any kind.
 *   - A role with nothing sent is NOT_APPLICABLE when it never dispatched or
 *     everything it dispatched was released, and UNKNOWN when it dispatched
 *     and nothing was settled.
 *   - A role whose settlements agree on one path has that path; otherwise which
 *     one is not established, and it is UNKNOWN. Its API money is still exact.
 *   - A dispatch still open is counted as unestablished, and a settled path
 *     stands beside it.
 *
 * Only the three permanent roles, as Julius's own slot projection and totals
 * count them. No record, or one not read whole, and nothing is established.
 */
export function wonderlandJuliusBilling(
  record: WonderlandJuliusBillingRecord | null,
): readonly WonderlandJuliusRoleBilling[] {
  if (record === null || !record.whole) return Object.freeze(JULIUS_DEFAULT_ROLES.map(unestablishedRole));
  return Object.freeze(JULIUS_DEFAULT_ROLES.map((role): WonderlandJuliusRoleBilling => {
    const slot = record.slots.find((candidate) => candidate.role === role);
    // Julius draws all three, always. A slot it did not answer is not a role that never ran.
    if (slot === undefined) return unestablishedRole(role);
    const settled = record.settlements.filter((entry) => entry.type === 'budget.settled' && entry.facts.role === role);
    const sent = settled.filter((entry) => entry.facts.released !== true);
    const open = slot.state === 'ACTIVE' ? 1 : 0;
    if (sent.length === 0) {
      const nothingSent = open === 0 && (slot.dispatches === 0 || settled.length > 0);
      return Object.freeze({
        role,
        billingPath: nothingSent ? 'NOT_APPLICABLE' as const : 'UNKNOWN' as const,
        apiSpendUsdMicros: null,
        unestablishedComponents: nothingSent ? 0 : 1,
      });
    }
    const each = sent.map(settlementBilling);
    const paths = [...new Set(each.map((item) => item.path))];
    const api = each.filter((item) => item.path === 'API_BILLED');
    const priced = api.filter((item) => item.apiUsdMicros !== null);
    return Object.freeze({
      role,
      billingPath: paths.length === 1 ? paths[0] as WonderlandJuliusBillingPath : 'UNKNOWN' as const,
      apiSpendUsdMicros: priced.length === 0
        ? null
        : priced.reduce((total, item) => total + (item.apiUsdMicros as number), 0),
      unestablishedComponents: each.filter((item) => item.path === 'UNKNOWN').length + (api.length - priced.length) + open,
    });
  }));
}

/* ------------------------------------------------------------- projection */

/**
 * The player-facing result of one run, from Julius's own result view.
 *
 * `includeCost` is the caller's `read_mission_cost` decision, made against the
 * canonical role table by the route. It is a parameter rather than a role so
 * this stays a projection and never becomes a second permission model.
 *
 * `billing` is Julius's billing record for the run, read only for a viewer who
 * may see cost. Absent, every role's billing is UNKNOWN, never guessed.
 */
export function projectWonderlandJuliusResult(
  view: JuliusMissionResultView,
  options: { readonly includeCost: boolean; readonly billing?: WonderlandJuliusBillingRecord | null },
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
      billing: wonderlandJuliusBilling(options.billing ?? null),
    })
    // Not theirs to see, so not read: a member's result carries no billing, not even "unknown".
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
