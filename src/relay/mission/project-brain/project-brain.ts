/**
 * THE PROJECT BRAIN, AS ONE TYPED VOCABULARY.
 *
 * WHAT THE PROJECT BRAIN IS. Julius's durable memory of a project: what was asked
 * for, what Julius decided, what the reviewer found, what was repaired, what the
 * evidence says, who may change what, and what people have told it. Most of that
 * is ALREADY Julius's own rows (`julius_brain_entries`, criteria, findings,
 * evidence, decisions, repair cycles, approvals, task contracts, trajectory) and
 * stays exactly where it is. This module adds the one thing that had no home --
 * a person's statement -- and the vocabulary every surface uses to read the whole
 * of it. There is no second brain: Wonderland, a companion and the operator all
 * read the same rows Julius reads, through this vocabulary.
 *
 * WHAT IT REFUSES TO BE:
 *
 *   - **An authority.** A record is a statement with an author. A requirement a
 *     player proposes is a PROPOSAL to the contract; it reaches Julius's context
 *     as something a person said (`user_stated`, unverified), never as a locked
 *     term, and adopting it is a capability only a project owner holds.
 *   - **A place for secrets or reasoning.** Content carrying credential-shaped
 *     material or hidden-reasoning markers is REFUSED, not quietly redacted: the
 *     author is told, and nothing is stored. Commands have a closed key set, so a
 *     `reasoning` or `chainOfThought` field cannot even be sent.
 *   - **Something a client can attribute.** Author and deliverer come from the
 *     authenticated channel, never from the request body, and they are kept
 *     apart: the person who STATED a thing is not the surface that DELIVERED it.
 *
 * Pure: no clock, no I/O. Time and identity are parameters.
 */

export const PROJECT_BRAIN_SCHEMA_V1 = 'relay-project-brain.v1' as const;
export const PROJECT_BRAIN_EVENT_SCHEMA_V1 = 'relay-project-brain-event.v1' as const;
export const PROJECT_BRAIN_MUTATION_SCHEMA_V1 = 'relay-project-brain-mutation.v1' as const;

/* ---------------------------------------------------------------- records */

/**
 * WHAT A PERSON (OR A COMPANION) MAY STATE. Julius's own kinds -- findings,
 * verification decisions, evidence, repairs -- are not here, because Julius
 * writes those through its own runtime, and a second writer for them would be a
 * second authority. What is here answers to one of them: a FINDING_RESPONSE
 * responds to a finding, a MEMORY_REVIEW reviews one of Julius's memories, a
 * GOVERNANCE_ACK acknowledges an approval or a contract.
 */
export const PROJECT_BRAIN_RECORD_DOMAINS = [
  'USER_FACT', 'PREFERENCE', 'IDENTITY', 'INSTRUCTION', 'WORKFLOW', 'SCRATCHPAD', 'SHARED_CONTEXT',
  'OBJECTIVE_NOTE', 'REQUIREMENT', 'CONSTRAINT', 'ACCEPTANCE_CRITERION', 'ARCHITECTURE_NOTE',
  'DECISION', 'RESEARCH_NOTE', 'MISSION_INPUT', 'MEMORY_REVIEW', 'FINDING_RESPONSE', 'GOVERNANCE_ACK',
  'COMPANION_RESULT',
] as const;
export type ProjectBrainRecordDomain = (typeof PROJECT_BRAIN_RECORD_DOMAINS)[number];

export const PROJECT_BRAIN_STATUSES = [
  'PROPOSED', 'ACTIVE', 'ADOPTED', 'ACCEPTED', 'DECLINED', 'RESOLVED', 'ACKNOWLEDGED', 'WITHDRAWN', 'SUPERSEDED',
] as const;
export type ProjectBrainStatus = (typeof PROJECT_BRAIN_STATUSES)[number];

export const PROJECT_BRAIN_SCOPES = ['PROJECT', 'MISSION'] as const;
export type ProjectBrainScope = (typeof PROJECT_BRAIN_SCOPES)[number];

export const PROJECT_BRAIN_RELATIONS = [
  'SATISFIES', 'REFINES', 'RESPONDS_TO', 'SUPPORTS', 'CONTRADICTS', 'SUPERSEDES', 'DERIVED_FROM', 'CONCERNS', 'ACKNOWLEDGES', 'REVIEWS',
] as const;
export type ProjectBrainRelation = (typeof PROJECT_BRAIN_RELATIONS)[number];

/* ------------------------------------------------------------- provenance */

/**
 * WHO STATED IT. Roles, not providers: the Coding Agent is a role whichever
 * model answers it. `FOUNDER` is the operator credential acting for the person
 * who owns the deployment; `WONDERLAND_PLAYER` is a signed-in project member.
 */
export const PROJECT_BRAIN_ACTOR_KINDS = [
  'FOUNDER', 'WONDERLAND_PLAYER', 'JULIUS', 'PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER', 'COMPANION', 'SYSTEM',
] as const;
export type ProjectBrainActorKind = (typeof PROJECT_BRAIN_ACTOR_KINDS)[number];

