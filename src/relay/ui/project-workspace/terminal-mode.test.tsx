import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import { WORKSPACE_FIXTURES, type WorkspaceFixtureKey } from './fixtures';
import type { RelayProjectWorkspaceProps } from './contracts';

/**
 * Terminal Mode — locked to the founder terminal photo: framed window with
 * traffic-light chrome, per-role panels whose status pulses (THINKING /
 * WORKING …), timeline rows that read like live agent work (role prefix,
 * activity headline, sub-detail, right-aligned CREATE/MODIFY/RUN summaries,
 * green ✓ COMPLETE steps, streaming cursor), the `>_` prompt with ⌘↵ SEND —
 * while every truthfulness rule survives: agent lines stay labeled claims,
 * no raw commands, no execution promise.
 */

const noop = () => undefined;

function props(
  key: WorkspaceFixtureKey,
  overrides: Partial<RelayProjectWorkspaceProps> = {},
): RelayProjectWorkspaceProps {
  return {
    ...WORKSPACE_FIXTURES[key],
    terminalOpen: true,
    terminalFullScreen: true,
    onSendProjectMessage: noop,
    onApproveDecision: noop,
    onRejectDecision: noop,
    onOpenTerminal: noop,
    onCloseTerminal: noop,
    onOpenProjectSettings: noop,
    onOpenManualTask: noop,
    onApproveManualTask: noop,
    onRejectManualTask: noop,
    onRequestResearch: noop,
    onOpenFinding: noop,
    onOpenRepair: noop,
    onReturnHome: noop,
    ...overrides,
  };
}

const render = (key: WorkspaceFixtureKey, overrides: Partial<RelayProjectWorkspaceProps> = {}) =>
  renderToStaticMarkup(createElement(RelayProjectWorkspace, props(key, overrides)));

describe('terminal window chrome (founder photo)', () => {
  it('renders the framed window with traffic lights, centered brand, and the RLY chip', () => {
    const html = render('implementing');
    expect(html).toContain('rpw-tm-window');
    expect(html).toContain('rpw-tm-light--r');
    expect(html).toContain('rpw-tm-light--y');
    expect(html).toContain('rpw-tm-light--g');
    expect(html).toContain('SUNDAY RELAY');
    expect(html).toContain('RLY / 001');
    expect(html).toContain('Close Live Terminal');
  });

  it('shows the live mission status row with workforce and mode', () => {
    const html = render('implementing');
    expect(html).toContain('● LIVE');
    expect(html).toContain('MISSION IN PROGRESS');
    expect(html).toContain('ARCHITECT:');
    expect(html).toContain('Sunday Alcatraz');
    expect(html).toContain('CODING AGENT:');
    expect(html).toContain('Claude Code');
    expect(html).toContain('SEMI');
  });
});

describe('live agent work (founder photo storyline)', () => {
  it('the Prompt Architect visibly generates, researches, and refines', () => {
    const html = render('implementing');
    expect(html).toContain('Prompt Architect:');
    expect(html).toContain('generating implementation brief');
    expect(html).toContain('Analyzing requirements, constraints, and system context…');
    expect(html).toContain('researching project details');
    expect(html).toContain('Exploring codebase, dependencies, and architectural patterns…');
    expect(html).toContain('refining handoff prompt');
    expect(html).toContain('handoff prompt ready');
    // Architect panel pulses THINKING while preparing the handoff.
    expect(html).toContain('THINKING');
    expect(html).toContain('rpw-tm-dots');
  });

  it('the Coding Agent visibly codes: CREATE / MODIFY / RUN with a WORKING pulse', () => {
    const html = render('implementing');
    expect(html).toContain('Coding Agent:');
    expect(html).toContain('implementing auth module');
    expect(html).toContain('CREATE src/lib/auth.ts');
    expect(html).toContain('editing relay-store.ts');
    expect(html).toContain('MODIFY src/lib/relay-store.ts');
    expect(html).toContain('running tests');
    expect(html).toContain('RUN npm test');
    expect(html).toContain('WORKING');
    // Finished steps get the green ✓ COMPLETE treatment.
    expect(html).toContain('all tests passing');
    expect(html).toContain('12 passed, 0 failed');
    expect(html).toContain('✓ COMPLETE');
    expect(html).toContain('rpw-tmrow--done');
  });

  it('the newest open row of a busy panel streams a blinking cursor', () => {
    const base = WORKSPACE_FIXTURES.implementing;
    const html = render('implementing', {
      terminalEvents: [
        ...base.terminalEvents,
        {
          eventId: 'fx-ev-open-tail',
          at: '2026-07-22T11:59:04Z',
          category: 'coding_agent',
          truth: 'agent_claim',
          headline: 'implementing workspace panel',
          detail: 'Editing src/lib/workspace-panel.ts…',
          meta: 'MODIFY src/lib/workspace-panel.ts',
          fixture: true,
        },
      ],
    });
    expect(html).toContain('rpw-tm-cursor');
    // Completed steps never stream.
    const doneRow = html.slice(html.indexOf('all tests passing'));
    expect(doneRow.slice(0, doneRow.indexOf('</li>'))).not.toContain('rpw-tm-cursor');
  });

  it('Relay preserves context and compiles the handoff with the context id', () => {
    const html = render('implementing');
    expect(html).toContain('Relay:');
    expect(html).toContain('context preserved');
    expect(html).toContain('handoff compiled');
    expect(html).toContain('Architect → Coding Agent transition successful');
    expect(html).toContain('CONTEXT ID: rly_001_20260722_115712');
  });

  it('the prompt row is the ask input with ⌘↵ SEND — no execution promise', () => {
    const html = render('implementing');
    expect(html).toContain('Ask Relay anything about this project…');
    expect(html).toContain('⌘↵ SEND');
    expect(html).toContain('rpw-tm-prompt-caret');
    // The honesty scope line survives the restyle.
    expect(html).toContain('This view observes; it does not execute.');
    expect(html).not.toContain('run a command');
  });
});

describe('truthfulness survives the live-coding look', () => {
  it('coding activity stays a labeled claim; done never fabricates verification', () => {
    const html = render('implementing');
    expect(html).toContain('CLAIM — PENDING VERIFICATION');
    // "all tests passing" is done but NOT Relay-verified: ✓ COMPLETE without ✓ VERIFIED.
    expect(html).toContain('✓ COMPLETE');
    const codingPanel = html.slice(html.indexOf('CODING AGENT activity'));
    expect(codingPanel.slice(0, codingPanel.indexOf('RELAY SYSTEM'))).not.toContain('✓ VERIFIED');
  });

  it('reduced motion disables the streaming presentation class-wise', () => {
    const html = render('implementing', { reducedMotion: true });
    expect(html).toContain('rpw-terminal--static');
  });

  it('the configured (no-mission) terminal stays empty and honest — no fake coding', () => {
    const html = render('implementing', { terminalEvents: [] });
    expect(html).toContain('No mission is running.');
    expect(html).not.toContain('rpw-tm-panels');
    expect(html).not.toContain('rpw-tm-cursor');
  });
});
