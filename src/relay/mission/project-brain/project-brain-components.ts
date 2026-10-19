/**
 * THREE PROJECT BRAIN COMPONENTS THAT HAD NO DURABLE HOME: C.A.R.D., MISSION HANDOFF AND EVALS.
 *
 * C.A.R.D. (founder, 2026-10-02: the fifth Project Brain component). A card is a reusable loadout -- the Mission
 * Handoff form, the mascot skin / outfit / primary, the companions in the two canonical slots (0 = LEFT, the LLM
 * Companion's side; 1 = RIGHT, Jhinn's) and the attached capabilities (MCP servers, APIs, skills). Until now it lived
 * only in a browser's localStorage and in Wonderland's Cards.sav, and a Julius run pinned a `card_revision` string
 * that nothing durable defined. Here a card is a typed, versioned Project Brain object:
 *
 *   - it REFERENCES and is never an authority: providers and capabilities are ids a registry resolves; no credential,
 *     token, key or URL carrying one is ever stored (refused, not redacted, exactly as Wonderland's store refuses);
 *   - SELECTING a card changes the NEXT mission's default. A mission PINS the card version it starts under, once,
 *     and that pin never moves: switching cards mid-mission cannot rewrite a running mission's envelope;
 *   - DELETING a card is a final version (DELETED), never an erased row, so a mission pinned to it still resolves.
 *     The built-in default card is a constant: always present, never deletable.
 *
 * MISSION HANDOFF (/handoff). A presentation transition, NOT a new mission: the same run, objective, progress,
 * provider, approvals, reviewer, budget and evidence chain; only the player-facing representation changes. So a
 * handoff is a small versioned state beside the run -- HANDED_OFF or RETURNED -- and handing off never writes one
 * of Julius's own rows. A run that is COMPLETED, FAILED or CANCELLED cannot be handed off; a repeated, stale or
 * duplicated handoff is refused by name or answered from the log, never applied twice.
 *
 * EVALS. An eval is a durable judgement of one SUBJECT at one exact REVISION against one criterion, with its
 * evidence and its evaluator. A later eval of the same subject and criterion SUPERSEDES the current one; an owner may
 * INVALIDATE one. An eval qualifies only the revision it judged: an old PASS never qualifies changed code.
 *
 * Pure: no clock, no I/O, no Node. The store applies these rules inside the one transaction that writes.
 */

import {
  PROJECT_BRAIN_TITLE_MAX,
  parseProjectBrainRef,
  projectBrainForbiddenMaterial,
  projectBrainRefusal,
  type ProjectBrainActorKind,
  type ProjectBrainActor,
  type ProjectBrainCapability,
  type ProjectBrainDeliverer,
  type ProjectBrainDelivererKind,
  type ProjectBrainEventType,
  type ProjectBrainProvenance,
  type ProjectBrainRefusal,
} from './project-brain';

/* ------------------------------------------------------------------ shared */

export const PROJECT_BRAIN_COMPONENT_OPERATIONS = [
  'CARD_CREATE', 'CARD_UPDATE', 'CARD_DELETE', 'CARD_SELECT', 'MISSION_PIN_CARD',
  'HANDOFF_ENTER', 'HANDOFF_EXIT',
  'EVAL_RECORD', 'EVAL_INVALIDATE',
] as const;
export type ProjectBrainComponentOperation = (typeof PROJECT_BRAIN_COMPONENT_OPERATIONS)[number];

export const isProjectBrainComponentOperation = (value: unknown): value is ProjectBrainComponentOperation =>
  typeof value === 'string' && (PROJECT_BRAIN_COMPONENT_OPERATIONS as readonly string[]).includes(value);

/** Wonderland's IsSafeId (WonderlandBeta.cpp): 1-64 of letters, digits, `_`, `-`, `.`. The same grammar on both sides. */
const SAFE_ID = /^[A-Za-z0-9._-]{1,64}$/u;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/u;
const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
/** C0 controls (tab and newline included: a label is one line), DEL and the C1 block. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/u;
/** Zero-width, bidi controls, soft hyphen, BOM and tag characters: invisible text a key could hide inside. */
const INVISIBLE = /[­​-‏‪-‮⁠-⁤⁦-⁩﻿]|[\u{e0000}-\u{e007f}]/gu;

export const PROJECT_BRAIN_CARD_LABEL_MAX = 64;
export const PROJECT_BRAIN_CARD_MAX_COMPANIONS = 2;
export const PROJECT_BRAIN_CARD_MAX_CAPABILITIES = 32;
export const PROJECT_BRAIN_CARD_DEFAULT_REF = 'pbcard:default' as const;

