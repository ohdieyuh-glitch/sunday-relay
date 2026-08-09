/** @vitest-environment jsdom */
import { afterEach, describe, expect, it as baseIt, vi } from 'vitest';

// The workforce section renders 24 option rows; accessible-name queries are
// slow on low-core machines, and this box also runs a parallel session's
// suites. Give every test here a wide budget — correctness, not speed.
const it = (name: string, fn: () => void | Promise<void>) => baseIt(name, fn, 120000);
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { RelayProjectSettings } from './RelayProjectSettings';
import { AGENT_OPTIONS } from './options';
import { buildProjectBriefDraft } from '../entry-home/project-brief';
import type { ProjectSettingsDraft, RelayProjectSettingsProps } from './contracts';

/**
 * Project Settings interaction tests (jsdom): every role is chosen by
 * CLICKING, a normal project is configured end-to-end without typing, custom
 * inputs appear only behind explicit CUSTOM actions, and START stays gated.
 */

afterEach(cleanup);

const brief = buildProjectBriefDraft('Build a usage dashboard for AI developers', null);

function setup(overrides: Partial<RelayProjectSettingsProps> = {}) {
  const props: RelayProjectSettingsProps = {
    brief,
    agentOptions: AGENT_OPTIONS,
    entitlement: 'pro',
    onSaveDraft: vi.fn(),
    onStartProject: vi.fn(),
    onConnectRepository: vi.fn(),
    onBack: vi.fn(),
    // These exercise the FIFTEEN-SECTION flow, which is no longer the view
    // that opens first — Quick Setup is. Naming it here keeps every assertion
    // below meaning exactly what it meant before.
    initialSetupMode: 'advanced',
    ...overrides,
  };
  render(createElement(RelayProjectSettings, props));
  return props;
}

const gotoSection = (label: string) => {
  // The rail button renders number + label in adjacent spans; the accessible
  // name may or may not include the boundary space.
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label.replace(/ /, '\\s*')) }));
};

describe('click-first workforce selection', () => {
  it('architect, coding agent, and reviewer are selected by clicking — no agent-name textbox', () => {
    setup();
    gotoSection('05 WORKFORCE');

    // No freeform field anywhere in the workforce section.
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.querySelector('input[type="text"]')).toBeNull();

    const manualArchitect = screen.getByRole('radio', { name: /Manual Architect/ }) as HTMLInputElement;
    fireEvent.click(manualArchitect);
    expect(manualArchitect.checked).toBe(true);

    // Match the coding-agent row by its unique description (the Codex
    // reviewer's recommendation reason also mentions "Claude Code").
    const claudeCode = screen.getByRole('radio', {
      name: /Repository implementation through the real local adapter/,
    }) as HTMLInputElement;
    expect(claudeCode.checked).toBe(true); // recommended default
    const manualCoding = screen.getByRole('radio', { name: /Manual Coding Agent/ }) as HTMLInputElement;
    fireEvent.click(manualCoding);
    expect(manualCoding.checked).toBe(true);

    const codex = screen.getByRole('radio', { name: /Independent read-only review/ }) as HTMLInputElement;
    expect(codex.checked).toBe(true); // recommended default reviewer
  });

  it('unavailable agents are disabled and cannot silently appear connected', () => {
    setup();
    gotoSection('05 WORKFORCE');
    // Scoped to the CODING AGENT group: Hermes now appears twice, as the
    // coding agent that does not exist yet and as the reviewer harness Relay
    // genuinely ships. The claim under test is about the first one.
    const hermesCoding = screen
      .getAllByRole('radio', { name: /Hermes/ })
      .find((r) => (r as HTMLInputElement).value === 'coding-hermes') as HTMLInputElement;
    expect(hermesCoding.disabled).toBe(true);
    expect(screen.getAllByText('COMING LATER').length).toBeGreaterThan(0);
    // Exactly one CONNECTED status — Claude Code.
    expect(screen.getAllByText('CONNECTED')).toHaveLength(1);
  });

  it('reviewer independence warning appears for a same-provider pair', () => {
    setup();
    gotoSection('05 WORKFORCE');
    // Manual coding + manual reviewer share a provider (the developer).
    fireEvent.click(screen.getByRole('radio', { name: /Manual Coding Agent/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Manual Reviewer/ }));
    expect(screen.getByText(/REVIEWER NOT INDEPENDENT/)).toBeTruthy();
    // Switching back to Codex restores independence.
    fireEvent.click(screen.getByRole('radio', { name: /Independent read-only review/ }));
    expect(screen.getByText(/INDEPENDENT FROM CODING AGENT/)).toBeTruthy();
  });

  it('the workforce preview updates instantly with selections', () => {
    setup();
    gotoSection('05 WORKFORCE');
    fireEvent.click(screen.getByRole('radio', { name: /Manual Coding Agent/ }));
    const preview = screen.getByLabelText('Workforce preview');
    expect(preview.textContent).toContain('Manual Coding Agent');
    expect(preview.textContent).toContain('Verified Result');
  });
});

