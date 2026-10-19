import type {
  BrainUpdatePolicy, CompletionRule, NetworkPolicy, RelayModeChoice, ReviewRequirement, ReviewerPolicy,
} from '../project-settings/contracts';
import { REPOSITORY_PERMISSIONS, type RepositoryPermission } from '../../mission/repository-target';

/**
 * COMPOUND AGENT CREATION — the domain behind the new Relay experience, and
 * THE AUTHORITATIVE C.A.R.D. RECORD.
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
 * ONE C.A.R.D., CONFIGURED ONCE. The record this module persists is the single
 * source of truth for a participant's Compound Agent configuration. Every other
 * surface — the pre-Mission edit surface (`RelayConfigureAgent`), the Mission
 * runner, the request the bridge validates, Wonderland's readiness — is a
 * PROJECTION of it (`card-projection.ts`), never a second store. The
 * `sessionStorage` "configured PSP" pointer that used to seed the live journey
 * was exactly such a second store, and it is what made participants configure
 * the same Agent twice; it is gone.
 *
 * The module is PURE except for the named storage helpers, so the whole flow —
 * step order, gating, completion, activation, returning-user detection,
 * identity and revision discipline — is testable without a renderer.
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
 * THE C.A.R.D. — one Compound Agent's authoritative configuration.
 *
 * Field for field these are existing product contracts — `RelayWorkforceSelection`
 * for the three role slots, the policy unions from `project-settings/contracts.ts`
 * for everything the in-world C.A.R.D. step governs, and the Mission-request
 * boundaries (`permissions`, the ceilings, `completionRule`) the domain's
 * `RelayMissionConfig` carries — so the pre-Mission edit surface and the in-world
 * flow edit ONE record rather than two shapes.
 *
 * The identity envelope binds the record: `agentId` names the Compound Agent,
 * `cardId` this C.A.R.D. of it, `revision` counts every persisted change, and
 * `participantId` is claimed at sign-in. Creation happens BEFORE any sign-in
 * exists, so a fresh record is unbound (`participantId: null`) until then.
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
  /** Ceilings. `null` = not set — DISCLOSED as such, never coerced to 0 or "unlimited". */
  spendUsd: number | null;
  runtimeMinutes: number | null;
  agentCalls: number | null;
  reviewCycles: number | null;
  repairCycles: number | null;
  completionRule: CompletionRule;
  /** Repository permissions a Mission will REQUEST. Empty = the bridge's own safe floor. */
  permissions: readonly RepositoryPermission[];
  /** ISO instant, set only by `activate`. Its presence IS the activation state. */
  activatedAt: string | null;
  /* ---- identity envelope: minted by the store, never typed by the participant ---- */
  /** This C.A.R.D. Empty until first persisted. */
  cardId: string;
  /** The Compound Agent this C.A.R.D. belongs to. Empty until first persisted. */
  agentId: string;
  /** The participant who claimed it at sign-in; null before any sign-in. */
  participantId: string | null;
  /** Counts every persisted change of the configuration; 0 = never persisted. */
  revision: number;
  createdAt: string | null;
  updatedAt: string | null;
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
  agentCalls: null,
  reviewCycles: null,
  repairCycles: null,
  completionRule: 'strict',
  permissions: Object.freeze([]) as readonly RepositoryPermission[],
  activatedAt: null,
  cardId: '',
  agentId: '',
  participantId: null,
  revision: 0,
  createdAt: null,
  updatedAt: null,
});

/**
 * The fields the participant CONFIGURES — the C.A.R.D.'s values, as opposed to
 * its identity envelope. A change to any of these is a new revision.
 */
export const CARD_VALUE_FIELDS = Object.freeze([
  'name', 'promptArchitectId', 'codingAgentId', 'reviewerId', 'reviewerPolicy',
  'mode', 'network', 'review', 'brainUpdate',
  'spendUsd', 'runtimeMinutes', 'agentCalls', 'reviewCycles', 'repairCycles',
  'completionRule', 'permissions', 'activatedAt',
] as const);
export type CardValueField = (typeof CARD_VALUE_FIELDS)[number];

