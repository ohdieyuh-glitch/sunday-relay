import { describe, expect, it } from 'vitest';
import { configuredStartFromSettingsDraft } from './configured-start';
import { createDefaultSettingsDraft } from '../project-settings';
import type { ProjectSettingsDraft } from '../project-settings';

/**
 * Preview-host glue: ProjectSettingsDraft → ConfiguredProjectStart. Locks
 * the id → display-name resolution and the honest reviewer/research
 * mappings the configured workspace depends on.
 */

const draft = (over: Partial<ProjectSettingsDraft> = {}): ProjectSettingsDraft => ({
  ...createDefaultSettingsDraft(null),
  ...over,
});

describe('configuredStartFromSettingsDraft', () => {
  it('resolves agent ids and project type to display names', () => {
    const d = draft({ projectName: 'Usage Dashboard' });
    const start = configuredStartFromSettingsDraft(d, 'rly-002', 'RLY / 002');
    expect(start.projectId).toBe('rly-002');
    expect(start.reference).toBe('RLY / 002');
    expect(start.name).toBe('Usage Dashboard');
    // Default draft recommends the real workforce.
    expect(start.promptArchitectName).toBe('Sunday Alcatraz');
    expect(start.codingAgentName).toBe('Claude Code');
    expect(start.reviewerName).toBe('Codex');
    // Labels, never policy identifiers.
    expect(start.projectType).toBe('Web application');
    expect(start.mode).toBe(d.mode);
  });

  it('maps reviewer policy NEVER to not-required and unknown ids to honest fallbacks', () => {
    const d = draft();
    const none = configuredStartFromSettingsDraft(
      {
        ...d,
        workforce: { ...d.workforce, reviewerId: null, reviewerPolicy: 'never' },
      },
      'rly-002',
      'RLY / 002',
    );
    expect(none.reviewerName).toBeNull();
    expect(none.reviewerRequired).toBe(false);

    const unknown = configuredStartFromSettingsDraft(
      {
        ...d,
        projectName: null,
        projectTypes: [],
        workforce: { ...d.workforce, promptArchitectId: null, codingAgentId: 'no-such-agent' },
      },
      'rly-002',
      'RLY / 002',
    );
    // Honest fallbacks — never invent an agent or a name.
    expect(unknown.promptArchitectName).toBe('Not selected');
    expect(unknown.codingAgentName).toBe('Not selected');
    expect(unknown.name).toBe('Relay Project');
    expect(unknown.projectType).toBe('Project');
  });

  it('research topics resolve to display labels and mode OFF disables research', () => {
    const d = draft();
    const on = configuredStartFromSettingsDraft(
      {
        ...d,
        research: { ...d.research, mode: 'on_demand', topics: ['security_guidance'] },
      },
      'rly-002',
      'RLY / 002',
    );
    expect(on.researchEnabled).toBe(true);
    expect(on.approvedResearchTopics).toEqual(['Security guidance']);

    const off = configuredStartFromSettingsDraft(
      { ...d, research: { ...d.research, mode: 'off' } },
      'rly-002',
      'RLY / 002',
    );
    expect(off.researchEnabled).toBe(false);
  });
});
