import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

import { RelayAgentOperatingInspector } from './RelayAgentOperatingInspector';
import { RelayWorkforceStrip } from './RelayWorkforceStrip';
import {
  RELAY_AGENT_ROLES,
  operatingProfileFixture,
  operatingProfileFixtures,
  projectAgentOperatingProfile,
  projectAgentOperatingProfiles,
  type RelayAgentRole,
} from '../../mission';
import { renderAgentOperatingProfile } from '../../cli/agent-operating';
import type { WorkforceAssignment } from './contracts';

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

const WORKFORCE: WorkforceAssignment = {
  promptArchitect: { name: 'Prompt Architect', status: 'planning' },
  codingAgent: { name: 'Claude Code', status: 'implementing' },
  reviewer: { name: 'Codex Reviewer', state: 'waiting' },
};

describe('the operating-profile inspector', () => {
  for (const role of RELAY_AGENT_ROLES) {
    it(`${role} shows all four component rows`, () => {
      const projection = projectAgentOperatingProfile(operatingProfileFixture(role));
      const markup = html(createElement(RelayAgentOperatingInspector, { projection }));
      for (const label of ['Runtime', 'Mission Contract', 'Environment', 'Tools']) {
        expect(markup, `${role} is missing the ${label} row`).toContain(label);
      }
      for (const row of projection.rows) expect(markup).toContain(row.value);
    });
  }

  it('discloses simulated data rather than implying a live agent', () => {
    const projection = projectAgentOperatingProfile(operatingProfileFixture('coding_agent'));
    const markup = html(createElement(RelayAgentOperatingInspector, { projection }));
    expect(markup).toContain('SIMULATED DATA');
    expect(markup).toContain('Not connected');
    expect(markup).toContain('data-simulated="true"');
  });

  it('shows no secret and no raw system-prompt text by default', () => {
    for (const profile of operatingProfileFixtures()) {
      const markup = html(createElement(RelayAgentOperatingInspector, {
        projection: projectAgentOperatingProfile(profile),
      }));
      for (const shape of [/sk-[A-Za-z0-9-]{8,}/, /ghp_[A-Za-z0-9]{8,}/, /password/i, /token\s*[:=]/i]) {
        expect(shape.test(markup)).toBe(false);
      }
      // The Mission Contract's instruction bodies are never rendered.
      expect(markup).not.toContain('Give every Relay Dog a runtime');
      expect(markup).not.toContain('Four canonical operating components');
    }
  });

  it('keeps the detail collapsed until asked, and never reveals instructions when open', () => {
    const projection = projectAgentOperatingProfile(operatingProfileFixture('reviewer'));
    const closed = html(createElement(RelayAgentOperatingInspector, { projection }));
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain('Execution mode');

    const open = html(createElement(RelayAgentOperatingInspector, { projection, defaultOpen: true }));
    expect(open).toContain('Execution mode');
    expect(open).toContain('Simulated');
    // A safe structured summary — still no instruction text.
    expect(open).not.toContain('Give every Relay Dog a runtime');
  });
});

describe('all three Relay Dog panels carry the inspector', () => {
  it('renders it in the Prompt Architect, Coding Agent and Reviewer cells', () => {
    const markup = html(createElement(RelayWorkforceStrip, {
      workforce: WORKFORCE,
      mode: 'guided',
      phase: 'build',
      operating: projectAgentOperatingProfiles(operatingProfileFixtures()),
    }));
    for (const role of RELAY_AGENT_ROLES) {
      expect(markup, `no inspector for ${role}`).toContain(`data-role="${role}"`);
    }
    // Four rows on each of the three panels. Matched on the exact class, so
    // the container's `rpw-operating-rows` is not counted as a row.
    expect(markup.match(/class="rpw-operating-row"/g)?.length).toBe(12);
  });

  it('renders exactly as before when no profiles are supplied', () => {
    // A missing profile is not a blank inspector.
    const without = html(createElement(RelayWorkforceStrip, {
      workforce: WORKFORCE, mode: 'guided', phase: 'build',
    }));
    expect(without).not.toContain('rpw-operating');
    expect(without).toContain('PROMPT ARCHITECT');
    expect(without).toContain('CODING AGENT');
    expect(without).toContain('REVIEWER');
  });

  it('adds no card grid and no new navigation', () => {
    const markup = html(createElement(RelayWorkforceStrip, {
      workforce: WORKFORCE,
      mode: 'guided',
      phase: 'build',
      operating: projectAgentOperatingProfiles(operatingProfileFixtures()),
    }));
    expect(markup).not.toContain('<nav');
    expect(markup).not.toContain('rpw-card');
  });
});

describe('the website and the CLI agree, value for value', () => {
  it('every row the inspector shows is a row the CLI prints, worded identically', () => {
    for (const role of RELAY_AGENT_ROLES as readonly RelayAgentRole[]) {
      const projection = projectAgentOperatingProfile(operatingProfileFixture(role));
      const markup = html(createElement(RelayAgentOperatingInspector, { projection }));
      const cli = renderAgentOperatingProfile(projection, { width: 200, plain: true }).join('\n');

      for (const row of projection.rows) {
        expect(markup, `website missing ${row.label}`).toContain(row.value);
        expect(cli, `CLI missing ${row.label}`).toContain(row.value);
      }
      // Role, execution mode and unknown-state wording come from one place.
      expect(cli).toContain(projection.roleLabel.toUpperCase());
      expect(markup).toContain(projection.rows[0].value);
    }
  });

  it('neither surface invents a label the projection did not produce', () => {
    const projection = projectAgentOperatingProfile(operatingProfileFixture('coding_agent'));
    const markup = html(createElement(RelayAgentOperatingInspector, { projection }));
    const cli = renderAgentOperatingProfile(projection, { width: 200, plain: true }).join('\n');
    for (const wrong of ['Offline', 'Disconnected', 'N/A', 'None available', 'No runtime']) {
      expect(markup, `website invented "${wrong}"`).not.toContain(wrong);
      expect(cli, `CLI invented "${wrong}"`).not.toContain(wrong);
    }
  });
});
