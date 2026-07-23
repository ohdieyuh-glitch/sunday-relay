import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RelayLanding } from './RelayLanding';
import { getRelayPolicyRecommendations } from './policy';
import { defaultRelayProjectSetup } from './types';

describe('Relay pre-project landing', () => {
  it('renders the complete pre-project and configuration experience without executing work', () => {
    const html = renderToStaticMarkup(createElement(RelayLanding));

    for (const text of [
      'SUNDAY RELAY', 'PRE-PROJECT READY STATE', 'Pixel Relay Dog standing by',
      'Build the workforce.', 'Keep the context.', 'What do you want Relay to accomplish?',
      'Connect project', 'Describe objective', 'Project settings', 'Start with Relay',
      'BUILDER ROUTES', 'Ship a feature', 'Fix a failing build', 'Create an API',
      'Project Settings', 'Project identity', 'Project boundaries', 'Prompt Architect',
      'Coding Agent', 'Reviewer', 'Relay mode', 'Project memory', 'Completion proof', 'Access and limits',
      'Notifications', 'Relay policy recommendations', 'Workforce preview', 'Enter Live Terminal',
    ]) expect(html).toContain(text);

    expect(html).toContain('No project is connected and no agent runs');
    expect(html).toContain('requires host connection');
    expect(html).not.toMatch(/type="(?:password|hidden)"/);
    expect(html).not.toMatch(/api key|access token|secret value/i);
  });

  it('renders explicit initial selections truthfully', () => {
    const html = renderToStaticMarkup(createElement(RelayLanding, {
      initialSetup: { mode: 'semi', reviewer: 'none', objective: 'Review the repository' },
    }));
    expect(html).toContain('MODE /');
    expect(html).toContain('SEMI');
    expect(html).toContain('Review the repository');
    expect(html).toContain('No reviewer');
    expect(html).toContain('completion remains unverified');
  });
});

describe('deterministic Relay setup policy', () => {
  it('recommends boundaries, source, and proof from the same incomplete input', () => {
    const first = getRelayPolicyRecommendations({
      ...defaultRelayProjectSetup,
      projectSource: '', protectedAreas: '', evidenceRequirements: '', reviewer: 'none',
    });
    const second = getRelayPolicyRecommendations({
      ...defaultRelayProjectSetup,
      projectSource: '', protectedAreas: '', evidenceRequirements: '', reviewer: 'none',
    });
    expect(second).toEqual(first);
    expect(first.map((item) => item.code)).toEqual(['SRC', 'BND', 'REV', 'PRF']);
  });

  it('reports a ready envelope only when the key safeguards are present', () => {
    const result = getRelayPolicyRecommendations({
      ...defaultRelayProjectSetup,
      projectSource: 'local project', protectedAreas: 'billing/**',
    });
    expect(result).toEqual([expect.objectContaining({ code: 'RDY' })]);
  });
});