/**
 * A RANDOM-LOOKING RUN OF 20+ KEY CHARACTERS. Card ids and labels are names, and a name of that length that mixes
 * letters and digits back and forth, or is one long hex run, is far likelier to be a pasted key than a name. Refused,
 * like a vendor-shaped key. Ordinary ids (`claude-code`, `github-mcp-server`, `mcp-filesystem-v2`) pass; the corpus in
 * the tests holds both sides.
 */
export function projectBrainLooksLikeRandomToken(text: string): boolean {
  for (const run of text.match(/[A-Za-z0-9_+/=.-]{20,}/gu) ?? []) {
    if (/[0-9a-f]{20,}/iu.test(run) && /[0-9]/u.test(run) && /[a-f]/iu.test(run)) return true;
    const core = run.replace(/[^A-Za-z0-9]/gu, '');
    const digits = (core.match(/[0-9]/gu) ?? []).length;
    const letters = (core.match(/[A-Za-z]/gu) ?? []).length;
    const switches = (core.match(/[A-Za-z][0-9]|[0-9][A-Za-z]/gu) ?? []).length;
    if (digits >= 3 && letters >= 3 && switches >= 4) return true;
    if (/[a-z]/u.test(core) && /[A-Z]/u.test(core) && digits >= 2 && core.length >= 24) return true;
  }
  return false;
}

/** Anything a component may not store: a credential shape, hidden reasoning, or a random-looking key. */
function forbidden(field: string, text: string): ProjectBrainRefusal | null {
  const visible = text.replace(INVISIBLE, '');
  const material = projectBrainForbiddenMaterial(text) ?? projectBrainForbiddenMaterial(visible);
  if (material === 'credential' || projectBrainLooksLikeRandomToken(visible)) {
    return projectBrainRefusal(422, 'credential_in_content',
      `${field} looks like it contains a credential. Project Brain stores references, never secrets; nothing was saved.`);
  }
  if (material === 'hidden_reasoning') {
    return projectBrainRefusal(422, 'hidden_reasoning_in_content', `${field} carries hidden-reasoning content; nothing was saved.`);
  }
  return null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const isRefusal = (value: unknown): value is ProjectBrainRefusal =>
  value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === false;
const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

function closedKeys(field: string, record: Record<string, unknown>, keys: readonly string[]): ProjectBrainRefusal | null {
  const unknown = Object.keys(record).filter((key) => !keys.includes(key));
  return unknown.length === 0 ? null
    : projectBrainRefusal(422, 'unknown_field', `Unknown field(s) in ${field}: ${unknown.sort().join(', ')}.`);
}

function safeId(field: string, value: unknown, allowEmpty = false): string | ProjectBrainRefusal {
  if (allowEmpty && value === '') return '';
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    return projectBrainRefusal(422, 'id_invalid', `${field} must be 1-64 of letters, digits, '_', '-' or '.'.`);
  }
  return forbidden(field, value) ?? value;
}

/** A label as it may be stored: invisible characters removed, trimmed, one line, capped, never secret-shaped. */
function label(field: string, value: unknown, required: boolean): string | ProjectBrainRefusal {
  if (value === undefined || value === null || value === '') {
    return required ? projectBrainRefusal(422, 'field_required', `${field} is required.`) : '';
  }
  if (typeof value !== 'string') return projectBrainRefusal(422, 'field_invalid', `${field} must be a string.`);
  const refused = forbidden(field, value);
  if (refused !== null) return refused;
  const cleaned = value.replace(INVISIBLE, '').trim();
  if (CONTROL.test(cleaned)) return projectBrainRefusal(422, 'field_invalid', `${field} contains control characters.`);
  if (required && cleaned === '') return projectBrainRefusal(422, 'field_required', `${field} is required.`);
  if ([...cleaned].length > PROJECT_BRAIN_CARD_LABEL_MAX) {
    return projectBrainRefusal(422, 'field_too_long', `${field} is longer than ${PROJECT_BRAIN_CARD_LABEL_MAX} characters.`);
  }
  return cleaned;
}

function expectedVersion(field: string, value: unknown, allowZero: boolean): number | ProjectBrainRefusal {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    return projectBrainRefusal(422, 'expected_version_required',
      `${field} must be the version you are changing${allowZero ? ' (0 when there is none yet)' : ''}. Changes never apply blind.`);
  }
  return value;
}

/* ------------------------------------------------------------------- cards */

export const PROJECT_BRAIN_CARD_COMPANION_KINDS = ['LLM', 'AGENT', 'COMPOUND_AGENT', 'HARNESS'] as const;
export type ProjectBrainCardCompanionKind = (typeof PROJECT_BRAIN_CARD_COMPANION_KINDS)[number];
export const PROJECT_BRAIN_CARD_CAPABILITY_KINDS = ['MCP', 'API', 'SKILL'] as const;
export type ProjectBrainCardCapabilityKind = (typeof PROJECT_BRAIN_CARD_CAPABILITY_KINDS)[number];
export const PROJECT_BRAIN_CARD_STATES = ['LIVE', 'DELETED'] as const;
export type ProjectBrainCardState = (typeof PROJECT_BRAIN_CARD_STATES)[number];

