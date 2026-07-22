import { fail, ok, relayError, type RelayResult } from '../protocol/errors';
import type { Provenance } from '../protocol/enums';
import type { MissionSpec, RelayMissionContract, MissionStatus } from './contracts';

/**
 * Mission Contract projection + validation (Prompt 8.1) — PURE. Builds the
 * serializable RelayMissionContract from authored inputs plus canonical
 * context (projectId, provenance). Validation is deterministic; secret and
 * hidden-reasoning shapes are rejected. Binding fields feed a stable digest
 * so a binding revision stales downstream handoffs while a display-only
 * change does not.
 */

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{8,}/, /AKIA[0-9A-Z]{12,}/, /BEGIN [A-Z ]*PRIVATE KEY/,
  /gh[pousr]_[A-Za-z0-9]{20,}/, /\b(?:api[-_]?key|secret|password|token)\s*[:=]\s*\S{8,}/i,
];
const HIDDEN_REASONING = /\b(chain[_ ]?of[_ ]?thought|internal[_ ]?monologue|scratchpad|hidden[_ ]?reasoning)\b/i;

const containsSecret = (text: string): boolean => SECRET_PATTERNS.some((p) => p.test(text));

/** Order-independent, stable digest of a value (deterministic across runs). */
export function stableDigest(value: unknown): string {
  const canonical = canonicalize(value);
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < canonical.length; i++) {
    const c = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul((h2 + c) ^ (c << 3), 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(',')}}`;
}

/** BINDING fields only — requirements, constraints, scope, acceptance
 * criteria, required reviewers, evidence rules, completion rule. Display
 * fields (title, assumptions, decisions, unresolvedQuestions) are excluded
 * so a display change never stales handoffs. */
export function bindingFields(spec: Pick<RelayMissionContract, 'requirements' | 'constraints' | 'acceptanceCriteria' | 'filesInScope' | 'filesOutOfScope' | 'systemsInScope' | 'systemsOutOfScope' | 'requiredEvidence' | 'requiredReviewers' | 'implementerRequirement' | 'reviewerRequirement' | 'completionRule' | 'maximumRepairIterations' | 'maximumReviewRuns'>): Record<string, unknown> {
  return {
    requirements: [...spec.requirements].sort(),
    constraints: [...spec.constraints].sort(),
    acceptanceCriteria: [...spec.acceptanceCriteria].map((c) => ({ id: c.id, blocking: c.blocking })).sort((a, b) => a.id.localeCompare(b.id)),
    filesInScope: [...spec.filesInScope].sort(),
    filesOutOfScope: [...spec.filesOutOfScope].sort(),
    systemsInScope: [...spec.systemsInScope].sort(),
    systemsOutOfScope: [...spec.systemsOutOfScope].sort(),
    requiredEvidence: [...spec.requiredEvidence].sort(),
    requiredReviewers: [...spec.requiredReviewers].sort(),
    implementerRequirement: spec.implementerRequirement,
    reviewerRequirement: spec.reviewerRequirement,
    completionRule: spec.completionRule,
    maximumRepairIterations: spec.maximumRepairIterations,
    maximumReviewRuns: spec.maximumReviewRuns,
  };
}

export function validateMissionSpec(spec: MissionSpec): string[] {
  const errors: string[] = [];
  if (!spec.objective || spec.objective.trim() === '') errors.push('objective is required.');
  if (spec.requirements.length < 1) errors.push('at least one requirement is required.');
  if (!spec.acceptanceCriteria.some((c) => c.blocking)) errors.push('at least one blocking acceptance criterion is required.');
  if (spec.filesOutOfScope.length === 0 && spec.systemsOutOfScope.length === 0) {
    errors.push('explicit files or systems out of scope are required.');
  }
  if (!spec.completionRule) errors.push('completion rule is required.');
  if (spec.completionRule === 'all_blocking_criteria_and_independent_review' && spec.requiredReviewers.length === 0) {
    errors.push('a completion rule requiring independent review must name required reviewers.');
  }
  if (!spec.implementerRequirement || spec.implementerRequirement.trim() === '') errors.push('an implementer requirement (role) is required.');
  if (spec.maximumRepairIterations < 0) errors.push('maximumRepairIterations must be non-negative.');

  const allText = [
    spec.title, spec.objective, ...spec.requirements, ...spec.constraints,
    ...spec.acceptanceCriteria.map((c) => c.text), ...spec.assumptions, ...spec.decisions,
    ...spec.unresolvedQuestions, ...spec.requiredEvidence,
  ];
  for (const text of allText) {
    if (typeof text === 'string') {
      if (containsSecret(text)) { errors.push('mission text contains a secret-shaped value.'); break; }
    }
  }
  for (const text of allText) {
    if (typeof text === 'string' && HIDDEN_REASONING.test(text)) { errors.push('mission text contains hidden-reasoning content.'); break; }
  }
  return errors;
}

export interface BuildMissionInput {
  spec: MissionSpec;
  missionId: string;
  projectId: string;
  now: string;
  provenance: Provenance;
  /** For a projected revision > 1, supply the prior revision + updatedBy. */
  revision?: number;
  updatedBy?: string;
  status?: MissionStatus;
}

export function buildMissionContract(input: BuildMissionInput): RelayResult<RelayMissionContract> {
  const errors = validateMissionSpec(input.spec);
  if (input.revision !== undefined && input.revision < 1) errors.push('mission revision must be positive.');
  if (errors.length > 0) {
    return fail(relayError('validation-failed', 'Mission contract failed validation.', { details: errors }));
  }
  const s = input.spec;
  const contract: RelayMissionContract = {
    missionId: input.missionId,
    projectId: input.projectId,
    title: s.title,
    objective: s.objective,
    requirements: [...s.requirements],
    constraints: [...s.constraints],
    acceptanceCriteria: s.acceptanceCriteria.map((c) => ({ ...c })),
    filesInScope: [...s.filesInScope],
    filesOutOfScope: [...s.filesOutOfScope],
    systemsInScope: [...s.systemsInScope],
    systemsOutOfScope: [...s.systemsOutOfScope],
    assumptions: [...s.assumptions],
    decisions: [...s.decisions],
    unresolvedQuestions: [...s.unresolvedQuestions],
    requiredEvidence: [...s.requiredEvidence],
    requiredReviewers: [...s.requiredReviewers],
    implementerRequirement: s.implementerRequirement,
    reviewerRequirement: s.reviewerRequirement,
    maximumRepairIterations: s.maximumRepairIterations,
    maximumReviewRuns: s.maximumReviewRuns,
    maximumCostUsd: s.maximumCostUsd,
    maximumRuntimeMinutes: s.maximumRuntimeMinutes,
    completionRule: s.completionRule,
    status: input.status ?? 'locked',
    revision: input.revision ?? 1,
    bindingDigest: '',
    createdAt: input.now,
    updatedAt: input.now,
    createdBy: s.createdBy,
    updatedBy: input.updatedBy ?? s.createdBy,
    provenance: input.provenance,
  };
  contract.bindingDigest = stableDigest(bindingFields(contract));
  return ok(contract);
}

/** Would a change to `next` binding fields require a revision bump vs
 * `prior`? True when the binding digests differ. */
export function isBindingChange(prior: RelayMissionContract, nextSpec: MissionSpec, ctx: { missionId: string; projectId: string; now: string; provenance: Provenance }): boolean {
  const built = buildMissionContract({ spec: nextSpec, ...ctx });
  if (!built.ok) return true; // an invalid change is treated as binding (rejected upstream)
  return built.value.bindingDigest !== prior.bindingDigest;
}

/** A handoff pinned to `pinnedDigest` is stale iff the current mission's
 * binding digest differs — a stale handoff cannot launch. */
export function handoffIsStale(mission: RelayMissionContract, pinnedBindingDigest: string): boolean {
  return mission.bindingDigest !== pinnedBindingDigest;
}