/** WHICH CHANNEL CARRIED IT. Never the same field as the author. */
export const PROJECT_BRAIN_DELIVERER_KINDS = [
  'WONDERLAND_CLIENT', 'OPERATOR_API', 'JULIUS_RUNTIME', 'COMPANION_CHANNEL', 'RELAY_BOOTSTRAP',
] as const;
export type ProjectBrainDelivererKind = (typeof PROJECT_BRAIN_DELIVERER_KINDS)[number];

export interface ProjectBrainActor {
  readonly kind: ProjectBrainActorKind;
  readonly id: string;
}

export interface ProjectBrainDeliverer {
  readonly kind: ProjectBrainDelivererKind;
  readonly id: string;
}

/**
 * AUTHOR ≠ DELIVERER. Both are bound by the server from the authenticated
 * channel. A deliverer that claimed to be its own author would collapse the one
 * distinction provenance exists to keep, so the pair is refused if the two ids
 * are the same thing wearing two hats.
 */
export interface ProjectBrainProvenance {
  readonly author: ProjectBrainActor;
  readonly deliverer: ProjectBrainDeliverer;
}

/* ------------------------------------------------------------ capabilities */

/**
 * WHAT A MEMBERSHIP ROLE MAY DO. The membership row is the authority; the
 * capability is derived from it here, deterministically, before any relevance or
 * ranking is applied anywhere.
 */
export const PROJECT_BRAIN_CAPABILITIES = ['brain:read', 'brain:write', 'brain:adopt', 'brain:members'] as const;
export type ProjectBrainCapability = (typeof PROJECT_BRAIN_CAPABILITIES)[number];

export const PROJECT_BRAIN_ROLE_CAPABILITIES: Readonly<Record<string, readonly ProjectBrainCapability[]>> = Object.freeze({
  OWNER: Object.freeze(['brain:read', 'brain:write', 'brain:adopt', 'brain:members'] as const),
  // Founder decisions 4 and 5 (2026-09-27): an ADMIN holds what an OWNER holds. A MEMBER, in the Brain, is an editor:
  // it proposes and writes its own statements, never adopts and never manages membership (project-brain-members.ts).
  ADMIN: Object.freeze(['brain:read', 'brain:write', 'brain:adopt', 'brain:members'] as const),
  MEMBER: Object.freeze(['brain:read', 'brain:write'] as const),
  EDITOR: Object.freeze(['brain:read', 'brain:write'] as const),
  VIEWER: Object.freeze(['brain:read'] as const),
});

export function projectBrainCapabilitiesFor(role: string | null): readonly ProjectBrainCapability[] {
  if (role === null) return [];
  return PROJECT_BRAIN_ROLE_CAPABILITIES[role] ?? [];
}

/* ----------------------------------------------------------- domain rules */

interface DomainRule {
  /** The status a record is born in. MEMORY_REVIEW names its verdict instead. */
  readonly initial: ProjectBrainStatus | 'VERDICT';
  /** Which kinds of author may state it. */
  readonly authors: readonly ProjectBrainActorKind[];
  /** A record that must point at the thing it is about. */
  readonly needsSubject: boolean;
  /** Whether the content may still be revised in this status. */
  readonly revisable: readonly ProjectBrainStatus[];
}

const HUMANS: readonly ProjectBrainActorKind[] = ['FOUNDER', 'WONDERLAND_PLAYER'];
const NOTE: DomainRule = { initial: 'ACTIVE', authors: HUMANS, needsSubject: false, revisable: ['ACTIVE'] };
const PROPOSAL: DomainRule = { initial: 'PROPOSED', authors: HUMANS, needsSubject: false, revisable: ['PROPOSED'] };

export const PROJECT_BRAIN_DOMAIN_RULES: Readonly<Record<ProjectBrainRecordDomain, DomainRule>> = Object.freeze({
  USER_FACT: NOTE,
  PREFERENCE: NOTE,
  IDENTITY: NOTE,
  INSTRUCTION: NOTE,
  WORKFLOW: NOTE,
  SCRATCHPAD: NOTE,
  SHARED_CONTEXT: NOTE,
  RESEARCH_NOTE: NOTE,
  DECISION: NOTE,
  MISSION_INPUT: NOTE,
  // Terms of a contract: a person proposes them, an owner adopts them, and
  // Julius is the one that decides what a mission is held to.
  OBJECTIVE_NOTE: PROPOSAL,
  REQUIREMENT: PROPOSAL,
  CONSTRAINT: PROPOSAL,
  ACCEPTANCE_CRITERION: PROPOSAL,
  ARCHITECTURE_NOTE: PROPOSAL,
  FINDING_RESPONSE: { initial: 'ACTIVE', authors: HUMANS, needsSubject: true, revisable: ['ACTIVE'] },
  MEMORY_REVIEW: { initial: 'VERDICT', authors: HUMANS, needsSubject: true, revisable: [] },
  GOVERNANCE_ACK: { initial: 'ACKNOWLEDGED', authors: HUMANS, needsSubject: true, revisable: [] },
  // A companion's work comes back as a proposal for Julius to validate. It can
  // never author a term, a decision or a governance act.
  COMPANION_RESULT: { initial: 'PROPOSED', authors: ['COMPANION'], needsSubject: false, revisable: [] },
});