export interface ProjectBrainCardCompanion {
  /** 0 = LEFT (the LLM Companion's side), 1 = RIGHT (Jhinn's). The sides never swap. */
  readonly slot: 0 | 1;
  readonly kind: ProjectBrainCardCompanionKind;
  /** The provider as the runtime names it: a reference, never a credential. */
  readonly providerId: string;
  readonly label: string;
}

export interface ProjectBrainCardCapability {
  readonly kind: ProjectBrainCardCapabilityKind;
  /** Resolved by the capability registry. Never a key, a token or a URL carrying one. */
  readonly id: string;
  readonly label: string;
}

/** What a card says. Canonical order (companions by slot, capabilities by kind then id) so equal cards hash equal. */
export interface ProjectBrainCardContent {
  readonly name: string;
  readonly missionHandoff: string;
  readonly skin: string;
  /** '' = the skin's own clothes. */
  readonly outfit: string;
  readonly primary: { readonly key: string; readonly chosen: boolean };
  readonly companions: readonly ProjectBrainCardCompanion[];
  readonly capabilities: readonly ProjectBrainCardCapability[];
}

/** The built-in default, as Wonderland's MakeDefaultCard: always present, never deleted, version 1 forever. */
export const PROJECT_BRAIN_DEFAULT_CARD: ProjectBrainCardContent = Object.freeze({
  name: 'Default',
  missionHandoff: 'angelic_twin_swords',
  skin: 'relay_og',
  outfit: '',
  primary: Object.freeze({ key: 'DEFAULT', chosen: false }),
  companions: Object.freeze([]) as readonly ProjectBrainCardCompanion[],
  capabilities: Object.freeze([]) as readonly ProjectBrainCardCapability[],
});

const CARD_KEYS = ['name', 'missionHandoff', 'skin', 'outfit', 'primary', 'companions', 'capabilities'];

/** VALIDATE A CARD'S CONTENT. Closed keys at every level; every string is screened before anything is kept. */
export function parseProjectBrainCardContent(input: unknown): { readonly ok: true; readonly card: ProjectBrainCardContent } | ProjectBrainRefusal {
  const record = asRecord(input);
  if (record === null) return projectBrainRefusal(422, 'card_invalid', 'card is a JSON object.');
  const closed = closedKeys('card', record, CARD_KEYS);
  if (closed !== null) return closed;
  const name = label('card.name', record.name, true);
  if (isRefusal(name)) return name;
  const missionHandoff = safeId('card.missionHandoff', record.missionHandoff ?? PROJECT_BRAIN_DEFAULT_CARD.missionHandoff);
  if (isRefusal(missionHandoff)) return missionHandoff;
  const skin = safeId('card.skin', record.skin ?? PROJECT_BRAIN_DEFAULT_CARD.skin);
  if (isRefusal(skin)) return skin;
  const outfit = safeId('card.outfit', record.outfit ?? '', true);
  if (isRefusal(outfit)) return outfit;

  const primaryRaw = record.primary === undefined ? { key: 'DEFAULT', chosen: false } : asRecord(record.primary);
  if (primaryRaw === null) return projectBrainRefusal(422, 'card_invalid', 'card.primary is { key, chosen }.');
  const primaryClosed = closedKeys('card.primary', primaryRaw, ['key', 'chosen']);
  if (primaryClosed !== null) return primaryClosed;
  const primaryKey = safeId('card.primary.key', primaryRaw.key ?? 'DEFAULT');
  if (isRefusal(primaryKey)) return primaryKey;
  if (primaryRaw.chosen !== undefined && typeof primaryRaw.chosen !== 'boolean') {
    return projectBrainRefusal(422, 'card_invalid', 'card.primary.chosen is true or false.');
  }

  const rawCompanions = record.companions ?? [];
  if (!Array.isArray(rawCompanions) || rawCompanions.length > PROJECT_BRAIN_CARD_MAX_COMPANIONS) {
    return projectBrainRefusal(422, 'card_invalid', `card.companions is a list of at most ${PROJECT_BRAIN_CARD_MAX_COMPANIONS}.`);
  }
  const companions: ProjectBrainCardCompanion[] = [];
  for (const raw of rawCompanions) {
    const companion = asRecord(raw);
    if (companion === null) return projectBrainRefusal(422, 'card_invalid', 'Each companion is { slot, kind, providerId, label }.');
    const closedCompanion = closedKeys('card.companions[]', companion, ['slot', 'kind', 'providerId', 'label']);
    if (closedCompanion !== null) return closedCompanion;
    if (companion.slot !== 0 && companion.slot !== 1) return projectBrainRefusal(422, 'card_invalid', 'A companion slot is 0 (LEFT) or 1 (RIGHT).');
    if (companions.some((held) => held.slot === companion.slot)) return projectBrainRefusal(422, 'card_invalid', `Companion slot ${String(companion.slot)} is filled twice.`);
    if (!oneOf(PROJECT_BRAIN_CARD_COMPANION_KINDS, companion.kind)) return projectBrainRefusal(422, 'card_invalid', 'A companion kind is LLM, AGENT, COMPOUND_AGENT or HARNESS.');
    const providerId = safeId('card.companions[].providerId', companion.providerId);
    if (isRefusal(providerId)) return providerId;
    const companionLabel = label('card.companions[].label', companion.label, false);
    if (isRefusal(companionLabel)) return companionLabel;
    companions.push({ slot: companion.slot, kind: companion.kind, providerId, label: companionLabel });
  }

  const rawCapabilities = record.capabilities ?? [];
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length > PROJECT_BRAIN_CARD_MAX_CAPABILITIES) {
    return projectBrainRefusal(422, 'card_invalid', `card.capabilities is a list of at most ${PROJECT_BRAIN_CARD_MAX_CAPABILITIES}.`);
  }
  const capabilities: ProjectBrainCardCapability[] = [];
  for (const raw of rawCapabilities) {
    const capability = asRecord(raw);
    if (capability === null) return projectBrainRefusal(422, 'card_invalid', 'Each capability is { kind, id, label }.');
    const closedCapability = closedKeys('card.capabilities[]', capability, ['kind', 'id', 'label']);
    if (closedCapability !== null) return closedCapability;
    if (!oneOf(PROJECT_BRAIN_CARD_CAPABILITY_KINDS, capability.kind)) return projectBrainRefusal(422, 'card_invalid', 'A capability kind is MCP, API or SKILL.');
    const id = safeId('card.capabilities[].id', capability.id);
    if (isRefusal(id)) return id;
    if (capabilities.some((held) => held.kind === capability.kind && held.id === id)) {
      return projectBrainRefusal(422, 'card_invalid', `Capability ${capability.kind} ${id} is attached twice.`);
    }
    const capabilityLabel = label('card.capabilities[].label', capability.label, false);
    if (isRefusal(capabilityLabel)) return capabilityLabel;
    capabilities.push({ kind: capability.kind, id, label: capabilityLabel });
  }
  companions.sort((a, b) => a.slot - b.slot);
  capabilities.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.kind < b.kind ? -1 : 1));
  return {
    ok: true,
    card: { name, missionHandoff, skin, outfit, primary: { key: primaryKey, chosen: primaryRaw.chosen === true }, companions, capabilities },
  };
}

