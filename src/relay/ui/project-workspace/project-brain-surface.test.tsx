/** @vitest-environment jsdom */
import { describe, expect, it, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { RelayProjectBrainOrb } from './RelayProjectBrainOrb';
import { RelayProjectBrainView } from './RelayProjectBrainView';
import type { ProjectBrainState } from './contracts';
import type { RelayBrainDocument } from '../../shared/llmops';

/**
 * THE PROJECT BRAIN IS AN OBJECT IN THE WORKSPACE, AND IT TELLS THE TRUTH.
 *
 * Two things are being held here. The first is structural: the Brain is an
 * ORIGINAL drawing built from primitives, with no external asset — the
 * reference images supplied with the direction were watermarked stock and are
 * reference only.
 *
 * The second is the one that matters more. The view shows what Relay has
 * RECORDED. A project with nothing recorded and a deployment whose generator
 * has never run are different facts, and neither of them is an empty chart.
 */

const state = (over: Partial<ProjectBrainState> = {}): ProjectBrainState => ({
  entries: 12, lastUpdate: '2026-08-09T04:00:00.000Z', pendingApprovals: 0, ...over,
});

const doc: RelayBrainDocument = {
  projectId: 'rly-002',
  generatedAt: '2026-08-09T04:00:00.000Z',
  longTermEntries: 12,
  selfApprovedEntries: 3,
  shortTermEntries: 7,
  shortTermEvicted: 2,
  pendingProposals: 1,
  newestInputAt: '2026-08-09T03:55:00.000Z',
  stale: false,
  freshness: 'generated from 12 approved entries',
  sections: [
    { heading: 'ARCHITECTURE', lines: ['The bridge owns dispatch.', 'The UI is a consumer.'] },
    { heading: 'DECISIONS', lines: ['Reviewer independence is structural.'] },
  ],
};

afterEach(cleanup);

describe('the Project Brain object', () => {
  it('draws itself, loading no external asset', () => {
    const { container } = render(<RelayProjectBrainOrb />);
    const svg = container.querySelector('svg.rpb-orb');
    expect(svg).toBeTruthy();
    // No <image>, no url(...) to anywhere off this page.
    expect(container.querySelector('image')).toBeNull();
    expect(container.innerHTML).not.toContain('http');
    // The network it draws is connected: pathways AND nodes.
    expect(container.querySelectorAll('.rpb-path').length).toBeGreaterThan(3);
    expect(container.querySelectorAll('.rpb-node').length).toBeGreaterThan(6);
  });

  /** Two Brains on one page must not share gradient ids. */
  it('gives each instance its own gradients', () => {
    const { container } = render(
      <div><RelayProjectBrainOrb /><RelayProjectBrainOrb /></div>,
    );
    const ids = [...container.querySelectorAll('radialGradient,linearGradient')]
      .map((n) => n.getAttribute('id'));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stops every animation when motion is reduced, rotation included', () => {
    const { container } = render(<RelayProjectBrainOrb reducedMotion />);
    // The live class is what every keyframe hangs off.
    expect(container.querySelector('.rpb-orb--live')).toBeNull();
  });

  /** A Brain with nothing recorded is the SAME object, dimmer. */
  it('draws an unpopulated Brain as the same object', () => {
    const { container } = render(<RelayProjectBrainOrb populated={false} />);
    expect(container.querySelector('.rpb-orb--sparse')).toBeTruthy();
    expect(container.querySelectorAll('.rpb-node').length).toBeGreaterThan(6);
  });
});

describe('the Project Brain view shows what Relay recorded', () => {
  it('says no document has been generated, rather than showing an empty one', () => {
    render(<RelayProjectBrainView state={state({ entries: 0 })} onClose={() => undefined} />);
    expect(screen.getByText(/no brain document has been generated/i)).toBeTruthy();
  });

  it('renders the document sections it was given, and invents none', () => {
    render(<RelayProjectBrainView state={state()} document={doc} onClose={() => undefined} />);
    for (const section of doc.sections) {
      expect(screen.getByText(new RegExp(section.heading))).toBeTruthy();
    }
    // No heading Relay did not generate.
    expect(screen.queryByText(/^HEALTH$/)).toBeNull();
    expect(screen.queryByText(/^EXPERIENCE$/)).toBeNull();
  });

  /** Progressive disclosure: one section at a time, not a wall of text. */
  it('opens one section at a time', () => {
    const { container } = render(
      <RelayProjectBrainView state={state()} document={doc} onClose={() => undefined} />,
    );
    const toggles = within(container).getAllByRole('button', { expanded: undefined });
    const expanded = toggles.filter((b) => b.getAttribute('aria-expanded') === 'true');
    expect(expanded.length).toBe(1);
    // The first section's lines are visible; the second's are not.
    expect(screen.getByText('The bridge owns dispatch.')).toBeTruthy();
    expect(screen.queryByText('Reviewer independence is structural.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /DECISIONS/ }));
    expect(screen.getByText('Reviewer independence is structural.')).toBeTruthy();
    expect(screen.queryByText('The bridge owns dispatch.')).toBeNull();
  });

  /**
   * THE MEMORY THE BRAIN ACTUALLY HOLDS. The document already distinguishes
   * durable knowledge from what it is holding provisionally, what it DROPPED,
   * and what is waiting to be approved — and the workspace panel showed none
   * of it. A count that was dropped is a fact about the Brain's limits, and
   * hiding it makes a bounded memory look unbounded.
   */
  it('separates durable knowledge from short-term memory, evictions and the queue', () => {
    render(<RelayProjectBrainView state={state()} document={doc} onClose={() => undefined} />);
    expect(screen.getByText(/DURABLE KNOWLEDGE/i)).toBeTruthy();
    expect(screen.getByText(/HOLDING NOW/i)).toBeTruthy();
    expect(screen.getByText(/DROPPED/i)).toBeTruthy();
    expect(screen.getByText(/AWAITING APPROVAL/i)).toBeTruthy();
  });

  it('reports an absent last update as unknown, never as a date', () => {
    render(
      <RelayProjectBrainView state={state({ lastUpdate: null })} onClose={() => undefined} />,
    );
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('returns to the project it was opened from', () => {
    let closed = false;
    render(
      <RelayProjectBrainView state={state()} onClose={() => { closed = true; }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /back to project/i }));
    expect(closed).toBe(true);
  });
});