/**
 * STATUS MOVES, and the capability each needs. Anything not listed is refused.
 * `brain:adopt` is the owner's (and an admin's): only they turn a proposal into an
 * adopted term or decline it. An author may always withdraw what they said. A live
 * statement is resolved or superseded by its AUTHOR or an owner/admin, never by
 * another writer: a member never overwrites another person's state (founder, 10-04).
 */
const MOVES: ReadonlyArray<{ from: ProjectBrainStatus; to: ProjectBrainStatus; needs: ProjectBrainCapability | 'author' }> = [
  { from: 'PROPOSED', to: 'ADOPTED', needs: 'brain:adopt' },
  { from: 'PROPOSED', to: 'DECLINED', needs: 'brain:adopt' },
  { from: 'PROPOSED', to: 'WITHDRAWN', needs: 'author' },
  { from: 'ADOPTED', to: 'SUPERSEDED', needs: 'brain:adopt' },
  { from: 'ADOPTED', to: 'WITHDRAWN', needs: 'brain:adopt' },
  { from: 'ACTIVE', to: 'RESOLVED', needs: 'author' },
  { from: 'ACTIVE', to: 'SUPERSEDED', needs: 'author' },
  { from: 'ACTIVE', to: 'WITHDRAWN', needs: 'author' },
  { from: 'ACCEPTED', to: 'WITHDRAWN', needs: 'author' },
  { from: 'DECLINED', to: 'WITHDRAWN', needs: 'author' },
  { from: 'ACKNOWLEDGED', to: 'WITHDRAWN', needs: 'author' },
];

export function projectBrainStatusMove(from: ProjectBrainStatus, to: ProjectBrainStatus): ProjectBrainCapability | 'author' | null {
  return MOVES.find((move) => move.from === from && move.to === to)?.needs ?? null;
}

/** Statuses whose records still say something current. */
export const PROJECT_BRAIN_LIVE_STATUSES: readonly ProjectBrainStatus[] = ['PROPOSED', 'ACTIVE', 'ADOPTED', 'ACCEPTED', 'DECLINED', 'RESOLVED', 'ACKNOWLEDGED'];

/* ------------------------------------------------------------------ refs */

/**
 * A TYPED REFERENCE TO ANYTHING IN THE PROJECT BRAIN. `type:id`, where the type
 * is the text before the FIRST colon (types never contain one) and the id is the
 * rest -- so Julius's own ids, which carry colons, travel unchanged. A record's
 * ref is its id (`pbr:<uuid>`).
 */
export const PROJECT_BRAIN_REF_TYPES = [
  'pbr', 'mission', 'entry', 'claim', 'finding', 'criterion', 'evidence', 'decision', 'repair', 'approval', 'contract', 'artifact', 'transition', 'trajectory', 'event', 'task',
  // The C.A.R.D. and eval components (migration 034): `pbcard:<uuid>` or `pbcard:default`, and `pbeval:<uuid>`.
  'pbcard', 'pbeval',
] as const;
export type ProjectBrainRefType = (typeof PROJECT_BRAIN_REF_TYPES)[number];

export interface ProjectBrainRef {
  readonly type: ProjectBrainRefType;
  readonly id: string;
}

const REF_ID = /^[\x21-\x7e]{1,280}$/u;

export function parseProjectBrainRef(value: unknown): ProjectBrainRef | null {
  if (typeof value !== 'string' || value.length > 300) return null;
  const colon = value.indexOf(':');
  if (colon <= 0) return null;
  const type = value.slice(0, colon);
  const id = value.slice(colon + 1);
  if (!(PROJECT_BRAIN_REF_TYPES as readonly string[]).includes(type) || !REF_ID.test(id)) return null;
  if (type === 'pbr' && !RECORD_UUID.test(id)) return null;
  if (type === 'pbcard' && id !== 'default' && !RECORD_UUID.test(id)) return null;
  if (type === 'pbeval' && !RECORD_UUID.test(id)) return null;
  return { type: type as ProjectBrainRefType, id };
}

export const projectBrainRef = (type: ProjectBrainRefType, id: string): string => `${type}:${id}`;

const RECORD_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
export const isProjectBrainRecordId = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('pbr:') && RECORD_UUID.test(value.slice(4));

/* ------------------------------------------------------------ commands */

