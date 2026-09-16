import { guardJuliusPeerResponse, type JuliusPeerLedgerEntry } from './julius-peer-channel';

/**
 * WHAT THE ARCHITECT BELIEVES ABOUT THE SYSTEM, AS STATE RATHER THAN PROSE.
 *
 * The architecture lived in the plan's paragraphs. Nothing could ask it a
 * question: which boundary does this touch, what did we assume, what did we
 * reject and why, what would make us wrong. So the architect re-derived its own
 * design from its own prose on every dispatch, and nobody could tell an
 * implementation that had drifted from one that had merely been described
 * differently.
 *
 * WHAT THIS IS
 *   - COMPONENTS, BOUNDARIES AND DEPENDENCIES: the shape of the system, and the
 *     edges a change can cross.
 *   - DECISIONS: what was decided, what was rejected, why, and on what evidence.
 *     A rejected alternative is kept because re-proposing it is the commonest
 *     way a mission goes round twice.
 *   - ASSUMPTIONS: what the design rests on, with the evidence for each and
 *     whether it still holds. An assumption that turns out false is the most
 *     valuable row here.
 *   - OPEN QUESTIONS: what is unresolved, who owns it, and whether work is
 *     blocked on it.
 *   - RISKS: what could go wrong, how much it matters, and what would reduce it.
 *
 * WHAT THIS IS NOT
 *   - NOT THE MISSION CONTRACT. The contract is authoritative; this is advisory
 *     mission state. Where the two disagree the contract wins until Julius
 *     resolves it, and nothing here can edit a mission-owned term: the peer
 *     authority guard refuses an architecture proposal that names one, exactly
 *     as it refuses a guidance packet that does.
 *   - NOT A TRANSCRIPT. Every collection and every field is capped. A revision
 *     that would exceed the bounds is refused rather than truncated into
 *     something a reader would take for the whole picture.
 *   - NOT PROJECT BRAIN. This is Julius runtime state, shaped so a durable home
 *     can read it later without changing what it means.
 *
 * Pure: no clock, no network, no Node API. Time arrives as an injected string.
 */

export const JULIUS_ARCHITECTURE_VERSION = 'julius-architecture-state.v1' as const;

export const JULIUS_ARCHITECTURE_LIMITS = Object.freeze({
  components: 24,
  boundaries: 24,
  dependencies: 24,
  decisions: 16,
  assumptions: 16,
  questions: 12,
  risks: 12,
  alternatives: 4,
  evidenceRefs: 6,
  nameChars: 120,
  textChars: 400,
  refChars: 200,
  /** The whole revision, serialised. The ledger row must stay inside the event validator's 8 KiB. */
  stateChars: 6_000,
});

export const JULIUS_ASSUMPTION_STATES = ['HOLDS', 'UNVERIFIED', 'INVALIDATED'] as const;
export type JuliusAssumptionState = (typeof JULIUS_ASSUMPTION_STATES)[number];

export const JULIUS_RISK_IMPACTS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type JuliusRiskImpact = (typeof JULIUS_RISK_IMPACTS)[number];

/**
 * THE EDGES A CHANGE CAN CROSS, and the vocabulary drift is judged in.
 *
 * Every boundary is one of these kinds, because "materially different" has to
 * mean something a rule can apply: an interface, a schema, a dependency, an
 * ownership line, a security boundary, a concurrency model, a persistence
 * contract or a named invariant. A change to a boundary of one of these kinds
 * is architectural; a change inside one is implementation detail.
 */
export const JULIUS_BOUNDARY_KINDS = [
  'INTERFACE', 'SCHEMA', 'DEPENDENCY', 'OWNERSHIP', 'SECURITY', 'CONCURRENCY', 'PERSISTENCE', 'INVARIANT',
] as const;
export type JuliusBoundaryKind = (typeof JULIUS_BOUNDARY_KINDS)[number];

export interface JuliusArchitectureComponent {
  readonly name: string;
  readonly responsibility: string;
}

export interface JuliusArchitectureBoundary {
  readonly name: string;
  readonly kind: JuliusBoundaryKind;
  /** What holds across it, in one bounded sentence. */
  readonly contract: string;
  /** Where it lives, as a locator a reviewer can check. */
  readonly locator: string | null;
}

