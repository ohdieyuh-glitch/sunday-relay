/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { RelayConfigureAgent } from './RelayConfigureAgent';
import { EMPTY_DRAFT, activate, clearAgentDraft, loadAgentDraft, saveAgentDraft } from '../relay-experience';

/**
 * EDIT THE C.A.R.D. This surface edits the ONE authoritative record the
 * participant built in the world: it opens on that record's values and its
 * Save writes a new revision of the SAME record before handing off. It never
 * seeds a default and never creates a C.A.R.D. — that happens once, in the
 * world.
 */

const T0 = '2026-08-27T00:00:00.000Z';
const built = () => saveAgentDraft(activate({
  ...EMPTY_DRAFT,
  name: 'Caesar',
  promptArchitectId: 'architect-sunday-alcatraz',
  codingAgentId: 'coding-claude-code',
  reviewerId: 'reviewer-hermes',
  mode: 'autonomous',
  spendUsd: 3,
  network: 'blocked',
}, T0), T0);

afterEach(() => { cleanup(); vi.restoreAllMocks(); clearAgentDraft(); });

describe('RelayConfigureAgent', () => {
  it('edits THE C.A.R.D.: opens on the values the participant chose in the world, never a default', () => {
    built();
    render(<RelayConfigureAgent onStartBuilding={() => {}} />);
    expect(screen.getByText(/Edit your C.A.R.D./i)).toBeTruthy();
    expect((screen.getByLabelText('Execution mode') as HTMLSelectElement).value).toBe('autonomous');
    expect((screen.getByLabelText('Spend ceiling (USD)') as HTMLInputElement).value).toBe('3');
    expect(screen.getByText(/Configured as/i).textContent).toContain('C.A.R.D. Caesar · revision 1');
    expect(document.body.textContent).not.toMatch(/Default beta configuration/);
    expect(document.body.textContent).not.toMatch(/\bPSP\b/);
    // A pure editor — no session, no GitHub wall appears here.
    expect(screen.queryByRole('button', { name: /Sign in with GitHub/i })).toBeNull();
  });

  it('names the Compound Agent it configures — architect, coding, reviewer, Relay', () => {
    built();
    render(<RelayConfigureAgent onStartBuilding={() => {}} />);
    const text = screen.getByText(/Edit your C.A.R.D./i).parentElement?.textContent ?? '';
    expect(text).toMatch(/Prompt Architect/i);
    expect(text).toMatch(/Coding Agent/i);
    expect(text).toMatch(/independent Reviewer/i);
    expect(text).toMatch(/Relay/i);
  });

  it('saves BACK INTO the same C.A.R.D. as a new revision, BEFORE handing off', () => {
    const card = built();
    let revisionAtHandoff = -1;
    const onStartBuilding = vi.fn(() => {
      // Read the record at the MOMENT of hand-off: the new revision must already be there.
      revisionAtHandoff = loadAgentDraft().revision;
    });
    render(<RelayConfigureAgent onStartBuilding={onStartBuilding} />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'guided' } });
    fireEvent.change(screen.getByLabelText('Spend ceiling (USD)'), { target: { value: '7' } });
    // Nothing is persisted until Save.
    expect(loadAgentDraft().revision).toBe(card.revision);
    fireEvent.click(screen.getByRole('button', { name: /Save C.A.R.D./i }));

    expect(onStartBuilding).toHaveBeenCalledTimes(1);
    expect(revisionAtHandoff).toBe(card.revision + 1);
    const saved = loadAgentDraft();
    expect(saved.cardId).toBe(card.cardId);
    expect(saved.agentId).toBe(card.agentId);
    expect(saved.mode).toBe('guided');
    expect(saved.spendUsd).toBe(7);
    // Fields this surface never shows are untouched — the record was edited, not replaced.
    expect(saved.network).toBe('blocked');
    expect(saved.name).toBe('Caesar');
    expect(saved.activatedAt).toBe(T0);
    expect(saved.reviewerId).toBe('reviewer-hermes');
  });

  it('an edit is labelled as diverging from THIS C.A.R.D., not from a default', () => {
    built();
    render(<RelayConfigureAgent onStartBuilding={() => {}} />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'guided' } });
    expect(screen.getByText(/Configured as/i).textContent).toContain('Custom (from C.A.R.D. Caesar · revision 1)');
  });

  it('saving without a change is not a new revision', () => {
    const card = built();
    render(<RelayConfigureAgent onStartBuilding={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Save C.A.R.D./i }));
    expect(loadAgentDraft().revision).toBe(card.revision);
  });

  it('with NO C.A.R.D. in this browser it edits nothing and seeds nothing — a C.A.R.D. is created once, in the world', () => {
    const onStartBuilding = vi.fn();
    render(<RelayConfigureAgent onStartBuilding={onStartBuilding} />);
    expect(screen.getByRole('alert').textContent).toMatch(/No C.A.R.D. exists in this browser/i);
    expect(screen.queryByLabelText('Execution mode')).toBeNull();
    expect(screen.queryByRole('button', { name: /Save C.A.R.D./i })).toBeNull();
    expect(loadAgentDraft().revision).toBe(0);
    expect(onStartBuilding).not.toHaveBeenCalled();
  });

  it('refuses to save over a C.A.R.D. that changed since it opened, and reloads the current record instead', () => {
    const card = built();
    const onStartBuilding = vi.fn();
    render(<RelayConfigureAgent onStartBuilding={onStartBuilding} />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'guided' } });
    // Meanwhile the record moved on (another tab, the world): spend 9, revision 2.
    saveAgentDraft({ ...loadAgentDraft(), spendUsd: 9 }, '2026-08-27T00:01:00.000Z');
    fireEvent.click(screen.getByRole('button', { name: /Save C.A.R.D./i }));
    expect(onStartBuilding).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/changed while you were editing/i);
    // Nothing was written over the newer revision; the form now shows it.
    const current = loadAgentDraft();
    expect(current.revision).toBe(card.revision + 1);
    expect(current.mode).toBe('autonomous');
    expect(current.spendUsd).toBe(9);
    expect((screen.getByLabelText('Execution mode') as HTMLSelectElement).value).toBe('autonomous');
    expect((screen.getByLabelText('Spend ceiling (USD)') as HTMLInputElement).value).toBe('9');
    // Saving again, from the current record, succeeds.
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'guided' } });
    fireEvent.click(screen.getByRole('button', { name: /Save C.A.R.D./i }));
    expect(onStartBuilding).toHaveBeenCalledTimes(1);
    expect(loadAgentDraft().revision).toBe(card.revision + 2);
    expect(loadAgentDraft().mode).toBe('guided');
  });

  it('Cancel leaves without saving; Back is offered when there is nothing to edit', () => {
    built();
    const onCancel = vi.fn();
    render(<RelayConfigureAgent onStartBuilding={() => {}} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText('Execution mode'), { target: { value: 'guided' } });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(loadAgentDraft().mode).toBe('autonomous');
    cleanup();
    clearAgentDraft();
    const back = vi.fn();
    render(<RelayConfigureAgent onStartBuilding={() => {}} onCancel={back} />);
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
