import type {
  AgentOption,
  ProjectSettingsDraft,
  SettingsValidation,
  SettingsWarning,
} from './contracts';
import { SELECTABLE_AVAILABILITY } from './options';

/**
 * Deterministic Project Settings validation — pure display logic. The UI
 * explains conflicts (it never silently makes policy decisions) and START
 * PROJECT stays disabled while blockers exist. The real policy authority is
 * Relay Core, later.
 */

const findAgent = (options: AgentOption[], id: string | null): AgentOption | null =>
  id ? options.find((o) => o.id === id) ?? null : null;

/** Independence: explicit independentFrom wins; otherwise provider equality. */
export function reviewerIndependentFromCodingAgent(
  reviewer: AgentOption | null,
  codingAgent: AgentOption | null,
): boolean {
  if (!reviewer || !codingAgent) return true;
  if (reviewer.id === 'reviewer-none') return true;
  // Explicit independence list wins; otherwise same-provider pairs are dependent.
  if (reviewer.independentFrom) return reviewer.independentFrom.includes(codingAgent.id);
  return reviewer.provider !== codingAgent.provider;
}

export function validateSettingsDraft(
  draft: ProjectSettingsDraft,
  agentOptions: AgentOption[],
): SettingsValidation {
  const blockers: SettingsWarning[] = [];
  const warnings: SettingsWarning[] = [];

  const architect = findAgent(agentOptions, draft.workforce.promptArchitectId);
  const coding = findAgent(agentOptions, draft.workforce.codingAgentId);
  const reviewer = findAgent(agentOptions, draft.workforce.reviewerId);

  if (!architect) blockers.push({ id: 'architect-missing', message: 'Choose a Prompt Architect.' });
  if (!coding) blockers.push({ id: 'coding-missing', message: 'Choose a Coding Agent.' });
  if (!draft.source) blockers.push({ id: 'source-missing', message: 'Choose a project source.' });
  if (draft.projectTypes.length === 0) {
    blockers.push({ id: 'type-missing', message: 'Choose at least one project type.' });
  }
  // "No Reviewer" is a real selectable option — it can never satisfy a
  // reviewer-requiring policy.
  const reviewerAbsent = !reviewer || reviewer.id === 'reviewer-none';
  if (draft.workforce.reviewerPolicy !== 'never' && reviewerAbsent) {
    blockers.push({
      id: 'reviewer-missing',
      message: 'Reviewer policy requires a Reviewer — choose one or set the policy to NEVER.',
    });
  }
  if (draft.verification.review !== 'none' && draft.workforce.reviewerPolicy === 'never') {
    warnings.push({
      id: 'review-policy-conflict',
      message:
        'Verification requires review, but the reviewer policy is NEVER — align them before starting.',
    });
  }
  if (!draft.projectName || !draft.projectName.trim()) {
    blockers.push({ id: 'name-missing', message: 'Choose a project name.' });
  }

  // When the policy is NEVER the reviewer seat is unused — don't block on it.
  const reviewerInUse = draft.workforce.reviewerPolicy !== 'never';
  for (const [label, agent] of [
    ['Prompt Architect', architect],
    ['Coding Agent', coding],
    ['Reviewer', reviewerInUse ? reviewer : null],
  ] as const) {
    if (agent && !SELECTABLE_AVAILABILITY.has(agent.availability)) {
      blockers.push({
        id: `${agent.id}-unavailable`,
        message: `${label} ${agent.name} is ${agent.availability.replace(/_/g, ' ')} and cannot run missions yet.`,
      });
    }
    if (agent && agent.availability === 'sign_in_required') {
      warnings.push({ id: `${agent.id}-signin`, message: `${label} ${agent.name}: sign-in required before the first mission.` });
    }
    if (agent && agent.availability === 'api_connection_required') {
      warnings.push({ id: `${agent.id}-api`, message: `${label} ${agent.name}: API connection required before the first mission.` });
    }
  }

  const independent = reviewerIndependentFromCodingAgent(reviewer, coding);
  if (!independent) {
    warnings.push({
      id: 'reviewer-not-independent',
      message:
        'Reviewer is not independent from the Coding Agent (same provider). Independent review is strongly recommended.',
    });
  }

  if (draft.source === 'connect_repository') {
    warnings.push({
      id: 'repository-not-connected',
      message: 'Repository not connected yet — connect it before the first mission.',
    });
  }

  if (draft.mode === 'autonomous') {
    if (draft.permissions.deployment === 'production_with_approval' && draft.deploymentTarget === 'production') {
      warnings.push({
        id: 'autonomous-production',
        message: 'Autonomous mode with production deployment still stops for explicit approval.',
      });
    }
    if (draft.limits.spendUsd === 0) {
      warnings.push({
        id: 'autonomous-spend',
        message: 'Autonomous mode with a $0 spending limit will stop at the first paid call.',
      });
    }
  }

  if (draft.research.mode !== 'off' && draft.research.topics.length === 0) {
    warnings.push({
      id: 'research-topics-empty',
      message: 'Research is enabled with no approved topics — the Prompt Architect will have nothing to research.',
    });
  }

  return { blockers, warnings, reviewerIndependent: independent };
}