export interface JuliusArchitectureDependency {
  readonly name: string;
  /** What the design assumes about it. */
  readonly assumption: string;
  readonly locator: string | null;
}

export interface JuliusArchitectureDecision {
  readonly decisionId: string;
  readonly decision: string;
  readonly reason: string;
  readonly rejectedAlternatives: readonly string[];
  readonly evidenceRefs: readonly string[];
}

export interface JuliusArchitectureAssumption {
  readonly assumptionId: string;
  readonly claim: string;
  readonly state: JuliusAssumptionState;
  readonly evidenceRefs: readonly string[];
}

export interface JuliusArchitectureQuestion {
  readonly questionId: string;
  readonly question: string;
  readonly owner: string;
  readonly blocking: boolean;
}

export interface JuliusArchitectureRisk {
  readonly riskId: string;
  readonly risk: string;
  readonly impact: JuliusRiskImpact;
  readonly mitigation: string;
}

export interface JuliusArchitectureState {
  readonly version: typeof JULIUS_ARCHITECTURE_VERSION;
  /** Monotonic per run. Every revision is a whole picture, not a patch. */
  readonly revision: number;
  readonly components: readonly JuliusArchitectureComponent[];
  readonly boundaries: readonly JuliusArchitectureBoundary[];
  readonly dependencies: readonly JuliusArchitectureDependency[];
  readonly decisions: readonly JuliusArchitectureDecision[];
  readonly assumptions: readonly JuliusArchitectureAssumption[];
  readonly openQuestions: readonly JuliusArchitectureQuestion[];
  readonly risks: readonly JuliusArchitectureRisk[];
  /** The task whose dispatch proposed this revision, and when Julius recorded it. */
  readonly proposedByTaskId: string;
  readonly recordedAt: string;
}

export type JuliusArchitectureReading =
  | { readonly ok: true; readonly state: JuliusArchitectureState }
  | { readonly ok: false; readonly reasonCode: string };

/* ------------------------------------------------------------- sanitising */

const ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,80}$/u;

const line = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (text.length === 0 || text.length > limit) return null;
  if (/(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[=:]/iu.test(text)) return null;
  return text;
};

const refs = (value: unknown, limit: number): readonly string[] | null => {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > limit) return null;
  const out: string[] = [];
  for (const item of value) {
    const ref = line(item, JULIUS_ARCHITECTURE_LIMITS.refChars);
    if (ref === null) return null;
    if (!out.includes(ref)) out.push(ref);
  }
  return Object.freeze(out);
};

const list = <T>(value: unknown, limit: number, read: (item: Record<string, unknown>) => T | null): readonly T[] | null => {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > limit) return null;
  const out: T[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    const read_ = read(item as Record<string, unknown>);
    if (read_ === null) return null;
    out.push(read_);
  }
  return Object.freeze(out);
};

/**
 * REBUILD A PROPOSED ARCHITECTURE FROM AN ALLOWLIST, OR REFUSE BY NAME.
 *
 * The authority guard runs first and on the raw value: an architecture that
 * names the objective, the acceptance criteria, the budget, the permissions or
 * a completion is refused as exactly that, because the architect describing the
 * system must not become the architect rewriting the agreement.
 */
