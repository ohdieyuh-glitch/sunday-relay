import type { JuliusBrainDraft, JuliusBrainPrincipal, JuliusBrainRecordKind, JuliusBrainScope, JuliusBrainSection } from './julius-brain-contracts';
import { JULIUS_BRAIN_KIND_SECTION, JULIUS_BRAIN_RECORD_KINDS } from './julius-brain-contracts';

/**
 * WHO MAY WRITE WHAT INTO THE PROJECT BRAIN.
 *
 * The Brain is shared memory, and shared memory without authority is a place
 * where the last writer wins. Every rule here answers one question — may this
 * principal make this change — and every refusal is a stable reason code, so a
 * worker that was refused can be told why and an audit can count it.
 *
 * THE SHAPE OF THE AUTHORITY, in one paragraph. Julius holds mission truth. A
 * user holds what a user may configure. The Prompt Architect records
 * architecture, research, assumptions and open questions, and may PROPOSE
 * requirements but not adopt them. The Coding Agent records what it did —
 * evidence, artifacts, blockers, implementation decisions, repair progress.
 * The Independent Reviewer records findings, review evidence and evals, and may
 * mark evidence verified or refuted, but can never retire, supersede or revise
 * mission truth. A tool (Python) and a future evaluation environment write only
 * observation-class records, only under a grant, only UNVERIFIED, and never a
 * blocking finding — a tool observes, Julius decides.
 *
 * WHAT THE BRAIN CONTAINS IS LARGER THAN WHAT A USER CAN EDIT.
 * `editability` is the contract for the future Brain UI: SYSTEM_OWNED kinds are
 * shown, never edited, however much they exist.
 */

export type JuliusBrainPrincipalClass =
  | 'JULIUS' | 'USER' | 'PROMPT_ARCHITECT' | 'CODING_AGENT' | 'INDEPENDENT_REVIEWER' | 'SPECIALIST'
  | 'TOOL' | 'ENVIRONMENT' | 'SYSTEM';

export function juliusBrainPrincipalClass(principal: JuliusBrainPrincipal): JuliusBrainPrincipalClass {
  if (principal.kind !== 'WORKER') return principal.kind;
  if (principal.role === 'PROMPT_ARCHITECT' || principal.role === 'CODING_AGENT' || principal.role === 'INDEPENDENT_REVIEWER') return principal.role;
  return 'SPECIALIST';
}

export type JuliusBrainEditability = 'USER_EDITABLE' | 'SYSTEM_OWNED';

/** Fields a class may change when revising an entity it did not create. `'*'` is every field. */
type ReviseFields = Partial<Record<JuliusBrainPrincipalClass, readonly string[] | '*'>>;

export interface JuliusBrainKindPolicy {
  readonly kind: JuliusBrainRecordKind;
  readonly section: JuliusBrainSection;
  readonly editability: JuliusBrainEditability;
  readonly create: readonly JuliusBrainPrincipalClass[];
  /** Revision of ANY entity of the kind, field-restricted. Creators may always revise their own. */
  readonly revise: ReviseFields;
  /** Retirement and supersession. Mission authority only, by construction. */
  readonly retire: readonly JuliusBrainPrincipalClass[];
  /**
   * Whether the creator may revise its own entity freely. False for
   * observation-class records: a producer that could rewrite its own evidence
   * after the fact would make the evidence a draft.
   */
  readonly ownerRevise: boolean;
}

const AUTHORITY: readonly JuliusBrainPrincipalClass[] = ['JULIUS', 'USER'];
const JULIUS_ONLY: readonly JuliusBrainPrincipalClass[] = ['JULIUS'];
const WORKERS: readonly JuliusBrainPrincipalClass[] = ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER', 'SPECIALIST'];

/** Kinds a TOOL or ENVIRONMENT may ever create, whatever its grant says. */
export const JULIUS_BRAIN_OBSERVATION_KINDS: readonly JuliusBrainRecordKind[] = Object.freeze(['EVIDENCE', 'EVAL', 'FINDING', 'ARTIFACT', 'TRACE', 'MEMORY_FACT']);

const IMMUTABLE_TO_OWNER: readonly JuliusBrainRecordKind[] = ['EVIDENCE', 'EVAL', 'ARTIFACT', 'HANDOFF', 'TRACE', 'PYTHON_EXECUTION', 'CHECKPOINT'];