export const CARD_IDENTITY_FIELDS = Object.freeze([
  'cardId', 'agentId', 'participantId', 'revision', 'createdAt', 'updatedAt',
] as const);

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

/** A C.A.R.D. that has been persisted at least once — the only kind a consumer may act on. */
export function isPersistedCard(draft: CompoundAgentDraft): boolean {
  return draft.revision > 0 && draft.cardId !== '' && draft.agentId !== '';
}

/* ------------------------------------------------------------ persistence */

/**
 * DURABLE, not session-scoped. A configured Compound Agent must survive the tab
 * — that is what makes a returning user a returning user, and what lets the
 * C.A.R.D. built before sign-in reach the Mission that runs after the OAuth
 * redirect. `sessionStorage` would force the whole creation flow again on
 * every visit, and did.
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
/** A ceiling: a non-negative finite number, `null` when explicitly unset, the fallback otherwise. */
const ceiling = (v: unknown, fallback: number | null): number | null => {
  if (v === null) return null;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback;
};
const nonNegativeInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

/** Only values the product actually declares survive a read. */
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const MODES: readonly RelayModeChoice[] = ['guided', 'semi', 'autonomous'];
const NETWORKS: readonly NetworkPolicy[] = ['blocked', 'research_only', 'approved_services', 'ask_first'];
const REVIEWS: readonly ReviewRequirement[] = ['none', 'independent', 'security', 'manual_founder'];
const BRAIN: readonly BrainUpdatePolicy[] = ['ask_every', 'auto_verified_facts', 'summaries_only', 'never_auto'];
const REVIEWER_POLICIES: readonly ReviewerPolicy[] = ['never', 'substantive', 'security_sensitive', 'every_mission'];
const COMPLETION_RULES: readonly CompletionRule[] = ['strict', 'balanced', 'custom'];

function permissionList(v: unknown): readonly RepositoryPermission[] {
  if (!Array.isArray(v)) return EMPTY_DRAFT.permissions;
  // Kept in the ladder's own order, deduplicated, unknown names dropped.
  return REPOSITORY_PERMISSIONS.filter((p) => v.includes(p));
}

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
    spendUsd: ceiling(value.spendUsd, EMPTY_DRAFT.spendUsd),
    runtimeMinutes: ceiling(value.runtimeMinutes, EMPTY_DRAFT.runtimeMinutes),
    agentCalls: ceiling(value.agentCalls, EMPTY_DRAFT.agentCalls),
    reviewCycles: ceiling(value.reviewCycles, EMPTY_DRAFT.reviewCycles),
    repairCycles: ceiling(value.repairCycles, EMPTY_DRAFT.repairCycles),
    completionRule: oneOf(value.completionRule, COMPLETION_RULES, EMPTY_DRAFT.completionRule),
    permissions: permissionList(value.permissions),
    activatedAt,
    cardId: str(value.cardId, ''),
    agentId: str(value.agentId, ''),
    participantId: strOrNull(value.participantId),
    revision: nonNegativeInt(value.revision, 0),
    createdAt: strOrNull(value.createdAt),
    updatedAt: strOrNull(value.updatedAt),
  };
  // AN ACTIVATION CANNOT OUTLIVE THE CONFIGURATION THAT EARNED IT. A stored
  // record claiming activation while missing a role slot is not a returning
  // user — it is corrupt, and it fails back to unactivated rather than letting
  // an incomplete agent past the gate.
  return canActivate(draft) ? draft : { ...draft, activatedAt: null };
}

/** The configured values only — what a revision is a revision OF. */
export function cardValues(draft: CompoundAgentDraft): Record<CardValueField, unknown> {
  const out = {} as Record<CardValueField, unknown>;
  for (const field of CARD_VALUE_FIELDS) out[field] = draft[field];
  return out;
}

export function sameCardValues(a: CompoundAgentDraft, b: CompoundAgentDraft): boolean {
  return JSON.stringify(cardValues(a)) === JSON.stringify(cardValues(b));
}

/**
 * An identifier for a C.A.R.D. or a Compound Agent. Random where the platform
 * offers randomness; the fallback is still unique enough for one browser's
 * single active record, which is all this store holds.
 */
