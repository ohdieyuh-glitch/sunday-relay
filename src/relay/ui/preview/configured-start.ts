import {
  AGENT_OPTIONS,
  PROJECT_TYPE_CHOICES,
  RESEARCH_TOPIC_CHOICES,
} from '../project-settings';
import type { ProjectSettingsDraft } from '../project-settings';
import type { ConfiguredProjectStart } from '../project-workspace';

/**
 * Preview-host glue: resolve the typed ProjectSettingsDraft into the
 * workspace's neutral ConfiguredProjectStart shape (ids → display names).
 * The workspace module stays independent of the settings module; hosts do
 * this mapping — the preview shell today, Relay Core projections later.
 * Pure and deterministic; no execution is implied by any value here.
 */

const agentName = (id: string | null): string | null =>
  id ? (AGENT_OPTIONS.find((o) => o.id === id)?.name ?? null) : null;

const topicLabel = (value: string): string =>
  RESEARCH_TOPIC_CHOICES.find((c) => c.value === value)?.label ?? value;

export function configuredStartFromSettingsDraft(
  draft: ProjectSettingsDraft,
  projectId: string,
  reference: string,
): ConfiguredProjectStart {
  const firstType = draft.projectTypes[0] ?? null;
  return {
    projectId,
    reference,
    name: draft.projectName ?? 'Relay Project',
    projectType:
      (firstType && PROJECT_TYPE_CHOICES.find((c) => c.value === firstType)?.label) ?? 'Project',
    mode: draft.mode,
    promptArchitectName: agentName(draft.workforce.promptArchitectId) ?? 'Not selected',
    codingAgentName: agentName(draft.workforce.codingAgentId) ?? 'Not selected',
    reviewerName: agentName(draft.workforce.reviewerId),
    reviewerRequired: draft.workforce.reviewerPolicy !== 'never',
    researchEnabled: draft.research.mode !== 'off',
    approvedResearchTopics: draft.research.topics.map(topicLabel),
  };
}