const policy = (kind: JuliusBrainRecordKind, editability: JuliusBrainEditability, create: readonly JuliusBrainPrincipalClass[], revise: ReviseFields, retire: readonly JuliusBrainPrincipalClass[]): JuliusBrainKindPolicy =>
  Object.freeze({ kind, section: JULIUS_BRAIN_KIND_SECTION[kind], editability, create, revise: Object.freeze(revise), retire, ownerRevise: !IMMUTABLE_TO_OWNER.includes(kind) });

export const JULIUS_BRAIN_KIND_POLICIES: Readonly<Record<JuliusBrainRecordKind, JuliusBrainKindPolicy>> = Object.freeze({
  MISSION: policy('MISSION', 'USER_EDITABLE', JULIUS_ONLY, { JULIUS: '*', USER: ['title'] }, JULIUS_ONLY),
  OBJECTIVE: policy('OBJECTIVE', 'USER_EDITABLE', AUTHORITY, { JULIUS: '*', USER: '*' }, AUTHORITY),
  MISSION_STATE: policy('MISSION_STATE', 'SYSTEM_OWNED', JULIUS_ONLY, { JULIUS: '*' }, JULIUS_ONLY),
  REQUIREMENT: policy('REQUIREMENT', 'USER_EDITABLE', [...AUTHORITY, 'PROMPT_ARCHITECT'], { JULIUS: '*', USER: '*' }, AUTHORITY),
  ACCEPTANCE_CRITERION: policy('ACCEPTANCE_CRITERION', 'USER_EDITABLE', [...AUTHORITY, 'PROMPT_ARCHITECT'], { JULIUS: '*', USER: '*' }, AUTHORITY),
  CONSTRAINT: policy('CONSTRAINT', 'USER_EDITABLE', [...AUTHORITY, 'PROMPT_ARCHITECT'], { JULIUS: '*', USER: '*' }, AUTHORITY),
  PROHIBITION: policy('PROHIBITION', 'USER_EDITABLE', [...AUTHORITY, 'PROMPT_ARCHITECT'], { JULIUS: '*', USER: '*' }, AUTHORITY),
  ASSUMPTION: policy('ASSUMPTION', 'USER_EDITABLE', [...AUTHORITY, 'PROMPT_ARCHITECT', 'CODING_AGENT'], { JULIUS: '*', USER: '*' }, AUTHORITY),
  OPEN_QUESTION: policy('OPEN_QUESTION', 'USER_EDITABLE', [...AUTHORITY, ...WORKERS], { JULIUS: '*', USER: '*', PROMPT_ARCHITECT: ['answer', 'status'] }, AUTHORITY),
  ARCHITECTURE_COMPONENT: policy('ARCHITECTURE_COMPONENT', 'USER_EDITABLE', [...AUTHORITY, 'PROMPT_ARCHITECT'], { JULIUS: '*', USER: '*', PROMPT_ARCHITECT: '*' }, AUTHORITY),
  ARCHITECTURE_INTERFACE: policy('ARCHITECTURE_INTERFACE', 'USER_EDITABLE', [...AUTHORITY, 'PROMPT_ARCHITECT'], { JULIUS: '*', USER: '*', PROMPT_ARCHITECT: '*' }, AUTHORITY),
  DECISION: policy('DECISION', 'USER_EDITABLE', [...AUTHORITY, 'PROMPT_ARCHITECT', 'CODING_AGENT'], { JULIUS: '*', USER: '*' }, AUTHORITY),
  RESEARCH: policy('RESEARCH', 'SYSTEM_OWNED', ['JULIUS', ...WORKERS], { JULIUS: '*' }, JULIUS_ONLY),
  EVIDENCE: policy('EVIDENCE', 'SYSTEM_OWNED', ['JULIUS', ...WORKERS, 'TOOL', 'ENVIRONMENT'], { JULIUS: ['verification'], INDEPENDENT_REVIEWER: ['verification'] }, JULIUS_ONLY),
  EVAL: policy('EVAL', 'SYSTEM_OWNED', ['JULIUS', 'INDEPENDENT_REVIEWER', 'SPECIALIST', 'TOOL', 'ENVIRONMENT'], {}, JULIUS_ONLY),
  FINDING: policy('FINDING', 'SYSTEM_OWNED', ['JULIUS', 'INDEPENDENT_REVIEWER', 'SPECIALIST', 'TOOL', 'ENVIRONMENT'], { JULIUS: ['status', 'blocking', 'severity'] }, JULIUS_ONLY),
  REPAIR: policy('REPAIR', 'SYSTEM_OWNED', JULIUS_ONLY, {
    JULIUS: '*', CODING_AGENT: ['implementation', 'status'], INDEPENDENT_REVIEWER: ['reviewerDisposition', 'verification'],
  }, JULIUS_ONLY),
  HANDOFF: policy('HANDOFF', 'SYSTEM_OWNED', ['JULIUS', ...WORKERS], {}, JULIUS_ONLY),
  ARTIFACT: policy('ARTIFACT', 'SYSTEM_OWNED', ['JULIUS', ...WORKERS, 'TOOL', 'ENVIRONMENT'], {}, JULIUS_ONLY),
  MEMORY_FACT: policy('MEMORY_FACT', 'USER_EDITABLE', [...AUTHORITY, ...WORKERS, 'TOOL'], { JULIUS: '*', USER: '*' }, AUTHORITY),
  TRACE: policy('TRACE', 'SYSTEM_OWNED', ['JULIUS', ...WORKERS, 'TOOL', 'ENVIRONMENT', 'SYSTEM'], {}, []),
  PYTHON_EXECUTION: policy('PYTHON_EXECUTION', 'SYSTEM_OWNED', JULIUS_ONLY, {}, []),
  CHECKPOINT: policy('CHECKPOINT', 'SYSTEM_OWNED', ['JULIUS', 'SYSTEM'], {}, []),
});