export type ProjectBrainMutationCommand =
  | {
    readonly operation: 'CREATE';
    readonly idempotencyKey: string;
    readonly domain: ProjectBrainRecordDomain;
    readonly scope: ProjectBrainScope;
    readonly runId: string | null;
    readonly title: string;
    readonly body: string;
    readonly subjectRef: string | null;
    /** MEMORY_REVIEW only: the verdict. */
    readonly verdict: 'ACCEPTED' | 'DECLINED' | null;
    readonly links: readonly { readonly relation: ProjectBrainRelation; readonly toRef: string }[];
  }
  | {
    readonly operation: 'REVISE';
    readonly idempotencyKey: string;
    readonly recordId: string;
    readonly expectedVersion: number;
    readonly title: string | null;
    readonly body: string | null;
  }
  | {
    readonly operation: 'SET_STATUS';
    readonly idempotencyKey: string;
    readonly recordId: string;
    readonly expectedVersion: number;
    readonly status: ProjectBrainStatus;
  }
  | {
    readonly operation: 'LINK';
    readonly idempotencyKey: string;
    readonly fromRef: string;
    readonly relation: ProjectBrainRelation;
    readonly toRef: string;
  };

export type ProjectBrainOperation = ProjectBrainMutationCommand['operation'];

/** Why a mutation did not happen. The status code is the route's; the code is everyone's. */
export interface ProjectBrainRefusal {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export const projectBrainRefusal = (status: number, code: string, message: string): ProjectBrainRefusal =>
  ({ ok: false, status, code, message });

const COMMAND_KEYS: Readonly<Record<ProjectBrainOperation, readonly string[]>> = {
  CREATE: ['operation', 'idempotencyKey', 'domain', 'scope', 'runId', 'title', 'body', 'subjectRef', 'verdict', 'links'],
  REVISE: ['operation', 'idempotencyKey', 'recordId', 'expectedVersion', 'title', 'body'],
  SET_STATUS: ['operation', 'idempotencyKey', 'recordId', 'expectedVersion', 'status'],
  LINK: ['operation', 'idempotencyKey', 'fromRef', 'relation', 'toRef'],
};

export const PROJECT_BRAIN_TITLE_MAX = 200;
export const PROJECT_BRAIN_BODY_MAX = 4000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/u;
const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/u;
/** C0 controls other than tab and newline, DEL, and the C1 block. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u;

/**
 * CREDENTIALS AND HIDDEN REASONING ARE REFUSED, NOT REDACTED. The same shapes the
 * persistence redactor knows, plus the common token families, kept local so the
 * domain does not depend on a persistence module.
 *
 * A KEY'S PREFIX STARTS A TOKEN. Without the left boundary `sk-[…]{8,}` matched inside
 * `julius-task-contract.ts` and `julius-task-pipeline.ts`, so a person naming Julius's own files
 * was refused as if they had pasted a key. Found by the Python evidence layer on its first real
 * paid bundle (run 36915013287); `python/julius_brain_intel/safety.py` mirrors these shapes and
 * `scripts/julius-brain-intel-python.test.ts` runs one corpus through both.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  /(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}/u,
  /(?<![A-Za-z0-9])sk-ant-[A-Za-z0-9_-]{8,}/u,
  /(?<![A-Za-z0-9])AKIA[0-9A-Z]{12,}/u,
  /-----BEGIN [A-Z ]*PRIVATE KEY/u,
  /(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{20,}/u,
  /(?<![A-Za-z0-9])github_pat_[A-Za-z0-9_]{20,}/u,
  /(?<![A-Za-z0-9])xox[baprs]-[A-Za-z0-9-]{10,}/u,
  /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/u,
  /\b(?:password|passwd|api[-_ ]?key|secret[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret)\s*[:=]\s*\S{6,}/iu,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s@/]+@/iu,
];
const HIDDEN_REASONING = /chain[- ]of[- ]thought|hidden reasoning|<thinking>|<\/thinking>|internal monologue/iu;

export function projectBrainForbiddenMaterial(text: string): 'credential' | 'hidden_reasoning' | null {
  if (SECRET_SHAPES.some((shape) => shape.test(text))) return 'credential';
  if (HIDDEN_REASONING.test(text)) return 'hidden_reasoning';
  return null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const oneOf = <T extends string>(values: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (values as readonly string[]).includes(value);

function checkText(field: string, value: unknown, max: number, required: boolean): string | ProjectBrainRefusal | null {
  if (value === undefined || value === null) {
    return required ? projectBrainRefusal(422, 'field_required', `${field} is required.`) : null;
  }
  if (typeof value !== 'string') return projectBrainRefusal(422, 'field_invalid', `${field} must be a string.`);
  const trimmed = value.trim();
  if (required && trimmed === '') return projectBrainRefusal(422, 'field_required', `${field} is required.`);
  if (trimmed.length > max) return projectBrainRefusal(422, 'field_too_long', `${field} is longer than ${max} characters.`);
  if (CONTROL.test(trimmed)) return projectBrainRefusal(422, 'field_invalid', `${field} contains control characters.`);
  const forbidden = projectBrainForbiddenMaterial(trimmed);
  if (forbidden === 'credential') {
    return projectBrainRefusal(422, 'credential_in_content',
      `${field} looks like it contains a credential. Project Brain never stores secrets; nothing was saved.`);
  }
  if (forbidden === 'hidden_reasoning') {
    return projectBrainRefusal(422, 'hidden_reasoning_in_content',
      `${field} carries hidden-reasoning content. Project Brain stores operational statements only; nothing was saved.`);
  }
  return trimmed;
}

const isRefusal = (value: unknown): value is ProjectBrainRefusal =>
  value !== null && typeof value === 'object' && (value as { ok?: unknown }).ok === false;

function checkRef(field: string, value: unknown): string | ProjectBrainRefusal {
  if (parseProjectBrainRef(value) === null) {
    return projectBrainRefusal(422, 'ref_invalid', `${field} must be a Project Brain reference (type:id).`);
  }
  return value as string;
}

function checkVersion(value: unknown): number | ProjectBrainRefusal {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    return projectBrainRefusal(422, 'expected_version_required',
      'expectedVersion must be the record version you are changing. Changes never apply blind.');
  }
  return value;
}

/**
 * PARSE AND VALIDATE A MUTATION REQUEST. Shape only: who may do it is
 * `authorizeProjectBrainMutation`, and whether the things it names exist is the
 * store's, inside the transaction that applies it.
 */
export function parseProjectBrainMutation(input: unknown): { readonly ok: true; readonly command: ProjectBrainMutationCommand } | ProjectBrainRefusal {
  const body = asRecord(input);
  if (body === null) return projectBrainRefusal(400, 'body_invalid', 'A mutation is a JSON object.');
  if (!oneOf(['CREATE', 'REVISE', 'SET_STATUS', 'LINK'] as const, body.operation)) {
    return projectBrainRefusal(422, 'operation_invalid', 'operation must be CREATE, REVISE, SET_STATUS or LINK.');
  }
  const operation = body.operation;
  const unknown = Object.keys(body).filter((key) => !COMMAND_KEYS[operation].includes(key));
  if (unknown.length > 0) {
    // Including `author`, `provenance`, `reasoning`: the channel binds the first
    // two, and the third is never stored.
    return projectBrainRefusal(422, 'unknown_field', `Unknown field(s): ${unknown.sort().join(', ')}.`);
  }
  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(body.idempotencyKey)) {
    return projectBrainRefusal(422, 'idempotency_key_required',
      'idempotencyKey is required (8-200 of A-Z a-z 0-9 . _ : -). Send the same key to retry safely.');
  }
  const idempotencyKey = body.idempotencyKey;