function mintId(prefix: string): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return `${prefix}-${c.randomUUID()}`;
  } catch {
    /* fall through */
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readStored(): CompoundAgentDraft | null {
  const store = storage();
  if (store === null) return null;
  try {
    const raw = store.getItem(AGENT_STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parseAgentDraft(parsed) : null;
  } catch {
    return null;
  }
}

function write(draft: CompoundAgentDraft): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(AGENT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    /* quota or privacy mode — the flow keeps working in memory for this visit */
  }
}

/**
 * The active C.A.R.D. A record written before this module minted identity (the
 * v1 shape) is migrated on read: it gets its identity and becomes revision 1,
 * so every persisted C.A.R.D. is addressable. Absent or corrupt storage yields
 * the empty, unpersisted draft.
 */
export function loadAgentDraft(nowIso: string = new Date().toISOString()): CompoundAgentDraft {
  const stored = readStored();
  if (stored === null) return { ...EMPTY_DRAFT };
  if (isPersistedCard(stored)) return stored;
  const migrated: CompoundAgentDraft = {
    ...stored,
    cardId: stored.cardId || mintId('card'),
    agentId: stored.agentId || mintId('agent'),
    revision: Math.max(1, stored.revision),
    createdAt: stored.createdAt ?? nowIso,
    updatedAt: stored.updatedAt ?? nowIso,
  };
  write(migrated);
  return migrated;
}

/**
 * Persist the C.A.R.D. and return what was persisted. Identity is minted on
 * first save and is never re-minted; the revision advances only when a
 * configured value actually changed, so re-saving an identical record is not a
 * new revision. The identity envelope of the STORED record wins over whatever
 * the caller's copy carried, so a stale in-memory copy can never rewind the
 * revision counter or re-assign identity.
 */
export function saveAgentDraft(draft: CompoundAgentDraft, nowIso: string = new Date().toISOString()): CompoundAgentDraft {
  const stored = readStored();
  const base = stored !== null && isPersistedCard(stored) ? stored : null;
  const changed = base === null ? true : !sameCardValues(base, draft);
  const next: CompoundAgentDraft = {
    ...draft,
    cardId: base?.cardId ?? (draft.cardId || mintId('card')),
    agentId: base?.agentId ?? (draft.agentId || mintId('agent')),
    // Binding survives; an explicit claim goes through `claimCard`, never a save.
    participantId: base?.participantId ?? draft.participantId,
    revision: base === null ? Math.max(1, draft.revision) : (changed ? base.revision + 1 : base.revision),
    createdAt: base?.createdAt ?? draft.createdAt ?? nowIso,
    updatedAt: changed ? nowIso : (base?.updatedAt ?? nowIso),
  };
  write(next);
  return next;
}

export function clearAgentDraft(): void {
  try {
    storage()?.removeItem(AGENT_STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

/* ------------------------------------------------ identity and revisions */

export type CardClaim =
  | { readonly ok: true; readonly card: CompoundAgentDraft }
  /** No persisted C.A.R.D. exists in this browser — there is nothing to claim. */
  | { readonly ok: false; readonly reason: 'no_card'; readonly card: CompoundAgentDraft }
  /** The C.A.R.D. here was claimed by a DIFFERENT participant. It is not this one's. */
  | { readonly ok: false; readonly reason: 'wrong_participant'; readonly card: CompoundAgentDraft };

/**
 * BIND THE C.A.R.D. TO THE PARTICIPANT WHO SIGNED IN. A record built before
 * sign-in is unbound and becomes theirs; a record already bound to them is
 * simply theirs; a record bound to somebody else is REFUSED and left exactly as
 * it was — a shared browser must never hand one participant another's Agent.
 */
export function claimCard(participantId: string, nowIso: string = new Date().toISOString()): CardClaim {
  const card = loadAgentDraft(nowIso);
  if (!isPersistedCard(card)) return { ok: false, reason: 'no_card', card };
  if (card.participantId === participantId) return { ok: true, card };
  if (card.participantId !== null) return { ok: false, reason: 'wrong_participant', card };
  const bound: CompoundAgentDraft = { ...card, participantId, updatedAt: nowIso };
  write(bound);
  return { ok: true, card: bound };
}

/** Whether this persisted C.A.R.D. may serve `participantId`: unbound, or bound to them. */
export function cardBelongsTo(card: CompoundAgentDraft, participantId: string | null): boolean {
  if (!isPersistedCard(card)) return false;
  return card.participantId === null || participantId === null || card.participantId === participantId;
}

/** What a consumer holds: enough to notice the record it read is no longer current. */
export type CardReference = { readonly cardId: string; readonly agentId: string; readonly revision: number };

export type CardCurrency =
  | { readonly ok: true; readonly current: CompoundAgentDraft }
  /** The store holds a NEWER revision of the same C.A.R.D. than the reference. */
  | { readonly ok: false; readonly reason: 'stale_revision'; readonly current: CompoundAgentDraft }
  /** The store holds a different C.A.R.D. (a new one was created) or a different Compound Agent. */
  | { readonly ok: false; readonly reason: 'card_replaced' | 'wrong_agent'; readonly current: CompoundAgentDraft }
  /** Nothing persisted: whatever the reference described no longer exists here. */
  | { readonly ok: false; readonly reason: 'no_card'; readonly current: CompoundAgentDraft };

/**
 * IS WHAT I READ STILL THE C.A.R.D.? A consumer that captured a projection must
 * not act on it once the participant has changed the record — a Mission may not
 * start under revision 3 of a C.A.R.D. that is at revision 4. Compared against
 * the store, not against memory.
 */
export function cardCurrency(ref: CardReference): CardCurrency {
  const current = loadAgentDraft();
  if (!isPersistedCard(current)) return { ok: false, reason: 'no_card', current };
  if (current.agentId !== ref.agentId) return { ok: false, reason: 'wrong_agent', current };
  if (current.cardId !== ref.cardId) return { ok: false, reason: 'card_replaced', current };
  if (current.revision !== ref.revision) return { ok: false, reason: 'stale_revision', current };
  return { ok: true, current };
}

export function cardReference(card: CompoundAgentDraft): CardReference {
  return { cardId: card.cardId, agentId: card.agentId, revision: card.revision };
}

/**
 * EXPLICITLY A NEW C.A.R.D. for the SAME Compound Agent: the Agent keeps its
 * identity, name and role slots; the operating profile and limits start from
 * the product defaults under a fresh `cardId`, revision 1, not yet activated.
 * The participant asked for a new configuration flow, so they get one.
 */
export function newCardForAgent(nowIso: string = new Date().toISOString()): CompoundAgentDraft {
  const current = loadAgentDraft(nowIso);
  const fresh: CompoundAgentDraft = {
    ...EMPTY_DRAFT,
    name: current.name,
    promptArchitectId: current.promptArchitectId,
    codingAgentId: current.codingAgentId,
    reviewerId: current.reviewerId,
    reviewerPolicy: current.reviewerPolicy,
    agentId: current.agentId || mintId('agent'),
    participantId: current.participantId,
    cardId: mintId('card'),
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  write(fresh);
  return fresh;
}

/**
 * EXPLICITLY A NEW COMPOUND AGENT. Nothing is inherited from the previous one —
 * not its name, not its roles, not its C.A.R.D. — so a second Agent can never
 * quietly run under the first Agent's configuration. This browser holds ONE
 * active Compound Agent; creating another replaces the active record (the
 * bridge's saved profiles are untouched).
 */
export function startNewCompoundAgent(
  nowIso: string = new Date().toISOString(),
  // Who owns what is created next: the signed-in participant when one is known.
  // Defaults to the current record's owner ONLY for the pre-sign-in world flow;
  // a signed-in caller passes itself, so a record another participant left in
  // this browser is never inherited as the owner.
  ownerParticipantId: string | null = readStored()?.participantId ?? null,
): CompoundAgentDraft {
  const fresh: CompoundAgentDraft = {
    ...EMPTY_DRAFT,
    participantId: ownerParticipantId,
    agentId: mintId('agent'),
    cardId: mintId('card'),
    revision: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  write(fresh);
  return fresh;
}