/**
 * A WRITE GRANT for a TOOL or ENVIRONMENT principal. Issued by Julius for one
 * execution; it bounds the kinds, the mission and task, the count and the
 * lifetime. A grant cannot widen the observation kinds — those are a ceiling.
 */
export interface JuliusBrainWriteGrant {
  readonly grantId: string;
  readonly brainId: string;
  readonly principalId: string;
  readonly issuedBy: string;
  readonly kinds: readonly JuliusBrainRecordKind[];
  readonly missionId: string | null;
  readonly taskId: string | null;
  readonly maxRecords: number;
  readonly expiresAt: string;
}

/**
 * A READ GRANT: which slice of the Brain a principal may see. Used for scoped
 * Python context and for evaluation-context snapshots a future GVE consumes.
 */
export interface JuliusBrainReadGrant {
  readonly grantId: string;
  readonly brainId: string;
  readonly kinds: readonly JuliusBrainRecordKind[];
  /** null: every mission. */
  readonly missionIds: readonly string[] | null;
  /** null: every task within the missions. */
  readonly taskIds: readonly string[] | null;
  readonly includeHistory: boolean;
  readonly includeRestricted: boolean;
}

export const JULIUS_BRAIN_ALL_KINDS: readonly JuliusBrainRecordKind[] = JULIUS_BRAIN_RECORD_KINDS;

export type JuliusBrainAuthorization =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reasonCode: string; readonly detail: string };

const deny = (reasonCode: string, detail: string): JuliusBrainAuthorization => ({ allowed: false, reasonCode, detail });
const ALLOW: JuliusBrainAuthorization = Object.freeze({ allowed: true });

/** The prior state of an entity, as much of it as authorisation needs. */
export interface JuliusBrainAuthorizationSubject {
  readonly kind: JuliusBrainRecordKind;
  readonly createdBy: JuliusBrainPrincipal;
  readonly body: Readonly<Record<string, unknown>>;
}

const sameAuthor = (a: JuliusBrainPrincipal, b: JuliusBrainPrincipal): boolean =>
  a.kind === b.kind && a.id === b.id && a.role === b.role;

const changedFields = (before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));

function withinScope(grant: { missionId: string | null; taskId: string | null }, scope: JuliusBrainScope): boolean {
  if (grant.missionId !== null && scope.missionId !== grant.missionId) return false;
  if (grant.taskId !== null && scope.taskId !== grant.taskId) return false;
  return true;
}

/**
 * MAY THIS PRINCIPAL MAKE THIS CHANGE.
 *
 * `subject` is the current entity (null for CREATE). `supersedes` is the
 * current state of every entity the draft SUPERSEDES. `grant` is required for
 * TOOL and ENVIRONMENT principals and ignored for everyone else.
 */