  if (operation === 'CREATE') {
    if (!oneOf(PROJECT_BRAIN_RECORD_DOMAINS, body.domain)) return projectBrainRefusal(422, 'domain_invalid', 'domain is not a Project Brain record domain.');
    const scope = body.scope === undefined ? (body.runId === undefined || body.runId === null ? 'PROJECT' : 'MISSION') : body.scope;
    if (!oneOf(PROJECT_BRAIN_SCOPES, scope)) return projectBrainRefusal(422, 'scope_invalid', 'scope must be PROJECT or MISSION.');
    const runId = body.runId === undefined || body.runId === null ? null : body.runId;
    if (runId !== null && (typeof runId !== 'string' || !RUN_ID.test(runId))) return projectBrainRefusal(422, 'run_invalid', 'runId is not a run id.');
    if ((scope === 'MISSION') !== (runId !== null)) {
      return projectBrainRefusal(422, 'scope_invalid', 'A MISSION record names its run; a PROJECT record names none.');
    }
    const title = checkText('title', body.title, PROJECT_BRAIN_TITLE_MAX, true);
    if (isRefusal(title)) return title;
    if (title === null) return projectBrainRefusal(422, 'field_required', 'title is required.');
    const text = checkText('body', body.body, PROJECT_BRAIN_BODY_MAX, false);
    if (isRefusal(text)) return text;
    const rule = PROJECT_BRAIN_DOMAIN_RULES[body.domain];
    let subjectRef: string | null = null;
    if (body.subjectRef !== undefined && body.subjectRef !== null) {
      const checked = checkRef('subjectRef', body.subjectRef);
      if (isRefusal(checked)) return checked;
      subjectRef = checked;
    }
    if (rule.needsSubject && subjectRef === null) {
      return projectBrainRefusal(422, 'subject_required', `A ${body.domain} names the thing it is about (subjectRef).`);
    }
    let verdict: 'ACCEPTED' | 'DECLINED' | null = null;
    if (rule.initial === 'VERDICT') {
      if (!oneOf(['ACCEPTED', 'DECLINED'] as const, body.verdict)) {
        return projectBrainRefusal(422, 'verdict_required', 'A MEMORY_REVIEW carries verdict ACCEPTED or DECLINED.');
      }
      verdict = body.verdict;
    } else if (body.verdict !== undefined && body.verdict !== null) {
      return projectBrainRefusal(422, 'verdict_invalid', 'Only a MEMORY_REVIEW carries a verdict.');
    }
    const rawLinks = body.links === undefined || body.links === null ? [] : body.links;
    if (!Array.isArray(rawLinks) || rawLinks.length > 16) return projectBrainRefusal(422, 'links_invalid', 'links is a list of at most 16.');
    const links: { relation: ProjectBrainRelation; toRef: string }[] = [];
    for (const raw of rawLinks) {
      const link = asRecord(raw);
      if (link === null || Object.keys(link).some((key) => key !== 'relation' && key !== 'toRef')) {
        return projectBrainRefusal(422, 'links_invalid', 'Each link is exactly { relation, toRef }.');
      }
      if (!oneOf(PROJECT_BRAIN_RELATIONS, link.relation)) return projectBrainRefusal(422, 'relation_invalid', 'A link relation is not one Project Brain knows.');
      const toRef = checkRef('links[].toRef', link.toRef);
      if (isRefusal(toRef)) return toRef;
      links.push({ relation: link.relation, toRef });
    }
    return {
      ok: true,
      command: {
        operation, idempotencyKey, domain: body.domain, scope, runId, title, body: text ?? '', subjectRef, verdict, links,
      },
    };
  }