const CARD_ID = /^pbcard:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const isProjectBrainCardId = (value: unknown): value is string => typeof value === 'string' && CARD_ID.test(value);
/** A card a selection or a pin may name: a stored card, or the built-in default. */
export const isProjectBrainCardRef = (value: unknown): value is string => value === PROJECT_BRAIN_CARD_DEFAULT_REF || isProjectBrainCardId(value);

/** How a pinned card version is named everywhere else (a run's card_revision, the document, a context snapshot). */
export const projectBrainCardRevision = (cardRef: string, version: number): string => `${cardRef}@v${String(version)}`;

/* ------------------------------------------------------------------ handoff */

export const PROJECT_BRAIN_HANDOFF_STATES = ['HANDED_OFF', 'RETURNED'] as const;
export type ProjectBrainHandoffState = (typeof PROJECT_BRAIN_HANDOFF_STATES)[number];
/** A run in one of these states is finished: there is no mission left to hand off. */
export const JULIUS_TERMINAL_RUN_STATES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;

/**
 * THE HANDOFF MOVE. ENTER from no handoff or RETURNED; EXIT from HANDED_OFF; anything else is refused by name -- a
 * repeated /handoff is not a second handoff, and a return without one is not a return.
 */
export function projectBrainHandoffMove(input: {
  readonly operation: 'HANDOFF_ENTER' | 'HANDOFF_EXIT';
  readonly current: ProjectBrainHandoffState | null;
  readonly runState: string;
}): { readonly ok: true; readonly next: ProjectBrainHandoffState } | ProjectBrainRefusal {
  if (input.operation === 'HANDOFF_ENTER') {
    if ((JULIUS_TERMINAL_RUN_STATES as readonly string[]).includes(input.runState)) {
      return projectBrainRefusal(409, 'mission_finished', `The mission is ${input.runState}; there is nothing to hand off.`);
    }
    if (input.current === 'HANDED_OFF') return projectBrainRefusal(409, 'already_handed_off', 'The mission is already handed off.');
    return { ok: true, next: 'HANDED_OFF' };
  }
  if (input.current !== 'HANDED_OFF') return projectBrainRefusal(409, 'not_handed_off', 'The mission is not handed off; there is nothing to return from.');
  return { ok: true, next: 'RETURNED' };
}

