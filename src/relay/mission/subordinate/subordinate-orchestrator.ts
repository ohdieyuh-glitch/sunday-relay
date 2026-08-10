/**
 * SUBORDINATE ORCHESTRATORS — LangGraph and anything like it, kept beneath.
 *
 * The direction on external graph frameworks is precise: evaluate them,
 * integrate selectively, and never let one own Mission truth, permissions,
 * verification or completion. That is a boundary, not a dependency decision,
 * so this module is the boundary and it names no vendor.
 *
 * WHY NOTHING IS INSTALLED. Adding LangGraph to reach this conclusion would be
 * backwards: the question is what an external orchestrator is ALLOWED to do,
 * and that has to be answerable before one runs. The same reasoning ended the
 * Agent Reach evaluation — take the pattern, refuse the runtime — and the same
 * shape applies here. When a graph framework is genuinely useful for a Mission,
 * it arrives through this contract or it does not arrive.
 *
 * THE ASYMMETRY IS THE DESIGN.
 *
 *   DOWN   a bounded brief: the objective, frozen inputs, and a step budget.
 *          No credential, no permission grant, no Mission id it could act on,
 *          no tool it did not already have.
 *   UP     PROPOSALS. Steps it took and outputs it suggests. Never a verdict,
 *          never a completion, never a permission, never a role assignment.
 *
 * A subordinate that returns "the mission is complete" has returned a STRING
 * SAYING THAT. `acceptSubordinateResult` refuses claims of authority rather
 * than sanitizing them quietly, because a framework that tried to claim
 * completion is a fact its operator should learn.
 *
 * Pure: no clock, no network, no Node.
 */

/* ------------------------------------------------------------ the brief */

export interface SubordinateBrief {
  readonly briefId: string;
  /** What the subordinate is being asked to work out. */
  readonly objective: string;
  /**
   * Everything it may read, as VALUES rather than references it could resolve
   * itself. A subordinate that can fetch is a subordinate outside the
   * permission boundary.
   */
  readonly inputs: Readonly<Record<string, string>>;
  /** Hard ceiling on steps. A graph without one is an unbounded loop. */
  readonly maximumSteps: number;
  /**
   * The names of tools Relay will execute ON ITS BEHALF, if it asks.
   *
   * Names only. The subordinate never holds a tool, a credential or a
   * connection — it proposes a call and Relay decides, through the permission
   * model that already exists.
   */
  readonly availableToolNames: readonly string[];
}

/**
 * Fields a brief must never carry.
 *
 * Enforced rather than documented: a brief is the one thing that crosses into
 * a foreign runtime, and the day someone adds `apiKey` to it for convenience
 * is the day the boundary stops meaning anything.
 */
export const FORBIDDEN_BRIEF_KEYS: readonly string[] = Object.freeze([
  'token', 'apikey', 'api_key', 'secret', 'password', 'credential', 'authorization',
  'cookie', 'sessionid', 'session_id', 'privatekey', 'private_key', 'bearer',
]);

export type BriefRefusal = 'credential_in_inputs' | 'no_step_limit' | 'no_objective';

export type BriefVerdict =
  | { readonly ok: true; readonly brief: SubordinateBrief }
  | { readonly ok: false; readonly refusal: BriefRefusal; readonly detail: string };

/** Check a brief before it leaves Relay. */
export function prepareBrief(brief: SubordinateBrief): BriefVerdict {
  if (brief.objective.trim() === '') {
    return { ok: false, refusal: 'no_objective', detail: 'A subordinate brief must say what it is for.' };
  }
  if (!Number.isFinite(brief.maximumSteps) || brief.maximumSteps <= 0) {
    return {
      ok: false,
      refusal: 'no_step_limit',
      detail: 'A subordinate graph without a step ceiling is an unbounded loop.',
    };
  }
  for (const key of Object.keys(brief.inputs)) {
    if (FORBIDDEN_BRIEF_KEYS.some((forbidden) => key.toLowerCase().includes(forbidden))) {
      return {
        ok: false,
        refusal: 'credential_in_inputs',
        detail: `The input "${key}" looks like a credential. A subordinate orchestrator never holds one.`,
      };
    }
  }
  return { ok: true, brief };
}

/* ----------------------------------------------------------- what returns */

export interface SubordinateStep {
  readonly ordinal: number;
  readonly summary: string;
  /** A tool it WANTED Relay to run. Relay decides; this is a request. */
  readonly requestedToolName?: string;
}

export interface SubordinateProposal {
  readonly proposalId: string;
  /** What it suggests, in its own words. A suggestion, never a finding. */
  readonly suggestion: string;
  /** Which of its own steps led here, so a reviewer can follow the reasoning. */
  readonly fromSteps: readonly number[];
}

export interface SubordinateResult {
  readonly briefId: string;
  readonly steps: readonly SubordinateStep[];
  readonly proposals: readonly SubordinateProposal[];
  /**
   * Anything else the runtime returned, as opaque text.
   *
   * Kept rather than discarded — an operator debugging a graph needs it — and
   * scanned, because this is where a framework's "final answer" arrives
   * wearing whatever words it likes.
   */
  readonly rawSummary: string;
}