  if (operation === 'LINK') {
    const fromRef = checkRef('fromRef', body.fromRef);
    if (isRefusal(fromRef)) return fromRef;
    const toRef = checkRef('toRef', body.toRef);
    if (isRefusal(toRef)) return toRef;
    if (fromRef === toRef) return projectBrainRefusal(422, 'link_invalid', 'A link joins two different things.');
    if (!oneOf(PROJECT_BRAIN_RELATIONS, body.relation)) return projectBrainRefusal(422, 'relation_invalid', 'A link relation is not one Project Brain knows.');
    return { ok: true, command: { operation, idempotencyKey, fromRef, relation: body.relation, toRef } };
  }

  if (!isProjectBrainRecordId(body.recordId)) return projectBrainRefusal(422, 'record_invalid', 'recordId must name a Project Brain record (pbr:<uuid>).');
  const expectedVersion = checkVersion(body.expectedVersion);
  if (isRefusal(expectedVersion)) return expectedVersion;
  if (operation === 'SET_STATUS') {
    if (!oneOf(PROJECT_BRAIN_STATUSES, body.status)) return projectBrainRefusal(422, 'status_invalid', 'status is not a Project Brain status.');
    return { ok: true, command: { operation, idempotencyKey, recordId: body.recordId, expectedVersion, status: body.status } };
  }
  const title = checkText('title', body.title, PROJECT_BRAIN_TITLE_MAX, false);
  if (isRefusal(title)) return title;
  const text = checkText('body', body.body, PROJECT_BRAIN_BODY_MAX, false);
  if (isRefusal(text)) return text;
  if (title === null && text === null) return projectBrainRefusal(422, 'revision_empty', 'A revision changes the title, the body, or both.');
  if (title === '') return projectBrainRefusal(422, 'field_required', 'title cannot be emptied.');
  return { ok: true, command: { operation, idempotencyKey, recordId: body.recordId, expectedVersion, title, body: text } };
}

/* ---------------------------------------------------------- authorization */

/** The record a status move or revision is applied to, as the store holds it. */
export interface ProjectBrainRecordState {
  readonly recordId: string;
  readonly projectId: string;
  readonly domain: ProjectBrainRecordDomain;
  readonly status: ProjectBrainStatus;
  readonly version: number;
  readonly author: ProjectBrainActor;
}

/**
 * MAY THIS ACTOR DO THIS? Deterministic, from the capability set the membership
 * row grants and the record as stored. Nothing here reads the request body for
 * identity.
 */
