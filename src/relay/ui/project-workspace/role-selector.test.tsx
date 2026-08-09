/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { RelayRoleSelector, roleOptionViews } from './RelayRoleSelector';
import { RelayWorkforceStrip } from './RelayWorkforceStrip';
import { AGENT_OPTIONS, type RelayWorkforceSelection } from '../project-settings';
import type { WorkforceAssignment } from './contracts';

/**
 * ROLE SWITCHING FROM THE WORKSPACE.
 *
 * The direction: the three roles must be clickable, must open a compact
 * selector rather than a setup flow, must not fake integrations, and must fail
 * closed on invalid combinations. Each of those is a separate assertion here
 * because each has its own way of quietly stopping being true.
 */

afterEach(cleanup);

const SELECTION: RelayWorkforceSelection = {
  promptArchitectId: 'architect-sunday-alcatraz',
  codingAgentId: 'coding-claude-code',
  reviewerId: 'reviewer-hermes',
  reviewerPolicy: 'substantive',
};

const WORKFORCE: WorkforceAssignment = {
  promptArchitect: { name: 'Sunday Alcatraz', status: 'waiting' },
  codingAgent: { name: 'Claude Code', status: 'ready' },
  reviewer: { name: 'Hermes', state: 'waiting' },
};

describe('the strip makes the three roles, and only the three roles, controls', () => {
  it('renders a role cell as a button that opens a selector', () => {
    const onSelectRole = vi.fn();
    render(
      <RelayWorkforceStrip
        workforce={WORKFORCE}
        mode="guided"
        phase="build"
        onSelectRole={onSelectRole}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // Exactly the three permanent roles. MODE and PHASE are reports, and a
    // control that changes nothing is worse than text.
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    }
    fireEvent.click(buttons[1] as HTMLElement);
    expect(onSelectRole).toHaveBeenCalledWith('coding_agent');
  });

  it('renders plain text when no host offers to change the stack', () => {
    render(<RelayWorkforceStrip workforce={WORKFORCE} mode="guided" phase="build" />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    // The information did not move.
    expect(screen.getByText('Claude Code', { exact: false })).toBeTruthy();
  });
});

describe('what the selector offers', () => {
  it('lists only the options for the role it was opened for', () => {
    render(
      <RelayRoleSelector
        role="reviewer"
        selection={SELECTION}
        deployment="founder_machine"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const dialog = screen.getByRole('dialog');
    const listed = within(dialog).getAllByRole('button').length - 1; // minus CLOSE
    expect(listed).toBe(AGENT_OPTIONS.filter((o) => o.role === 'reviewer').length);
    expect(within(dialog).queryByText('Claude Code')).toBeNull();
  });

  it('cannot be chosen when the catalog says it is not selectable yet', () => {
    const views = roleOptionViews({ role: 'coding_agent', selection: SELECTION, deployment: 'founder_machine' });
    const comingLater = views.find((v) => v.option.id === 'coding-openclaw');
    expect(comingLater?.state).toBe('not_selectable');
    expect(comingLater?.blockedReason).toContain('COMING LATER');

    render(
      <RelayRoleSelector
        role="coding_agent"
        selection={SELECTION}
        deployment="founder_machine"
        onSelect={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    const option = screen.getByRole('button', { name: /OpenClaw/ }) as HTMLButtonElement;
    expect(option.disabled).toBe(true);
  });

  it('says when Relay registers nothing that can run a selectable choice', () => {
    // `reviewer-codex` is real configuration the CLI can run and the bridge
    // cannot bind. Offering it silently would be a saved preference that dies
    // at dispatch.
    const views = roleOptionViews({ role: 'reviewer', selection: SELECTION, deployment: 'hosted' });
    const codex = views.find((v) => v.option.id === 'reviewer-codex');
    expect(codex?.state).toBe('selectable_not_dispatchable');
    expect(codex?.blockedReason).toBeNull();

    render(
      <RelayRoleSelector role="reviewer" selection={SELECTION} deployment="hosted" onSelect={vi.fn()} onDismiss={vi.fn()} />,
    );
    // Scoped to Codex's own row — several reviewers share the condition, and a
    // page-wide match would pass while the wrong row carried the sentence.
    const codexRow = screen.getByRole('button', { name: /Codex/ }).closest('li');
    expect(codexRow?.textContent).toMatch(/refused rather than dispatched/);
    // And a dispatchable one does NOT carry it.
    const hermesRow = screen.getByRole('button', { name: /Hermes/ }).closest('li');
    expect(hermesRow?.textContent).not.toMatch(/refused rather than dispatched/);
  });

  it('names the server variables a hosted choice reads, and never a value', () => {
    render(
      <RelayRoleSelector role="reviewer" selection={SELECTION} deployment="hosted" onSelect={vi.fn()} onDismiss={vi.fn()} />,
    );
    const html = document.body.innerHTML;
    expect(html).toContain('RELAY_HERMES');
    // A variable NAME is the disclosure. A value would be a credential, and no
    // credential-shaped string may reach this surface.
    expect(html).not.toMatch(/sk-[A-Za-z0-9]/);
    expect(html).not.toMatch(/Bearer\s+\S/);
  });
});

describe('invalid combinations fail closed, in both directions', () => {
  it('refuses a reviewer that is not independent from the coding agent', () => {
    const views = roleOptionViews({
      role: 'reviewer',
      selection: { ...SELECTION, codingAgentId: 'coding-manual' },
      deployment: 'founder_machine',
    });
    const sameProvider = views.find((v) => v.option.id === 'reviewer-manual');
    // The same human reviewing their own work. Whatever else is true of it, it
    // is not an independent review — and both halves of this pair are
    // genuinely selectable, so the refusal is independence and nothing else.
    expect(sameProvider?.state).toBe('conflicts');
    expect(sameProvider?.blockedReason).toContain('Not independent');
  });

  it('refuses a coding agent that would break the reviewer already chosen', () => {
    // The same defect arriving from the other side. Allowing it would leave
    // the project holding a pair Relay must refuse at mission start.
    const views = roleOptionViews({
      role: 'coding_agent',
      selection: { ...SELECTION, codingAgentId: 'coding-claude-code', reviewerId: 'reviewer-manual' },
      deployment: 'founder_machine',
    });
    const manualCoding = views.find((v) => v.option.id === 'coding-manual');
    expect(manualCoding?.state).toBe('conflicts');
    expect(manualCoding?.blockedReason).toContain('Manual Reviewer');
  });

  it('does not refuse an independent pair', () => {
    const views = roleOptionViews({
      role: 'reviewer',
      selection: { ...SELECTION, codingAgentId: 'coding-claude-code' },
      deployment: 'founder_machine',
    });
    const hermes = views.find((v) => v.option.id === 'reviewer-hermes');
    expect(hermes?.state).toBe('selectable_dispatchable');
    expect(hermes?.blockedReason).toBeNull();
  });

  it('never dispatches a blocked choice, even if the markup were clicked', () => {
    const onSelect = vi.fn();
    render(
      <RelayRoleSelector
        role="reviewer"
        selection={{ ...SELECTION, codingAgentId: 'coding-manual' }}
        deployment="founder_machine"
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    );
    const blocked = screen.getByRole('button', { name: /Manual Reviewer/ }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    fireEvent.click(blocked);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('choosing', () => {
  it('reports the role and the catalog id the project stores', () => {
    const onSelect = vi.fn();
    render(
      <RelayRoleSelector
        role="prompt_architect"
        selection={SELECTION}
        deployment="founder_machine"
        onSelect={onSelect}
        onDismiss={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ChatGPT|GPT/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [role, agentId] = onSelect.mock.calls[0] as [string, string];
    expect(role).toBe('prompt_architect');
    // A CATALOG id — the vocabulary Project Settings writes and
    // `configured-start` reads. An occupant id here would be a second store.
    expect(AGENT_OPTIONS.some((o) => o.id === agentId)).toBe(true);
  });

  it('marks the current holder without inventing one', () => {
    const views = roleOptionViews({
      role: 'prompt_architect',
      selection: { ...SELECTION, promptArchitectId: null },
      deployment: 'founder_machine',
    });
    // Unknown is not the first entry in the catalog.
    expect(views.some((v) => v.selected)).toBe(false);
  });

  it('reads only, with no way to choose, when the host supplies no handler', () => {
    render(
      <RelayRoleSelector role="reviewer" selection={SELECTION} deployment="founder_machine" onDismiss={vi.fn()} />,
    );
    const dialog = screen.getByRole('dialog');
    const options = within(dialog).getAllByRole('button').filter((b) => b.textContent !== 'CLOSE');
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect((option as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