export const AUTHORITY_CLAIMS = [
  'mission_completion',
  'verification_verdict',
  'permission_grant',
  'role_assignment',
  'budget_change',
] as const;
export type AuthorityClaim = (typeof AUTHORITY_CLAIMS)[number];

/**
 * Phrases that assert authority a subordinate does not have.
 *
 * Deliberately about ASSERTIONS, not topics. A graph may discuss completion —
 * "the mission will be complete when the tests pass" is analysis. What is
 * refused is a subordinate declaring it: "mission complete", "approved",
 * "granting access". The patterns are anchored on the declarative forms for
 * that reason, and the test file carries the discussion cases to keep them
 * honest.
 */
const AUTHORITY_PATTERNS: readonly (readonly [RegExp, AuthorityClaim])[] = Object.freeze([
  [/\b(mission|task)\s+(is\s+)?(now\s+)?(complete|completed|done|finished)\b/i, 'mission_completion'],
  [/\bmark(ing)?\s+(this|the|it)\s*(as\s+)?(complete|done|verified|approved)\b/i, 'mission_completion'],
  [/\b(verified|verification)\s*[:=]\s*(true|pass(ed)?|ok)\b/i, 'verification_verdict'],
  [/\bi\s+(hereby\s+)?(approve|verify|certify)\b/i, 'verification_verdict'],
  [/\b(grant(ing)?|enabl(e|ing)|allow(ing)?)\s+(full\s+|admin\s+|root\s+)?(access|permission|privileges?)\b/i, 'permission_grant'],
  [/\b(you\s+are\s+now|act\s+as)\s+(the\s+)?(reviewer|architect|coding\s+agent)\b/i, 'role_assignment'],
  [/\b(rais(e|ing)|increas(e|ing)|remov(e|ing))\s+(the\s+)?(budget|spend\s+limit|token\s+cap)\b/i, 'budget_change'],
]);

export interface AcceptedSubordinateResult {
  readonly accepted: true;
  readonly briefId: string;
  readonly steps: readonly SubordinateStep[];
  /** Proposals, and they are still only proposals. */
  readonly proposals: readonly SubordinateProposal[];
  /** Tool names it asked for. Relay has decided none of them. */
  readonly requestedTools: readonly string[];
  readonly rawSummary: string;
}

export interface RefusedSubordinateResult {
  readonly accepted: false;
  readonly briefId: string;
  readonly claims: readonly AuthorityClaim[];
  readonly detail: string;
  /** Kept, because an operator needs to see what the framework tried to say. */
  readonly rawSummary: string;
}

export type SubordinateVerdict = AcceptedSubordinateResult | RefusedSubordinateResult;

/** Every authority claim in a piece of text. */
export function detectAuthorityClaims(text: string): readonly AuthorityClaim[] {
  const found = new Set<AuthorityClaim>();
  for (const [pattern, claim] of AUTHORITY_PATTERNS) {
    if (pattern.test(text)) found.add(claim);
  }
  return [...found].sort();
}

/**
 * Take a subordinate's output, or refuse it.
 *
 * REFUSED, NOT SANITIZED. Stripping the sentence and carrying on would hide
 * that a framework tried to declare a mission complete, and that is exactly
 * the thing an operator needs to know about a component they are trusting with
 * part of their reasoning.
 *
 * A step budget that was exceeded is also a refusal: a graph that ran longer
 * than its brief permitted did not do the work that was asked for.
 */
export function acceptSubordinateResult(
  result: SubordinateResult,
  brief: SubordinateBrief,
): SubordinateVerdict {
  const surfaces = [
    result.rawSummary,
    ...result.proposals.map((p) => p.suggestion),
    ...result.steps.map((s) => s.summary),
  ];
  const claims = [...new Set(surfaces.flatMap((text) => detectAuthorityClaims(text)))].sort();

  if (claims.length > 0) {
    return {
      accepted: false,
      briefId: result.briefId,
      claims,
      detail: `The subordinate asserted authority it does not have: ${claims.join(', ')}. Relay decides completion, verification, permissions, roles and budget.`,
      rawSummary: result.rawSummary,
    };
  }

  if (result.steps.length > brief.maximumSteps) {
    return {
      accepted: false,
      briefId: result.briefId,
      claims: [],
      detail: `The subordinate took ${String(result.steps.length)} steps against a ceiling of ${String(brief.maximumSteps)}.`,
      rawSummary: result.rawSummary,
    };
  }

  const requestedTools = [...new Set(
    result.steps.map((s) => s.requestedToolName).filter((n): n is string => n !== undefined),
  )].sort();

  return {
    accepted: true,
    briefId: result.briefId,
    steps: result.steps,
    proposals: result.proposals,
    requestedTools,
    rawSummary: result.rawSummary,
  };
}

/**
 * Whether a tool a subordinate asked for was one it was told about.
 *
 * A request for something absent from the brief is not an error to hide: it
 * means the graph is reaching for capability nobody offered it, which is worth
 * seeing before it is granted.
 */
export function unofferedTools(
  verdict: AcceptedSubordinateResult,
  brief: SubordinateBrief,
): readonly string[] {
  return verdict.requestedTools.filter((name) => !brief.availableToolNames.includes(name));
}