export function authorizeProjectBrainMutation(input: {
  readonly provenance: ProjectBrainProvenance;
  readonly capabilities: readonly ProjectBrainCapability[];
  readonly command: ProjectBrainMutationCommand;
  /** The stored record, for REVISE and SET_STATUS. */
  readonly record: ProjectBrainRecordState | null;
}): { readonly ok: true; readonly nextStatus: ProjectBrainStatus | null } | ProjectBrainRefusal {
  const { provenance, capabilities, command, record } = input;
  const author = provenance.author;
  if (author.id.trim() === '' || provenance.deliverer.id.trim() === '') {
    return projectBrainRefusal(401, 'actor_required', 'A Project Brain change names who stated it and which channel carried it.');
  }
  if (`${author.kind}:${author.id}` === `${provenance.deliverer.kind}:${provenance.deliverer.id}`) {
    return projectBrainRefusal(400, 'provenance_collapsed', 'The author and the deliverer of a statement are different facts.');
  }
  const has = (capability: ProjectBrainCapability) => capabilities.includes(capability);
  // A companion writes only its own results, and only through Julius's channel.
  if (author.kind === 'COMPANION') {
    if (command.operation !== 'CREATE' || command.domain !== 'COMPANION_RESULT') {
      return projectBrainRefusal(403, 'companion_cannot_redefine_mission',
        'A companion returns results for Julius to validate. It cannot state terms, decide, adopt or govern.');
    }
    if (provenance.deliverer.kind !== 'COMPANION_CHANNEL') {
      return projectBrainRefusal(403, 'companion_channel_required', 'A companion result arrives through the companion channel.');
    }
    return { ok: true, nextStatus: 'PROPOSED' };
  }
  if (!has('brain:write')) return projectBrainRefusal(403, 'write_not_permitted', 'This membership cannot change the Project Brain.');

  if (command.operation === 'CREATE') {
    const rule = PROJECT_BRAIN_DOMAIN_RULES[command.domain];
    if (!rule.authors.includes(author.kind)) {
      return projectBrainRefusal(403, 'domain_not_authorable', `A ${author.kind} cannot state a ${command.domain}.`);
    }
    // Acknowledging an approval or a contract is a governance act: an owner's or an admin's, never a member's (founder, 10-04).
    if (command.domain === 'GOVERNANCE_ACK' && !has('brain:adopt')) {
      return projectBrainRefusal(403, 'governance_not_permitted', 'Only an owner or an admin acknowledges governance for the project.');
    }
    return { ok: true, nextStatus: rule.initial === 'VERDICT' ? command.verdict : rule.initial };
  }
  if (command.operation === 'LINK') return { ok: true, nextStatus: null };

  if (record === null) return projectBrainRefusal(404, 'record_not_found', 'No such record in this project.');
  if (command.operation === 'REVISE') {
    const rule = PROJECT_BRAIN_DOMAIN_RULES[record.domain];
    if (!rule.revisable.includes(record.status)) {
      return projectBrainRefusal(409, 'record_not_revisable',
        `A ${record.domain} in status ${record.status} is not revised in place; state a new one that supersedes it.`);
    }
    const isAuthor = record.author.kind === author.kind && record.author.id === author.id;
    if (!isAuthor && !has('brain:adopt')) {
      return projectBrainRefusal(403, 'not_the_author', 'Only the author, or a project owner, revises a statement.');
    }
    return { ok: true, nextStatus: record.status };
  }
  const needs = projectBrainStatusMove(record.status, command.status);
  if (needs === null) {
    return projectBrainRefusal(409, 'status_move_invalid', `A record in ${record.status} cannot move to ${command.status}.`);
  }
  if (needs === 'author') {
    const isAuthor = record.author.kind === author.kind && record.author.id === author.id;
    if (!isAuthor && !has('brain:adopt')) {
      return projectBrainRefusal(403, 'not_the_author', 'Only the author, or a project owner, withdraws a statement.');
    }
  } else if (!has(needs)) {
    return projectBrainRefusal(403, 'capability_missing', `Moving ${record.status} to ${command.status} needs ${needs}.`);
  }
  return { ok: true, nextStatus: command.status };
}

/* ----------------------------------------------------------------- hashes */

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
};

/** Key-sorted JSON: the same value always reads as the same string. Hashing it is the store's business. */
export const projectBrainCanonicalJson = (value: unknown): string => canonical(value);

/**
 * THE REQUEST'S IDENTITY FOR IDEMPOTENCY: the command, who sent it and where. A
 * replay of the same key with the same identity is answered from the log; the
 * same key with a different identity is a conflict, never a second write. The
 * store keeps a SHA-256 of this string, never the string.
 */
export const projectBrainRequestIdentity = (projectId: string, provenance: ProjectBrainProvenance, command: ProjectBrainMutationCommand): string =>
  canonical({ projectId, provenance, command });

/** What a record version says, canonically: the content its hash is taken over. */
export const projectBrainContentIdentity = (input: { domain: string; title: string; body: string; subjectRef: string | null; status: string }): string =>
  canonical(input);

/* ----------------------------------------------------------------- events */

/**
 * THE LIVE EVENT NAMES. Every durable change to the Project Brain -- a person's
 * statement or one of Julius's own ledger events -- is announced under one
 * vocabulary, carrying references, never the content.
 */
export const PROJECT_BRAIN_EVENT_TYPES = [
  'project_brain.record.created', 'project_brain.record.revised', 'project_brain.record.status_changed', 'project_brain.link.created',
  'project_brain.mission.created', 'project_brain.mission.state_changed',
  'project_brain.finding.created', 'project_brain.evidence.recorded', 'project_brain.decision.recorded', 'project_brain.repair.started',
  'project_brain.eval.recorded', 'project_brain.trace.recorded', 'project_brain.handoff.recorded', 'project_brain.governance.updated',
  'project_brain.provenance.updated', 'project_brain.activity.recorded',
  // The C.A.R.D., Mission Handoff and eval components (project-brain-components.ts, migration 034).
  'project_brain.card.created', 'project_brain.card.updated', 'project_brain.card.deleted', 'project_brain.card.selected',
  'project_brain.mission.card_pinned', 'project_brain.handoff.entered', 'project_brain.handoff.returned', 'project_brain.eval.invalidated',
  // Membership (project-brain-members.ts): who may use this project's Brain.
  'project_brain.member.set', 'project_brain.member.removed',
] as const;
export type ProjectBrainEventType = (typeof PROJECT_BRAIN_EVENT_TYPES)[number];

