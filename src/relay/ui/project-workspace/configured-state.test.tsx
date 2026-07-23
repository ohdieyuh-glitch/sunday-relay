import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import {
  buildConfiguredWorkspaceState,
  configuredReviewerState,
  type ConfiguredProjectStart,
} from './configured-state';
import type { RelayProjectWorkspaceProps } from './contracts';

/**
 * Configured project state — the workspace a developer lands on right after
 * pressing START PROJECT in Project Settings, before any mission runs.
 * These tests lock the honesty contract: no fabricated activity, everyone
 * WAITING, console empty on STANDBY, and the founder's actual configuration
 * (name, workforce, mode) shown truthfully.
 */

const START: ConfiguredProjectStart = {
  projectId: 'rly-002',
  name: 'Usage Dashboard',
  reference: 'RLY / 002',
  projectType: 'Web application',
  mode: 'guided',
  promptArchitectName: 'Sunday Alcatraz',
  codingAgentName: 'Claude Code',
  reviewerName: 'Codex',
  reviewerRequired: true,
  researchEnabled: true,
  approvedResearchTopics: ['Security guidance'],
};

const noop = () => undefined;

function render(overrides: Partial<ConfiguredProjectStart> = {}, terminalOpen = false) {
  const props: RelayProjectWorkspaceProps = {
    ...buildConfiguredWorkspaceState({ ...START, ...overrides }),
    terminalOpen,
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
  };
  return renderToStaticMarkup(createElement(RelayProjectWorkspace, props));
}

/* ------------------------------------------------------------ pure builder */

describe('buildConfiguredWorkspaceState', () => {
  it('projects the founder configuration without fabricating any activity', () => {
    const state = buildConfiguredWorkspaceState(START);
    expect(state.project).toEqual({
      projectId: 'rly-002',
      name: 'Usage Dashboard',
      reference: 'RLY / 002',
      projectType: 'Web application',
    });
    expect(state.outputState).toBe('configured');
    expect(state.phase).toBe('plan');
    expect(state.handoffNetworkState).toBe('standby');
    expect(state.dogState).toBe('wandering');
    // Nothing ran: no events, messages, tasks, checks, findings, evidence.
    expect(state.terminalEvents).toEqual([]);
    expect(state.projectMessages).toEqual([]);
    expect(state.manualTasks).toEqual([]);
    expect(state.verificationSummary).toEqual({ checks: [], headline: null });
    expect(state.findings).toEqual([]);
    expect(state.repairs).toEqual([]);
    expect(state.completionState).toEqual({ verdict: 'not_complete', evidence: [] });
    expect(state.projectBrainState).toEqual({ entries: 0, lastUpdate: null, pendingApprovals: 0 });
    expect(state.repairUsed).toBe(false);
    // Everyone waits — no agent is claimed to be working.
    expect(state.workforce.promptArchitect.status).toBe('waiting');
    expect(state.workforce.codingAgent.status).toBe('waiting');
    expect(state.workforce.reviewer.state).toBe('waiting');
    // The mission slot is a truthful placeholder, not a fake mission.
    expect(state.mission.title).toBe('Awaiting first mission');
  });

  it('maps the reviewer selection honestly', () => {
    expect(configuredReviewerState('Codex', true)).toBe('waiting');
    expect(configuredReviewerState('Codex', false)).toBe('waiting');
    expect(configuredReviewerState(null, true)).toBe('not_configured');
    expect(configuredReviewerState(null, false)).toBe('not_required');
    const none = buildConfiguredWorkspaceState({
      ...START,
      reviewerName: null,
      reviewerRequired: false,
    });
    expect(none.reviewerState).toBe('not_required');
    expect(none.workforce.reviewer.name).toBe('None selected');
  });

  it('research is CONFIGURED (never monitoring/researching) and topics show only when enabled', () => {
    const on = buildConfiguredWorkspaceState(START);
    expect(on.researchState.status).toBe('configured');
    expect(on.researchState.approvedTopics).toEqual(['Security guidance']);
    expect(on.researchEnabled).toBe(true);
    const off = buildConfiguredWorkspaceState({
      ...START,
      researchEnabled: false,
      approvedResearchTopics: ['Security guidance'],
    });
    expect(off.researchState.status).toBe('not_configured');
    expect(off.researchState.approvedTopics).toEqual([]);
    expect(off.researchEnabled).toBe(false);
  });
});

/* ----------------------------------------------------------------- render */

describe('configured workspace render', () => {
  it('shows the configured project honestly: STANDBY console, empty feed, everyone waiting', () => {
    const html = render();
    expect(html).toContain('Usage Dashboard');
    expect(html).toContain('RLY / 002');
    expect(html).toContain('CONFIGURED');
    // Console is on STANDBY with the anticipatory empty state — never LIVE.
    expect(html).toContain('STANDBY');
    expect(html).toContain('No mission is running.');
    expect(html).not.toContain('rpw-console-feed');
    // The founder's actual workforce, all waiting.
    expect(html).toContain('Sunday Alcatraz');
    expect(html).toContain('Claude Code');
    expect(html).toContain('Codex');
    expect(html).toContain('GUIDED');
    // No fabricated activity or verdicts.
    expect(html).not.toContain('FIXTURE');
    expect(html).not.toContain('VERIFIED COMPLETE');
    expect(html).not.toContain('rpw-tev-icon'); // no timeline rows exist
  });

  it('phase rail starts at PLAN with nothing complete', () => {
    const html = render();
    // PLAN is the single active phase; no phase is complete yet.
    expect(html).toMatch(/rpw-phase--active[^>]*>[\s\S]{0,200}?PLAN/);
    expect(html).not.toContain('rpw-phase--complete');
  });

  it('research panel states are truthful for enabled and disabled configurations', () => {
    expect(render()).toContain('CONFIGURED — AWAITS FIRST MISSION');
    expect(render()).toContain('Security guidance');
    const off = render({ researchEnabled: false, approvedResearchTopics: [] });
    expect(off).toContain('NOT CONFIGURED');
    expect(off).not.toContain('MONITORING');
  });

  it('the live terminal view stays honest: STANDBY, CONFIGURED, empty state, no MISSION IN PROGRESS', () => {
    const html = render({}, true);
    expect(html).toContain('LIVE TERMINAL');
    expect(html).not.toContain('MISSION IN PROGRESS');
    expect(html).toContain('Relay activity will appear here after Project Settings is confirmed');
    expect(html).not.toContain('rpw-tm-panels'); // no role panels without events
  });
});