describe('typing policy', () => {
  it('custom name input appears only after pressing CUSTOM NAME', () => {
    setup();
    expect(document.querySelector('input[type="text"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'CUSTOM NAME' }));
    const input = screen.getByLabelText('CUSTOM PROJECT NAME') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'My Custom Name' } });
    expect(input.value).toBe('My Custom Name');
  });

  it('a normal project is configured and started entirely by clicking', () => {
    const props = setup();
    // 01 — choose a generated name + project source by clicking.
    fireEvent.click(screen.getByRole('radio', { name: brief.workingTitle }));
    fireEvent.click(screen.getByRole('radio', { name: 'NEW PROJECT' }));
    // 06 — switch mode via the segmented control.
    gotoSection('06 MODE');
    fireEvent.click(screen.getByRole('radio', { name: 'GUIDED' }));
    // 12 — pick a preset limit.
    gotoSection('12 LIMITS');
    fireEvent.click(screen.getByRole('button', { name: '$10' }));
    // 15 — review and start (14 is MCP CONNECTIONS since the MCP mount).
    gotoSection('15 REVIEW AND START');
    const start = screen.getByRole('button', { name: 'START PROJECT' }) as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    expect(props.onStartProject).toHaveBeenCalledTimes(1);
    const draft = vi.mocked(props.onStartProject).mock.calls[0][0] as ProjectSettingsDraft;
    // No typing occurred anywhere in this flow.
    expect(document.querySelector('input[type="text"]')).toBeNull();
    // Typed values, not labels.
    expect(draft.mode).toBe('guided');
    expect(draft.source).toBe('new_project');
    expect(draft.limits.spendUsd).toBe(10);
    expect(draft.workforce.codingAgentId).toBe('coding-claude-code');
    expect(draft.permissions.destructive).toBe('blocked');
  });

  it('START stays disabled while a blocker exists', () => {
    setup({ brief: null }); // no brief → no project source preselected
    gotoSection('15 REVIEW AND START');
    const start = screen.getByRole('button', { name: 'START PROJECT' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Choose a project source');
  });
});

describe('option controls', () => {
  it('notifications use switches; unavailable channels stay disabled with honest labels', () => {
    setup();
    gotoSection('13 NOTIFICATIONS');
    const missionComplete = screen.getByRole('switch', {
      name: /Mission is verified complete/,
    }) as HTMLInputElement;
    expect(missionComplete.checked).toBe(true);
    fireEvent.click(missionComplete);
    expect(missionComplete.checked).toBe(false);
    const push = screen.getByRole('switch', { name: /Mobile push/ }) as HTMLInputElement;
    expect(push.disabled).toBe(true);
  });

  it('research and scope are chip/segment driven', () => {
    setup();
    gotoSection('07 RESEARCH');
    fireEvent.click(screen.getByRole('radio', { name: 'OFF' }));
    expect(screen.queryByText('RESEARCH TOPICS')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'ON DEMAND' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Security guidance/ }));

    gotoSection('09 SCOPE');
    fireEvent.click(screen.getByRole('radio', { name: 'FULL REPOSITORY' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Billing/ }));
  });

  it('save draft emits the full typed draft from any section', () => {
    const props = setup();
    gotoSection('10 PERMISSIONS');
    fireEvent.click(screen.getByRole('radio', { name: 'ASK EACH TIME' }));
    fireEvent.click(screen.getByRole('button', { name: 'SAVE DRAFT' }));
    expect(props.onSaveDraft).toHaveBeenCalled();
    const draft = vi.mocked(props.onSaveDraft).mock.calls[0][0] as ProjectSettingsDraft;
    expect(draft.verification.completionRule).toBe('strict');
  });
});
