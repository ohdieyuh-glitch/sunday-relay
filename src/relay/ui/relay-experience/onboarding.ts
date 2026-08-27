import type {
  BrainUpdatePolicy, NetworkPolicy, RelayModeChoice, ReviewRequirement, ReviewerPolicy,
} from '../project-settings/contracts';

/**
 * COMPOUND AGENT CREATION — the domain behind the new Relay experience.
 *
 * This is the first-run flow the founder asked for: the user builds their
 * Compound AI Agent while its Relay Dog stands in front of them in 3D. The old
 * Entry Home — the blue terminal shell with its tab bar, its project dashboard
 * and its 2D WANDERING sprite — is no longer where ENTER RELAY leads.
 *
 * WHAT SURVIVED FROM THE OLD SURFACE IS THE LOGIC, NOT THE PRESENTATION. Every
 * option this flow offers comes from `project-settings/options.ts` — the real
 * product catalogue, with real availability states — and every policy value
 * below is an existing `project-settings/contracts.ts` type. Nothing here
 * invents a model, a provider, a reviewer or a setting the product does not
 * already declare.
 *
 * The module is PURE except for two named storage helpers, so the whole flow —
 * step order, gating, completion, activation, returning-user detection — is
 * testable without a renderer or a browser.
 */

export type OnboardingStepId =
  | 'name' | 'architect' | 'coding' | 'reviewer' | 'card' | 'settings' | 'review' | 'activate';

export type OnboardingStep = {
  readonly id: OnboardingStepId;
  readonly index: number;
  /** Mono micro-label, top of the edge panel. */
  readonly eyebrow: string;
  readonly title: string;
  readonly hint: string;
};

/**
 * JULIUS IS THE HARNESS, NOT A WORKER.
 *
 * The three slots the user configures — Prompt Architect, Coding Agent,
 * Independent Reviewer — are replaceable workers. Julius is the Compound
 * Agentic Harness around them: orchestration, durable mission state, Project
 * Brain, routing, dispatch, verification transitions, repair, budgets,
 * evidence, and the completion decision.
 *
 * This distinction is easy to lose in a UI, and losing it would misrepresent
 * the product: presenting the Prompt Architect as "the orchestrator" would make
 * a swappable model look like the control plane. Workers coordinate THROUGH
 * Julius, never directly through one another. `onboarding.test.ts` asserts that
 * Julius never appears among the selectable slots.
 */
export const JULIUS = Object.freeze({
  name: 'JULIUS',
  role: 'Compound Agentic Harness',
  owns: Object.freeze([
    'orchestration', 'durable mission state', 'Project Brain', 'routing',
    'dispatch', 'verification', 'repair', 'budgets', 'evidence', 'completion',
  ]),
});

export const ONBOARDING_STEPS: readonly OnboardingStep[] = Object.freeze([
  { id: 'name', index: 0, eyebrow: 'STEP 01', title: 'Create your Compound Agent.', hint: 'Name it. Julius will carry it from here.' },
  { id: 'architect', index: 1, eyebrow: 'STEP 02', title: 'Prompt Architect.', hint: 'The reasoning model that plans the mission.' },
  { id: 'coding', index: 2, eyebrow: 'STEP 03', title: 'Coding Agent.', hint: 'The agent that does the work.' },
  { id: 'reviewer', index: 3, eyebrow: 'STEP 04', title: 'Independent Reviewer.', hint: 'Judges the work. Never the same role that wrote it.' },
  { id: 'card', index: 4, eyebrow: 'STEP 05', title: 'C.A.R.D.', hint: 'The operating profile your agent runs under.' },
  { id: 'settings', index: 5, eyebrow: 'STEP 06', title: 'Execution limits.', hint: 'Bounds Relay enforces, not suggestions.' },
  { id: 'review', index: 6, eyebrow: 'STEP 07', title: 'Review your Compound Agent.', hint: 'Everything below is what will run.' },
  { id: 'activate', index: 7, eyebrow: 'STEP 08', title: 'Activate Relay.', hint: 'Bring the Compound Agent online.' },
]);

/**
 * The draft. Field for field these are existing product contracts —
 * `RelayWorkforceSelection` for the three role slots, and the policy unions
 * from `project-settings/contracts.ts` for everything C.A.R.D. governs.
 */
export type CompoundAgentDraft = {
  name: string;
  promptArchitectId: string | null;
  codingAgentId: string | null;
  reviewerId: string | null;
  reviewerPolicy: ReviewerPolicy;
  /** C.A.R.D. autonomy. */
  mode: RelayModeChoice;
  network: NetworkPolicy;
  review: ReviewRequirement;
  brainUpdate: BrainUpdatePolicy;
  spendUsd: number;
  runtimeMinutes: number;
  /** ISO instant, set only by `activate`. Its presence IS the activation state. */
  activatedAt: string | null;
};

export const EMPTY_DRAFT: CompoundAgentDraft = Object.freeze({
  name: '',
  promptArchitectId: null,
  codingAgentId: null,
  reviewerId: null,
  reviewerPolicy: 'substantive',
  mode: 'semi',
  network: 'approved_services',
  review: 'independent',
  brainUpdate: 'auto_verified_facts',
  spendUsd: 25,
  runtimeMinutes: 45,
  activatedAt: null,
});

/** A name Relay will accept. Trimmed, non-empty, and not absurdly long. */
export function normaliseName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 40);
}

