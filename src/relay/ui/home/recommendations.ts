import type { ProjectRoute, RelayProjectDraft } from './contracts';

export function recommendationFor(draft: RelayProjectDraft) {
  const security = draft.category === 'Security';
  const existing = draft.kind === 'existing' || draft.category === 'Codebase review';
  return {
    architect: 'Sunday Alcatraz',
    codingAgent: existing ? 'Codex' : 'Claude Code',
    reviewer: security ? 'Security Reviewer' : 'Codex Independent Reviewer',
    mode: 'guided' as const,
    reason: security
      ? 'Security work needs explicit boundaries and a blocking specialist review.'
      : existing
        ? 'Existing-project work starts with inspection. Guided Mode keeps scope decisions under user approval.'
        : 'This is a new coding project and the first Relay mission. Guided Mode keeps important decisions under user approval while Relay learns the project.',
  };
}

export function applyRoute(draft: RelayProjectDraft, route: ProjectRoute): RelayProjectDraft {
  const next = { ...draft, objective: route.objective, category: route.category, evidenceRequired: route.evidence };
  const recommendation = recommendationFor(next);
  return { ...next, codingAgent: route.codingAgent ?? recommendation.codingAgent, reviewer: route.reviewer ?? recommendation.reviewer };
}

export function applyRecommendedSetup(draft: RelayProjectDraft): RelayProjectDraft {
  const r = recommendationFor(draft);
  return { ...draft, architect: r.architect, codingAgent: r.codingAgent, reviewer: r.reviewer, mode: r.mode };
}

export function projectReadiness(draft: RelayProjectDraft) {
  const items = {
    Objective: draft.objective.trim().length > 0,
    Workforce: Boolean(draft.architect && draft.codingAgent && draft.reviewer),
    Mode: Boolean(draft.mode),
    Boundaries: draft.boundariesConfirmed,
  };
  return { items, ready: Object.values(items).every(Boolean), missing: Object.entries(items).filter(([, ready]) => !ready).map(([name]) => name) };
}
