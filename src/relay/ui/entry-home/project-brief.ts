import type {
  HomeReadiness,
  ProjectBriefDraft,
  ProjectRouteDefinition,
} from './contracts';
import {
  buildEvidenceRecommendation,
  buildResearchRecommendation,
} from './recommendations';

/**
 * Project Brief Draft — pure, deterministic construction and formatting.
 * The draft is the structured beginning prompt handed to Project Settings.
 * It is NEVER a Mission Contract: Relay and the Prompt Architect create the
 * Mission Contract later, after Project Settings is confirmed. No provider
 * call, no persistence, no execution.
 */

export function createEmptyProjectBriefDraft(): ProjectBriefDraft {
  return {
    workingTitle: '',
    projectType: '',
    category: null,
    problem: '',
    intendedUsers: '',
    desiredResult: '',
    coreFunctionality: [],
    existingProject: false,
    technicalContext: '',
    preferredStack: '',
    visualDirection: '',
    constraints: [],
    securitySensitivity: 'Unknown — confirm in Project Settings.',
    productionImpact: 'Unknown — confirm in Project Settings.',
    researchTopics: [],
    unknowns: [],
    knowledgeGaps: [],
    suggestedPromptArchitect: 'Sunday Alcatraz',
    suggestedCodingAgent: 'Claude Code',
    suggestedReviewer: 'Codex',
    suggestedMode: 'semi',
    evidenceRequirements: [],
    completionCriteria: [],
    openQuestions: [],
  };
}

/** Derive a working title from the first words of the objective. */
function titleFromObjective(objective: string): string {
  const words = objective.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Untitled Relay Project';
  const head = words.slice(0, 6).join(' ');
  return head.charAt(0).toUpperCase() + head.slice(1);
}

/**
 * Build a structured Project Brief Draft from the developer's objective and
 * the selected route. Deterministic — same inputs, same draft.
 */
export function buildProjectBriefDraft(
  objective: string,
  route: ProjectRouteDefinition | null,
): ProjectBriefDraft {
  const category = route?.category ?? null;
  const research = buildResearchRecommendation(category);
  const evidence = buildEvidenceRecommendation(category);
  const existingProject = category === 'project_review' || category === 'bug_fix';

  return {
    ...createEmptyProjectBriefDraft(),
    workingTitle: titleFromObjective(objective),
    projectType: route ? route.title : 'General build',
    category,
    problem: objective.trim(),
    intendedUsers: 'To be confirmed with the developer.',
    desiredResult:
      'A verified result: implemented, tested, and independently reviewed per the completion policy.',
    coreFunctionality: objective.trim() ? [objective.trim()] : [],
    existingProject,
    technicalContext: 'To be confirmed in Project Settings.',
    preferredStack: 'To be confirmed in Project Settings.',
    visualDirection:
      category === 'interface'
        ? 'Match the Sunday Relay system aesthetic unless the developer specifies otherwise.'
        : '',
    constraints: ['No provider credentials in the browser', 'Stay inside the approved project scope'],
    researchTopics: research.topics,
    unknowns: ['Repository or source location', 'Protected areas'],
    knowledgeGaps: ['Existing architecture details', 'Domain terminology'],
    suggestedMode: category === 'authentication' || category === 'payments' || category === 'production_release' ? 'guided' : 'semi',
    evidenceRequirements: evidence.requirements,
    completionCriteria: [
      'All acceptance criteria pass',
      'Required tests pass',
      'Independent review approves (when required)',
    ],
    openQuestions: [
      'Is this a new or existing project?',
      'What areas are out of scope or protected?',
      'What is the production impact?',
    ],
  };
}

/** Readiness for the handoff. Never "ready to execute" from the Home screen. */
export function computeHomeReadiness(
  objective: string,
  draft: ProjectBriefDraft | null,
): HomeReadiness {
  if (draft && draft.problem.trim()) return 'ready_for_project_settings';
  if (draft) return 'project_brief_ready';
  if (objective.trim()) return 'project_brief_ready';
  return 'idea_required';
}

export const READINESS_LABEL: Record<HomeReadiness, string> = {
  idea_required: 'IDEA REQUIRED',
  project_brief_ready: 'PROJECT BRIEF READY',
  ready_for_project_settings: 'READY FOR PROJECT SETTINGS',
};

/** Plain-text export of the draft for the copy action. */
export function formatProjectBriefDraft(draft: ProjectBriefDraft): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `  - ${i}`).join('\n') : '  - (none yet)');
  return [
    'PROJECT BRIEF DRAFT — Sunday Relay',
    '(Not a Mission Contract. Created before Project Settings.)',
    '',
    `Working title: ${draft.workingTitle || '(untitled)'}`,
    `Project type: ${draft.projectType || '(unset)'}`,
    `Category: ${draft.category ?? '(unset)'}`,
    `Existing project: ${draft.existingProject ? 'yes' : 'no'}`,
    '',
    `Problem:\n  ${draft.problem || '(describe the problem)'}`,
    `Intended users:\n  ${draft.intendedUsers || '(unknown)'}`,
    `Desired result:\n  ${draft.desiredResult || '(unknown)'}`,
    `Core functionality:\n${list(draft.coreFunctionality)}`,
    `Technical context:\n  ${draft.technicalContext || '(unknown)'}`,
    `Preferred stack:\n  ${draft.preferredStack || '(unknown)'}`,
    `Visual direction:\n  ${draft.visualDirection || '(none)'}`,
    `Constraints:\n${list(draft.constraints)}`,
    `Security sensitivity: ${draft.securitySensitivity}`,
    `Production impact: ${draft.productionImpact}`,
    '',
    `Research topics:\n${list(draft.researchTopics)}`,
    `Unknowns requiring investigation:\n${list(draft.unknowns)}`,
    `Knowledge gaps:\n${list(draft.knowledgeGaps)}`,
    '',
    `Suggested Prompt Architect: ${draft.suggestedPromptArchitect}`,
    `Suggested Coding Agent: ${draft.suggestedCodingAgent}`,
    `Suggested Reviewer: ${draft.suggestedReviewer}`,
    `Suggested Relay mode: ${draft.suggestedMode}`,
    `Evidence requirements:\n${list(draft.evidenceRequirements)}`,
    `Completion criteria:\n${list(draft.completionCriteria)}`,
    `Open questions:\n${list(draft.openQuestions)}`,
  ].join('\n');
}
