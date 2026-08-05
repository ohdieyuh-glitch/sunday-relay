/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

import { RelayStageBackdropPicker } from './RelayStageBackdropPicker';

/**
 * CHOOSING A SCENE.
 *
 * The picker's job is small and its ways of lying are specific: hiding that
 * "None" is a choice, offering a control that cannot act, and describing
 * motion to a user whose setting has already stilled it.
 */

afterEach(cleanup);

describe('every choice is visible, including None', () => {
  it('lists all three', () => {
    render(createElement(RelayStageBackdropPicker, { selected: 'none', onSelect: vi.fn() }));
    for (const label of ['None', 'Jungle', 'Space Station']) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
  });

  it('marks exactly one selected, and an unknown id selects None', () => {
    render(createElement(RelayStageBackdropPicker, { selected: 'savannah', onSelect: vi.fn() }));
    const checked = [...document.querySelectorAll('input[type="radio"]')]
      .filter((n) => (n as HTMLInputElement).checked)
      .map((n) => (n as HTMLInputElement).value);
    expect(checked).toEqual(['none']);
  });

  it('reports the choice and decides nothing itself', () => {
    const onSelect = vi.fn();
    render(createElement(RelayStageBackdropPicker, { selected: 'none', onSelect }));
    fireEvent.click(screen.getByRole('radio', { name: /space station/i }));
    expect(onSelect).toHaveBeenCalledWith('space_station');
  });
});

describe('a control that cannot act is not drawn', () => {
  it('renders no radio at all without a handler', () => {
    // The same rule the run panel and the MCP settings surface hold.
    render(createElement(RelayStageBackdropPicker, { selected: 'jungle' }));
    expect(document.querySelectorAll('input').length).toBe(0);
    // The current choice is still legible.
    expect(screen.getByText('SELECTED')).toBeTruthy();
  });
});

describe('motion is described only where it is true', () => {
  it('says a scene moves, and only for scenes that move', () => {
    render(createElement(RelayStageBackdropPicker, { selected: 'none', onSelect: vi.fn() }));
    const notes = [...document.querySelectorAll('.rsbp-motion')].map((n) => n.textContent);
    expect(notes.length, 'None does not move; the other two do').toBe(2);
  });

  it('mentions reduced motion only when the user actually has it on', () => {
    render(createElement(RelayStageBackdropPicker, {
      selected: 'none', onSelect: vi.fn(), reducedMotion: false,
    }));
    expect(document.body.innerHTML).not.toContain('reduced-motion setting');
    cleanup();
    render(createElement(RelayStageBackdropPicker, {
      selected: 'none', onSelect: vi.fn(), reducedMotion: true,
    }));
    expect(document.body.innerHTML).toContain('reduced-motion setting');
  });

  it('says plainly that a backdrop changes nothing Relay reports', () => {
    render(createElement(RelayStageBackdropPicker, { selected: 'none', onSelect: vi.fn() }));
    expect(screen.getByText(/changes nothing Relay reports/)).toBeTruthy();
  });
});
