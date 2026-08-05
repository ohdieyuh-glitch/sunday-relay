/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';

import { RelayProjectBrainStatus } from './RelayProjectBrainStatus';
import {
  emptyShortTermMemory, refreshBrainDocument, rememberShortTerm,
} from '../../shared/llmops';
import type { ProjectBrainState } from './contracts';

/**
 * THE REFRESHED BRAIN DOCUMENT, ON THE WEBSITE.
 *
 * "Continuously refreshed documentation" is a promise about STALENESS. A
 * generator that prints only its conclusions makes a document about a busy
 * project and a document about a project nothing has reported on for a day look
 * identical, so what is tested here is that the surface says which it is.
 */

afterEach(cleanup);

const AT = '2026-08-05T12:00:00.000Z';
const state: ProjectBrainState = { entries: 2, lastUpdate: AT, pendingApprovals: 1 };
const text = () => document.body.textContent ?? '';

const panel = (brainDocument?: ReturnType<typeof refreshBrainDocument>) =>
  render(createElement(RelayProjectBrainStatus, {
    state, ...(brainDocument === undefined ? {} : { document: brainDocument }),
  }));

const generate = (over: Partial<Parameters<typeof refreshBrainDocument>[0]> = {}) =>
  refreshBrainDocument({
    projectId: 'p', longTerm: [], shortTerm: emptyShortTermMemory(),
    proposals: [], generatedAt: AT, ...over,
  });

describe('a document that was never generated is not an empty document', () => {
  it('says no document has been generated, rather than drawing a blank one', () => {
    panel();
    expect(text()).toContain('No Brain document has been generated');
    expect(document.querySelector('.rpw-brain-doc')).toBeNull();
  });

  it('an empty project produces a document that says it states nothing', () => {
    panel(generate());
    expect(text()).toContain('Nothing has been recorded');
    expect(text()).toContain('Nothing has been approved into long-term memory');
  });
});

describe('the document reports its own freshness, always as a sentence', () => {
  it('a recently fed project reads CURRENT', () => {
    const memory = rememberShortTerm(emptyShortTermMemory(), {
      entryId: 'o1', kind: 'run_outcome', summary: 'suite green',
      observedAt: AT, observedBy: 'relay',
    });
    panel(generate({ shortTerm: memory }));
    expect(text()).toContain('CURRENT');
    expect(document.querySelector('.rpw-brain-fresh')).not.toBeNull();
  });

  it('an old newest-input reads STALE and says how old', () => {
    const memory = rememberShortTerm(emptyShortTermMemory(), {
      entryId: 'o1', kind: 'run_outcome', summary: 'suite green',
      observedAt: '2026-08-05T09:00:00.000Z', observedBy: 'relay',
    });
    panel(generate({ shortTerm: memory }));
    expect(text()).toContain('STALE');
    expect(text()).toContain('minutes old');
    expect(document.querySelector('.rpw-brain-stale')).not.toBeNull();
  });
});

describe('the document does not flatter the Brain', () => {
  it('surfaces an entry approved by its own author, in its own section', () => {
    panel(generate({
      longTerm: [{
        entryId: 'lt1', statement: 'The build is green.', source: 'run_observed',
        citation: 'run_1', proposedBy: 'agent-a', approvedBy: 'agent-a', approvedAt: AT,
      }],
    }));
    expect(text()).toContain('APPROVED BY THEIR OWN AUTHOR');
    expect(text()).toContain('agent-a approved their own entry');
  });

  it('says what fell out of short-term memory rather than hiding the eviction', () => {
    let memory = emptyShortTermMemory();
    for (let i = 0; i < 70; i += 1) {
      memory = rememberShortTerm(memory, {
        entryId: `o${String(i).padStart(3, '0')}`, kind: 'note', summary: `n${i}`,
        observedAt: new Date(Date.parse(AT) + i * 1000).toISOString(), observedBy: 'relay',
      });
    }
    panel(generate({ shortTerm: memory, generatedAt: new Date(Date.parse(AT) + 70_000).toISOString() }));
    expect(text()).toContain('older observation(s) have been evicted');
  });

  it('a proposal is shown as awaiting approval, never as knowledge', () => {
    panel(generate({
      proposals: [{
        entryId: 'o1', statement: 'The suite is green on main.', source: 'run_observed',
        citation: 'run_1', proposedBy: 'agent-a', basis: ['o1'], proposedAt: AT,
      }],
    }));
    expect(text()).toContain('AWAITING APPROVAL');
    expect(text()).toContain('proposed by agent-a');
    // And it is NOT listed under what the project knows.
    const known = [...document.querySelectorAll('section[aria-label="WHAT THIS PROJECT KNOWS"] li')]
      .map((n) => n.textContent ?? '');
    expect(known.join(' ')).not.toContain('The suite is green on main.');
  });
});
