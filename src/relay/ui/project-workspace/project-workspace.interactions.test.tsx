/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { RelayProjectWorkspace } from './RelayProjectWorkspace';
import { WORKSPACE_FIXTURES, type WorkspaceFixtureKey } from './fixtures';
import type { RelayProjectWorkspaceProps } from './contracts';

/**
 * Workspace interaction tests (jsdom): every callback fires with the right
 * payload; the terminal opens/closes with focus management; conversation and
 * research inputs never execute anything directly.
 */

afterEach(cleanup);

function makeProps(
  key: WorkspaceFixtureKey,
  overrides: Partial<RelayProjectWorkspaceProps> = {},
): RelayProjectWorkspaceProps {
  return {
    ...WORKSPACE_FIXTURES[key],
    terminalOpen: false,
    onSendProjectMessage: vi.fn(),
    onApproveDecision: vi.fn(),
    onRejectDecision: vi.fn(),
    onOpenTerminal: vi.fn(),
    onCloseTerminal: vi.fn(),
    onOpenProjectSettings: vi.fn(),
    onOpenManualTask: vi.fn(),
    onApproveManualTask: vi.fn(),
    onRejectManualTask: vi.fn(),
    onRequestResearch: vi.fn(),
    onOpenFinding: vi.fn(),
    onOpenRepair: vi.fn(),
    onReturnHome: vi.fn(),
    ...overrides,
  };
}

describe('workspace interactions', () => {
  it('project message send fires the callback and clears the input', () => {
    const p = makeProps('implementing');
    render(createElement(RelayProjectWorkspace, p));
    const input = screen.getByLabelText('Ask Relay about this project') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'What is happening now?' } });
    fireEvent.click(screen.getByRole('button', { name: 'SEND' }));
    expect(p.onSendProjectMessage).toHaveBeenCalledWith('What is happening now?');
    expect(input.value).toBe('');
  });

  it('approval-request decisions report their decision id', () => {
    const p = makeProps('waiting_for_user');
    render(createElement(RelayProjectWorkspace, p));
    // Scope to the conversation: the Manual Task panel has its own APPROVE.
    const conv = screen.getByLabelText('Project conversation');
    const buttons = Array.from(conv.querySelectorAll('button'));
    fireEvent.click(buttons.find((b) => b.textContent === 'APPROVE')!);
    expect(p.onApproveDecision).toHaveBeenCalledWith('fx-decision-deploy');
    fireEvent.click(buttons.find((b) => b.textContent === 'REJECT')!);
    expect(p.onRejectDecision).toHaveBeenCalledWith('fx-decision-deploy');
  });

  it('manual task review/approve/keep-blocked callbacks carry the task id', () => {
    const p = makeProps('waiting_for_user');
    render(createElement(RelayProjectWorkspace, p));
    fireEvent.click(screen.getByRole('button', { name: 'REVIEW REQUEST' }));
    expect(p.onOpenManualTask).toHaveBeenCalledWith('fx-mt-1');
    // Manual-task APPROVE is a distinct button from the conversation APPROVE;
    // scope by the manual-task article.
    const article = screen.getByLabelText('Manual task MT-1');
    const approve = Array.from(article.querySelectorAll('button')).find(
      (b) => b.textContent === 'APPROVE',
    )!;
    fireEvent.click(approve);
    expect(p.onApproveManualTask).toHaveBeenCalledWith('fx-mt-1');
    fireEvent.click(screen.getByRole('button', { name: 'KEEP BLOCKED' }));
    expect(p.onRejectManualTask).toHaveBeenCalledWith('fx-mt-1');
  });

  it('terminal opens via callback and the close control receives focus + fires close', () => {
    const p = makeProps('verifying');
    const { rerender } = render(createElement(RelayProjectWorkspace, p));
    fireEvent.click(screen.getByRole('button', { name: 'Open Live Terminal' }));
    expect(p.onOpenTerminal).toHaveBeenCalled();

    rerender(createElement(RelayProjectWorkspace, { ...p, terminalOpen: true }));
    const close = screen.getByRole('button', { name: 'Close Live Terminal' });
    expect(document.activeElement).toBe(close);
    fireEvent.click(close);
    expect(p.onCloseTerminal).toHaveBeenCalled();
  });

  it('research topic requests flow through the callback only', () => {
    const p = makeProps('researching');
    render(createElement(RelayProjectWorkspace, p));
    const input = screen.getByLabelText('Request a research topic');
    fireEvent.change(input, { target: { value: 'WCAG 2.2 changes' } });
    fireEvent.click(screen.getByRole('button', { name: 'REQUEST RESEARCH' }));
    expect(p.onRequestResearch).toHaveBeenCalledWith('WCAG 2.2 changes');
  });

  it('finding and repair panels report their ids', () => {
    const p = makeProps('revision_required');
    render(createElement(RelayProjectWorkspace, p));
    fireEvent.click(screen.getByRole('button', { name: 'OPEN FINDING' }));
    expect(p.onOpenFinding).toHaveBeenCalledWith('F-1');
    fireEvent.click(screen.getByRole('button', { name: 'OPEN REPAIR' }));
    expect(p.onOpenRepair).toHaveBeenCalledWith('R-1');
  });

  it('header navigation callbacks: return home + project settings', () => {
    const p = makeProps('implementing');
    render(createElement(RelayProjectWorkspace, p));
    fireEvent.click(screen.getByRole('button', { name: '← RELAY HOME' }));
    expect(p.onReturnHome).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'PROJECT SETTINGS' }));
    expect(p.onOpenProjectSettings).toHaveBeenCalled();
  });
});
