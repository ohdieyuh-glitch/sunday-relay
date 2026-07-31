/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { RelayMenuButton, RelayMobileMenu } from './RelayMobileMenu';
import { RelayProjectHeader } from '../project-workspace/RelayProjectHeader';
import { RelayEntryHeader } from '../entry-home/RelayEntryHeader';

/**
 * Mobile chrome — the founder mobile header: gold MENU block opens an
 * accessible full-screen menu. Focus moves in on open and is RESTORED on
 * close; Escape closes; body scroll locks and restores; items fire their
 * callbacks and close the menu; status rows are not buttons.
 */

afterEach(cleanup);

function Harness({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return createElement(
    'div',
    null,
    createElement(RelayMenuButton, { onOpen: () => setOpen(true) }),
    createElement(RelayMobileMenu, {
      open,
      onClose: () => setOpen(false),
      statusLine: 'RLY / 001 — IMPLEMENTING',
      items: [
        { id: 'a', label: 'PROJECT SETTINGS', onSelect: () => onPick('a') },
        { id: 'b', label: 'MANUAL TASKS', hint: '2 OPEN' },
      ],
    }),
  );
}

describe('mobile menu dialog', () => {
  it('opens from the MENU block, focuses CLOSE, and restores focus on close', () => {
    render(createElement(Harness, { onPick: vi.fn() }));
    const menuBtn = screen.getByRole('button', { name: 'Open menu' });
    menuBtn.focus();
    fireEvent.click(menuBtn);
    const close = screen.getByRole('button', { name: 'Close menu' });
    expect(document.activeElement).toBe(close);
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.click(close);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(menuBtn);
    expect(document.body.style.overflow).toBe('');
  });

  it('Escape closes and restores body scroll', () => {
    render(createElement(Harness, { onPick: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.overflow).toBe('');
  });

  it('selecting an item fires its callback and closes; status rows are not buttons', () => {
    const onPick = vi.fn();
    render(createElement(Harness, { onPick }));
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    // Status line + non-interactive hint row render as text, not buttons.
    expect(screen.getByText('RLY / 001 — IMPLEMENTING')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /MANUAL TASKS/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'PROJECT SETTINGS' }));
    expect(onPick).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Tab is trapped inside the dialog', () => {
    render(createElement(Harness, { onPick: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    const dialog = screen.getByRole('dialog');
    const buttons = Array.from(dialog.querySelectorAll('button'));
    const last = buttons[buttons.length - 1];
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(buttons[0]); // wrapped to first
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last); // wrapped back
  });
});

describe('headers expose the founder mobile menu', () => {
  it('workspace header MENU lists home/settings/terminal and fires callbacks', () => {
    const onOpenProjectSettings = vi.fn();
    render(
      createElement(RelayProjectHeader, {
        project: {
          projectId: 'rly-001',
          name: 'Sunday Relay Frontend',
          reference: 'RLY / 001',
          projectType: 'Web interface',
        },
        outputState: 'implementing',
        openManualTasks: 2,
        onReturnHome: vi.fn(),
        onOpenProjectSettings,
        onOpenTerminal: vi.fn(),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(screen.getByText('RLY / 001 — IMPLEMENTING')).toBeTruthy();
    // Scope to the dialog: the desktop header also has a PROJECT SETTINGS
    // button (CSS-hidden on mobile; jsdom renders both).
    const dialog = screen.getByRole('dialog');
    const settingsItem = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('PROJECT SETTINGS'),
    )!;
    fireEvent.click(settingsItem);
    expect(onOpenProjectSettings).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('entry-home header MENU lists alcatraz/settings/terminal', () => {
    const onOpenTerminal = vi.fn();
    render(
      createElement(RelayEntryHeader, {
        productState: 'unconfigured',
        handoffNetworkState: 'standby',
        onReturnToSunday: vi.fn(),
        onOpenProjectSettings: vi.fn(),
        onOpenTerminal,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
    fireEvent.click(screen.getByRole('button', { name: '>_ OPEN LIVE TERMINAL' }));
    expect(onOpenTerminal).toHaveBeenCalled();
  });
});