export function sanitizeJuliusArchitecture(input: {
  readonly value: unknown;
  readonly revision: number;
  readonly proposedByTaskId: string;
  readonly recordedAt: string;
}): JuliusArchitectureReading {
  const guarded = guardJuliusPeerResponse(input.value);
  if (!guarded.ok) return { ok: false, reasonCode: guarded.reasonCode };
  const value = input.value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reasonCode: 'architecture_shape_refused' };
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    return { ok: false, reasonCode: 'architecture_revision_invalid' };
  }
  if (!ID.test(input.recordedAt) || input.proposedByTaskId.length === 0) {
    return { ok: false, reasonCode: 'architecture_identity_required' };
  }
  const source = value as Record<string, unknown>;

  const components = list(source.components, JULIUS_ARCHITECTURE_LIMITS.components, (item) => {
    const name = line(item.name, JULIUS_ARCHITECTURE_LIMITS.nameChars);
    const responsibility = line(item.responsibility, JULIUS_ARCHITECTURE_LIMITS.textChars);
    return name === null || responsibility === null ? null : Object.freeze({ name, responsibility });
  });
  const boundaries = list(source.boundaries, JULIUS_ARCHITECTURE_LIMITS.boundaries, (item) => {
    const name = line(item.name, JULIUS_ARCHITECTURE_LIMITS.nameChars);
    const kind = typeof item.kind === 'string' ? item.kind.trim().toUpperCase() : '';
    const contract = line(item.contract, JULIUS_ARCHITECTURE_LIMITS.textChars);
    if (name === null || contract === null || !(JULIUS_BOUNDARY_KINDS as readonly string[]).includes(kind)) return null;
    const locator = item.locator === undefined || item.locator === null ? null : line(item.locator, JULIUS_ARCHITECTURE_LIMITS.refChars);
    if (item.locator !== undefined && item.locator !== null && locator === null) return null;
    return Object.freeze({ name, kind: kind as JuliusBoundaryKind, contract, locator });
  });
  const dependencies = list(source.dependencies, JULIUS_ARCHITECTURE_LIMITS.dependencies, (item) => {
    const name = line(item.name, JULIUS_ARCHITECTURE_LIMITS.nameChars);
    const assumption = line(item.assumption, JULIUS_ARCHITECTURE_LIMITS.textChars);
    if (name === null || assumption === null) return null;
    const locator = item.locator === undefined || item.locator === null ? null : line(item.locator, JULIUS_ARCHITECTURE_LIMITS.refChars);
    if (item.locator !== undefined && item.locator !== null && locator === null) return null;
    return Object.freeze({ name, assumption, locator });
  });
  const decisions = list(source.decisions, JULIUS_ARCHITECTURE_LIMITS.decisions, (item) => {
    const decisionId = typeof item.decisionId === 'string' && ID.test(item.decisionId) ? item.decisionId : null;
    const decision = line(item.decision, JULIUS_ARCHITECTURE_LIMITS.textChars);
    const reason = line(item.reason, JULIUS_ARCHITECTURE_LIMITS.textChars);
    // Rejected alternatives are sentences, not objects: what was considered and
    // turned down, in the architect's own bounded words.
    const rejectedAlternatives = refs(item.rejectedAlternatives, JULIUS_ARCHITECTURE_LIMITS.alternatives);
    const evidenceRefs = refs(item.evidenceRefs, JULIUS_ARCHITECTURE_LIMITS.evidenceRefs);
    if (decisionId === null || decision === null || reason === null || rejectedAlternatives === null || evidenceRefs === null) return null;
    return Object.freeze({ decisionId, decision, reason, rejectedAlternatives, evidenceRefs });
  });
  const assumptions = list(source.assumptions, JULIUS_ARCHITECTURE_LIMITS.assumptions, (item) => {
    const assumptionId = typeof item.assumptionId === 'string' && ID.test(item.assumptionId) ? item.assumptionId : null;
    const claim = line(item.claim, JULIUS_ARCHITECTURE_LIMITS.textChars);
    const state = typeof item.state === 'string' ? item.state.trim().toUpperCase() : 'UNVERIFIED';
    const evidenceRefs = refs(item.evidenceRefs, JULIUS_ARCHITECTURE_LIMITS.evidenceRefs);
    if (assumptionId === null || claim === null || evidenceRefs === null || !(JULIUS_ASSUMPTION_STATES as readonly string[]).includes(state)) return null;
    return Object.freeze({ assumptionId, claim, state: state as JuliusAssumptionState, evidenceRefs });
  });
  const openQuestions = list(source.openQuestions, JULIUS_ARCHITECTURE_LIMITS.questions, (item) => {
    const questionId = typeof item.questionId === 'string' && ID.test(item.questionId) ? item.questionId : null;
    const question = line(item.question, JULIUS_ARCHITECTURE_LIMITS.textChars);
    const owner = line(item.owner, JULIUS_ARCHITECTURE_LIMITS.nameChars);
    if (questionId === null || question === null || owner === null || typeof item.blocking !== 'boolean') return null;
    return Object.freeze({ questionId, question, owner, blocking: item.blocking });
  });
  const risks = list(source.risks, JULIUS_ARCHITECTURE_LIMITS.risks, (item) => {
    const riskId = typeof item.riskId === 'string' && ID.test(item.riskId) ? item.riskId : null;
    const risk = line(item.risk, JULIUS_ARCHITECTURE_LIMITS.textChars);
    const impact = typeof item.impact === 'string' ? item.impact.trim().toUpperCase() : '';
    const mitigation = line(item.mitigation, JULIUS_ARCHITECTURE_LIMITS.textChars);
    if (riskId === null || risk === null || mitigation === null || !(JULIUS_RISK_IMPACTS as readonly string[]).includes(impact)) return null;
    return Object.freeze({ riskId, risk, impact: impact as JuliusRiskImpact, mitigation });
  });

  if (components === null || boundaries === null || dependencies === null || decisions === null
    || assumptions === null || openQuestions === null || risks === null) {
    return { ok: false, reasonCode: 'architecture_shape_refused' };
  }
  // AN ARCHITECTURE OF NOTHING IS NOT A REVISION. A revision that says nothing
  // would overwrite one that said something.
  if (components.length === 0 && boundaries.length === 0 && dependencies.length === 0 && decisions.length === 0) {
    return { ok: false, reasonCode: 'architecture_empty' };
  }

  const state: JuliusArchitectureState = Object.freeze({
    version: JULIUS_ARCHITECTURE_VERSION,
    revision: input.revision,
    components, boundaries, dependencies, decisions, assumptions, openQuestions, risks,
    proposedByTaskId: input.proposedByTaskId,
    recordedAt: input.recordedAt,
  });
  if (JSON.stringify(state).length > JULIUS_ARCHITECTURE_LIMITS.stateChars) {
    return { ok: false, reasonCode: 'architecture_too_large' };
  }
  return { ok: true, state };
}

