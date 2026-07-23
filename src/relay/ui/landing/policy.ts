import type { RelayProjectSetup } from './types';

export interface RelayPolicyRecommendation {
  code: string;
  label: string;
  detail: string;
  level: 'recommended' | 'attention';
}

/** Deterministic setup guidance only. This never inspects or executes a project. */
export function getRelayPolicyRecommendations(setup: RelayProjectSetup): RelayPolicyRecommendation[] {
  const recommendations: RelayPolicyRecommendation[] = [];

  if (!setup.projectSource.trim()) {
    recommendations.push({ code: 'SRC', label: 'Add a project source', detail: 'Relay cannot connect or inspect a repository from this screen.', level: 'attention' });
  }
  if (!setup.protectedAreas.trim()) {
    recommendations.push({ code: 'BND', label: 'Declare protected areas', detail: 'Name files, systems, or directories the workforce must not change.', level: 'attention' });
  }
  if (setup.reviewer === 'none') {
    recommendations.push({ code: 'REV', label: 'Add independent review', detail: 'A reviewer gives completion claims a separate verification path.', level: 'recommended' });
  }
  if (setup.mode === 'autonomous') {
    recommendations.push({ code: 'AUT', label: 'Keep bounded autonomy', detail: `Current limits: ${setup.maxRuntimeMinutes}m, $${setup.maxSpendUsd.toFixed(2)}, ${setup.maxAgentCalls} calls. Destructive actions remain excluded.`, level: 'recommended' });
  }
  if (!setup.evidenceRequirements.trim()) {
    recommendations.push({ code: 'PRF', label: 'Define completion proof', detail: 'Require specific tests, build output, or review evidence before Relay reports completion.', level: 'attention' });
  }
  if (recommendations.length === 0) {
    recommendations.push({ code: 'RDY', label: 'Policy envelope ready', detail: 'Boundaries, independent review, evidence, and operating limits are configured.', level: 'recommended' });
  }
  return recommendations;
}
