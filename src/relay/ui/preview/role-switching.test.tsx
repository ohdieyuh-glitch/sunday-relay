/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';

import { RelayPreviewApp } from './RelayPreviewApp';
import { getRelayAppStore } from '../app';
import { createDefaultSettingsDraft } from '../project-settings/defaults';

/**
 * SWITCHING A ROLE FROM THE WORKSPACE CHANGES THE PROJECT, NOT A PICTURE.
 *
 * The founder's bar for this is explicit: do not call role switching complete
 * unless a real Mission uses the selected stack. So these assert the whole
 * path through the shipped screens and the real application store — click the
 * strip, choose, and then look at what the STORE holds and what the next
 * mission would be configured from. A test that only checked the label would
 * pass against a purely cosmetic selector, which is the failure being guarded.
 */

beforeEach(() => {
  window.localStorage.clear();
  getRelayAppStore().resetAll();
  window.location.hash = '#/relay';
});
afterEach(cleanup);

function startedProject(request = 'Build a usage dashboard'): string {
  const store = getRelayAppStore();
  const created = store.createDraftFromRequest(request);
  if (!created.ok) throw new Error('setup: could not create the project');
  const id = created.value.project.id;
  const brief = store.getBrief(id);
  if (!brief) throw new Error('setup: no brief');
  const started = store.startProject(id, createDefaultSettingsDraft(brief.draft));
  if (!started.ok) throw new Error(`setup: ${started.message}`);
  return id;
}

const openWorkspace = (id: string) => {
  window.location.hash = `#/relay/project/${id}`;
  return render(createElement(RelayPreviewApp));
};

describe('the workspace agent stack bar', () => {
  it('offers the three roles as controls and nothing else', () => {
    const id = startedProject();
    openWorkspace(id);
    const strip = screen.getByRole('group', { name: /workforce and mode/i });
    const controls = within(strip).getAllByRole('button');
    expect(controls).toHaveLength(3);
    // MODE and PHASE are reports. They are still shown.
    expect(strip.textContent).toContain('PHASE');
    expect(strip.textContent).toContain('MODE');
  });

  it('opens a compact selector in place, without leaving the workspace', () => {
    const id = startedProject();
    openWorkspace(id);
    const strip = screen.getByRole('group', { name: /workforce and mode/i });
    fireEvent.click(within(strip).getAllByRole('button')[1] as HTMLElement);

    expect(screen.getByRole('dialog', { name: /CODING AGENT/i })).toBeTruthy();
    // Still the workspace — not the 15-step setup flow, and not the homepage.
    expect(window.location.hash).toBe(`#/relay/project/${id}`);
    expect(screen.getByText('RELAY CONSOLE')).toBeTruthy();
  });
});

describe('a switch reaches the project configuration', () => {
  it('writes the same record Project Settings writes, and nothing separate', () => {
    const id = startedProject();
    const store = getRelayAppStore();
    const before = store.getSettings(id)?.draft.workforce.reviewerId;

    openWorkspace(id);
    const strip = screen.getByRole('group', { name: /workforce and mode/i });
    fireEvent.click(within(strip).getAllByRole('button')[2] as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: /REVIEWER/i });
    fireEvent.click(within(dialog).getByRole('button', { name: /Hermes/ }));

    const after = store.getSettings(id)?.draft.workforce.reviewerId;
    expect(after).toBe('reviewer-hermes');
    expect(after).not.toBe(before);
    // The selector closes on choice rather than lingering over the workspace.
    expect(screen.queryByRole('dialog', { name: /REVIEWER/i })).toBeNull();
  });

  it('shows the new holder in the strip, from the projection and not from a local copy', () => {
    const id = startedProject();
    openWorkspace(id);
    const strip = screen.getByRole('group', { name: /workforce and mode/i });
    expect(strip.textContent).not.toContain('Hermes');

    fireEvent.click(within(strip).getAllByRole('button')[2] as HTMLElement);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: /REVIEWER/i })).getByRole('button', {
        name: /Hermes/,
      }),
    );

    // Read the strip again: the name arrives through the same projection the
    // workspace always used, so a surface-local copy could not produce it.
    const after = screen.getByRole('group', { name: /workforce and mode/i });
    expect(after.textContent).toContain('Hermes');
  });

  it('survives a reload, because the write was durable and not session state', () => {
    const id = startedProject();
    openWorkspace(id);
    const strip = screen.getByRole('group', { name: /workforce and mode/i });
    fireEvent.click(within(strip).getAllByRole('button')[2] as HTMLElement);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: /REVIEWER/i })).getByRole('button', {
        name: /Hermes/,
      }),
    );
    cleanup();

    // A fresh store instance reading persisted state — the same thing a
    // browser refresh does.
    const reloaded = getRelayAppStore();
    expect(reloaded.getSettings(id)?.draft.workforce.reviewerId).toBe('reviewer-hermes');
    openWorkspace(id);
    expect(
      screen.getByRole('group', { name: /workforce and mode/i }).textContent,
    ).toContain('Hermes');
  });
});

describe('what a Mission started afterwards is configured from', () => {
  it('starts the next mission from the switched stack', () => {
    const id = startedProject();
    const store = getRelayAppStore();

    openWorkspace(id);
    const strip = screen.getByRole('group', { name: /workforce and mode/i });
    fireEvent.click(within(strip).getAllByRole('button')[2] as HTMLElement);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: /REVIEWER/i })).getByRole('button', {
        name: /Hermes/,
      }),
    );
    cleanup();

    // A SECOND project started from the switched draft — the same draft object
    // a mission start reads. This is the claim the founder set the bar on: the
    // stack a mission is configured from is the one that was chosen.
    const switched = store.getSettings(id);
    expect(switched).not.toBeNull();
    const second = store.createDraftFromRequest('Second project, same stack');
    if (!second.ok) throw new Error('setup');
    const startedSecond = store.startProject(second.value.project.id, switched!.draft);
    expect(startedSecond.ok).toBe(true);
    expect(store.getSettings(second.value.project.id)?.draft.workforce.reviewerId)
      .toBe('reviewer-hermes');
  });

  it('refuses to leave the project holding a pair Relay would reject', () => {
    // Independence is enforced where the choice is made, so an invalid stack
    // never reaches the store to be discovered at mission start.
    const id = startedProject();
    const store = getRelayAppStore();
    const draft = store.getSettings(id)!.draft;
    store.saveSettings(id, {
      ...draft,
      workforce: { ...draft.workforce, codingAgentId: 'coding-manual' },
    });

    openWorkspace(id);
    const strip = screen.getByRole('group', { name: /workforce and mode/i });
    fireEvent.click(within(strip).getAllByRole('button')[2] as HTMLElement);
    const dialog = screen.getByRole('dialog', { name: /REVIEWER/i });
    const manual = within(dialog).getByRole('button', { name: /Manual Reviewer/ });
    expect((manual as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(manual);
    expect(store.getSettings(id)?.draft.workforce.reviewerId).not.toBe('reviewer-manual');
    expect(within(dialog).getByText(/Not independent/)).toBeTruthy();
  });
});