export function authorizeJuliusBrainWrite(input: {
  readonly principal: JuliusBrainPrincipal;
  readonly draft: JuliusBrainDraft;
  readonly subject: JuliusBrainAuthorizationSubject | null;
  readonly supersedes: readonly JuliusBrainAuthorizationSubject[];
  readonly grant: JuliusBrainWriteGrant | null;
  readonly now: string;
}): JuliusBrainAuthorization {
  const { principal, draft, subject } = input;
  const actor = juliusBrainPrincipalClass(principal);
  const kindPolicy = JULIUS_BRAIN_KIND_POLICIES[draft.kind];

  if (actor === 'TOOL' || actor === 'ENVIRONMENT') {
    const grant = input.grant;
    if (grant === null || grant.grantId !== principal.grantId || grant.principalId !== principal.id) return deny('grant_required', 'A tool or environment writes only under its own grant.');
    if (Date.parse(grant.expiresAt) <= Date.parse(input.now)) return deny('grant_expired', 'The write grant has expired.');
    if (!JULIUS_BRAIN_OBSERVATION_KINDS.includes(draft.kind) || !grant.kinds.includes(draft.kind)) return deny('grant_kind_not_permitted', `The grant does not permit ${draft.kind}.`);
    if (!withinScope(grant, draft.scope)) return deny('grant_scope_mismatch', 'The record is outside the grant\'s mission or task.');
    if (draft.op !== 'CREATE') return deny('observation_is_append_only', 'A tool creates observations; it never revises or retires.');
    if (draft.links.some((link) => link.relation === 'SUPERSEDES')) return deny('observation_cannot_supersede', 'A tool cannot supersede.');
    if (draft.kind === 'FINDING' && draft.body.blocking !== false) return deny('tool_cannot_declare_blocking', 'Whether a finding blocks is Julius\'s decision.');
    if (draft.kind === 'EVIDENCE' && draft.body.verification !== 'UNVERIFIED') return deny('tool_cannot_verify', 'Tool evidence is admitted UNVERIFIED.');
    if (draft.kind === 'MEMORY_FACT' && draft.body.trust !== 'UNVERIFIED') return deny('auto_trust_refused', 'Generated memory is admitted UNVERIFIED.');
  }

  if (actor === 'SYSTEM' && draft.kind !== 'TRACE' && draft.kind !== 'CHECKPOINT') {
    return deny('system_principal_restricted', 'SYSTEM writes only traces and checkpoints; restore uses the import path.');
  }

  switch (draft.op) {
    case 'CREATE': {
      if (!kindPolicy.create.includes(actor)) return deny('kind_not_writable_by_principal', `${actor} may not create ${draft.kind}.`);
      const body = draft.body;
      // PROPOSAL-ONLY WRITERS. The Architect shapes requirements; Julius or a
      // user adopts them.
      if (actor === 'PROMPT_ARCHITECT' && ['REQUIREMENT', 'ACCEPTANCE_CRITERION', 'CONSTRAINT', 'PROHIBITION'].includes(draft.kind) && body.status !== 'PROPOSED') {
        return deny('proposal_only', `The Prompt Architect may only propose a ${draft.kind}.`);
      }
      if (draft.kind === 'DECISION') {
        const allowedClass: Partial<Record<JuliusBrainPrincipalClass, string>> = { PROMPT_ARCHITECT: 'ARCHITECTURE', CODING_AGENT: 'IMPLEMENTATION' };
        const required = allowedClass[actor];
        if (required !== undefined && body.decisionClass !== required) return deny('decision_class_not_permitted', `${actor} records ${required} decisions only.`);
      }
      if (draft.kind === 'MEMORY_FACT' && !['JULIUS', 'USER'].includes(actor) && body.trust !== 'UNVERIFIED') {
        return deny('auto_trust_refused', 'Generated memory is admitted UNVERIFIED.');
      }
      if (draft.kind === 'MEMORY_FACT' && ['VERIFIED', 'APPROVED'].includes(String(body.trust))
        && !draft.links.some((link) => link.relation === 'EVIDENCED_BY' || link.relation === 'SUPPORTS')) {
        return deny('trust_requires_evidence', 'A verified or approved memory must cite what verified it.');
      }
      if (draft.kind === 'EVIDENCE' && body.verification !== 'UNVERIFIED' && !['JULIUS', 'INDEPENDENT_REVIEWER'].includes(actor)) {
        return deny('self_verification_refused', 'Evidence is verified by the reviewer or Julius, never by its producer.');
      }
      break;
    }
    case 'REVISE': {
      if (subject === null) return deny('entity_not_found', 'There is nothing to revise.');
      const fields = changedFields(subject.body, draft.body);
      const own = kindPolicy.ownerRevise && sameAuthor(subject.createdBy, principal) && kindPolicy.create.includes(actor);
      const grantFields = kindPolicy.revise[actor];
      const permitted = own || grantFields === '*' || (Array.isArray(grantFields) && fields.every((field) => grantFields.includes(field)));
      if (!permitted) return deny('revision_not_permitted', `${actor} may not change ${fields.join(', ') || 'this'} on ${draft.kind}.`);
      if (draft.kind === 'MEMORY_FACT' && fields.includes('trust') && !['JULIUS', 'USER'].includes(actor)) return deny('auto_trust_refused', 'Only mission authority changes a memory\'s trust.');
      if (draft.kind === 'MEMORY_FACT' && ['VERIFIED', 'APPROVED'].includes(String(draft.body.trust))
        && !draft.links.some((link) => link.relation === 'EVIDENCED_BY' || link.relation === 'SUPPORTS')) {
        return deny('trust_requires_evidence', 'A verified or approved memory must cite what verified it.');
      }
      if (draft.kind === 'EVIDENCE' && fields.includes('verification') && sameAuthor(subject.createdBy, principal)) {
        return deny('self_verification_refused', 'Evidence is never verified by its own producer.');
      }
      if (actor === 'PROMPT_ARCHITECT' && ['REQUIREMENT', 'ACCEPTANCE_CRITERION', 'CONSTRAINT', 'PROHIBITION'].includes(draft.kind) && draft.body.status !== 'PROPOSED') {
        return deny('proposal_only', `The Prompt Architect may only propose a ${draft.kind}.`);
      }
      if (actor === 'USER' && kindPolicy.editability !== 'USER_EDITABLE') return deny('system_owned', `${draft.kind} is system-owned.`);
      break;
    }
    case 'RETIRE': {
      if (subject === null) return deny('entity_not_found', 'There is nothing to retire.');
      if (!kindPolicy.retire.includes(actor)) return deny('retirement_not_permitted', `${actor} may not retire ${draft.kind}.`);
      if (actor === 'USER' && kindPolicy.editability !== 'USER_EDITABLE') return deny('system_owned', `${draft.kind} is system-owned.`);
      break;
    }
  }

  for (const target of input.supersedes) {
    const targetPolicy = JULIUS_BRAIN_KIND_POLICIES[target.kind];
    if (!targetPolicy.retire.includes(actor)) return deny('supersession_not_permitted', `${actor} may not supersede ${target.kind}.`);
    if (actor === 'USER' && targetPolicy.editability !== 'USER_EDITABLE') return deny('system_owned', `${target.kind} is system-owned.`);
  }
  return ALLOW;
}