export function stepComplete(draft: CompoundAgentDraft, step: OnboardingStepId): boolean {
  switch (step) {
    case 'name': return normaliseName(draft.name).length > 0;
    case 'architect': return draft.promptArchitectId !== null;
    case 'coding': return draft.codingAgentId !== null;
    case 'reviewer': return draft.reviewerId !== null;
    // C.A.R.D. and limits always carry a valid value — they open on a real
    // default rather than on an empty state, so they are never a blocker.
    case 'card': return true;
    case 'settings': return true;
    case 'review': return canActivate(draft);
    case 'activate': return draft.activatedAt !== null;
  }
}

/**
 * ACTIVATION REQUIRES A COMPLETE COMPOUND AGENT, and Relay decides that, not
 * the UI. Missing any of the three role slots or the name fails closed —
 * "never silently manufacture a default Compound Agent to make a Mission run".
 */
export function canActivate(draft: CompoundAgentDraft): boolean {
  return (
    normaliseName(draft.name).length > 0 &&
    draft.promptArchitectId !== null &&
    draft.codingAgentId !== null &&
    draft.reviewerId !== null
  );
}

/** Where a partially-filled draft should resume. */
export function firstIncompleteStep(draft: CompoundAgentDraft): OnboardingStepId {
  for (const step of ONBOARDING_STEPS) {
    if (!stepComplete(draft, step.id)) return step.id;
  }
  return 'activate';
}

/** A returning user: an activated, complete Compound Agent already exists. */
export function isConfigured(draft: CompoundAgentDraft): boolean {
  return draft.activatedAt !== null && canActivate(draft);
}

export function activate(draft: CompoundAgentDraft, nowIso: string): CompoundAgentDraft {
  if (!canActivate(draft)) return draft;
  return { ...draft, activatedAt: nowIso };
}

/* ------------------------------------------------------------ persistence */

/**
 * DURABLE, not session-scoped. A configured Compound Agent must survive the tab
 * — that is what makes a returning user a returning user. `sessionStorage`
 * (which the pre-existing configured-PSP pointer uses, correctly, for an OAuth
 * round-trip) would force the whole creation flow again on every visit.
 *
 * Every accessor fails closed: a private window, a cleared store or a corrupt
 * value yields the empty draft rather than an exception. A landing page that
 * throws on boot because storage is unavailable is not acceptable.
 */
export const AGENT_STORAGE_KEY = 'sunday-relay.compound-agent.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const str = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const num = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;

/** Only values the product actually declares survive a read. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const MODES: readonly RelayModeChoice[] = ['guided', 'semi', 'autonomous'];
const NETWORKS: readonly NetworkPolicy[] = ['blocked', 'research_only', 'approved_services', 'ask_first'];
const REVIEWS: readonly ReviewRequirement[] = ['none', 'independent', 'security', 'manual_founder'];
const BRAIN: readonly BrainUpdatePolicy[] = ['ask_every', 'auto_verified_facts', 'summaries_only', 'never_auto'];
const REVIEWER_POLICIES: readonly ReviewerPolicy[] = ['never', 'substantive', 'security_sensitive', 'every_mission'];

export function parseAgentDraft(value: unknown): CompoundAgentDraft {
  if (!isRecord(value)) return { ...EMPTY_DRAFT };
  const activatedAt = strOrNull(value.activatedAt);
  const draft: CompoundAgentDraft = {
    name: normaliseName(str(value.name, '')),
    promptArchitectId: strOrNull(value.promptArchitectId),
    codingAgentId: strOrNull(value.codingAgentId),
    reviewerId: strOrNull(value.reviewerId),
    reviewerPolicy: oneOf(value.reviewerPolicy, REVIEWER_POLICIES, EMPTY_DRAFT.reviewerPolicy),
    mode: oneOf(value.mode, MODES, EMPTY_DRAFT.mode),
    network: oneOf(value.network, NETWORKS, EMPTY_DRAFT.network),
    review: oneOf(value.review, REVIEWS, EMPTY_DRAFT.review),
    brainUpdate: oneOf(value.brainUpdate, BRAIN, EMPTY_DRAFT.brainUpdate),
    spendUsd: num(value.spendUsd, EMPTY_DRAFT.spendUsd),
    runtimeMinutes: num(value.runtimeMinutes, EMPTY_DRAFT.runtimeMinutes),
    activatedAt,
  };
  // AN ACTIVATION CANNOT OUTLIVE THE CONFIGURATION THAT EARNED IT. A stored
  // record claiming activation while missing a role slot is not a returning
  // user — it is corrupt, and it fails back to unactivated rather than letting
  // an incomplete agent past the gate.
  return canActivate(draft) ? draft : { ...draft, activatedAt: null };
}

export function loadAgentDraft(): CompoundAgentDraft {
  const store = storage();
  if (store === null) return { ...EMPTY_DRAFT };
  try {
    const raw = store.getItem(AGENT_STORAGE_KEY);
    if (raw === null) return { ...EMPTY_DRAFT };
    return parseAgentDraft(JSON.parse(raw) as unknown);
  } catch {
    return { ...EMPTY_DRAFT };
  }
}

export function saveAgentDraft(draft: CompoundAgentDraft): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(AGENT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* quota or privacy mode — the flow keeps working in memory for this visit */
  }
}

export function clearAgentDraft(): void {
  try {
    storage()?.removeItem(AGENT_STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}