/* --------------------------------------------------------------- authority */

/**
 * WHERE THE ARCHITECTURE AND THE AGREEMENT DISAGREE.
 *
 * Advisory state can be wrong about the terms, and this says so rather than
 * letting either side quietly win. A boundary whose locator is outside the
 * contract's permitted paths, and a dependency the contract prohibits, are the
 * two that matter in practice: both mean the design as written would require
 * work the agreement does not allow.
 *
 * THE CONTRACT WINS. Nothing here changes a term; the conflict is recorded, and
 * Julius decides whether it needs a re-plan, a contract revision or neither.
 */
export function juliusArchitectureConflicts(
  state: JuliusArchitectureState,
  contract: { readonly permittedPaths: readonly string[]; readonly prohibitedActions: readonly string[] } | null,
): readonly { readonly kind: 'BOUNDARY_OUTSIDE_PERMITTED_PATHS' | 'DEPENDENCY_PROHIBITED'; readonly name: string; readonly detail: string }[] {
  if (contract === null) return Object.freeze([]);
  const conflicts: { kind: 'BOUNDARY_OUTSIDE_PERMITTED_PATHS' | 'DEPENDENCY_PROHIBITED'; name: string; detail: string }[] = [];
  const paths = contract.permittedPaths.filter((path) => path.length > 0);
  for (const boundary of state.boundaries) {
    if (boundary.locator === null || paths.length === 0) continue;
    const inside = paths.some((path) => boundary.locator!.startsWith(path.replace(/\*+$/u, '')));
    if (!inside) conflicts.push({ kind: 'BOUNDARY_OUTSIDE_PERMITTED_PATHS', name: boundary.name, detail: boundary.locator });
  }
  for (const dependency of state.dependencies) {
    const prohibited = contract.prohibitedActions.find((action) => action.toLowerCase().includes(dependency.name.toLowerCase()));
    if (prohibited !== undefined) conflicts.push({ kind: 'DEPENDENCY_PROHIBITED', name: dependency.name, detail: prohibited });
  }
  return Object.freeze(conflicts);
}

/* ------------------------------------------------------------------ ledger */