/** May this principal read an entity with this kind, scope and sensitivity. */
export function juliusBrainReadable(input: {
  readonly grant: JuliusBrainReadGrant;
  readonly kind: JuliusBrainRecordKind;
  readonly scope: JuliusBrainScope;
  readonly sensitivity: 'PUBLIC' | 'INTERNAL' | 'RESTRICTED';
}): boolean {
  const { grant } = input;
  if (!grant.kinds.includes(input.kind)) return false;
  if (input.sensitivity === 'RESTRICTED' && !grant.includeRestricted) return false;
  // Brain-level knowledge (no mission) is visible to every mission grant:
  // a project constraint binds every mission that uses the Brain.
  if (grant.missionIds !== null && input.scope.missionId !== null && !grant.missionIds.includes(input.scope.missionId)) return false;
  if (grant.taskIds !== null && input.scope.taskId !== null && !grant.taskIds.includes(input.scope.taskId)) return false;
  return true;
}

/** The editable-surface contract for a future Brain UI. */
export function juliusBrainEditableSurface(): readonly { kind: JuliusBrainRecordKind; section: JuliusBrainSection; editability: JuliusBrainEditability; userRevisableFields: readonly string[] | '*' | null }[] {
  return JULIUS_BRAIN_RECORD_KINDS.map((kind) => {
    const kindPolicy = JULIUS_BRAIN_KIND_POLICIES[kind];
    return {
      kind, section: kindPolicy.section, editability: kindPolicy.editability,
      userRevisableFields: kindPolicy.editability === 'USER_EDITABLE' ? (kindPolicy.revise.USER ?? null) : null,
    };
  });
}
