import type { ProjectBriefDraft } from '../entry-home/contracts';
import type {
  ProjectSettingsDraft,
  SettingsProjectType,
} from './contracts';

/**
 * Deterministic Project Settings defaults — prefilled from the Project Brief
 * Draft the developer built on the Relay Entry Home. Pure functions: same
 * brief, same defaults. No provider call, no personalization claim.
 */

const CATEGORY_TO_TYPE: Record<string, SettingsProjectType> = {
  product_feature: 'existing_improvement',
  interface: 'web_app',
  new_application: 'web_app',
  project_review: 'existing_improvement',
  bug_fix: 'existing_improvement',
  api_service: 'backend_service',
  authentication: 'security_system',
  payments: 'backend_service',
  agent: 'ai_agent',
  data_pipeline: 'data_pipeline',
  refactor: 'existing_improvement',
  performance: 'existing_improvement',
  project_memory: 'ai_product',
  internal_tool: 'internal_tool',
  observability: 'developer_tool',
  production_release: 'existing_improvement',
};

/** Deterministic project-name suggestions from the brief — selectable, not typed. */
export function suggestProjectNames(brief: ProjectBriefDraft | null): string[] {
  const base: string[] = [];
  if (brief?.workingTitle) base.push(brief.workingTitle);
  const words = (brief?.problem ?? '')
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z]/g, ''))
    .filter((w) => w.length > 3)
    .slice(0, 6);
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  if (words.length >= 2) {
    base.push(`${cap(words[0])} ${cap(words[1])}`);
    base.push(`${cap(words[1])} Control`);
    base.push(`${cap(words[0])} HQ`);
  }
  base.push('Relay Project One', 'Sunday Build', 'Mission Zero');
  // Dedupe, keep order, cap at 6.
  return [...new Set(base)].slice(0, 6);
}

export function createDefaultSettingsDraft(brief: ProjectBriefDraft | null): ProjectSettingsDraft {
  const category = brief?.category ?? null;
  const projectType = category ? CATEGORY_TO_TYPE[category] ?? 'web_app' : 'web_app';
  const securitySensitive =
    category === 'authentication' || category === 'payments' || category === 'production_release';

  return {
    projectName: suggestProjectNames(brief)[0] ?? 'Relay Project One',
    stage: brief?.existingProject ? 'active_development' : 'idea',
    source: brief ? (brief.existingProject ? 'connect_repository' : 'new_project') : null,
    projectTypes: [projectType],
    platforms: ['web'],
    devicePriority: 'equal',
    deploymentTarget: 'undecided',
    technology: {
      frontend: 'relay_recommends',
      backend: 'relay_recommends',
      database: 'relay_recommends',
      hosting: 'relay_recommends',
      testing: 'relay_recommends',
    },
    workforce: {
      promptArchitectId: 'architect-sunday-alcatraz',
      codingAgentId: 'coding-claude-code',
      reviewerId: 'reviewer-codex',
      reviewerPolicy: securitySensitive ? 'every_mission' : 'substantive',
    },
    mode: brief?.suggestedMode ?? 'semi',
    research: {
      mode: 'on_demand',
      topics: ['technology_stack', 'libraries_and_apis'],
      sourcePolicy: 'official_plus_credible',
      brainUpdate: 'ask_every',
      staleCheck: 'weekly',
    },
    memorySources: ['repository', 'project_brief', 'project_settings', 'project_brain'],
    scope: {
      preset: 'module',
      protectedAreas: ['secrets', 'deployment', 'production_configuration'],
      fileAccess: 'claimed_files',
      customPaths: [],
    },
    permissions: {
      dependencies: 'ask_first',
      commands: 'safe_dev',
      network: 'blocked',
      deployment: 'blocked',
      destructive: 'blocked',
    },
    verification: {
      tests: ['existing_test_suite', 'typecheck', 'build'],
      inspections: [
        'claimed_file_check',
        'protected_path_check',
        'source_worktree_protection',
        'secret_scan',
      ],
      review: 'independent',
      completionRule: 'strict',
    },
    limits: {
      runtimeMinutes: 30,
      agentCalls: 4,
      spendUsd: 5,
      reviewCycles: 1,
      repairCycles: 1,
      noProgress: 'one_stalled',
    },
    notifications: {
      events: [
        'relay_needs_the_developer',
        'relay_verification_fails',
        'reviewer_finds_a_blocker',
        'mission_stops_safely',
        'mission_is_verified_complete',
      ],
      channels: ['in_app'],
    },
  };
}