/* -------------------------------------------------------------------- evals */

export const PROJECT_BRAIN_EVAL_RESULTS = ['PASS', 'FAIL', 'INCONCLUSIVE'] as const;
export type ProjectBrainEvalResult = (typeof PROJECT_BRAIN_EVAL_RESULTS)[number];
export const PROJECT_BRAIN_EVAL_STATUSES = ['CURRENT', 'SUPERSEDED', 'INVALIDATED'] as const;
export type ProjectBrainEvalStatus = (typeof PROJECT_BRAIN_EVAL_STATUSES)[number];
/** What an eval may cite: the durable things evidence is made of in this project. */
export const EVAL_EVIDENCE_TYPES: readonly string[] = ['evidence', 'artifact', 'finding', 'decision', 'criterion', 'task', 'mission', 'pbr'];
/** A subject revision is an exact identity: a commit, a content hash, a contract revision. Never a range or a time. */
const SUBJECT_REVISION = /^[A-Za-z0-9._:@/+-]{1,128}$/u;
const EVAL_ID = /^pbeval:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const isProjectBrainEvalId = (value: unknown): value is string => typeof value === 'string' && EVAL_ID.test(value);

export interface ProjectBrainEvalState {
  readonly evalId: string;
  readonly subjectRef: string;
  readonly subjectRevision: string;
  readonly criterion: string;
  readonly result: ProjectBrainEvalResult;
  readonly status: ProjectBrainEvalStatus;
}

/**
 * DOES THIS EVAL QUALIFY THIS REVISION? Only a CURRENT PASS of exactly that revision. An eval of an earlier revision,
 * a superseded or invalidated one, or anything but PASS qualifies nothing -- the rule that keeps an old eval from
 * silently qualifying materially changed code.
 */
export const projectBrainEvalQualifies = (evaluation: ProjectBrainEvalState, subjectRef: string, subjectRevision: string): boolean =>
  evaluation.status === 'CURRENT' && evaluation.result === 'PASS'
  && evaluation.subjectRef === subjectRef && evaluation.subjectRevision === subjectRevision;

/* -------------------------------------------------------------- read models */

/** The components as the store reads them and the document projects them. Rows, never copies of anyone else's. */

export interface PbCardRow {
  readonly cardId: string; readonly state: ProjectBrainCardState; readonly name: string; readonly content: ProjectBrainCardContent;
  readonly contentHash: string; readonly version: number; readonly author: ProjectBrainActor; readonly deliverer: ProjectBrainDeliverer;
  readonly createdAt: string; readonly updatedAt: string;
}
export interface PbCardSelectionRow { readonly cardRef: string; readonly version: number; readonly updatedAt: string }
export interface PbMissionCardRow { readonly runId: string; readonly cardRef: string; readonly cardVersion: number; readonly contentHash: string; readonly pinnedAt: string }
export interface PbHandoffRow { readonly runId: string; readonly state: ProjectBrainHandoffState; readonly form: string; readonly version: number; readonly updatedAt: string }
export interface PbEvalRow {
  readonly evalId: string; readonly runId: string | null; readonly subjectRef: string; readonly subjectRevision: string; readonly criterion: string;
  readonly result: ProjectBrainEvalResult; readonly evidenceRefs: readonly string[]; readonly status: ProjectBrainEvalStatus;
  readonly supersededBy: string | null; readonly version: number; readonly evaluator: ProjectBrainActor; readonly recordedAt: string; readonly updatedAt: string;
}
export interface ProjectBrainComponentRows {
  readonly cards: readonly PbCardRow[];
  /** Null: nothing selected, so the built-in default is the next mission's card. */
  readonly selection: PbCardSelectionRow | null;
  readonly missionCards: readonly PbMissionCardRow[];
  readonly handoffs: readonly PbHandoffRow[];
  readonly evals: readonly PbEvalRow[];
}

/* ----------------------------------------------------------------- commands */

export type ProjectBrainComponentCommand =
  | { readonly operation: 'CARD_CREATE'; readonly idempotencyKey: string; readonly card: ProjectBrainCardContent }
  | { readonly operation: 'CARD_UPDATE'; readonly idempotencyKey: string; readonly cardId: string; readonly expectedVersion: number; readonly card: ProjectBrainCardContent }
  | { readonly operation: 'CARD_DELETE'; readonly idempotencyKey: string; readonly cardId: string; readonly expectedVersion: number }
  | { readonly operation: 'CARD_SELECT'; readonly idempotencyKey: string; readonly cardRef: string; readonly expectedSelectionVersion: number }
  | { readonly operation: 'MISSION_PIN_CARD'; readonly idempotencyKey: string; readonly runId: string }
  | { readonly operation: 'HANDOFF_ENTER' | 'HANDOFF_EXIT'; readonly idempotencyKey: string; readonly runId: string; readonly expectedVersion: number }
  | {
    readonly operation: 'EVAL_RECORD'; readonly idempotencyKey: string; readonly runId: string | null; readonly subjectRef: string;
    readonly subjectRevision: string; readonly criterion: string; readonly result: ProjectBrainEvalResult; readonly evidenceRefs: readonly string[];
  }
  | { readonly operation: 'EVAL_INVALIDATE'; readonly idempotencyKey: string; readonly evalId: string; readonly expectedVersion: number };