export const projectBrainMutationEventType = (operation: ProjectBrainOperation): ProjectBrainEventType => ({
  CREATE: 'project_brain.record.created',
  REVISE: 'project_brain.record.revised',
  SET_STATUS: 'project_brain.record.status_changed',
  LINK: 'project_brain.link.created',
} as const)[operation];

/**
 * JULIUS'S LEDGER, IN THE PROJECT BRAIN'S WORDS. Julius's events are written by
 * Julius into the same durable log; this only names them for a Project Brain
 * reader. Unknown types are activity -- never dropped, never invented.
 */
export function projectBrainEventTypeForJulius(juliusType: string): ProjectBrainEventType {
  const type = juliusType.startsWith('julius.') ? juliusType.slice('julius.'.length) : juliusType;
  if (type === 'run.created') return 'project_brain.mission.created';
  if (type.startsWith('run.')) return 'project_brain.mission.state_changed';
  if (type === 'finding.recorded') return 'project_brain.finding.created';
  if (type === 'evidence.recorded') return 'project_brain.evidence.recorded';
  if (type === 'verification.decided') return 'project_brain.decision.recorded';
  if (type === 'repair.scheduled') return 'project_brain.repair.started';
  if (type === 'checkpoint.verdict' || type === 'review.started') return 'project_brain.eval.recorded';
  if (type === 'context.compiled' || type.startsWith('worker.') || type.startsWith('provider.') || type.endsWith('.selected') || type === 'retry.scheduled') {
    return 'project_brain.trace.recorded';
  }
  if (type.startsWith('guidance.') || type === 'checkpoint.recorded') return 'project_brain.handoff.recorded';
  if (type.startsWith('contract.') || type.startsWith('approval.') || type.startsWith('budget.')) return 'project_brain.governance.updated';
  if (type.startsWith('claim.')) return 'project_brain.provenance.updated';
  return 'project_brain.activity.recorded';
}

/* ----------------------------------------------------------------- cursor */

/**
 * WHERE A READER IS IN THE LOG. The durable log orders events PER STREAM (one per
 * run, one for the project's own statements), and within a stream a sequence is
 * allocated under a row lock, so it commits in order and has no gaps. A cursor is
 * therefore one high-water mark per stream: replaying from it is exactly-once
 * with no clock comparisons anywhere. Opaque to clients.
 */
export type ProjectBrainCursor = Readonly<Record<string, number>>;

const STREAM_ID = /^[\x21-\x7e]{1,200}$/u;
export const PROJECT_BRAIN_CURSOR_MAX_STREAMS = 2000;

/**
 * BASE64URL OVER ASCII, with the platform's own btoa/atob -- no Node in the domain. A cursor is JSON of stream ids
 * (printable ASCII, validated on decode) and integers, so Latin-1 is all it ever needs.
 */
const toBase64Url = (ascii: string): string => btoa(ascii).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
const fromBase64Url = (encoded: string): string => {
  if (!/^[A-Za-z0-9_-]*$/u.test(encoded)) throw new Error('cursor_not_base64url');
  const padded = encoded.replace(/-/gu, '+').replace(/_/gu, '/') + '='.repeat((4 - (encoded.length % 4)) % 4);
  return atob(padded);
};

export function encodeProjectBrainCursor(cursor: ProjectBrainCursor): string {
  const ordered = Object.fromEntries(Object.entries(cursor).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `pbc1.${toBase64Url(JSON.stringify(ordered))}`;
}

export function decodeProjectBrainCursor(value: unknown): ProjectBrainCursor | null {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value !== 'string' || !value.startsWith('pbc1.') || value.length > 200_000) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value.slice(5)));
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null) return null;
  const entries = Object.entries(record);
  if (entries.length > PROJECT_BRAIN_CURSOR_MAX_STREAMS) return null;
  const out: Record<string, number> = {};
  for (const [stream, sequence] of entries) {
    if (!STREAM_ID.test(stream) || typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) return null;
    out[stream] = sequence;
  }
  return out;
}

export function advanceProjectBrainCursor(cursor: ProjectBrainCursor, streamId: string, sequence: number): ProjectBrainCursor {
  return (cursor[streamId] ?? 0) >= sequence ? cursor : { ...cursor, [streamId]: sequence };
}

export const projectBrainStreamId = (projectId: string): string => `project-brain:${projectId}`;