export function juliusArchitectureFacts(state: JuliusArchitectureState): Record<string, string | number | boolean | null> {
  return {
    architectureVersion: state.version,
    revision: state.revision,
    proposedByTaskId: state.proposedByTaskId,
    recordedAt: state.recordedAt,
    components: state.components.length,
    boundaries: state.boundaries.length,
    dependencies: state.dependencies.length,
    decisions: state.decisions.length,
    assumptions: state.assumptions.length,
    openQuestions: state.openQuestions.length,
    blockingQuestions: state.openQuestions.filter((question) => question.blocking).length,
    risks: state.risks.length,
    invalidatedAssumptions: state.assumptions.filter((assumption) => assumption.state === 'INVALIDATED').length,
    /** The whole picture, so a reader reconstructs it from this row alone. */
    state: JSON.stringify(state),
  };
}

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/**
 * THE ACCEPTED ARCHITECTURE, FROM THE ROWS THAT EXIST.
 *
 * The highest revision wins, and a row that does not survive the allowlist a
 * second time is ignored — a revision is re-read on the way out exactly as it
 * was read on the way in, so a row written by an older build, restored from a
 * backup or edited by hand cannot widen what the state may say.
 */
export function foldJuliusArchitecture(entries: readonly JuliusPeerLedgerEntry[]): JuliusArchitectureState | null {
  let latest: JuliusArchitectureState | null = null;
  for (const entry of entries) {
    if (entry.type !== 'architecture.recorded') continue;
    const raw = text(entry.facts.state);
    if (raw === null) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { continue; }
    const revision = typeof entry.facts.revision === 'number' ? entry.facts.revision : 0;
    const reading = sanitizeJuliusArchitecture({
      value: parsed,
      revision,
      proposedByTaskId: text(entry.facts.proposedByTaskId) ?? '',
      recordedAt: text(entry.facts.recordedAt) ?? '',
    });
    if (!reading.ok) continue;
    if (latest === null || reading.state.revision > latest.revision) latest = reading.state;
  }
  return latest;
}

/** The next revision number for a run, counted from its own rows. */
export function juliusNextArchitectureRevision(entries: readonly JuliusPeerLedgerEntry[]): number {
  const current = foldJuliusArchitecture(entries);
  return current === null ? 1 : current.revision + 1;
}

/** The architecture as a worker reads it: bounded text, ids a peer can name. */
export function renderJuliusArchitecture(state: JuliusArchitectureState): string {
  const lines = [
    `ACCEPTED ARCHITECTURE (revision ${String(state.revision)}) — advisory mission state. The Mission Contract remains authoritative.`,
    '',
    'COMPONENTS:',
    ...(state.components.length === 0 ? ['  (none recorded)'] : state.components.map((item) => `  ${item.name}: ${item.responsibility}`)),
    'BOUNDARIES (a change that crosses one of these is architectural):',
    ...(state.boundaries.length === 0 ? ['  (none recorded)'] : state.boundaries.map((item) => `  [${item.kind}] ${item.name}${item.locator === null ? '' : ` @ ${item.locator}`}: ${item.contract}`)),
    'DEPENDENCIES:',
    ...(state.dependencies.length === 0 ? ['  (none recorded)'] : state.dependencies.map((item) => `  ${item.name}: ${item.assumption}`)),
    'DECISIONS (and what was rejected):',
    ...(state.decisions.length === 0 ? ['  (none recorded)'] : state.decisions.map((item) =>
      `  ${item.decisionId}: ${item.decision} — ${item.reason}${item.rejectedAlternatives.length === 0 ? '' : ` [rejected: ${item.rejectedAlternatives.join('; ')}]`}`)),
    'ASSUMPTIONS:',
    ...(state.assumptions.length === 0 ? ['  (none recorded)'] : state.assumptions.map((item) => `  ${item.assumptionId} [${item.state}]: ${item.claim}`)),
    'OPEN QUESTIONS:',
    ...(state.openQuestions.length === 0 ? ['  (none)'] : state.openQuestions.map((item) => `  ${item.questionId} [${item.blocking ? 'BLOCKING' : 'non-blocking'}, owner ${item.owner}]: ${item.question}`)),
    'RISKS:',
    ...(state.risks.length === 0 ? ['  (none recorded)'] : state.risks.map((item) => `  ${item.riskId} [${item.impact}]: ${item.risk} — mitigation: ${item.mitigation}`)),
  ];
  return lines.join('\n');
}

/** The entry a worker reads the accepted architecture from. */
export const juliusArchitectureEntryId = (revision: number): string => `brain:architecture:r${String(revision)}`;