const COMPONENT_KEYS: Readonly<Record<ProjectBrainComponentOperation, readonly string[]>> = {
  CARD_CREATE: ['operation', 'idempotencyKey', 'card'],
  CARD_UPDATE: ['operation', 'idempotencyKey', 'cardId', 'expectedVersion', 'card'],
  CARD_DELETE: ['operation', 'idempotencyKey', 'cardId', 'expectedVersion'],
  CARD_SELECT: ['operation', 'idempotencyKey', 'cardRef', 'expectedSelectionVersion'],
  MISSION_PIN_CARD: ['operation', 'idempotencyKey', 'runId'],
  HANDOFF_ENTER: ['operation', 'idempotencyKey', 'runId', 'expectedVersion'],
  HANDOFF_EXIT: ['operation', 'idempotencyKey', 'runId', 'expectedVersion'],
  EVAL_RECORD: ['operation', 'idempotencyKey', 'runId', 'subjectRef', 'subjectRevision', 'criterion', 'result', 'evidenceRefs'],
  EVAL_INVALIDATE: ['operation', 'idempotencyKey', 'evalId', 'expectedVersion'],
};

/** PARSE AND VALIDATE A COMPONENT MUTATION. Shape only; who may do it is authorizeProjectBrainComponentMutation. */
export function parseProjectBrainComponentMutation(input: unknown): { readonly ok: true; readonly command: ProjectBrainComponentCommand } | ProjectBrainRefusal {
  const body = asRecord(input);
  if (body === null) return projectBrainRefusal(400, 'body_invalid', 'A mutation is a JSON object.');
  if (!isProjectBrainComponentOperation(body.operation)) return projectBrainRefusal(422, 'operation_invalid', 'operation is not a Project Brain component operation.');
  const operation = body.operation;
  const closed = closedKeys('the mutation', body, COMPONENT_KEYS[operation]);
  if (closed !== null) return closed;
  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(body.idempotencyKey)) {
    return projectBrainRefusal(422, 'idempotency_key_required', 'idempotencyKey is required (8-200 of A-Z a-z 0-9 . _ : -). Send the same key to retry safely.');
  }
  const idempotencyKey = body.idempotencyKey;
  const runOf = (value: unknown): string | ProjectBrainRefusal =>
    typeof value === 'string' && RUN_ID.test(value) ? value : projectBrainRefusal(422, 'run_invalid', 'runId is not a run id.');

  switch (operation) {
    case 'CARD_CREATE': {
      const card = parseProjectBrainCardContent(body.card);
      return card.ok ? { ok: true, command: { operation, idempotencyKey, card: card.card } } : card;
    }
    case 'CARD_UPDATE': {
      if (!isProjectBrainCardId(body.cardId)) return projectBrainRefusal(422, 'card_invalid', 'cardId names a stored card (pbcard:<uuid>); the built-in default is not edited.');
      const version = expectedVersion('expectedVersion', body.expectedVersion, false);
      if (isRefusal(version)) return version;
      const card = parseProjectBrainCardContent(body.card);
      return card.ok ? { ok: true, command: { operation, idempotencyKey, cardId: body.cardId, expectedVersion: version, card: card.card } } : card;
    }
    case 'CARD_DELETE': {
      if (!isProjectBrainCardId(body.cardId)) return projectBrainRefusal(422, 'card_invalid', 'cardId names a stored card; the built-in default is never deleted.');
      const version = expectedVersion('expectedVersion', body.expectedVersion, false);
      return isRefusal(version) ? version : { ok: true, command: { operation, idempotencyKey, cardId: body.cardId, expectedVersion: version } };
    }
    case 'CARD_SELECT': {
      if (!isProjectBrainCardRef(body.cardRef)) return projectBrainRefusal(422, 'card_invalid', `cardRef is a stored card or ${PROJECT_BRAIN_CARD_DEFAULT_REF}.`);
      const version = expectedVersion('expectedSelectionVersion', body.expectedSelectionVersion, true);
      return isRefusal(version) ? version : { ok: true, command: { operation, idempotencyKey, cardRef: body.cardRef, expectedSelectionVersion: version } };
    }
    case 'MISSION_PIN_CARD': {
      const runId = runOf(body.runId);
      return isRefusal(runId) ? runId : { ok: true, command: { operation, idempotencyKey, runId } };
    }
    case 'HANDOFF_ENTER':
    case 'HANDOFF_EXIT': {
      const runId = runOf(body.runId);
      if (isRefusal(runId)) return runId;
      const version = expectedVersion('expectedVersion', body.expectedVersion, true);
      return isRefusal(version) ? version : { ok: true, command: { operation, idempotencyKey, runId, expectedVersion: version } };
    }
    case 'EVAL_RECORD': {
      const runId = body.runId === undefined || body.runId === null ? null : runOf(body.runId);
      if (isRefusal(runId)) return runId;
      if (parseProjectBrainRef(body.subjectRef) === null) return projectBrainRefusal(422, 'ref_invalid', 'subjectRef must be a Project Brain reference (type:id).');
      if (typeof body.subjectRevision !== 'string' || !SUBJECT_REVISION.test(body.subjectRevision)) {
        return projectBrainRefusal(422, 'subject_revision_required', 'subjectRevision is the exact revision judged (a commit, a content hash, a contract revision).');
      }
      // A revision IS usually a hash, which looks random by design: an exact hash form (bare, or behind a lowercase
      // scheme like `sha256:`) is accepted as such; any other random-looking or credential-shaped value is refused.
      const hashForm = /^(?:[a-z0-9]{1,16}:)?[0-9a-f]{7,64}$/u.test(body.subjectRevision);
      const revisionRefused = hashForm ? null : forbidden('subjectRevision', body.subjectRevision);
      if (revisionRefused !== null) return revisionRefused;
      if (typeof body.criterion !== 'string' || body.criterion.trim() === '' || body.criterion.trim().length > PROJECT_BRAIN_TITLE_MAX || CONTROL.test(body.criterion.trim())) {
        return projectBrainRefusal(422, 'criterion_required', `criterion is the one thing judged (1-${PROJECT_BRAIN_TITLE_MAX} characters, one line).`);
      }
      const criterionRefused = forbidden('criterion', body.criterion);
      if (criterionRefused !== null) return criterionRefused;
      if (!oneOf(PROJECT_BRAIN_EVAL_RESULTS, body.result)) return projectBrainRefusal(422, 'result_invalid', 'result is PASS, FAIL or INCONCLUSIVE.');
      const rawEvidence = body.evidenceRefs ?? [];
      if (!Array.isArray(rawEvidence) || rawEvidence.length > 32) return projectBrainRefusal(422, 'evidence_invalid', 'evidenceRefs is a list of at most 32 references.');
      const evidenceRefs: string[] = [];
      for (const ref of rawEvidence) {
        const parsed = parseProjectBrainRef(ref);
        if (parsed === null || !EVAL_EVIDENCE_TYPES.includes(parsed.type)) {
          return projectBrainRefusal(422, 'evidence_invalid', `An eval cites evidence by reference (${EVAL_EVIDENCE_TYPES.join(', ')}).`);
        }
        if (!evidenceRefs.includes(ref as string)) evidenceRefs.push(ref as string);
      }
      if (body.result === 'PASS' && evidenceRefs.length === 0) {
        // A PASS with nothing behind it is the fabricated success this product exists to prevent.
        return projectBrainRefusal(422, 'evidence_required', 'A PASS cites the evidence it rests on.');
      }
      return {
        ok: true,
        command: {
          operation, idempotencyKey, runId, subjectRef: body.subjectRef as string, subjectRevision: body.subjectRevision,
          criterion: body.criterion.trim(), result: body.result, evidenceRefs: evidenceRefs.sort(),
        },
      };
    }
    case 'EVAL_INVALIDATE': {
      if (!isProjectBrainEvalId(body.evalId)) return projectBrainRefusal(422, 'eval_invalid', 'evalId names an eval (pbeval:<uuid>).');
      const version = expectedVersion('expectedVersion', body.expectedVersion, false);
      return isRefusal(version) ? version : { ok: true, command: { operation, idempotencyKey, evalId: body.evalId, expectedVersion: version } };
    }
    default:
      return projectBrainRefusal(422, 'operation_invalid', 'operation is not a Project Brain component operation.');
  }
}

