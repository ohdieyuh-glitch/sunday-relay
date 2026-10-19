/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';

import { RelayProjectSettings } from './RelayProjectSettings';
import { AGENT_OPTIONS } from './options';
import { createDefaultSettingsDraft } from './defaults';
import { buildProjectBriefDraft } from '../entry-home';
import type { ProjectBriefDraft } from '../entry-home/contracts';
import type { ProjectSettingsDraft, RelayProjectSettingsProps } from './contracts';

/**
 * QUICK SETUP IS A SECOND DOOR, NOT A SECOND CONFIGURATION.
 *
 * The direction is precise about the risk: keep the fifteen-section flow, add
 * a short one, and do NOT create a second PSP configuration system. So what is
 * asserted here is mostly identity — the same draft, the same validator, the
 * same save — because a shorter form that quietly wrote somewhere else would
 * look correct in every screenshot and be wrong in the only way that matters.
 */

// The same brief the other settings suites build from, so a difference here
// can never explain a difference in behaviour there.
const brief: ProjectBriefDraft = buildProjectBriefDraft('Build a usage dashboard for AI developers', null);

afterEach(cleanup);

function setup(overrides: Partial<RelayProjectSettingsProps> = {}) {
  const props: RelayProjectSettingsProps = {
    brief,
    agentOptions: AGENT_OPTIONS,
    entitlement: 'pro',
    onSaveDraft: vi.fn(),
    onStartProject: vi.fn(),
    onConnectRepository: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  };
  render(createElement(RelayProjectSettings, props));
  return props;
}

describe('which door opens', () => {
  it('opens on Quick Setup, with the long flow one click away', () => {
    setup();
    expect((screen.getByRole('button', { name: 'QUICK SETUP' })).getAttribute('aria-pressed'))
      .toBe('true');
    // The fifteen-section rail is NOT rendered — Quick is a view, not a banner
    // stuck on top of the same page.
    expect(screen.queryByRole('navigation', { name: /Settings sections/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ADVANCED SETUP' }));
    expect(screen.getByRole('navigation', { name: /Settings sections/i })).toBeTruthy();
  });

  it('keeps the whole fifteen-section flow, unchanged', () => {
    setup({ initialSetupMode: 'advanced' });
    const rail = screen.getByRole('navigation', { name: /Settings sections/i });
    // Removing a section to make room for Quick Setup is explicitly forbidden.
    expect(within(rail).getAllByRole('button')).toHaveLength(15);
    expect(rail.textContent).toContain('REVIEW AND START');
    expect(rail.textContent).toContain('MCP CONNECTIONS');
  });

  it('offers the five Quick groups the direction names', () => {
    setup();
    // Matched on the numbered headings, so a group cannot be "found" by a
    // word that happens to appear inside one of the controls.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      '01 — AGENT STACK',
      '02 — MODE',
      '03 — PERMISSIONS',
      '04 — COMPUTE AND LIMITS',
      '05 — CREATE',
    ]);
  });
});

describe('one draft, carried across', () => {
  it('shows a Quick choice in the long flow, and the reverse', () => {
    setup();
    // Choose a reviewer in Quick…
    fireEvent.click(screen.getByRole('radio', { name: /Structurally read-only review/ }));
    fireEvent.click(screen.getByRole('button', { name: 'ADVANCED SETUP' }));
    // …and the long flow's own summary reports it. A separate draft could not.
    expect(screen.getByLabelText(/Configuration summary/i).textContent).toContain('Hermes');

    // Now change it in the long flow and go back.
    fireEvent.click(screen.getByRole('button', { name: /05\s*WORKFORCE/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Independent read-only review/ }));
    fireEvent.click(screen.getByRole('button', { name: 'QUICK SETUP' }));
    expect((screen.getByRole('radio', { name: /Independent read-only review/ }) as HTMLInputElement)
      .checked).toBe(true);
  });

  it('saves the same complete draft from Quick as the long flow does', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: 'SAVE DRAFT' }));
    const saved = (props.onSaveDraft as unknown as { mock: { calls: [ProjectSettingsDraft][] } })
      .mock.calls[0][0];
    // A COMPLETE draft, not a Quick-shaped subset: every key the long flow
    // writes is present, so nothing downstream has to guess what Quick omitted.
    const reference = createDefaultSettingsDraft(brief);
    expect(Object.keys(saved).sort()).toEqual(Object.keys(reference).sort());
    // The sections Quick does not show keep their recommended defaults rather
    // than becoming empty.
    expect(saved.verification).toEqual(reference.verification);
    expect(saved.research).toEqual(reference.research);
  });
});

describe('the gate is the same gate', () => {
  it('will not start a project the long flow would refuse', () => {
    const props = setup({
      initialDraft: {
        ...createDefaultSettingsDraft(brief),
        // A reviewer policy that requires a reviewer, with none chosen: the
        // validator's own blocker, reached from the short door.
        workforce: {
          promptArchitectId: 'architect-sunday-alcatraz',
          codingAgentId: 'coding-claude-code',
          reviewerId: null,
          reviewerPolicy: 'every_mission',
        },
      },
    });
    const create = screen.getByRole('button', { name: 'CREATE PROJECT' }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    expect(screen.getByText(/Reviewer policy requires a Reviewer/)).toBeTruthy();
    fireEvent.click(create);
    expect(props.onStartProject).not.toHaveBeenCalled();
  });

  it('starts through the host callback once the blockers are gone', () => {
    const props = setup();
    const create = screen.getByRole('button', { name: 'CREATE PROJECT' }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    expect(props.onStartProject).toHaveBeenCalledTimes(1);
  });
});