/* ------------------------------------------------------------ authorization */

/** Channels that speak for the runtime or the operator, never for a player's client or a companion. */
const AUTHORITATIVE_DELIVERERS: readonly ProjectBrainDelivererKind[] = ['OPERATOR_API', 'JULIUS_RUNTIME'];
/** Who may judge: the operator and Julius's own roles. A player's opinion is a statement, not an eval. */
const EVALUATORS: readonly ProjectBrainActorKind[] = ['FOUNDER', 'JULIUS', 'INDEPENDENT_REVIEWER', 'SYSTEM'];

/**
 * MAY THIS ACTOR DO THIS? From the membership's capabilities and the stored author, never the request body.
 *   - a companion changes none of these: it returns results, it does not configure, hand off or judge;
 *   - cards and handoffs need brain:write; changing or deleting someone else's card needs brain:adopt (the owner);
 *   - a mission PIN comes only from the runtime or the operator: a client cannot choose which card a run ran under;
 *   - an eval comes only from an evaluator through an authoritative channel; invalidating one is an owner's act.
 */
export function authorizeProjectBrainComponentMutation(input: {
  readonly provenance: ProjectBrainProvenance;
  readonly capabilities: readonly ProjectBrainCapability[];
  readonly command: ProjectBrainComponentCommand;
  /** The stored card's author, for CARD_UPDATE and CARD_DELETE. */
  readonly cardAuthor?: { readonly kind: string; readonly id: string } | null;
}): { readonly ok: true } | ProjectBrainRefusal {
  const { provenance, capabilities, command } = input;
  const author = provenance.author;
  if (author.id.trim() === '' || provenance.deliverer.id.trim() === '') {
    return projectBrainRefusal(401, 'actor_required', 'A Project Brain change names who stated it and which channel carried it.');
  }
  if (`${author.kind}:${author.id}` === `${provenance.deliverer.kind}:${provenance.deliverer.id}`) {
    return projectBrainRefusal(400, 'provenance_collapsed', 'The author and the deliverer of a change are different facts.');
  }
  if (author.kind === 'COMPANION' || provenance.deliverer.kind === 'COMPANION_CHANNEL') {
    return projectBrainRefusal(403, 'companion_cannot_redefine_mission', 'A companion returns results; it does not configure, hand off or judge.');
  }
  const has = (capability: ProjectBrainCapability) => capabilities.includes(capability);
  if (!has('brain:write')) return projectBrainRefusal(403, 'write_not_permitted', 'This membership cannot change the Project Brain.');
  switch (command.operation) {
    case 'CARD_UPDATE':
    case 'CARD_DELETE': {
      const stored = input.cardAuthor ?? null;
      if (stored === null) return projectBrainRefusal(404, 'card_not_found', 'No such card in this project.');
      const isAuthor = stored.kind === author.kind && stored.id === author.id;
      return isAuthor || has('brain:adopt') ? { ok: true }
        : projectBrainRefusal(403, 'not_the_author', 'Only the card\'s author, or a project owner, changes or deletes it.');
    }
    case 'MISSION_PIN_CARD':
      return AUTHORITATIVE_DELIVERERS.includes(provenance.deliverer.kind) ? { ok: true }
        : projectBrainRefusal(403, 'pin_not_permitted', 'A mission is pinned to its card by the runtime that starts it, never by a client.');
    case 'EVAL_RECORD':
      return AUTHORITATIVE_DELIVERERS.includes(provenance.deliverer.kind) && EVALUATORS.includes(author.kind) ? { ok: true }
        : projectBrainRefusal(403, 'evaluator_required', 'An eval is recorded by an evaluator through the runtime or the operator.');
    case 'EVAL_INVALIDATE':
      return has('brain:adopt') ? { ok: true } : projectBrainRefusal(403, 'capability_missing', 'Invalidating an eval is a project owner\'s act.');
    default:
      return { ok: true };
  }
}

/* ------------------------------------------------------------------- events */

/** The component events, named in the one Project Brain vocabulary (PROJECT_BRAIN_EVENT_TYPES holds every one). */
export type ProjectBrainComponentEventType = Extract<ProjectBrainEventType,
  | 'project_brain.card.created' | 'project_brain.card.updated' | 'project_brain.card.deleted' | 'project_brain.card.selected'
  | 'project_brain.mission.card_pinned' | 'project_brain.handoff.entered' | 'project_brain.handoff.returned'
  | 'project_brain.eval.recorded' | 'project_brain.eval.invalidated'>;

export const projectBrainComponentEventType = (operation: ProjectBrainComponentOperation): ProjectBrainComponentEventType => ({
  CARD_CREATE: 'project_brain.card.created',
  CARD_UPDATE: 'project_brain.card.updated',
  CARD_DELETE: 'project_brain.card.deleted',
  CARD_SELECT: 'project_brain.card.selected',
  MISSION_PIN_CARD: 'project_brain.mission.card_pinned',
  HANDOFF_ENTER: 'project_brain.handoff.entered',
  HANDOFF_EXIT: 'project_brain.handoff.returned',
  EVAL_RECORD: 'project_brain.eval.recorded',
  EVAL_INVALIDATE: 'project_brain.eval.invalidated',
} as const)[operation];

export const isProjectBrainUuid = (value: string): boolean => UUID.test(value);
